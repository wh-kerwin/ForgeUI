import { LayoutTemplate, X } from "lucide-react";
import type { TemplateRecord } from "../../types/domain";
import { useLanguage } from "../../i18n/LanguageProvider";

type Props = { templates: TemplateRecord[]; selectedId: string; onSelect: (id: string) => void; onClear: () => void };

export function TemplatePicker({ templates, selectedId, onSelect, onClear }: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
  if (!templates.length) return <div className="template-context empty"><LayoutTemplate size={14} />{zh ? "保存页面后，可以在未来的对话中复用它的结构。" : "Save a page to reuse its structure in a future prompt."}</div>;
  const selected = templates.find((template) => template.id === selectedId);
  return <div className="template-context"><LayoutTemplate size={14} /><span>{zh ? "从模板开始" : "Start from"}</span><select aria-label={zh ? "已保存页面模板" : "Saved page template"} value={selectedId} onChange={(event) => onSelect(event.target.value)}><option value="">{zh ? "不使用模板" : "No saved template"}</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>{selected && <button className="clear-template" aria-label={zh ? "清除模板" : "Clear saved template"} onClick={onClear}><X size={13} /></button>}</div>;
}
