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
import {
  composeModelPrompt,
  PromptCompositionError,
} from "../src/features/workbench/PromptComposer";
import { BUILT_IN_PROMPT_TEMPLATES } from "../src/features/workbench/promptTemplates";
import {
  BUSINESS_CAPABILITY_CATALOG,
  capabilityForScene,
  capabilityViewTypes,
  defaultPromptTemplates,
} from "../src/features/pages/capabilities/businessCapabilityCatalog";
import { PAGE_HOST_ACTIONS, PAGE_VIEW_RENDERERS } from "../src/features/pages/viewCapabilities";

const promptTemplate = (scene: PromptTemplate["scene"]): PromptTemplate => ({
  id: scene,
  name: scene,
  scene,
  systemPrompt: `Custom ${scene} guidance`,
});

function document(
  id: string,
  operations: string[],
  fieldSchemas: NonNullable<OpenApiSummary["fieldSchemas"]> = {},
): ApiDocument {
  const spec: OpenApiSummary = {
    title: id,
    version: "1",
    spec_version: "3.1",
    operation_count: operations.length,
    operations,
    api_base_url: "http://localhost",
    discovered_url: "http://localhost/openapi.json",
    fieldSchemas,
  };
  return {
    id,
    projectId: "project",
    name: id,
    enabled: true,
    spec,
    auth: {
      type: "none",
      secretRef: "",
      apiKeyName: "",
      caPem: "",
      authorizedOperations: operations,
    },
    createdAt: "now",
    updatedAt: "now",
  };
}

const model: ModelConfig = {
  id: "m",
  name: "Model",
  protocol: "openai",
  baseUrl: "http://localhost",
  model: "m",
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

test("business capability catalog covers the four supported scenes", () => {
  assert.deepEqual(
    BUSINESS_CAPABILITY_CATALOG.map((item) => item.id),
    ["query", "crud", "report", "dashboard"],
  );
});

test("ability views/actions share the actual renderer and host registry", () => {
  for (const capability of BUSINESS_CAPABILITY_CATALOG) {
    for (const view of capabilityViewTypes(capability)) assert.ok(PAGE_VIEW_RENDERERS[view]);
    for (const action of capability.hostActions) assert.ok(PAGE_HOST_ACTIONS.has(action));
  }
  assert.deepEqual(Object.keys(PAGE_VIEW_RENDERERS).sort(), [
    "chart",
    "kanban",
    "list",
    "split",
    "tabs",
  ]);
});

test("scene lookup does not expose consumer scenes", () => {
  assert.equal(capabilityForScene("shop"), undefined);
  assert.equal(capabilityForScene("dashboard")?.id, "dashboard");
});

test("dashboard model requests accept an explicitly bound stat operation", () => {
  const stats = document("stats", ["GET /metrics/stats · getStats"]);
  assert.doesNotThrow(() =>
    buildModelRequest(model, "统计看板", [stats], undefined, promptTemplate("dashboard")),
  );
});
test("dashboard requires a stat role while exposing a current-page aggregation alternative", () => {
  const dashboard = BUSINESS_CAPABILITY_CATALOG.find((item) => item.id === "dashboard")!;
  const hasStat = (ops: AllowedOperation[]) =>
    Object.values(inferOperationRoles(ops)).some((roles) => roles.includes("stat"));
  const stat = { operation_id: "get_kpis", method: "GET" as const, path: "/metrics/stats" };
  const ordinaryList = { operation_id: "list_orders", method: "GET" as const, path: "/orders" };
  assert.equal(hasStat([stat]), true);
  assert.equal(hasStat([ordinaryList]), false);
  assert.deepEqual(dashboard.requiredOperationRoles, ["stat"]);
  assert.deepEqual(dashboard.aggregateAlternative, { scope: "currentPage", label: "当前加载结果" });
});

test("resource budget keeps complete relevant operations and document identity", () => {
  const ops: AllowedOperation[] = [
    ...Array.from({ length: 20 }, (_, i) => ({
      operation_id: `list_customer_archive_${i}`,
      method: "GET" as const,
      path: `/customers/archive/${i}`,
      api_document_id: "archive-doc",
    })),
    { operation_id: "list_orders", method: "GET", path: "/orders", api_document_id: "orders-doc" },
  ];
  const result = composeModelPrompt({
    prompt: "订单列表",
    promptTemplate: promptTemplate("query"),
    allowedOperations: ops,
  });
  const block = result.systemPrompt.match(/【OPENAPI_CONTEXT】\n([^\n]+)/)?.[1];
  assert.ok(block);
  const parsed = JSON.parse(block);
  assert.ok(
    parsed.operations.some(
      (op: { operation_id: string; apiDocumentId: string }) =>
        op.operation_id === "list_orders" && op.apiDocumentId === "orders-doc",
    ),
    JSON.stringify(parsed),
  );
  assert.ok(parsed.omitted > 0);
  assert.ok(result.diagnostics.some((item) => item.code === "prompt_budget"));
  assert.ok(result.systemPrompt.length <= 3900);
});

test("required scene capability gaps fail before model invocation and expose no secret data", () => {
  const listOnly = document("orders", ["GET /orders · listOrders"]);
  assert.throws(
    () =>
      buildModelRequest(
        model,
        "Create and delete orders",
        [listOnly],
        undefined,
        promptTemplate("crud"),
      ),
    (error: unknown) => {
      assert.ok(error instanceof PromptCompositionError);
      assert.equal(error.code, "capability_gap");
      assert.match(error.message, /新增|编辑|删除/);
      assert.doesNotMatch(error.message, /api-key|secret|localhost|listOrders/);
      return true;
    },
  );
});

test("oversized templates are rejected as complete structures, never substring-truncated", () => {
  const large = {
    title: "Orders",
    description: "x".repeat(1500),
    filters: [],
    stats: [],
    columns: ["id"],
    rows: [],
  } as never;
  assert.throws(
    () => composeModelPrompt({ prompt: "orders", template: large, allowedOperations: [] }),
    (error: unknown) => error instanceof PromptCompositionError && error.code === "template_budget",
  );
});

test("default capability prompts exclude consumer scenes while custom legacy templates remain readable", () => {
  const defaults = defaultPromptTemplates();
  assert.deepEqual(
    defaults.map((item) => item.id),
    ["query", "crud", "report", "dashboard"],
  );
  assert.ok(defaults.every((item) => item.isDefault));
  assert.ok(
    BUILT_IN_PROMPT_TEMPLATES.every((item) =>
      ["query", "crud", "report", "dashboard"].includes(item.scene),
    ),
  );
  const legacy = composeModelPrompt({
    prompt: "orders",
    promptTemplate: "旧风格",
    allowedOperations: [],
  });
  assert.match(legacy.systemPrompt, /Additional scene direction \(not authority\)/);
});
