import { Button, Space } from "antd";
import type { DiffCategory, PageDefinitionDiff as Diff } from "./pageRefinement";

const categoryLabels: Record<DiffCategory, [string, string]> = {
  field: ["字段", "Field"],
  view: ["视图", "View"],
  operation: ["操作", "Operation"],
  binding: ["绑定", "Binding"],
  permission: ["权限", "Permission"],
  filter: ["筛选", "Filter"],
  metadata: ["页面信息", "Page info"],
};

const changeLabels = {
  added: ["新增", "Added"],
  removed: ["移除", "Removed"],
  changed: ["变更", "Changed"],
} as const;

export function PageDefinitionDiff({
  diff,
  zh,
  applying,
  onApply,
  onDiscard,
}: {
  diff: Diff;
  zh: boolean;
  applying: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const language = zh ? 0 : 1;
  return (
    <div className="mutation-box refine-diff" data-requery={diff.requiresRequery}>
      <span className="eyebrow">REVIEW DIFF</span>
      <h4>{zh ? "候选页面修改" : "Proposed page changes"}</h4>
      <p className="muted" role="status">
        {zh
          ? `新增 ${diff.counts.added} · 移除 ${diff.counts.removed} · 变更 ${diff.counts.changed}`
          : `Added ${diff.counts.added} · Removed ${diff.counts.removed} · Changed ${diff.counts.changed}`}
      </p>
      {diff.requiresRequery && (
        <p role="status" className="muted">
          {zh
            ? "数据源发生变化：应用后会清空当前数据、选择并重新查询"
            : "Data source changed: applying clears loaded data and selection, then re-queries"}
        </p>
      )}
      <ul className="refine-diff-list">
        {diff.entries.map((entry) => (
          <li
            key={`${entry.category}:${entry.change}:${entry.key}`}
            data-diff-category={entry.category}
            data-diff-change={entry.change}
          >
            <span className="refine-diff-change">{changeLabels[entry.change][language]}</span>
            <span className="refine-diff-category">{categoryLabels[entry.category][language]}</span>
            <strong>{entry.key}</strong>
            {entry.before !== undefined && entry.after !== undefined && (
              <span className="muted">
                {" "}
                {entry.before} → {entry.after}
              </span>
            )}
          </li>
        ))}
        {diff.entries.length === 0 && (
          <li className="muted">{zh ? "没有结构性变化" : "No structural changes"}</li>
        )}
      </ul>
      <Space wrap>
        <Button type="primary" loading={applying} disabled={applying} onClick={onApply}>
          {zh ? "应用修改" : "Apply changes"}
        </Button>
        <Button
          disabled={applying}
          aria-label={zh ? "放弃修改" : "Discard changes"}
          onClick={onDiscard}
        >
          {zh ? "放弃" : "Discard"}
        </Button>
      </Space>
    </div>
  );
}
