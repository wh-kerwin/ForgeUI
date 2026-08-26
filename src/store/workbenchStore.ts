import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { BusinessAuth, LoadingState, OpenApiSummary, PageSpec } from "../types/domain";
import { mapRealDataResponse } from "./realDataMapping";

type ApiContext = {
  spec: OpenApiSummary | null;
  auth: BusinessAuth;
  onNotice: (message: string) => void;
};

type WorkbenchState = {
  page: PageSpec | null;
  detail: Record<string, unknown> | null;
  querying: boolean;
  loadingState: LoadingState;
  apiContext: ApiContext | null;
  setPage: (page: PageSpec | null | ((current: PageSpec | null) => PageSpec | null)) => void;
  setDetail: (detail: Record<string, unknown> | null) => void;
  setQuerying: (querying: boolean) => void;
  setLoadingState: (loadingState: LoadingState) => void;
  configureApi: (context: ApiContext) => void;
  cancelPendingQuery: () => void;
  query: (filters?: Record<string, string>, operationKey?: string) => Promise<void>;
  loadDetail: (path: string, id: string, operationKey: string) => Promise<void>;
  mutate: (method: string, path: string, text: string, operationKey: string) => Promise<void>;
  deleteRecord: (path: string, id: string, operationKey: string, confirmed?: boolean) => Promise<void>;
};

let queryTimer: ReturnType<typeof setTimeout> | undefined;
let queryDelayResolve: (() => void) | undefined;
let querySequence = 0;

function request(context: ApiContext, url: string, method: string, operationKey: string, body?: unknown) {
  const { auth } = context;
  return invoke<{ status: number; body: unknown }>("execute_api", { request: {
    url,
    method,
    body,
    headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    auth_type: auth.type,
    secret_ref: auth.type === "none" ? null : auth.secretRef,
    api_key_name: auth.apiKeyName,
    ca_pem: auth.caPem || null,
    operation_key: operationKey,
  }});
}

function baseUrl(context: ApiContext) {
  return (context.auth.apiBaseUrl || context.spec?.api_base_url || "").replace(/\/$/, "");
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  page: null,
  detail: null,
  querying: false,
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
  query: async (filters = {}, operationKey) => {
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
    const operation = operationKey || context?.spec?.operations.find((item) => item.startsWith("GET "));
    if (!context?.spec || !operation) {
      set({ querying: false, loadingState: "idle" });
      context?.onNotice("请先导入包含 GET 查询接口的 OpenAPI 文档");
      return;
    }
    const path = operation.split(" · ")[0].replace(/^GET\s+/, "");
    const queryString = new URLSearchParams(Object.entries(filters).filter(([, value]) => value.trim())).toString();
    set({ querying: true, loadingState: "querying" });
    try {
      const response = await request(context, `${baseUrl(context)}${path}${queryString ? `?${queryString}` : ""}`, "GET", operation);
      if (sequence !== querySequence) return;
      const mapped = mapRealDataResponse(response.body);
      if (!mapped) return context.onNotice("业务 API 返回空数据");
      set((state) => ({ page: state.page ? {
        ...state.page,
        columns: mapped.columns,
        columnMeta: state.page.columnMeta?.filter((meta) => mapped.columns.includes(meta.name)),
        rows: mapped.rows,
      } : state.page }));
      context.onNotice(`已从真实业务 API 加载 ${mapped.rows.length} 条数据`);
    } catch (error) {
      if (sequence === querySequence) context.onNotice(String(error));
    } finally {
      if (sequence === querySequence) set({ querying: false, loadingState: "idle" });
    }
  },
  loadDetail: async (path, id, operationKey) => {
    const context = get().apiContext;
    if (!context?.spec || !id.trim()) return context?.onNotice("请输入详情记录 ID");
    try {
      const response = await request(context, `${baseUrl(context)}${path.replace(/\{[^}]+\}/, encodeURIComponent(id))}`, "GET", operationKey);
      set({ detail: response.body && typeof response.body === "object" ? response.body as Record<string, unknown> : { value: response.body } });
      context.onNotice("详情加载成功");
    } catch (error) { context.onNotice(String(error)); }
  },
  mutate: async (method, path, text, operationKey) => {
    const context = get().apiContext;
    if (!context?.spec) return;
    let body: unknown;
    try { body = text.trim() ? JSON.parse(text) : undefined; } catch { return context.onNotice("请求体必须是合法 JSON"); }
    set({ loadingState: "mutating" });
    try {
      const response = await request(context, `${baseUrl(context)}${path}`, method, operationKey, body);
      context.onNotice(`操作成功（HTTP ${response.status}）`);
    } catch (error) { context.onNotice(String(error)); } finally { set({ loadingState: "idle" }); }
  },
  deleteRecord: async (path, id, operationKey, confirmed = false) => {
    const context = get().apiContext;
    if (!context?.spec || !id.trim()) return context?.onNotice("请输入要删除的记录 ID");
    if (!confirmed && !window.confirm("确定要删除这条记录吗？此操作不可撤销。")) return;
    set({ loadingState: "mutating" });
    try {
      const response = await request(context, `${baseUrl(context)}${path.replace(/\{[^}]+\}/, encodeURIComponent(id))}`, "DELETE", operationKey);
      context.onNotice(`删除成功（HTTP ${response.status}）`);
    } catch (error) { context.onNotice(String(error)); } finally { set({ loadingState: "idle" }); }
  },
}));
