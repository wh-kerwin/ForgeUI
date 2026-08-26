import type { FieldSchema, PageSpec, GenerationSession, TemplateRecord, TemplateVersion } from "../../types/domain";
import { GeneratedPage } from "../pages/GeneratedPage";
import { GenerationHistory } from "../sessions/GenerationHistory";
import type { RuntimeOperation } from "../pages/pageOperations";
import type { QueryMeta } from "../../store/workbenchStore";

type Props = {
  page: PageSpec | null;
  projectId: string;
  apiDocumentIds: string[];
  isStreaming: boolean;
  fieldSchemas?: Record<string, FieldSchema[]>;
  grantedRoles?: string[];
  modelId?: string;
  templateId?: string;
  templateName?: string;
  operations: RuntimeOperation[];
  detail: Record<string, unknown> | null;
  onDetail: (operation: RuntimeOperation, id: string) => void;
  onSaved: () => void;
  onQuery: (filters: Record<string, string>, operation?: RuntimeOperation) => void;
  onMutation: (operation: RuntimeOperation, body: string) => void;
  onDelete: (operation: RuntimeOperation, id: string, confirmed?: boolean) => void;
  querying: boolean;
  queryMeta: QueryMeta;
  onRefine: (instruction: string) => Promise<void>;
  refining: boolean;
  sessions: GenerationSession[];
  templates: TemplateRecord[];
  versions: TemplateVersion[];
  selectedTemplateId: string;
  onOpenSession: (page: PageSpec, session: GenerationSession) => void;
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

export function GeneratedWorkbenchView({ page, projectId, apiDocumentIds, isStreaming, fieldSchemas, grantedRoles, modelId, templateId, templateName, operations, detail, onDetail, onSaved, onQuery, onMutation, onDelete, querying, queryMeta, onRefine, refining, sessions, templates, versions, selectedTemplateId, onOpenSession, onDeleteSession, onUseTemplate, onShowVersions, onRestore, onInvalid, onExport, onImport, onDeleteTemplate, onRenameTemplate }: Props) {
  return <>{page && <GeneratedPage page={page} projectId={projectId} apiDocumentIds={apiDocumentIds} isStreaming={isStreaming} fieldSchemas={fieldSchemas} grantedRoles={grantedRoles} modelId={modelId} templateId={templateId} templateName={templateName} operations={operations} detail={detail} onDetail={onDetail} onSaved={onSaved} onQuery={onQuery} onMutation={onMutation} onDelete={onDelete} querying={querying} queryMeta={queryMeta} onRefine={onRefine} refining={refining} />}<GenerationHistory sessions={sessions} onOpen={onOpenSession} onDelete={onDeleteSession} onInvalid={() => onInvalid("Generation history is invalid")} /></>;
}
