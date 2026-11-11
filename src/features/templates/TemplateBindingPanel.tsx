import { useState } from "react";
import type { BindingReconciliation } from "./templateBinding";

const stateLabels: Record<string, [string, string]> = {
  bound: ["绑定有效", "Bound"],
  "needs-rebind": ["需确认重绑定", "Needs rebind"],
  "no-candidate": ["无可用绑定", "No candidate"],
  ambiguous: ["存在多个候选", "Multiple candidates"],
  mismatch: ["仅同名操作，路径不同", "Same operationId, different path"],
  "missing-document": ["文档已删除", "Document removed"],
  disabled: ["文档已禁用", "Document disabled"],
  foreign: ["属于其他项目", "Other project"],
};

export function TemplateBindingPanel({
  title,
  reconciliation,
  selections,
  zh,
  onSelect,
  onConfirm,
  onCancel,
}: {
  title: string;
  reconciliation: BindingReconciliation;
  selections: Record<string, string>;
  zh: boolean;
  onSelect: (key: string, documentId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const language = zh ? 0 : 1;
  const complete =
    reconciliation.entries.length > 0 &&
    reconciliation.entries.every((entry) => Boolean(selections[entry.key]));
  return (
    <div
      className="mutation-box template-binding"
      role="region"
      aria-label={zh ? "模板绑定协调" : "Template binding reconciliation"}
    >
      <span className="eyebrow">BINDING REVIEW</span>
      <h4>
        {zh ? "确认模板「" : "Confirm bindings for "}
        {title}
        {zh ? "」的 API 绑定" : ""}
      </h4>
      <p className="muted">
        {zh
          ? "模板只保存页面结构。跨项目文档 ID 不会沿用；同名但路径不同的操作不会自动替换。"
          : "Templates store structure only. Cross-project IDs are never carried over; same-name operations with different paths are never auto-matched."}
      </p>
      {reconciliation.issues.map((issue) => (
        <p key={issue.code} role="alert" data-binding-issue={issue.code}>
          {issue.message}
        </p>
      ))}
      <ul className="binding-entry-list">
        {reconciliation.entries.map((entry) => (
          <li key={entry.key} data-binding-state={entry.state} data-operation-key={entry.key}>
            <strong>{entry.key}</strong>
            <span className="muted"> {stateLabels[entry.state]?.[language] ?? entry.state}</span>
            {entry.candidates.length > 0 ? (
              <label>
                <span className="muted"> {zh ? "目标文档：" : "Target: "}</span>
                <select
                  aria-label={`${zh ? "绑定" : "Bind"} ${entry.key}`}
                  value={selections[entry.key] ?? ""}
                  onChange={(event) => onSelect(entry.key, event.target.value)}
                >
                  <option value="">{zh ? "请选择" : "Choose"}</option>
                  {entry.candidates.map((candidate) => (
                    <option key={candidate.documentId} value={candidate.documentId}>
                      {candidate.documentName}
                      {candidate.fields.length > 0 ? ` · ${candidate.fields.join(",")}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="muted">
                {" "}
                {zh ? "当前项目没有匹配的方法+路径+操作" : "No matching method + path + operation"}
              </span>
            )}
          </li>
        ))}
      </ul>
      <label className="binding-confirm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {zh
          ? "我已确认以上绑定属于当前项目且已授权"
          : "I confirm these bindings are authorized in this project"}
      </label>
      <div className="binding-actions">
        <button className="secondary" disabled={!complete || !confirmed} onClick={onConfirm}>
          {zh ? "确认绑定并使用" : "Confirm bindings and use"}
        </button>
        <button onClick={onCancel}>{zh ? "取消" : "Cancel"}</button>
      </div>
    </div>
  );
}
