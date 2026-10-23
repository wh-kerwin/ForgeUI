import assert from "node:assert/strict";
import test from "node:test";
import {
  mapRealDataResponse,
  MAX_MAPPED_ROWS,
  MAX_MAPPED_COLUMNS,
} from "../src/store/realDataMapping";
import { recordId } from "../src/features/pages/recordIdentity";

test("maps every row by column name when object key order changes", () => {
  assert.deepEqual(
    mapRealDataResponse([
      { id: 1, name: "Alpha" },
      { name: "Beta", id: 2 },
    ]),
    {
      status: "mapped",
      columns: ["id", "name"],
      rows: [
        ["1", "Alpha"],
        ["2", "Beta"],
      ],
    },
  );
});

test("fills missing cells and includes later first-seen columns", () => {
  assert.deepEqual(
    mapRealDataResponse({
      data: [
        { id: 1, name: "Alpha" },
        { id: 2, status: "active" },
      ],
    }),
    {
      status: "mapped",
      columns: ["id", "name", "status"],
      rows: [
        ["1", "Alpha", ""],
        ["2", "", "active"],
      ],
    },
  );
});

test("promotes the real record ID even when the API serializes it after display fields", () => {
  const mapped = mapRealDataResponse([
    { category: "电子产品", description: "Apple", id: 81, name: "iPhone" },
  ]);
  assert.deepEqual(mapped, {
    status: "mapped",
    columns: ["id", "category", "description", "name"],
    rows: [["81", "电子产品", "Apple", "iPhone"]],
  });
  assert.equal(mapped.status, "mapped");
  if (mapped.status !== "mapped") return;
  assert.equal(recordId(mapped.columns, mapped.rows[0]), "81");
});

test("row actions refuse to treat an arbitrary first display column as an ID", () => {
  assert.equal(recordId(["category", "name"], ["电子产品", "iPhone"]), "");
  assert.equal(recordId(["category", "productId", "name"], ["电子产品", "p-81", "iPhone"]), "p-81");
});

test("unwraps nested common pagination containers and distinguishes empty from invalid", () => {
  assert.deepEqual(mapRealDataResponse({ data: { records: [{ id: 7 }] } }), {
    status: "mapped",
    columns: ["id"],
    rows: [["7"]],
  });
  assert.deepEqual(mapRealDataResponse({ content: ["one", "two"] }), {
    status: "mapped",
    columns: ["value"],
    rows: [["one"], ["two"]],
  });
  assert.deepEqual(mapRealDataResponse([]), { status: "empty", total: 0 });
  assert.deepEqual(mapRealDataResponse({ data: { items: [], total: 0 } }), {
    status: "empty",
    total: 0,
  });
  assert.deepEqual(mapRealDataResponse({ results: [] }), { status: "empty", total: 0 });
  assert.deepEqual(mapRealDataResponse({ unexpected: true }), { status: "invalid" });
});

test("keeps an API pagination total for the generated page pager", () => {
  assert.deepEqual(mapRealDataResponse({ data: [{ id: 7 }], total: 42 }), {
    status: "mapped",
    columns: ["id"],
    rows: [["7"]],
    total: 42,
  });
});

test("keeps mapped data within PageSpec row and column limits", () => {
  const records = Array.from({ length: 110 }, (_, index) =>
    Object.fromEntries(Array.from({ length: 55 }, (__, column) => [`c${column}`, index + column])),
  );
  const mapped = mapRealDataResponse({ items: records });
  assert.equal(mapped.status, "mapped");
  if (mapped.status !== "mapped") return;
  assert.equal(mapped.columns.length, MAX_MAPPED_COLUMNS);
  assert.equal(mapped.rows.length, MAX_MAPPED_ROWS);
  assert.equal(mapped.rows[1][1], "2");
  assert.equal(mapped.truncated, true);
});

test("row and column truncation flags use strict upper bounds", () => {
  for (const rowCount of [100, 101]) {
    for (const columnCount of [50, 51]) {
      const records = Array.from({ length: rowCount }, () =>
        Object.fromEntries(Array.from({ length: columnCount }, (_, i) => [`field${i}`, i])),
      );
      const result = mapRealDataResponse(records);
      assert.equal(result.status, "mapped");
      if (result.status !== "mapped") return;
      assert.equal(Boolean(result.truncated), rowCount > 100 || columnCount > 50);
      assert.equal(Boolean(result.truncatedRows), rowCount > 100);
      assert.equal(Boolean(result.truncatedColumns), columnCount > 50);
    }
  }
});

test("does not set truncated flag when within limits", () => {
  const mapped = mapRealDataResponse({ items: [{ id: 1, name: "A" }] });
  assert.equal(mapped.status, "mapped");
  if (mapped.status !== "mapped") return;
  assert.equal(mapped.truncated, undefined);
});
