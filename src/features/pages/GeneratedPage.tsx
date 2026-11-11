import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, LockKeyhole, Plus } from "lucide-react";
import { Button, ConfigProvider, Pagination, theme as antdTheme, type ThemeConfig } from "antd";
import type { FieldSchema, PageSpec, PageView, ThemeStyle } from "../../types/domain";
import { PageHeader } from "./PageHeader";
import { FilterBar } from "./FilterBar";
import { StatsPanel } from "./StatsPanel";
import { PageViewRenderer } from "./PageViewRenderer";
import {
  alignListOperationWithPrompt,
  bindingForRole,
  operationForRole,
  operationKey,
  pageOperations,
  type RuntimeOperation,
} from "./pageOperations";
import { useLanguage } from "../../i18n/LanguageProvider";
import { MutationPanel } from "./MutationPanel";
import { resolveInteraction, usesOverlay, usesRedirect } from "./interactionModes";
import {
  antdTokenFor,
  isDarkThemeTokens,
  resolveThemeTokens,
  themeCssVariables,
} from "./themePresets";
import {
  buildListQuery,
  firstListSort,
  generatedActionPath,
  hasPageAccess,
  isGeneratedActionPath,
  listFilterParameters,
  type GeneratedAction,
  type PageSort,
} from "./pageRuntime";
import { resolvePageLayout } from "./pageLayout";
import type { QueryMeta } from "../../store/workbenchStore";
import { recordId } from "./recordIdentity";
import type { FieldErrors, MutationOutcome } from "./mutationOutcome";
import type { PageRuntimeState, RuntimeControls } from "./runtime/pageRuntimeState";
import {
  runtimeFromV1Definition,
  selectBatchIds,
  selectColumnMeta,
  selectDisplayColumns,
  selectDisplayRows,
  selectPaginationTotal,
  selectRowIdentities,
  selectRowWritesDisabled,
  selectRuntimeDiagnostics,
  selectScopeLabel,
  selectSelectedIndexes,
  selectStats,
  selectWritesDisabled,
} from "./runtime/runtimeSelectors";

function sameRows(left: string[][], right: string[][]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (row, index) =>
        row.length === right[index].length &&
        row.every((cell, cellIndex) => cell === right[index][cellIndex]),
    )
  );
}

function viewLabel(view: PageView, zh: boolean) {
  if ("title" in view && view.title) return view.title;
  if (view.type === "tabs") return zh ? "组合标签" : "Tabs";
  if (view.type === "split") return zh ? "分栏" : "Split";
  return view.type;
}

export function GeneratedPage({
  page,
  projectId,
  apiDocumentIds,
  isStreaming,
  fieldSchemas,
  grantedRoles,
  operations,
  detail,
  onDetail,
  onSaved,
  onQuery,
  onMutation,
  onDelete,
  querying,
  queryMeta,
  mutationStatus,
  mutationFieldErrors,
  runtime,
  onSelectionKeysChange,
  onRuntimeControls,
  modelId,
  templateId,
  templateName,
}: {
  page: PageSpec;
  projectId: string;
  apiDocumentIds: string[];
  isStreaming: boolean;
  fieldSchemas?: Record<string, FieldSchema[]>;
  grantedRoles?: string[];
  operations: RuntimeOperation[];
  detail: Record<string, unknown> | null;
  onDetail: (operation: RuntimeOperation, id: string) => void;
  onSaved: () => void;
  onQuery: (filters: Record<string, string>, operation?: RuntimeOperation) => void;
  onMutation: (
    operation: RuntimeOperation,
    body: string,
  ) => Promise<MutationOutcome | void> | MutationOutcome | void;
  onDelete: (
    operation: RuntimeOperation,
    id: string,
    confirmed?: boolean,
  ) => Promise<MutationOutcome | void> | MutationOutcome | void;
  querying: boolean;
  queryMeta: QueryMeta;
  mutationStatus?: "idle" | "submitting" | "success" | "error" | "unknown";
  mutationFieldErrors?: FieldErrors;
  runtime?: PageRuntimeState;
  onSelectionKeysChange?: (keys: string[]) => void;
  onRuntimeControls?: (controls: RuntimeControls) => void;
  modelId?: string;
  templateId?: string;
  templateName?: string;
}) {
  const { language } = useLanguage();
  const zh = language === "zh";
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [pageNumber, setPageNumber] = useState(1);
  const [localDetail, setLocalDetail] = useState<Record<string, string> | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewingRow, setViewingRow] = useState<string[] | null>(null);
  const [editingRow, setEditingRow] = useState<string[] | null>(null);
  const [deletingRow, setDeletingRow] = useState<string[] | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [dismissedDiagnostics, setDismissedDiagnostics] = useState("");
  const [theme, setTheme] = useState<ThemeStyle>(page.theme ?? "forge-default");
  const views = page.views?.length
    ? page.views
    : [{ type: "list" as const, title: zh ? "列表" : "List" }];
  const [activeViewIndex, setActiveViewIndex] = useState(0);
  const [sort, setSort] = useState<PageSort | null | undefined>(undefined);
  const layout = resolvePageLayout(page, isStreaming);
  // The definition is immutable here: all loaded data comes from runtime and is
  // projected into renderer shapes by selectors. Old callers fall back to a
  // read-only v1 adapter over definition sample rows.
  const resolvedRuntime = useMemo(
    () => runtime ?? runtimeFromV1Definition(page, queryMeta),
    [runtime, page, queryMeta],
  );
  const displayColumns = useMemo(
    () => selectDisplayColumns(resolvedRuntime, page),
    [resolvedRuntime, page],
  );
  const displayColumnMeta = useMemo(
    () => selectColumnMeta(resolvedRuntime, page),
    [resolvedRuntime, page],
  );
  const displayRows = useMemo(
    () => selectDisplayRows(resolvedRuntime, page),
    [resolvedRuntime, page],
  );
  const displayStats = useMemo(() => selectStats(resolvedRuntime, page), [resolvedRuntime, page]);
  const rowIdentities = useMemo(() => selectRowIdentities(resolvedRuntime), [resolvedRuntime]);
  const diagnostics = useMemo(
    () => selectRuntimeDiagnostics(resolvedRuntime, page),
    [resolvedRuntime, page],
  );
  const writesDisabled = selectWritesDisabled(resolvedRuntime);
  const rowWritesDisabled = selectRowWritesDisabled(resolvedRuntime);
  // A real runtime owns selection as typed keys; v1 callers keep it locally.
  const activeKeys = runtime ? resolvedRuntime.selectedRowKeys : selectedKeys;
  const selectedRows = useMemo(
    () => selectSelectedIndexes(resolvedRuntime, activeKeys),
    [resolvedRuntime, activeKeys],
  );
  const [localRows, setLocalRows] = useState<string[][]>(displayRows);
  const lastLoadedRows = useRef(displayRows);
  const handleSelectionChange = (indexes: Set<number>) => {
    const keys = [...indexes]
      .map((index) => rowIdentities[index]?.identity)
      .filter((key): key is string => Boolean(key));
    if (!runtime) setSelectedKeys(keys);
    onSelectionKeysChange?.(keys);
  };
  useEffect(() => {
    // Selection/controls updates replace the runtime object without changing
    // its records. Only reload local display rows when their values change.
    if (sameRows(lastLoadedRows.current, displayRows)) return;
    lastLoadedRows.current = displayRows;
    setLocalRows(displayRows);
    if (!runtime) setSelectedKeys([]);
  }, [displayRows, runtime]);
  useEffect(() => {
    setActiveViewIndex(0);
    setSort(undefined);
  }, [page.views]);
  useEffect(() => setTheme(page.theme ?? "forge-default"), [page.theme]);
  const themeTokens = useMemo(
    () => resolveThemeTokens(theme, theme === "custom" ? page.styleTokens : undefined),
    [page.styleTokens, theme],
  );
  const antdConfig = useMemo<ThemeConfig>(
    () => ({
      algorithm: isDarkThemeTokens(themeTokens)
        ? antdTheme.darkAlgorithm
        : antdTheme.defaultAlgorithm,
      token: antdTokenFor(themeTokens) as unknown as ThemeConfig["token"],
    }),
    [themeTokens],
  );
  useLayoutEffect(() => {
    const root = document.documentElement;
    const variables = themeCssVariables(themeTokens);
    const previous = new Map<string, string>();
    for (const [name, value] of Object.entries(variables)) {
      previous.set(name, root.style.getPropertyValue(name));
      root.style.setProperty(name, value);
    }
    return () => {
      for (const [name, oldValue] of previous) {
        if (oldValue) root.style.setProperty(name, oldValue);
        else root.style.removeProperty(name);
      }
    };
  }, [themeTokens]);
  useEffect(() => {
    if (isGeneratedActionPath(window.location.pathname))
      window.history.replaceState({}, "", "/generate");
    const onPopState = () => {
      if (isGeneratedActionPath(window.location.pathname)) return;
      setCreating(false);
      setViewingRow(null);
      setEditingRow(null);
      setDeletingRow(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const activeView = views[Math.min(activeViewIndex, views.length - 1)];
  const runtimePage = alignListOperationWithPrompt(page, page.title, operations);
  const boundOperations = isStreaming ? [] : pageOperations(runtimePage, operations);
  const listOperation = operationForRole(runtimePage, boundOperations, "list", "GET");
  const listBinding = bindingForRole(runtimePage, "list", "GET");
  const pageParam = listBinding?.pagination?.pageParam ?? "page";
  const sizeParam = listBinding?.pagination?.sizeParam ?? "pageSize";
  const defaultSize = listBinding?.pagination?.defaultSize ?? 100;
  const sortParam = listBinding?.sortParam;
  const apiFilters = listFilterParameters(
    listOperation?.queryParameters,
    pageParam,
    sizeParam,
    sortParam,
  );
  const filtersForList = apiFilters ?? page.filters;
  const createOperation = operationForRole(page, boundOperations, "create", "POST");
  const deleteOperation = operationForRole(page, boundOperations, "delete", "DELETE", true);
  const detailOperation = operationForRole(page, boundOperations, "detail", "GET", true);
  const editOperation =
    operationForRole(page, boundOperations, "update", "PUT", true) ||
    operationForRole(page, boundOperations, "update", "PATCH", true);
  const isCrudPage = Boolean(createOperation || editOperation || deleteOperation);
  const interaction = resolveInteraction(page, isCrudPage);
  const rowRecord = (row: string[]) =>
    Object.fromEntries(displayColumns.map((column, index) => [column, row[index] || ""]));
  // Prefer the typed runtime identity over a display-column heuristic.
  const rowId = (row: string[]) => {
    const index = localRows.indexOf(row);
    const identity = rowIdentities[index];
    return identity ? String(identity.value) : recordId(displayColumns, row);
  };
  const batchActions = isStreaming ? [] : (page.batchActions ?? []);
  const activeSort = sort === undefined ? firstListSort(activeView) : sort;
  const runListQuery = (nextPage: number, nextSort: PageSort | null = activeSort) => {
    if (isStreaming) return;
    // A new query replaces the loaded records; never carry a selection over.
    onSelectionKeysChange?.([]);
    if (!runtime) setSelectedKeys([]);
    onRuntimeControls?.({
      page: nextPage,
      pageSize: defaultSize,
      filters,
      sort: nextSort ? { column: nextSort.column, order: nextSort.order } : null,
    });
    onQuery(
      buildListQuery({
        filters,
        page: nextPage,
        size: defaultSize,
        pageParam,
        sizeParam,
        sortParam,
        sort: nextSort,
        queryParameters: listOperation?.queryParameters,
      }),
      listOperation,
    );
  };
  const deletingPage = useRef<{ page: number; rows: number } | null>(null);
  /** Success refreshes the original query; a non-success result is left to the form. */
  const handleMutation = async (
    operation: RuntimeOperation,
    body: string,
  ): Promise<MutationOutcome | void> => {
    const outcome = await onMutation(operation, body);
    if (outcome === "success" && !deletingPage.current) runListQuery(pageNumber);
    return outcome;
  };
  /** Deleting the last row of the last page steps back once, then refreshes. */
  const handleDelete = async (
    operation: RuntimeOperation,
    id: string,
    confirmed?: boolean,
  ): Promise<MutationOutcome | void> => {
    deletingPage.current = { page: pageNumber, rows: displayRows.length };
    try {
      const outcome = await onDelete(operation, id, confirmed);
      const target = deletingPage.current;
      if (outcome === "success" && target) {
        const page = target.rows <= 1 && target.page > 1 ? target.page - 1 : target.page;
        setPageNumber(page);
        runListQuery(page);
      }
      return outcome;
    } finally {
      deletingPage.current = null;
    }
  };
  const openRedirect = (action: GeneratedAction, id?: string) => {
    window.history.pushState({ forgeGeneratedAction: action }, "", generatedActionPath(action, id));
  };
  const closeAction = (action: GeneratedAction, close: () => void) => {
    close();
    if (usesRedirect(interaction[action]) && isGeneratedActionPath(window.location.pathname))
      window.history.back();
  };
  const openAction = (action: GeneratedAction, row: string[] | null = null) => {
    setCreating(action === "create");
    setViewingRow(action === "detail" ? row : null);
    setEditingRow(action === "update" ? row : null);
    setDeletingRow(action === "delete" ? row : null);
  };
  const redirectAction: GeneratedAction | null =
    creating && usesRedirect(interaction.create)
      ? "create"
      : editingRow && usesRedirect(interaction.update)
        ? "update"
        : deletingRow && usesRedirect(interaction.delete)
          ? "delete"
          : viewingRow && usesRedirect(interaction.detail)
            ? "detail"
            : null;
  const canAccess = hasPageAccess(page.permissionRole, grantedRoles);
  const showStats = !isCrudPage && displayStats.length > 0;
  const hasRailContent = filtersForList.length > 0 || showStats;
  const crudListView = views.find((view) => view.type === "list") ?? {
    type: "list" as const,
    title: zh ? "列表" : "List",
  };
  const renderedViews = isCrudPage ? [crudListView] : views;
  const renderedActiveView = isCrudPage ? crudListView : activeView;
  // No total is ever inferred from the loaded page size.
  const paginationTotal = selectPaginationTotal(resolvedRuntime);
  const runtimeStatus = resolvedRuntime.query.status;
  const scopeLabel = selectScopeLabel(resolvedRuntime, zh);
  const statusError =
    resolvedRuntime.error?.message ?? (runtimeStatus === "error" ? queryMeta.error : undefined);
  const runtimeTruncated = resolvedRuntime.truncated.rows || resolvedRuntime.truncated.columns;
  // Status messages above already carry these codes; the list stays single-sourced.
  const visibleDiagnostics = diagnostics.filter(
    (item) =>
      ![
        "runtime.query.failed",
        "runtime.query.cancelled",
        "runtime.binding.unbound",
        "runtime.result.truncated",
      ].includes(item.code),
  );
  // A new terminal signature re-opens the list, so a dismissed diagnostic
  // never hides a later, different failure.
  const diagnosticSignature = diagnostics
    .map((item) => `${item.area}:${item.code}:${item.message}`)
    .join("|");
  const diagnosticsDismissed = dismissedDiagnostics === diagnosticSignature;
  const onBatchAction = (
    action: NonNullable<PageSpec["batchActions"]>[number],
    rowIndexes: number[],
  ) => {
    if (isStreaming || querying || writesDisabled || rowWritesDisabled) return;
    const ids = selectBatchIds(resolvedRuntime, rowIndexes);
    if (!ids.length) return;
    const message =
      action.confirmMessage ??
      (zh
        ? `确定对 ${ids.length} 条记录执行批量操作吗？`
        : `Run this batch action on ${ids.length} records?`);
    if (!window.confirm(message)) return;
    const body =
      action.payloadBuilder.type === "ids"
        ? JSON.stringify({ ids })
        : (action.payloadBuilder.customPayload ?? JSON.stringify({ ids }));
    void handleMutation(
      {
        key: operationKey(action.method, action.path, action.operation_id),
        method: action.method,
        path: action.path,
        operationId: action.operation_id,
        apiDocumentId: action.apiDocumentId,
      },
      body,
    );
    if (!runtime) setSelectedKeys([]);
    onSelectionKeysChange?.([]);
  };
  if (!canAccess)
    return (
      <section
        className={`generated-page generated-page--${layout} generated-page--denied`}
        data-layout={layout}
        data-permission-role={page.permissionRole}
      >
        <div className="permission-state" role="alert">
          <LockKeyhole size={22} aria-hidden="true" />
          <div>
            <h3>{zh ? "无权查看此生成页面" : "You cannot view this generated page"}</h3>
            <p>
              {zh
                ? `当前业务连接未授予角色“${page.permissionRole}”。请在业务连接中配置当前用户角色后重试；接口权限仍由服务端校验。`
                : `The current business connection does not grant the “${page.permissionRole}” role. Add the current user role in Business connection and try again; the server remains authoritative for API access.`}
            </p>
          </div>
        </div>
      </section>
    );

  const mutationPanel = (
    <MutationPanel
      page={page}
      zh={zh}
      displayColumns={displayColumns}
      identityForRow={rowId}
      fieldErrors={mutationFieldErrors}
      submitting={mutationStatus === "submitting"}
      fieldSchemas={fieldSchemas}
      interaction={interaction}
      createOperation={createOperation}
      editOperation={editOperation}
      deleteOperation={deleteOperation}
      detailOperation={detailOperation}
      detail={detail}
      localDetail={localDetail}
      creating={creating}
      editingRow={editingRow}
      deletingRow={deletingRow}
      viewingRow={viewingRow}
      onCloseCreate={() => closeAction("create", () => setCreating(false))}
      onCloseEdit={() => closeAction("update", () => setEditingRow(null))}
      onCloseDelete={() => closeAction("delete", () => setDeletingRow(null))}
      onCloseDetail={() => closeAction("detail", () => setViewingRow(null))}
      onRowsChange={setLocalRows}
      onDetail={(...args) => {
        if (!isStreaming) onDetail(...args);
      }}
      onMutation={(...args) => {
        if (!isStreaming && !querying && !writesDisabled) return handleMutation(...args);
        return "skipped" as const;
      }}
      onDelete={(...args) => {
        if (!isStreaming && !querying && !writesDisabled) return handleDelete(...args);
        return "skipped" as const;
      }}
    />
  );

  return (
    <ConfigProvider theme={antdConfig}>
      <section
        className={`generated-page generated-page--${layout}${isCrudPage ? " generated-page--crud" : ""}${isStreaming ? " is-streaming" : ""}`}
        data-layout={layout}
        data-mode={isStreaming ? "preview" : "live"}
        data-permission-role={page.permissionRole || undefined}
        aria-busy={isStreaming}
      >
        {!redirectAction && (
          <PageHeader
            page={{ ...page, theme }}
            projectId={projectId}
            apiDocumentIds={apiDocumentIds}
            isStreaming={isStreaming}
            modelId={modelId}
            templateId={templateId}
            templateName={templateName}
            zh={zh}
            onSaved={onSaved}
            theme={theme}
            onThemeChange={setTheme}
            loadingData={querying}
            displayColumns={displayColumns}
            displayRows={displayRows}
            dataScope={
              resolvedRuntime.source === "definition" ? "definition-sample" : "current-page"
            }
            onLoadData={
              listOperation
                ? () => {
                    setPageNumber(1);
                    runListQuery(1);
                  }
                : undefined
            }
            showPageActions
          />
        )}
        {isStreaming && (
          <div className="streaming-progress" role="status">
            {zh
              ? "正在接收并校验 PageSpec 草稿，完成前所有业务操作均已禁用。"
              : "Receiving and validating the PageSpec draft. Business actions remain disabled until completion."}
          </div>
        )}
        {!isStreaming && (
          <div className="runtime-status" aria-live="polite">
            <span className="runtime-scope" data-source={resolvedRuntime.source}>
              {scopeLabel}
            </span>
            {statusError && <p role="alert">{statusError}</p>}
            {runtimeStatus === "empty" && (
              <p role="status">
                {zh ? "查询成功，没有匹配的数据" : "Query succeeded: no matching data"}
              </p>
            )}
            {runtimeStatus === "cancelled" && (
              <p role="status">
                {zh
                  ? "查询已取消，请重新加载后操作"
                  : "Query cancelled; reload before making changes"}
              </p>
            )}
            {resolvedRuntime.stale && (
              <p role="status">
                {zh
                  ? "当前展示上次成功结果（已过期），写入已禁用"
                  : "Showing the last successful result (stale); writes are disabled"}
              </p>
            )}
            {resolvedRuntime.unbound && (
              <p role="alert">
                {zh
                  ? "未绑定可用查询接口，已禁用写入"
                  : "No usable list binding; writes are disabled"}
              </p>
            )}
            {runtimeTruncated && (
              <p role="status">
                {zh ? "当前加载结果已截断（" : "Loaded result was truncated ("}
                {resolvedRuntime.truncated.rows ? (zh ? "行数超限" : "row limit") : ""}
                {resolvedRuntime.truncated.rows && resolvedRuntime.truncated.columns ? " · " : ""}
                {resolvedRuntime.truncated.columns ? (zh ? "字段超限" : "column limit") : ""}
                {zh ? "）。" : ")."}
              </p>
            )}
            {visibleDiagnostics.length > 0 && !diagnosticsDismissed && (
              <div className="runtime-diagnostics" role="status">
                <button
                  type="button"
                  className="runtime-diagnostics-close"
                  aria-label={zh ? "关闭数据诊断" : "Dismiss data diagnostics"}
                  onClick={() => setDismissedDiagnostics(diagnosticSignature)}
                >
                  ×
                </button>
                <ul>
                  {visibleDiagnostics.map((item) => (
                    <li key={`${item.area}:${item.code}`} data-diagnostic-code={item.code}>
                      {item.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <fieldset className="streaming-content" disabled={isStreaming}>
          {redirectAction ? (
            <div className="generated-redirect-view">
              <Button
                className="redirect-back"
                icon={<ArrowLeft size={14} />}
                onClick={() =>
                  closeAction(redirectAction, () => {
                    setCreating(false);
                    setViewingRow(null);
                    setEditingRow(null);
                    setDeletingRow(null);
                  })
                }
              >
                {zh ? "返回列表" : "Back to list"}
              </Button>
              {mutationPanel}
            </div>
          ) : (
            <div
              className={`generated-page-workspace${hasRailContent ? "" : " generated-page-workspace--single"}`}
            >
              {hasRailContent && (
                <aside className="generated-page-rail">
                  {filtersForList.length > 0 && (
                    <FilterBar
                      filters={filtersForList}
                      values={filters}
                      querying={querying}
                      zh={zh}
                      onChange={(name, value) =>
                        setFilters((current) => ({ ...current, [name]: value }))
                      }
                      onQuery={() => {
                        setPageNumber(1);
                        runListQuery(1);
                      }}
                      onReset={() => {
                        setFilters({});
                        setPageNumber(1);
                      }}
                    />
                  )}
                  {showStats && <StatsPanel stats={displayStats} zh={zh} />}
                </aside>
              )}
              <div className="generated-page-main">
                {isCrudPage && (
                  <div className="generated-command-bar">
                    <div className="generated-command-bar__primary">
                      {createOperation && interaction.create !== "inline" && (
                        <Button
                          type="primary"
                          icon={<Plus size={15} />}
                          onClick={() => {
                            // Creating does not depend on an existing row identity.
                            if (isStreaming || querying || writesDisabled) return;
                            openAction("create");
                            if (usesRedirect(interaction.create)) openRedirect("create");
                          }}
                        >
                          {zh ? "新建" : "New"}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                {renderedViews.length > 1 && (
                  <div className="view-tabs" role="tablist">
                    {renderedViews.map((view, index) => (
                      <button
                        key={`${view.type}-${index}`}
                        type="button"
                        className={activeViewIndex === index ? "active" : ""}
                        role="tab"
                        aria-selected={activeViewIndex === index}
                        onClick={() => {
                          setActiveViewIndex(index);
                          setSort(undefined);
                        }}
                      >
                        {viewLabel(view, zh)}
                      </button>
                    ))}
                  </div>
                )}
                {isStreaming && page.columns.length === 0 ? (
                  <div className="streaming-table-skeleton" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                ) : (
                  <PageViewRenderer
                    view={renderedActiveView}
                    columns={displayColumns}
                    columnMeta={displayColumnMeta}
                    rows={localRows}
                    batchActions={batchActions}
                    selectedRows={selectedRows}
                    onSelectionChange={handleSelectionChange}
                    onBatchAction={onBatchAction}
                    serverSort={Boolean(sortParam)}
                    onSortChange={(nextSort) => {
                      setSort(nextSort);
                      setPageNumber(1);
                      if (sortParam) runListQuery(1, nextSort);
                    }}
                    onRowsChange={setLocalRows}
                    onView={(row) => {
                      if (isStreaming || querying || writesDisabled || rowWritesDisabled) return;
                      setLocalDetail(rowRecord(row));
                      if (usesOverlay(interaction.detail) || usesRedirect(interaction.detail)) {
                        openAction("detail", row);
                        if (usesRedirect(interaction.detail)) openRedirect("detail", rowId(row));
                      }
                      if (detailOperation && rowId(row)) onDetail(detailOperation, rowId(row));
                    }}
                    onEdit={(row) => {
                      if (isStreaming || querying || writesDisabled || rowWritesDisabled) return;
                      openAction("update", row);
                      if (usesRedirect(interaction.update)) openRedirect("update", rowId(row));
                    }}
                    onDelete={
                      deleteOperation
                        ? (row) => {
                            if (isStreaming || querying || writesDisabled || rowWritesDisabled)
                              return;
                            openAction("delete", row);
                            if (usesRedirect(interaction.delete))
                              openRedirect("delete", rowId(row));
                          }
                        : undefined
                    }
                  />
                )}
                {!isStreaming &&
                  listOperation &&
                  (paginationTotal === undefined ? (
                    <div className="pagination pagination--unknown-total">
                      <span className="muted">
                        {zh
                          ? "接口未提供总数，仅按已加载结果翻页"
                          : "No total reported; paging follows loaded results only"}
                      </span>
                      <Button
                        size="small"
                        disabled={querying || pageNumber <= 1}
                        onClick={() => {
                          const previous = pageNumber - 1;
                          setPageNumber(previous);
                          runListQuery(previous);
                        }}
                      >
                        {zh ? "上一页" : "Previous"}
                      </Button>
                      <span>{zh ? `第 ${pageNumber} 页` : `Page ${pageNumber}`}</span>
                      <Button
                        size="small"
                        disabled={querying || displayRows.length < defaultSize}
                        onClick={() => {
                          const next = pageNumber + 1;
                          setPageNumber(next);
                          runListQuery(next);
                        }}
                      >
                        {zh ? "下一页" : "Next"}
                      </Button>
                    </div>
                  ) : (
                    <div className="pagination">
                      <Pagination
                        current={pageNumber}
                        pageSize={defaultSize}
                        total={paginationTotal}
                        showSizeChanger={false}
                        showQuickJumper={!zh}
                        disabled={querying}
                        showTotal={(total) => (zh ? `共 ${total} 条` : `${total} items`)}
                        onChange={(nextPage) => {
                          setPageNumber(nextPage);
                          runListQuery(nextPage);
                        }}
                      />
                    </div>
                  ))}
                {!isStreaming && mutationPanel}
              </div>
            </div>
          )}
        </fieldset>
      </section>
    </ConfigProvider>
  );
}
