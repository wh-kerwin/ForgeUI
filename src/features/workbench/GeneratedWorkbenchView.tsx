import type { FieldSchema, PageSpec, GenerationSession, TemplateRecord, TemplateVersion } from "../../types/domain";
import { GeneratedPage } from "../pages/GeneratedPage";
import { GenerationHistory } from "../sessions/GenerationHistory";

type Props = {
  page: PageSpec | null;
  isStreaming: boolean;
  fieldSchemas?: Record<string, FieldSchema[]>;
  grantedRoles?: string[];
  modelId?: string;
  templateId?: string;
  templateName?: string;
  operations: string[];
  detail: Record<string, unknown> | null;
  onDetail: (path: string, id: string, operationKey: string) => void;
  onSaved: () => void;
  onQuery: (filters: Record<string, string>, operationKey?: string) => void;
  onMutation: (method: string, path: string, body: string, operationKey: string) => void;
  onDelete: (path: string, id: string, operationKey: string, confirmed?: boolean) => void;
  querying: boolean;
  onRefine: (instruction: string) => Promise<void>;
  refining: boolean;
  sessions: GenerationSession[];
  templates: TemplateRecord[];
  versions: TemplateVersion[];
  selectedTemplateId: string;
  onOpenSession: (page: PageSpec) => void;
  onDeleteSession: (id: string) => void;
  onUseTemplate: (template: TemplateRecord) => void;
  onShowVersions: (id: string) => void;
  onRestore: (version: number) => void;
  onInvalid: (message: string) => void;
  onExport: (id: string, name: string) => void;
  onImport: (file: File) => void;
  onDeleteTemplate: (id: string, name: string) => void;
  onRenameTemplate: (id: string, name: string) => void;
};

export function GeneratedWorkbenchView({ page, isStreaming, fieldSchemas, grantedRoles, modelId, templateId, templateName, operations, detail, onDetail, onSaved, onQuery, onMutation, onDelete, querying, onRefine, refining, sessions, templates, versions, selectedTemplateId, onOpenSession, onDeleteSession, onUseTemplate, onShowVersions, onRestore, onInvalid, onExport, onImport, onDeleteTemplate, onRenameTemplate }: Props) {
  return <>{page && <GeneratedPage page={page} isStreaming={isStreaming} fieldSchemas={fieldSchemas} grantedRoles={grantedRoles} modelId={modelId} templateId={templateId} templateName={templateName} operations={operations} detail={detail} onDetail={onDetail} onSaved={onSaved} onQuery={onQuery} onMutation={onMutation} onDelete={onDelete} querying={querying} onRefine={onRefine} refining={refining} />}<GenerationHistory sessions={sessions} onOpen={onOpenSession} onDelete={onDeleteSession} onInvalid={() => onInvalid("Generation history is invalid")} /></>;
}
