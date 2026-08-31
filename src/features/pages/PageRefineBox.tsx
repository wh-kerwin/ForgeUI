import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useLanguage } from "../../i18n/LanguageProvider";

type Props = {
  onRefine: (instruction: string) => Promise<void>;
  refining: boolean;
};

export function PageRefineBox({ onRefine, refining }: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
  const [instruction, setInstruction] = useState("");
  async function submit() {
    if (!instruction.trim()) return;
    await onRefine(instruction);
    setInstruction("");
  }
  return (
    <div className="mutation-box refine-box">
      <span className="eyebrow">CONVERSATIONAL EDIT</span>
      <h4>{zh ? "继续修改这个页面" : "Keep refining this page"}</h4>
      <div className="delete-row">
        <input
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={
            zh
              ? "例如：增加按负责人筛选，并把状态列移到第一列"
              : "e.g. Add an owner filter and move the status column first"
          }
        />
        <button className="secondary" disabled={refining} onClick={submit}>
          <Sparkles size={14} />
          {refining ? (zh ? "修改中…" : "Updating…") : zh ? "应用修改" : "Apply changes"}
        </button>
      </div>
    </div>
  );
}
