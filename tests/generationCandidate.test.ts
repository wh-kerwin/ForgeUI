import assert from "node:assert/strict";
import test from "node:test";
import { validateGenerationCandidate } from "../src/features/workbench/generationCandidate";
import type { PageSpec } from "../src/types/domain";
import type { RuntimeOperation } from "../src/features/pages/pageOperations";

const operations: RuntimeOperation[] = [
  {
    key: "GET /orders · listOrders",
    method: "GET",
    path: "/orders",
    operationId: "listOrders",
    apiDocumentId: "orders",
  },
];
const page: PageSpec = {
  title: "Orders",
  description: "",
  filters: [],
  stats: [],
  columns: ["id"],
  rows: [],
  operations: [
    {
      operation_id: "listOrders",
      method: "GET",
      path: "/orders",
      role: "list",
      apiDocumentId: "orders",
    },
  ],
};

test("generation candidate preserves a valid authorized binding", () => {
  const result = validateGenerationCandidate(page, "订单列表", operations);
  assert.deepEqual(result.operations, page.operations);
});

test("generation candidate rejects unknown version before commit", () => {
  assert.throws(
    () => validateGenerationCandidate({ ...page, version: 99 }, "订单列表", operations),
    (error: unknown) => {
      assert.equal((error as { retryable: boolean }).retryable, false);
      assert.ok((error as { issues: unknown[] }).issues.length);
      assert.equal((error as { issues: { path: string }[] }).issues[0].path, "/version");
      return true;
    },
  );
});

test("generation candidate rejects implied binding replacement without mutating input", () => {
  const candidate: PageSpec = {
    ...page,
    operations: [
      {
        operation_id: "listCustomers",
        method: "GET",
        path: "/customers",
        role: "list",
        apiDocumentId: "customers",
      },
    ],
  };
  const before = JSON.stringify(candidate);
  assert.throws(
    () => validateGenerationCandidate(candidate, "订单列表", operations),
    (error: unknown) => {
      assert.equal((error as { issues: { stage: string }[] }).issues[0].stage, "binding");
      assert.equal((error as { issues: { path: string }[] }).issues[0].path, "/operations");
      return true;
    },
  );
  assert.equal(JSON.stringify(candidate), before);
});
