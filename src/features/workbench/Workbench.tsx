import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { X } from "lucide-react";
import "../../styles.css";
import "../../generated.css";
import type { ModelConfig, PageSpec, PromptTemplate, TemplateRecord } from "../../types/domain";
import { useProjectWorkspace } from "../projects/useProjectWorkspace";
import { useModelConfigurations } from "../models/useModelConfigurations";
import { useGeneratedPageActions } from "../pages/useGeneratedPageActions";
import { PromptGenerator } from "./PromptGenerator";
import { WorkbenchSidebar } from "./WorkbenchSidebar";
import { GeneratedWorkbenchView } from "./GeneratedWorkbenchView";
import { TemplateRoute } from "./TemplateRoute";
import { parsePageSpecJson } from "../pages/parsePageSpec";
import { toModelSafePageSpec } from "../pages/modelSafePageSpec";
import { useWorkbenchPersistence } from "./useWorkbenchPersistence";
import { buildModelRequest } from "./modelRequest";
import "../../route.css";
import "../../wide-layout.css";
import { useAppRouter } from "../../app/useAppRouter";
import { OpenApiPage } from "../openapi/OpenApiPage";
import { BusinessPage } from "../business/BusinessPage";
import { ModelsPage } from "../models/ModelsPage";
import { OverviewPage } from "../overview/OverviewPage";
import { useWorkbenchModelActions } from "./useWorkbenchModelActions";
import { isModelConfigured } from "../models/modelReadiness";
import { previewPageSpec, StreamingPageParser } from "../pages/streamingPageParser";
import type { AppRoute } from "../../app/routes";
import {
  BUILT_IN_PROMPT_TEMPLATES,
  loadPromptTemplates,
  savePromptTemplates,
} from "./promptTemplates";
import { useWorkbenchStore } from "../../store/workbenchStore";
import {
  alignListOperationWithPrompt,
  documentsForPrompt,
  operationForRole,
  pageApiDocumentIds,
  runtimeOperations,
} from "../pages/pageOperations";
import { createApiFallbackPage, isPageSpecGenerationError } from "./apiFallbackPage";
import { toUserMessage } from "../../lib/errors";

export function Workbench() {
  const [notice, setNotice] = useState("");
  const [prompt, setPrompt] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [editorModel, setEditorModel] = useState<ModelConfig | undefined>();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see TODO(refine)
  const [refining, setRefining] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [streamingPage, setStreamingPage] = useState<PageSpec | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedPromptTemplateId, setSelectedPromptTemplateId] = useState("dashboard");
  const [activePageDocumentIds, setActivePageDocumentIds] = useState<string[]>([]);
  const [customPromptTemplates, setCustomPromptTemplates] =
    useState<PromptTemplate[]>(loadPromptTemplates);
  const setLoadingState = useWorkbenchStore((state) => state.setLoadingState);
  const activeRequestId = useRef<string | null>(null);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const preventNativeContextMenu = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", preventNativeContextMenu);
    return () => document.removeEventListener("contextmenu", preventNativeContextMenu);
  }, []);
  const { route, navigate } = useAppRouter();
  const workspace = useProjectWorkspace(setNotice);
  const modelConfigs = useModelConfigurations();
  const generated = useGeneratedPageActions({
    projectId: workspace.activeProjectId,
    apiDocuments: workspace.documents,
    onNotice: setNotice,
  });
  const persistence = useWorkbenchPersistence({
    projectId: workspace.activeProjectId,
    onNotice: setNotice,
  });
  const active = modelConfigs.activeModel;
  const selectedTemplate = persistence.templates.find(
    (template) => template.id === selectedTemplateId,
  );
  const promptTemplates = [...BUILT_IN_PROMPT_TEMPLATES, ...customPromptTemplates];
  const selectedPromptTemplate =
    promptTemplates.find((template) => template.id === selectedPromptTemplateId) ??
    BUILT_IN_PROMPT_TEMPLATES[0];
  const runtimeDocumentIds = new Set(
    activePageDocumentIds.length ? activePageDocumentIds : workspace.selectedDocumentIds,
  );
  const runtimeDocuments = workspace.documents.filter(
    (document) => document.enabled && runtimeDocumentIds.has(document.id),
  );
  const availableOperations = runtimeDocuments.flatMap((document) =>
    runtimeOperations(
      document.auth.authorizedOperations ?? [],
      document.id,
      document.spec.queryParameters,
    ),
  );
  const fieldSchemas = Object.assign(
    {},
    ...runtimeDocuments.map((document) => document.spec.fieldSchemas ?? {}),
  );
  const modelActions = useWorkbenchModelActions({
    active,
    saveModel: modelConfigs.saveModel,
    makeDefault: modelConfigs.makeDefault,
    removeModel: modelConfigs.removeModel,
    onSaved: () => {
      setShowEditor(false);
      setEditorModel(undefined);
    },
    onNotice: setNotice,
  });

  useEffect(() => {
    setSelectedPromptTemplateId(
      active?.promptTemplateId &&
        promptTemplates.some((template) => template.id === active.promptTemplateId)
        ? active.promptTemplateId
        : "dashboard",
    );
  }, [active?.id, active?.promptTemplateId, customPromptTemplates]);

  useEffect(() => {
    generated.setPage(null);
    setSelectedTemplateId("");
    setActivePageDocumentIds([]);
  }, [workspace.activeProjectId]);

  function updatePromptTemplates(templates: PromptTemplate[]) {
    setCustomPromptTemplates(templates);
    savePromptTemplates(templates);
    if (
      !BUILT_IN_PROMPT_TEMPLATES.some((template) => template.id === selectedPromptTemplateId) &&
      !templates.some((template) => template.id === selectedPromptTemplateId)
    )
      setSelectedPromptTemplateId("dashboard");
  }

  function parseTemplate(template?: TemplateRecord) {
    if (!template) return undefined;
    const page = parsePageSpecJson(template.payload);
    if (!page) setNotice("Template content is invalid");
    return page || undefined;
  }

  function useTemplate(template: TemplateRecord) {
    const page = parseTemplate(template);
    if (!page) return;
    generated.setPage(page);
    setActivePageDocumentIds(pageApiDocumentIds(page, template.apiDocumentIds));
    setSelectedTemplateId(template.id);
    navigate("generate");
  }

  async function requestPage(request: ReturnType<typeof buildModelRequest>): Promise<PageSpec> {
    if (!request.streaming) return invoke<PageSpec>("generate_page", { input: request });
    if (activeRequestId.current) throw new Error("已有页面正在生成，请稍候");
    const requestId = crypto.randomUUID();
    activeRequestId.current = requestId;
    setIsStreaming(true);
    setStreamingPage(previewPageSpec({}));
    let latestPartial: Partial<PageSpec> = {};
    const parser = new StreamingPageParser({
      onDelta: (partial) => {
        latestPartial = { ...latestPartial, ...partial };
        if (activeRequestId.current === requestId) setStreamingPage(previewPageSpec(latestPartial));
      },
      onComplete: (complete) => {
        if (activeRequestId.current === requestId) setStreamingPage(complete);
      },
    });
    let unlisten: UnlistenFn | undefined;
    try {
      unlisten = await listen<{ requestId: string; delta: string }>(
        "page-generation-delta",
        ({ payload }) => {
          if (payload.requestId === requestId && activeRequestId.current === requestId)
            parser.push(payload.delta);
        },
      );
      const page = await invoke<PageSpec>("generate_page_stream", { input: request, requestId });
      try {
        parser.finish();
      } catch {
        /* Rust's normalized and validated result is authoritative. */
      }
      return page;
    } finally {
      unlisten?.();
      if (activeRequestId.current === requestId) {
        activeRequestId.current = null;
        setIsStreaming(false);
        setStreamingPage(null);
      }
    }
  }

  async function generate() {
    if (generating) return;
    if (!prompt.trim()) return setNotice("请先描述你想生成的业务页面");
    if (!active) return setNotice("请先配置模型服务");
    const documentSelection = documentsForPrompt(
      prompt,
      workspace.selectedDocuments.filter((document) => document.enabled),
    );
    if (!documentSelection.documents.length)
      return setNotice(documentSelection.error ?? "请至少选择一个启用的 API 文档");
    const generationDocuments = documentSelection.documents;
    const generationOperations = generationDocuments.flatMap((document) =>
      runtimeOperations(
        document.auth.authorizedOperations ?? [],
        document.id,
        document.spec.queryParameters,
      ),
    );
    setGenerating(true);
    setLoadingState("generating");
    setNotice("模型正在生成受控 UI DSL…");
    try {
      let page: PageSpec;
      let usedOpenApiFallback = false;
      try {
        page = await requestPage(
          buildModelRequest(
            active,
            prompt,
            generationDocuments,
            parseTemplate(selectedTemplate),
            selectedPromptTemplate,
          ),
        );
      } catch (error) {
        if (!workspace.selectedDocuments.length || !isPageSpecGenerationError(error)) throw error;
        try {
          // Retry once without streaming so OpenAI-compatible providers can
          // enforce response_format=json_schema instead of relying on prompts.
          page = await requestPage(
            buildModelRequest(
              { ...active, streaming: false, structuredOutput: "jsonSchema" },
              prompt,
              generationDocuments,
              parseTemplate(selectedTemplate),
              selectedPromptTemplate,
            ),
          );
        } catch {
          page = createApiFallbackPage(prompt, generationDocuments);
          usedOpenApiFallback = true;
        }
      }
      page = alignListOperationWithPrompt(page, prompt, generationOperations);
      const apiDocumentIds = pageApiDocumentIds(
        page,
        generationDocuments.map((document) => document.id),
      );
      generated.setPage(page);
      setActivePageDocumentIds(apiDocumentIds);
      await persistence.saveSession(active.id, prompt, page, apiDocumentIds);
      const selectedRuntimeOperations = generationOperations.filter((operation) =>
        apiDocumentIds.includes(operation.apiDocumentId ?? ""),
      );
      const listOperation = page.operations?.some(
        (operation) => operation.role === "list" && operation.method === "GET",
      )
        ? operationForRole(page, selectedRuntimeOperations, "list", "GET")
        : undefined;
      setNotice(
        usedOpenApiFallback
          ? "模型输出无法解析，已根据所选 OpenAPI 生成基础页面"
          : "已生成真实模型 PageSpec 页面",
      );
      if (listOperation) await generated.query({}, listOperation);
    } catch (error) {
      setNotice(toUserMessage(error));
    } finally {
      setGenerating(false);
      setLoadingState("idle");
    }
  }
  // TODO(refine): fully implemented but currently unreachable — PageRefineBox
  // (src/features/pages/PageRefineBox.tsx) is the intended trigger UI and is
  // not yet rendered anywhere. Either wire it into GeneratedPage or drop this.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function refinePage(instruction: string) {
    const current = generated.page;
    if (!active || !current) return;
    setRefining(true);
    setLoadingState("generating");
    try {
      const refinementPrompt = `Modify the existing PageSpec according to this instruction: ${instruction}\nExisting PageSpec structure (loaded rows and metrics intentionally excluded): ${JSON.stringify(toModelSafePageSpec(current))}`;
      const refinementIds = new Set([...workspace.selectedDocumentIds, ...activePageDocumentIds]);
      const refinedPage = await requestPage(
        buildModelRequest(
          active,
          refinementPrompt,
          workspace.documents.filter((document) => refinementIds.has(document.id)),
          current,
          selectedPromptTemplate,
        ),
      );
      const refinementOperations = workspace.documents
        .filter((document) => refinementIds.has(document.id) && document.enabled)
        .flatMap((document) =>
          runtimeOperations(
            document.auth.authorizedOperations ?? [],
            document.id,
            document.spec.queryParameters,
          ),
        );
      const page = alignListOperationWithPrompt(
        refinedPage,
        `${current.title} ${instruction}`,
        refinementOperations,
      );
      const apiDocumentIds = pageApiDocumentIds(page, activePageDocumentIds);
      generated.setPage(page);
      setActivePageDocumentIds(apiDocumentIds);
      await persistence.saveSession(active.id, instruction, page, apiDocumentIds);
      setNotice("页面已按对话要求更新");
    } catch (error) {
      setNotice(toUserMessage(error));
    } finally {
      setRefining(false);
      setLoadingState("idle");
    }
  }
  const openSession = (page: PageSpec, session: (typeof persistence.sessions)[number]) => {
    generated.setPage(page);
    setSelectedTemplateId("");
    setActivePageDocumentIds(pageApiDocumentIds(page, session.apiDocumentIds));
  };
  const generatePage = (
    <main className="route-main">
      <PromptGenerator
        prompt={prompt}
        onPromptChange={setPrompt}
        onGenerate={generate}
        generating={generating}
        onOpenSettings={() => navigate("models")}
        templates={persistence.templates}
        selectedTemplateId={selectedTemplateId}
        onTemplateSelect={setSelectedTemplateId}
        onTemplateClear={() => setSelectedTemplateId("")}
        promptTemplates={promptTemplates}
        selectedPromptTemplateId={selectedPromptTemplateId}
        onPromptTemplateSelect={setSelectedPromptTemplateId}
        onManagePromptTemplates={() => navigate("models")}
        apiDocuments={workspace.documents}
        selectedApiDocumentIds={workspace.selectedDocumentIds}
        onApiDocumentSelectionChange={workspace.setSelectedDocumentIds}
      />
      <GeneratedWorkbenchView
        page={streamingPage ?? generated.page}
        projectId={workspace.activeProjectId}
        apiDocumentIds={activePageDocumentIds}
        isStreaming={isStreaming}
        fieldSchemas={fieldSchemas}
        grantedRoles={workspace.grantedRoles}
        modelId={active?.id}
        templateId={selectedTemplateId || undefined}
        templateName={selectedTemplate?.name}
        operations={availableOperations}
        detail={generated.detail}
        onDetail={generated.loadDetail}
        onSaved={persistence.refreshTemplates}
        onQuery={generated.query}
        onMutation={generated.mutate}
        onDelete={generated.deleteRecord}
        querying={generated.querying}
        queryMeta={generated.queryMeta}
        sessions={persistence.sessions}
        onOpenSession={openSession}
        onDeleteSession={persistence.removeSession}
        onInvalid={setNotice}
      />
    </main>
  );
  const routeViews: Record<AppRoute, ReactNode> = {
    overview: (
      <OverviewPage
        templates={persistence.templates}
        sessions={persistence.sessions}
        spec={workspace.activeDocument?.spec}
        modelReady={isModelConfigured(active)}
        onNavigate={navigate}
        onStartGenerate={(nextPrompt = "") => {
          setPrompt(nextPrompt);
          setSelectedTemplateId("");
          navigate("generate");
        }}
      />
    ),
    generate: generatePage,
    templates: (
      <TemplateRoute
        templates={persistence.templates}
        versions={persistence.versions}
        selectedTemplateId={persistence.versionTemplateId}
        onOpen={generated.setPage}
        onUse={useTemplate}
        onShowVersions={persistence.showVersions}
        onRestore={persistence.restoreVersion}
        onInvalid={() => setNotice("Template content is invalid")}
        onExport={persistence.exportTemplate}
        onImport={persistence.importTemplate}
        onDelete={persistence.removeTemplate}
        onRename={persistence.renameSavedTemplate}
      />
    ),
    business: (
      <BusinessPage
        documents={workspace.documents}
        activeDocument={workspace.activeDocument}
        auth={workspace.activeDocument?.auth ?? null}
        secret={workspace.secret}
        onDocumentSelect={workspace.setActiveDocumentId}
        onAuthChange={workspace.setAuth}
        onSecretChange={workspace.setSecret}
        onSave={workspace.saveAuth}
      />
    ),
    openapi: (
      <OpenApiPage
        documents={workspace.documents}
        activeDocumentId={workspace.activeDocumentId}
        auth={workspace.activeDocument?.auth ?? null}
        onSelect={workspace.setActiveDocumentId}
        onImport={workspace.importSwaggerUrl}
        onImportFile={workspace.importOpenApiFile}
        onAuthChange={workspace.setAuth}
        onSave={workspace.saveAuth}
        onRename={workspace.renameDocument}
        onToggle={workspace.toggleDocument}
        onDelete={workspace.deleteDocument}
      />
    ),
    models: (
      <ModelsPage
        models={modelConfigs.models}
        active={active}
        selectedId={modelConfigs.selectedId}
        onSelect={modelConfigs.setSelectedId}
        onEdit={() => {
          setEditorModel(active);
          setShowEditor(true);
        }}
        onAdd={() => {
          setEditorModel(undefined);
          setShowEditor(true);
        }}
        onDuplicate={modelActions.duplicate}
        onMakeDefault={modelActions.setDefault}
        onDelete={modelActions.remove}
        editor={showEditor}
        editorModel={editorModel}
        onClose={() => {
          setShowEditor(false);
          setEditorModel(undefined);
        }}
        onSave={modelActions.save}
        onTest={modelActions.test}
        testing={modelActions.testing}
        builtInPromptTemplates={BUILT_IN_PROMPT_TEMPLATES}
        customPromptTemplates={customPromptTemplates}
        onPromptTemplatesChange={updatePromptTemplates}
      />
    ),
  };
  const page = routeViews[route];
  return (
    <div className="app">
      <WorkbenchSidebar
        route={route}
        onNavigate={navigate}
        onNotice={setNotice}
        projects={workspace.projects}
        activeProjectId={workspace.activeProjectId}
        onProjectSelect={workspace.selectProject}
        onProjectCreate={workspace.createProject}
        onProjectRename={workspace.renameProject}
        onProjectDelete={workspace.deleteProject}
      />
      {page}
      {notice && (
        <div className="toast">
          {notice}
          <button onClick={() => setNotice("")}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
