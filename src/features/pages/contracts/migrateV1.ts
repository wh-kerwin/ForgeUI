import type { ForgeUIPageDefinitionV2 } from "../../../types/generated/pageDefinitionV2";
import type { PageSpec, ResponseBinding } from "../../../types/domain";
import { forTemplate } from "./pageProjections";

export const FORGE_TEMPLATE_V1 = "forge-template-v1";
export const FORGE_TEMPLATE_V2 = "forge-template-v2";

export type MigrationIssue = { code: string; message: string };

export type TemplateEnvelope = {
  format: typeof FORGE_TEMPLATE_V1 | typeof FORGE_TEMPLATE_V2;
  id?: string;
  name: string;
  /** v1 stores a JSON string; v2 stores a structural definition object. */
  payload: unknown;
};

/** Unknown envelopes are rejected outright; there is no best-effort fallback. */
export function parseTemplateEnvelope(document: string): TemplateEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(document);
  } catch {
    throw new Error("模板文件不是有效的 JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("不支持的模板格式");
  }
  const record = value as Record<string, unknown>;
  const format = record.format;
  if (format !== FORGE_TEMPLATE_V1 && format !== FORGE_TEMPLATE_V2) {
    throw new Error("不支持的模板格式");
  }
  if (record.payload === undefined || record.payload === null) {
    throw new Error("模板缺少页面内容");
  }
  if (format === FORGE_TEMPLATE_V1 && typeof record.payload !== "string") {
    throw new Error("v1 模板页面内容必须是 JSON 字符串");
  }
  if (
    format === FORGE_TEMPLATE_V2 &&
    (typeof record.payload !== "object" || Array.isArray(record.payload))
  ) {
    throw new Error("v2 模板页面内容必须是页面定义对象");
  }
  return {
    format,
    id: typeof record.id === "string" ? record.id : undefined,
    name: typeof record.name === "string" && record.name.trim() ? record.name : "导入模板",
    payload: record.payload,
  };
}

export type OperationCandidate = {
  id: string;
  operation_id: string;
  method: string;
  path: string;
};

export type MigrationOptions = {
  /** Target project's API documents; an empty list means nothing is bound. */
  documents?: OperationCandidate[];
  /** Explicit C2 response mapping; without it the runtime cannot resolve records. */
  binding?: ResponseBinding;
  /** The user must explicitly confirm before a v2 artifact is written. */
  confirmed?: boolean;
};

export type MigrationPreview = {
  /** Present for preview only; undefined when a blocking issue exists. */
  definition?: ForgeUIPageDefinitionV2;
  issues: MigrationIssue[];
  dropped: { rows: number; stats: number; customPayloads: number };
  /** Saving a v2 artifact requires both a clean mapping and user confirmation. */
  canSaveV2: boolean;
};

const BLOCKING = new Set([
  "MIGRATION_DOCUMENT_MISSING",
  "MIGRATION_DUPLICATE_OPERATION",
  "MIGRATION_ROW_KEY_UNRESOLVED",
  "MIGRATION_ITEMS_POINTER_UNRESOLVED",
  "MIGRATION_OPERATION_UNRESOLVED",
]);

function pointerSegment(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function columnType(page: PageSpec, column: string): string {
  const meta = page.columnMeta?.find((item) => item.name === column);
  const allowed = ["string", "number", "date", "datetime", "enum", "boolean", "money"];
  return meta && allowed.includes(meta.type) ? meta.type : "string";
}

/**
 * v1 rows, literal stats and custom payloads are data, not definition. They are
 * always dropped. A v2 artifact is produced only as a preview unless the user
 * explicitly confirms and the response mapping is complete.
 */
export function previewV1Migration(
  page: PageSpec,
  options: MigrationOptions = {},
): MigrationPreview {
  const structural = forTemplate(page);
  const issues: MigrationIssue[] = [];
  const rows = Array.isArray(page.rows) ? page.rows.length : 0;
  const stats = Array.isArray(page.stats) ? page.stats.length : 0;
  const customPayloads = (page.batchActions ?? []).filter(
    (action) => action.payloadBuilder?.customPayload !== undefined,
  ).length;
  if (rows > 0) issues.push({ code: "MIGRATION_ROWS_DROPPED", message: "已丢弃加载的业务行" });
  if (stats > 0) {
    issues.push({ code: "MIGRATION_STATS_DROPPED", message: "已丢弃字面统计值" });
    issues.push({
      code: "MIGRATION_METRICS_UNBOUND",
      message: "字面统计不会自动升级为全库指标；请显式绑定统计端点后再另存 v2",
    });
  }
  if (customPayloads > 0)
    issues.push({ code: "MIGRATION_CUSTOM_PAYLOAD_DROPPED", message: "已丢弃自定义批量载荷" });

  const documents = options.documents ?? [];
  const operations = structural.operations ?? [];
  const seen = new Set<string>();
  const v2Operations: Record<string, unknown>[] = [];
  for (const operation of operations) {
    if (seen.has(operation.operation_id)) {
      issues.push({
        code: "MIGRATION_DUPLICATE_OPERATION",
        message: "存在重名操作，需要用户确认映射",
      });
      continue;
    }
    seen.add(operation.operation_id);
    const candidate = documents.find(
      (item) =>
        item.operation_id === operation.operation_id &&
        item.method === operation.method &&
        item.path === operation.path,
    );
    if (!candidate) {
      issues.push({ code: "MIGRATION_OPERATION_UNRESOLVED", message: "操作未绑定到目标项目文档" });
      continue;
    }
    v2Operations.push({
      key: operation.operation_id,
      apiDocumentId: candidate.id,
      operation_id: operation.operation_id,
      method: operation.method,
      path: operation.path,
      role: operation.role,
    });
  }
  if (operations.length === 0 || documents.length === 0) {
    issues.push({ code: "MIGRATION_DOCUMENT_MISSING", message: "缺少目标项目 API 文档绑定" });
  }

  const binding = options.binding;
  if (!binding || !binding.confirmed || !binding.rowKeyPointer || !binding.itemsPointer) {
    issues.push({ code: "MIGRATION_ROW_KEY_UNRESOLVED", message: "记录身份或列表指针未确认" });
    issues.push({ code: "MIGRATION_ITEMS_POINTER_UNRESOLVED", message: "列表指针未确认" });
  }
  const listOperation = operations.find((operation) => operation.role === "list");
  if (!listOperation) {
    issues.push({ code: "MIGRATION_OPERATION_UNRESOLVED", message: "缺少列表操作" });
  }
  if (page.filters.length > 0) {
    issues.push({ code: "MIGRATION_FILTER_UNRESOLVED", message: "筛选参数映射需要确认" });
  }

  const blocking = issues.filter((issue) => BLOCKING.has(issue.code));
  if (blocking.length > 0) {
    return {
      issues,
      dropped: { rows, stats, customPayloads },
      canSaveV2: false,
    };
  }

  const fields = structural.columns.map((column, index) => ({
    key: binding?.fieldPointers[index] ? `field_${index}` : `field_${pointerSegment(column)}`,
    label: column,
    valuePointer: binding?.fieldPointers[index] ?? `/${pointerSegment(column)}`,
    type: columnType(page, column),
  }));
  const definition = {
    version: 2,
    title: structural.title,
    description: structural.description,
    ...(structural.layout ? { layout: structural.layout } : {}),
    ...(structural.theme ? { theme: structural.theme } : {}),
    dataSources: {
      primary: {
        operationRef: listOperation!.operation_id,
        itemsPointer: binding!.itemsPointer,
        ...(binding!.totalPointer ? { totalPointer: binding!.totalPointer } : {}),
        rowKeyPointer: binding!.rowKeyPointer,
      },
    },
    fields,
    filters: [],
    operations: v2Operations,
    views: [
      {
        key: "primaryList",
        type: "list",
        dataSourceRef: "primary",
        fieldKeys: fields.map((field) => field.key),
      },
    ],
  } as unknown as ForgeUIPageDefinitionV2;

  return {
    definition,
    issues,
    dropped: { rows, stats, customPayloads },
    canSaveV2: Boolean(options.confirmed),
  };
}

/**
 * Cross-project imports must never inherit document IDs, secret refs or base URLs.
 * The target binding is written only after an explicit, unambiguous confirmation.
 */
export function rebindForProject(
  definition: ForgeUIPageDefinitionV2,
  options: { candidates: OperationCandidate[]; targetApiDocumentId?: string; confirmed?: boolean },
): { definition: ForgeUIPageDefinitionV2; issues: MigrationIssue[] } {
  const issues: MigrationIssue[] = [];
  const clone = JSON.parse(JSON.stringify(definition)) as ForgeUIPageDefinitionV2 & {
    operations: Array<Record<string, unknown>>;
  };
  const matches = options.candidates.filter((item) => item.id === options.targetApiDocumentId);
  // Old bindings never survive a cross-project import, even in preview-only mode.
  for (const operation of clone.operations) {
    for (const key of ["apiDocumentId", "secretRef", "baseUrl", "auth", "credentials"]) {
      delete operation[key];
    }
  }
  if (!options.confirmed) {
    issues.push({ code: "MIGRATION_REBIND_UNCONFIRMED", message: "重绑定需要用户确认" });
  } else if (!options.targetApiDocumentId || matches.length === 0) {
    issues.push({ code: "MIGRATION_REBIND_NO_CANDIDATE", message: "目标项目没有匹配的 API 文档" });
  } else {
    const byOperation = new Map(matches.map((item) => [item.operation_id, item]));
    for (const operation of clone.operations) {
      const match = byOperation.get(String(operation.operation_id));
      if (!match || match.method !== operation.method || match.path !== operation.path) {
        issues.push({ code: "MIGRATION_REBIND_MISMATCH", message: "存在方法或路径不一致的操作" });
        continue;
      }
      operation.apiDocumentId = match.id;
    }
  }
  return { definition: clone, issues };
}

export function buildV2Envelope(
  definition: ForgeUIPageDefinitionV2,
  name: string,
  id?: string,
): string {
  return JSON.stringify({
    format: FORGE_TEMPLATE_V2,
    ...(id ? { id } : {}),
    name,
    payload: definition,
  });
}
