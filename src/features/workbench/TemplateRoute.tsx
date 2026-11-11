import type { ApiDocument, PageSpec, TemplateRecord, TemplateVersion } from "../../types/domain";
import { TemplateLibrary, type TemplateBindingProps } from "../templates/TemplateLibrary";

type Props = {
  templates: TemplateRecord[];
  versions: TemplateVersion[];
  selectedTemplateId: string;
  documents: readonly ApiDocument[];
  projectId: string;
  binding: TemplateBindingProps;
  onUse: (template: TemplateRecord, page: PageSpec) => void;
  onShowVersions: (id: string) => void;
  onRestore: (version: number) => void;
  onInvalid: () => void;
  onExport: (id: string, name: string) => void;
  onImport: (file: File) => void;
  onDelete: (id: string, name: string) => void;
  onRename: (id: string, name: string) => void;
};

export function TemplateRoute({
  templates,
  versions,
  selectedTemplateId,
  documents,
  projectId,
  binding,
  onUse,
  onShowVersions,
  onRestore,
  onInvalid,
  onExport,
  onImport,
  onDelete,
  onRename,
}: Props) {
  return (
    <main className="route-main">
      <div className="page-header">
        <span className="eyebrow">LIBRARY</span>
        <h1>Templates</h1>
        <p>Save validated pages and continue from the structures you already like.</p>
      </div>
      <div className="page-content">
        <TemplateLibrary
          templates={templates}
          versions={versions}
          selectedTemplateId={selectedTemplateId}
          documents={documents}
          projectId={projectId}
          binding={binding}
          onUse={onUse}
          onShowVersions={onShowVersions}
          onRestore={onRestore}
          onInvalidTemplate={onInvalid}
          onExport={onExport}
          onImport={onImport}
          onDelete={onDelete}
          onRename={onRename}
        />
      </div>
    </main>
  );
}
