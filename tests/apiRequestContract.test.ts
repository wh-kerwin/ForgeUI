import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelBusinessQuery,
  executeBusinessApi,
  type BusinessApiInvoke,
} from "../src/lib/tauri/businessApi";

type Invocation = { command: string; args?: Record<string, unknown> };
const apiRequest = {
  url: "https://api.example.com/items",
  method: "GET",
  headers: { accept: "application/json" },
  project_id: "project-a",
  api_document_id: "items-api",
  operation_key: "GET /items · listItems",
};

function captureInvoke(result: unknown = { status: 200, body: [] }) {
  const calls: Invocation[] = [];
  const invoke: BusinessApiInvoke = async <T>(command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    return result as T;
  };
  return { calls, invoke };
}

test("query execution nests a fresh request_id beside the buildApiRequest payload", async () => {
  const { calls, invoke } = captureInvoke();
  const ids = ["query-1", "query-2"];
  const idFactory = () => ids.shift()!;

  await executeBusinessApi(apiRequest, { invoke, kind: "query", newRequestId: idFactory });
  await executeBusinessApi(apiRequest, { invoke, kind: "query", newRequestId: idFactory });

  assert.deepEqual(calls, [
    {
      command: "execute_api",
      args: { request: { ...apiRequest, request_id: "query-1" } },
    },
    {
      command: "execute_api",
      args: { request: { ...apiRequest, request_id: "query-2" } },
    },
  ]);
  assert.notEqual(
    (calls[0].args?.request as Record<string, unknown>).request_id,
    (calls[1].args?.request as Record<string, unknown>).request_id,
  );
});

test("mutation execution omits request_id instead of reusing a query token", async () => {
  const { calls, invoke } = captureInvoke();

  await executeBusinessApi(
    { ...apiRequest, method: "POST", body: { name: "Ada" } },
    { invoke, kind: "mutation" },
  );

  assert.deepEqual(calls, [
    {
      command: "execute_api",
      args: {
        request: {
          ...apiRequest,
          method: "POST",
          body: { name: "Ada" },
        },
      },
    },
  ]);
  assert.equal("request_id" in (calls[0].args?.request as object), false);
});

test("mutation strips an actual query ID without allocating or reusing a cancellation token", async () => {
  const { calls, invoke } = captureInvoke();
  await executeBusinessApi(apiRequest, {
    invoke,
    kind: "query",
    newRequestId: () => "old-query",
  });
  const queryPayload = calls[0].args!.request as typeof apiRequest & { request_id: string };
  let allocated = 0;
  await executeBusinessApi(
    { ...queryPayload, method: "POST" },
    {
      invoke,
      kind: "mutation",
      newRequestId: () => {
        allocated++;
        return "write-id";
      },
    },
  );
  assert.equal(calls.length, 2);
  assert.equal(allocated, 0);
  assert.equal("request_id" in (calls[1].args!.request as object), false);
  assert.equal("request_id" in calls[1].args!, false);
  assert.equal("requestId" in calls[1].args!, false);
  assert.equal(queryPayload.request_id, "old-query", "the original query payload is unchanged");
});

test("unknown mutation rejection invokes once and is never automatically retried", async () => {
  const calls: Invocation[] = [];
  const message = "MutationOutcomeUnknown: 业务 API 请求失败；禁止自动重试";
  const invoke: BusinessApiInvoke = async (command, args) => {
    calls.push({ command, args });
    throw message;
  };
  await assert.rejects(
    executeBusinessApi({ ...apiRequest, method: "POST" }, { invoke, kind: "mutation" }),
    (error: unknown) =>
      error instanceof Error &&
      "kind" in error &&
      error.kind === "mutation-outcome-unknown" &&
      error.message === message,
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "execute_api");
  assert.equal("request_id" in (calls[0].args!.request as object), false);
});

test("query cancellation sends Tauri's camelCase top-level requestId", async () => {
  const { calls, invoke } = captureInvoke(1);

  const result = await cancelBusinessQuery("query-1", invoke);

  assert.equal(result, 1);
  assert.deepEqual(calls, [{ command: "cancel_query", args: { requestId: "query-1" } }]);
});

test("Rust cancellation and mutation uncertainty strings get distinct classifications", async () => {
  const cancelled = captureInvoke();
  cancelled.invoke = async () => {
    throw "Cancelled";
  };
  const unknownMutation = captureInvoke();
  unknownMutation.invoke = async () => {
    throw "MutationOutcomeUnknown";
  };

  await assert.rejects(
    executeBusinessApi(apiRequest, {
      invoke: cancelled.invoke,
      kind: "query",
      newRequestId: () => "q",
    }),
    (error: unknown) =>
      error instanceof Error &&
      "kind" in error &&
      error.kind === "cancelled" &&
      error.message === "Cancelled",
  );
  await assert.rejects(
    executeBusinessApi(apiRequest, { invoke: unknownMutation.invoke, kind: "mutation" }),
    (error: unknown) =>
      error instanceof Error &&
      "kind" in error &&
      error.kind === "mutation-outcome-unknown" &&
      error.message === "MutationOutcomeUnknown",
  );
});
