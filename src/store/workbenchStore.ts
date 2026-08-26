import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { ApiDocument, LoadingState, PageSpec } from "../types/domain";
import type { RuntimeOperation } from "../features/pages/pageOperations";
import { mapRealDataResponse } from "./realDataMapping";

type ApiContext = {
  projectId: string;
  apiDocuments: ApiDocument[];
  onNotice: (message: string) => void;
};

export type QueryMeta = { total?: number };

type WorkbenchState = {
  page: PageSpec | null;
  detail: Record<string, unknown> | null;
  querying: boolean;
  queryMeta: QueryMeta;
  loadingState: LoadingState;
  apiContext: ApiContext | null;
  setPage: (page: PageSpec | null | ((current: PageSpec | null) => PageSpec | null)) => void;
  setDetail: (detail: Record<string, unknown> | null) => void;
  setQuerying: (querying: boolean) => void;
  setLoadingState: (loadingState: LoadingState) => void;
  configureApi: (context: ApiContext) => void;
  cancelPendingQuery: () => void;
  query: (filters?: Record<string, string>, operation?: RuntimeOperation) => Promise<void>;
  loadDetail: (operation: RuntimeOperation, id: string) => Promise<void>;
  mutate: (operation: RuntimeOperation, text: string) => Promise<void>;
  deleteRecord: (operation: RuntimeOperation, id: string, confirmed?: boolean) => Promise<void>;
};

let queryTimer: ReturnType<typeof setTimeout> | undefined;
let queryDelayResolve: (() => void) | undefined;
let querySequence = 0;

type DocumentResolution =
  | { ok: true; document: ApiDocument; error?: never }
  | { ok: false; document?: never; error: string };

export function resolveApiDocument(projectId: string, apiDocuments: ApiDocument[], operation: RuntimeOperation): DocumentResolution {
  if (!projectId) return { ok: false, error: "请先选择项目" };
  const projectDocuments = apiDocuments.filter((document) => document.projectId === projectId);
  let document: ApiDocument | undefined;
  if (operation.apiDocumentId) {
    document = projectDocuments.find((candidate) => candidate.id === operation.apiDocumentId);
    if (!document) return { ok: false, error: "当前项目中找不到页面绑定的 API 文档，请重新绑定接口" };
    if (!document.auth.authorizedOperations?.includes(operation.key)) {
      return { ok: false, error: `API 文档“${document.name}”未授权接口“${operation.key}”` };
    }
  } else {
    const matches = projectDocuments.filter((candidate) => candidate.auth.authorizedOperations?.includes(operation.key));
    if (matches.length === 0) return { ok: false, error: `当前项目中没有授权接口“${operation.key}”的 API 文档` };
    if (matches.length > 1) return { ok: false, error: `旧页面的接口“${operation.key}”匹配到多个 API 文档，请重新生成页面或重新绑定接口` };
    document = matches[0];
  }
  if (!document.enabled) return { ok: false, error: `API 文档“${document.name}”已停用，请先启用后重试` };
  return { ok: true, document };
}

export function buildApiRequest(projectId: string, apiDocumentId: string, url: string, operation: RuntimeOperation, body?: unknown) {
  return {
    url,
    method: operation.method,
    body,
    headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    project_id: projectId,
    api_document_id: apiDocumentId,
    operation_key: operation.key,
  };
}

function request(context: ApiContext, document: ApiDocument, url: string, operation: RuntimeOperation, body?: unknown) {
  return invoke<{ status: number; body: unknown }>("execute_api", {
    request: buildApiRequest(context.projectId, document.id, url, operation, body),
  });
}

export function operationUrl(document: ApiDocument, path: string) {
  const base = (document.auth.apiBaseUrl || document.spec.api_base_url || "").replace(/\/$/, "");
  if (!base) return "";
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

type RequestResolution =
  | { ok: true; context: ApiContext; document: ApiDocument; operation: RuntimeOperation; url: string; error?: never }
  | { ok: false; error: string; context?: never; document?: never; operation?: never; url?: never };

function resolveRequest(context: ApiContext | null, operation?: RuntimeOperation): RequestResolution {
  if (!context) return { ok: false, error: "请先选择项目并导入 API 文档" };
  if (!operation) return { ok: false, error: "当前页面没有可用的 API 接口绑定" };
  const resolution = resolveApiDocument(context.projectId, context.apiDocuments, operation);
  if (!resolution.ok) return resolution;
  const url = operationUrl(resolution.document, operation.path);
  if (!url) return { ok: false, error: `API 文档“${resolution.document.name}”缺少服务地址` };
  return { ok: true, context, document: resolution.document, operation, url };
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  page: null,
  detail: null,
  querying: false,
  queryMeta: {},
  loadingState: "idle",
  apiContext: null,
  setPage: (page) => set((state) => ({ page: typeof page === "function" ? page(state.page) : page })),
  setDetail: (detail) => set({ detail }),
  setQuerying: (querying) => set({ querying }),
  setLoadingState: (loadingState) => set({ loadingState, querying: loadingState === "querying" }),
  configureApi: (apiContext) => set({ apiContext }),
  cancelPendingQuery: () => {
    if (queryTimer) clearTimeout(queryTimer);
    queryDelayResolve?.();
    queryTimer = undefined;
    queryDelayResolve = undefined;
    querySequence += 1;
    set({ querying: false, loadingState: "idle" });
  },
  query: async (filters = {}, operation) => {
    const sequence = ++querySequence;
    if (queryTimer) clearTimeout(queryTimer);
    queryDelayResolve?.();
    await new Promise<void>((resolve) => {
      queryDelayResolve = resolve;
      queryTimer = setTimeout(resolve, 300);
    });
    if (sequence !== querySequence) return;
    queryDelayResolve = undefined;
    queryTimer = undefined;
    const context = get().apiContext;
    const resolved = resolveRequest(context, operation);
    if (!resolved.ok) {
      set({ querying: false, loadingState: "idle" });
      context?.onNotice(resolved.error);
      return;
    }
    const queryString = new URLSearchParams(Object.entries(filters).filter(([, value]) => value.trim())).toString();
    set({ querying: true, loadingState: "querying" });
    try {
      const response = await request(resolved.context, resolved.document, `${resolved.url}${queryString ? `?${queryString}` : ""}`, resolved.operation);
      if (sequence !== querySequence) return;
      const mapped = mapRealDataResponse(response.body);
      if (!mapped) return resolved.context.onNotice("业务 API 返回空数据");
      set((state) => ({ page: state.page ? {
        ...state.page,
        columns: mapped.columns,
        columnMeta: state.page.columnMeta?.filter((meta) => mapped.columns.includes(meta.name)),
        rows: mapped.rows,
      } : state.page, queryMeta: { total: mapped.total } }));
      resolved.context.onNotice(`已从真实业务 API 加载 ${mapped.rows.length} 条数据`);
    } catch (error) {
      if (sequence === querySequence) resolved.context.onNotice(String(error));
    } finally {
      if (sequence === querySequence) set({ querying: false, loadingState: "idle" });
    }
  },
  loadDetail: async (operation, id) => {
    const context = get().apiContext;
    if (!id.trim()) return context?.onNotice("请输入详情记录 ID");
    const resolved = resolveRequest(context, operation);
    if (!resolved.ok) return context?.onNotice(resolved.error);
    try {
      const response = await request(resolved.context, resolved.document, resolved.url.replace(/\{[^}]+\}/, encodeURIComponent(id)), operation);
      set({ detail: response.body && typeof response.body === "object" ? response.body as Record<string, unknown> : { value: response.body } });
      resolved.context.onNotice("详情加载成功");
    } catch (error) { resolved.context.onNotice(String(error)); }
  },
  mutate: async (operation, text) => {
    const context = get().apiContext;
    const resolved = resolveRequest(context, operation);
    if (!resolved.ok) return context?.onNotice(resolved.error);
    let body: unknown;
    try { body = text.trim() ? JSON.parse(text) : undefined; } catch { return resolved.context.onNotice("请求体必须是合法 JSON"); }
    set({ loadingState: "mutating" });
    try {
      const response = await request(resolved.context, resolved.document, resolved.url, operation, body);
      resolved.context.onNotice(`操作成功（HTTP ${response.status}）`);
    } catch (error) { resolved.context.onNotice(String(error)); } finally { set({ loadingState: "idle" }); }
  },
  deleteRecord: async (operation, id, confirmed = false) => {
    const context = get().apiContext;
    if (!id.trim()) return context?.onNotice("请输入要删除的记录 ID");
    const resolved = resolveRequest(context, operation);
    if (!resolved.ok) return context?.onNotice(resolved.error);
    if (!confirmed && !window.confirm("确定要删除这条记录吗？此操作不可撤销。")) return;
    set({ loadingState: "mutating" });
    try {
      const response = await request(resolved.context, resolved.document, resolved.url.replace(/\{[^}]+\}/, encodeURIComponent(id)), operation);
      resolved.context.onNotice(`删除成功（HTTP ${response.status}）`);
    } catch (error) { resolved.context.onNotice(String(error)); } finally { set({ loadingState: "idle" }); }
  },
}));
