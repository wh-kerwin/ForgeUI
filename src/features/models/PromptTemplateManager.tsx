import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { PromptTemplate } from "../../types/domain";
import { useLanguage } from "../../i18n/LanguageProvider";
import { SelectField } from "../../components/SelectField";

type Draft = Pick<PromptTemplate, "name" | "scene" | "systemPrompt"> & { id?: string };
const emptyDraft = (): Draft => ({ name: "", scene: "crud", systemPrompt: "" });

export function PromptTemplateManager({ builtIns, custom, onChange }: { builtIns: PromptTemplate[]; custom: PromptTemplate[]; onChange: (templates: PromptTemplate[]) => void }) {
  const { language } = useLanguage();
  const zh = language === "zh";
  const [draft, setDraft] = useState<Draft | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const save = () => {
    if (!draft?.name.trim() || !draft.systemPrompt.trim()) return;
    const template: PromptTemplate = { id: draft.id || `custom-${crypto.randomUUID()}`, name: draft.name.trim(), scene: draft.scene, systemPrompt: draft.systemPrompt.trim() };
    onChange(draft.id ? custom.map((item) => item.id === draft.id ? template : item) : [...custom, template]);
    setDraft(null);
  };
  const remove = (id: string) => {
    if (window.confirm(zh ? "删除这个自定义 Prompt 模板？" : "Delete this custom prompt template?")) onChange(custom.filter((item) => item.id !== id));
  };
  return <section className="prompt-template-manager">
    <div className="section-heading"><div><span className="eyebrow">PROMPT TEMPLATES</span><h2>{zh ? "系统提示词模板" : "System prompt templates"}</h2></div><button type="button" className="secondary" onClick={() => setDraft(emptyDraft())}><Plus size={15} />{zh ? "新增模板" : "Add template"}</button></div>
    <div className="prompt-template-list">
      {[...builtIns, ...custom].map((template) => <div className="prompt-template-row" key={template.id}><div><strong>{template.name}</strong><span>{template.scene}</span><p>{template.systemPrompt}</p></div>{!template.isDefault && template.id.startsWith("custom-") && <div className="row-actions"><button type="button" className="icon-btn" title={zh ? "编辑" : "Edit"} onClick={() => setDraft({ ...template })}><Pencil size={15} /></button><button type="button" className="icon-btn danger-icon" title={zh ? "删除" : "Delete"} onClick={() => remove(template.id)}><Trash2 size={15} /></button></div>}</div>)}
    </div>
    {draft && <div className="prompt-template-editor"><div className="two-col"><label>{zh ? "模板名称" : "Template name"}<input value={draft.name} onChange={(event) => set("name", event.target.value)} /></label><label>{zh ? "场景" : "Scene"}<SelectField value={draft.scene} options={[{ value: "dashboard", label: "Dashboard" }, { value: "crud", label: "CRUD" }, { value: "report", label: "Report" }, { value: "kanban", label: "Kanban" }]} onChange={(value) => set("scene", value as PromptTemplate["scene"])} ariaLabel={zh ? "场景" : "Scene"} /></label></div><label>{zh ? "系统提示词" : "System prompt"}<textarea value={draft.systemPrompt} onChange={(event) => set("systemPrompt", event.target.value)} /></label><div className="modal-actions"><button type="button" className="secondary" onClick={() => setDraft(null)}><X size={15} />{zh ? "取消" : "Cancel"}</button><button type="button" className="primary" disabled={!draft.name.trim() || !draft.systemPrompt.trim()} onClick={save}><Check size={15} />{zh ? "保存模板" : "Save template"}</button></div></div>}
  </section>;
}
