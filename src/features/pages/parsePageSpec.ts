import type { ColumnMeta, FieldSchema, PageSpec, PageView } from "../../types/domain";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const COLOR_TOKEN_KEYS = new Set(["primary", "primaryBg", "primaryBgHover", "surface", "surfaceAlt", "surfaceControl", "border", "borderControl", "focusRing", "text", "textMuted", "textSubtle", "danger", "dangerBg", "success"]);
const HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;

function isColumnMeta(value: unknown): value is ColumnMeta {
  if (!isRecord(value) || typeof value.name !== "string" || !["string", "number", "date", "datetime", "enum", "boolean", "money"].includes(String(value.type))) return false;
  if (value.format !== undefined && typeof value.format !== "string") return false;
  if (value.enumLabels !== undefined && (!isRecord(value.enumLabels) || !Object.values(value.enumLabels).every((label) => typeof label === "string"))) return false;
  if ([value.sortable, value.filterable, value.visible].some((flag) => flag !== undefined && typeof flag !== "boolean")) return false;
  if (value.searchMode !== undefined && !["exact", "fuzzy", "range"].includes(String(value.searchMode))) return false;
  return value.width === undefined || typeof value.width === "string";
}

function isFieldSchema(value: unknown): value is FieldSchema {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim() || !["string", "number", "integer", "boolean", "date", "enum"].includes(String(value.type)) || typeof value.required !== "boolean") return false;
  if (value.enumValues !== undefined && (!Array.isArray(value.enumValues) || value.enumValues.length > 100 || !value.enumValues.every((item) => typeof item === "string"))) return false;
  if (value.description !== undefined && (typeof value.description !== "string" || value.description.length > 500)) return false;
  if (value.visibleWhen === undefined) return true;
  if (!isRecord(value.visibleWhen) || typeof value.visibleWhen.field !== "string" || !value.visibleWhen.field.trim()) return false;
  const equals = value.visibleWhen.equals;
  return typeof equals === "string" || (Array.isArray(equals) && equals.length > 0 && equals.length <= 50 && equals.every((item) => typeof item === "string"));
}

export function isPageView(value: unknown, depth = 0): value is PageView {
  if (depth > 4 || !isRecord(value)) return false;
  if (value.type === "list") return (value.title === undefined || typeof value.title === "string") && (value.defaultSort === undefined || (isRecord(value.defaultSort) && typeof value.defaultSort.column === "string" && ["asc", "desc"].includes(String(value.defaultSort.order))));
  if (value.type === "chart") return typeof value.title === "string" && ["bar", "line", "pie"].includes(String(value.chartType)) && typeof value.xAxisColumn === "string" && typeof value.yAxisColumn === "string" && (value.groupByColumn === undefined || typeof value.groupByColumn === "string");
  if (value.type === "kanban") return typeof value.title === "string" && typeof value.groupColumn === "string" && Array.isArray(value.cardFields) && value.cardFields.length <= 20 && value.cardFields.every((field) => typeof field === "string");
  if (value.type === "tabs") return Array.isArray(value.items) && value.items.length > 0 && value.items.length <= 10 && value.items.every((item) => isRecord(item) && typeof item.key === "string" && item.key.length > 0 && typeof item.label === "string" && isPageView(item.view, depth + 1));
  return value.type === "split" && isPageView(value.left, depth + 1) && isPageView(value.right, depth + 1) && (value.splitRatio === undefined || (typeof value.splitRatio === "number" && value.splitRatio >= .2 && value.splitRatio <= .8));
}

export function parsePageSpec(value: unknown): PageSpec | null {
  if (
    !isRecord(value) ||
    typeof value.title !== "string" ||
    typeof value.description !== "string"
  )
    return null;
  if (value.theme !== undefined && !["forge-default", "enterprise-blue", "clean-light", "minimal-dark", "custom"].includes(String(value.theme))) return null;
  if (value.layout !== undefined && !["sidebar", "full", "modal"].includes(String(value.layout))) return null;
  if (value.breadcrumb !== undefined && (!Array.isArray(value.breadcrumb) || value.breadcrumb.length > 10 || !value.breadcrumb.every((item) => typeof item === "string" && item.length <= 120))) return null;
  if ([value.permissionRole, value.createdAt, value.updatedAt].some((item) => item !== undefined && (typeof item !== "string" || item.length > 120))) return null;
  if (value.styleTokens !== undefined && (!isRecord(value.styleTokens) || !Object.entries(value.styleTokens).every(([key, token]) => {
    if (["radius"].includes(key)) return ["none", "sm", "md", "lg", "full"].includes(String(token));
    if (["density"].includes(key)) return ["compact", "comfortable", "relaxed"].includes(String(token));
    return COLOR_TOKEN_KEYS.has(key) && typeof token === "string" && HEX_COLOR.test(token);
  }))) return null;
  if (
    !Array.isArray(value.filters) ||
    !value.filters.every((item) => typeof item === "string")
  )
    return null;
  if (
    !Array.isArray(value.columns) ||
    !value.columns.every((item) => typeof item === "string")
  )
    return null;
  const columns = value.columns;
  if (
    !Array.isArray(value.rows) ||
    !value.rows.every(
      (row) =>
        Array.isArray(row) && row.every((item) => typeof item === "string"),
    )
  )
    return null;
  // Older model responses and templates can contain short/long rows. Keep the
  // page usable at the client boundary by applying the same bounded repair as
  // the Rust validator: truncate extra cells and fill missing cells.
  const rows = value.rows.map((row) =>
    row
      .slice(0, columns.length)
      .concat(Array(Math.max(0, columns.length - row.length)).fill("")),
  );
  if (
    !Array.isArray(value.stats) ||
    !value.stats.every(
      (stat) =>
        isRecord(stat) &&
        typeof stat.label === "string" &&
        typeof stat.value === "string",
    )
  )
    return null;
  if (
    value.operations !== undefined &&
    (!Array.isArray(value.operations) ||
      !value.operations.every(
        (operation) =>
          isRecord(operation) &&
          typeof operation.operation_id === "string" &&
          typeof operation.method === "string" &&
          ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(operation.method) &&
          typeof operation.path === "string" &&
          ["list", "detail", "create", "update", "delete", "stat", "export", "stats", "read"].includes(String(operation.role)) &&
          (operation.bodySchema === undefined || (Array.isArray(operation.bodySchema) && operation.bodySchema.length <= 50 && operation.bodySchema.every(isFieldSchema))) &&
          (operation.confirmMessage === undefined || typeof operation.confirmMessage === "string") &&
          (operation.sortParam === undefined || typeof operation.sortParam === "string") &&
          (operation.pagination === undefined || (isRecord(operation.pagination) && typeof operation.pagination.pageParam === "string" && typeof operation.pagination.sizeParam === "string" && typeof operation.pagination.defaultSize === "number" && operation.pagination.defaultSize > 0)),
      ))
  )
    return null;
  if (value.columnMeta !== undefined && (!Array.isArray(value.columnMeta) || value.columnMeta.length > 50 || !value.columnMeta.every(isColumnMeta))) return null;
  if (
    value.views !== undefined &&
    (!Array.isArray(value.views) ||
      value.views.length > 10 ||
      !value.views.every((view) => isPageView(view)))
  )
    return null;
  if (value.batchActions !== undefined && (!Array.isArray(value.batchActions) || value.batchActions.length > 10 || !value.batchActions.every((action) => isRecord(action) && typeof action.operation_id === "string" && action.operation_id.length > 0 && ["POST", "DELETE"].includes(String(action.method)) && typeof action.path === "string" && action.path.length > 0 && (action.confirmMessage === undefined || typeof action.confirmMessage === "string") && isRecord(action.payloadBuilder) && (action.payloadBuilder.type === "ids" || (action.payloadBuilder.type === "custom" && typeof action.payloadBuilder.customPayload === "string" && action.payloadBuilder.customPayload.length > 0))))) return null;
  if (
    value.interaction !== undefined &&
    (!isRecord(value.interaction) ||
      !Object.entries(value.interaction).every(
        ([key, mode]) =>
          ["create", "update", "delete", "detail"].includes(key) &&
          ["modal", "drawer", "inline", "redirect"].includes(String(mode)),
      ))
  )
    return null;
  return { ...value, columns, rows } as unknown as PageSpec;
}

export function parsePageSpecJson(payload: string): PageSpec | null {
  try {
    return parsePageSpec(JSON.parse(payload));
  } catch {
    return null;
  }
}
