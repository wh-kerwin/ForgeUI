import { type ComponentProps } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "../../src/features/pages/DataTable";
import { GeneratedPage } from "../../src/features/pages/GeneratedPage";
import { LanguageProvider } from "../../src/i18n/LanguageProvider";
import type { PageSpec } from "../../src/types/domain";

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
    const firstRow = table?.querySelector<HTMLTableRowElement>("tbody tr:not(.ant-table-measure-row)");
    expect(header).not.toBeNull();
    expect(content).not.toBeNull();
    expect(table).not.toBeNull();
    expect(main).not.toBeNull();
    expect(filterBar).not.toBeNull();
    expect(firstRow).not.toBeNull();
    expect(within(header!).getByRole("heading", { name: "Orders" })).toBeTruthy();
    expect(within(header!).queryByRole("button", { name: /保存为模板|Save as template/ })).toBeNull();
    expect(within(header!).queryByRole("button", { name: /加载真实数据|Load real data/ })).toBeNull();
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
