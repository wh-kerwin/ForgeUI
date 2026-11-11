import type { ApiDocument, PageSpec, TemplateRecord } from "../../types/domain";
import { operationKey, runtimeOperationFromKey } from "../pages/pageOperations";

/**
 * Templates store a structural definition plus a separate binding intent.
 * A document ID from another project (or a deleted/disabled document) is never
 * carried over, and an operation with the same operationId but a different
 * path is never treated as a match.
 */
export type BindingState =
  | "bound"
  | "needs-rebind"
  | "no-candidate"
  | "ambiguous"
  | "mismatch"
  | "missing-document"
  | "disabled"
  | "foreign";

export type BindingCandidate = {
  documentId: string;
  documentName: string;
  operationKey: string;
  fields: string[];
};

export type BindingEntry = {
  key: string;
  method: string;
  path: string;
  operationId: string;
  state: BindingState;
  candidates: BindingCandidate[];
  selectedDocumentId?: string;
  sourceDocumentIds: string[];
};

export type BindingReconciliation = {
  entries: BindingEntry[];
  selections: Record<string, string>;
  canApply: boolean;
  issues: { code: string; message: string }[];
  summary: "bound" | "needs-rebind" | "partial" | "ambiguous" | "no-candidate";
};

type Scope = {
  template: Pick<TemplateRecord, "apiDocumentIds">;
  page: PageSpec;
  documents: readonly ApiDocument[];
  projectId: string;
};

function fieldStructure(document: ApiDocument, operationId: string): string[] {
  const spec = document.spec;
  return [
    ...(spec.fieldSchemas?.[operationId] ?? []).map((field) => field.name),
    ...(spec.queryParameters?.[operationId] ?? []),
  ].slice(0, 20);
}

/** Documents that are usable in this project right now. */
function activeDocuments(documents: readonly ApiDocument[], projectId: string) {
  return documents.filter((document) => document.enabled && document.projectId === projectId);
}

export function reconcileTemplateBindings({
  template,
  page,
  documents,
  projectId,
}: Scope): BindingReconciliation {
  const usable = activeDocuments(documents, projectId);
  const sourceIds = [...new Set(template.apiDocumentIds)];
  const issues: BindingReconciliation["issues"] = [];
  const sourceState = new Map<string, BindingState>();
  for (const id of sourceIds) {
    const document = documents.find((item) => item.id === id);
    const state: BindingState = !document
      ? "missing-document"
      : document.projectId !== projectId
        ? "foreign"
        : !document.enabled
          ? "disabled"
          : "bound";
    sourceState.set(id, state);
    if (state !== "bound")
      issues.push({
        code: `TEMPLATE_BINDING_${state.toUpperCase().replace(/-/g, "_")}`,
        message: "模板绑定的 API 文档已失效或不属于当前项目，需要显式重绑定",
      });
  }

  const entries: BindingEntry[] = (page.operations ?? []).map((operation) => {
    const key = operationKey(operation.method, operation.path, operation.operation_id);
    const candidates: BindingCandidate[] = usable.flatMap((document) =>
      document.spec.operations.includes(key)
        ? [
            {
              documentId: document.id,
              documentName: document.name,
              operationKey: key,
              fields: fieldStructure(document, operation.operation_id),
            },
          ]
        : [],
    );
    const sameNameDifferentPath = usable.some((document) =>
      document.spec.operations.some((candidateKey) => {
        const parsed = runtimeOperationFromKey(candidateKey);
        return parsed?.operationId === operation.operation_id && parsed.path !== operation.path;
      }),
    );
    let state: BindingState;
    if (candidates.length === 0) state = sameNameDifferentPath ? "mismatch" : "no-candidate";
    else if (candidates.length > 1) state = "ambiguous";
    else if (
      sourceIds.includes(candidates[0].documentId) &&
      sourceState.get(candidates[0].documentId) === "bound"
    )
      state = "bound";
    else state = "needs-rebind";
    return {
      key,
      method: operation.method,
      path: operation.path,
      operationId: operation.operation_id,
      state,
      candidates,
      selectedDocumentId: candidates.length === 1 ? candidates[0].documentId : undefined,
      sourceDocumentIds: sourceIds,
    };
  });

  const selections: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.selectedDocumentId) selections[entry.key] = entry.selectedDocumentId;
  }
  // A purely presentational template has no operations to bind.
  const allBound = entries.every((entry) => entry.state === "bound");
  const canApply =
    allBound && issues.length === 0 && Object.keys(selections).length === entries.length;
  const summary = !allBound
    ? entries.some((entry) => entry.state === "no-candidate" || entry.state === "mismatch")
      ? "no-candidate"
      : entries.some((entry) => entry.state === "ambiguous")
        ? "ambiguous"
        : entries.some((entry) => !entry.selectedDocumentId)
          ? "partial"
          : "needs-rebind"
    : "bound";

  return { entries, selections, canApply, issues, summary };
}

/** Only explicitly confirmed selections are written; nothing is inferred. */
export function applyTemplateBindings(
  page: PageSpec,
  selections: Record<string, string>,
): PageSpec {
  const next = JSON.parse(JSON.stringify(page)) as PageSpec;
  next.operations = (next.operations ?? []).map((operation) => {
    const selected =
      selections[operationKey(operation.method, operation.path, operation.operation_id)];
    return selected ? { ...operation, apiDocumentId: selected } : { ...operation };
  });
  return next;
}

/** Host-side re-check: every binding must resolve in the current project. */
export function verifyTemplateBindings(
  page: PageSpec,
  documents: readonly ApiDocument[],
  projectId: string,
): boolean {
  const usable = activeDocuments(documents, projectId);
  const operations = page.operations ?? [];
  if (operations.length === 0) return true;
  return operations.every((operation) => {
    const id = operation.apiDocumentId;
    if (!id) return false;
    const document = usable.find((item) => item.id === id);
    if (!document) return false;
    const key = operationKey(operation.method, operation.path, operation.operation_id);
    return document.spec.operations.includes(key);
  });
}

export type BindingSummary = { state: BindingState; label: string };

export function bindingSummaryFor(scope: Scope): BindingSummary {
  const result = reconcileTemplateBindings(scope);
  const labels: Record<BindingReconciliation["summary"], string> = {
    bound: "绑定有效",
    "needs-rebind": "需确认重绑定",
    partial: "部分绑定",
    ambiguous: "存在多个候选",
    "no-candidate": "无可用绑定",
  };
  const state: BindingState =
    result.summary === "bound"
      ? "bound"
      : result.summary === "ambiguous"
        ? "ambiguous"
        : result.summary === "no-candidate"
          ? "no-candidate"
          : "needs-rebind";
  return { state, label: labels[result.summary] };
}
