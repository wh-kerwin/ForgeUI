import assert from "node:assert/strict";
import test from "node:test";
import type { PageSpec, ResponseBinding } from "../src/types/domain";
import type { ForgeUIPageDefinitionV2 } from "../src/types/generated/pageDefinitionV2";
import {
  FORGE_TEMPLATE_V1,
  FORGE_TEMPLATE_V2,
  buildV2Envelope,
  parseTemplateEnvelope,
  previewV1Migration,
  rebindForProject,
  type OperationCandidate,
} from "../src/features/pages/contracts/migrateV1";

const MARKER = "secret-marker";
const TARGET_DOC = "target-project-doc";

function page(): PageSpec {
  return {
    version: 1,
    title: "Orders",
    description: "Order list",
    layout: "full",
    theme: "minimal-dark",
    filters: [],
    stats: [{ label: "total", value: `${MARKER}-stat` }],
    columns: ["id", "amount"],
    rows: [[`${MARKER}-row`, "20.5"]],
    operations: [
      {
        operation_id: "listOrders",
        method: "GET",
        path: "/orders",
        role: "list",
        apiDocumentId: "old-project-doc",
      },
    ],
    batchActions: [
      {
        operation_id: "batchDelete",
        method: "DELETE",
        path: "/orders/batch",
        payloadBuilder: { type: "custom", customPayload: `${MARKER}-payload` },
      },
    ],
  };
}

function binding(): ResponseBinding {
  return {
    operationKey: "GET /orders · listOrders",
    itemsPointer: "/data/items",
    totalPointer: "/data/total",
    rowKeyPointer: "/id",
    fieldPointers: ["/id", "/amount"],
    confirmed: true,
  };
}

function candidates(): OperationCandidate[] {
  return [{ id: TARGET_DOC, operation_id: "listOrders", method: "GET", path: "/orders" }];
}

function firstOperation(definition: ForgeUIPageDefinitionV2): Record<string, unknown> {
  const operations = (definition as unknown as { operations: Array<Record<string, unknown>> })
    .operations;
  assert.ok(operations[0]);
  return operations[0];
}

test("v1 and v2 envelopes parse; unknown or malformed envelopes are rejected", () => {
  const v1 = parseTemplateEnvelope(
    JSON.stringify({ format: FORGE_TEMPLATE_V1, id: "t1", name: "Orders", payload: "{}" }),
  );
  assert.equal(v1.format, FORGE_TEMPLATE_V1);
  assert.equal(v1.payload, "{}");
  const v2 = parseTemplateEnvelope(
    JSON.stringify({ format: FORGE_TEMPLATE_V2, name: "Orders", payload: { version: 2 } }),
  );
  assert.equal(v2.format, FORGE_TEMPLATE_V2);
  assert.deepEqual(v2.payload, { version: 2 });
  for (const document of [
    "not json",
    JSON.stringify({ format: "unknown", payload: "{}" }),
    JSON.stringify({ format: FORGE_TEMPLATE_V1 }),
    JSON.stringify({ format: FORGE_TEMPLATE_V1, payload: {} }),
    JSON.stringify({ format: FORGE_TEMPLATE_V2, payload: "string" }),
    "[]",
  ]) {
    assert.throws(() => parseTemplateEnvelope(document));
  }
});

test("v1 migration drops loaded rows, literal stats and custom payloads", () => {
  const result = previewV1Migration(page(), { documents: candidates(), binding: binding() });
  assert.deepEqual(result.dropped, { rows: 1, stats: 1, customPayloads: 1 });
  assert.ok(result.issues.some((issue) => issue.code === "MIGRATION_ROWS_DROPPED"));
  assert.ok(result.issues.some((issue) => issue.code === "MIGRATION_STATS_DROPPED"));
  assert.ok(result.issues.some((issue) => issue.code === "MIGRATION_CUSTOM_PAYLOAD_DROPPED"));
  assert.equal(JSON.stringify(result).includes(MARKER), false);
  assert.equal(result.canSaveV2, false, "user confirmation is required");
  assert.ok(result.definition, "a clean mapping is still previewable");
});

test("missing documents, unresolved identity and duplicate operations stay preview-only", () => {
  for (const options of [
    {},
    { documents: candidates() },
    { binding: binding(), documents: [] },
    { documents: candidates(), binding: { ...binding(), confirmed: false } },
  ]) {
    const result = previewV1Migration(page(), options);
    assert.equal(result.definition, undefined);
    assert.equal(result.canSaveV2, false);
  }
  const duplicate = page();
  duplicate.operations = [...duplicate.operations!, { ...duplicate.operations![0] }];
  const result = previewV1Migration(duplicate, {
    documents: candidates(),
    binding: binding(),
    confirmed: true,
  });
  assert.equal(result.definition, undefined);
  assert.ok(result.issues.some((issue) => issue.code === "MIGRATION_DUPLICATE_OPERATION"));
});

test("a confirmed complete mapping produces a v2 definition that round-trips", () => {
  const preview = previewV1Migration(page(), {
    documents: candidates(),
    binding: binding(),
    confirmed: true,
  });
  assert.equal(preview.canSaveV2, true);
  assert.ok(preview.definition);
  assert.equal(preview.definition.version, 2);
  assert.equal(preview.definition.title, "Orders");
  assert.equal(firstOperation(preview.definition).apiDocumentId, TARGET_DOC);
  assert.equal(preview.definition.dataSources.primary.itemsPointer, "/data/items");
  assert.equal(preview.definition.dataSources.primary.rowKeyPointer, "/id");
  assert.deepEqual(
    preview.definition.fields.map((field) => field.valuePointer),
    ["/id", "/amount"],
  );
  assert.equal(JSON.stringify(preview.definition).includes(MARKER), false);

  const envelope = buildV2Envelope(preview.definition, "Orders", "t1");
  const parsed = parseTemplateEnvelope(envelope);
  assert.equal(parsed.format, FORGE_TEMPLATE_V2);
  assert.deepEqual(parsed.payload, preview.definition);
});

test("cross-project rebinding clears old bindings and requires explicit confirmation", () => {
  const definition = previewV1Migration(page(), {
    documents: candidates(),
    binding: binding(),
    confirmed: true,
  }).definition!;
  const withEnvironment = JSON.parse(JSON.stringify(definition)) as ForgeUIPageDefinitionV2;
  const operations = (withEnvironment as unknown as { operations: Array<Record<string, unknown>> })
    .operations;
  operations[0]!.apiDocumentId = "old-project-doc";
  operations[0]!.secretRef = `${MARKER}-secret`;
  operations[0]!.baseUrl = `https://${MARKER}.invalid`;

  const unconfirmed = rebindForProject(withEnvironment, {
    candidates: candidates(),
    targetApiDocumentId: TARGET_DOC,
  });
  assert.ok(unconfirmed.issues.some((issue) => issue.code === "MIGRATION_REBIND_UNCONFIRMED"));
  assert.equal(firstOperation(unconfirmed.definition).apiDocumentId, undefined);
  assert.equal(JSON.stringify(unconfirmed).includes(MARKER), false);

  const rebound = rebindForProject(withEnvironment, {
    candidates: candidates(),
    targetApiDocumentId: TARGET_DOC,
    confirmed: true,
  });
  assert.equal(rebound.issues.length, 0);
  assert.equal(firstOperation(rebound.definition).apiDocumentId, TARGET_DOC);
  assert.equal(JSON.stringify(rebound).includes(MARKER), false);

  const noCandidate = rebindForProject(withEnvironment, {
    candidates: [],
    targetApiDocumentId: TARGET_DOC,
    confirmed: true,
  });
  assert.ok(noCandidate.issues.some((issue) => issue.code === "MIGRATION_REBIND_NO_CANDIDATE"));
  assert.equal(firstOperation(noCandidate.definition).apiDocumentId, undefined);

  const mismatched = rebindForProject(withEnvironment, {
    candidates: [{ id: TARGET_DOC, operation_id: "listOrders", method: "POST", path: "/orders" }],
    targetApiDocumentId: TARGET_DOC,
    confirmed: true,
  });
  assert.ok(mismatched.issues.some((issue) => issue.code === "MIGRATION_REBIND_MISMATCH"));
  assert.equal(firstOperation(mismatched.definition).apiDocumentId, undefined);
});
