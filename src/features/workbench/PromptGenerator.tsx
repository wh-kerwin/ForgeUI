import { Bot, Settings2 } from "lucide-react";
import { HeroVisual } from "./HeroVisual";
import { PromptBox } from "./PromptBox";

type Props = {
  prompt: string;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  onOpenSettings: () => void;
};

export function PromptGenerator({ prompt, onPromptChange, onGenerate, onOpenSettings }: Props) {
  return <>
    <header>
      <div><span className="eyebrow">GENERATIVE WORKBENCH</span><h1>把自然语言变成业务界面</h1></div>
      <button className="ghost" onClick={onOpenSettings}><Settings2 size={16} />模型设置</button>
    </header>
    <section className="hero" id="generate">
      <div className="hero-copy">
        <span className="pill"><Bot size={14} />AI 页面生成器</span>
        <h2>你的后端，<em>即时成 UI。</em></h2>
        <p>连接 Swagger / OpenAPI，描述你要做的事。Forge 会基于真实接口结构生成可运行、可复用的业务页面。</p>
        <PromptBox prompt={prompt} onPromptChange={onPromptChange} onGenerate={onGenerate} />
      </div>
      <HeroVisual />
    </section>
  </>;
}
