import { type ComponentProps } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "../../src/features/pages/DataTable";
import { GeneratedPage } from "../../src/features/pages/GeneratedPage";
import { LanguageProvider } from "../../src/i18n/LanguageProvider";
import type { PageSpec } from "../../src/types/domain";
import {
  applyQueryFailure,
  applyQueryResult,
  createPageRuntimeState,
  setRuntimeSelection,
  type PageRuntimeState,
} from "../../src/features/pages/runtime/pageRuntimeState";

// Only the desktop IPC boundary is mocked, not AntD or any page component.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
import { invoke } from "@tauri-apps/api/core";

const columns = ["id", "amount"];
const rows = [
  ["a", "20"],
  ["b", "100"],
  ["c", "3"],
];
const columnMeta: NonNullable<PageSpec["columnMeta"]> = [
  { name: "amount", type: "number", sortable: true },
];
const defaultSort = { column: "amount", order: "asc" as const };
function rowIds() {
  const idIndex = screen
    .getAllByRole("columnheader")
    .findIndex((header) => header.textContent === "id");
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[idIndex].textContent);
}
function renderTable(props: Partial<ComponentProps<typeof DataTable>> = {}) {
  return render(<DataTable columns={columns} rows={rows} columnMeta={columnMeta} {...props} />, {
    wrapper: LanguageProvider,
  });
}
function fixture(): PageSpec {
  return {
    title: "Orders",
    description: "Reliability fixture",
    filters: ["keyword"],
    stats: [],
    columns,
    rows,
    columnMeta,
    views: [{ type: "list", defaultSort }],
    operations: [
      {
        operation_id: "listOrders",
        method: "GET",
        path: "/orders",
        role: "list",
        sortParam: "sort",
        pagination: { pageParam: "page", sizeParam: "limit", defaultSize: 3 },
      },
      { operation_id: "createOrder", method: "POST", path: "/orders", role: "create" },
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
function pageProps(page = fixture()): ComponentProps<typeof GeneratedPage> {
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
    queryMeta: { status: "success", total: 9 },
  };
}

describe("DataTable real AntD sorting", () => {
  it("reports null when the user clears the default sort and stays clear on rerender", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    const view = renderTable({ defaultSort, onSortChange });
    expect(rowIds()).toEqual(["c", "a", "b"]);
    await user.click(screen.getByRole("columnheader", { name: /amount/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ column: "amount", order: "desc" });
    await user.click(screen.getByRole("columnheader", { name: /amount/ }));
    expect(onSortChange).toHaveBeenLastCalledWith(null);
    expect(rowIds()).toEqual(["a", "b", "c"]);
    view.rerender(
      <DataTable
        columns={columns}
        rows={rows.map((row) => [...row])}
        columnMeta={columnMeta}
        defaultSort={{ ...defaultSort }}
        onSortChange={onSortChange}
      />,
    );
    expect(rowIds()).toEqual(["a", "b", "c"]);
    expect(
      screen.getByRole("columnheader", { name: /amount/ }).getAttribute("aria-sort"),
    ).toBeNull();
  });

  it("synchronizes genuinely changed default order, column and removal", () => {
    const sortableColumns: NonNullable<PageSpec["columnMeta"]> = [
      ...columnMeta,
      { name: "id", type: "string", sortable: true },
    ];
    const onSortChange = vi.fn();
    const table = (nextSort?: ComponentProps<typeof DataTable>["defaultSort"]) => (
      <DataTable
        columns={columns}
        rows={rows}
        columnMeta={sortableColumns}
        defaultSort={nextSort}
        onSortChange={onSortChange}
      />
    );
    const view = render(table(defaultSort), { wrapper: LanguageProvider });
    expect(rowIds()).toEqual(["c", "a", "b"]);
    view.rerender(table({ column: "amount", order: "desc" }));
    expect(rowIds()).toEqual(["b", "a", "c"]);
    expect(screen.getByRole("columnheader", { name: /amount/ }).getAttribute("aria-sort")).toBe(
      "descending",
    );
    view.rerender(table({ column: "id", order: "desc" }));
    expect(rowIds()).toEqual(["c", "b", "a"]);
    expect(screen.getByRole("columnheader", { name: /id/ }).getAttribute("aria-sort")).toBe(
      "descending",
    );
    expect(
      screen.getByRole("columnheader", { name: /amount/ }).getAttribute("aria-sort"),
    ).toBeNull();
    view.rerender(table(undefined));
    expect(rowIds()).toEqual(["a", "b", "c"]);
    expect(screen.getByRole("columnheader", { name: /id/ }).getAttribute("aria-sort")).toBeNull();
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it("serverSort notifies the host but never locally reorders supplied rows", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    renderTable({ defaultSort, serverSort: true, onSortChange });
    expect(rowIds()).toEqual(["a", "b", "c"]);
    await user.click(screen.getByRole("columnheader", { name: /amount/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ column: "amount", order: "desc" });
    expect(rowIds()).toEqual(["a", "b", "c"]);
    await user.click(screen.getByRole("columnheader", { name: /amount/ }));
    expect(onSortChange).toHaveBeenLastCalledWith(null);
    expect(rowIds()).toEqual(["a", "b", "c"]);
  });
});

describe("GeneratedPage execution gates", () => {
  it("keeps a cleared server sort cleared across pagination and returned rows", async () => {
    const user = userEvent.setup();
    const props = pageProps();
    const view = render(<GeneratedPage {...props} />, { wrapper: LanguageProvider });
    await user.click(screen.getByRole("columnheader", { name: /amount/ }));
    expect(props.onQuery).toHaveBeenLastCalledWith(
      { page: "1", limit: "3", sort: "amount,desc" },
      expect.any(Object),
    );
    await user.click(screen.getByRole("columnheader", { name: /amount/ }));
    expect(props.onQuery).toHaveBeenLastCalledWith({ page: "1", limit: "3" }, expect.any(Object));
    await user.click(screen.getByTitle("2"));
    expect(props.onQuery).toHaveBeenLastCalledWith({ page: "2", limit: "3" }, expect.any(Object));
    view.rerender(
      <GeneratedPage
        {...props}
        page={{
          ...props.page,
          rows: [
            ["d", "9"],
            ["e", "1"],
          ],
        }}
      />,
    );
    expect(
      screen.getByRole("columnheader", { name: /amount/ }).getAttribute("aria-sort"),
    ).toBeNull();
    await user.click(screen.getByTitle("3"));
    expect(props.onQuery).toHaveBeenLastCalledWith({ page: "3", limit: "3" }, expect.any(Object));
    expect(rowIds()).toEqual(["d", "e"]);
  });

  it("preview to live transition does not automatically query or replay disabled actions", async () => {
    const user = userEvent.setup();
    const props = pageProps();
    const view = render(<GeneratedPage {...props} isStreaming />, { wrapper: LanguageProvider });
    expect(props.onQuery).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "查询" }));
    expect(props.onQuery).not.toHaveBeenCalled();
    view.rerender(<GeneratedPage {...props} isStreaming={false} />);
    expect(props.onQuery).not.toHaveBeenCalled();
    expect(props.onMutation).not.toHaveBeenCalled();
    expect(props.onSaved).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "加载真实数据" }));
    expect(props.onQuery).toHaveBeenCalledTimes(1);
    expect(props.onQuery).toHaveBeenLastCalledWith(
      { page: "1", limit: "3", sort: "amount,asc" },
      expect.any(Object),
    );
  });

  it("preview has no query, mutation, save or batch execution capability even with raw bindings", async () => {
    const user = userEvent.setup();
    const props = { ...pageProps(), isStreaming: true };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(invoke).mockClear();
    const { container } = render(<GeneratedPage {...props} />, { wrapper: LanguageProvider });
    const header = container.querySelector<HTMLElement>(".panel-head");
    const content = container.querySelector<HTMLFieldSetElement>("fieldset.streaming-content");
    const table = content?.querySelector<HTMLElement>(".generated-data-table");
    const main = content?.querySelector<HTMLElement>(".generated-page-main");
    const filterBar = content?.querySelector<HTMLElement>(".filter-row");
    const firstRow = table?.querySelector<HTMLTableRowElement>(
      "tbody tr:not(.ant-table-measure-row)",
    );
    expect(header).not.toBeNull();
    expect(content).not.toBeNull();
    expect(table).not.toBeNull();
    expect(main).not.toBeNull();
    expect(filterBar).not.toBeNull();
    expect(firstRow).not.toBeNull();
    expect(within(header!).getByRole("heading", { name: "Orders" })).toBeTruthy();
    expect(
      within(header!).queryByRole("button", { name: /保存为模板|Save as template/ }),
    ).toBeNull();
    expect(
      within(header!).queryByRole("button", { name: /加载真实数据|Load real data/ }),
    ).toBeNull();
    expect(within(main!).queryByRole("button", { name: "batchDelete" })).toBeNull();
    expect(within(table!).queryAllByRole("checkbox")).toHaveLength(0);
    // Exercise the real disabled fieldset, row buttons, and sortable AntD header.
    await user.click(within(filterBar!).getByRole("button", { name: "查询" }));
    await user.click(within(firstRow!).getByRole("button", { name: "查看" }));
    await user.click(within(firstRow!).getByRole("button", { name: "编辑" }));
    await user.click(within(table!).getByRole("columnheader", { name: /amount/ }));
    expect(props.onQuery).not.toHaveBeenCalled();
    expect(props.onMutation).not.toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(props.onDetail).not.toHaveBeenCalled();
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("live batch selection is real and executes only after confirmation", async () => {
    const user = userEvent.setup();
    const props = pageProps();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<GeneratedPage {...props} />, { wrapper: LanguageProvider });
    const batch = screen.getByRole("button", { name: "batchDelete" });
    expect((batch as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getAllByRole("checkbox")[1]);
    expect((batch as HTMLButtonElement).disabled).toBe(false);
    await user.click(batch);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(props.onMutation).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await user.click(batch);
    expect(props.onMutation).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: "/orders/batch" }),
      JSON.stringify({ ids: ["a"] }),
    );
    expect((batch as HTMLButtonElement).disabled).toBe(true);
  });
});

function loadedRuntime(records: Record<string, unknown>[], total?: number): PageRuntimeState {
  return applyQueryResult(createPageRuntimeState("c3"), {
    records,
    columns: ["id", "amount"],
    rowKeyPointer: "/id",
    ...(total === undefined ? {} : { total }),
  });
}

describe("GeneratedPage C3 definition/runtime separation", () => {
  it("renders runtime records while a frozen page definition stays untouched", () => {
    const definition: PageSpec = { ...fixture(), rows: [["sample", "0"]] };
    Object.freeze(definition.rows);
    Object.freeze(definition);
    render(
      <GeneratedPage
        {...pageProps(definition)}
        runtime={loadedRuntime([{ id: 7, amount: 20.5 }], 9)}
      />,
      { wrapper: LanguageProvider },
    );
    expect(rowIds()).toEqual(["7"]);
    expect(screen.getByText("20.5")).toBeTruthy();
    expect(definition.rows).toEqual([["sample", "0"]]);
  });

  it("keeps stale rows visible but blocks writes until a fresh query succeeds", async () => {
    const user = userEvent.setup();
    const props = pageProps();
    const stale = applyQueryFailure(
      loadedRuntime([{ id: "a", amount: 20 }], 9),
      { code: "runtime.query.failed", message: "网络中断" },
      { keepData: true },
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GeneratedPage {...props} runtime={stale} />, { wrapper: LanguageProvider });
    expect(rowIds()).toEqual(["a"]);
    expect(screen.getByText("当前展示上次成功结果（已过期），写入已禁用")).toBeTruthy();
    expect(screen.getByText("网络中断")).toBeTruthy();
    await user.click(screen.getAllByRole("checkbox")[1]);
    await user.click(screen.getByRole("button", { name: "batchDelete" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(props.onMutation).not.toHaveBeenCalled();
  });

  it("never fabricates a total and keeps data diagnostics dismissible but not stale", async () => {
    const user = userEvent.setup();
    const props = pageProps();
    const runtime = loadedRuntime([{ id: "a", amount: 20 }]);
    const view = render(<GeneratedPage {...props} runtime={runtime} />, {
      wrapper: LanguageProvider,
    });
    const diagnostic = () =>
      view.container.querySelector('[data-diagnostic-code="runtime.total.unknown"]');
    expect(view.container.querySelector(".pagination--unknown-total")).not.toBeNull();
    expect(screen.queryByText(/共 0 条/)).toBeNull();
    expect(diagnostic()).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "关闭数据诊断" }));
    expect(diagnostic()).toBeNull();
    const failed = applyQueryFailure(
      runtime,
      { code: "runtime.query.failed", message: "查询失败" },
      { keepData: true },
    );
    view.rerender(<GeneratedPage {...props} runtime={failed} />);
    expect(diagnostic()).not.toBeNull();
    expect(screen.getByText("查询失败")).toBeTruthy();
  });

  it("stores selection as typed runtime keys, not display indexes", async () => {
    const user = userEvent.setup();
    const props = pageProps();
    const runtime = loadedRuntime(
      [
        { id: "1", amount: 1 },
        { id: 1, amount: 2 },
      ],
      9,
    );
    const onSelectionKeysChange = vi.fn();
    const view = render(
      <GeneratedPage {...props} runtime={runtime} onSelectionKeysChange={onSelectionKeysChange} />,
      { wrapper: LanguageProvider },
    );
    await user.click(screen.getAllByRole("checkbox")[1]);
    expect(onSelectionKeysChange).toHaveBeenLastCalledWith(["string:1"]);
    // A selection-only runtime update replaces the runtime object but not its records.
    view.rerender(
      <GeneratedPage
        {...props}
        runtime={setRuntimeSelection(runtime, ["string:1"])}
        onSelectionKeysChange={onSelectionKeysChange}
      />,
    );
    expect((screen.getAllByRole("checkbox")[1] as HTMLInputElement).checked).toBe(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "batchDelete" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(props.onMutation).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: "/orders/batch" }),
      JSON.stringify({ ids: ["1"] }),
    );
  });

  it("labels stat scope instead of presenting definition numbers as live aggregates", () => {
    const definition: PageSpec = {
      ...fixture(),
      operations: fixture().operations!.filter((operation) => operation.role === "list"),
      stats: [{ label: "全部订单", value: "1,280" }],
    };
    const props = pageProps(definition);
    const view = render(
      <GeneratedPage {...props} runtime={loadedRuntime([{ id: "a", amount: 20 }], 9)} />,
      { wrapper: LanguageProvider },
    );
    expect(screen.getByText("全部订单")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("当前页未提供聚合口径")).toBeTruthy();
    expect(screen.queryByText("1,280")).toBeNull();
    view.rerender(<GeneratedPage {...props} />);
    expect(screen.getByText("定义示例，非实时数据")).toBeTruthy();
  });

  it("saves a pure definition while the table shows loaded runtime rows", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockClear();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    const definition: PageSpec = { ...fixture(), rows: [["sample", "0"]] };
    const props = { ...pageProps(definition), templateId: "template-1" };
    render(<GeneratedPage {...props} runtime={loadedRuntime([{ id: "loaded", amount: 7 }], 9)} />, {
      wrapper: LanguageProvider,
    });
    expect(rowIds()).toEqual(["loaded"]);
    await user.click(screen.getByRole("button", { name: "更新当前模板" }));
    const save = vi.mocked(invoke).mock.calls.find(([command]) => command === "save_template");
    expect(save).toBeTruthy();
    const payload = JSON.parse((save![1] as { payload: string }).payload);
    // C4: a template is a pure structural definition, never loaded rows or samples.
    expect(payload.rows).toEqual([]);
    expect(payload.stats).toEqual([]);
    expect(typeof payload.title).toBe("string");
    expect(JSON.stringify(payload)).not.toContain("loaded");
    expect(JSON.stringify(payload)).not.toContain("sample");
  });

  it("confines identity diagnostics to row writes and keeps create available", () => {
    // A redirect create has a deterministic, renderer-independent side effect.
    const props = pageProps({ ...fixture(), interaction: { create: "redirect" } });
    const duplicated = loadedRuntime(
      [
        { id: "a", amount: 1 },
        { id: "a", amount: 2 },
      ],
      9,
    );
    render(<GeneratedPage {...props} runtime={duplicated} />, { wrapper: LanguageProvider });
    expect(screen.getByText("记录 ID 重复，行级写入已禁用")).toBeTruthy();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getByRole("button", { name: "batchDelete" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(props.onMutation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    expect(window.location.pathname).toBe("/generate/create");
  });
});
