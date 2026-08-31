import { ChangeEvent, useMemo, useRef, useState } from "react";
import { Download, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import type { PageSpec, TemplateRecord, TemplateVersion } from "../../types/domain";
import { TemplateLibraryToolbar } from "./TemplateLibraryToolbar";
import { usePinnedTemplates } from "./usePinnedTemplates";
import { parsePageSpecJson } from "../pages/parsePageSpec";
import { useLanguage } from "../../i18n/LanguageProvider";

type Props = {
  templates: TemplateRecord[];
  versions: TemplateVersion[];
  selectedTemplateId: string;
  onOpen: (page: PageSpec) => void;
  onUse: (template: TemplateRecord) => void;
  onShowVersions: (id: string) => void;
  onRestore: (version: number) => void;
  onInvalidTemplate: () => void;
  onExport: (id: string, name: string) => void;
  onImport: (file: File) => void;
  onDelete: (id: string, name: string) => void;
  onRename: (id: string, name: string) => void;
};

export function TemplateLibrary({
  templates,
  versions,
  selectedTemplateId,
  onOpen,
  onUse,
  onShowVersions,
  onRestore,
  onInvalidTemplate,
  onExport,
  onImport,
  onDelete,
  onRename,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const { language } = useLanguage();
  const zh = language === "zh";
  const { pinned, togglePinned } = usePinnedTemplates();
  const visibleTemplates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...templates]
      .filter((template) => !normalized || template.name.toLowerCase().includes(normalized))
      .sort((left, right) => Number(pinned.includes(right.id)) - Number(pinned.includes(left.id)));
  }, [pinned, query, templates]);
  const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onImport(file);
    event.target.value = "";
  };
  return (
    <section className="template-strip">
      <div>
        <span className="eyebrow">{zh ? "已保存模板" : "SAVED TEMPLATES"}</span>
        <h3>{zh ? "可复用页面" : "Reusable pages"}</h3>
      </div>
      <div className="template-list">
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={handleImport}
        />
        <TemplateLibraryToolbar
          query={query}
          count={visibleTemplates.length}
          total={templates.length}
          onQueryChange={setQuery}
          onImport={() => fileInput.current?.click()}
        />
        {templates.length === 0 && (
          <span className="muted">{zh ? "还没有本地模板" : "No saved templates yet"}</span>
        )}
        {templates.length > 0 && visibleTemplates.length === 0 && (
          <span className="muted">{zh ? "没有匹配的页面模板" : "No matching templates"}</span>
        )}
        {visibleTemplates.map((template) => (
          <div key={template.id} className="template-entry">
            <button
              className="template-chip"
              onClick={() => {
                const page = parsePageSpecJson(template.payload);
                if (page) {
                  onOpen(page);
                  onUse(template);
                } else {
                  onInvalidTemplate();
                }
              }}
            >
              <strong>{template.name}</strong>
              <span>v{template.version}</span>
            </button>
            <button
              className="version-btn pin-button"
              aria-label={
                pinned.includes(template.id)
                  ? zh
                    ? "取消固定模板"
                    : "Unpin template"
                  : zh
                    ? "固定模板"
                    : "Pin template"
              }
              onClick={() => togglePinned(template.id)}
            >
              {pinned.includes(template.id) ? <Pin size={14} /> : <PinOff size={14} />}
            </button>
            <button
              className="version-btn pin-button"
              aria-label={zh ? "重命名模板" : "Rename template"}
              onClick={() => onRename(template.id, template.name)}
            >
              <Pencil size={14} />
            </button>
            <button className="version-btn" onClick={() => onShowVersions(template.id)}>
              {zh ? "历史" : "History"}
            </button>
            <button className="version-btn" onClick={() => onExport(template.id, template.name)}>
              <Download size={14} /> {zh ? "导出" : "Export"}
            </button>
            <button className="danger" onClick={() => onDelete(template.id, template.name)}>
              <Trash2 size={14} /> {zh ? "删除" : "Delete"}
            </button>
          </div>
        ))}
      </div>
      {selectedTemplateId && (
        <div className="version-list">
          {versions.map((version) => (
            <button key={version.version} onClick={() => onRestore(version.version)}>
              {zh ? "恢复" : "Restore"} v{version.version}
              <span>{version.createdAt}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
