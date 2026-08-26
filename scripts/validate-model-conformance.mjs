import process from "node:process";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { buildOpenApiContext, toAllowedOperations } from "../src/features/connections/openApiOperations.ts";
import { parsePageSpec } from "../src/features/pages/parsePageSpec.ts";
import { normalizeModelJsonText, repairModelJson } from "../src/features/pages/modelJsonRepair.ts";
import { composeModelPrompt } from "../src/features/workbench/PromptComposer.ts";
import { BUILT_IN_PROMPT_TEMPLATES } from "../src/features/workbench/promptTemplates.ts";
import { CONFORMANCE_CASE_KEYS, classifyConformanceFailure, conformanceCaseDistribution, conformanceThresholdStatus, createConformanceCases, isRetryableConformanceFailure } from "./model-conformance-cases.ts";

const spec = {
  title: "Device Operations",
  version: "1",
  spec_version: "3.1.0",
  operation_count: 5,
  operations: [
    "GET /devices · listDevices",
    "GET /devices/{id} · getDevice",
    "POST /devices · createDevice",
    "PATCH /devices/{id} · updateDevice",
    "DELETE /devices/{id} · deleteDevice",
  ],
  api_base_url: "https://api.invalid",
  discovered_url: "https://api.invalid/openapi.json",
  fieldSchemas: {
    createDevice: [
      { name: "name", type: "string", required: true },
      { name: "status", type: "enum", enumValues: ["active", "paused"], required: true },
    ],
    updateDevice: [
      { name: "status", type: "enum", enumValues: ["active", "paused", "retired"], required: true },
      { name: "retiredReason", type: "string", required: false, visibleWhen: { field: "status", equals: "retired" } },
    ],
  },
};

const MAX_CONFORMANCE_OUTPUT_TOKENS = 4096;

const templates = Object.fromEntries(BUILT_IN_PROMPT_TEMPLATES.map((template) => [template.id, template]));
const dryRun = process.argv.includes("--dry-run");
const count = Number.parseInt(process.env.MODEL_CONFORMANCE_COUNT || "50", 10);
if (!Number.isInteger(count) || count < 1 || count > 200) throw new Error("MODEL_CONFORMANCE_COUNT must be an integer from 1 to 200");
const cases = createConformanceCases(count).map((testCase) => ({ ...testCase, template: templates[testCase.templateId] }));
const distribution = conformanceCaseDistribution(cases);

const allowedOperations = toAllowedOperations(spec);
const openapiContext = buildOpenApiContext(spec);

function requestFor(testCase) {
  const composed = composeModelPrompt({
    prompt: testCase.prompt,
    promptTemplate: testCase.template,
    allowedOperations,
  });
  return { ...composed, openapiContext, allowedOperations };
}

function extractText(payload, protocol) {
  if (protocol === "anthropic") {
    const blocks = Array.isArray(payload?.content) ? payload.content : [];
    return blocks.find((block) => block?.type === "text" && typeof block.text === "string")?.text ?? "";
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => typeof part?.text === "string" ? part.text : "").join("");
  return "";
}

function parsePage(text) {
  const repaired = repairModelJson(normalizeModelJsonText(text));
  try {
    return parsePageSpec(JSON.parse(repaired));
  } catch {
    return null;
  }
}

function semanticMatch(testCase, page) {
  if (testCase.key === "enterprise-theme") return page.theme === "enterprise-blue";
  if (testCase.key === "dashboard") return page.stats.length > 0 || page.views?.some((view) => view.type === "chart") === true;
  const roles = new Set(page.operations?.map((operation) => operation.role) ?? []);
  return ["create", "update", "delete"].some((role) => roles.has(role));
}

if (dryRun) {
  const requests = cases.map((testCase) => ({ key: testCase.key, ...requestFor(testCase) }));
  console.log(JSON.stringify({
    count,
    distribution,
    uniquePrompts: Object.fromEntries(CONFORMANCE_CASE_KEYS.map((key) => [key, new Set(cases.filter((testCase) => testCase.key === key).map((testCase) => testCase.prompt)).size])),
    maxOutputTokens: MAX_CONFORMANCE_OUTPUT_TOKENS,
    cases: requests.map(({ key, scene, systemPrompt, openapiContext: context }, index) => ({ index: index + 1, key, variant: cases[index].variant, scene, systemPromptChars: systemPrompt.length, openapiContextChars: context?.length ?? 0 })),
  }, null, 2));
  process.exit(0);
}

const baseUrl = process.env.MODEL_BASE_URL?.trim().replace(/\/$/, "");
const model = process.env.MODEL_NAME?.trim();
const apiKey = process.env.MODEL_API_KEY?.trim();
const protocol = process.env.MODEL_PROTOCOL === "anthropic" ? "anthropic" : "openai";
const delayMs = Math.max(0, Number.parseInt(process.env.MODEL_CONFORMANCE_DELAY_MS || "1000", 10) || 0);
const timeoutMs = Math.max(5_000, Number.parseInt(process.env.MODEL_CONFORMANCE_TIMEOUT_MS || "120000", 10) || 120_000);
const maxRetries = Math.min(5, Math.max(0, Number.parseInt(process.env.MODEL_CONFORMANCE_MAX_RETRIES || "3", 10) || 0));
const retryDelayMs = Math.max(1_000, Number.parseInt(process.env.MODEL_CONFORMANCE_RETRY_DELAY_MS || "5000", 10) || 5_000);
const debugFailures = process.env.MODEL_CONFORMANCE_DEBUG_FAILURES === "1";
const usesEnvironmentConfig = Boolean(baseUrl || model || apiKey);
if (usesEnvironmentConfig && (!baseUrl || !model)) throw new Error("MODEL_BASE_URL and MODEL_NAME must be provided together");

function createClientProbe() {
  const manifestPath = fileURLToPath(new URL("../src-tauri/Cargo.toml", import.meta.url));
  const child = spawn("cargo", ["run", "--quiet", "--manifest-path", manifestPath, "--features", "model-conformance-probe", "--bin", "model-conformance-probe"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const lines = createInterface({ input: child.stdout });
  let pending = null;
  let stderr = "";
  let exited = false;
  let exitCode = null;

  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
  lines.on("line", (line) => {
    if (!pending) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    try {
      current.resolve(JSON.parse(line));
    } catch {
      exited = true;
      child.kill();
      current.reject(new Error("Client model probe returned invalid JSON"));
    }
  });
  child.on("error", (error) => {
    exited = true;
    if (!pending) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    current.reject(error);
  });
  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
    if (!pending) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    current.reject(new Error(`Client model probe exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
  });

  return {
    request(payload, requestTimeoutMs) {
      if (pending) return Promise.reject(new Error("Client model probe only accepts one request at a time"));
      if (exited) return Promise.reject(new Error(`Client model probe is not running (exit code ${exitCode})`));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending = null;
          exited = true;
          child.kill();
          reject(new Error("Client model probe timed out"));
        }, requestTimeoutMs);
        pending = { resolve, reject, timer };
        child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
          if (!error || !pending) return;
          const current = pending;
          pending = null;
          clearTimeout(current.timer);
          current.reject(error);
        });
      });
    },
    close() {
      child.stdin.end();
    },
  };
}

if (process.argv.includes("--check-client-config")) {
  if (usesEnvironmentConfig) {
    console.log(JSON.stringify({ configurationSource: "environment", protocol, model }, null, 2));
  } else {
    const probe = createClientProbe();
    const descriptor = await probe.request({ kind: "describe" }, Math.max(timeoutMs, 300_000));
    probe.close();
    if (descriptor.kind !== "descriptor") throw new Error(descriptor.error || "Unable to load the client default model");
    console.log(JSON.stringify({ configurationSource: "client-default", name: descriptor.name, protocol: descriptor.protocol, model: descriptor.model, temperature: descriptor.temperature, configuredMaxTokens: descriptor.configured_max_tokens, effectiveMaxTokens: descriptor.effective_max_tokens, structuredOutput: descriptor.structured_output, credentialsReady: descriptor.credentials_ready, credentialRefs: descriptor.credential_refs }, null, 2));
  }
  process.exit(0);
}

if (!process.argv.includes("--confirm-paid-calls")) {
  throw new Error("Real model validation requires --confirm-paid-calls because it performs external calls that may incur cost");
}

const endpoint = usesEnvironmentConfig ? `${baseUrl}/${protocol === "anthropic" ? "messages" : "chat/completions"}` : null;
const metrics = Object.fromEntries(CONFORMANCE_CASE_KEYS.map((key) => [key, { attempted: 0, schema: 0, semantic: 0 }]));
const failures = {};
const clientProbe = usesEnvironmentConfig ? null : createClientProbe();
let abortedEarly = null;

if (clientProbe) {
  const descriptor = await clientProbe.request({ kind: "describe" }, Math.max(timeoutMs, 300_000));
  if (descriptor.kind !== "descriptor") throw new Error(descriptor.error || "Unable to load the client default model");
  console.log(`[config] client default: ${descriptor.name} · ${descriptor.protocol} · ${descriptor.model} · ${descriptor.structured_output} · ${descriptor.effective_max_tokens} tokens`);
}

async function generateCasePage(request) {
  if (clientProbe) {
    const result = await clientProbe.request({
      kind: "generate",
      request: {
        prompt: request.prompt,
        systemPrompt: request.systemPrompt,
        openapiContext: request.openapiContext,
        allowedOperations: request.allowedOperations,
      },
    }, timeoutMs + 10_000);
    if (!result.ok) throw new Error(result.error || "Client model probe failed");
    return result.page;
  }

  const headers = { "content-type": "application/json" };
  if (apiKey) headers[protocol === "anthropic" ? "x-api-key" : "authorization"] = protocol === "anthropic" ? apiKey : `Bearer ${apiKey}`;
  if (protocol === "anthropic") headers["anthropic-version"] = "2023-06-01";
  const body = protocol === "anthropic"
    ? { model, max_tokens: MAX_CONFORMANCE_OUTPUT_TOKENS, temperature: .2, system: request.systemPrompt, messages: [{ role: "user", content: `Request: ${request.prompt}\nOpenAPI context: ${request.openapiContext}` }] }
    : { model, max_tokens: MAX_CONFORMANCE_OUTPUT_TOKENS, temperature: .2, response_format: { type: "json_object" }, messages: [{ role: "system", content: request.systemPrompt }, { role: "user", content: `Request: ${request.prompt}\nOpenAPI context: ${request.openapiContext}` }] };
  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parsePage(extractText(await response.json(), protocol));
}

try {
  for (let index = 0; index < count; index += 1) {
    const testCase = cases[index];
    const request = requestFor(testCase);
    metrics[testCase.key].attempted += 1;
    let outcome = "schema-fail";
    let page = null;
    let terminalFailure = null;
    for (let retry = 0; retry <= maxRetries; retry += 1) {
      try {
        page = await generateCasePage(request);
        terminalFailure = null;
        break;
      } catch (error) {
        const category = classifyConformanceFailure(error);
        if (debugFailures) {
          const diagnostic = (error instanceof Error ? error.message : String(error))
            .replace(/https?:\/\/\S+/gi, "[url]")
            .replace(/(api[_-]?key|authorization|bearer)\s*[:=]?\s*\S+/gi, "$1 [redacted]")
            .replace(/\s+/g, " ")
            .slice(0, 300);
          console.error(`[diagnostic] ${testCase.key}: ${category}: ${diagnostic}`);
        }
        if (retry < maxRetries && isRetryableConformanceFailure(category)) {
          const backoffMs = Math.min(retryDelayMs * (2 ** retry), 30_000);
          console.log(`[retry] ${testCase.key}: ${category} ${retry + 1}/${maxRetries}`);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        terminalFailure = category;
        break;
      }
    }
    if (terminalFailure) {
      failures[terminalFailure] = (failures[terminalFailure] ?? 0) + 1;
      outcome = `request-fail:${terminalFailure}`;
    } else if (page) {
      metrics[testCase.key].schema += 1;
      outcome = "schema-pass";
      if (semanticMatch(testCase, page)) {
        metrics[testCase.key].semantic += 1;
        outcome = "pass";
      }
    }
    console.log(`[${index + 1}/${count}] ${testCase.key}: ${outcome}`);
    if (index + 1 < count) {
      const attempted = Object.values(metrics).reduce((sum, metric) => sum + metric.attempted, 0);
      const schemaPasses = Object.values(metrics).reduce((sum, metric) => sum + metric.schema, 0);
      const schemaStatus = conformanceThresholdStatus(schemaPasses, attempted, count);
      const themeMetric = metrics["enterprise-theme"];
      const themeStatus = conformanceThresholdStatus(themeMetric.semantic, themeMetric.attempted, distribution["enterprise-theme"]);
      if (!schemaStatus.reachable || !themeStatus.reachable) {
        const reason = !schemaStatus.reachable ? "schema" : "enterprise-theme";
        abortedEarly = {
          afterAttempt: attempted,
          reason,
          maximumSchemaRate: schemaStatus.maximumRate,
          maximumThemeRate: themeStatus.maximumRate,
        };
        console.error(`[abort] ${reason} can no longer reach the 95% acceptance threshold`);
        break;
      }
    }
    if (delayMs && index + 1 < count) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
} finally {
  clientProbe?.close();
}

const totalSchema = Object.values(metrics).reduce((sum, metric) => sum + metric.schema, 0);
const attempted = Object.values(metrics).reduce((sum, metric) => sum + metric.attempted, 0);
const completed = attempted === count;
const schemaRate = totalSchema / Math.max(1, attempted);
const themeMetric = metrics["enterprise-theme"];
const themeRate = themeMetric.semantic / Math.max(1, themeMetric.attempted);
const maximumSchemaRate = conformanceThresholdStatus(totalSchema, attempted, count).maximumRate;
const maximumThemeRate = conformanceThresholdStatus(themeMetric.semantic, themeMetric.attempted, distribution["enterprise-theme"]).maximumRate;
const summary = { count, attempted, completed, configurationSource: usesEnvironmentConfig ? "environment" : "client-default", distribution, schemaRate, themeRate, maximumSchemaRate, maximumThemeRate, abortedEarly, metrics, failures };
console.log(JSON.stringify(summary, null, 2));
if (!completed || schemaRate < .95 || themeRate < .95 || metrics.dashboard.semantic === 0 || metrics.crud.semantic === 0) process.exitCode = 1;
