import type { ColumnMeta, PageSpec, RecordKey } from "../../../types/domain";
import { recordId } from "../recordIdentity";
import {
  createPageRuntimeState,
  dedupeDiagnostics,
  runtimeRowWritesDisabled,
  runtimeWritesDisabled,
  type PageRuntimeState,
  type QueryStatus,
  type RuntimeDiagnostic,
} from "./pageRuntimeState";

/** Shape kept compatible with the existing store/UI QueryMeta prop. */
export type CompatQueryMeta = {
  total?: number;
  truncated?: boolean;
  truncatedRows?: boolean;
  truncatedColumns?: boolean;
  status?: QueryStatus;
  error?: string;
};

export type DisplayStat = {
  label: string;
  value: string;
  scope: "unloaded" | "currentPage" | "definition";
  note: string;
  invalid?: boolean;
};

function v1RecordKeys(page: PageSpec): (RecordKey | null)[] {
  return page.rows.map((row) => {
    const id = recordId(page.columns, row);
    if (!id) return null;
    return {
      type: "string" as const,
      value: id,
      // Typed identity, not a row index; string "001" stays distinct.
      identity: `string:${id}`,
      pathValue: encodeURIComponent(id),
    };
  });
}

/**
 * v1 adapter: builds the structure the existing renderers need from a
 * definition's sample rows WITHOUT writing any loaded data back into it.
 */
export function runtimeFromV1Definition(
  page: PageSpec,
  queryMeta: CompatQueryMeta = {},
): PageRuntimeState {
  const base = createPageRuntimeState("definition");
  const recordKeys = v1RecordKeys(page);
  const identities = new Set<string>();
  let duplicated = false;
  for (const key of recordKeys) {
    if (!key) continue;
    if (identities.has(key.identity)) duplicated = true;
    identities.add(key.identity);
  }
  return {
    ...base,
    query: {
      ...base.query,
      status: queryMeta.status ?? "success",
      page: 1,
      pageSize: page.rows.length || 20,
    },
    columns: page.columns,
    columnMeta: page.columnMeta,
    total: queryMeta.total,
    truncated: {
      rows: Boolean(queryMeta.truncatedRows),
      columns: Boolean(queryMeta.truncatedColumns),
    },
    records: [],
    recordKeys,
    source: "definition",
    diagnostics: dedupeDiagnostics([
      ...(duplicated
        ? [
            {
              code: "record.key_duplicate",
              message: "定义样例中记录 ID 重复，行级写入已禁用",
              area: "identity" as const,
            },
          ]
        : []),
      ...(queryMeta.error
        ? [
            {
              code: "runtime.query.failed",
              message: queryMeta.error,
              area: "query" as const,
            },
          ]
        : []),
    ]),
  };
}

export function selectDisplayColumns(runtime: PageRuntimeState, definition: PageSpec): string[] {
  if (runtime.source === "definition" || runtime.columns.length === 0) return definition.columns;
  return runtime.columns;
}

export function selectColumnMeta(
  runtime: PageRuntimeState,
  definition: PageSpec,
): ColumnMeta[] | undefined {
  if (runtime.source === "definition") return definition.columnMeta;
  if (runtime.columnMeta) return runtime.columnMeta;
  const columns = new Set(selectDisplayColumns(runtime, definition));
  return definition.columnMeta?.filter((meta) => columns.has(meta.name));
}

/** Formatting happens here only: runtime.records keeps raw numbers/booleans/objects. */
export function displayCell(value: unknown, meta?: ColumnMeta): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  if (typeof value === "boolean" && meta?.enumLabels) {
    return meta.enumLabels[String(value)] ?? String(value);
  }
  if (typeof value === "string" && meta?.enumLabels) {
    return meta.enumLabels[value] ?? value;
  }
  return String(value);
}

export function selectDisplayRows(runtime: PageRuntimeState, definition: PageSpec): string[][] {
  if (runtime.source === "definition") return definition.rows;
  const columns = selectDisplayColumns(runtime, definition);
  const metas = new Map(
    (selectColumnMeta(runtime, definition) ?? []).map((meta) => [meta.name, meta]),
  );
  return runtime.records.map((record) =>
    columns.map((column) => displayCell(record[column], metas.get(column))),
  );
}

/** Never infer a full total from the loaded page size. */
export function selectPaginationTotal(runtime: PageRuntimeState): number | undefined {
  return runtime.total;
}

export function selectStats(runtime: PageRuntimeState, definition: PageSpec): DisplayStat[] {
  if (runtime.source === "definition") {
    return definition.stats.map((stat) => {
      const cleaned = stat.value.replace(/[^0-9.-]/g, "");
      const invalid = cleaned === "" || !Number.isFinite(Number(cleaned));
      return {
        label: stat.label,
        value: stat.value,
        scope: "definition" as const,
        note: "定义示例，非实时数据",
        ...(invalid ? { invalid: true } : {}),
      };
    });
  }
  const loaded =
    runtime.query.status === "success" || runtime.query.status === "empty"
      ? true
      : runtime.records.length > 0;
  if (!loaded) {
    return definition.stats.map((stat) => ({
      label: stat.label,
      value: "—",
      scope: "unloaded" as const,
      note: "待加载",
    }));
  }
  return definition.stats.map((stat) => ({
    label: stat.label,
    value: "—",
    scope: "currentPage" as const,
    note: "当前页未提供聚合口径",
  }));
}

export function selectScopeLabel(runtime: PageRuntimeState, zh: boolean): string {
  if (runtime.source === "definition")
    return zh ? "定义示例（非实时数据）" : "Definition sample (not live data)";
  if (runtime.query.status === "error" && runtime.records.length === 0)
    return zh ? "尚未加载" : "Not loaded";
  if (runtime.query.status === "idle" || runtime.query.status === "loading")
    return zh ? "尚未加载" : "Not loaded";
  if (runtime.stale) return zh ? "上次成功结果（已过期）" : "Last successful result (stale)";
  return zh ? "当前已加载页" : "Currently loaded page";
}

export function selectRowIdentities(runtime: PageRuntimeState): (RecordKey | null)[] {
  return runtime.recordKeys;
}

/** Display-layer indexes are derived from typed keys, never persisted as selection. */
export function selectSelectedIndexes(
  runtime: PageRuntimeState,
  selectedKeys: readonly string[],
): Set<number> {
  const indexByIdentity = new Map<string, number>();
  runtime.recordKeys.forEach((key, index) => {
    if (key && !indexByIdentity.has(key.identity)) indexByIdentity.set(key.identity, index);
  });
  return new Set(
    [...selectedKeys]
      .map((key) => indexByIdentity.get(key))
      .filter((index): index is number => index !== undefined),
  );
}

export function selectBatchIds(runtime: PageRuntimeState, indexes: readonly number[]): string[] {
  return indexes
    .map((index) => runtime.recordKeys[index]?.value)
    .filter((value): value is string | number | boolean => value !== undefined)
    .map((value) => String(value));
}

export function selectRuntimeDiagnostics(
  runtime: PageRuntimeState,
  definition: PageSpec,
): RuntimeDiagnostic[] {
  const invalidStats = selectStats(runtime, definition).filter((stat) => stat.invalid).length;
  return dedupeDiagnostics([
    ...runtime.diagnostics,
    ...(invalidStats
      ? [
          {
            code: "runtime.stats.format",
            message: `${invalidStats} 个指标值无法解析为数字，图表区域已标注`,
            area: "stats" as const,
          },
        ]
      : []),
  ]);
}

export function queryMetaFromRuntime(runtime: PageRuntimeState): CompatQueryMeta {
  const truncated = runtime.truncated.rows || runtime.truncated.columns;
  return {
    status: runtime.query.status,
    ...(runtime.total !== undefined ? { total: runtime.total } : {}),
    ...(truncated
      ? {
          truncated: true,
          truncatedRows: runtime.truncated.rows,
          truncatedColumns: runtime.truncated.columns,
        }
      : {}),
    ...(runtime.error ? { error: runtime.error.message } : {}),
  };
}

export function selectWritesDisabled(runtime: PageRuntimeState): boolean {
  return runtimeWritesDisabled(runtime);
}

export function selectRowWritesDisabled(runtime: PageRuntimeState): boolean {
  return runtimeRowWritesDisabled(runtime);
}
