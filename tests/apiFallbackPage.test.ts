import assert from "node:assert/strict";
import test from "node:test";
import { createApiFallbackPage, isPageSpecGenerationError } from "../src/features/workbench/apiFallbackPage";
import type { ApiDocument } from "../src/types/domain";

const listKey = "GET /employees · listEmployees";
const createKey = "POST /employees · createEmployee";
const updateKey = "PATCH /employees/{id} · updateEmployee";
const deleteKey = "DELETE /employees/{id} · deleteEmployee";

function document(overrides: Partial<ApiDocument> = {}): ApiDocument {
  return {
    id: "employees-api",
    projectId: "project-a",
    name: "Employee API",
    enabled: true,
    spec: {
      title: "Employees",
      version: "1",
      spec_version: "3.0.3",
      operation_count: 4,
      operations: [listKey, createKey, updateKey, deleteKey],
      api_base_url: "http://localhost:3000",
      discovered_url: "local-file",
      fieldSchemas: {
        createEmployee: [
          { name: "name", type: "string", required: true },
          { name: "status", type: "enum", enumValues: ["active", "inactive"], required: true },
        ],
        updateEmployee: [{ name: "age", type: "integer", required: false }],
      },
    },
    auth: {
      type: "none",
      secretRef: "",
      apiKeyName: "",
      caPem: "",
      authorizedOperations: [listKey, createKey, updateKey, deleteKey],
    },
    createdAt: "2026-08-26T00:00:00Z",
    updatedAt: "2026-08-26T00:00:00Z",
    ...overrides,
  };
}

test("fallback page binds every authorized operation to its selected API document", () => {
  const page = createApiFallbackPage("生成员工管理界面", [
    document({ auth: { ...document().auth, authorizedOperations: [listKey, updateKey] } }),
    document({ id: "disabled-api", enabled: false }),
  ]);

  assert.equal(page.title, "生成员工管理界面");
  assert.deepEqual(page.operations, [
    { apiDocumentId: "employees-api", operation_id: "listEmployees", method: "GET", path: "/employees", role: "list" },
    {
      apiDocumentId: "employees-api",
      operation_id: "updateEmployee",
      method: "PATCH",
      path: "/employees/{id}",
      role: "update",
      bodySchema: [{ name: "age", type: "integer", required: false }],
    },
  ]);
  assert.ok(page.operations?.every((operation) => operation.apiDocumentId !== "disabled-api"));
  assert.deepEqual(page.rows, []);
  assert.deepEqual(page.stats, []);
  assert.deepEqual(page.views, [{ type: "list", title: "数据列表" }]);
});

test("fallback columns come only from authorized operation schemas and retain an id column", () => {
  const page = createApiFallbackPage("", [document({
    auth: { ...document().auth, authorizedOperations: [createKey, updateKey] },
  })]);

  assert.equal(page.title, "Employees 管理");
  assert.deepEqual(page.columns, ["id", "name", "status", "age"]);
  assert.deepEqual(page.filters, ["name", "status", "age"]);
  assert.deepEqual(page.columnMeta, [
    { name: "id", type: "string", sortable: true, filterable: false },
    { name: "name", type: "string", sortable: true, filterable: true },
    {
      name: "status",
      type: "enum",
      sortable: true,
      filterable: true,
      enumLabels: { active: "active", inactive: "inactive" },
    },
    { name: "age", type: "number", sortable: true, filterable: true },
  ]);
});

test("fallback narrows an order request to the matching selected API document", () => {
  const customer = document({
    id: "customers-api",
    name: "Customer API",
    spec: { ...document().spec, title: "Customers", operations: ["GET /customers · listCustomers"] },
    auth: { ...document().auth, authorizedOperations: ["GET /customers · listCustomers"] },
  });
  const order = document({
    id: "orders-api",
    name: "Order API",
    spec: { ...document().spec, title: "Orders", operations: ["GET /orders · listOrders"] },
    auth: { ...document().auth, authorizedOperations: ["GET /orders · listOrders"] },
  });

  const page = createApiFallbackPage("生成订单管理界面", [customer, order]);
  assert.deepEqual(page.operations, [{ apiDocumentId: "orders-api", operation_id: "listOrders", method: "GET", path: "/orders", role: "list" }]);
  assert.match(page.description, /Orders/);
  assert.doesNotMatch(page.description, /Customers/);
});

test("fallback refuses unsupported resources instead of producing an unrelated page", () => {
  assert.throws(() => createApiFallbackPage("生成供应商管理界面", [document()]), /已停止生成/);
});

test("fallback remains usable with no schemas and does not mutate imported field metadata", () => {
  const source = document();
  const before = structuredClone(source.spec.fieldSchemas);
  const noSchema = document({ spec: { ...source.spec, fieldSchemas: undefined } });

  assert.deepEqual(createApiFallbackPage("", [noSchema]).columns, ["id"]);
  const page = createApiFallbackPage("", [source]);
  page.operations?.find((operation) => operation.operation_id === "createEmployee")?.bodySchema?.[1].enumValues?.push("pending");
  assert.deepEqual(source.spec.fieldSchemas, before);
});

test("fallback error detection accepts streaming, JSON decoding, and PageSpec validation failures", () => {
  assert.equal(isPageSpecGenerationError("流式模型响应不完整，未生成可执行页面"), true);
  assert.equal(isPageSpecGenerationError("模型输出不符合 PageSpec：模型输出 JSON 无法修复"), true);
  assert.equal(isPageSpecGenerationError(new Error("模型响应不是 JSON：expected value")), true);
  assert.equal(isPageSpecGenerationError({ message: "PageSpec 行列数量不一致" }), true);
  assert.equal(isPageSpecGenerationError("不支持的 PageSpec 版本"), true);

  assert.equal(isPageSpecGenerationError("请求模型超时"), false);
  assert.equal(isPageSpecGenerationError("HTTP 401: invalid API key"), false);
  assert.equal(isPageSpecGenerationError(new Error("Network error")), false);
  assert.equal(isPageSpecGenerationError({ code: "INVALID_JSON" }), false);
});
