import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { ApiDocument, LoadingState, PageSpec, ResponseBinding } from "../types/domain";
import type { RuntimeOperation } from "../features/pages/pageOperations";
import { mapRealDataRecords } from "./realDataMapping";
import { toUserMessage } from "../lib/errors";
import {
  executeBusinessApi,
  cancelBusinessQuery,
  type BusinessApiInvoke,
} from "../lib/tauri/businessApi";
import { createRequestScope, type RequestScope } from "../features/pages/requestContext";
import {
  applyQueryCancelled,
  applyQueryFailure,
  applyQueryResult,
  applyQueryUnbound,
  beginQuery,
  clearRuntime,
  createPageRuntimeState,
  setRuntimeBinding as updateRuntimeBinding,
  setRuntimeControls as updateRuntimeControls,
  setRuntimeSelection as updateRuntimeSelection,
  type PageRuntimeState,
  type RuntimeControls,
} from "../features/pages/runtime/pageRuntimeState";
import {
  queryMetaFromRuntime,
  runtimeFromV1Definition,
} from "../features/pages/runtime/runtimeSelectors";
import {
  fieldErrorsFrom,
  type FieldErrors,
  type MutationOutcome,
} from "../features/pages/mutationOutcome";

type ApiContext = {
  projectId: string;
  apiDocuments: ApiDocument[];
  onNotice: (message: string) => void;
  requestScope?: RequestScope;
};

export type QueryMeta = {
  total?: number;
  truncated?: boolean;
  truncatedRows?: boolean;
  truncatedColumns?: boolean;
  status?: "idle" | "loading" | "success" | "empty" | "error" | "cancelled";
  error?: string;
};

type WorkbenchState = {
  page: PageSpec | null;
  detail: Record<string, unknown> | null;
  querying: boolean;
  queryMeta: QueryMeta;
  /** Loaded business data and interaction state; never part of a page definition. */
  runtime: PageRuntimeState;
  loadingState: LoadingState;
  apiContext: ApiContext | null;
  executionMode: "live" | "preview";
  mutationStatus: "idle" | "submitting" | "success" | "error" | "unknown";
  /** Bounded, field-keyed backend errors; cleared on success and context changes. */
  mutationFieldErrors: FieldErrors;
  setExecutionMode: (mode: "live" | "preview") => void;
  setPage: (
    page: PageSpec | null | ((current: PageSpec | null) => PageSpec | null),
    /** Cosmetic refinements keep loaded records; a data-source change must not. */
    options?: { preserveRuntime?: boolean },
  ) => void;
  setDetail: (detail: Record<string, unknown> | null) => void;
  setQuerying: (querying: boolean) => void;
  setLoadingState: (loadingState: LoadingState) => void;
  configureApi: (context: ApiContext) => void;
  cancelPendingQuery: () => void;
  setRuntimeControls: (controls: RuntimeControls) => void;
  setRuntimeSelection: (keys: string[]) => void;
  setRuntimeBinding: (binding: ResponseBinding | undefined) => void;
  query: (filters?: Record<string, string>, operation?: RuntimeOperation) => Promise<void>;
  loadDetail: (operation: RuntimeOperation, id: string) => Promise<void>;
  mutate: (operation: RuntimeOperation, text: string) => Promise<MutationOutcome>;
  deleteRecord: (
    operation: RuntimeOperation,
    id: string,
    confirmed?: boolean,
  ) => Promise<MutationOutcome>;
};

type DocumentResolution =
  | { ok: true; document: ApiDocument; error?: never }
  | { ok: false; document?: never; error: string };

export function resolveApiDocument(
  projectId: string,
  apiDocuments: ApiDocument[],
  operation: RuntimeOperation,
): DocumentResolution {
  if (!projectId) return { ok: false, error: "请先选择项目" };
  const projectDocuments = apiDocuments.filter((document) => document.projectId === projectId);
  let document: ApiDocument | undefined;
  if (operation.apiDocumentId) {
    document = projectDocuments.find((candidate) => candidate.id === operation.apiDocumentId);
    if (!document)
      return { ok: false, error: "当前项目中找不到页面绑定的 API 文档，请重新绑定接口" };
    if (!document.auth.authorizedOperations?.includes(operation.key))
      return { ok: false, error: `API 文档“${document.name}”未授权接口“${operation.key}”` };
  } else {
    const matches = projectDocuments.filter((candidate) =>
      candidate.auth.authorizedOperations?.includes(operation.key),
    );
    if (matches.length === 0)
      return { ok: false, error: `当前项目中没有授权接口“${operation.key}”的 API 文档` };
    if (matches.length > 1)
      return {
        ok: false,
        error: `旧页面的接口“${operation.key}”匹配到多个 API 文档，请重新生成页面或重新绑定接口`,
      };
    document = matches[0];
  }
  if (!document.enabled)
    return { ok: false, error: `API 文档“${document.name}”已停用，请先启用后重试` };
  return { ok: true, document };
}

export function buildApiRequest(
  projectId: string,
  apiDocumentId: string,
  url: string,
  operation: RuntimeOperation,
  body?: unknown,
) {
  return {
    url,
    method: operation.method,
    body,
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    project_id: projectId,
    api_document_id: apiDocumentId,
    operation_key: operation.key,
  };
}

export function operationUrl(document: ApiDocument, path: string) {
  const base = (document.auth.apiBaseUrl || document.spec.api_base_url || "").replace(/\/$/, "");
  if (!base) return "";
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

type RequestResolution =
  | {
      ok: true;
      context: ApiContext;
      document: ApiDocument;
      operation: RuntimeOperation;
      url: string;
      error?: never;
    }
  | { ok: false; error: string };

function resolveRequest(
  context: ApiContext | null,
  operation?: RuntimeOperation,
): RequestResolution {
  if (!context) return { ok: false, error: "请先选择项目并导入 API 文档" };
  if (!operation) return { ok: false, error: "当前页面没有可用的 API 接口绑定" };
  const resolution = resolveApiDocument(context.projectId, context.apiDocuments, operation);
  if (!resolution.ok) return resolution;
  const url = operationUrl(resolution.document, operation.path);
  if (!url) return { ok: false, error: `API 文档“${resolution.document.name}”缺少服务地址` };
  return { ok: true, context, document: resolution.document, operation, url };
}

export function createWorkbenchStore(
  options: { invoke?: BusinessApiInvoke; debounceMs?: number } = {},
) {
  const invokeApi = options.invoke ?? invoke;
  const debounceMs = options.debounceMs ?? 300;
  let queryTimer: ReturnType<typeof setTimeout> | undefined;
  let queryDelayResolve: (() => void) | undefined;
  let sequence = 0;
  let revision = 0;
  let busySequence = 0;
  let detailSequence = 0;
  let activeQueryRequestId: string | null = null;
  let scope = createRequestScope();
  let unsubscribe: (() => void) | undefined;

  function cancelPending() {
    if (queryTimer !== undefined) clearTimeout(queryTimer);
    queryTimer = undefined;
    queryDelayResolve?.();
    queryDelayResolve = undefined;
    sequence++;
    const id = activeQueryRequestId;
    activeQueryRequestId = null;
    if (id) void cancelBusinessQuery(id, invokeApi).catch(() => undefined);
  }

  return create<WorkbenchState>((set, get) => {
    /** Single writer for runtime; queryMeta is only a compatibility projection. */
    function commitRuntime(next: PageRuntimeState) {
      set({ runtime: next, queryMeta: queryMetaFromRuntime(next) });
    }
    function snapshot() {
      const owner = scope;
      const context = owner.capture();
      const pageRevision = revision;
      return () =>
        owner === scope &&
        owner.isCurrent(context) &&
        pageRevision === revision &&
        get().executionMode === "live";
    }
    function execute(
      resolved: Extract<RequestResolution, { ok: true }>,
      url: string,
      requestId?: string,
      body?: unknown,
    ) {
      return executeBusinessApi(
        buildApiRequest(
          resolved.context.projectId,
          resolved.document.id,
          url,
          resolved.operation,
          body,
        ),
        {
          invoke: invokeApi,
          kind: ["GET", "HEAD"].includes(resolved.operation.method) ? "query" : "mutation",
          ...(requestId ? { newRequestId: () => requestId } : {}),
        },
      );
    }
    /** Returns a terminal outcome so the form can keep its input on failure. */
    async function write(
      operation: RuntimeOperation,
      text?: string,
      id?: string,
      confirmed = false,
    ): Promise<MutationOutcome> {
      if (get().executionMode !== "live" || get().mutationStatus === "submitting") return "skipped";
      const context = get().apiContext;
      const resolved = resolveRequest(context, operation);
      if (!resolved.ok) {
        context?.onNotice(resolved.error);
        return "skipped";
      }
      const valid = snapshot();
      if (id !== undefined && !id.trim()) {
        context?.onNotice("请输入要删除的记录 ID");
        return "skipped";
      }
      if (
        id !== undefined &&
        !confirmed &&
        !window.confirm("确定要删除这条记录吗？此操作不可撤销。")
      )
        return "skipped";
      if (!valid()) return "skipped";
      let body: unknown;
      try {
        body = text?.trim() ? JSON.parse(text) : undefined;
      } catch {
        context?.onNotice("请求体必须是合法 JSON");
        return "skipped";
      }
      const busy = ++busySequence;
      set({
        loadingState: "mutating",
        mutationStatus: "submitting",
        mutationFieldErrors: {},
      });
      try {
        const response = await execute(
          resolved,
          id === undefined
            ? resolved.url
            : resolved.url.replace(/\{[^}]+\}/, encodeURIComponent(id)),
          undefined,
          body,
        );
        if (!valid()) return "skipped";
        set({ mutationStatus: "success", mutationFieldErrors: {} });
        resolved.context.onNotice(`操作成功（HTTP ${response.status}）`);
        return "success";
      } catch (error) {
        if (!valid()) return "skipped";
        const unknown = (error as Error & { kind?: string }).kind === "mutation-outcome-unknown";
        set({
          mutationStatus: unknown ? "unknown" : "error",
          mutationFieldErrors: unknown ? {} : fieldErrorsFrom(error),
        });
        resolved.context.onNotice(
          unknown ? "写入结果尚未确认，请先刷新核对服务端状态，勿直接重试。" : toUserMessage(error),
        );
        // Unknown is deliberately not retried automatically.
        return unknown ? "unknown" : "error";
      } finally {
        if (valid() && busy === busySequence)
          set({ loadingState: get().querying ? "querying" : "idle" });
      }
    }
    return {
      page: null,
      detail: null,
      querying: false,
      queryMeta: {},
      runtime: createPageRuntimeState(),
      loadingState: "idle",
      apiContext: null,
      executionMode: "live",
      mutationStatus: "idle",
      mutationFieldErrors: {},
      setExecutionMode(mode) {
        if (mode === get().executionMode) return;
        cancelPending();
        revision++;
        busySequence++;
        detailSequence++;
        const nextRuntime = clearRuntime(get().runtime, `mode:${mode}`);
        set({
          executionMode: mode,
          detail: null,
          querying: false,
          loadingState: "idle",
          mutationStatus: "idle",
          mutationFieldErrors: {},
          runtime: nextRuntime,
          queryMeta: queryMetaFromRuntime(nextRuntime),
        });
      },
      setPage(page, options) {
        cancelPending();
        revision++;
        busySequence++;
        detailSequence++;
        set((state) => {
          const nextPage = typeof page === "function" ? page(state.page) : page;
          // v1 adapter only READS definition sample rows; it never writes
          // loaded business data back into the definition. A cosmetic refinement
          // may keep the loaded records, but never the previous selection.
          const nextRuntime = nextPage
            ? options?.preserveRuntime
              ? updateRuntimeSelection(state.runtime, [])
              : runtimeFromV1Definition(nextPage, { status: "idle" })
            : clearRuntime(state.runtime, `definition:${revision}`);
          return {
            page: nextPage,
            detail: null,
            runtime: nextRuntime,
            queryMeta: queryMetaFromRuntime(nextRuntime),
            querying: false,
            loadingState: "idle",
            mutationStatus: "idle",
            mutationFieldErrors: {},
          };
        });
      },
      setDetail: (detail) => set({ detail }),
      setQuerying: (querying) => set({ querying }),
      setLoadingState: (loadingState) =>
        set({ loadingState, querying: loadingState === "querying" }),
      configureApi(context) {
        const previous = get().apiContext;
        const changed =
          !previous ||
          previous.projectId !== context.projectId ||
          previous.apiDocuments !== context.apiDocuments ||
          previous.requestScope !== context.requestScope;
        if (changed) {
          cancelPending();
          revision++;
          busySequence++;
          detailSequence++;
          unsubscribe?.();
          scope = context.requestScope ?? createRequestScope({ projectId: context.projectId });
          unsubscribe = scope.subscribe(() => {
            cancelPending();
            revision++;
            busySequence++;
            detailSequence++;
            const scopedRuntime = clearRuntime(get().runtime, `scope:${revision}`);
            set({
              detail: null,
              querying: false,
              loadingState: "idle",
              runtime: scopedRuntime,
              queryMeta: queryMetaFromRuntime(scopedRuntime),
              mutationStatus: "idle",
              mutationFieldErrors: {},
            });
          });
          const nextRuntime = clearRuntime(get().runtime, `context:${context.projectId}`);
          set((state) => ({
            detail: null,
            querying: false,
            loadingState: "idle",
            runtime: nextRuntime,
            queryMeta: queryMetaFromRuntime(nextRuntime),
            mutationStatus: "idle",
            mutationFieldErrors: {},
            page: previous?.projectId === context.projectId ? state.page : null,
          }));
        }
        set({ apiContext: context });
      },
      cancelPendingQuery() {
        cancelPending();
        const nextRuntime = applyQueryCancelled(get().runtime);
        set({
          querying: false,
          loadingState: get().mutationStatus === "submitting" ? "mutating" : "idle",
          runtime: nextRuntime,
          queryMeta: queryMetaFromRuntime(nextRuntime),
        });
      },
      setRuntimeControls(controls) {
        commitRuntime(updateRuntimeControls(get().runtime, controls));
      },
      setRuntimeSelection(keys) {
        commitRuntime(updateRuntimeSelection(get().runtime, keys));
      },
      setRuntimeBinding(binding) {
        commitRuntime(updateRuntimeBinding(get().runtime, binding));
      },
      async query(filters = {}, operation) {
        if (get().executionMode !== "live") return;
        cancelPending();
        const current = sequence;
        const valid = snapshot();
        const context = get().apiContext;
        const resolved = resolveRequest(context, operation);
        if (!resolved.ok) {
          set({
            querying: false,
            loadingState: get().mutationStatus === "submitting" ? "mutating" : "idle",
          });
          commitRuntime(
            applyQueryUnbound(get().runtime, {
              code: "runtime.binding.unbound",
              message: resolved.error,
            }),
          );
          context?.onNotice(resolved.error);
          return;
        }
        const busy = ++busySequence;
        const requestId = crypto.randomUUID();
        const pageValue = Number.parseInt(filters.page ?? "", 10);
        const sizeValue = Number.parseInt(filters.pageSize ?? filters.limit ?? "", 10);
        const controls: RuntimeControls = {
          ...(Number.isFinite(pageValue) && pageValue > 0 ? { page: pageValue } : {}),
          ...(Number.isFinite(sizeValue) && sizeValue > 0 ? { pageSize: sizeValue } : {}),
          filters: { ...filters },
        };
        commitRuntime(beginQuery(get().runtime, requestId, controls));
        set({
          querying: true,
          loadingState: "querying",
          detail: null,
        });
        await new Promise<void>((resolve) => {
          queryDelayResolve = resolve;
          queryTimer = setTimeout(resolve, debounceMs);
        });
        if (current !== sequence || !valid()) return;
        queryTimer = undefined;
        queryDelayResolve = undefined;
        activeQueryRequestId = requestId;
        const queryString = new URLSearchParams(
          Object.entries(filters).filter(([, value]) => value.trim()),
        ).toString();
        try {
          const response = await execute(
            resolved,
            `${resolved.url}${queryString ? `?${queryString}` : ""}`,
            requestId,
          );
          if (current !== sequence || !valid()) return;
          const raw = mapRealDataRecords(response.body);
          if (raw.status === "invalid") throw new Error("业务 API 响应无法识别为列表数据");
          commitRuntime(
            applyQueryResult(get().runtime, {
              records: raw.records,
              columns: raw.columns,
              ...(raw.total !== undefined ? { total: raw.total } : {}),
              truncated: raw.truncated,
            }),
          );
          resolved.context.onNotice(
            raw.status === "empty"
              ? "查询成功，没有匹配的数据"
              : `当前加载结果：${raw.records.length} 条${raw.truncated.rows || raw.truncated.columns ? "（已截断，请使用服务端分页或调整字段）" : ""}`,
          );
        } catch (error) {
          if (current !== sequence || !valid()) return;
          if ((error as Error & { kind?: string }).kind === "cancelled") {
            commitRuntime(applyQueryCancelled(get().runtime));
          } else {
            const message = toUserMessage(error);
            commitRuntime(
              applyQueryFailure(
                get().runtime,
                { code: "runtime.query.failed", message },
                { keepData: true },
              ),
            );
            resolved.context.onNotice(message);
          }
        } finally {
          if (current === sequence && valid()) {
            set({
              querying: false,
              ...(busy === busySequence ? { loadingState: "idle" as const } : {}),
            });
          }
          if (activeQueryRequestId === requestId) activeQueryRequestId = null;
        }
      },
      async loadDetail(operation, id) {
        if (get().executionMode !== "live") return;
        const context = get().apiContext;
        if (!id.trim()) return context?.onNotice("请输入详情记录 ID");
        const resolved = resolveRequest(context, operation);
        if (!resolved.ok) return context?.onNotice(resolved.error);
        const valid = snapshot();
        const current = ++detailSequence;
        set({ detail: null });
        try {
          const response = await execute(
            resolved,
            resolved.url.replace(/\{[^}]+\}/, encodeURIComponent(id)),
          );
          if (!valid() || current !== detailSequence) return;
          set({
            detail:
              response.body && typeof response.body === "object"
                ? (response.body as Record<string, unknown>)
                : { value: response.body },
          });
          resolved.context.onNotice("详情加载成功");
        } catch (error) {
          if (valid() && current === detailSequence)
            resolved.context.onNotice(toUserMessage(error));
        }
      },
      mutate: (operation, text) => write(operation, text),
      deleteRecord: (operation, id, confirmed) => write(operation, undefined, id, confirmed),
    };
  });
}

export const useWorkbenchStore = createWorkbenchStore();
