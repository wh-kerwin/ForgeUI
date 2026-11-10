import type { CSSProperties } from "react";
import { SelectField, type SelectOption } from "../../components/SelectField";
import { responseSchemaForOperation } from "../connections/openApiOperations";
import type {
  ApiDocument,
  PointerOrigin,
  ResponseBinding,
  ResponseSchemaSummary,
} from "../../types/domain";
import { mapResponse } from "./data/responseMapping";

type Props = {
  documents: readonly ApiDocument[];
  binding?: ResponseBinding;
  onChange: (binding: ResponseBinding) => void;
  sample?: unknown;
};

type ListOption = SelectOption & {
  documentId: string;
  operationKey: string;
  operationId: string;
  summary?: ResponseSchemaSummary;
};

type PreviewView = {
  status: string;
  recordCount: number;
  totalText: string;
  writable: boolean;
  issueCounts: { code: string; count: number }[];
  rowsTruncated: boolean;
  fieldsTruncated: boolean;
};

const SEPARATOR = "|";

/** A neutral editing base when the host has not produced a binding yet. */
const EMPTY_BINDING: ResponseBinding = {
  operationKey: "",
  itemsPointer: "",
  rowKeyPointer: "",
  fieldPointers: [],
  confirmed: false,
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  marginBottom: 10,
};
const previewStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  marginTop: 6,
};

/** "GET /orders · listOrders" -> method GET, operationId listOrders. */
function splitOperation(raw: string): { method: string; operationId: string } {
  const [head, id] = raw.split(" · ");
  const method = (head ?? "").trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  const operationId = (id ?? "").trim() || (head ?? "").trim();
  return { method, operationId };
}

function buildOptions(documents: readonly ApiDocument[]): ListOption[] {
  const options: ListOption[] = [];
  for (const doc of documents) {
    const authorized = doc.auth?.authorizedOperations;
    for (const raw of doc.spec?.operations ?? []) {
      const { method, operationId } = splitOperation(raw);
      if (method !== "GET") continue;
      if (authorized && !authorized.includes(raw)) continue;
      options.push({
        value: `${doc.id}${SEPARATOR}${raw}`,
        label: `${doc.name} ${raw}`,
        documentId: doc.id,
        operationKey: raw,
        operationId,
        summary: responseSchemaForOperation(documents, doc.id, raw),
      });
    }
  }
  return options;
}

/** A fresh operation selection resets confirmation and adopts schema suggestions. */
function bindingFromOption(option: ListOption): ResponseBinding {
  const summary = option.summary;
  return {
    apiDocumentId: option.documentId,
    operationKey: option.operationKey,
    itemsPointer: summary?.itemsPointer ?? "",
    ...(summary?.totalPointer ? { totalPointer: summary.totalPointer } : {}),
    rowKeyPointer: summary?.rowKeyPointer ?? "",
    fieldPointers: (summary?.fields ?? []).map((field) => field.pointer),
    confirmed: false,
  };
}

function originTag(
  origin: PointerOrigin | undefined,
  suggested: string | null | undefined,
): string {
  const hasSuggestion = typeof suggested === "string" && suggested.length > 0;
  return origin === "schema" && hasSuggestion ? "来自 OpenAPI 响应 Schema" : "待确认映射";
}

/**
 * Derive display-only scalars from a locally mapped response. Record contents,
 * row keys and issue messages are intentionally never read or surfaced.
 */
function computePreview(sample: unknown, binding: ResponseBinding): PreviewView | null {
  if (sample === undefined) return null;
  try {
    const mapped = mapResponse(sample, binding);
    const counts = new Map<string, number>();
    for (const issue of mapped.issues ?? []) {
      counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
    }
    return {
      status: mapped.status,
      recordCount: mapped.records?.length ?? 0,
      totalText: typeof mapped.total === "number" ? String(mapped.total) : "未提供",
      writable: Boolean(mapped.writable),
      issueCounts: [...counts].map(([code, count]) => ({ code, count })),
      rowsTruncated: Boolean(mapped.truncated?.rows),
      fieldsTruncated: Boolean(mapped.truncated?.fields),
    };
  } catch {
    // A malformed local sample must not take the whole panel down, and must
    // never be rendered. The host keeps full control of the binding.
    return null;
  }
}

function OriginLine({
  label,
  origin,
  suggested,
}: {
  label: string;
  origin: PointerOrigin | undefined;
  suggested: string | null | undefined;
}) {
  return (
    <span className="muted" style={{ marginRight: 12 }}>
      {label}：<span>{originTag(origin, suggested)}</span>
    </span>
  );
}

function PreviewBlock({ preview }: { preview: PreviewView }) {
  return (
    <div style={previewStyle} aria-label="本地样本预览">
      <span>映射状态：{preview.status}</span>
      <span>记录数：{preview.recordCount}</span>
      <span>
        总数：<span>{preview.totalText}</span>
      </span>
      <span>{preview.writable ? "写入可用" : "写入已禁用"}</span>
      <span>
        诊断：
        {preview.issueCounts.length === 0
          ? "无"
          : preview.issueCounts.map((item) => (
              <span key={item.code} style={{ marginRight: 8 }}>
                {`${item.code} × ${item.count}`}
              </span>
            ))}
      </span>
      {preview.rowsTruncated ? <span>行已截断</span> : null}
      {preview.fieldsTruncated ? <span>字段已截断</span> : null}
    </div>
  );
}

/**
 * Pure presentational + callback panel. It holds no persistent state, emits no
 * IPC/network requests, and keeps the local sample strictly client-side.
 */
export function DataBindingPanel({ documents, binding, onChange, sample }: Props) {
  const options = buildOptions(documents);
  const current = binding ?? EMPTY_BINDING;
  const currentValue = binding
    ? `${binding.apiDocumentId ?? ""}${SEPARATOR}${binding.operationKey}`
    : "";
  const selected = options.find((option) => option.value === currentValue) ?? null;
  const summary = selected?.summary;
  const fields = summary?.fields ?? [];
  const preview = computePreview(sample, current);
  // Schema diagnostics are static structural facts. Aggregate repeated codes so
  // the same issue never accumulates on screen (see the UI feedback convention).
  const schemaIssueCounts = new Map<string, number>();
  for (const issue of summary?.issues ?? []) {
    schemaIssueCounts.set(issue.code, (schemaIssueCounts.get(issue.code) ?? 0) + 1);
  }

  const patch = (changes: Partial<ResponseBinding>) =>
    onChange({ ...current, ...changes, confirmed: false });

  const onSelectOperation = (value: string) => {
    const option = options.find((entry) => entry.value === value);
    if (option) onChange(bindingFromOption(option));
  };

  const toggleField = (pointer: string, checked: boolean) =>
    patch({
      fieldPointers: checked
        ? [...current.fieldPointers, pointer]
        : current.fieldPointers.filter((item) => item !== pointer),
    });

  return (
    <section className="panel" aria-label="数据绑定" style={{ marginTop: 12 }}>
      <div className="panel-head">
        <div>
          <span className="eyebrow">DATA BINDING</span>
          <h3>数据绑定</h3>
        </div>
      </div>

      <div style={rowStyle}>
        <span className="muted">列表 operation</span>
        <SelectField
          value={currentValue}
          options={options}
          onChange={onSelectOperation}
          ariaLabel="选择 list operation"
        />
      </div>

      <div style={{ marginBottom: 8 }}>
        <OriginLine
          label="items 指针"
          origin={summary?.itemsPointerOrigin}
          suggested={summary?.itemsPointer}
        />
        <OriginLine
          label="total 指针"
          origin={summary?.totalPointerOrigin}
          suggested={summary?.totalPointer}
        />
        <OriginLine
          label="rowKey 指针"
          origin={summary?.rowKeyPointerOrigin}
          suggested={summary?.rowKeyPointer}
        />
      </div>

      {schemaIssueCounts.size > 0 ? (
        <div className="muted" style={{ marginBottom: 8 }}>
          响应 Schema 诊断：
          {[...schemaIssueCounts].map(([code, count]) => (
            <code key={code} style={{ marginRight: 6 }}>
              {count > 1 ? `${code} × ${count}` : code}
            </code>
          ))}
        </div>
      ) : null}

      <label style={rowStyle}>
        <span className="muted">items 指针</span>
        <input
          type="text"
          aria-label="items 指针"
          value={current.itemsPointer}
          onChange={(event) => patch({ itemsPointer: event.target.value })}
        />
      </label>
      <label style={rowStyle}>
        <span className="muted">total 指针</span>
        <input
          type="text"
          aria-label="total 指针"
          value={current.totalPointer ?? ""}
          onChange={(event) => patch({ totalPointer: event.target.value || undefined })}
        />
      </label>
      <label style={rowStyle}>
        <span className="muted">rowKey 指针</span>
        <input
          type="text"
          aria-label="rowKey 指针"
          value={current.rowKeyPointer}
          onChange={(event) => patch({ rowKeyPointer: event.target.value })}
        />
      </label>

      <fieldset style={{ marginBottom: 10 }}>
        <legend className="muted">绑定字段</legend>
        {fields.length === 0 ? (
          <span className="muted">暂无建议字段</span>
        ) : (
          fields.map((field) => (
            <label className="operation-option" key={field.pointer}>
              <input
                type="checkbox"
                aria-label={`字段 ${field.name} ${field.pointer}`}
                checked={current.fieldPointers.includes(field.pointer)}
                onChange={(event) => toggleField(field.pointer, event.target.checked)}
              />
              <span>
                {field.name} · {field.pointer}
              </span>
            </label>
          ))
        )}
      </fieldset>

      <p className="muted">
        {current.confirmed ? "已确认绑定" : "仅预览，写入已禁用"}
      </p>
      <button
        type="button"
        className="primary"
        aria-label="确认绑定"
        onClick={() => onChange({ ...current, confirmed: true })}
      >
        确认绑定
      </button>

      {preview ? (
        <>
          <p className="muted" style={{ marginTop: 12 }}>
            本地样本仅用于预览，不会发送给模型
          </p>
          <PreviewBlock preview={preview} />
        </>
      ) : null}
    </section>
  );
}
