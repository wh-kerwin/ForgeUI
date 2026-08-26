import { LayoutTemplate, X } from "lucide-react";
import type { TemplateRecord } from "../../types/domain";
import { useLanguage } from "../../i18n/LanguageProvider";
import { SelectField } from "../../components/SelectField";

type Props = { templates: TemplateRecord[]; selectedId: string; onSelect: (id: string) => void; onClear: () => void };

export function TemplatePicker({ templates, selectedId, onSelect, onClear }: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
  if (!templates.length) return <div className="template-context empty"><LayoutTemplate size={14} />{zh ? "保存页面后，可以在未来的对话中复用它的结构。" : "Save a page to reuse its structure in a future prompt."}</div>;
  return <div className="template-context"><LayoutTemplate size={16} /><span>{zh ? "从模板开始" : "Start from"}</span><SelectField className="template-select" value={selectedId} options={[{ value: "", label: zh ? "不使用模板" : "No saved template" }, ...templates.map((template) => ({ value: template.id, label: template.name }))]} onChange={onSelect} ariaLabel={zh ? "选择页面模板" : "Select page template"} />{selectedId && <button type="button" className="clear-template" aria-label={zh ? "清除模板" : "Clear saved template"} onClick={onClear}><X size={13} /></button>}</div>;
}
