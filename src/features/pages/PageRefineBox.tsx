import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { RefineStatus } from "./pageRefinement";

type Props = {
  /** Returns true only when a preview was produced; a failure keeps the input. */
  onRefine: (instruction: string) => Promise<boolean>;
  status: RefineStatus;
  issues: { code: string; message: string }[];
  canUndo: boolean;
  onUndo: () => void;
};

export function PageRefineBox({ onRefine, status, issues, canUndo, onUndo }: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
  const [instruction, setInstruction] = useState("");
  const busy = status === "generating" || status === "applying" || status === "previewDiff";
  const label =
    status === "generating"
      ? zh
        ? "生成中…"
        : "Generating…"
      : status === "applying"
        ? zh
          ? "应用中…"
          : "Applying…"
        : status === "previewDiff"
          ? zh
            ? "请先确认修改"
            : "Review changes first"
          : zh
            ? "预览修改"
            : "Preview changes";
  async function submit() {
    if (!instruction.trim() || busy) return;
    const accepted = await onRefine(instruction);
    if (accepted) setInstruction("");
  }
  return (
    <div className="mutation-box refine-box" data-refine-status={status}>
      <span className="eyebrow">CONVERSATIONAL EDIT</span>
      <h4>{zh ? "继续修改这个页面" : "Keep refining this page"}</h4>
      <div className="delete-row">
        <input
          aria-label={zh ? "修改指令" : "Refinement instruction"}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={
            zh
              ? "例如：把金额改为货币格式、隐藏状态列、增加按负责人筛选"
              : "e.g. Format amount as money, hide status, add an owner filter"
          }
        />
        <button className="secondary" disabled={busy || !instruction.trim()} onClick={submit}>
          <Sparkles size={14} />
          {label}
        </button>
        {canUndo && !busy && (
          <button className="secondary" onClick={onUndo}>
            {zh ? "撤销上次修改" : "Undo last change"}
          </button>
        )}
      </div>
      {issues.length > 0 && (
        <ul className="refine-issues" role="alert">
          {issues.map((issue) => (
            <li key={issue.code} data-refine-issue={issue.code}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
