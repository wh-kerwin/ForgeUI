import { Sparkles } from "lucide-react";
import { useLanguage } from "../../i18n/LanguageProvider";

type Props = { prompt: string; onPromptChange: (value: string) => void; onGenerate: () => void; generating: boolean };

export function PromptBox({ prompt, onPromptChange, onGenerate, generating }: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
  return <div className="prompt-box">
    <textarea disabled={generating} value={prompt} onChange={(event) => onPromptChange(event.target.value)} onKeyDown={(event) => { if (!generating && (event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); onGenerate(); } }} placeholder={zh ? "例如：生成一个设备管理页，支持按状态筛选、查看详情、新增和编辑设备…" : "e.g. Build a device manager with status filters, details and editing…"} />
    <div className="prompt-actions"><span><span className="key">⌘</span> Enter {zh ? "生成" : "Generate"}</span><button disabled={generating} onClick={onGenerate}><Sparkles size={15} />{generating ? (zh ? "生成中…" : "Generating…") : (zh ? "生成页面" : "Generate page")}</button></div>
  </div>;
}
