import assert from "node:assert/strict";
import test from "node:test";
import type { ApiDocument, PageSpec } from "../src/types/domain";
import { alignListOperationWithPrompt, documentsForPrompt, operationForRole, operationKey, pageApiDocumentIds, pageOperations, runtimeOperationFromKey, runtimeOperations, type RuntimeOperation } from "../src/features/pages/pageOperations";
import { buildApiRequest, operationUrl, resolveApiDocument } from "../src/store/workbenchStore";

const key = operationKey("GET", "/employees", "listEmployees");

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
      operation_count: 1,
      operations: [key],
      api_base_url: "http://localhost:3000/",
      discovered_url: "local-file",
    },
    auth: {
      type: "none",
      secretRef: "",
      apiKeyName: "",
      caPem: "",
      apiBaseUrl: "http://localhost:3000",
      authorizedOperations: [key],
    },
    createdAt: "2026-08-26T00:00:00Z",
    updatedAt: "2026-08-26T00:00:00Z",
    ...overrides,
  };
}

const operation: RuntimeOperation = {
  key,
  method: "GET",
  path: "/employees",
  operationId: "listEmployees",
};

test("page operations preserve the API document binding", () => {
  const page = {
    title: "Employees",
    description: "",
    filters: [],
    stats: [],
    columns: [],
    rows: [],
    operations: [{
      operation_id: "listEmployees",
      method: "GET",
      path: "/employees",
      role: "list",
      apiDocumentId: "employees-api",
    }],
  } satisfies PageSpec;

  assert.deepEqual(pageOperations(page, []), [{ ...operation, apiDocumentId: "employees-api" }]);
});

test("authorized operation keys become document-scoped runtime operations", () => {
  assert.deepEqual(runtimeOperations([key], "employees-api"), [{ ...operation, apiDocumentId: "employees-api" }]);
  assert.equal(runtimeOperationFromKey("invalid", "employees-api"), null);
});

test("selected document scope repairs a unique legacy model binding", () => {
  const page = {
    title: "Employees",
    description: "",
    filters: [],
    stats: [],
    columns: [],
    rows: [],
    operations: [{ operation_id: "listEmployees", method: "GET", path: "/employees", role: "list" }],
  } satisfies PageSpec;
  const selectedOperations = runtimeOperations([key], "employees-api");

  assert.equal(operationForRole(page, selectedOperations, "list", "GET")?.apiDocumentId, "employees-api");
  assert.equal(pageOperations(page, selectedOperations)[0]?.apiDocumentId, "employees-api");
});

test("list fallback skips detail GET operations regardless of document order", () => {
  const page = { title: "Employees", description: "", filters: [], stats: [], columns: [], rows: [] } satisfies PageSpec;
  const selectedOperations = runtimeOperations([
    operationKey("GET", "/employees/{id}", "getEmployee"),
    key,
  ], "employees-api");

  assert.equal(operationForRole(page, selectedOperations, "list", "GET")?.operationId, "listEmployees");
  assert.equal(operationForRole(page, selectedOperations, "detail", "GET", true)?.operationId, "getEmployee");
});

test("an order prompt replaces a mismatched customer list binding", () => {
  const customerList: RuntimeOperation = { key: operationKey("GET", "/customers", "listCustomers"), method: "GET", path: "/customers", operationId: "listCustomers", apiDocumentId: "customer-api" };
  const orderList: RuntimeOperation = { key: operationKey("GET", "/orders", "listOrders"), method: "GET", path: "/orders", operationId: "listOrders", apiDocumentId: "order-api" };
  const page = {
    title: "订单管理",
    description: "",
    filters: [],
    stats: [],
    columns: [],
    rows: [],
    operations: [{ apiDocumentId: "customer-api", operation_id: "listCustomers", method: "GET", path: "/customers", role: "list" }],
  } satisfies PageSpec;

  const aligned = alignListOperationWithPrompt(page, "生成订单管理界面", [customerList, orderList]);
  assert.deepEqual(aligned.operations?.[0], { apiDocumentId: "order-api", operation_id: "listOrders", method: "GET", path: "/orders", role: "list" });
});

test("an explicit order request only supplies the matching selected API document", () => {
  const customers = document({ id: "customers-api", name: "Customer API", spec: { ...document().spec, title: "Customers", operations: [operationKey("GET", "/customers", "listCustomers")] } });
  const orders = document({ id: "orders-api", name: "Order API", spec: { ...document().spec, title: "Orders", operations: [operationKey("GET", "/orders", "listOrders")] } });
  assert.deepEqual(documentsForPrompt("生成订单管理", [customers, orders]).documents.map((item) => item.id), ["orders-api"]);
  assert.match(documentsForPrompt("生成库存管理", [customers, orders]).error ?? "", /没有可识别/);
});

test("a generic business resource is matched from its imported API document", () => {
  const supplier = document({
    id: "suppliers-api",
    name: "供应商 API",
    spec: { ...document().spec, title: "供应商服务", operations: [operationKey("GET", "/suppliers", "listSuppliers")] },
    auth: { ...document().auth, authorizedOperations: [operationKey("GET", "/suppliers", "listSuppliers")] },
  });

  assert.deepEqual(documentsForPrompt("生成供应商管理界面", [supplier]).documents.map((item) => item.id), ["suppliers-api"]);
  assert.match(documentsForPrompt("生成仓库管理界面", [supplier]).error ?? "", /已停止生成/);
  assert.match(documentsForPrompt("生成售后服务界面", [supplier]).error ?? "", /已停止生成/);
});

test("a more specific requested feature cannot fall back to its broader resource API", () => {
  const orders = document({
    id: "orders-api",
    name: "Order API",
    spec: { ...document().spec, title: "Orders", operations: [operationKey("GET", "/orders", "listOrders")] },
    auth: { ...document().auth, authorizedOperations: [operationKey("GET", "/orders", "listOrders")] },
  });

  assert.match(documentsForPrompt("生成订单退款界面", [orders]).error ?? "", /订单退款/);
});

test("management requests stop before generation when the matched API lacks a list endpoint", () => {
  const orders = document({
    id: "orders-api",
    name: "Order API",
    spec: { ...document().spec, title: "Orders", operations: [operationKey("GET", "/orders/{id}", "getOrder")] },
    auth: { ...document().auth, authorizedOperations: [operationKey("GET", "/orders/{id}", "getOrder")] },
  });

  assert.match(documentsForPrompt("生成订单管理界面", [orders]).error ?? "", /列表查询/);
});

test("requested CRUD actions must be present in the matched API document", () => {
  const orders = document({
    id: "orders-api",
    name: "Order API",
    spec: { ...document().spec, title: "Orders", operations: [operationKey("GET", "/orders", "listOrders")] },
    auth: { ...document().auth, authorizedOperations: [operationKey("GET", "/orders", "listOrders")] },
  });

  assert.match(documentsForPrompt("生成订单管理界面，支持新增、编辑和删除", [orders]).error ?? "", /新增、编辑、删除/);
});

test("selected document IDs remain attached when the model omits operations", () => {
  const page = { title: "Employees", description: "", filters: [], stats: [], columns: [], rows: [] } satisfies PageSpec;
  assert.deepEqual(pageApiDocumentIds(page, ["employees-api"]), ["employees-api"]);
});

test("all documents selected for generation remain attached when only one is emitted", () => {
  const page = {
    title: "Employees",
    description: "",
    filters: [],
    stats: [],
    columns: [],
    rows: [],
    operations: [{
      apiDocumentId: "employees-api",
      operation_id: "listEmployees",
      method: "GET",
      path: "/employees",
      role: "list",
    }],
  } satisfies PageSpec;
  assert.deepEqual(pageApiDocumentIds(page, ["departments-api", "employees-api"]), ["departments-api", "employees-api"]);
});

test("legacy operation resolves only when one current-project document authorizes it", () => {
  const employeeDocument = document();
  const otherProjectDocument = document({ id: "other", projectId: "project-b" });
  assert.equal(resolveApiDocument("project-a", [employeeDocument, otherProjectDocument], operation).document?.id, "employees-api");

  const ambiguous = resolveApiDocument("project-a", [employeeDocument, document({ id: "duplicate" })], operation);
  assert.match(ambiguous.error ?? "", /匹配到多个 API 文档/);
});

test("explicit bindings reject disabled, unauthorized, and cross-project documents", () => {
  const boundOperation = { ...operation, apiDocumentId: "employees-api" };
  assert.match(resolveApiDocument("project-a", [document({ enabled: false })], boundOperation).error ?? "", /已停用/);
  assert.match(resolveApiDocument("project-a", [document({ auth: { ...document().auth, authorizedOperations: [] } })], boundOperation).error ?? "", /未授权/);
  assert.match(resolveApiDocument("project-b", [document()], boundOperation).error ?? "", /找不到页面绑定/);
});

test("execute_api payload carries project and document scope without client credentials", () => {
  const employeeDocument = document();
  const boundOperation = { ...operation, apiDocumentId: employeeDocument.id };
  const url = operationUrl(employeeDocument, boundOperation.path);
  const request = buildApiRequest("project-a", employeeDocument.id, url, boundOperation);

  assert.equal(request.url, "http://localhost:3000/employees");
  assert.equal(request.project_id, "project-a");
  assert.equal(request.api_document_id, "employees-api");
  assert.equal(request.operation_key, key);
  assert.equal("secret_ref" in request, false);
  assert.equal("auth_type" in request, false);
});
