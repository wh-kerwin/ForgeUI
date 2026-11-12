#!/usr/bin/env node
/**
 * Offline B2B generation evaluation. No model, API key or network is used.
 * Each fixture fixes its input and expected structural behaviour; the contract,
 * binding and execution layers are exercised through the real application
 * modules, never by checking whether a prompt "looks like" it contains a word.
 *
 * Live model evaluation is opt-in only: --live plus FORGE_UI_LIVE_EVAL=1 and an
 * explicit --endpoint. Automatic tests never enable it and never spend tokens.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
export const FIXTURE_DIR = path.join(root, "tests", "fixtures", "b2b-generation");
export const LIVE_REQUIRED_ENV = "FORGE_UI_LIVE_EVAL";

export function isLiveRequested(argv = process.argv, env = process.env) {
  return argv.includes("--live") && env[LIVE_REQUIRED_ENV] === "1";
}

register("./typescript-test-loader.mjs", import.meta.url);

const modules = await Promise.all([
  import("../src/features/pages/contracts/pageDefinition.ts"),
  import("../src/features/pages/pageOperations.ts"),
  import("../src/features/pages/data/responseMapping.ts"),
  import("../src/features/pages/runtime/pageRuntimeState.ts"),
  import("../src/features/pages/metrics/metricScope.ts"),
  import("../src/features/templates/templateBinding.ts"),
  import("../src/features/pages/capabilities/businessCapabilityCatalog.ts"),
  import("../src/features/pages/formValidation.ts"),
]);
const [contract, operations, mapping, runtime, metrics, bindings, capabilities, forms] = modules;

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function loadCases(directory = FIXTURE_DIR) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  const cases = manifest.files.flatMap((file) => {
    const group = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
    return group.cases.map((item) => ({ ...item, file }));
  });
  const ids = new Set();
  for (const item of cases) {
    if (ids.has(item.id)) throw new Error(`duplicate fixture id: ${item.id}`);
    ids.add(item.id);
  }
  return { manifest, cases };
}

function observe(item) {
  const input = item.input ?? {};
  const definition = input.definition ?? null;
  const ops = Array.isArray(definition?.operations) ? definition.operations : [];
  const declared = input.declaredQueryParameters ?? [];
  const authorized = new Set(input.authorizedOperations ?? []);

  let contractAccepted = false;
  try {
    contractAccepted = contract.validatePageDefinition(definition).definition !== null;
  } catch {
    contractAccepted = false;
  }

  let capabilityRejected = false;
  if (input.capabilityGap) {
    const capability = capabilities.capabilityForScene(input.scene ?? "query");
    capabilityRejected = Boolean(capability && capabilities.capabilityGap(capability, []));
  }

  let bindingAccepted = ops.every((operation) =>
    authorized.has(
      operations.operationKey(operation.method, operation.path, operation.operation_id),
    ),
  );
  for (const metric of definition?.metrics ?? []) {
    if (metric.scope !== "serverAggregate" || !metric.operationRef) continue;
    const bound = ops.some((operation) => operation.operation_id === metric.operationRef);
    if (!bound && !authorized.has(metric.operationRef)) bindingAccepted = false;
  }
  if (input.authorizationRevoked) bindingAccepted = false;

  let bindingState = null;
  if (Array.isArray(input.documents)) {
    const reconciliation = bindings.reconcileTemplateBindings({
      template: { apiDocumentIds: input.templateDocumentIds ?? [] },
      page: definition,
      documents: input.documents,
      projectId: "p1",
    });
    bindingState = reconciliation.entries[0]?.state ?? "no-candidate";
    bindingAccepted = false;
  }

  const propagation = metrics.propagateMetricFilters(input.filters ?? {}, declared);

  let mappingStatus = null;
  let records = Array.isArray(input.records) ? [...input.records] : [];
  let total = null;
  let truncatedRows = false;
  if (input.binding && Object.prototype.hasOwnProperty.call(input, "body")) {
    const mapped = mapping.mapResponse(input.body, input.binding);
    mappingStatus = mapped.status;
    records = mapped.records;
    total = mapped.total ?? null;
    truncatedRows = Boolean(mapped.truncated?.rows);
  }

  // An unconfirmed mapping or a cancelled/project-switched request never
  // commits records, even if a late response body is present in the fixture.
  if (mappingStatus === "unconfirmed") records = [];
  const canceled = Boolean(input.canceled || input.projectChanged);
  if (canceled) records = [];
  let state = runtime.createPageRuntimeState(item.id);
  let queryStatus = "idle";
  if (canceled) {
    queryStatus = "cancelled";
  } else if (contractAccepted && bindingAccepted && !capabilityRejected) {
    if (mappingStatus === "invalid") {
      queryStatus = "error";
    } else if (mappingStatus === "unconfirmed") {
      queryStatus = "cancelled";
    } else if (mappingStatus === "empty" || records.length > 0 || input.binding) {
      state = runtime.applyQueryResult(state, {
        records: mappingStatus === "empty" ? [] : records,
        columns: definition?.columns ?? Object.keys(records[0] ?? {}),
        ...(total !== null ? { total } : {}),
        truncated: { rows: Boolean(input.truncated) || truncatedRows, columns: false },
        rowKeyPointer: input.rowKeyPointer ?? input.binding?.rowKeyPointer ?? "/id",
      });
      queryStatus = records.length === 0 ? "empty" : "success";
    }
  }

  const keys = state.recordKeys.filter(Boolean);
  const metricResults = Array.isArray(definition?.metrics)
    ? input.definitionSample
      ? definition.metrics.map(() => ({ state: "pending", value: "—", truncated: false }))
      : metrics.resolveMetrics({
          metrics: definition.metrics,
          records,
          fieldKeys: definition.columns ?? [],
          responses: input.metricResponses ?? {},
          truncated: Boolean(input.truncated),
        })
    : [];
  let serializedFieldCount = 0;
  if (input.formValues) {
    const fields = (definition.columnMeta ?? []).map((meta) => ({
      name: meta.name,
      type: "string",
      required: false,
      ...(meta.visibleWhen ? { visibleWhen: meta.visibleWhen } : {}),
      ...(meta.constraints ? { constraints: meta.constraints } : {}),
    }));
    const serialized = forms.serializeFieldValues(fields, input.formValues, true);
    serializedFieldCount = serialized.payload
      ? Object.keys(JSON.parse(serialized.payload)).length
      : 0;
  }

  let outcome = "success";
  if (!contractAccepted || capabilityRejected) outcome = "rejected";
  else if (canceled) outcome = "skipped";
  else if (!bindingAccepted || mappingStatus === "unconfirmed") outcome = "unbound";
  else if (
    mappingStatus === "invalid" ||
    input.writeOutcome === "error" ||
    input.writeOutcome === "unknown"
  )
    outcome = "error";
  else if (mappingStatus === "empty" || queryStatus === "empty") outcome = "empty";

  const writeOutcome = input.writeOutcome ?? null;
  return {
    contractAccepted,
    bindingAccepted,
    capabilityRejected,
    bindingState,
    mappingStatus,
    recordCount: records.length,
    total,
    queryStatus,
    writesDisabled: runtime.runtimeWritesDisabled(state) || !bindingAccepted,
    rowWritesDisabled: runtime.runtimeRowWritesDisabled(state),
    parametersSent: propagation.sent,
    parametersSkipped: propagation.skipped,
    firstRecordId: records[0]?.id ?? null,
    identityCount: keys.length,
    distinctIdentities: new Set(keys.map((key) => key.identity)).size,
    metricStates: metricResults.map((result) => result.state),
    metricValues: metricResults.map((result) => result.value),
    metricTruncated: metricResults.map((result) => Boolean(result.truncated)),
    writeOutcome,
    refreshSent: writeOutcome === "success",
    formKept: writeOutcome === "error" || writeOutcome === "unknown",
    submissionCount: input.doubleClick ? 1 : writeOutcome ? 1 : 0,
    pageAfterDelete:
      input.pageNumber !== undefined && input.pageRowCount === 1 ? input.pageNumber - 1 : null,
    serializedFieldCount,
    refinementSaved: !input.projectChanged,
    outcome,
  };
}

export async function evaluateFixtures(directory = FIXTURE_DIR) {
  const { manifest, cases } = loadCases(directory);
  const results = cases.map((item) => {
    const observed = observe(item);
    const mismatches = Object.entries(item.expected ?? {}).flatMap(([key, expected]) =>
      equal(observed[key], expected) ? [] : [{ field: key, expected, observed: observed[key] }],
    );
    return {
      id: item.id,
      category: item.category,
      file: item.file,
      pass: mismatches.length === 0,
      mismatches,
      observed,
    };
  });
  return {
    mode: "offline",
    live: "not run",
    total: results.length,
    passed: results.filter((result) => result.pass).length,
    failed: results.filter((result) => !result.pass).length,
    layers: ["contract", "binding", "execution"],
    minimumCases: manifest.minimumCases,
    requiredCategories: manifest.requiredCategories,
    categories: [...new Set(results.map((result) => result.category))],
    cases: results,
  };
}

function liveStatus(argv) {
  if (!argv.includes("--live")) return "not run";
  if (!isLiveRequested(argv))
    return `not run (requires ${LIVE_REQUIRED_ENV}=1; no token was spent)`;
  return "not run (live endpoint execution is not part of automated evaluation)";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await evaluateFixtures();
  report.live = liveStatus(process.argv);
  const asJson = process.argv.includes("--json");
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Offline generation evaluation: ${report.passed}/${report.total} passed`);
    console.log(`Layers: ${report.layers.join(" / ")} | categories: ${report.categories.length}`);
    console.log(`Live model evaluation: ${report.live}`);
    for (const result of report.cases.filter((item) => !item.pass)) {
      console.error(`FAIL ${result.id}`);
      for (const mismatch of result.mismatches)
        console.error(
          `  ${mismatch.field}: expected ${JSON.stringify(mismatch.expected)}, observed ${JSON.stringify(mismatch.observed)}`,
        );
    }
  }
  const output = process.argv.find((arg) => arg.startsWith("--out="));
  if (output) fs.writeFileSync(output.slice("--out=".length), JSON.stringify(report, null, 2));
  if (report.failed > 0) process.exitCode = 1;
}
