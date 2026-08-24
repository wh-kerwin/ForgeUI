import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, LayoutTemplate, X } from "lucide-react";
import type { TemplateRecord } from "../../types/domain";
import { useLanguage } from "../../i18n/LanguageProvider";

type Props = { templates: TemplateRecord[]; selectedId: string; onSelect: (id: string) => void; onClear: () => void };

export function TemplatePicker({ templates, selectedId, onSelect, onClear }: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);
  if (!templates.length) return <div className="template-context empty"><LayoutTemplate size={14} />{zh ? "保存页面后，可以在未来的对话中复用它的结构。" : "Save a page to reuse its structure in a future prompt."}</div>;
  const selected = templates.find((template) => template.id === selectedId);
  const choose = (id: string) => { onSelect(id); setOpen(false); };
  return <div className="template-context" ref={rootRef}><LayoutTemplate size={14} /><span>{zh ? "从模板开始" : "Start from"}</span><div className="template-select"><button type="button" className="template-select-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}><span>{selected?.name || (zh ? "不使用模板" : "No saved template")}</span><ChevronDown size={14} /></button>{open && <div className="template-select-menu" role="listbox"><button type="button" role="option" aria-selected={!selectedId} className={!selectedId ? "selected" : ""} onClick={() => choose("")}><span>{zh ? "不使用模板" : "No saved template"}</span>{!selectedId && <Check size={13} />}</button>{templates.map((template) => <button type="button" role="option" aria-selected={template.id === selectedId} className={template.id === selectedId ? "selected" : ""} key={template.id} onClick={() => choose(template.id)}><span>{template.name}</span>{template.id === selectedId && <Check size={13} />}</button>)}</div>}</div>{selected && <button type="button" className="clear-template" aria-label={zh ? "清除模板" : "Clear saved template"} onClick={onClear}><X size={13} /></button>}</div>;
}
