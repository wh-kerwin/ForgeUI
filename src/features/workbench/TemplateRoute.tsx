import type { PageSpec, TemplateRecord, TemplateVersion } from "../../types/domain";
import { TemplateLibrary } from "../templates/TemplateLibrary";

type Props = { templates: TemplateRecord[]; versions: TemplateVersion[]; selectedTemplateId: string; onOpen: (page: PageSpec) => void; onUse: (template: TemplateRecord) => void; onShowVersions: (id: string) => void; onRestore: (version: number) => void; onInvalid: () => void; onExport: (id: string, name: string) => void; onImport: (file: File) => void; onDelete: (id: string, name: string) => void; onRename: (id: string, name: string) => void };

export function TemplateRoute({ templates, versions, selectedTemplateId, onOpen, onUse, onShowVersions, onRestore, onInvalid, onExport, onImport, onDelete, onRename }: Props) {
  return <main className="route-main"><div className="page-header"><span className="eyebrow">LIBRARY</span><h1>Templates</h1><p>Save validated pages and continue from the structures you already like.</p></div><div className="page-content"><TemplateLibrary templates={templates} versions={versions} selectedTemplateId={selectedTemplateId} onOpen={onOpen} onUse={onUse} onShowVersions={onShowVersions} onRestore={onRestore} onInvalidTemplate={onInvalid} onExport={onExport} onImport={onImport} onDelete={onDelete} onRename={onRename} /></div></main>;
}
