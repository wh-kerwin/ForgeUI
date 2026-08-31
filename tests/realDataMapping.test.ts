import assert from "node:assert/strict";
import test from "node:test";
import { mapRealDataResponse } from "../src/store/realDataMapping";
import { recordId } from "../src/features/pages/recordIdentity";

test("maps every row by column name when object key order changes", () => {
  assert.deepEqual(
    mapRealDataResponse([
      { id: 1, name: "Alpha" },
      { name: "Beta", id: 2 },
    ]),
    {
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
  assert.deepEqual(mapped?.columns, ["id", "category", "description", "name"]);
  assert.deepEqual(mapped?.rows, [["81", "电子产品", "Apple", "iPhone"]]);
  assert.equal(recordId(mapped?.columns ?? [], mapped?.rows[0] ?? []), "81");
});

test("row actions refuse to treat an arbitrary first display column as an ID", () => {
  assert.equal(recordId(["category", "name"], ["电子产品", "iPhone"]), "");
  assert.equal(recordId(["category", "productId", "name"], ["电子产品", "p-81", "iPhone"]), "p-81");
});

test("unwraps nested common pagination containers", () => {
  assert.deepEqual(mapRealDataResponse({ data: { records: [{ id: 7 }] } }), {
    columns: ["id"],
    rows: [["7"]],
  });
  assert.deepEqual(mapRealDataResponse({ content: ["one", "two"] }), {
    columns: ["value"],
    rows: [["one"], ["two"]],
  });
  assert.equal(mapRealDataResponse({ results: [] }), null);
});

test("keeps an API pagination total for the generated page pager", () => {
  assert.deepEqual(mapRealDataResponse({ data: [{ id: 7 }], total: 42 }), {
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
  assert.equal(mapped?.columns.length, 50);
  assert.equal(mapped?.rows.length, 100);
  assert.equal(mapped?.rows[1][1], "2");
});
