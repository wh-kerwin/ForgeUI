import assert from "node:assert/strict";
import test from "node:test";
import { previewPageSpec } from "../src/features/pages/streamingPageParser";

test("preview projection strips both operations and batch actions without changing the source", () => {
  const source = {
    title: "草稿",
    columns: ["id"],
    rows: [["1"]],
    operations: [{ operation_id: "list", method: "GET", path: "/orders", role: "list" }],
    batchActions: [
      {
        operation_id: "delete",
        method: "DELETE",
        path: "/orders",
        payloadBuilder: { type: "ids" },
      },
    ],
  } as const;
  const input = JSON.parse(JSON.stringify(source));
  const preview = previewPageSpec(input);
  assert.equal(preview.operations, undefined);
  assert.equal(preview.batchActions, undefined);
  assert.deepEqual(input, source);
  assert.deepEqual(preview.rows, [["1"]]);
});
