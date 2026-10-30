import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { RequestContext } from "../pages/requestContext";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { X } from "lucide-react";
import "../../styles.css";
import "../../generated.css";
import type {
  GenerationResult,
  GenerationSource,
  ModelConfig,
  PageSpec,
  PromptTemplate,
  TemplateRecord,
} from "../../types/domain";
import type { PageIssue } from "../pages/pageIssues";
import { useProjectWorkspace } from "../projects/useProjectWorkspace";
import { useModelConfigurations } from "../models/useModelConfigurations";
import { useGeneratedPageActions } from "../pages/useGeneratedPageActions";
import { PromptGenerator } from "./PromptGenerator";
import { WorkbenchSidebar } from "./WorkbenchSidebar";
import { GeneratedWorkbenchView } from "./GeneratedWorkbenchView";
import { TemplateRoute } from "./TemplateRoute";
import { parsePageSpecJson } from "../pages/parsePageSpec";
import { validateGenerationCandidate } from "./generationCandidate";
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
  documentsForPrompt,
  operationForRole,
  pageApiDocumentIds,
  runtimeOperations,
} from "../pages/pageOperations";
import { createApiFallbackPage } from "./apiFallbackPage";

function promptDiagnosticIssues(request: ReturnType<typeof buildModelRequest>): PageIssue[] {
  return request.prompt_diagnostics.flatMap(({ code, message }) => {
    if (!(["prompt_budget", "template_budget", "capability_gap"] as string[]).includes(code))
      return [];
    return [
      {
        code: `prompt.${code}`,
        path: "",
        severity: "warning",
        stage: "permission",
        message: message.slice(0, 300),
      },
    ];
  });
}

function generationFailure(error: unknown): { issues: PageIssue[]; retryable: boolean } {
  if (error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)) {
    const issues = error.issues as PageIssue[];
    return { issues, retryable: "retryable" in error && error.retryable === true };
  }
  return {
    retryable: false,
    issues: [
      {
        code: "generation.request_failed",
        path: "",
        severity: "error",
        stage: "permission",
        message: "模型请求未完成，请检查连接与授权配置后重试",
      },
    ],
  };
}

const sourceLabels: Record<GenerationSource, string> = {
  model: "模型",
  repaired: "安全格式修复",
  retry: "重试",
  apiFallback: "API 基础页面（非模型输出）",
};
const stageLabels: Record<string, string> = {
  syntax: "格式解析",
  schema: "结构校验",
  reference: "字段引用",
  binding: "API 绑定",
  permission: "授权与连接",
};

export function Workbench() {
  const [notice, setNotice] = useState("");
  const [generationStatus, setGenerationStatus] = useState("");
  const [generationSource, setGenerationSource] = useState<GenerationSource | null>(null);
  const [generationIssues, setGenerationIssues] = useState<PageIssue[]>([]);
  const [generationFailed, setGenerationFailed] = useState(false);
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
    requestScope: workspace.requestScope,
  });
  const persistence = useWorkbenchPersistence({
    projectId: workspace.activeProjectId,
    onNotice: setNotice,
    requestScope: workspace.requestScope,
  });
  const generationScope = workspace.requestScope;
  const generationCleanup = useRef<(() => void) | null>(null);
  const generationTicket = useRef<RequestContext | null>(null);
  const [pageRevision, setPageRevision] = useState(0);
  const setExecutionMode = useWorkbenchStore((state) => state.setExecutionMode);
  useLayoutEffect(() => {
    const invalidate = () => {
      generationCleanup.current?.();
      generationCleanup.current = null;
      generationTicket.current = null;
      activeRequestId.current = null;
      setGenerating(false);
      setRefining(false);
      setIsStreaming(false);
      setStreamingPage(null);
      setExecutionMode("live");
      setLoadingState("idle");
      setPageRevision((revision) => revision + 1);
      setNotice("");
      setGenerationStatus("");
      setGenerationSource(null);
      setGenerationIssues([]);
      setGenerationFailed(false);
    };
    const unsubscribe = generationScope.subscribe(invalidate);
    return () => {
      unsubscribe();
      generationCleanup.current?.();
      generationTicket.current = null;
    };
  }, [generationScope, setExecutionMode, setLoadingState]);

  function currentGeneration(context: RequestContext) {
    return generationTicket.current === context && generationScope.isLatest("generation", context);
  }
  function replacePage(page: PageSpec | null) {
    generationScope.update({
      definitionRevision: generationScope.capture().definitionRevision + 1,
    });
    generated.setPage(page);
  }
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
    replacePage(page);
    setActivePageDocumentIds(pageApiDocumentIds(page, template.apiDocumentIds));
    setSelectedTemplateId(template.id);
    navigate("generate");
  }

  async function requestPage(
    request: ReturnType<typeof buildModelRequest>,
    context: RequestContext,
  ): Promise<GenerationResult> {
    if (!currentGeneration(context)) throw new Error("生成上下文已失效");
    if (!request.streaming)
      return invoke<GenerationResult>("generate_page_detailed", { input: request });
    if (activeRequestId.current) throw new Error("已有页面正在生成，请稍候");
    const requestId = crypto.randomUUID();
    activeRequestId.current = requestId;
    setIsStreaming(true);
    setStreamingPage(previewPageSpec({}));
    let latestPartial: Partial<PageSpec> = {};
    // 单 timer 合并草稿；Rust 的最终校验结果才可提交。
    const parser = new StreamingPageParser({
      coalesce: true,
      flushIntervalMs: 100,
      onDelta: (partial) => {
        latestPartial = { ...latestPartial, ...partial };
        if (currentGeneration(context) && activeRequestId.current === requestId)
          setStreamingPage(previewPageSpec(latestPartial));
      },
      onComplete: () => undefined,
    });
    let unlisten: UnlistenFn | undefined;
    const cleanup = () => {
      parser.destroy();
      unlisten?.();
      unlisten = undefined;
    };
    generationCleanup.current = cleanup;
    try {
      unlisten = await listen<{ requestId: string; delta: string }>(
        "page-generation-delta",
        ({ payload }) => {
          if (
            currentGeneration(context) &&
            payload.requestId === requestId &&
            activeRequestId.current === requestId
          )
            parser.push(payload.delta);
        },
      );
      if (!currentGeneration(context)) throw new Error("生成上下文已失效");
      const page = await invoke<GenerationResult>("generate_page_stream_detailed", {
        input: request,
        requestId,
      });
      try {
        parser.finish();
      } catch {
        /* Rust's normalized and validated result is authoritative. */
      }
      return page;
    } finally {
      cleanup();
      if (generationCleanup.current === cleanup) generationCleanup.current = null;
      if (currentGeneration(context) && activeRequestId.current === requestId) {
        activeRequestId.current = null;
        setIsStreaming(false);
        setStreamingPage(null);
      }
      parser.destroy();
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
    const context = generationScope.begin("generation");
    generationTicket.current = context;
    setExecutionMode("preview");
    setGenerating(true);
    setIsStreaming(true);
    setStreamingPage(previewPageSpec({}));
    setLoadingState("generating");
    setNotice("");
    setGenerationStatus("模型生成中");
    setGenerationSource(null);
    setGenerationIssues([]);
    setGenerationFailed(false);
    try {
      let result: GenerationResult;
      let attemptIssues: PageIssue[] = [];
      try {
        const request = buildModelRequest(
          active,
          prompt,
          generationDocuments,
          parseTemplate(selectedTemplate),
          selectedPromptTemplate,
        );
        result = await requestPage(request, context);
        result = {
          ...result,
          issues: [...promptDiagnosticIssues(request), ...result.issues],
        };
      } catch (error) {
        if (!currentGeneration(context)) return;
        const failure = generationFailure(error);
        if (!failure.retryable) throw error;
        attemptIssues = failure.issues;
        setGenerationIssues(attemptIssues);
        setGenerationStatus("结构化重试中（仅一次）");
        try {
          // Retry once without streaming so OpenAI-compatible providers can
          // enforce response_format=json_schema instead of relying on prompts.
          const retryRequest = buildModelRequest(
            { ...active, streaming: false, structuredOutput: "jsonSchema" },
            prompt,
            generationDocuments,
            parseTemplate(selectedTemplate),
            selectedPromptTemplate,
          );
          result = await requestPage(retryRequest, context);
          result = {
            ...result,
            generationSource: "retry",
            issues: [...attemptIssues, ...promptDiagnosticIssues(retryRequest), ...result.issues],
          };
        } catch (retryError) {
          if (!currentGeneration(context)) return;
          const failure = generationFailure(retryError);
          if (!failure.retryable) throw retryError;
          setGenerationStatus("根据授权 API 构建基础页面");
          result = {
            page: createApiFallbackPage(prompt, generationDocuments),
            generationSource: "apiFallback",
            issues: failure.issues,
          };
        }
      }
      if (!currentGeneration(context)) return;
      const page = validateGenerationCandidate(result.page, prompt, generationOperations);
      const finalIssues = [...attemptIssues, ...result.issues];
      const apiDocumentIds = pageApiDocumentIds(
        page,
        generationDocuments.map((document) => document.id),
      );
      await persistence.saveSession(active.id, prompt, page, apiDocumentIds, context);
      if (!currentGeneration(context)) return;
      setExecutionMode("live");
      generated.setPage(page);
      setPageRevision((revision) => revision + 1);
      setActivePageDocumentIds(apiDocumentIds);
      const selectedRuntimeOperations = generationOperations.filter((operation) =>
        apiDocumentIds.includes(operation.apiDocumentId ?? ""),
      );
      const listOperation = page.operations?.some(
        (operation) => operation.role === "list" && operation.method === "GET",
      )
        ? operationForRole(page, selectedRuntimeOperations, "list", "GET")
        : undefined;
      setGenerationSource(result.generationSource);
      setGenerationIssues(finalIssues);
      setGenerationStatus("校验通过，页面已采用");
      setIsStreaming(false);
      setStreamingPage(null);
      setGenerating(false);
      if (listOperation) {
        // The store owns query completion, including replacements of this auto-query.
        generationTicket.current = null;
        await generated.query({}, listOperation);
      }
    } catch (error) {
      if (currentGeneration(context)) {
        setGenerationIssues(generationFailure(error).issues);
        setGenerationStatus("生成未完成，已保留上一有效页面");
        setGenerationFailed(true);
      }
    } finally {
      if (currentGeneration(context)) {
        generationTicket.current = null;
        setGenerating(false);
        setIsStreaming(false);
        setStreamingPage(null);
        setExecutionMode("live");
        setLoadingState("idle");
      }
    }
  }
  // TODO(refine): fully implemented but currently unreachable — PageRefineBox
  // (src/features/pages/PageRefineBox.tsx) is the intended trigger UI and is
  // not yet rendered anywhere. Either wire it into GeneratedPage or drop this.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function refinePage(instruction: string) {
    const current = generated.page;
    if (!active || !current || generationTicket.current) return;
    const context = generationScope.begin("generation");
    generationTicket.current = context;
    setExecutionMode("preview");
    setRefining(true);
    setLoadingState("generating");
    try {
      const refinementPrompt = `Modify the existing PageSpec according to this instruction: ${instruction}\nExisting PageSpec structure (loaded rows and metrics intentionally excluded): ${JSON.stringify(toModelSafePageSpec(current))}`;
      const refinementIds = new Set(pageApiDocumentIds(current, activePageDocumentIds));
      const refinedResult = await requestPage(
        buildModelRequest(
          active,
          refinementPrompt,
          workspace.documents.filter(
            (document) =>
              document.enabled &&
              document.projectId === context.projectId &&
              refinementIds.has(document.id),
          ),
          current,
          selectedPromptTemplate,
        ),
        context,
      );
      const refinedPage = refinedResult.page;
      if (!currentGeneration(context)) return;
      const refinementOperations = workspace.documents
        .filter((document) => refinementIds.has(document.id) && document.enabled)
        .flatMap((document) =>
          runtimeOperations(
            document.auth.authorizedOperations ?? [],
            document.id,
            document.spec.queryParameters,
          ),
        );
      const page = validateGenerationCandidate(
        refinedPage,
        `${current.title} ${instruction}`,
        refinementOperations,
      );
      const apiDocumentIds = pageApiDocumentIds(page, activePageDocumentIds);
      await persistence.saveSession(active.id, instruction, page, apiDocumentIds, context);
      if (!currentGeneration(context)) return;
      setExecutionMode("live");
      generated.setPage(page);
      setPageRevision((revision) => revision + 1);
      setActivePageDocumentIds(apiDocumentIds);
      setNotice("页面已按对话要求更新");
    } catch (error) {
      if (currentGeneration(context)) {
        setGenerationIssues(generationFailure(error).issues);
        setGenerationStatus("生成未完成，已保留上一有效页面");
        setGenerationFailed(true);
      }
    } finally {
      if (currentGeneration(context)) {
        generationTicket.current = null;
        setRefining(false);
        setExecutionMode("live");
        setLoadingState("idle");
      }
    }
  }
  const openSession = (page: PageSpec, session: (typeof persistence.sessions)[number]) => {
    replacePage(page);
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
        key={`${workspace.activeProjectId}:${pageRevision}:${isStreaming ? "preview" : "live"}`}
        page={streamingPage ?? generated.page}
        projectId={workspace.activeProjectId}
        apiDocumentIds={activePageDocumentIds}
        isStreaming={generating || isStreaming}
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
        onOpen={replacePage}
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
      {generationStatus && route === "generate" && (
        <section className="toast" aria-label="页面生成诊断" aria-live="polite">
          <div>
            <strong>{generationStatus}</strong>
            {generationSource && <p>来源：{sourceLabels[generationSource]}</p>}
            {generationIssues.length > 0 && (
              <ul>
                {generationIssues.map((issue, index) => (
                  <li key={index}>
                    {stageLabels[issue.stage] ?? "页面校验"}：{issue.message}
                    {issue.suggestedFix && <small> · {issue.suggestedFix}</small>}
                  </li>
                ))}
              </ul>
            )}
            {(generationFailed || generationSource === "apiFallback") && (
              <button type="button" disabled={generating} onClick={() => void generate()}>
                重试生成
              </button>
            )}
          </div>
        </section>
      )}
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
