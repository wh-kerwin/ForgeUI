import assert from "node:assert/strict";
import test from "node:test";
import type { PageSpec, RecordKey } from "../src/types/domain";
import {
  applyQueryCancelled,
  applyQueryFailure,
  applyQueryResult,
  applyQueryUnbound,
  beginQuery,
  clearRuntime,
  createPageRuntimeState,
  RUNTIME_MAX_COLUMNS,
  RUNTIME_MAX_RECORDS,
  runtimeRowWritesDisabled,
  runtimeWritesDisabled,
  setRuntimeBinding,
  setRuntimeControls,
  setRuntimeSelection,
  type PageRuntimeState,
} from "../src/features/pages/runtime/pageRuntimeState";
import {
  displayCell,
  queryMetaFromRuntime,
  runtimeFromV1Definition,
  selectBatchIds,
  selectDisplayColumns,
  selectDisplayRows,
  selectPaginationTotal,
  selectRowWritesDisabled,
  selectRuntimeDiagnostics,
  selectScopeLabel,
  selectSelectedIndexes,
  selectStats,
  selectWritesDisabled,
} from "../src/features/pages/runtime/runtimeSelectors";

function definition(overrides: Partial<PageSpec> = {}): PageSpec {
  return {
    title: "Orders",
    description: "",
    filters: [],
    stats: [],
    columns: ["id", "amount"],
    rows: [
      ["a", "20"],
      ["b", "100"],
    ],
    ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

function successful(records: Record<string, unknown>[] = [{ id: 7 }]): PageRuntimeState {
  return applyQueryResult(createPageRuntimeState("ctx"), {
    records,
    columns: ["id"],
    rowKeyPointer: "/id",
  });
}

test("query state machine covers idle, loading, success, empty, error and cancelled", () => {
  const idle = createPageRuntimeState("ctx");
  assert.equal(idle.query.status, "idle");
  assert.equal(idle.source, "none");
  const loading = beginQuery(idle, "request-1", { page: 3, pageSize: 25 });
  assert.equal(loading.query.status, "loading");
  assert.equal(loading.query.requestId, "request-1");
  assert.equal(loading.query.page, 3);
  assert.equal(loading.query.pageSize, 25);

  const success = applyQueryResult(loading, {
    records: [{ id: 1 }],
    columns: ["id"],
    rowKeyPointer: "/id",
  });
  assert.equal(success.query.status, "success");
  assert.equal(success.source, "query");
  assert.equal(success.stale, false);
  const empty = applyQueryResult(loading, {
    records: [],
    columns: ["id"],
    total: 0,
    rowKeyPointer: "/id",
  });
  assert.equal(empty.query.status, "empty");
  assert.equal(empty.total, 0);

  const failed = applyQueryFailure(success, { code: "runtime.query.failed", message: "超时" });
  assert.equal(failed.query.status, "error");
  assert.equal(failed.error?.message, "超时");
  const cancelled = applyQueryCancelled(loading);
  assert.equal(cancelled.query.status, "cancelled");
  const unbound = applyQueryUnbound(idle, { code: "runtime.binding.unbound", message: "未绑定" });
  assert.equal(unbound.query.status, "error");
  assert.equal(unbound.unbound, true);
});

test("runtime keeps raw JSON values; display rows never mutate records", () => {
  const raw = { id: 1, amount: 20.5, active: false, meta: { k: "v" } };
  deepFreeze(raw);
  const state = applyQueryResult(createPageRuntimeState("ctx"), {
    records: [raw],
    columns: ["id", "amount", "active", "meta"],
    rowKeyPointer: "/id",
  });
  assert.equal(typeof state.records[0].amount, "number");
  assert.equal(state.records[0].amount, 20.5);
  assert.equal(state.records[0].active, false);
  assert.deepEqual(state.records[0].meta, { k: "v" });
  assert.deepEqual(selectDisplayRows(state, definition()), [["1", "20.5", "false", '{"k":"v"}']]);
  assert.equal(state.records[0].amount, 20.5, "raw value must survive display formatting");
  assert.equal(displayCell(null), "");
  assert.equal(displayCell(false), "false");
});

test("frozen page definitions are never written to by runtime helpers", () => {
  const page = deepFreeze(definition({ stats: [{ label: "总订单", value: "12" }] }));
  const v1 = runtimeFromV1Definition(page);
  assert.deepEqual(selectDisplayRows(v1, page), page.rows);
  assert.deepEqual(selectDisplayColumns(v1, page), page.columns);
  const queried = applyQueryResult(v1, {
    records: [{ id: 99 }],
    columns: ["id"],
    rowKeyPointer: "/id",
  });
  selectDisplayRows(queried, page);
  assert.deepEqual(page.rows, [
    ["a", "20"],
    ["b", "100"],
  ]);
  assert.deepEqual(page.columns, ["id", "amount"]);
  assert.deepEqual(page.stats, [{ label: "总订单", value: "12" }]);
});

test("total unknown stays undefined; zero is preserved and never guessed from rows", () => {
  const state = successful([{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.equal(state.total, undefined);
  assert.equal(selectPaginationTotal(state), undefined);
  assert.ok(state.diagnostics.some((item) => item.code === "runtime.total.unknown"));
  const zero = applyQueryResult(state, {
    records: [{ id: 1 }],
    columns: ["id"],
    total: 0,
    rowKeyPointer: "/id",
  });
  assert.equal(selectPaginationTotal(zero), 0);
});

test("record and column bounds are strict and explicitly reported", () => {
  const records = Array.from({ length: 101 }, (_, index) => ({ id: index }));
  const columns = Array.from({ length: 51 }, (_, index) => `c${index}`);
  const state = applyQueryResult(createPageRuntimeState("ctx"), {
    records,
    columns,
    rowKeyPointer: "/id",
  });
  assert.equal(state.records.length, RUNTIME_MAX_RECORDS);
  assert.equal(state.columns.length, RUNTIME_MAX_COLUMNS);
  assert.ok(state.diagnostics.some((item) => item.code === "runtime.result.truncated"));
  const exact = applyQueryResult(createPageRuntimeState("ctx"), {
    records: Array.from({ length: 100 }, (_, index) => ({ id: index })),
    columns: Array.from({ length: 50 }, (_, index) => `c${index}`),
    rowKeyPointer: "/id",
  });
  assert.equal(exact.records.length, 100);
  assert.equal(exact.columns.length, 50);
  assert.equal(
    exact.diagnostics.some((item) => item.code === "runtime.result.truncated"),
    false,
  );
});

test("a failed query keeps old data only with an explicit stale flag and disabled writes", () => {
  const prior = successful([{ id: 7 }, { id: 8 }]);
  const stale = applyQueryFailure(prior, { code: "runtime.query.failed", message: "超时" });
  assert.equal(stale.stale, true);
  assert.equal(stale.records.length, 2);
  assert.equal(runtimeWritesDisabled(stale), true);
  assert.equal(runtimeRowWritesDisabled(stale), true);
  assert.equal(selectWritesDisabled(stale), true);
  assert.equal(selectRowWritesDisabled(stale), true);
  assert.equal(queryMetaFromRuntime(stale).status, "error");
  assert.equal(queryMetaFromRuntime(stale).total, undefined);
  assert.ok(queryMetaFromRuntime(stale).error?.includes("超时"));

  const cleared = applyQueryFailure(
    prior,
    { code: "runtime.query.failed", message: "超时" },
    { keepData: false },
  );
  assert.equal(cleared.stale, false);
  assert.equal(cleared.records.length, 0);
  assert.equal(cleared.source, "none");
  assert.equal(selectScopeLabel(cleared, true), "尚未加载");
});

test("unbound data sources clear data and disable writes without hiding the reason", () => {
  const prior = successful([{ id: 1 }]);
  const unbound = applyQueryUnbound(prior, {
    code: "runtime.binding.unbound",
    message: "缺少列表接口",
  });
  assert.equal(unbound.unbound, true);
  assert.equal(unbound.records.length, 0);
  assert.equal(runtimeWritesDisabled(unbound), true);
  assert.ok(unbound.diagnostics.some((item) => item.area === "binding"));
});

test("clearRuntime drops data, selection and controls but keeps the binding", () => {
  const binding = {
    operationKey: "GET /orders · listOrders",
    itemsPointer: "/data/items",
    rowKeyPointer: "/id",
    fieldPointers: ["/id"],
    confirmed: true,
  };
  let state = setRuntimeBinding(successful([{ id: 1 }, { id: 2 }]), binding);
  state = setRuntimeControls(state, { page: 4, pageSize: 30, filters: { q: "abc" } });
  state = setRuntimeSelection(state, ["number:1"]);
  assert.equal(state.selectedRowKeys.length, 1);
  const cleared = clearRuntime(state, "new-context");
  assert.equal(cleared.contextKey, "new-context");
  assert.equal(cleared.query.status, "idle");
  assert.equal(cleared.query.page, 1);
  assert.deepEqual(cleared.query.filters, {});
  assert.equal(cleared.records.length, 0);
  assert.equal(cleared.recordKeys.length, 0);
  assert.deepEqual(cleared.selectedRowKeys, []);
  assert.deepEqual(cleared.diagnostics, []);
  assert.deepEqual(cleared.binding, binding);
});

test("selection uses typed identities, never row indexes", () => {
  const state = applyQueryResult(createPageRuntimeState("ctx"), {
    records: [{ id: "001" }, { id: 1 }, { id: false }],
    columns: ["id"],
    rowKeyPointer: "/id",
  });
  assert.equal(state.recordKeys[0]?.identity, "string:001");
  assert.equal(state.recordKeys[1]?.identity, "number:1");
  assert.equal(state.recordKeys[2]?.identity, "boolean:false");
  const selected = setRuntimeSelection(state, [
    "string:001",
    "number:1",
    "number:1",
    "row-0",
    "3",
    "unknown",
  ]);
  assert.deepEqual(selected.selectedRowKeys, ["string:001", "number:1"]);
  assert.deepEqual([...selectSelectedIndexes(selected, selected.selectedRowKeys)], [0, 1]);
  assert.deepEqual(selectBatchIds(selected, [0, 1, 2]), ["001", "1", "false"]);
  assert.deepEqual([...selectSelectedIndexes(selected, ["missing-key"])], []);
});

test("duplicate or missing record ids disable row writes with stable diagnostics", () => {
  const duplicate = applyQueryResult(createPageRuntimeState("ctx"), {
    records: [{ id: 1 }, { id: 1 }],
    columns: ["id"],
    rowKeyPointer: "/id",
  });
  assert.ok(duplicate.diagnostics.some((item) => item.code === "record.key_duplicate"));
  assert.equal(runtimeRowWritesDisabled(duplicate), true);
  const missing = applyQueryResult(createPageRuntimeState("ctx"), {
    records: [{ id: 1 }, { name: "no-id" }],
    columns: ["id", "name"],
    rowKeyPointer: "/id",
  });
  assert.ok(missing.diagnostics.some((item) => item.code === "record.key_missing"));
  assert.equal(missing.recordKeys[1], null);
  assert.deepEqual(selectBatchIds(missing, [0, 1]), ["1"]);
  assert.equal(runtimeWritesDisabled(duplicate), false);
});

test("stats show no fabricated numbers and flag unparsable definition values", () => {
  const page = definition({
    stats: [
      { label: "全部订单", value: "128" },
      { label: "异常", value: "N/A" },
    ],
  });
  const idle = createPageRuntimeState("ctx");
  assert.deepEqual(
    selectStats(idle, page).map((stat) => [stat.value, stat.scope]),
    [
      ["—", "unloaded"],
      ["—", "unloaded"],
    ],
  );
  const loaded = successful([{ id: 1 }]);
  const current = selectStats(loaded, page);
  assert.ok(current.every((stat) => stat.scope === "currentPage"));
  assert.ok(current.every((stat) => stat.value === "—"));
  assert.ok(current.every((stat) => stat.note.includes("当前页")));

  const sample = selectStats(runtimeFromV1Definition(page), page);
  assert.equal(sample[1].invalid, true);
  assert.ok(
    selectRuntimeDiagnostics(runtimeFromV1Definition(page), page).some(
      (item) => item.code === "runtime.stats.format",
    ),
  );
});

test("v1 adapter provides renderer data without writing loaded rows into the definition", () => {
  const page = deepFreeze(definition({ columnMeta: [{ name: "amount", type: "number" }] }));
  const runtime = runtimeFromV1Definition(page, { status: "success", total: 9 });
  assert.equal(runtime.source, "definition");
  assert.equal(selectPaginationTotal(runtime), 9);
  assert.deepEqual(selectDisplayRows(runtime, page), page.rows);
  assert.deepEqual(selectDisplayColumns(runtime, page), page.columns);
  assert.equal(runtime.recordKeys[0]?.identity, "string:a");
  assert.deepEqual(selectBatchIds(runtime, [1]), ["b"]);
  assert.equal(queryMetaFromRuntime(runtime).total, 9);
  assert.deepEqual(page.rows, [
    ["a", "20"],
    ["b", "100"],
  ]);
});

test("queryMetaFromRuntime preserves the compatibility shape", () => {
  const state = applyQueryResult(createPageRuntimeState("ctx"), {
    records: [{ id: 1 }],
    columns: ["id"],
    total: 42,
    truncated: { rows: true, columns: false },
    rowKeyPointer: "/id",
  });
  assert.deepEqual(queryMetaFromRuntime(state), {
    status: "success",
    total: 42,
    truncated: true,
    truncatedRows: true,
    truncatedColumns: false,
  } as ReturnType<typeof queryMetaFromRuntime>);
});

test("typed record keys expose original encoded path values", () => {
  const state = successful([{ id: "a/b c" }]);
  const key: RecordKey | null = state.recordKeys[0];
  assert.equal(key?.value, "a/b c");
  assert.equal(key?.pathValue, encodeURIComponent("a/b c"));
});
