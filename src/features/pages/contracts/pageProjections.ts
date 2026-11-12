import type { PageSpec } from "../../../types/domain";

/**
 * Structural allowlist projections. A page definition is rebuilt field by field;
 * anything not listed below is dropped, never copied. Loaded rows, literal stats,
 * custom payloads and environment bindings are data, not structure.
 */
export type ProjectionPurpose = "model" | "template" | "session" | "diagnostic";

export type ProjectionResult = {
  document: Record<string, unknown>;
  /** Stable structural paths only; never values. */
  dropped: string[];
  /** Stable codes only; never values. */
  issues: string[];
};

/** v2 writing stays opt-in until every entry point below accepts v2 natively. */
export const DEFAULT_PAGE_CONTRACT_VERSION = 1;
export const V2_WRITE_ENABLED = false;

export const SESSION_PROMPT_MAX_BYTES = 8 * 1024;
export const MAX_PROJECTION_TEXT_BYTES = 512;
export const MAX_PROJECTION_ARRAY = 50;

export const PROJECTION_ENTRYPOINTS = [
  "model.generate",
  "model.refine",
  "frontend.parse",
  "rust.validate",
  "template.save",
  "template.versionRestore",
  "template.importExport",
  "generationSession",
  "dataExport",
] as const;

const DATA_FIELDS = new Set([
  "rows",
  "stats",
  "customPayload",
  "sample",
  "sampleResponse",
  "response",
  "records",
  "cells",
  "rawBody",
  "body",
  "draft",
  "formDraft",
  "formValues",
  "defaultValue",
  "value",
  "prompt",
]);
const ENVIRONMENT_FIELDS = new Set([
  "apiDocumentId",
  "secretRef",
  "baseUrl",
  "apiBaseUrl",
  "auth",
  "credentials",
  "headers",
  "customHeaders",
  "token",
  "apiKey",
  "secret",
]);

type Rule =
  | { kind: "text"; max?: number; values?: readonly string[]; purposes?: ProjectionPurpose[] }
  | { kind: "number"; purposes?: ProjectionPurpose[] }
  | { kind: "boolean"; purposes?: ProjectionPurpose[] }
  | { kind: "array"; max: number; of: Rule; purposes?: ProjectionPurpose[] }
  | { kind: "object"; shape: Record<string, Rule>; purposes?: ProjectionPurpose[] }
  | { kind: "view"; purposes?: ProjectionPurpose[] }
  | { kind: "textMap"; purposes?: ProjectionPurpose[] };

const text = (max = MAX_PROJECTION_TEXT_BYTES): Rule => ({ kind: "text", max });
const enumText = (values: readonly string[]): Rule => ({ kind: "text", max: 64, values });
const array = (max: number, of: Rule): Rule => ({ kind: "array", max, of });
const object = (shape: Record<string, Rule>): Rule => ({ kind: "object", shape });
const all: ProjectionPurpose[] = ["model", "template", "session"];
const templateOnly: ProjectionPurpose[] = ["template", "session"];

const STYLE_TOKENS: Record<string, Rule> = {
  primary: text(32),
  primaryBg: text(32),
  primaryBgHover: text(32),
  surface: text(32),
  surfaceAlt: text(32),
  surfaceControl: text(32),
  border: text(32),
  borderControl: text(32),
  focusRing: text(32),
  text: text(32),
  textMuted: text(32),
  textSubtle: text(32),
  danger: text(32),
  dangerBg: text(32),
  success: text(32),
  radius: enumText(["none", "sm", "md", "lg", "full"]),
  density: enumText(["compact", "comfortable", "relaxed"]),
};

const PAGE_SHAPE: Record<string, Rule> = {
  version: { kind: "number", purposes: all },
  title: text(256),
  description: text(512),
  layout: enumText(["sidebar", "full", "modal"]),
  breadcrumb: array(10, text(128)),
  permissionRole: text(64),
  createdAt: { kind: "text", max: 64, purposes: templateOnly },
  updatedAt: { kind: "text", max: 64, purposes: templateOnly },
  filters: array(20, text(64)),
  columns: array(MAX_PROJECTION_ARRAY, text(64)),
  columnMeta: array(
    MAX_PROJECTION_ARRAY,
    object({
      name: text(64),
      type: enumText(["string", "number", "date", "datetime", "enum", "boolean", "money"]),
      format: text(64),
      width: text(16),
      searchMode: enumText(["exact", "fuzzy", "range"]),
      sortable: { kind: "boolean" },
      filterable: { kind: "boolean" },
      visible: { kind: "boolean" },
      enumLabels: { kind: "textMap" },
    }),
  ),
  operations: array(
    MAX_PROJECTION_ARRAY,
    object({
      operation_id: text(128),
      method: enumText(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path: text(256),
      role: enumText([
        "list",
        "detail",
        "create",
        "update",
        "delete",
        "stat",
        "export",
        "stats",
        "read",
      ]),
      confirmMessage: text(256),
      sortParam: text(64),
      pagination: object({
        pageParam: text(64),
        sizeParam: text(64),
        defaultSize: { kind: "number" },
      }),
      bodySchema: array(
        MAX_PROJECTION_ARRAY,
        object({
          name: text(64),
          type: enumText(["string", "number", "integer", "boolean", "date", "enum"]),
          required: { kind: "boolean" },
          description: text(256),
          enumValues: array(100, text(64)),
          visibleWhen: object({
            field: text(64),
            equals: array(100, text(64)),
          }),
          constraints: object({
            min: { kind: "number" },
            max: { kind: "number" },
            minLength: { kind: "number" },
            maxLength: { kind: "number" },
            pattern: text(200),
            nullable: { kind: "boolean" },
            readonly: { kind: "boolean" },
          }),
        }),
      ),
    }),
  ),
  metrics: array(
    20,
    object({
      key: text(64),
      label: text(120),
      scope: enumText(["currentPage", "serverAggregate"]),
      aggregation: enumText(["count", "sum", "avg", "min", "max"]),
      fieldKey: text(64),
      operationRef: text(120),
      valuePointer: text(128),
    }),
  ),
  views: array(MAX_PROJECTION_ARRAY, { kind: "view" }),
  interaction: object({
    create: enumText(["modal", "drawer", "inline", "redirect"]),
    update: enumText(["modal", "drawer", "inline", "redirect"]),
    delete: enumText(["modal", "drawer", "inline", "redirect"]),
    detail: enumText(["modal", "drawer", "inline", "redirect"]),
  }),
  batchActions: array(
    MAX_PROJECTION_ARRAY,
    object({
      operation_id: text(128),
      method: enumText(["POST", "DELETE"]),
      path: text(256),
      confirmMessage: text(256),
      payloadBuilder: object({
        type: enumText(["ids", "custom"]),
      }),
    }),
  ),
  theme: enumText(["forge-default", "enterprise-blue", "clean-light", "minimal-dark", "custom"]),
  styleTokens: object(STYLE_TOKENS),
};

const VIEW_FIELDS: Record<string, Rule> = {
  type: enumText(["list", "chart", "kanban", "tabs", "split"]),
  title: text(128),
  defaultSort: object({ column: text(64), order: enumText(["asc", "desc"]) }),
  chartType: enumText(["bar", "line", "pie"]),
  xAxisColumn: text(64),
  yAxisColumn: text(64),
  groupByColumn: text(64),
  groupColumn: text(64),
  cardFields: array(20, text(64)),
  splitRatio: { kind: "number" },
  items: array(20, object({ key: text(64), label: text(128), view: { kind: "view" } })),
  left: { kind: "view" },
  right: { kind: "view" },
};

type Context = { dropped: Set<string>; issues: Set<string> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const bytes = (value: string) => new TextEncoder().encode(value).length;

function note(context: Context, path: string, issue: string) {
  context.dropped.add(path);
  context.issues.add(issue);
}

function build(
  value: unknown,
  rule: Rule,
  path: string,
  purpose: ProjectionPurpose,
  context: Context,
  depth = 0,
): unknown {
  if (depth > 8 || value === undefined || value === null) return undefined;
  if (rule.purposes && !rule.purposes.includes(purpose)) return undefined;
  switch (rule.kind) {
    case "text": {
      if (typeof value !== "string") return undefined;
      if (bytes(value) > (rule.max ?? MAX_PROJECTION_TEXT_BYTES)) {
        note(context, path, "projection.text_limit");
        return undefined;
      }
      if (rule.values && !rule.values.includes(value)) return undefined;
      return value;
    }
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "textMap": {
      if (!isRecord(value)) return undefined;
      const entries = Object.entries(value).slice(0, 100);
      const output: Record<string, string> = {};
      for (const [key, label] of entries) {
        if (bytes(key) <= 64 && typeof label === "string" && bytes(label) <= 64)
          output[key] = label;
        else note(context, `${path}/${key}`, "projection.text_limit");
      }
      return output;
    }
    case "array": {
      if (!Array.isArray(value)) return undefined;
      if (value.length > rule.max) note(context, path, "projection.array_limit");
      const output: unknown[] = [];
      for (const [index, item] of value.slice(0, rule.max).entries()) {
        const projected = build(item, rule.of, `${path}/${index}`, purpose, context, depth + 1);
        if (projected !== undefined) output.push(projected);
      }
      return output;
    }
    case "object":
      return buildShape(value, rule.shape, path, purpose, context, depth + 1);
    case "view":
      return buildShape(value, VIEW_FIELDS, path, purpose, context, depth + 1);
  }
}

function buildShape(
  value: unknown,
  shape: Record<string, Rule>,
  path: string,
  purpose: ProjectionPurpose,
  context: Context,
  depth: number,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (!isRecord(value)) return output;
  for (const [key, fieldValue] of Object.entries(value)) {
    const fieldPath = `${path}/${key}`;
    const rule = shape[key];
    if (!rule) {
      if (DATA_FIELDS.has(key)) note(context, fieldPath, `projection.${key}_dropped`);
      else if (ENVIRONMENT_FIELDS.has(key))
        note(context, fieldPath, "projection.environment_binding_dropped");
      // Unknown key names are untrusted input; diagnostics expose a stable path only.
      else note(context, `${path}/*`, "projection.unknown_field_dropped");
      continue;
    }
    const projected = build(fieldValue, rule, fieldPath, purpose, context, depth);
    if (projected !== undefined) output[key] = projected;
  }
  return output;
}

/**
 * Dropping a custom batch payload must leave a valid structure behind: the
 * action falls back to a plain ID-list payload instead of an invalid "custom".
 */
function normalizeStructural(document: Record<string, unknown>) {
  const actions = document.batchActions;
  if (!Array.isArray(actions)) return;
  document.batchActions = actions.map((action) => {
    if (!isRecord(action) || !isRecord(action.payloadBuilder)) return action;
    const builder = action.payloadBuilder;
    if (builder.type === "custom" && builder.customPayload === undefined) {
      return { ...action, payloadBuilder: { type: "ids" } };
    }
    return action;
  });
}

/** Rebuild a definition from an allowlist; the input is never copied verbatim. */
export function projectArtifact(input: unknown, purpose: ProjectionPurpose): ProjectionResult {
  const context: Context = { dropped: new Set(), issues: new Set() };
  const source = isRecord(input) ? input : {};
  const document = buildShape(source, PAGE_SHAPE, "", purpose, context, 0);
  normalizeStructural(document);
  const dropped = [...context.dropped].sort();
  const issues = [...context.issues].sort();
  if (purpose === "diagnostic") {
    return {
      document: {
        version:
          typeof source.version === "number" ? source.version : DEFAULT_PAGE_CONTRACT_VERSION,
        droppedFields: dropped,
        issues,
        structure: {
          columns: Array.isArray(source.columns)
            ? Math.min(source.columns.length, MAX_PROJECTION_ARRAY)
            : 0,
          operations: Array.isArray(source.operations)
            ? Math.min(source.operations.length, MAX_PROJECTION_ARRAY)
            : 0,
          views: Array.isArray(source.views)
            ? Math.min(source.views.length, MAX_PROJECTION_ARRAY)
            : 0,
        },
      },
      dropped,
      issues,
    };
  }
  return { document, dropped, issues };
}

function asPageSpec(document: Record<string, unknown>): PageSpec {
  return {
    ...(document as unknown as PageSpec),
    stats: [],
    rows: [],
  };
}

/** Model context: structure only, no environment identifiers or timestamps. */
export function forModel(page: PageSpec): PageSpec {
  return asPageSpec(projectArtifact(page, "model").document);
}

/** Template/version history: structure plus metadata, never loaded data. */
export function forTemplate(page: PageSpec): PageSpec {
  return asPageSpec(projectArtifact(page, "template").document);
}

/** Generation session: same structural contract as a template. */
export function forSession(page: PageSpec): PageSpec {
  return asPageSpec(projectArtifact(page, "session").document);
}

/** Diagnostics: counts and stable codes only, never strings from the payload. */
export function forDiagnostic(input: unknown): ProjectionResult["document"] {
  return projectArtifact(input, "diagnostic").document;
}

/**
 * User prompts are explicitly retained (the user typed them), but they are not
 * inherently non-sensitive: they are bounded, and never copied into diagnostics.
 */
export function sessionPromptPolicy(prompt: string): {
  value: string;
  truncated: boolean;
  note: string;
} {
  const encoded = new TextEncoder().encode(prompt);
  const truncated = encoded.length > SESSION_PROMPT_MAX_BYTES;
  return {
    value: truncated
      ? new TextDecoder().decode(encoded.slice(0, SESSION_PROMPT_MAX_BYTES))
      : prompt,
    truncated,
    note: "用户输入的原始提示可能包含敏感内容；会话仅保留有限长度的原文，不复制到模型上下文或诊断。",
  };
}

/** Explicit gate: callers must not write v2 artifacts until every entry point is ready. */
export function defaultWriteVersion(): 1 | 2 {
  return V2_WRITE_ENABLED ? 2 : 1;
}

/**
 * Data export is a distinct artifact: it carries only the loaded display values,
 * never the page definition, credentials or an implicit whole-dataset fetch.
 */
export type ExportDataset = {
  title: string;
  columns: string[];
  rows: string[][];
  scope: "current-page" | "definition-sample";
  scopeNote: string;
};

export const MAX_EXPORT_ROWS = 10_000;
export const MAX_EXPORT_COLUMNS = 100;
const MAX_EXPORT_CELL_BYTES = 4096;

export function toExportDataset(options: {
  title: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
  scope: ExportDataset["scope"];
  zh?: boolean;
}): ExportDataset {
  const columns = options.columns.slice(0, MAX_EXPORT_COLUMNS);
  const rows = options.rows.slice(0, MAX_EXPORT_ROWS).map((row) =>
    columns.map((_, index) => {
      const value = String(row[index] ?? "");
      return bytes(value) > MAX_EXPORT_CELL_BYTES
        ? new TextDecoder().decode(new TextEncoder().encode(value).slice(0, MAX_EXPORT_CELL_BYTES))
        : value;
    }),
  );
  return {
    title: options.title.slice(0, 120),
    columns,
    rows,
    scope: options.scope,
    scopeNote:
      options.scope === "current-page"
        ? options.zh === false
          ? "Loaded display values for the current page only"
          : "仅包含当前已加载页的展示值"
        : options.zh === false
          ? "Definition sample values, not live business data"
          : "定义示例值，非实时业务数据",
  };
}

/** Neutralise spreadsheet formula injection in CSV/text export values. */
export function csvSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
