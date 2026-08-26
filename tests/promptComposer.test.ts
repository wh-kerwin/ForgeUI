import assert from "node:assert/strict";
import test from "node:test";
import type { AllowedOperation, ApiDocument, ModelConfig, OpenApiSummary, PromptTemplate } from "../src/types/domain";
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

function apiDocument(id: string, spec: OpenApiSummary, authorizedOperations = spec.operations): ApiDocument {
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
  const dashboard = composeModelPrompt({ prompt: "Build it", promptTemplate: promptTemplate("dashboard"), allowedOperations: operations });
  const crud = composeModelPrompt({ prompt: "Build it", promptTemplate: promptTemplate("crud"), allowedOperations: operations });
  const layerIndexes = ["【PERSONA】", "【CONSTRAINTS】", "【SCENE】", "【TEMPLATE_CONTEXT】", "【OPENAPI_CONTEXT】", "【FEW_SHOT】"]
    .map((layer) => dashboard.systemPrompt.indexOf(layer));
  assert.deepEqual([...layerIndexes].sort((left, right) => left - right), layerIndexes);
  assert.match(dashboard.systemPrompt, /trend charts/);
  assert.match(dashboard.systemPrompt, /"chartType":"line"/);
  assert.match(crud.systemPrompt, /create, update, and delete/);
  assert.match(crud.systemPrompt, /layout to full by default/);
  assert.match(crud.systemPrompt, /explicitly requests modal\/dialog interaction/);
  assert.match(crud.systemPrompt, /copy apiDocumentId/);
  assert.doesNotMatch(crud.systemPrompt, /"chartType":"line"/);
  assert.equal(dashboard.prompt, "Build it");
});

test("operation role inference distinguishes list, detail, mutations, and export", () => {
  const roles = inferOperationRoles([...operations, { operation_id: "export_devices", method: "GET", path: "/devices/export" }]);
  assert.deepEqual(roles.list_devices, ["list", "stat"]);
  assert.deepEqual(roles.get_device, ["detail"]);
  assert.deepEqual(roles.create_device, ["create"]);
  assert.deepEqual(roles.update_device, ["update"]);
  assert.deepEqual(roles.delete_device, ["delete"]);
  assert.deepEqual(roles.export_devices, ["list", "stat", "export"]);
});

test("built-in presets cover B2B operations and consumer modal scenes", () => {
  const ids = new Set(BUILT_IN_PROMPT_TEMPLATES.map((template) => template.id));
  for (const id of ["inventory", "crm", "approval", "shop", "content", "social"]) assert.ok(ids.has(id), `missing preset ${id}`);
  for (const scene of ["shop", "content", "social"] as const) {
    const composed = composeModelPrompt({ prompt: "Build it", promptTemplate: promptTemplate(scene), allowedOperations: operations });
    assert.match(composed.systemPrompt, /"detail":"modal"/);
    assert.match(composed.systemPrompt, scene === "social" ? /"theme":"minimal-dark"/ : /"theme":"clean-light"/);
  }
});

test("model request preserves protocol fields and keeps composed prompt below backend limit", () => {
  const model: ModelConfig = {
    id: "model", name: "Model", protocol: "openai", baseUrl: "http://localhost", model: "test", apiKey: "", temperature: 0.2,
    maxTokens: 2048, streaming: true, enabled: true, timeoutSeconds: 30, structuredOutput: "jsonObject", customHeaders: {}, notes: "",
  };
  const spec: OpenApiSummary = {
    title: "Devices", version: "1", spec_version: "3.1", operation_count: operations.length,
    operations: operations.map((operation) => `${operation.method} ${operation.path} · ${operation.operation_id}`),
    api_base_url: "http://localhost", discovered_url: "http://localhost/openapi.json",
    fieldSchemas: { update_device: [
      { name: "status", type: "enum", enumValues: ["active", "closed"], required: true },
      { name: "reason", type: "string", required: false, visibleWhen: { field: "status", equals: "closed" } },
    ] },
  };
  const request = buildModelRequest(model, "Create a manager", [apiDocument("devices-api", spec)], undefined, promptTemplate("crud"));
  assert.equal(request.prompt, "Create a manager");
  assert.equal(request.allowed_operations.length, operations.length);
  assert.ok(request.allowed_operations.every((operation) => operation.api_document_id === "devices-api"));
  assert.ok(request.system_prompt.length < 4000, `system prompt length was ${request.system_prompt.length}`);
  assert.match(request.openapi_context ?? "", /"documents"/);
  assert.match(request.openapi_context ?? "", /"apiDocumentId":"devices-api"/);
  assert.match(request.openapi_context ?? "", /inferredRoles/);
  assert.match(request.openapi_context ?? "", /bodySchemas/);
  assert.match(request.openapi_context ?? "", /visibleWhen/);
});

test("model request includes only authorized operations from enabled selected documents", () => {
  const model: ModelConfig = {
    id: "model", name: "Model", protocol: "openai", baseUrl: "http://localhost", model: "test", apiKey: "", temperature: 0.2,
    maxTokens: 2048, streaming: true, enabled: true, timeoutSeconds: 30, structuredOutput: "jsonObject", customHeaders: {}, notes: "",
  };
  const spec: OpenApiSummary = {
    title: "Devices", version: "1", spec_version: "3.1", operation_count: operations.length,
    operations: operations.map((operation) => `${operation.method} ${operation.path} · ${operation.operation_id}`),
    api_base_url: "http://localhost", discovered_url: "http://localhost/openapi.json",
  };
  const authorized = [spec.operations[0], spec.operations[3]];
  const enabled = apiDocument("devices-api", spec, authorized);
  const secondary = apiDocument("secondary-api", spec, [spec.operations[0]]);
  const disabled = { ...apiDocument("disabled-api", spec), enabled: false };
  const request = buildModelRequest(model, "Create a manager", [enabled, secondary, disabled]);

  assert.deepEqual(request.allowed_operations, [
    { api_document_id: "devices-api", operation_id: "list_devices", method: "GET", path: "/devices" },
    { api_document_id: "devices-api", operation_id: "update_device", method: "PATCH", path: "/devices/{id}" },
    { api_document_id: "secondary-api", operation_id: "list_devices", method: "GET", path: "/devices" },
  ]);
  const context = JSON.parse(request.openapi_context ?? "{}") as { documents?: { apiDocumentId: string }[] };
  assert.deepEqual(context.documents?.map((document) => document.apiDocumentId), ["devices-api", "secondary-api"]);
  assert.doesNotMatch(request.openapi_context ?? "", /disabled-api/);
  assert.doesNotMatch(request.openapi_context ?? "", /create_device/);
});
