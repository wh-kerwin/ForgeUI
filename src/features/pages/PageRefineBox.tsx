import { useState } from "react";
import { Sparkles } from "lucide-react";

type Props = {
  onRefine: (instruction: string) => Promise<void>;
  refining: boolean;
};

export function PageRefineBox({ onRefine, refining }: Props) {
  const [instruction, setInstruction] = useState("");
  async function submit() {
    if (!instruction.trim()) return;
    await onRefine(instruction);
    setInstruction("");
  }
  return (
    <div className="mutation-box refine-box">
      <span className="eyebrow">CONVERSATIONAL EDIT</span>
      <h4>继续修改这个页面</h4>
      <div className="delete-row">
        <input
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="例如：增加按负责人筛选，并把状态列移到第一列"
        />
        <button className="secondary" disabled={refining} onClick={submit}>
          <Sparkles size={14} />
          {refining ? "修改中…" : "应用修改"}
        </button>
      </div>
    </div>
  );
}
