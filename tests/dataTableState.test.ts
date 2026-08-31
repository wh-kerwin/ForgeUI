import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataTablePath = path.join(root, "src/features/pages/DataTable.tsx");

async function loadDataTableStateHelpers() {
  const result = await build({
    entryPoints: [dataTablePath],
    bundle: true,
    format: "cjs",
    jsx: "automatic",
    packages: "external",
    platform: "node",
    write: false,
  });
  const module = { exports: {} as Record<string, unknown> };
  const evaluate = new Function("module", "exports", "require", result.outputFiles[0].text);
  evaluate(module, module.exports, createRequire(import.meta.url));
  return module.exports as {
    reconcileColumnOrder: (current: number[], indexes: readonly number[]) => number[];
    reconcileHiddenColumns: (
      current: Set<number>,
      indexes: readonly number[],
      defaultHiddenIndexes: readonly number[],
    ) => Set<number>;
  };
}

test("DataTable column reconciliation does not schedule equivalent state updates", async () => {
  const { reconcileColumnOrder, reconcileHiddenColumns } = await loadDataTableStateHelpers();
  const order = [0, 1];
  const hidden = new Set([1]);

  assert.strictEqual(reconcileColumnOrder(order, [0, 1]), order);
  assert.strictEqual(reconcileHiddenColumns(hidden, [0, 1], [1]), hidden);

  assert.deepEqual(reconcileColumnOrder(order, [1, 0, 2]), [0, 1, 2]);
  assert.deepEqual([...reconcileHiddenColumns(hidden, [0], [])], []);
});

test("DataTable optional collection defaults use stable module constants", async () => {
  const source = await readFile(dataTablePath, "utf8");
  assert.doesNotMatch(source, /columnMeta\s*=\s*\[\]/);
  assert.doesNotMatch(source, /batchActions\s*=\s*\[\]/);
  assert.doesNotMatch(source, /selectedRows\s*=\s*new Set\(\)/);
});
