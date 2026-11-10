import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { responseSchemaForOperation } from "../src/features/connections/openApiOperations";
import { readPointer } from "../src/features/pages/data/jsonPointer";
import { mapResponse } from "../src/features/pages/data/responseMapping";
import { buildModelRequest } from "../src/features/workbench/modelRequest";
import type {
  ApiDocument,
  ModelConfig,
  PromptTemplate,
  ResponseBinding,
  ResponseSchemaSummary,
} from "../src/types/domain";

type ManifestCase = {
  id: string;
  spec: string;
  operation: string;
  itemsPointer: string | null;
  totalPointer: string | null;
  rowKeyPointer: string | null;
  fieldPointers: string[];
  sampleResponse: unknown;
  expected: {
    status: "mapped" | "empty" | "invalid";
    recordCount: number;
    total?: number;
    keys: string[];
    writable: boolean;
  };
};

const manifest = JSON.parse(
  readFileSync(new URL("../contracts/fixtures/openapi/manifest.json", import.meta.url), "utf8"),
) as { cases: ManifestCase[] };

const POINTER_PATTERN = /^(?:\/(?:[^~/]|~0|~1)*)*$/;

function bindingFor(entry: ManifestCase): ResponseBinding {
  return {
    operationKey: entry.operation,
    // An unresolved summary must never silently guess an envelope.
    itemsPointer: entry.itemsPointer ?? "/__unresolved__",
    ...(entry.totalPointer ? { totalPointer: entry.totalPointer } : {}),
    rowKeyPointer: entry.rowKeyPointer ?? "/__unresolved__",
    fieldPointers: entry.fieldPointers,
    confirmed: true,
  };
}

for (const entry of manifest.cases) {
  test(`shared OpenAPI fixture ${entry.id} maps deterministically`, () => {
    for (const pointer of [
      entry.itemsPointer,
      entry.totalPointer,
      entry.rowKeyPointer,
      ...entry.fieldPointers,
    ]) {
      if (pointer !== null) assert.match(pointer, POINTER_PATTERN);
    }
    const binding = bindingFor(entry);
    const result = mapResponse(entry.sampleResponse, binding);
    assert.equal(result.status, entry.expected.status);
    assert.equal(result.records.length, entry.expected.recordCount);
    assert.equal(result.total, entry.expected.total);
    assert.deepEqual(
      result.keys.map((key) => key?.identity ?? null),
      entry.expected.keys,
    );
    assert.equal(result.writable, entry.expected.writable);
    assert.deepEqual(mapResponse(entry.sampleResponse, binding), result);
    assert.equal(
      JSON.stringify(result.issues).includes("sample-"),
      false,
      "diagnostics must not carry sample values",
    );
  });
}

test("shared 3.1 fixture keeps raw types and RFC6901 escaped field pointers", () => {
  const entry = manifest.cases.find((item) => item.spec === "orders-3.1.json");
  assert.ok(entry);
  const result = mapResponse(entry.sampleResponse, bindingFor(entry));
  assert.equal(result.records[0].id, "001");
  assert.equal(result.records[1].id, 1);
  assert.equal(typeof result.records[0].amount, "number");
  assert.equal(typeof result.records[1]["~key"], "boolean");
  const first = result.records[0];
  assert.equal(readPointer(first, "/a~1b").value, "sample-a");
  assert.equal(readPointer(first, "/~0key").value, true);
  assert.equal(readPointer(first, "/a~2b").issue, "pointer.syntax");
  assert.equal(readPointer(first, "/__proto__").issue, "pointer.unsafe");
});

function summaryFor(operationKey: string, itemsPointer: string): ResponseSchemaSummary {
  return {
    operationKey,
    operationId: operationKey.split(" · ")[1] ?? "",
    itemsPointer,
    itemsPointerOrigin: "schema",
    totalPointer: null,
    totalPointerOrigin: "unresolved",
    rowKeyPointer: "/id",
    rowKeyPointerOrigin: "schema",
    fields: [],
    issues: [],
  };
}

const OPERATION = "GET /orders · listOrders";
function documentFor(id: string, itemsPointer: string): ApiDocument {
  return {
    id,
    projectId: "project",
    name: id,
    enabled: true,
    spec: {
      title: id,
      version: "1.0.0",
      spec_version: "3.1.0",
      operation_count: 1,
      operations: [OPERATION],
      api_base_url: "https://example.test",
      discovered_url: "https://example.test/openapi.json",
      responseSchemas: { listOrders: summaryFor(OPERATION, itemsPointer) },
    },
    auth: {
      type: "none",
      secretRef: "",
      apiKeyName: "",
      caPem: "",
      authorizedOperations: [OPERATION],
    },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

test("response summaries are scoped by document and full operation key", () => {
  const documents = [documentFor("doc-a", "/docA/items"), documentFor("doc-b", "/docB/items")];
  assert.equal(responseSchemaForOperation(documents, "doc-a", OPERATION)?.itemsPointer, "/docA/items");
  assert.equal(responseSchemaForOperation(documents, "doc-b", OPERATION)?.itemsPointer, "/docB/items");
  assert.equal(responseSchemaForOperation(documents, "doc-b", "GET /archived · other"), undefined);
  assert.equal(responseSchemaForOperation(documents, undefined, OPERATION), undefined);
  assert.equal(responseSchemaForOperation(documents, "missing-doc", OPERATION), undefined);
  assert.equal(responseSchemaForOperation([], "doc-a", OPERATION), undefined);
});

// C2 keeps response summaries client-side: the real v1 model request must stay
// on the old context shape until C4 opens v2 as the default. buildOpenApiContext
// has no production caller, so this guard targets the real generation entry.
test("response summaries and local samples never enter the real v1 model request", () => {
  const model: ModelConfig = {
    id: "model",
    name: "Test model",
    protocol: "openai",
    baseUrl: "https://model.test",
    model: "test",
    apiKey: "",
    temperature: 0.2,
    maxTokens: 2048,
    streaming: false,
    enabled: true,
    timeoutSeconds: 30,
    structuredOutput: "jsonObject",
    customHeaders: {},
    notes: "",
  };
  const promptTemplate: PromptTemplate = {
    id: "query",
    name: "查询",
    scene: "query",
    systemPrompt: "",
  };
  const request = buildModelRequest(
    model,
    "订单列表",
    [documentFor("doc-a", "/docA/items")],
    undefined,
    promptTemplate,
  );
  const serialized = JSON.stringify(request);
  assert.ok(serialized.includes("doc-a"));
  assert.equal(serialized.includes("responseSchemas"), false);
  assert.equal(serialized.includes("/docA/items"), false);
  assert.equal(serialized.includes("rowKeyPointer"), false);
  assert.equal(serialized.includes("itemsPointer"), false);
  assert.equal(serialized.includes("SENSITIVE_LOCAL_SAMPLE"), false);
});
