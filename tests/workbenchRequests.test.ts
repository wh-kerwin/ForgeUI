import assert from "node:assert/strict";
import test from "node:test";
import { createWorkbenchStore } from "../src/store/workbenchStore";
import { createRequestScope } from "../src/features/pages/requestContext";
import type { BusinessApiInvoke } from "../src/lib/tauri/businessApi";
import type { ApiDocument, PageSpec } from "../src/types/domain";

const page: PageSpec = {
  title: "Orders",
  description: "",
  filters: [],
  stats: [],
  columns: ["id"],
  rows: [["old"]],
};
const operation = {
  key: "GET /orders",
  method: "GET" as const,
  path: "/orders",
  operationId: "listOrders",
  apiDocumentId: "doc",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const pending: ReturnType<typeof deferred<{ status: number; body: unknown }>>[] = [];
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  const notices: string[] = [];
  const invoke: BusinessApiInvoke = async <T>(command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    if (command === "cancel_query") return 1 as T;
    const request = deferred<{ status: number; body: unknown }>();
    pending.push(request);
    return (await request.promise) as T;
  };
  const scope = createRequestScope({ projectId: "a", apiDocumentIds: ["doc"] });
  const store = createWorkbenchStore({ invoke, debounceMs: 0 });
  const document = {
    id: "doc",
    projectId: "a",
    name: "Orders",
    enabled: true,
    auth: { type: "none", apiBaseUrl: "http://localhost", authorizedOperations: [operation.key] },
    spec: {},
  } as ApiDocument;
  store.getState().configureApi({
    projectId: "a",
    apiDocuments: [document],
    onNotice: (notice) => notices.push(notice),
    requestScope: scope,
  });
  store.getState().setPage(page);
  return { store, scope, pending, calls, notices, document };
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("project switch blocks late query success and old finally cannot stop a new query", async () => {
  const f = fixture();
  const old = f.store.getState().query({}, operation);
  await settle();
  f.scope.update({ projectId: "b" });
  f.store.getState().configureApi({
    projectId: "b",
    apiDocuments: [{ ...f.document, projectId: "b" }],
    onNotice: (n) => f.notices.push(n),
    requestScope: f.scope,
  });
  f.store.getState().setPage({ ...page, title: "B" });
  const current = f.store.getState().query({}, operation);
  await settle();
  f.pending[0].resolve({ status: 200, body: [{ id: "old-result" }] });
  await old;
  assert.equal(f.store.getState().page?.title, "B");
  assert.equal(f.store.getState().querying, true);
  assert.deepEqual(f.notices, []);
  f.pending[1].resolve({ status: 200, body: [{ id: "new-result" }] });
  await current;
  assert.deepEqual(f.store.getState().page?.rows, [["new-result"]]);
  assert.equal(f.store.getState().querying, false);
  assert.ok(
    f.calls.some(
      (call) => call.command === "cancel_query" && typeof call.args?.requestId === "string",
    ),
  );
});

for (const dispatched of [false, true]) {
  for (const invalid of [
    "missing operation",
    "unauthorized operation",
    "missing service URL",
  ] as const) {
    test(`invalid replacement (${invalid}, dispatched=${dispatched}) releases cancelled query loading`, async () => {
      const f = fixture();
      const old = f.store.getState().query({}, operation);
      if (dispatched) await settle();
      const replacement =
        invalid === "missing operation"
          ? undefined
          : invalid === "unauthorized operation"
            ? { ...operation, key: "GET /forbidden" }
            : operation;
      if (invalid === "missing service URL") f.document.auth.apiBaseUrl = "";
      await f.store.getState().query({}, replacement);
      assert.equal(f.store.getState().queryMeta.status, "error");
      assert.ok(f.store.getState().queryMeta.error);
      assert.deepEqual(f.store.getState().page?.rows, []);
      assert.equal(f.store.getState().querying, false);
      assert.equal(f.store.getState().loadingState, "idle");
      if (dispatched) f.pending[0].resolve({ status: 200, body: [{ id: "obsolete" }] });
      await old;
      assert.equal(f.store.getState().queryMeta.status, "error");
      assert.deepEqual(f.store.getState().page?.rows, []);
      assert.equal(f.store.getState().loadingState, "idle");
    });
  }
}

test("invalid query replacement releases querying without clearing concurrent mutation loading", async () => {
  const f = fixture();
  const old = f.store.getState().query({}, operation);
  await settle();
  const writeOperation = { ...operation, key: "POST /orders", method: "POST" as const };
  f.document.auth.authorizedOperations!.push(writeOperation.key);
  const write = f.store.getState().mutate(writeOperation, "{}");
  await f.store.getState().query();
  assert.equal(f.store.getState().querying, false);
  assert.equal(f.store.getState().loadingState, "mutating");
  assert.equal(f.store.getState().mutationStatus, "submitting");
  f.pending[0].resolve({ status: 200, body: [{ id: "obsolete" }] });
  await old;
  assert.equal(f.store.getState().loadingState, "mutating");
  f.pending[1].resolve({ status: 200, body: {} });
  await write;
  assert.equal(f.store.getState().loadingState, "idle");
  assert.equal(f.store.getState().queryMeta.status, "error");
});

test("authorization revocation immediately invalidates detail and error continuations", async () => {
  const f = fixture();
  const detail = f.store.getState().loadDetail({ ...operation, path: "/orders/{id}" }, "1");
  f.scope.update({ authorizationRevision: 1 });
  f.pending[0].resolve({ status: 200, body: { id: "secret" } });
  await detail;
  assert.equal(f.store.getState().detail, null);
  assert.deepEqual(f.notices, []);
});

test("successful empty response clears previous rows and total; invalid response is an error", async () => {
  const f = fixture();
  const filters = { status: "待处理", page: "3", pageSize: "25" };
  for (const [body, status, rows, total] of [
    [{ items: [{ id: 7 }], total: 99 }, "success", [["7"]], 99],
    [{ data: { items: [], total: 0 } }, "empty", [], 0],
    [{ items: [{ id: 8 }], total: 51 }, "success", [["8"]], 51],
    [{ unrelated: true }, "error", [], undefined],
    [[{ id: 9 }], "success", [["9"]], undefined],
  ] as const) {
    const request = f.store.getState().query(filters, operation);
    assert.equal(f.store.getState().queryMeta.status, "loading");
    assert.equal(f.store.getState().querying, true);
    await settle();
    f.pending[f.pending.length - 1]!.resolve({ status: 200, body });
    await request;
    assert.equal(f.store.getState().queryMeta.status, status);
    assert.deepEqual(f.store.getState().page?.rows, rows);
    assert.equal(f.store.getState().queryMeta.total, total);
    assert.equal(f.store.getState().querying, false);
    assert.equal(f.store.getState().loadingState, "idle");
    assert.deepEqual(filters, { status: "待处理", page: "3", pageSize: "25" });
    const payload = f.calls[f.calls.length - 1]!.args!.request as { url: string };
    assert.deepEqual(Object.fromEntries(new URL(payload.url).searchParams), filters);
    if (status === "error") assert.ok(f.store.getState().queryMeta.error);
    else assert.equal(f.store.getState().queryMeta.error, undefined);
  }
});

test("query transport error clears stale data and explicit retry preserves filters and pagination", async () => {
  const f = fixture();
  const filters = { status: "open", page: "4", pageSize: "20" };
  const failed = f.store.getState().query(filters, operation);
  await settle();
  f.pending[0].reject("业务 API 请求失败");
  await failed;
  assert.equal(f.store.getState().queryMeta.status, "error");
  assert.deepEqual(f.store.getState().page?.rows, []);
  assert.equal(f.store.getState().queryMeta.total, undefined);
  assert.equal(f.store.getState().querying, false);
  assert.equal(f.store.getState().loadingState, "idle");
  await settle();
  assert.equal(f.pending.length, 1, "a failed query must not retry itself");

  const retried = f.store.getState().query(filters, operation);
  await settle();
  const requests = f.calls.filter((call) => call.command === "execute_api");
  assert.equal(requests.length, 2);
  for (const call of requests) {
    const payload = call.args!.request as { url: string };
    assert.deepEqual(Object.fromEntries(new URL(payload.url).searchParams), filters);
  }
  f.pending[1].resolve({ status: 200, body: { items: [{ id: "retry" }], total: 81 } });
  await retried;
  assert.equal(f.store.getState().queryMeta.status, "success");
  assert.equal(f.store.getState().queryMeta.error, undefined);
  assert.equal(f.store.getState().queryMeta.total, 81);
  assert.deepEqual(f.store.getState().page?.rows, [["retry"]]);
  assert.equal(f.store.getState().querying, false);
  assert.equal(f.store.getState().loadingState, "idle");
});

for (const method of ["POST", "DELETE"] as const) {
  test(`${method} interruption stays unknown with one invoke and no automatic retry`, async () => {
    const f = fixture();
    const writeOperation = { ...operation, key: `${method} /orders`, method };
    f.document.auth.authorizedOperations!.push(writeOperation.key);
    const write =
      method === "DELETE"
        ? f.store.getState().deleteRecord(writeOperation, "1", true)
        : f.store.getState().mutate(writeOperation, '{"name":"Ada"}');
    assert.equal(f.store.getState().mutationStatus, "submitting");
    assert.equal(f.store.getState().loadingState, "mutating");
    assert.equal(f.pending.length, 1);
    f.pending[0].reject("MutationOutcomeUnknown: 业务 API 请求超时；禁止自动重试");
    await write;
    await settle();
    await settle();
    assert.equal(f.store.getState().mutationStatus, "unknown");
    assert.equal(f.store.getState().loadingState, "idle");
    assert.equal(f.store.getState().querying, false);
    assert.equal(f.calls.length, 1, "unknown writes must not retry or refresh automatically");
    assert.equal(f.calls[0].command, "execute_api");
    assert.equal("request_id" in (f.calls[0].args!.request as object), false);
    assert.deepEqual(f.notices, ["写入结果尚未确认，请先刷新核对服务端状态，勿直接重试。"]);
    assert.deepEqual(f.store.getState().page?.rows, page.rows);
  });
}

test("preview mode prevents query, detail and mutation dispatch", async () => {
  const f = fixture();
  f.store.getState().setExecutionMode("preview");
  await f.store.getState().query({}, operation);
  await f.store.getState().loadDetail(operation, "1");
  await f.store.getState().mutate({ ...operation, method: "POST" }, "{}");
  await f.store.getState().deleteRecord({ ...operation, method: "DELETE" }, "1", true);
  assert.equal(f.calls.length, 0);
});

test("changing the definition blocks an old query error and resets its loading", async () => {
  const f = fixture();
  const request = f.store.getState().query({}, operation);
  await settle();
  f.store.getState().setPage({ ...page, title: "Replacement" });
  f.pending[0].reject("old error");
  await request;
  assert.equal(f.store.getState().page?.title, "Replacement");
  assert.equal(f.store.getState().loadingState, "idle");
  assert.deepEqual(f.notices, []);
});
