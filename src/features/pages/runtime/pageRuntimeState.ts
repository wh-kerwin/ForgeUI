import type { ColumnMeta, RecordKey, ResponseBinding } from "../../../types/domain";
import { collectRecordKeys } from "../data/recordKey";

/**
 * Runtime state is NEVER part of a page definition/template. `records` keeps
 * raw JSON values; formatting happens only in runtimeSelectors for display.
 */
export type QueryStatus = "idle" | "loading" | "success" | "empty" | "error" | "cancelled";
export type RuntimeSort = { column: string; order: "asc" | "desc" } | null;
export type RuntimeDiagnostic = {
  code: string;
  message: string;
  area: "binding" | "query" | "identity" | "stats" | "table";
};
export type RuntimeError = { code: string; message: string };
export type RuntimeControls = {
  page?: number;
  pageSize?: number;
  filters?: Record<string, string>;
  sort?: RuntimeSort;
};
export type PageQueryState = {
  status: QueryStatus;
  requestId?: string;
  page: number;
  pageSize: number;
  filters: Record<string, string>;
  sort?: RuntimeSort;
};
export type PageRuntimeState = {
  contextKey: string;
  query: PageQueryState;
  records: Record<string, unknown>[];
  /** Typed identities aligned with records; null means that row cannot be written. */
  recordKeys: (RecordKey | null)[];
  columns: string[];
  columnMeta?: ColumnMeta[];
  /** undefined means the server did not report a total; never guess from rows.length. */
  total?: number;
  truncated: { rows: boolean; columns: boolean };
  /** Stable typed identities, never row indexes. */
  selectedRowKeys: string[];
  error?: RuntimeError;
  /** Old records are still displayed after a failed query; all writes are disabled. */
  stale: boolean;
  /** No usable list operation / mapping was resolved. */
  unbound: boolean;
  source: "none" | "query" | "definition";
  diagnostics: RuntimeDiagnostic[];
  binding?: ResponseBinding;
};

export const RUNTIME_MAX_RECORDS = 100;
export const RUNTIME_MAX_COLUMNS = 50;

const ISSUE_MESSAGES: Record<string, string> = {
  "record.key_missing": "部分记录缺少明确 ID，行级写入已禁用",
  "record.key_duplicate": "记录 ID 重复，行级写入已禁用",
};

export function dedupeDiagnostics(diagnostics: readonly RuntimeDiagnostic[]): RuntimeDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics
    .filter((item) => {
      const key = `${item.area}:${item.code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

export function createPageRuntimeState(contextKey = ""): PageRuntimeState {
  return {
    contextKey,
    query: { status: "idle", page: 1, pageSize: 20, filters: {} },
    records: [],
    recordKeys: [],
    columns: [],
    truncated: { rows: false, columns: false },
    selectedRowKeys: [],
    stale: false,
    unbound: false,
    source: "none",
    diagnostics: [],
  };
}

export function beginQuery(
  state: PageRuntimeState,
  requestId: string,
  controls: RuntimeControls = {},
): PageRuntimeState {
  return {
    ...state,
    query: { ...state.query, ...controls, status: "loading", requestId },
    error: undefined,
    unbound: false,
  };
}

export type QueryResult = {
  records: readonly Record<string, unknown>[];
  columns: readonly string[];
  columnMeta?: ColumnMeta[];
  total?: number;
  truncated?: { rows: boolean; columns: boolean };
  rowKeyPointer?: string;
};

export function applyQueryResult(state: PageRuntimeState, result: QueryResult): PageRuntimeState {
  const records = result.records.slice(0, RUNTIME_MAX_RECORDS);
  const columns = result.columns.slice(0, RUNTIME_MAX_COLUMNS);
  const keys = collectRecordKeys(
    records,
    result.rowKeyPointer ?? state.binding?.rowKeyPointer ?? "/id",
  );
  const diagnostics: RuntimeDiagnostic[] = keys.issues.map((code) => ({
    code,
    message: ISSUE_MESSAGES[code] ?? code,
    area: "identity" as const,
  }));
  if (result.truncated?.rows || columns.length < result.columns.length) {
    diagnostics.push({
      code: "runtime.result.truncated",
      message: "当前加载结果已截断，翻页查看更多",
      area: "query",
    });
  }
  if (result.total === undefined) {
    diagnostics.push({
      code: "runtime.total.unknown",
      message: "接口未提供总数，分页仅按已加载结果展示",
      area: "query",
    });
  }
  return {
    ...state,
    query: { ...state.query, status: records.length ? "success" : "empty" },
    records,
    recordKeys: keys.keys,
    columns,
    columnMeta: result.columnMeta,
    total: result.total,
    truncated: result.truncated ?? { rows: false, columns: false },
    selectedRowKeys: [],
    error: undefined,
    stale: false,
    unbound: false,
    source: "query",
    diagnostics: dedupeDiagnostics(diagnostics),
  };
}

export function applyQueryFailure(
  state: PageRuntimeState,
  error: RuntimeError,
  options: { keepData?: boolean } = {},
): PageRuntimeState {
  const keep = options.keepData !== false && state.source === "query" && state.records.length > 0;
  return {
    ...state,
    query: { ...state.query, status: "error" },
    error,
    stale: keep,
    records: keep ? state.records : [],
    recordKeys: keep ? state.recordKeys : [],
    columns: keep ? state.columns : [],
    total: undefined,
    selectedRowKeys: [],
    source: keep ? state.source : "none",
    diagnostics: dedupeDiagnostics([
      ...state.diagnostics,
      { code: "runtime.query.failed", message: error.message, area: "query" },
    ]),
  };
}

export function applyQueryUnbound(state: PageRuntimeState, error: RuntimeError): PageRuntimeState {
  return {
    ...state,
    query: { ...state.query, status: "error" },
    error,
    stale: false,
    unbound: true,
    records: [],
    recordKeys: [],
    columns: [],
    total: undefined,
    selectedRowKeys: [],
    source: "none",
    diagnostics: dedupeDiagnostics([
      ...state.diagnostics,
      { code: "runtime.binding.unbound", message: error.message, area: "binding" },
    ]),
  };
}

export function applyQueryCancelled(state: PageRuntimeState): PageRuntimeState {
  return {
    ...state,
    query: { ...state.query, status: "cancelled" },
    stale: state.records.length > 0,
    selectedRowKeys: [],
    diagnostics: dedupeDiagnostics([
      ...state.diagnostics,
      {
        code: "runtime.query.cancelled",
        message: "查询已取消，请重新加载后操作",
        area: "query",
      },
    ]),
  };
}

/** Context change (project/document/definition/mode): drop data, selection and controls. */
export function clearRuntime(
  state: PageRuntimeState,
  contextKey = state.contextKey,
): PageRuntimeState {
  return { ...createPageRuntimeState(contextKey), binding: state.binding };
}

export function setRuntimeControls(
  state: PageRuntimeState,
  controls: RuntimeControls,
): PageRuntimeState {
  return { ...state, query: { ...state.query, ...controls } };
}

export function setRuntimeBinding(
  state: PageRuntimeState,
  binding: ResponseBinding | undefined,
): PageRuntimeState {
  return { ...state, binding };
}

/** Selection is identified by typed keys; unknown keys cannot be injected. */
export function setRuntimeSelection(
  state: PageRuntimeState,
  keys: readonly string[],
): PageRuntimeState {
  const known = state.recordKeys
    .filter((key): key is RecordKey => Boolean(key))
    .map((key) => key.identity);
  const allowed = known.length ? new Set(known) : null;
  const next = [...new Set(keys)].filter((key) => !allowed || allowed.has(key));
  return { ...state, selectedRowKeys: next };
}

export function runtimeWritesDisabled(state: PageRuntimeState): boolean {
  return (
    state.stale ||
    state.unbound ||
    state.query.status === "loading" ||
    state.query.status === "error" ||
    state.query.status === "cancelled"
  );
}

export function runtimeRowWritesDisabled(state: PageRuntimeState): boolean {
  return runtimeWritesDisabled(state) || state.diagnostics.some((item) => item.area === "identity");
}
