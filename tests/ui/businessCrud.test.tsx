import { type ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GeneratedPage } from "../../src/features/pages/GeneratedPage";
import { LanguageProvider } from "../../src/i18n/LanguageProvider";
import type { PageSpec } from "../../src/types/domain";
import type { MutationOutcome } from "../../src/features/pages/mutationOutcome";
import {
  applyQueryResult,
  createPageRuntimeState,
} from "../../src/features/pages/runtime/pageRuntimeState";

// Only the desktop IPC boundary is mocked; AntD, the form and the runtime are real.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function fixture(): PageSpec {
  return {
    title: "Orders",
    description: "D1 fixture",
    filters: ["keyword"],
    stats: [],
    columns: ["id", "name"],
    rows: [["1", "A"]],
    interaction: { create: "inline", update: "inline", delete: "inline", detail: "inline" },
    operations: [
      {
        operation_id: "listOrders",
        method: "GET",
        path: "/orders",
        role: "list",
        pagination: { pageParam: "page", sizeParam: "limit", defaultSize: 1 },
      },
      {
        operation_id: "createOrder",
        method: "POST",
        path: "/orders",
        role: "create",
        bodySchema: [
          { name: "name", type: "string", required: true },
          {
            name: "secretField",
            type: "string",
            required: false,
            visibleWhen: { field: "name", equals: "never" },
          },
          {
            name: "serverOnly",
            type: "string",
            required: false,
            constraints: { readonly: true },
          },
        ],
      },
      {
        operation_id: "updateOrder",
        method: "PATCH",
        path: "/orders/{id}",
        role: "update",
        bodySchema: [{ name: "name", type: "string", required: true }],
      },
      { operation_id: "deleteOrder", method: "DELETE", path: "/orders/{id}", role: "delete" },
    ],
    batchActions: [
      {
        operation_id: "batchDelete",
        method: "DELETE",
        path: "/orders/batch",
        payloadBuilder: { type: "ids" },
      },
    ],
  };
}

function props(page = fixture()): ComponentProps<typeof GeneratedPage> {
  return {
    page,
    projectId: "project",
    apiDocumentIds: ["document"],
    isStreaming: false,
    operations: page.operations!.map((operation) => ({
      key: `${operation.method} ${operation.path} · ${operation.operation_id}`,
      method: operation.method,
      path: operation.path,
      operationId: operation.operation_id,
      queryParameters: operation.role === "list" ? ["keyword", "page", "limit", "sort"] : undefined,
    })),
    detail: null,
    onDetail: vi.fn(),
    onSaved: vi.fn(),
    onQuery: vi.fn(),
    onMutation: vi.fn(),
    onDelete: vi.fn(),
    querying: false,
    queryMeta: { status: "success" },
    runtime: applyQueryResult(createPageRuntimeState("d1"), {
      records: [{ id: "1", name: "A" }],
      columns: ["id", "name"],
    }),
    onSelectionKeysChange: vi.fn(),
    onRuntimeControls: vi.fn(),
  };
}

// Real AntD tables/forms are slow under a full parallel UI run; keep every
// assertion identical while allowing headroom for jsdom rendering jitter.
const uiTest = (name: string, body: () => Promise<void>) => it(name, body, 60_000);

describe("D1 business table and mutation workflow", () => {
  uiTest("filters and keeps input plus backend field errors after a failed edit", async () => {
    const base = props();
    const onMutation = vi.fn(async () => "error" as MutationOutcome);
    const view = render(
      <GeneratedPage {...base} onQuery={base.onQuery} onMutation={onMutation} />,
      { wrapper: LanguageProvider },
    );
    fireEvent.change(screen.getByPlaceholderText("请输入keyword"), {
      target: { value: "abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    // antd Form finishes validation asynchronously.
    await waitFor(() =>
      expect(base.onQuery).toHaveBeenLastCalledWith(
        expect.objectContaining({ keyword: "abc" }),
        expect.anything(),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const input = await screen.findByDisplayValue("A");
    fireEvent.change(input, { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "保存编辑" }));
    await waitFor(() => expect(onMutation).toHaveBeenCalledTimes(1));
    const callsAfterFailure = vi.mocked(base.onQuery).mock.calls.length;

    // A failed write reopens with the user's input and the server's field error.
    view.rerender(
      <GeneratedPage
        {...base}
        onQuery={base.onQuery}
        onMutation={onMutation}
        mutationStatus="error"
        mutationFieldErrors={{ name: "名称已存在" }}
      />,
    );
    await waitFor(() => expect(screen.getByText("名称已存在")).toBeTruthy());
    expect(screen.getByDisplayValue("B")).toBeTruthy();
    expect(screen.getAllByText(/输入已保留/).length).toBeGreaterThan(0);
    expect(vi.mocked(base.onQuery).mock.calls.length).toBe(callsAfterFailure);
  });

  uiTest("a successful retry closes the form and refreshes the original query", async () => {
    const base = props();
    const onMutation = vi
      .fn<() => Promise<MutationOutcome> | MutationOutcome>()
      .mockResolvedValueOnce("error")
      .mockResolvedValueOnce("success");
    render(<GeneratedPage {...base} onQuery={base.onQuery} onMutation={onMutation} />, {
      wrapper: LanguageProvider,
    });
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(await screen.findByDisplayValue("A"), { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "保存编辑" }));
    await waitFor(() => expect(onMutation).toHaveBeenCalledTimes(1));
    const callsAfterFailure = vi.mocked(base.onQuery).mock.calls.length;
    expect(screen.getByDisplayValue("B")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "保存编辑" }));
    await waitFor(() =>
      expect(vi.mocked(base.onQuery).mock.calls.length).toBeGreaterThan(callsAfterFailure),
    );
    await waitFor(() => expect(screen.queryByDisplayValue("B")).toBeNull());
  });

  uiTest("a double click while a write is in flight submits only once", async () => {
    const base = props();
    const pending = deferred<MutationOutcome>();
    const onMutation = vi.fn(() => pending.promise);
    render(<GeneratedPage {...base} onMutation={onMutation} />, { wrapper: LanguageProvider });
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(await screen.findByDisplayValue("A"), { target: { value: "B" } });
    const submit = screen.getByRole("button", { name: "保存编辑" }) as HTMLButtonElement;
    fireEvent.click(submit);
    await waitFor(() => expect(submit.disabled).toBe(true));
    fireEvent.click(submit);
    expect(onMutation).toHaveBeenCalledTimes(1);
    pending.resolve("success");
    await waitFor(() => expect(screen.queryByRole("button", { name: "保存编辑" })).toBeNull());
  });

  uiTest("an unknown write result keeps the form open and never refreshes or retries", async () => {
    const base = props();
    const onMutation = vi.fn(async () => "unknown" as MutationOutcome);
    render(<GeneratedPage {...base} onQuery={base.onQuery} onMutation={onMutation} />, {
      wrapper: LanguageProvider,
    });
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(await screen.findByDisplayValue("A"), { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "保存编辑" }));
    await waitFor(() => expect(onMutation).toHaveBeenCalledTimes(1));
    expect(vi.mocked(base.onQuery).mock.calls.length).toBe(0);
    expect(screen.getByDisplayValue("B")).toBeTruthy();
    expect(screen.getAllByText(/输入已保留/).length).toBeGreaterThan(0);
  });

  uiTest(
    "clears selection on a page change and never submits hidden or readonly fields",
    async () => {
      const base = props();
      render(<GeneratedPage {...base} />, { wrapper: LanguageProvider });
      const onSelectionKeysChange = vi.mocked(base.onSelectionKeysChange!);
      fireEvent.click(screen.getAllByRole("checkbox")[1]);
      expect(onSelectionKeysChange).toHaveBeenLastCalledWith(["string:1"]);
      fireEvent.click(screen.getByRole("button", { name: "下一页" }));
      expect(onSelectionKeysChange).toHaveBeenLastCalledWith([]);
      expect(base.onQuery).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: "2" }),
        expect.anything(),
      );

      const createName = screen.getByRole("textbox", { name: "name" });
      fireEvent.change(createName, { target: { value: "New" } });
      // The readonly server-only input is present but disabled.
      expect(
        screen.getAllByDisplayValue("").some((element) => (element as HTMLInputElement).disabled),
      ).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "提交新增" }));
      await waitFor(() => expect(base.onMutation).toHaveBeenCalledTimes(1));
      const body = vi.mocked(base.onMutation).mock.calls[0][1];
      expect(JSON.parse(body)).toEqual({ name: "New" });
    },
  );

  uiTest("uses the typed raw ID and steps back one page after deleting its last row", async () => {
    const base = props();
    const onDelete = vi.fn(async () => "success" as MutationOutcome);
    render(<GeneratedPage {...base} onQuery={base.onQuery} onDelete={onDelete} />, {
      wrapper: LanguageProvider,
    });
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(base.onQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: "2" }),
      expect.anything(),
    );
    fireEvent.click(
      screen
        .getAllByRole("button", { name: "删除" })
        .find((button) => button.hasAttribute("aria-label"))!,
    );
    fireEvent.click(await screen.findByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(onDelete.mock.calls[0]).toEqual([
      expect.objectContaining({ path: "/orders/{id}" }),
      "1",
      true,
    ]);
    expect(base.onQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: "1" }),
      expect.anything(),
    );
  });
});
