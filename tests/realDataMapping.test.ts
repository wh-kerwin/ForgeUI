import assert from "node:assert/strict";
import test from "node:test";
import { mapRealDataResponse } from "../src/store/realDataMapping";

test("maps every row by column name when object key order changes", () => {
  assert.deepEqual(mapRealDataResponse([
    { id: 1, name: "Alpha" },
    { name: "Beta", id: 2 },
  ]), {
    columns: ["id", "name"],
    rows: [["1", "Alpha"], ["2", "Beta"]],
  });
});

test("fills missing cells and includes later first-seen columns", () => {
  assert.deepEqual(mapRealDataResponse({ data: [
    { id: 1, name: "Alpha" },
    { id: 2, status: "active" },
  ] }), {
    columns: ["id", "name", "status"],
    rows: [["1", "Alpha", ""], ["2", "", "active"]],
  });
});

test("unwraps nested common pagination containers", () => {
  assert.deepEqual(mapRealDataResponse({ data: { records: [{ id: 7 }] } }), { columns: ["id"], rows: [["7"]] });
  assert.deepEqual(mapRealDataResponse({ content: ["one", "two"] }), { columns: ["value"], rows: [["one"], ["two"]] });
  assert.equal(mapRealDataResponse({ results: [] }), null);
});

test("keeps mapped data within PageSpec row and column limits", () => {
  const records = Array.from({ length: 110 }, (_, index) => Object.fromEntries(Array.from({ length: 55 }, (__, column) => [`c${column}`, index + column])));
  const mapped = mapRealDataResponse({ items: records });
  assert.equal(mapped?.columns.length, 50);
  assert.equal(mapped?.rows.length, 100);
  assert.equal(mapped?.rows[1][1], "2");
});
