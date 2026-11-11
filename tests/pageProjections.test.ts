import assert from "node:assert/strict";
import test from "node:test";
import type { PageSpec } from "../src/types/domain";
import {
  DEFAULT_PAGE_CONTRACT_VERSION,
  MAX_EXPORT_COLUMNS,
  MAX_EXPORT_ROWS,
  PROJECTION_ENTRYPOINTS,
  V2_WRITE_ENABLED,
  csvSafe,
  defaultWriteVersion,
  forDiagnostic,
  forModel,
  forSession,
  forTemplate,
  projectArtifact,
  sessionPromptPolicy,
  toExportDataset,
} from "../src/features/pages/contracts/pageProjections";

const MARKER = "secret-marker";

function pollutedPage(): PageSpec {
  const page: PageSpec = {
    version: 1,
    title: "Orders",
    description: "Order list",
    createdAt: "2026-11-10",
    filters: ["status"],
    stats: [{ label: "total", value: `${MARKER}-stat` }],
    columns: ["id", "amount"],
    columnMeta: [{ name: "id", type: "string", enumLabels: { a: "A" } }],
    rows: [[`${MARKER}-row`, "20.5"]],
    operations: [
      {
        operation_id: "listOrders",
        method: "GET",
        path: "/orders",
        role: "list",
        apiDocumentId: `${MARKER}-doc`,
      },
    ],
    views: [{ type: "list", title: "List" }],
    batchActions: [
      {
        operation_id: "batchDelete",
        method: "DELETE",
        path: "/orders/batch",
        payloadBuilder: { type: "custom", customPayload: `${MARKER}-payload` },
      },
    ],
    styleTokens: { primary: "#abc" },
  };
  return Object.assign(page, {
    headers: { Authorization: `${MARKER}-header` },
    draft: `${MARKER}-draft`,
    secretRef: `${MARKER}-secret`,
    baseUrl: `https://${MARKER}.invalid`,
    sampleResponse: [{ id: `${MARKER}-sample` }],
  });
}

function assertNoMarker(value: unknown) {
  assert.equal(JSON.stringify(value).includes(MARKER), false);
}

test("model, template, session and diagnostic outputs never carry injected data", () => {
  const page = pollutedPage();
  for (const output of [forModel(page), forTemplate(page), forSession(page), forDiagnostic(page)]) {
    assertNoMarker(output);
  }
});

test("projection keeps structure while dropping data, custom payloads and environment bindings", () => {
  const page = pollutedPage();
  const result = projectArtifact(page, "template");
  assertNoMarker(result.document);
  assert.equal(result.document.title, "Orders");
  assert.deepEqual(result.document.columns, ["id", "amount"]);
  assert.equal(result.document.createdAt, "2026-11-10");
  assert.equal(
    (result.document.operations as Array<Record<string, unknown>>)[0].operation_id,
    "listOrders",
  );
  assert.equal(
    (result.document.operations as Array<Record<string, unknown>>)[0].apiDocumentId,
    undefined,
  );
  const builder = (result.document.batchActions as Array<Record<string, unknown>>)[0]!
    .payloadBuilder as Record<string, unknown>;
  assert.equal(builder.customPayload, undefined);
  assert.equal(builder.type, "ids");
  assert.deepEqual((forTemplate(page) as PageSpec).rows, []);
  assert.deepEqual((forTemplate(page) as PageSpec).stats, []);
  assertNoMarker(result.dropped);
  assertNoMarker(result.issues);
});

test("model context omits timestamps but template and session history keep them", () => {
  const page = pollutedPage();
  assert.equal((forModel(page) as Record<string, unknown>).createdAt, undefined);
  assert.equal((forTemplate(page) as Record<string, unknown>).createdAt, "2026-11-10");
  assert.equal((forSession(page) as Record<string, unknown>).createdAt, "2026-11-10");
});

test("diagnostics contain only counts, stable codes and structural paths", () => {
  const diagnostic = forDiagnostic(pollutedPage()) as {
    version: number;
    droppedFields: string[];
    issues: string[];
    structure: Record<string, number>;
  };
  assert.equal(diagnostic.version, 1);
  assert.equal(diagnostic.structure.columns, 2);
  assert.equal(diagnostic.structure.operations, 1);
  assert.ok(diagnostic.droppedFields.includes("/rows"));
  assert.ok(diagnostic.issues.includes("projection.rows_dropped"));
  assert.ok(diagnostic.issues.includes("projection.environment_binding_dropped"));
  assertNoMarker(diagnostic);
  assert.equal(JSON.stringify(diagnostic).includes("Orders"), false);
});

test("unknown fields, oversized text and arrays are bounded and reported", () => {
  const page = pollutedPage() as unknown as Record<string, unknown>;
  page.unknownField = MARKER;
  page.title = `${MARKER}-${"x".repeat(600)}`;
  page.columns = Array.from({ length: 60 }, (_, index) => `c${index}`);
  const result = projectArtifact(page, "template");
  assertNoMarker(result.document);
  assert.equal((result.document.columns as string[]).length, 50);
  assert.equal(result.document.title, undefined);
  assert.ok(result.issues.includes("projection.text_limit"));
  assert.ok(result.issues.includes("projection.unknown_field_dropped"));
  assert.equal(
    result.dropped.some((path) => path.includes("unknownField")),
    false,
  );
  assert.equal(JSON.stringify(forDiagnostic(page)).includes("unknownField"), false);
  assert.ok(result.issues.includes("projection.array_limit"));
});

test("session prompts are explicitly bounded and never declared inherently safe", () => {
  const short = sessionPromptPolicy("查询订单");
  assert.equal(short.value, "查询订单");
  assert.equal(short.truncated, false);
  assert.match(short.note, /可能包含敏感内容/);
  const long = sessionPromptPolicy(MARKER.repeat(4000));
  assert.equal(long.truncated, true);
  assert.ok(new TextEncoder().encode(long.value).length <= 8 * 1024);
});

test("export dataset carries only display values, an explicit scope and bounded cells", () => {
  const dataset = toExportDataset({
    title: "Orders",
    columns: ["id", "amount"],
    rows: [
      ["1", "=1+1"],
      ["2", MARKER.repeat(2000)],
    ],
    scope: "current-page",
  });
  assert.equal(dataset.scope, "current-page");
  assert.match(dataset.scopeNote, /当前已加载页/);
  assert.ok(dataset.rows[1][1].length < MARKER.repeat(2000).length);
  assert.equal("page" in dataset, false);
  assert.equal("stats" in dataset, false);
  const wide = toExportDataset({
    title: "Orders",
    columns: Array.from({ length: MAX_EXPORT_COLUMNS + 5 }, (_, index) => `c${index}`),
    rows: Array.from({ length: MAX_EXPORT_ROWS + 5 }, () => ["1"]),
    scope: "definition-sample",
    zh: false,
  });
  assert.equal(wide.columns.length, MAX_EXPORT_COLUMNS);
  assert.equal(wide.rows.length, MAX_EXPORT_ROWS);
  assert.equal(wide.rows[0].length, MAX_EXPORT_COLUMNS);
  assert.match(wide.scopeNote, /Definition sample/);
});

test("csv-safe values neutralise spreadsheet formula prefixes", () => {
  assert.equal(csvSafe("=1+1"), "'=1+1");
  assert.equal(csvSafe("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvSafe("-5"), "'-5");
  assert.equal(csvSafe("普通文本"), "普通文本");
});

test("default v2 writing stays behind the explicit gate with a complete entry list", () => {
  assert.equal(V2_WRITE_ENABLED, false);
  assert.equal(defaultWriteVersion(), DEFAULT_PAGE_CONTRACT_VERSION);
  assert.equal(DEFAULT_PAGE_CONTRACT_VERSION, 1);
  for (const entry of [
    "model.generate",
    "model.refine",
    "frontend.parse",
    "rust.validate",
    "template.save",
    "template.versionRestore",
    "template.importExport",
    "generationSession",
    "dataExport",
  ] as const) {
    assert.ok(PROJECTION_ENTRYPOINTS.includes(entry));
  }
});
