import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { DataBindingPanel } from "../../src/features/pages/DataBindingPanel";
import type { ApiDocument, ResponseBinding } from "../../src/types/domain";

// No mock of responseMapping here: this file verifies the panel against the
// REAL mapper, complementing dataBindingPanel.test.tsx's controlled stub.
const OPERATION = "GET /orders · listOrders";
const apiDocument: ApiDocument = {
  id: "doc-1",
  projectId: "project",
  name: "订单API",
  enabled: true,
  spec: {
    title: "订单API",
    version: "1.0.0",
    spec_version: "3.1.0",
    operation_count: 1,
    operations: [OPERATION],
    api_base_url: "https://example.test",
    discovered_url: "https://example.test/openapi.json",
    responseSchemas: {
      listOrders: {
        operationKey: OPERATION,
        operationId: "listOrders",
        itemsPointer: "/data/items",
        itemsPointerOrigin: "schema",
        totalPointer: "/data/total",
        totalPointerOrigin: "schema",
        rowKeyPointer: "/id",
        rowKeyPointerOrigin: "schema",
        fields: [
          { pointer: "/id", name: "ID", type: "string" },
          { pointer: "/amount", name: "金额", type: "number" },
        ],
        issues: [],
      },
    },
  },
  auth: {
    type: "none",
    secretRef: "",
    apiKeyName: "",
    caPem: "",
    authorizedOperations: [OPERATION],
  },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const binding: ResponseBinding = {
  apiDocumentId: "doc-1",
  operationKey: OPERATION,
  itemsPointer: "/data/items",
  totalPointer: "/data/total",
  rowKeyPointer: "/id",
  fieldPointers: ["/id", "/amount"],
  confirmed: true,
};

const sample = {
  data: {
    items: [
      { id: "001", amount: 10.5, secret: "SECRET_SAMPLE_VALUE_9F3" },
      { id: 1, amount: 20, secret: "SECRET_SAMPLE_VALUE_9F4" },
      { id: "001", amount: 30.25, secret: "SECRET_SAMPLE_VALUE_9F5" },
    ],
    total: 3,
  },
};

it("renders real duplicate-id diagnostics without exposing sample values", () => {
  render(
    <DataBindingPanel
      documents={[apiDocument]}
      binding={binding}
      onChange={() => {}}
      sample={sample}
    />,
  );
  const preview = screen.getByLabelText("本地样本预览");
  expect(preview.textContent).toContain("映射状态：mapped");
  expect(preview.textContent).toContain("记录数：3");
  expect(preview.textContent).toContain("总数：3");
  expect(preview.textContent).toContain("record.key_duplicate");
  expect(preview.textContent).toContain("写入已禁用");
  expect(window.document.body.textContent).not.toContain("SECRET_SAMPLE_VALUE");
  expect(window.document.body.innerHTML).not.toContain("SECRET_SAMPLE_VALUE");
});

it("treats an empty total pointer as unresolved instead of reporting a bogus total error", () => {
  render(
    <DataBindingPanel
      documents={[apiDocument]}
      binding={{ ...binding, totalPointer: "" }}
      onChange={() => {}}
      sample={sample}
    />,
  );
  const preview = screen.getByLabelText("本地样本预览");
  expect(preview.textContent).toContain("总数：未提供");
  expect(preview.textContent).not.toContain("response.total_invalid");
});
