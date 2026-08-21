import { ChangeEvent, useRef } from "react";
import { Download, Trash2, Upload } from "lucide-react";
import type {
  PageSpec,
  TemplateRecord,
  TemplateVersion,
} from "../../types/domain";

type Props = {
  templates: TemplateRecord[];
  versions: TemplateVersion[];
  selectedTemplateId: string;
  onOpen: (page: PageSpec) => void;
  onShowVersions: (id: string) => void;
  onRestore: (version: number) => void;
  onInvalidTemplate: () => void;
  onExport: (id: string, name: string) => void;
  onImport: (file: File) => void;
  onDelete: (id: string, name: string) => void;
};

export function TemplateLibrary({
  templates,
  versions,
  selectedTemplateId,
  onOpen,
  onShowVersions,
  onRestore,
  onInvalidTemplate,
  onExport,
  onImport,
  onDelete,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onImport(file);
    event.target.value = "";
  };
  return (
    <section className="template-strip">
      <div>
        <span className="eyebrow">SAVED TEMPLATES</span>
        <h3>可复用页面</h3>
      </div>
      <div className="template-list">
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={handleImport} />
        <button className="version-btn" onClick={() => fileInput.current?.click()}><Upload size={14} /> 导入模板</button>
        {templates.length === 0 && <span className="muted">还没有本地模板</span>}
        {templates.map((template) => (
          <div key={template.id} className="template-entry">
            <button
              className="template-chip"
              onClick={() => {
                try {
                  onOpen(JSON.parse(template.payload) as PageSpec);
                } catch {
                  onInvalidTemplate();
                }
              }}
            >
              <strong>{template.name}</strong>
              <span>v{template.version}</span>
            </button>
            <button
              className="version-btn"
              onClick={() => onShowVersions(template.id)}
            >
              历史
            </button>
            <button className="version-btn" onClick={() => onExport(template.id, template.name)}><Download size={14} /> 导出</button>
            <button className="danger" onClick={() => onDelete(template.id, template.name)}><Trash2 size={14} /> 删除</button>
          </div>
        ))}
      </div>
      {selectedTemplateId && (
        <div className="version-list">
          {versions.map((version) => (
            <button
              key={version.version}
              onClick={() => onRestore(version.version)}
            >
              恢复 v{version.version}
              <span>{version.createdAt}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
