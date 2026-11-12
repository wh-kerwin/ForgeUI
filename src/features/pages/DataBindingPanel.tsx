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
import { useOptionalLanguage } from "../../i18n/languageContext";

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
  zh: boolean,
): string {
  const hasSuggestion = typeof suggested === "string" && suggested.length > 0;
  if (origin === "schema" && hasSuggestion)
    return zh ? "来自 OpenAPI 响应 Schema" : "From OpenAPI response schema";
  return zh ? "待确认映射" : "Mapping unconfirmed";
}

/**
 * Derive display-only scalars from a locally mapped response. Record contents,
 * row keys and issue messages are intentionally never read or surfaced.
 */
function computePreview(
  sample: unknown,
  binding: ResponseBinding,
  zh: boolean,
): PreviewView | null {
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
      totalText:
        typeof mapped.total === "number" ? String(mapped.total) : zh ? "未提供" : "Not provided",
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
  const zh = useOptionalLanguage() === "zh";
  return (
    <span className="muted">
      {label}
      {zh ? "：" : ": "}
      <span>{originTag(origin, suggested, zh)}</span>
    </span>
  );
}

function PreviewBlock({ preview }: { preview: PreviewView }) {
  const zh = useOptionalLanguage() === "zh";
  return (
    <div style={previewStyle} aria-label={zh ? "本地样本预览" : "Local sample preview"}>
      <span>
        {zh ? "映射状态：" : "Status: "}
        {preview.status}
      </span>
      <span>
        {zh ? "记录数：" : "Records: "}
        {preview.recordCount}
      </span>
      <span>
        {zh ? "总数：" : "Total: "}
        <span>{preview.totalText}</span>
      </span>
      <span>
        {preview.writable
          ? zh
            ? "写入可用"
            : "Writes enabled"
          : zh
            ? "写入已禁用"
            : "Writes disabled"}
      </span>
      <span>
        {zh ? "诊断：" : "Diagnostics: "}
        {preview.issueCounts.length === 0
          ? zh
            ? "无"
            : "None"
          : preview.issueCounts.map((item) => (
              <span key={item.code} style={{ marginRight: 8 }}>
                {`${item.code} × ${item.count}`}
              </span>
            ))}
      </span>
      {preview.rowsTruncated ? <span>{zh ? "行已截断" : "Rows truncated"}</span> : null}
      {preview.fieldsTruncated ? <span>{zh ? "字段已截断" : "Fields truncated"}</span> : null}
    </div>
  );
}

/**
 * Pure presentational + callback panel. It holds no persistent state, emits no
 * IPC/network requests, and keeps the local sample strictly client-side.
 */
export function DataBindingPanel({ documents, binding, onChange, sample }: Props) {
  const zh = useOptionalLanguage() === "zh";
  const t = zh
    ? {
        section: "数据绑定",
        listOperation: "列表 operation",
        selectOperation: "选择 list operation",
        items: "items 指针",
        total: "total 指针",
        rowKey: "rowKey 指针",
        schemaIssues: "响应 Schema 诊断：",
        fields: "绑定字段",
        noFields: "暂无建议字段",
        fieldLabel: "字段",
        confirmed: "已确认绑定",
        previewOnly: "仅预览，写入已禁用",
        confirm: "确认绑定",
        sampleNote: "本地样本仅用于预览，不会发送给模型",
      }
    : {
        section: "Data binding",
        listOperation: "List operation",
        selectOperation: "Select list operation",
        items: "items pointer",
        total: "total pointer",
        rowKey: "rowKey pointer",
        schemaIssues: "Response schema diagnostics: ",
        fields: "Bound fields",
        noFields: "No suggested fields",
        fieldLabel: "Field",
        confirmed: "Binding confirmed",
        previewOnly: "Preview only, writes disabled",
        confirm: "Confirm binding",
        sampleNote: "Local samples are preview-only and never sent to the model",
      };
  const options = buildOptions(documents);
  const current = binding ?? EMPTY_BINDING;
  const currentValue = binding
    ? `${binding.apiDocumentId ?? ""}${SEPARATOR}${binding.operationKey}`
    : "";
  const selected = options.find((option) => option.value === currentValue) ?? null;
  const summary = selected?.summary;
  const fields = summary?.fields ?? [];
  const preview = computePreview(sample, current, zh);
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
    <section className="panel data-binding-panel" aria-label={t.section}>
      <div className="panel-head">
        <div>
          <span className="eyebrow">DATA BINDING</span>
          <h3>{t.section}</h3>
        </div>
      </div>

      <div className="binding-row">
        <span className="muted">{t.listOperation}</span>
        <SelectField
          value={currentValue}
          options={options}
          onChange={onSelectOperation}
          ariaLabel={t.selectOperation}
        />
      </div>

      <div className="binding-origins">
        <OriginLine
          label={t.items}
          origin={summary?.itemsPointerOrigin}
          suggested={summary?.itemsPointer}
        />
        <OriginLine
          label={t.total}
          origin={summary?.totalPointerOrigin}
          suggested={summary?.totalPointer}
        />
        <OriginLine
          label={t.rowKey}
          origin={summary?.rowKeyPointerOrigin}
          suggested={summary?.rowKeyPointer}
        />
      </div>

      {schemaIssueCounts.size > 0 ? (
        <div className="muted" style={{ marginBottom: 8 }}>
          {t.schemaIssues}
          {[...schemaIssueCounts].map(([code, count]) => (
            <code key={code} style={{ marginRight: 6 }}>
              {count > 1 ? `${code} × ${count}` : code}
            </code>
          ))}
        </div>
      ) : null}

      <label className="binding-row">
        <span className="muted">{t.items}</span>
        <input
          type="text"
          aria-label={t.items}
          value={current.itemsPointer}
          onChange={(event) => patch({ itemsPointer: event.target.value })}
        />
      </label>
      <label className="binding-row">
        <span className="muted">{t.total}</span>
        <input
          type="text"
          aria-label={t.total}
          value={current.totalPointer ?? ""}
          onChange={(event) => patch({ totalPointer: event.target.value || undefined })}
        />
      </label>
      <label className="binding-row">
        <span className="muted">{t.rowKey}</span>
        <input
          type="text"
          aria-label={t.rowKey}
          value={current.rowKeyPointer}
          onChange={(event) => patch({ rowKeyPointer: event.target.value })}
        />
      </label>

      <fieldset className="binding-fields">
        <legend className="muted">{t.fields}</legend>
        {fields.length === 0 ? (
          <span className="muted">{t.noFields}</span>
        ) : (
          fields.map((field) => (
            <label className="operation-option" key={field.pointer}>
              <input
                type="checkbox"
                aria-label={`${t.fieldLabel} ${field.name} ${field.pointer}`}
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

      <p className="muted">{current.confirmed ? t.confirmed : t.previewOnly}</p>
      <button
        type="button"
        className="primary"
        aria-label={t.confirm}
        onClick={() => onChange({ ...current, confirmed: true })}
      >
        {t.confirm}
      </button>

      {preview ? (
        <>
          <p className="muted" style={{ marginTop: 12 }}>
            {t.sampleNote}
          </p>
          <PreviewBlock preview={preview} />
        </>
      ) : null}
    </section>
  );
}
