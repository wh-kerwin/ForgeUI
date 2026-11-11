import type { PageSpec, PageView } from "../../types/domain";
import { operationKey, type RuntimeOperation } from "./pageOperations";

/**
 * Semantic differences between two page definitions. Comparisons use stable
 * field/view/operation keys, never formatted JSON line numbers.
 */
export type DiffCategory =
  "field" | "view" | "operation" | "binding" | "permission" | "filter" | "metadata";
export type DiffChange = "added" | "removed" | "changed";
export type DiffEntry = {
  category: DiffCategory;
  change: DiffChange;
  key: string;
  before?: string;
  after?: string;
};
export type PageDefinitionDiff = {
  entries: DiffEntry[];
  /** Data-source changes clear the runtime and re-query; cosmetic changes do not. */
  requiresRequery: boolean;
  counts: { added: number; removed: number; changed: number };
};

const MAX_VALUE = 120;
const bound = (value: unknown) => {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text;
};

function keyed(
  values: readonly string[],
  describe: (value: string) => string,
): Map<string, string> {
  const map = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const value of values) {
    const occurrence = seen.get(value) ?? 0;
    seen.set(value, occurrence + 1);
    map.set(occurrence === 0 ? value : `${value}#${occurrence}`, describe(value));
  }
  return map;
}

function compare(
  before: Map<string, string>,
  after: Map<string, string>,
  category: DiffCategory,
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  for (const [key, value] of before) {
    const next = after.get(key);
    if (next === undefined) entries.push({ category, change: "removed", key, before: value });
    else if (next !== value)
      entries.push({ category, change: "changed", key, before: value, after: next });
  }
  for (const [key, value] of after) {
    if (!before.has(key)) entries.push({ category, change: "added", key, after: value });
  }
  return entries;
}

function columnDescription(page: PageSpec, column: string): string {
  const meta = page.columnMeta?.find((item) => item.name === column);
  if (!meta) return "string";
  return [
    meta.type,
    meta.format ?? "",
    meta.visible === false ? "hidden" : "visible",
    meta.width ?? "",
  ]
    .filter(Boolean)
    .join("|");
}

function viewKey(view: PageView, index: number): string {
  const label = "title" in view && view.title ? view.title : view.type;
  return `${view.type}:${label}:${index}`;
}

function operationDescription(page: PageSpec, key: string): string {
  const operation = page.operations?.find(
    (item) => operationKey(item.method, item.path, item.operation_id) === key,
  );
  if (!operation) return "";
  return [
    operation.role,
    operation.pagination ? JSON.stringify(operation.pagination) : "",
    operation.sortParam ?? "",
    (operation.bodySchema ?? []).map((field) => field.name).join(","),
  ]
    .filter(Boolean)
    .join("|");
}

function operationBinding(page: PageSpec, key: string): string {
  const operation = page.operations?.find(
    (item) => operationKey(item.method, item.path, item.operation_id) === key,
  );
  return operation?.apiDocumentId ?? "";
}

function metadata(page: PageSpec): Map<string, string> {
  return new Map([
    ["title", bound(page.title)],
    ["description", bound(page.description)],
    ["layout", bound(page.layout ?? "")],
    ["theme", bound(page.theme ?? "")],
    ["styleTokens", bound(page.styleTokens ?? "")],
    ["interaction", bound(page.interaction ?? "")],
    ["batchActions", bound((page.batchActions ?? []).map((item) => item.operation_id))],
    ["columnOrder", bound(page.columns)],
  ]);
}

export function diffPageDefinitions(before: PageSpec, after: PageSpec): PageDefinitionDiff {
  const beforeOperationKeys = (before.operations ?? []).map((item) =>
    operationKey(item.method, item.path, item.operation_id),
  );
  const afterOperationKeys = (after.operations ?? []).map((item) =>
    operationKey(item.method, item.path, item.operation_id),
  );
  const allOperationKeys = [...new Set([...beforeOperationKeys, ...afterOperationKeys])];

  const fieldEntries = compare(
    keyed(before.columns, (column) => bound(columnDescription(before, column))),
    keyed(after.columns, (column) => bound(columnDescription(after, column))),
    "field",
  );
  const filterEntries = compare(
    keyed(before.filters, () => "filter"),
    keyed(after.filters, () => "filter"),
    "filter",
  );
  const operationEntries = compare(
    keyed(beforeOperationKeys, (key) => bound(operationDescription(before, key))),
    keyed(afterOperationKeys, (key) => bound(operationDescription(after, key))),
    "operation",
  );
  const bindingEntries = compare(
    keyed(allOperationKeys, (key) => bound(operationBinding(before, key))),
    keyed(allOperationKeys, (key) => bound(operationBinding(after, key))),
    "binding",
  ).filter((entry) => entry.category === "binding" && entry.change === "changed");
  const viewEntries = compare(
    keyed(
      (before.views ?? []).map((view, index) => viewKey(view, index)),
      (key) => bound(key),
    ),
    keyed(
      (after.views ?? []).map((view, index) => viewKey(view, index)),
      (key) => bound(key),
    ),
    "view",
  );
  const permissionEntries = compare(
    new Map([["permissionRole", bound(before.permissionRole ?? "")]]),
    new Map([["permissionRole", bound(after.permissionRole ?? "")]]),
    "permission",
  );
  const metadataEntries = compare(metadata(before), metadata(after), "metadata");

  const entries = [
    ...fieldEntries,
    ...filterEntries,
    ...operationEntries,
    ...bindingEntries,
    ...permissionEntries,
    ...viewEntries,
    ...metadataEntries,
  ];

  const fieldSetChanged =
    before.columns.length !== after.columns.length ||
    before.columns.some((column) => !after.columns.includes(column));
  const fieldTypeChanged = fieldEntries.some(
    (entry) =>
      entry.change === "changed" &&
      (entry.before?.split("|")[0] ?? "") !== (entry.after?.split("|")[0] ?? ""),
  );
  const listOperationChanged = operationEntries.some((entry) => {
    const description = entry.before ?? entry.after ?? "";
    return description.startsWith("list") || entry.key.startsWith("GET ");
  });
  const requiresRequery =
    fieldSetChanged || fieldTypeChanged || filterEntries.length > 0 || listOperationChanged;

  return {
    entries,
    requiresRequery,
    counts: {
      added: entries.filter((entry) => entry.change === "added").length,
      removed: entries.filter((entry) => entry.change === "removed").length,
      changed: entries.filter((entry) => entry.change === "changed").length,
    },
  };
}

export type RefineScope = {
  allowedDocumentIds: readonly string[];
  allowedOperations: readonly RuntimeOperation[];
};
export type Reconciliation = {
  accepted: boolean;
  issues: { code: string; message: string }[];
};

/**
 * A refinement may only use the API documents and operations that were already
 * authorized for the original definition. New operations (e.g. an unrequested
 * delete) are refused rather than silently widening the page's authority.
 */
export function reconcileRefinement(
  before: PageSpec,
  candidate: PageSpec,
  scope: RefineScope,
): Reconciliation {
  const issues: Reconciliation["issues"] = [];
  const allowedDocuments = new Set(scope.allowedDocumentIds);
  const allowedKeys = new Set(scope.allowedOperations.map((operation) => operation.key));
  const beforeKeys = new Set(
    (before.operations ?? []).map((operation) =>
      operationKey(operation.method, operation.path, operation.operation_id),
    ),
  );

  for (const operation of candidate.operations ?? []) {
    const key = operationKey(operation.method, operation.path, operation.operation_id);
    if (operation.apiDocumentId && !allowedDocuments.has(operation.apiDocumentId)) {
      issues.push({
        code: "REFINE_SCOPE_EXPANDED",
        message: "候选页面引用了未授权的 API 文档，请先显式选择变更范围",
      });
    }
    if (!beforeKeys.has(key) && !allowedKeys.has(key)) {
      issues.push({
        code: "REFINE_OPERATION_UNAUTHORIZED",
        message: "候选页面包含未授权的新操作",
      });
    }
  }
  return {
    accepted: issues.length === 0,
    issues: [...new Map(issues.map((i) => [i.code, i])).values()],
  };
}

export type RefineStatus = "idle" | "generating" | "previewDiff" | "applying" | "error";
export type RefinePreview = {
  candidate: PageSpec;
  diff: PageDefinitionDiff;
  instruction: string;
  projectId: string;
  apiDocumentIds: string[];
};
export type RefineUndo = {
  page: PageSpec;
  apiDocumentIds: string[];
  projectId: string;
  requiresRequery: boolean;
};
export type RefineState = {
  status: RefineStatus;
  preview: RefinePreview | null;
  undo: RefineUndo | null;
  issues: { code: string; message: string }[];
};
export type RefineEvent =
  | { type: "submit" }
  | { type: "preview"; preview: RefinePreview }
  | { type: "apply" }
  | { type: "applied"; undo: RefineUndo }
  | { type: "discard" }
  | { type: "undo" }
  | { type: "undone" }
  | { type: "error"; issues: RefineState["issues"] }
  | { type: "project-changed" };

export const initialRefineState: RefineState = {
  status: "idle",
  preview: null,
  undo: null,
  issues: [],
};

/** A project switch discards every pending preview, undo and issue. */
export function refineReducer(state: RefineState, event: RefineEvent): RefineState {
  switch (event.type) {
    case "submit":
      return { ...state, status: "generating", preview: null, issues: [] };
    case "preview":
      return { ...state, status: "previewDiff", preview: event.preview, issues: [] };
    case "apply":
      return { ...state, status: "applying" };
    case "applied":
      return { ...state, status: "idle", preview: null, undo: event.undo, issues: [] };
    case "discard":
      return { ...state, status: "idle", preview: null, issues: [] };
    case "undo":
      return { ...state, status: "applying" };
    case "undone":
      return { ...state, status: "idle", preview: null, undo: null, issues: [] };
    case "error":
      return { ...state, status: "error", preview: null, issues: event.issues };
    case "project-changed":
      return initialRefineState;
  }
}
