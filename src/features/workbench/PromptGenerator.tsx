import { Bot, Settings2 } from "lucide-react";
import { HeroVisual } from "./HeroVisual";
import { PromptBox } from "./PromptBox";
import { TemplatePicker } from "./TemplatePicker";
import type { TemplateRecord } from "../../types/domain";
import { useLanguage } from "../../i18n/LanguageProvider";

type Props = {
  prompt: string;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  onOpenSettings: () => void;
  templates: TemplateRecord[];
  selectedTemplateId: string;
  onTemplateSelect: (id: string) => void;
  onTemplateClear: () => void;
};

export function PromptGenerator({ prompt, onPromptChange, onGenerate, onOpenSettings, templates, selectedTemplateId, onTemplateSelect, onTemplateClear }: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
  const examples = zh ? ["本周订单总览 Dashboard", "设备管理：按状态筛选并支持编辑", "客户列表 + 详情 + 趋势"] : ["Weekly orders dashboard", "Device manager with status filters", "Customers, details and trends"];
  return <>
    <header>
      <div><span className="eyebrow">GENERATIVE WORKBENCH</span><h1>{zh ? "把自然语言变成业务界面" : "Turn language into a business interface"}</h1></div>
      <button className="ghost" onClick={onOpenSettings}><Settings2 size={16} />{zh ? "模型设置" : "Model settings"}</button>
    </header>
    <section className="hero" id="generate">
      <div className="hero-copy">
        <span className="pill"><Bot size={14} />{zh ? "AI 页面生成器" : "AI PAGE GENERATOR"}</span>
        <h2>{zh ? <>你的后端，<em>即时成 UI。</em></> : <>Your backend,<br /><em>instantly made useful.</em></>}</h2>
        <p>{zh ? "连接 Swagger / OpenAPI，描述你要做的事。Forge 会基于真实接口结构生成可运行、可复用的业务页面。" : "Connect Swagger / OpenAPI and describe the task. Forge turns real operations into a reusable business page."}</p>
        <TemplatePicker templates={templates} selectedId={selectedTemplateId} onSelect={onTemplateSelect} onClear={onTemplateClear} />
        <PromptBox prompt={prompt} onPromptChange={onPromptChange} onGenerate={onGenerate} />
        <div className="prompt-examples"><span className="eyebrow">{zh ? "试试这样说" : "TRY A STARTER"}</span>{examples.map((example) => <button key={example} className="example-chip" onClick={() => onPromptChange(example)}>{example}</button>)}</div>
      </div>
      <HeroVisual />
    </section>
  </>;
}
