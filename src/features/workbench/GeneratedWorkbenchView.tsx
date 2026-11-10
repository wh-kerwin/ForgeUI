import type { FieldSchema, PageSpec, GenerationSession } from "../../types/domain";
import { GeneratedPage } from "../pages/GeneratedPage";
import { GenerationHistory } from "../sessions/GenerationHistory";
import type { RuntimeOperation } from "../pages/pageOperations";
import type { PageRuntimeState, RuntimeControls } from "../pages/runtime/pageRuntimeState";
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
  runtime: PageRuntimeState;
  onSelectionKeysChange: (keys: string[]) => void;
  onRuntimeControls: (controls: RuntimeControls) => void;
  sessions: GenerationSession[];
  onOpenSession: (page: PageSpec, session: GenerationSession) => void;
  onDeleteSession: (id: string) => void;
  onInvalid: (message: string) => void;
};

export function GeneratedWorkbenchView({
  page,
  projectId,
  apiDocumentIds,
  isStreaming,
  fieldSchemas,
  grantedRoles,
  modelId,
  templateId,
  templateName,
  operations,
  detail,
  onDetail,
  onSaved,
  onQuery,
  onMutation,
  onDelete,
  querying,
  queryMeta,
  runtime,
  onSelectionKeysChange,
  onRuntimeControls,
  sessions,
  onOpenSession,
  onDeleteSession,
  onInvalid,
}: Props) {
  return (
    <>
      {page && (
        <GeneratedPage
          page={page}
          projectId={projectId}
          apiDocumentIds={apiDocumentIds}
          isStreaming={isStreaming}
          fieldSchemas={fieldSchemas}
          grantedRoles={grantedRoles}
          modelId={modelId}
          templateId={templateId}
          templateName={templateName}
          operations={operations}
          detail={detail}
          onDetail={onDetail}
          onSaved={onSaved}
          onQuery={onQuery}
          onMutation={onMutation}
          onDelete={onDelete}
          querying={querying}
          queryMeta={queryMeta}
          runtime={runtime}
          onSelectionKeysChange={onSelectionKeysChange}
          onRuntimeControls={onRuntimeControls}
        />
      )}
      <GenerationHistory
        sessions={sessions}
        onOpen={onOpenSession}
        onDelete={onDeleteSession}
        onInvalid={() => onInvalid("Generation history is invalid")}
      />
    </>
  );
}
