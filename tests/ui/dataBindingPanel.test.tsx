import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataBindingPanel } from "../../src/features/pages/DataBindingPanel";
import type {
  ApiDocument,
  ResponseBinding,
  ResponseSchemaSummary,
} from "../../src/types/domain";

// The panel must never talk to the desktop/IPC boundary. The real host-level
// no-IPC assertion lives in openApiBindingHost.test.tsx, not in this suite.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// Parallel dependency: src/features/pages/data/responseMapping.ts is authored by
// another agent and compiled by the main session during integration. These UI
// tests exercise the REAL DataBindingPanel with a controlled mapResponse stub so
// the panel itself is genuinely verified. We never create/modify that module.
const { mapResponse } = vi.hoisted(() => ({ mapResponse: vi.fn() }));
vi.mock("../../src/features/pages/data/responseMapping", () => ({ mapResponse }));

const OP = "GET /orders · listOrders";

function summaryFixture(
  overrides: Partial<ResponseSchemaSummary> = {},
): ResponseSchemaSummary {
  return {
    operationKey: OP,
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
    ...overrides,
  };
}

function documentFixture(options: {
  id: string;
  name: string;
  operations?: string[];
  authorizedOperations?: string[];
  responseSchemas?: Record<string, ResponseSchemaSummary>;
}): ApiDocument {
  const operations = options.operations ?? [OP];
  return {
    id: options.id,
    projectId: "project",
    name: options.name,
    enabled: true,
    spec: {
      title: options.name,
      version: "1.0.0",
      spec_version: "3.0.0",
      operation_count: operations.length,
      operations,
      api_base_url: "https://example.test",
      discovered_url: "https://example.test/openapi.json",
      responseSchemas: options.responseSchemas,
    },
    auth: {
      type: "apiKey",
      secretRef: "secret",
      apiKeyName: "X-Api-Key",
      caPem: "",
      authorizedOperations: options.authorizedOperations ?? operations,
    },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

/** Stateful host: mirrors OpenApiPage's useState wiring so the panel stays controlled. */
function Harness({
  documents,
  initial,
  sample,
  onChange,
}: {
  documents: readonly ApiDocument[];
  initial?: ResponseBinding;
  sample?: unknown;
  onChange: (binding: ResponseBinding) => void;
}) {
  const [binding, setBinding] = useState<ResponseBinding | undefined>(initial);
  return (
    <DataBindingPanel
      documents={documents}
      binding={binding}
      sample={sample}
      onChange={(next) => {
        onChange(next);
        setBinding(next);
      }}
    />
  );
}

beforeEach(() => {
  mapResponse.mockReset();
  // Deliberately smuggle the raw sample and an identity canary into the result:
  // the panel may read only counts/status/codes, never record contents or keys.
  mapResponse.mockImplementation((sample: unknown, binding: ResponseBinding) => ({
    status: binding.confirmed ? "mapped" : "unconfirmed",
    records: [{ raw: sample }],
    keys: [{ identity: "KEY_IDENTITY_LEAK_CANARY" }],
    total: undefined,
    issues: [],
    truncated: { rows: false, fields: false },
    writable: binding.confirmed,
  }));
});

describe("DataBindingPanel", () => {
  it("keeps the binding document-scoped when two documents share one operationId", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const docA = documentFixture({
      id: "doc-a",
      name: "文档A",
      responseSchemas: { listOrders: summaryFixture({ itemsPointer: "/docA/items" }) },
    });
    const docB = documentFixture({
      id: "doc-b",
      name: "文档B",
      responseSchemas: {
        listOrders: summaryFixture({
          itemsPointer: "/docB/items",
          rowKeyPointer: "/docB/id",
          fields: [{ pointer: "/docB/orderNo", name: "订单号", type: "string" }],
        }),
      },
    });
    render(<Harness documents={[docA, docB]} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "选择 list operation" }));
    const labels = screen.getAllByRole("option").map((option) => option.textContent ?? "");
    expect(labels.some((label) => label.includes("文档A"))).toBe(true);
    expect(labels.some((label) => label.includes("文档B"))).toBe(true);
    await user.click(screen.getByRole("option", { name: /文档B/ }));

    const last = onChange.mock.calls.at(-1)?.[0] as ResponseBinding;
    expect(last.apiDocumentId).toBe("doc-b");
    expect(last.operationKey).toBe(OP);
    expect(last.confirmed).toBe(false);
    // Suggestions must come from doc-b's responseSchemas, never doc-a's.
    expect(last.itemsPointer).toBe("/docB/items");
    expect(last.rowKeyPointer).toBe("/docB/id");
    expect(last.fieldPointers).toContain("/docB/orderNo");
    expect(last.fieldPointers).not.toContain("/id");
    expect(
      (screen.getByRole("textbox", { name: "items 指针" }) as HTMLInputElement).value,
    ).toBe("/docB/items");
  });

  it("marks inferred/unresolved as 待确认映射, disables writes and never renders sample values", () => {
    const onChange = vi.fn();
    const doc = documentFixture({
      id: "doc-1",
      name: "订单API",
      responseSchemas: {
        listOrders: summaryFixture({
          itemsPointer: "/rows",
          itemsPointerOrigin: "inferred",
          totalPointer: null,
          totalPointerOrigin: "unresolved",
          rowKeyPointer: null,
          rowKeyPointerOrigin: "unresolved",
          issues: [{ code: "RESPONSE_ITEMS_UNRESOLVED", message: "hidden diagnostic text" }],
        }),
      },
    });
    const binding: ResponseBinding = {
      apiDocumentId: "doc-1",
      operationKey: OP,
      itemsPointer: "/rows",
      rowKeyPointer: "",
      fieldPointers: [],
      confirmed: false,
    };
    const sample = {
      marker: "SENSITIVE_MARKER_9F3",
      rows: [
        { id: "001", secret: "RAW_VALUE_DO_NOT_RENDER_771" },
        { id: "002", secret: "RAW_VALUE_DO_NOT_RENDER_772" },
      ],
    };
    render(<Harness documents={[doc]} initial={binding} sample={sample} onChange={onChange} />);

    expect(screen.getAllByText("待确认映射").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("来自 OpenAPI 响应 Schema")).toBeNull();
    // Only the issue code is listed, never the raw diagnostic text/response.
    expect(screen.getByText(/RESPONSE_ITEMS_UNRESOLVED/)).toBeTruthy();
    expect(screen.queryByText(/hidden diagnostic text/)).toBeNull();

    expect(screen.getByText("仅预览，写入已禁用")).toBeTruthy();
    expect(screen.getAllByText(/写入已禁用/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("本地样本仅用于预览，不会发送给模型")).toBeTruthy();

    // Pure presentational component: renders do not auto-emit or auto-confirm.
    expect(onChange).not.toHaveBeenCalled();
    expect(mapResponse).toHaveBeenCalled();
    const lastCall = mapResponse.mock.calls.at(-1);
    expect(lastCall).toBeTruthy();
    expect(lastCall?.[0]).toBe(sample);
    expect((lastCall?.[1] as ResponseBinding).confirmed).toBe(false);

    const text = document.body.textContent ?? "";
    const html = document.body.innerHTML;
    for (const leaked of [
      "SENSITIVE_MARKER_9F3",
      "RAW_VALUE_DO_NOT_RENDER_771",
      "RAW_VALUE_DO_NOT_RENDER_772",
      "KEY_IDENTITY_LEAK_CANARY",
    ]) {
      expect(text).not.toContain(leaked);
      expect(html).not.toContain(leaked);
    }
  });

  it("confirms only on explicit click and resets confirmed when pointers/fields change", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const doc = documentFixture({
      id: "doc-1",
      name: "订单API",
      responseSchemas: { listOrders: summaryFixture() },
    });
    const binding: ResponseBinding = {
      apiDocumentId: "doc-1",
      operationKey: OP,
      itemsPointer: "/data",
      rowKeyPointer: "/id",
      fieldPointers: [],
      confirmed: false,
    };
    render(<Harness documents={[doc]} initial={binding} onChange={onChange} />);

    const items = screen.getByRole("textbox", { name: "items 指针" }) as HTMLInputElement;
    await user.clear(items);
    await user.type(items, "/payload/list");
    expect(items.value).toBe("/payload/list");
    expect((onChange.mock.calls.at(-1)?.[0] as ResponseBinding).confirmed).toBe(false);

    await user.click(screen.getByRole("checkbox", { name: /金额/ }));
    const afterField = onChange.mock.calls.at(-1)?.[0] as ResponseBinding;
    expect(afterField.fieldPointers).toContain("/amount");
    expect(afterField.confirmed).toBe(false);

    await user.click(screen.getByRole("button", { name: "确认绑定" }));
    const confirmed = onChange.mock.calls.at(-1)?.[0] as ResponseBinding;
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.itemsPointer).toBe("/payload/list");
    expect(confirmed.fieldPointers).toContain("/amount");
    expect(screen.queryByText("仅预览，写入已禁用")).toBeNull();

    await user.clear(items);
    await user.type(items, "/changed");
    const reset = onChange.mock.calls.at(-1)?.[0] as ResponseBinding;
    expect(reset.confirmed).toBe(false);
    expect(reset.itemsPointer).toBe("/changed");
  });

  it("shows duplicate-id diagnostics as code counts and keeps writes disabled", () => {
    const onChange = vi.fn();
    mapResponse.mockImplementation(() => ({
      status: "mapped",
      records: [{}, {}, {}],
      keys: [],
      total: undefined,
      issues: [
        { code: "DUPLICATE_ID", message: "hidden" },
        { code: "DUPLICATE_ID", message: "hidden" },
        { code: "EMPTY_ID", message: "hidden" },
      ],
      truncated: { rows: true, fields: false },
      writable: false,
    }));
    const doc = documentFixture({
      id: "doc-1",
      name: "订单API",
      responseSchemas: { listOrders: summaryFixture() },
    });
    const binding: ResponseBinding = {
      apiDocumentId: "doc-1",
      operationKey: OP,
      itemsPointer: "/data",
      rowKeyPointer: "/id",
      fieldPointers: [],
      confirmed: true,
    };
    render(
      <Harness
        documents={[doc]}
        initial={binding}
        sample={[{ id: 1 }, { id: 1 }]}
        onChange={onChange}
      />,
    );

    expect(screen.getByText(/DUPLICATE_ID.*2/)).toBeTruthy();
    expect(screen.getByText(/EMPTY_ID.*1/)).toBeTruthy();
    expect(screen.getByText(/行已截断/)).toBeTruthy();
    expect(screen.getByText(/写入已禁用/)).toBeTruthy();
    // total missing is rendered as 未提供, never a fabricated number.
    expect(screen.getByText("未提供")).toBeTruthy();
    expect(document.body.textContent).not.toContain("hidden");
  });

  it("aggregates repeated response schema issue codes instead of listing them three times", () => {
    const doc = documentFixture({
      id: "doc-1",
      name: "订单API",
      responseSchemas: {
        listOrders: summaryFixture({
          issues: [
            { code: "RESPONSE_POINTER_UNSAFE", message: "hidden one" },
            { code: "RESPONSE_POINTER_UNSAFE", message: "hidden two" },
            { code: "RESPONSE_POINTER_UNSAFE", message: "hidden three" },
          ],
        }),
      },
    });
    const binding: ResponseBinding = {
      apiDocumentId: "doc-1",
      operationKey: OP,
      itemsPointer: "/data/items",
      rowKeyPointer: "/id",
      fieldPointers: [],
      confirmed: false,
    };
    render(<Harness documents={[doc]} initial={binding} onChange={vi.fn()} />);
    expect(screen.getAllByText(/RESPONSE_POINTER_UNSAFE/)).toHaveLength(1);
    expect(screen.getByText(/RESPONSE_POINTER_UNSAFE × 3/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("hidden");
  });
});
