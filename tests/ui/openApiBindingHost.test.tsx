import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { OpenApiPage } from "../../src/features/openapi/OpenApiPage";
import { LanguageProvider } from "../../src/i18n/LanguageProvider";
import type { ApiDocument, BusinessAuth } from "../../src/types/domain";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";

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
        fields: [{ pointer: "/id", name: "ID", type: "string" }],
        issues: [],
      },
    },
  },
  auth: {
    type: "apiKey",
    secretRef: "secret",
    apiKeyName: "X-Api-Key",
    caPem: "",
    authorizedOperations: [OPERATION],
  },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const auth: BusinessAuth = {
  type: "apiKey",
  secretRef: "secret",
  apiKeyName: "X-Api-Key",
  caPem: "",
  authorizedOperations: [OPERATION],
};

function hostProps() {
  return {
    documents: [apiDocument],
    activeDocumentId: "doc-1",
    auth,
    onSelect: vi.fn(),
    onImport: vi.fn(),
    onImportFile: vi.fn(),
    onAuthChange: vi.fn(),
    onSave: vi.fn(),
    onRename: vi.fn(),
    onToggle: vi.fn(),
    onDelete: vi.fn(),
  };
}

beforeEach(() => {
  vi.mocked(invoke).mockClear();
});

it("keeps binding edits local to the OpenAPI host: no save, import or IPC", async () => {
  const user = userEvent.setup();
  const props = hostProps();
  render(
    <LanguageProvider>
      <OpenApiPage {...props} />
    </LanguageProvider>,
  );

  expect(screen.getByLabelText("数据绑定")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "选择 list operation" }));
  await user.click(screen.getByRole("option", { name: /订单API/ }));
  await user.click(screen.getByRole("button", { name: "确认绑定" }));
  expect(screen.getByText("已确认绑定")).toBeTruthy();

  // The host owns the binding state only for this session: none of the
  // persistence, authorization, import or desktop boundaries may fire.
  expect(props.onSave).not.toHaveBeenCalled();
  expect(props.onAuthChange).not.toHaveBeenCalled();
  expect(props.onImport).not.toHaveBeenCalled();
  expect(props.onImportFile).not.toHaveBeenCalled();
  expect(props.onSelect).not.toHaveBeenCalled();
  expect(props.onRename).not.toHaveBeenCalled();
  expect(props.onToggle).not.toHaveBeenCalled();
  expect(props.onDelete).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});
