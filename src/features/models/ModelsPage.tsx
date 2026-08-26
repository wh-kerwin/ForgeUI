import { useLanguage } from "../../i18n/LanguageProvider";
import { ModelEditor } from "./ModelEditor";
import { ModelRouter } from "./ModelRouter";
import { PageLayout } from "../openapi/OpenApiPage";
import type { ModelConfig, PromptTemplate } from "../../types/domain";
import { PromptTemplateManager } from "./PromptTemplateManager";

type Props = {
  models: ModelConfig[];
  active?: ModelConfig;
  selectedId: string;
  onSelect: (id: string) => void;
  onEdit: () => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onMakeDefault: () => void;
  onDelete: () => void;
  editor: boolean;
  editorModel?: ModelConfig;
  onClose: () => void;
  onSave: (model: ModelConfig) => void;
  onTest: (model: ModelConfig) => void;
  testing: boolean;
  builtInPromptTemplates: PromptTemplate[];
  customPromptTemplates: PromptTemplate[];
  onPromptTemplatesChange: (templates: PromptTemplate[]) => void;
};

export function ModelsPage({ models, active, selectedId, onSelect, onEdit, onAdd, onDuplicate, onMakeDefault, onDelete, editor, editorModel, onClose, onSave, onTest, testing, builtInPromptTemplates, customPromptTemplates, onPromptTemplatesChange }: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
  return <PageLayout eyebrow="MODEL SERVICES" title={zh ? "模型配置" : "Model services"} intro={zh ? "管理多个 OpenAI Compatible 或 Anthropic Compatible 模型服务。" : "Manage multiple OpenAI Compatible or Anthropic Compatible model services."}>
    <div className="models-toolbar"><span className="muted">{zh ? `已配置 ${models.length} 个模型服务 · 当前使用：${active?.name || "未配置"}` : `${models.length} model service${models.length === 1 ? "" : "s"} configured · Active: ${active?.name || "Not configured"}`}</span><button className="primary" onClick={onAdd}>+ {zh ? "新增模型" : "Add model"}</button></div>
    <ModelRouter models={models} active={active} selectedId={selectedId} onSelect={onSelect} onOpenSettings={onEdit} onDuplicate={onDuplicate} onMakeDefault={onMakeDefault} onDelete={onDelete}/>
    <PromptTemplateManager builtIns={builtInPromptTemplates} custom={customPromptTemplates} onChange={onPromptTemplatesChange} />
    {editor && <ModelEditor initial={editorModel} promptTemplates={[...builtInPromptTemplates, ...customPromptTemplates]} onClose={onClose} onSave={onSave} onTest={onTest} testing={testing}/>}
  </PageLayout>;
}
