import type { MetricDefinition } from "../../../types/domain";
import { readPointer } from "../data/jsonPointer";

/**
 * Named metric resolution. A metric is either a bounded aggregation over the
 * loaded current page, or a value read from an explicitly bound statistics
 * endpoint. Loaded rows are never presented as a whole-dataset total.
 */
export type MetricState =
  "success" | "loading" | "pending" | "empty" | "error" | "unbound" | "invalid";
export type MetricScope = "currentPage" | "serverAggregate";

export type MetricResponse =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; message: string }
  | { status: "success"; body: unknown };

export type MetricResult = {
  key: string;
  label: string;
  scope: MetricScope;
  state: MetricState;
  value: string;
  note: string;
  truncated?: boolean;
  issue?: string;
};

export type ResolveOptions = {
  metrics: readonly MetricDefinition[];
  /** Raw records of the loaded page; never a full dataset. */
  records: readonly Record<string, unknown>[];
  /** Declared field names; an undeclared field is never guessed. */
  fieldKeys: readonly string[];
  /** Per-operation statistics responses, keyed by operationRef. */
  responses?: Readonly<Record<string, MetricResponse>>;
  truncated?: boolean;
  zh?: boolean;
};

const MAX_METRICS = 20;
const MAX_PAGE_RECORDS = 100;

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))
    return Number(value);
  return null;
}

function aggregate(
  metric: MetricDefinition,
  records: readonly Record<string, unknown>[],
): { value: number; used: number } | null {
  const rows = records.slice(0, MAX_PAGE_RECORDS);
  if (metric.aggregation === "count") return { value: rows.length, used: rows.length };
  if (!metric.fieldKey || !metric.aggregation) return null;
  const values = rows
    .map((row) => numeric(row[metric.fieldKey!]))
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  switch (metric.aggregation) {
    case "sum":
      return { value: values.reduce((total, value) => total + value, 0), used: values.length };
    case "avg":
      return {
        value: values.reduce((total, value) => total + value, 0) / values.length,
        used: values.length,
      };
    case "min":
      return { value: Math.min(...values), used: values.length };
    case "max":
      return { value: Math.max(...values), used: values.length };
    default:
      return null;
  }
}

/** Only declared query parameters are propagated; unknown ones are reported, never guessed. */
export function propagateMetricFilters(
  filters: Readonly<Record<string, string>>,
  declared: readonly string[],
): { sent: Record<string, string>; skipped: string[] } {
  const sent: Record<string, string> = {};
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(filters)) {
    if (declared.includes(key)) sent[key] = value;
    else skipped.push(key);
  }
  return { sent, skipped };
}

export function resolveMetrics(options: ResolveOptions): MetricResult[] {
  const zh = options.zh !== false;
  const responses = options.responses ?? {};
  const text = (currentPage: string, server: string) => (zh ? currentPage : server);
  return options.metrics.slice(0, MAX_METRICS).map((metric) => {
    const base = { key: metric.key, label: metric.label, scope: metric.scope };
    if (metric.scope === "currentPage") {
      if (!metric.aggregation)
        return {
          ...base,
          state: "invalid" as const,
          value: "",
          note: text("当前页聚合缺少聚合方式", "Missing aggregation"),
          issue: "metric.aggregation_missing",
        };
      if (
        metric.aggregation !== "count" &&
        (!metric.fieldKey || !options.fieldKeys.includes(metric.fieldKey))
      )
        return {
          ...base,
          state: "invalid" as const,
          value: "",
          note: text("聚合字段未声明", "Aggregation field is undeclared"),
          issue: "metric.field_undeclared",
        };
      if (metric.operationRef || metric.valuePointer)
        return {
          ...base,
          state: "invalid" as const,
          value: "",
          note: text(
            "当前页聚合不能绑定服务端端点",
            "Current-page aggregate cannot bind an endpoint",
          ),
          issue: "metric.scope_mixed",
        };
      const result = aggregate(metric, options.records);
      if (!result)
        return {
          ...base,
          state: "empty" as const,
          value: "",
          note: text("当前页没有可聚合的数值", "No numeric values on this page"),
        };
      return {
        ...base,
        state: "success" as const,
        value: String(result.value),
        note: options.truncated
          ? text("仅当前已加载页（结果已截断）", "Loaded page only (truncated)")
          : text(`仅当前已加载页（${result.used} 条）`, `Loaded page only (${result.used} rows)`),
        ...(options.truncated ? { truncated: true } : {}),
      };
    }

    // serverAggregate: a real, explicitly bound statistics endpoint is required.
    if (!metric.operationRef || !metric.valuePointer)
      return {
        ...base,
        state: "unbound" as const,
        value: "",
        note: text("未绑定统计端点，不显示全库数值", "No statistics endpoint bound"),
        issue: "metric.unbound",
      };
    if (metric.aggregation || metric.fieldKey)
      return {
        ...base,
        state: "invalid" as const,
        value: "",
        note: text("服务端聚合不能混入当前页聚合", "Server aggregate cannot mix page aggregation"),
        issue: "metric.scope_mixed",
      };
    const response = responses[metric.operationRef];
    if (!response)
      return {
        ...base,
        state: "pending" as const,
        value: "",
        note: text("统计端点已绑定，等待执行查询", "Stats endpoint bound, query not executed yet"),
        issue: "metric.pending",
      };
    if (response.status === "loading")
      return {
        ...base,
        state: "loading" as const,
        value: "",
        note: text("统计端点加载中", "Statistics endpoint loading"),
      };
    if (response.status === "error")
      return {
        ...base,
        state: "error" as const,
        value: "",
        note: response.message,
        issue: "metric.request_failed",
      };
    if (response.status === "empty")
      return {
        ...base,
        state: "empty" as const,
        value: "",
        note: text("统计端点没有数据", "Statistics endpoint returned no data"),
      };
    const read = readPointer(response.body, metric.valuePointer);
    if (!read.found)
      return {
        ...base,
        state: "error" as const,
        value: "",
        note: text("统计取值指针未命中", "Statistics value pointer not found"),
        issue: "metric.pointer_missing",
      };
    const value = numeric(read.value);
    if (value === null)
      return {
        ...base,
        state: "error" as const,
        value: "",
        note: text("统计端点返回值不是数值", "Statistics value is not numeric"),
        issue: "metric.value_invalid",
      };
    return {
      ...base,
      state: "success" as const,
      value: String(value),
      note: text("服务端聚合（真实统计端点）", "Server aggregate (real stats endpoint)"),
    };
  });
}
