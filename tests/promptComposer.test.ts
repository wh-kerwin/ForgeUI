import assert from "node:assert/strict";
import test from "node:test";
import type {
  AllowedOperation,
  ApiDocument,
  ModelConfig,
  OpenApiSummary,
  PromptTemplate,
} from "../src/types/domain";
import { inferOperationRoles } from "../src/features/connections/openApiOperations";
import { buildModelRequest } from "../src/features/workbench/modelRequest";
import { composeModelPrompt } from "../src/features/workbench/PromptComposer";
import { BUILT_IN_PROMPT_TEMPLATES } from "../src/features/workbench/promptTemplates";

const operations: AllowedOperation[] = [
  { operation_id: "list_devices", method: "GET", path: "/devices" },
  { operation_id: "get_device", method: "GET", path: "/devices/{id}" },
  { operation_id: "create_device", method: "POST", path: "/devices" },
  { operation_id: "update_device", method: "PATCH", path: "/devices/{id}" },
  { operation_id: "delete_device", method: "DELETE", path: "/devices/{id}" },
];

function promptTemplate(scene: PromptTemplate["scene"]): PromptTemplate {
  return { id: scene, name: scene, scene, systemPrompt: `Custom ${scene} guidance` };
}

function apiDocument(
  id: string,
  spec: OpenApiSummary,
  authorizedOperations = spec.operations,
): ApiDocument {
  return {
    id,
    projectId: "project-1",
    name: `${spec.title} API`,
    enabled: true,
    spec,
    auth: { type: "none", secretRef: "", apiKeyName: "", caPem: "", authorizedOperations },
    createdAt: "2026-08-26T00:00:00Z",
    updatedAt: "2026-08-26T00:00:00Z",
  };
}

test("composer keeps layers ordered and differentiates dashboard from CRUD", () => {
  const dashboard = composeModelPrompt({
    prompt: "Build it",
    promptTemplate: promptTemplate("dashboard"),
    allowedOperations: operations,
  });
  const crud = composeModelPrompt({
    prompt: "Build it",
    promptTemplate: promptTemplate("crud"),
    allowedOperations: operations,
  });
  const layerIndexes = [
    "【PERSONA】",
    "【CONSTRAINTS】",
    "【SCENE】",
    "【TEMPLATE_CONTEXT】",
    "【OPENAPI_CONTEXT】",
    "【FEW_SHOT】",
  ].map((layer) => dashboard.systemPrompt.indexOf(layer));
  assert.deepEqual(
    [...layerIndexes].sort((left, right) => left - right),
    layerIndexes,
  );
  assert.match(dashboard.systemPrompt, /bound metrics|trend/);
  assert.doesNotMatch(dashboard.systemPrompt, /"chartType":"line"/);
  assert.match(crud.systemPrompt, /Host actions: read, create, update, delete/);
  assert.match(crud.systemPrompt, /Missing mutations are explained/);
  assert.doesNotMatch(crud.systemPrompt, /"chartType":"line"/);
  assert.equal(dashboard.prompt, "Build it");
});

test("operation role inference distinguishes list, detail, mutations, and export", () => {
  const roles = inferOperationRoles([
    ...operations,
    { operation_id: "export_devices", method: "GET", path: "/devices/export" },
  ]);
  assert.deepEqual(roles.list_devices, ["list"]);
  assert.deepEqual(roles.get_device, ["detail"]);
  assert.deepEqual(roles.create_device, ["create"]);
  assert.deepEqual(roles.update_device, ["update"]);
  assert.deepEqual(roles.delete_device, ["delete"]);
  assert.deepEqual(roles.export_devices, ["list", "export"]);
});

test("built-in presets expose only business capabilities and keep legacy scenes constrained", () => {
  const ids = new Set(BUILT_IN_PROMPT_TEMPLATES.map((template) => template.id));
  for (const id of ["query", "crud", "report", "dashboard"]) assert.ok(ids.has(id));
  for (const id of ["shop", "content", "social"]) assert.ok(!ids.has(id));
  const legacy = composeModelPrompt({
    prompt: "Build it",
    promptTemplate: promptTemplate("social"),
    allowedOperations: operations,
  });
  assert.doesNotMatch(legacy.systemPrompt, /consumer community|activity feeds/);
  assert.match(legacy.systemPrompt, /Only bind/);
});

test("model request preserves protocol fields and keeps composed prompt below backend limit", () => {
  const model: ModelConfig = {
    id: "model",
    name: "Model",
    protocol: "openai",
    baseUrl: "http://localhost",
    model: "test",
    apiKey: "",
    temperature: 0.2,
    maxTokens: 2048,
    streaming: true,
    enabled: true,
    timeoutSeconds: 30,
    structuredOutput: "jsonObject",
    customHeaders: {},
    notes: "",
  };
  const spec: OpenApiSummary = {
    title: "Devices",
    version: "1",
    spec_version: "3.1",
    operation_count: operations.length,
    operations: operations.map(
      (operation) => `${operation.method} ${operation.path} · ${operation.operation_id}`,
    ),
    api_base_url: "http://localhost",
    discovered_url: "http://localhost/openapi.json",
    fieldSchemas: {
      update_device: [
        { name: "status", type: "enum", enumValues: ["active", "closed"], required: true },
        {
          name: "reason",
          type: "string",
          required: false,
          visibleWhen: { field: "status", equals: "closed" },
        },
      ],
    },
  };
  const request = buildModelRequest(
    model,
    "Create a manager",
    [apiDocument("devices-api", spec)],
    undefined,
    promptTemplate("crud"),
  );
  assert.equal(request.prompt, "Create a manager");
  assert.equal(request.allowed_operations.length, operations.length);
  assert.ok(
    request.allowed_operations.every((operation) => operation.api_document_id === "devices-api"),
  );
  assert.ok(
    request.system_prompt.length < 4000,
    `system prompt length was ${request.system_prompt.length}`,
  );
  const context = JSON.parse(request.openapi_context ?? "{}") as {
    operations: { apiDocumentId: string; operation_id: string }[];
  };
  assert.ok(
    context.operations.some(
      (item) => item.apiDocumentId === "devices-api" && item.operation_id === "list_devices",
    ),
  );
  assert.ok(request.system_prompt.includes(request.openapi_context ?? ""));
  assert.ok(request.system_prompt.length <= 3900);
});

test("model request includes operation schemas scoped to each document without exposing connection secrets", () => {
  const model: ModelConfig = {
    id: "model",
    name: "Model",
    protocol: "openai",
    baseUrl: "https://model.example/private",
    model: "test",
    apiKey: "model-secret",
    temperature: 0.2,
    maxTokens: 2048,
    streaming: true,
    enabled: true,
    timeoutSeconds: 30,
    structuredOutput: "jsonObject",
    customHeaders: {},
    notes: "",
  };
  const sharedOperation = "POST /records · saveRecord";
  const firstSpec: OpenApiSummary = {
    title: "First",
    version: "1",
    spec_version: "3.1",
    operation_count: 2,
    operations: [sharedOperation, "GET /records · listRecords"],
    api_base_url: "https://first.example/private-api",
    discovered_url: "https://first.example/openapi.json",
    fieldSchemas: {
      saveRecord: [{ name: "firstOnly", type: "string", required: true }],
    },
    queryParameters: { saveRecord: ["firstFilter"] },
  };
  const secondSpec: OpenApiSummary = {
    ...firstSpec,
    title: "Second",
    api_base_url: "https://second.example/private-api",
    fieldSchemas: {
      saveRecord: [{ name: "secondOnly", type: "integer", required: true }],
    },
    queryParameters: { saveRecord: ["secondFilter"] },
  };
  const request = buildModelRequest(model, "Build record editor", [
    apiDocument("first-document", firstSpec),
    apiDocument("second-document", secondSpec),
  ]);
  const context = JSON.parse(request.openapi_context ?? "{}") as {
    operations: {
      apiDocumentId: string;
      operation_id: string;
      bodySchemas?: { name: string }[];
      queryParameters?: string[];
    }[];
  };

  assert.deepEqual(
    context.operations.filter((operation) => operation.operation_id === "saveRecord"),
    [
      {
        apiDocumentId: "first-document",
        operation_id: "saveRecord",
        method: "POST",
        path: "/records",
        bodySchemas: [{ name: "firstOnly", type: "string", required: true }],
        queryParameters: ["firstFilter"],
        suggested_roles: ["create"],
      },
      {
        apiDocumentId: "second-document",
        operation_id: "saveRecord",
        method: "POST",
        path: "/records",
        bodySchemas: [{ name: "secondOnly", type: "integer", required: true }],
        queryParameters: ["secondFilter"],
        suggested_roles: ["create"],
      },
    ],
  );
  assert.match(request.system_prompt, /firstOnly/);
  assert.match(request.system_prompt, /secondOnly/);
  assert.doesNotMatch(
    request.system_prompt + request.openapi_context,
    /first\.example|second\.example|model-secret/,
  );
});

test("model request returns prompt-composition diagnostics", () => {
  const model: ModelConfig = {
    id: "model",
    name: "Model",
    protocol: "openai",
    baseUrl: "http://localhost",
    model: "test",
    apiKey: "",
    temperature: 0.2,
    maxTokens: 2048,
    streaming: true,
    enabled: true,
    timeoutSeconds: 30,
    structuredOutput: "jsonObject",
    customHeaders: {},
    notes: "",
  };
  const spec: OpenApiSummary = {
    title: "Large schema",
    version: "1",
    spec_version: "3.1",
    operation_count: 2,
    operations: ["POST /records · createRecord", "GET /records · listRecords"],
    api_base_url: "http://localhost/private-api",
    discovered_url: "http://localhost/openapi.json",
    fieldSchemas: {
      createRecord: [
        { name: "payload", type: "string", required: true, description: "x".repeat(5000) },
      ],
    },
  };
  const request = buildModelRequest(model, "Build record editor", [
    apiDocument("large-document", spec),
  ]);

  assert.deepEqual(request.prompt_diagnostics, [
    {
      code: "prompt_budget",
      message:
        "已按请求资源优先级保留 1 个完整授权操作，另有 1 个因预算省略；未省略项保留 apiDocumentId。",
    },
  ]);
});

test("model request includes only authorized operations from enabled selected documents", () => {
  const model: ModelConfig = {
    id: "model",
    name: "Model",
    protocol: "openai",
    baseUrl: "http://localhost",
    model: "test",
    apiKey: "",
    temperature: 0.2,
    maxTokens: 2048,
    streaming: true,
    enabled: true,
    timeoutSeconds: 30,
    structuredOutput: "jsonObject",
    customHeaders: {},
    notes: "",
  };
  const spec: OpenApiSummary = {
    title: "Devices",
    version: "1",
    spec_version: "3.1",
    operation_count: operations.length,
    operations: operations.map(
      (operation) => `${operation.method} ${operation.path} · ${operation.operation_id}`,
    ),
    api_base_url: "http://localhost",
    discovered_url: "http://localhost/openapi.json",
  };
  const authorized = [spec.operations[0], spec.operations[3]];
  const enabled = apiDocument("devices-api", spec, authorized);
  const secondary = apiDocument("secondary-api", spec, [spec.operations[0]]);
  const disabled = { ...apiDocument("disabled-api", spec), enabled: false };
  const request = buildModelRequest(model, "Create a manager", [enabled, secondary, disabled]);

  assert.deepEqual(request.allowed_operations, [
    {
      api_document_id: "devices-api",
      operation_id: "list_devices",
      method: "GET",
      path: "/devices",
    },
    {
      api_document_id: "devices-api",
      operation_id: "update_device",
      method: "PATCH",
      path: "/devices/{id}",
    },
    {
      api_document_id: "secondary-api",
      operation_id: "list_devices",
      method: "GET",
      path: "/devices",
    },
  ]);
  const context = JSON.parse(request.openapi_context ?? "{}") as {
    operations: { apiDocumentId?: string; operation_id: string }[];
  };
  assert.ok(
    context.operations.some(
      (operation) =>
        operation.apiDocumentId === "devices-api" && operation.operation_id === "list_devices",
    ),
  );
  assert.ok(
    context.operations.some(
      (operation) =>
        operation.apiDocumentId === "secondary-api" && operation.operation_id === "list_devices",
    ),
  );
  assert.doesNotMatch(request.openapi_context ?? "", /disabled-api/);
  assert.doesNotMatch(request.openapi_context ?? "", /create_device/);
});
