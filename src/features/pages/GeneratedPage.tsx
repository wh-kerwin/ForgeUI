import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, LockKeyhole, Plus } from "lucide-react";
import { Button, Pagination } from "antd";
import type { FieldSchema, PageSpec, PageView, ThemeStyle } from "../../types/domain";
import { PageHeader } from "./PageHeader";
import { FilterBar } from "./FilterBar";
import { StatsPanel } from "./StatsPanel";
import { PageViewRenderer } from "./PageViewRenderer";
import { alignListOperationWithPrompt, bindingForRole, operationForRole, operationKey, pageOperations, type RuntimeOperation } from "./pageOperations";
import { useLanguage } from "../../i18n/LanguageProvider";
import { MutationPanel } from "./MutationPanel";
import { resolveInteraction, usesOverlay, usesRedirect } from "./interactionModes";
import { resolveThemeTokens, themeCssVariables } from "./themePresets";
import { buildListQuery, firstListSort, generatedActionPath, hasPageAccess, isGeneratedActionPath, listFilterParameters, type GeneratedAction, type PageSort } from "./pageRuntime";
import { resolvePageLayout } from "./pageLayout";
import type { QueryMeta } from "../../store/workbenchStore";
import { recordId } from "./recordIdentity";

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
  modelId,
  templateId,
  templateName,
  onRefine,
  refining,
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
  onMutation: (operation: RuntimeOperation, body: string) => void;
  onDelete: (operation: RuntimeOperation, id: string, confirmed?: boolean) => void;
  querying: boolean;
  queryMeta: QueryMeta;
  modelId?: string;
  templateId?: string;
  templateName?: string;
  onRefine: (instruction: string) => Promise<void>;
  refining: boolean;
	}) {
  const { language } = useLanguage();
  const zh = language === "zh";
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [pageNumber, setPageNumber] = useState(1);
  const [localDetail, setLocalDetail] = useState<Record<string, string> | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewingRow, setViewingRow] = useState<string[] | null>(null);
  const [editingRow, setEditingRow] = useState<string[] | null>(null);
  const [localRows, setLocalRows] = useState(page.rows);
  const [deletingRow, setDeletingRow] = useState<string[] | null>(null);
	  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
	  const [theme, setTheme] = useState<ThemeStyle>(page.theme ?? "forge-default");
	  const views = page.views?.length ? page.views : [{ type: "list" as const, title: zh ? "列表" : "List" }];
	  const [activeViewIndex, setActiveViewIndex] = useState(0);
	  const [sort, setSort] = useState<PageSort | null>(null);
  const layout = resolvePageLayout(page, isStreaming);
  useEffect(() => { setLocalRows(page.rows); setSelectedRows(new Set()); }, [page.rows]);
	  useEffect(() => { setActiveViewIndex(0); setSort(null); }, [page.views]);
  useEffect(() => setTheme(page.theme ?? "forge-default"), [page.theme]);
  const themeTokens = useMemo(() => resolveThemeTokens(theme, theme === "custom" ? page.styleTokens : undefined), [page.styleTokens, theme]);
	  useEffect(() => {
    const root = document.documentElement;
    const variables = themeCssVariables(themeTokens);
    Object.entries(variables).forEach(([name, value]) => root.style.setProperty(name, value));
    root.dataset.density = themeTokens.density ?? "comfortable";
    return () => { Object.keys(variables).forEach((name) => root.style.removeProperty(name)); delete root.dataset.density; };
	  }, [themeTokens]);
	  useEffect(() => {
	    if (isGeneratedActionPath(window.location.pathname)) window.history.replaceState({}, "", "/generate");
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
  const boundOperations = pageOperations(runtimePage, operations);
  const listOperation = operationForRole(runtimePage, boundOperations, "list", "GET");
  const listBinding = bindingForRole(runtimePage, "list", "GET");
	  const pageParam = listBinding?.pagination?.pageParam ?? "page";
	  const sizeParam = listBinding?.pagination?.sizeParam ?? "pageSize";
	  const defaultSize = listBinding?.pagination?.defaultSize ?? 100;
	  const sortParam = listBinding?.sortParam;
	  const apiFilters = listFilterParameters(listOperation?.queryParameters, pageParam, sizeParam, sortParam);
	  const filtersForList = apiFilters ?? page.filters;
  const createOperation = operationForRole(page, boundOperations, "create", "POST");
  const deleteOperation = operationForRole(page, boundOperations, "delete", "DELETE", true);
  const detailOperation = operationForRole(page, boundOperations, "detail", "GET", true);
  const editOperation = operationForRole(page, boundOperations, "update", "PUT", true) || operationForRole(page, boundOperations, "update", "PATCH", true);
	  const isCrudPage = Boolean(createOperation || editOperation || deleteOperation);
	  const interaction = resolveInteraction(page, isCrudPage);
  const rowRecord = (row: string[]) => Object.fromEntries(page.columns.map((column, index) => [column, row[index] || ""]));
  const rowId = (row: string[]) => recordId(page.columns, row);
	  const batchActions = page.batchActions ?? [];
	  const activeSort = sort ?? firstListSort(activeView);
	  const runListQuery = (nextPage: number, nextSort: PageSort | null = activeSort) => onQuery(buildListQuery({ filters, page: nextPage, size: defaultSize, pageParam, sizeParam, sortParam, sort: nextSort, queryParameters: listOperation?.queryParameters }), listOperation);
	  const openRedirect = (action: GeneratedAction, id?: string) => {
	    window.history.pushState({ forgeGeneratedAction: action }, "", generatedActionPath(action, id));
	  };
	  const closeAction = (action: GeneratedAction, close: () => void) => {
	    close();
	    if (usesRedirect(interaction[action]) && isGeneratedActionPath(window.location.pathname)) window.history.back();
	  };
	  const redirectAction: GeneratedAction | null = creating && usesRedirect(interaction.create) ? "create"
	    : editingRow && usesRedirect(interaction.update) ? "update"
	      : deletingRow && usesRedirect(interaction.delete) ? "delete"
	        : viewingRow && usesRedirect(interaction.detail) ? "detail"
	          : null;
	  const canAccess = hasPageAccess(page.permissionRole, grantedRoles);
	  const showStats = !isCrudPage && page.stats.length > 0;
	  const hasRailContent = filtersForList.length > 0 || showStats;
	  const crudListView = views.find((view) => view.type === "list") ?? { type: "list" as const, title: zh ? "列表" : "List" };
	  const renderedViews = isCrudPage ? [crudListView] : views;
	  const renderedActiveView = isCrudPage ? crudListView : activeView;
	  const paginationTotal = queryMeta.total ?? ((pageNumber - 1) * defaultSize) + localRows.length + (localRows.length === defaultSize ? 1 : 0);
  const onBatchAction = (action: NonNullable<PageSpec["batchActions"]>[number], rowIndexes: number[]) => {
    const ids = rowIndexes.map((index) => rowId(localRows[index])).filter(Boolean);
    if (!ids.length) return;
    const message = action.confirmMessage ?? (zh ? `确定对 ${ids.length} 条记录执行批量操作吗？` : `Run this batch action on ${ids.length} records?`);
    if (!window.confirm(message)) return;
    const body = action.payloadBuilder.type === "ids" ? JSON.stringify({ ids }) : action.payloadBuilder.customPayload ?? JSON.stringify({ ids });
    onMutation({
      key: operationKey(action.method, action.path, action.operation_id),
      method: action.method,
      path: action.path,
      operationId: action.operation_id,
      apiDocumentId: action.apiDocumentId,
    }, body);
    setSelectedRows(new Set());
  };
	  if (!canAccess) return (
	    <section className={`generated-page generated-page--${layout} generated-page--denied`} data-layout={layout} data-permission-role={page.permissionRole}>
	      <div className="permission-state" role="alert">
	        <LockKeyhole size={22} aria-hidden="true" />
	        <div><h3>{zh ? "无权查看此生成页面" : "You cannot view this generated page"}</h3><p>{zh ? `当前业务连接未授予角色“${page.permissionRole}”。请在业务连接中配置当前用户角色后重试；接口权限仍由服务端校验。` : `The current business connection does not grant the “${page.permissionRole}” role. Add the current user role in Business connection and try again; the server remains authoritative for API access.`}</p></div>
	      </div>
	    </section>
	  );

	  const mutationPanel = <MutationPanel page={page} zh={zh} fieldSchemas={fieldSchemas} interaction={interaction} createOperation={createOperation} editOperation={editOperation} deleteOperation={deleteOperation} detailOperation={detailOperation} detail={detail} localDetail={localDetail} creating={creating} editingRow={editingRow} deletingRow={deletingRow} viewingRow={viewingRow} onCloseCreate={() => closeAction("create", () => setCreating(false))} onCloseEdit={() => closeAction("update", () => setEditingRow(null))} onCloseDelete={() => closeAction("delete", () => setDeletingRow(null))} onCloseDetail={() => closeAction("detail", () => setViewingRow(null))} onRowsChange={setLocalRows} onDetail={onDetail} onMutation={onMutation} onDelete={onDelete} />;

	  return (
    <section className={`generated-page generated-page--${layout}${isCrudPage ? " generated-page--crud" : ""}${isStreaming ? " is-streaming" : ""}`} data-layout={layout} data-permission-role={page.permissionRole || undefined} aria-busy={isStreaming}>
      {!redirectAction && <PageHeader page={{ ...page, theme }} projectId={projectId} apiDocumentIds={apiDocumentIds} isStreaming={isStreaming} modelId={modelId} templateId={templateId} templateName={templateName} zh={zh} onSaved={onSaved} theme={theme} onThemeChange={setTheme} loadingData={querying} onLoadData={listOperation ? () => { setPageNumber(1); runListQuery(1); } : undefined} showPageActions />}
	      {isStreaming && <div className="streaming-progress" role="status">{zh ? "正在接收并校验 PageSpec 草稿，完成前所有业务操作均已禁用。" : "Receiving and validating the PageSpec draft. Business actions remain disabled until completion."}</div>}
	      <fieldset className="streaming-content" disabled={isStreaming}>
	      {redirectAction ? <div className="generated-redirect-view"><button type="button" className="secondary redirect-back" onClick={() => closeAction(redirectAction, () => { setCreating(false); setViewingRow(null); setEditingRow(null); setDeletingRow(null); })}><ArrowLeft size={14} />{zh ? "返回列表" : "Back to list"}</button>{mutationPanel}</div> : <div className={`generated-page-workspace${hasRailContent ? "" : " generated-page-workspace--single"}`}>
      {hasRailContent && <aside className="generated-page-rail">{filtersForList.length > 0 && <FilterBar filters={filtersForList} values={filters} querying={querying} zh={zh} onChange={(name, value) => setFilters((current) => ({ ...current, [name]: value }))} onQuery={() => { setPageNumber(1); runListQuery(1); }} onReset={() => { setFilters({}); setPageNumber(1); }} />}{showStats && <StatsPanel stats={page.stats} />}</aside>}
		      <div className="generated-page-main">
		      {isCrudPage && <div className="generated-command-bar">
		        <div className="generated-command-bar__primary">
		          {createOperation && interaction.create !== "inline" && <Button type="primary" icon={<Plus size={15} />} onClick={() => { setCreating(true); if (usesRedirect(interaction.create)) openRedirect("create"); }}>{zh ? "新建" : "New"}</Button>}
		        </div>
		      </div>}
	      {renderedViews.length > 1 && <div className="view-tabs" role="tablist">{renderedViews.map((view, index) => <button key={`${view.type}-${index}`} type="button" className={activeViewIndex === index ? "active" : ""} role="tab" aria-selected={activeViewIndex === index} onClick={() => { setActiveViewIndex(index); setSort(null); }}>{viewLabel(view, zh)}</button>)}</div>}
	      {isStreaming && page.columns.length === 0 ? <div className="streaming-table-skeleton" aria-hidden="true"><span /><span /><span /><span /></div> : <PageViewRenderer view={renderedActiveView} columns={page.columns} columnMeta={page.columnMeta} rows={localRows} batchActions={batchActions} selectedRows={selectedRows} onSelectionChange={setSelectedRows} onBatchAction={onBatchAction} onSortChange={(nextSort) => { setSort(nextSort); setPageNumber(1); if (sortParam) runListQuery(1, nextSort); }} onRowsChange={setLocalRows} onView={(row) => { setLocalDetail(rowRecord(row)); if (usesOverlay(interaction.detail) || usesRedirect(interaction.detail)) { setViewingRow(row); if (usesRedirect(interaction.detail)) openRedirect("detail", rowId(row)); } if (detailOperation && rowId(row)) onDetail(detailOperation, rowId(row)); }} onEdit={(row) => { setEditingRow(row); if (usesRedirect(interaction.update)) openRedirect("update", rowId(row)); }} onDelete={deleteOperation ? (row) => { setDeletingRow(row); if (usesRedirect(interaction.delete)) openRedirect("delete", rowId(row)); } : undefined} />}
	      {!isStreaming && listOperation && <div className="pagination"><Pagination current={pageNumber} pageSize={defaultSize} total={paginationTotal} showSizeChanger={false} showQuickJumper={!zh} disabled={querying} showTotal={(total) => zh ? `共 ${total} 条` : `${total} items`} onChange={(nextPage) => { setPageNumber(nextPage); runListQuery(nextPage); }} /></div>}
	      {!isStreaming && mutationPanel}
	      </div>
	      </div>}
	      </fieldset>
    </section>
  );
}
