import { Sparkles } from "lucide-react";

type Props = { prompt: string; onPromptChange: (value: string) => void; onGenerate: () => void };

export function PromptBox({ prompt, onPromptChange, onGenerate }: Props) {
  return <div className="prompt-box">
    <textarea value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="例如：生成一个设备管理页，支持按状态筛选、查看详情、新增和编辑设备…" />
    <div className="prompt-actions"><span><span className="key">⌘</span> Enter 生成</span><button onClick={onGenerate}><Sparkles size={15} />生成页面</button></div>
  </div>;
}
