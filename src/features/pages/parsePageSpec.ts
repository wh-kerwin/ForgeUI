import type { PageSpec, PageView } from "../../types/domain";
import { pageIssue, type PageIssue } from "./pageIssues";

type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const string = (v: unknown): v is string => typeof v === "string";
// Rust String::len is UTF-8 bytes, not JavaScript UTF-16 code units.
const bytes = (v: string) => new TextEncoder().encode(v).length;
const text = (v: unknown, max = Infinity) => string(v) && bytes(v) <= max;
const nonempty = (v: unknown) => string(v) && v.trim().length > 0;
const oneOf = (v: unknown, values: string[]) => string(v) && values.includes(v);
const optional = (v: unknown, check: (v: unknown) => boolean) => v == null || check(v);
const array = (v: unknown, max: number, check: (v: unknown) => boolean): boolean =>
  Array.isArray(v) && v.length <= max && v.every(check);
const defaultArray = (v: unknown, max: number, check: (v: unknown) => boolean) =>
  v === undefined || array(v, max, check);
const COLOR_KEYS = new Set([
  "primary",
  "primaryBg",
  "primaryBgHover",
  "surface",
  "surfaceAlt",
  "surfaceControl",
  "border",
  "borderControl",
  "focusRing",
  "text",
  "textMuted",
  "textSubtle",
  "danger",
  "dangerBg",
  "success",
]);
function tokens(v: unknown): boolean {
  return (
    record(v) &&
    Object.keys(v).length <= 17 &&
    Object.entries(v).every(([key, value]) =>
      key === "radius"
        ? oneOf(value, ["none", "sm", "md", "lg", "full"])
        : key === "density"
          ? oneOf(value, ["compact", "comfortable", "relaxed"])
          : COLOR_KEYS.has(key) &&
            string(value) &&
            /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value),
    )
  );
}
function width(v: unknown): boolean {
  if (v === "auto") return true;
  if (!string(v)) return false;
  const match = /^(\+?\d+)(px|%)$/.exec(v);
  return (
    !!match &&
    Number(match[1]) >= (match[2] === "px" ? 48 : 5) &&
    Number(match[1]) <= (match[2] === "px" ? 600 : 100)
  );
}
function columnMeta(v: unknown, columns: string[]): boolean {
  return (
    record(v) &&
    string(v.name) &&
    columns.includes(v.name) &&
    oneOf(v.type, ["string", "number", "date", "datetime", "enum", "boolean", "money"]) &&
    optional(v.format, (x) => text(x, 64)) &&
    optional(v.width, width) &&
    optional(v.searchMode, (x) => oneOf(x, ["exact", "fuzzy", "range"])) &&
    [v.sortable, v.filterable, v.visible].every((x) =>
      optional(x, (y) => typeof y === "boolean"),
    ) &&
    optional(
      v.enumLabels,
      (x) =>
        record(x) &&
        Object.keys(x).length <= 100 &&
        Object.entries(x).every(([key, label]) => bytes(key) <= 120 && text(label, 120)),
    )
  );
}
function fields(v: unknown): boolean {
  if (!Array.isArray(v) || v.length > 50 || !v.every(record)) return false;
  const names = new Set(v.map((f) => f.name));
  return (
    names.size === v.length &&
    v.every(
      (f) =>
        nonempty(f.name) &&
        text(f.name, 120) &&
        oneOf(f.type, ["string", "number", "integer", "boolean", "date", "enum"]) &&
        typeof f.required === "boolean" &&
        optional(f.description, (x) => text(x, 500)) &&
        optional(
          f.enumValues,
          (x) => Array.isArray(x) && x.length > 0 && array(x, 100, (y) => text(y, 120)),
        ) &&
        optional(
          f.visibleWhen,
          (x) =>
            record(x) &&
            string(x.field) &&
            names.has(x.field) &&
            (string(x.equals) ||
              (Array.isArray(x.equals) &&
                x.equals.length > 0 &&
                array(x.equals, 50, (y) => text(y, 120)))),
        ),
    )
  );
}
function view(v: unknown, depth: number, columns?: string[]): boolean {
  if (depth > 4 || !record(v)) return false;
  const ref = (x: unknown) => string(x) && (!columns || columns.includes(x));
  switch (v.type) {
    case "list":
      return (
        optional(v.title, string) &&
        optional(
          v.defaultSort,
          (x) => record(x) && ref(x.column) && oneOf(x.order, ["asc", "desc"]),
        )
      );
    case "chart":
      return (
        string(v.title) &&
        oneOf(v.chartType, ["bar", "line", "pie"]) &&
        ref(v.xAxisColumn) &&
        ref(v.yAxisColumn) &&
        optional(v.groupByColumn, ref)
      );
    case "kanban":
      return string(v.title) && ref(v.groupColumn) && array(v.cardFields, 20, ref);
    case "tabs": {
      if (!Array.isArray(v.items) || !v.items.length || v.items.length > 10) return false;
      const keys = new Set();
      return v.items.every((x) => {
        if (!record(x) || !nonempty(x.key) || !nonempty(x.label) || keys.has(x.key)) return false;
        keys.add(x.key);
        return view(x.view, depth + 1, columns);
      });
    }
    case "split":
      return (
        optional(v.splitRatio, (x) => typeof x === "number" && x >= 0.2 && x <= 0.8) &&
        view(v.left, depth + 1, columns) &&
        view(v.right, depth + 1, columns)
      );
    default:
      return false;
  }
}
export function isPageView(value: unknown, depth = 0): value is PageView {
  return view(value, depth);
}
function operation(v: unknown): boolean {
  return (
    record(v) &&
    nonempty(v.operation_id) &&
    optional(v.apiDocumentId, string) &&
    oneOf(v.method, ["GET", "POST", "PUT", "PATCH", "DELETE"]) &&
    string(v.path) &&
    oneOf(v.role, [
      "list",
      "detail",
      "create",
      "update",
      "delete",
      "stat",
      "export",
      "stats",
      "read",
    ]) &&
    optional(v.bodySchema, fields) &&
    optional(v.confirmMessage, (x) => text(x, 500)) &&
    optional(v.sortParam, string) &&
    optional(
      v.pagination,
      (x) =>
        record(x) &&
        string(x.pageParam) &&
        x.pageParam.length > 0 &&
        string(x.sizeParam) &&
        x.sizeParam.length > 0 &&
        typeof x.defaultSize === "number" &&
        Number.isInteger(x.defaultSize) &&
        x.defaultSize >= 1 &&
        x.defaultSize <= 1000,
    )
  );
}
function batch(v: unknown): boolean {
  return (
    record(v) &&
    optional(v.apiDocumentId, string) &&
    nonempty(v.operation_id) &&
    oneOf(v.method, ["POST", "DELETE"]) &&
    nonempty(v.path) &&
    optional(v.confirmMessage, (x) => text(x, 500)) &&
    record(v.payloadBuilder) &&
    optional(v.payloadBuilder.customPayload, string) &&
    (v.payloadBuilder.type === "ids" ||
      (v.payloadBuilder.type === "custom" && nonempty(v.payloadBuilder.customPayload)))
  );
}
export type PageBindingContext = {
  allowedOperations: {
    apiDocumentId?: string | null;
    operation_id: string;
    method: string;
    path: string;
  }[];
};
/** Advisory client check only. The host must independently reauthorize at execution. */
export function validatePageBindingContext(
  page: PageSpec,
  context: PageBindingContext,
): PageIssue[] {
  const issues: PageIssue[] = [];
  for (const key of ["operations", "batchActions"] as const) {
    (page[key] ?? []).forEach((binding, index) => {
      if (
        !context.allowedOperations.some(
          (allowed) =>
            (allowed.apiDocumentId ?? null) === (binding.apiDocumentId ?? null) &&
            allowed.operation_id === binding.operation_id &&
            allowed.method === binding.method &&
            allowed.path === binding.path,
        )
      ) {
        issues.push(
          pageIssue(
            "BINDING_OPERATION_NOT_ALLOWED",
            `/${key}/${index}`,
            "permission",
            "操作不属于当前授权的 API 文档；请检查文档绑定",
          ),
        );
      }
    });
  }
  return issues;
}
export type PageParseResult = { page: PageSpec | null; issues: PageIssue[]; repaired: boolean };
export function parsePageSpecDetailed(value: unknown): PageParseResult {
  const issues: PageIssue[] = [];
  const check = (
    valid: boolean,
    code: string,
    path: string,
    message: string,
    stage: PageIssue["stage"] = "schema",
  ) => {
    if (!valid) issues.push(pageIssue(code, path, stage, message));
  };
  if (!record(value))
    return {
      page: null,
      issues: [pageIssue("PAGE_SHAPE_INVALID", "", "schema", "页面必须是 JSON 对象")],
      repaired: false,
    };
  const v = value;
  check(
    v.version === undefined || v.version === 1,
    "PAGE_VERSION_UNSUPPORTED",
    "/version",
    "仅支持 PageSpec v1",
  );
  check(
    nonempty(v.title) && text(v.title, 120),
    "PAGE_TITLE_INVALID",
    "/title",
    "页面标题为空或超出长度限制",
  );
  check(string(v.description), "PAGE_SHAPE_INVALID", "/description", "页面描述必须是文本");
  check(
    optional(v.layout, (x) => oneOf(x, ["sidebar", "full", "modal"])) &&
      defaultArray(v.breadcrumb, 10, (x) => nonempty(x) && text(x, 120)) &&
      [v.permissionRole, v.createdAt, v.updatedAt].every((x) => optional(x, (y) => text(y, 120))),
    "PAGE_METADATA_INVALID",
    "",
    "页面元数据无效",
  );
  check(array(v.filters, 20, string), "PAGE_LIMIT_EXCEEDED", "/filters", "筛选项类型或数量无效");
  check(array(v.columns, 50, string), "PAGE_LIMIT_EXCEEDED", "/columns", "列类型或数量无效");
  check(
    array(v.rows, 100, (x) => array(x, Infinity, string)),
    "PAGE_LIMIT_EXCEEDED",
    "/rows",
    "数据行类型或数量无效",
  );
  check(
    array(v.stats, Infinity, (x) => record(x) && string(x.label) && string(x.value)),
    "PAGE_SHAPE_INVALID",
    "/stats",
    "指标结构无效",
  );
  const columns = Array.isArray(v.columns) && v.columns.every(string) ? v.columns : [];
  if (Array.isArray(v.rows))
    check(
      v.rows.every((row) => Array.isArray(row) && row.length === columns.length),
      "PAGE_ROW_WIDTH_MISMATCH",
      "/rows",
      "行列数量不一致；不会自动截断或填充业务数据",
    );
  check(
    optional(v.theme, (x) =>
      oneOf(x, ["forge-default", "enterprise-blue", "clean-light", "minimal-dark", "custom"]),
    ) && optional(v.styleTokens, tokens),
    "PAGE_THEME_INVALID",
    "/theme",
    "主题或样式令牌无效",
  );
  check(
    defaultArray(v.columnMeta, 50, (x) => columnMeta(x, columns)),
    "PAGE_COLUMN_META_INVALID",
    "/columnMeta",
    "列元数据或列引用无效",
    "reference",
  );
  check(
    defaultArray(v.views, 10, (x) => view(x, 0, columns)),
    "PAGE_VIEW_INVALID",
    "/views",
    "视图结构、深度或列引用无效",
    "reference",
  );
  check(
    defaultArray(v.operations, 30, operation),
    "PAGE_OPERATION_INVALID",
    "/operations",
    "操作绑定或字段定义无效",
  );
  check(
    defaultArray(v.batchActions, 10, batch),
    "PAGE_BATCH_INVALID",
    "/batchActions",
    "批量操作或载荷定义无效",
  );
  check(
    optional(
      v.interaction,
      (x) =>
        record(x) &&
        Object.keys(x).every((key) => ["create", "update", "delete", "detail"].includes(key)) &&
        ["create", "update", "delete", "detail"].every((key) =>
          optional(x[key], (y) => oneOf(y, ["modal", "drawer", "inline", "redirect"])),
        ),
    ),
    "PAGE_SHAPE_INVALID",
    "/interaction",
    "交互模式无效",
  );
  return {
    page: issues.length ? null : ({ ...v, version: 1 } as unknown as PageSpec),
    issues,
    repaired: false,
  };
}
export function parsePageSpec(value: unknown): PageSpec | null {
  return parsePageSpecDetailed(value).page;
}
export function parsePageSpecJsonDetailed(payload: string): PageParseResult {
  const trimmed = payload.trim();
  let value: unknown;
  let repaired = false;
  try {
    value = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    try {
      if (start < 0 || end <= start) throw new Error();
      value = JSON.parse(trimmed.slice(start, end + 1));
      repaired = true;
    } catch {
      return {
        page: null,
        issues: [
          pageIssue("PAGE_JSON_INVALID", "", "syntax", "页面 JSON 无法解析，请重新生成或修复语法"),
        ],
        repaired: false,
      };
    }
  }
  const result = parsePageSpecDetailed(value);
  if (repaired)
    result.issues.unshift(
      pageIssue(
        "PAGE_JSON_ENVELOPE_REMOVED",
        "",
        "syntax",
        "已移除 JSON 外层文本，页面字段未改写",
        "warning",
      ),
    );
  return { ...result, repaired };
}
export function parsePageSpecJson(payload: string): PageSpec | null {
  return parsePageSpecJsonDetailed(payload).page;
}
