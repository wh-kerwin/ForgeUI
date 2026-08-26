import type { ApiDocument, ColumnMeta, FieldSchema, OperationBinding, PageSpec } from "../../types/domain";
import { inferOperationRoles, toAllowedOperations } from "../connections/openApiOperations";
import { documentsForPrompt } from "../pages/pageOperations";

const MAX_COLUMNS = 50;
const MAX_TITLE_LENGTH = 40;

function copyFieldSchema(field: FieldSchema): FieldSchema {
  return {
    ...field,
    ...(field.enumValues ? { enumValues: [...field.enumValues] } : {}),
    ...(field.visibleWhen ? {
      visibleWhen: {
        ...field.visibleWhen,
        equals: Array.isArray(field.visibleWhen.equals) ? [...field.visibleWhen.equals] : field.visibleWhen.equals,
      },
    } : {}),
  };
}

function bindingForDocument(document: ApiDocument): OperationBinding[] {
  return toAllowedOperations(document.spec, document.id, document.auth.authorizedOperations ?? []).map((operation) => {
    const role = inferOperationRoles([operation])[operation.operation_id]?.[0] as OperationBinding["role"] | undefined;
    const bodySchema = document.spec.fieldSchemas?.[operation.operation_id]?.map(copyFieldSchema);
    return {
      apiDocumentId: document.id,
      operation_id: operation.operation_id,
      method: operation.method,
      path: operation.path,
      role: role ?? "read",
      ...(bodySchema?.length ? { bodySchema } : {}),
    };
  });
}

function schemaFields(documents: readonly ApiDocument[], operations: readonly OperationBinding[]): FieldSchema[] {
  const operationKeys = new Set(operations.map((operation) => `${operation.apiDocumentId}\0${operation.operation_id}`));
  const fields = new Map<string, FieldSchema>();
  for (const document of documents) {
    for (const [operationId, operationFields] of Object.entries(document.spec.fieldSchemas ?? {})) {
      if (!operationKeys.has(`${document.id}\0${operationId}`)) continue;
      for (const field of operationFields) {
        if (!fields.has(field.name)) fields.set(field.name, copyFieldSchema(field));
      }
    }
  }
  return [...fields.values()];
}

function columnType(field?: FieldSchema): ColumnMeta["type"] {
  if (!field) return "string";
  if (field.type === "integer") return "number";
  return field.type;
}

function pageTitle(prompt: string, documents: readonly ApiDocument[]) {
  const promptTitle = prompt.trim().replace(/\s+/g, " ").split(/[。！？!?\n]/, 1)[0]?.trim();
  if (promptTitle) return promptTitle.slice(0, MAX_TITLE_LENGTH);
  const documentTitle = documents[0]?.spec.title.trim() || documents[0]?.name.trim();
  return documentTitle ? `${documentTitle} 管理` : "API 数据管理";
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "";
}

/** Restricts fallback generation to model response decoding and PageSpec validation failures. */
export function isPageSpecGenerationError(error: unknown): boolean {
  const message = errorMessage(error).trim();
  return message.startsWith("流式模型响应不完整")
    || message.startsWith("模型输出不符合 PageSpec")
    || message.startsWith("模型响应不是 JSON")
    || message.startsWith("PageSpec ")
    || message.startsWith("不支持的 PageSpec 版本");
}

/** Builds a deterministic, API-bound page when a model response cannot be decoded as PageSpec. */
export function createApiFallbackPage(prompt: string, selectedDocuments: readonly ApiDocument[]): PageSpec {
  const enabledDocuments = selectedDocuments.filter((document) => document.enabled);
  const selection = documentsForPrompt(prompt, enabledDocuments);
  if (!selection.documents.length) throw new Error(selection.error ?? "没有可用于生成页面的 API 文档");
  const documents = selection.documents;
  const operations = documents.flatMap(bindingForDocument);
  const fields = schemaFields(documents, operations);
  const fieldByName = new Map(fields.map((field) => [field.name, field]));
  const columns = ["id", ...fields.map((field) => field.name).filter((name) => name !== "id")].slice(0, MAX_COLUMNS);
  const documentNames = documents.map((document) => document.spec.title.trim() || document.name.trim()).filter(Boolean);

  return {
    version: 1,
    title: pageTitle(prompt, documents),
    description: documentNames.length
      ? `基于所选 ${documentNames.join("、")} OpenAPI 文档生成的基础页面。`
      : "基于所选 OpenAPI 文档生成的基础页面。",
    layout: "full",
    filters: fields.filter((field) => field.name !== "id").slice(0, 4).map((field) => field.name),
    stats: [],
    columns,
    columnMeta: columns.map((name) => ({
      name,
      type: columnType(fieldByName.get(name)),
      sortable: true,
      filterable: name !== "id",
      ...(fieldByName.get(name)?.type === "enum" ? {
        enumLabels: Object.fromEntries((fieldByName.get(name)?.enumValues ?? []).map((value) => [value, value])),
      } : {}),
    })),
    rows: [],
    operations,
    views: [{ type: "list", title: "数据列表" }],
    interaction: { create: "drawer", update: "drawer", detail: "drawer", delete: "modal" },
  };
}

export const buildOpenApiFallbackPage = createApiFallbackPage;
