import type { FieldSchema, PageSpec, GenerationSession } from "../../types/domain";
import { GeneratedPage } from "../pages/GeneratedPage";
import { GenerationHistory } from "../sessions/GenerationHistory";
import type { RuntimeOperation } from "../pages/pageOperations";
import type { PageRuntimeState, RuntimeControls } from "../pages/runtime/pageRuntimeState";
import type { QueryMeta } from "../../store/workbenchStore";
import type { MutationOutcome } from "../pages/mutationOutcome";
import type { PageDefinitionDiff as PageDiff, RefineStatus } from "../pages/pageRefinement";
import { PageRefineBox } from "../pages/PageRefineBox";
import { PageDefinitionDiff as DiffReview } from "../pages/PageDefinitionDiff";
import { useLanguage } from "../../i18n/LanguageProvider";

export type RefineViewState = {
  status: RefineStatus;
  diff: PageDiff | null;
  issues: { code: string; message: string }[];
  canUndo: boolean;
  onRefine: (instruction: string) => Promise<boolean>;
  onApply: () => void;
  onDiscard: () => void;
  onUndo: () => void;
};

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
  onMutation: (operation: RuntimeOperation, body: string) => Promise<MutationOutcome> | void;
  onDelete: (
    operation: RuntimeOperation,
    id: string,
    confirmed?: boolean,
  ) => Promise<MutationOutcome> | void;
  querying: boolean;
  queryMeta: QueryMeta;
  mutationStatus?: "idle" | "submitting" | "success" | "error" | "unknown";
  mutationFieldErrors?: Record<string, string>;
  runtime: PageRuntimeState;
  onSelectionKeysChange: (keys: string[]) => void;
  onRuntimeControls: (controls: RuntimeControls) => void;
  sessions: GenerationSession[];
  onOpenSession: (page: PageSpec, session: GenerationSession) => void;
  onDeleteSession: (id: string) => void;
  onInvalid: (message: string) => void;
  refine: RefineViewState;
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
  mutationStatus,
  mutationFieldErrors,
  runtime,
  onSelectionKeysChange,
  onRuntimeControls,
  sessions,
  onOpenSession,
  onDeleteSession,
  onInvalid,
  refine,
}: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
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
          mutationStatus={mutationStatus}
          mutationFieldErrors={mutationFieldErrors}
          runtime={runtime}
          onSelectionKeysChange={onSelectionKeysChange}
          onRuntimeControls={onRuntimeControls}
        />
      )}
      {page && !isStreaming && (
        <>
          <PageRefineBox
            onRefine={refine.onRefine}
            status={refine.status}
            issues={refine.issues}
            canUndo={refine.canUndo}
            onUndo={refine.onUndo}
          />
          {(refine.status === "previewDiff" || refine.status === "applying") && refine.diff && (
            <DiffReview
              diff={refine.diff}
              zh={zh}
              applying={refine.status === "applying"}
              onApply={refine.onApply}
              onDiscard={refine.onDiscard}
            />
          )}
        </>
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
