import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { X } from "lucide-react";
import "../../styles.css";
import "../../generated.css";
import type { ModelConfig, PageSpec, PromptTemplate, TemplateRecord } from "../../types/domain";
import { useBusinessConnection } from "../connections/useBusinessConnection";
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
import { BUILT_IN_PROMPT_TEMPLATES, loadPromptTemplates, savePromptTemplates } from "./promptTemplates";
import { useWorkbenchStore } from "../../store/workbenchStore";

export function Workbench() {
  const [notice, setNotice] = useState("");
  const [prompt, setPrompt] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [editorModel, setEditorModel] = useState<ModelConfig | undefined>();
  const [refining, setRefining] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [streamingPage, setStreamingPage] = useState<PageSpec | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedPromptTemplateId, setSelectedPromptTemplateId] = useState("dashboard");
  const [customPromptTemplates, setCustomPromptTemplates] = useState<PromptTemplate[]>(loadPromptTemplates);
  const setLoadingState = useWorkbenchStore((state) => state.setLoadingState);
  const activeRequestId = useRef<string | null>(null);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const preventNativeContextMenu = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", preventNativeContextMenu);
    return () => document.removeEventListener("contextmenu", preventNativeContextMenu);
  }, []);
  const { route, navigate } = useAppRouter();
  const connection = useBusinessConnection(setNotice);
  const modelConfigs = useModelConfigurations();
  const generated = useGeneratedPageActions({ spec: connection.spec, auth: connection.auth, onNotice: setNotice });
  const persistence = useWorkbenchPersistence({ onNotice: setNotice });
  const active = modelConfigs.activeModel;
  const selectedTemplate = persistence.templates.find((template) => template.id === selectedTemplateId);
  const promptTemplates = [...BUILT_IN_PROMPT_TEMPLATES, ...customPromptTemplates];
  const selectedPromptTemplate = promptTemplates.find((template) => template.id === selectedPromptTemplateId) ?? BUILT_IN_PROMPT_TEMPLATES[0];
  const modelActions = useWorkbenchModelActions({ active, saveModel: modelConfigs.saveModel, makeDefault: modelConfigs.makeDefault, removeModel: modelConfigs.removeModel, onSaved: () => { setShowEditor(false); setEditorModel(undefined); }, onNotice: setNotice });

  useEffect(() => {
    setSelectedPromptTemplateId(active?.promptTemplateId && promptTemplates.some((template) => template.id === active.promptTemplateId) ? active.promptTemplateId : "dashboard");
  }, [active?.id, active?.promptTemplateId, customPromptTemplates]);

  function updatePromptTemplates(templates: PromptTemplate[]) {
    setCustomPromptTemplates(templates);
    savePromptTemplates(templates);
    if (!BUILT_IN_PROMPT_TEMPLATES.some((template) => template.id === selectedPromptTemplateId) && !templates.some((template) => template.id === selectedPromptTemplateId)) setSelectedPromptTemplateId("dashboard");
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
      unlisten = await listen<{ requestId: string; delta: string }>("page-generation-delta", ({ payload }) => {
        if (payload.requestId === requestId && activeRequestId.current === requestId) parser.push(payload.delta);
      });
      const page = await invoke<PageSpec>("generate_page_stream", { input: request, requestId });
      try { parser.finish(); } catch { /* Rust's normalized and validated result is authoritative. */ }
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
    setGenerating(true);
    setLoadingState("generating");
    setNotice("模型正在生成受控 UI DSL…");
    try {
      const page = await requestPage(buildModelRequest(active, prompt, connection.spec, parseTemplate(selectedTemplate), selectedPromptTemplate));
      generated.setPage(page);
      await persistence.saveSession(active.id, prompt, page);
      setNotice("已生成真实模型 PageSpec 页面");
    } catch (error) { setNotice(String(error)); } finally { setGenerating(false); setLoadingState("idle"); }
  }
  async function refinePage(instruction: string) {
    const current = generated.page;
    if (!active || !current) return;
    setRefining(true);
    setLoadingState("generating");
    try {
      const refinementPrompt = `Modify the existing PageSpec according to this instruction: ${instruction}\nExisting PageSpec structure (loaded rows and metrics intentionally excluded): ${JSON.stringify(toModelSafePageSpec(current))}`;
      const page = await requestPage(buildModelRequest(active, refinementPrompt, connection.spec, current, selectedPromptTemplate));
      generated.setPage(page);
      await persistence.saveSession(active.id, instruction, page);
      setNotice("页面已按对话要求更新");
    } catch (error) { setNotice(String(error)); } finally { setRefining(false); setLoadingState("idle"); }
  }
  const generatePage = <main className="route-main"><PromptGenerator prompt={prompt} onPromptChange={setPrompt} onGenerate={generate} generating={generating} onOpenSettings={() => navigate("models")} templates={persistence.templates} selectedTemplateId={selectedTemplateId} onTemplateSelect={setSelectedTemplateId} onTemplateClear={() => setSelectedTemplateId("")} promptTemplates={promptTemplates} selectedPromptTemplateId={selectedPromptTemplateId} onPromptTemplateSelect={setSelectedPromptTemplateId} onManagePromptTemplates={() => navigate("models")} /><GeneratedWorkbenchView page={streamingPage ?? generated.page} isStreaming={isStreaming} fieldSchemas={connection.spec?.fieldSchemas} grantedRoles={connection.auth.grantedRoles} modelId={active?.id} templateId={selectedTemplateId || undefined} templateName={selectedTemplate?.name} operations={connection.spec?.operations || []} detail={generated.detail} onDetail={generated.loadDetail} onSaved={persistence.refreshTemplates} onQuery={generated.query} onMutation={generated.mutate} onDelete={generated.deleteRecord} querying={generated.querying} onRefine={refinePage} refining={refining} sessions={persistence.sessions} templates={persistence.templates} versions={persistence.versions} selectedTemplateId={persistence.versionTemplateId} onOpenSession={generated.setPage} onDeleteSession={persistence.removeSession} onUseTemplate={useTemplate} onShowVersions={persistence.showVersions} onRestore={persistence.restoreVersion} onInvalid={setNotice} onExport={persistence.exportTemplate} onImport={persistence.importTemplate} onDeleteTemplate={persistence.removeTemplate} onRenameTemplate={persistence.renameSavedTemplate} /></main>;
  const routeViews: Record<AppRoute, ReactNode> = {
    overview: <OverviewPage templates={persistence.templates} sessions={persistence.sessions} spec={connection.spec ?? undefined} modelReady={isModelConfigured(active)} onNavigate={navigate} onStartGenerate={(nextPrompt = "") => { setPrompt(nextPrompt); setSelectedTemplateId(""); navigate("generate"); }} />,
    generate: generatePage,
    templates: <TemplateRoute templates={persistence.templates} versions={persistence.versions} selectedTemplateId={persistence.versionTemplateId} onOpen={generated.setPage} onUse={useTemplate} onShowVersions={persistence.showVersions} onRestore={persistence.restoreVersion} onInvalid={() => setNotice("Template content is invalid")} onExport={persistence.exportTemplate} onImport={persistence.importTemplate} onDelete={persistence.removeTemplate} onRename={persistence.renameSavedTemplate} />,
    business: <BusinessPage spec={connection.spec} auth={connection.auth} secret={connection.secret} onAuthChange={connection.setAuth} onSecretChange={connection.setSecret} onSave={connection.saveAuth} />,
    openapi: <OpenApiPage spec={connection.spec} auth={connection.auth} onImport={connection.importSwaggerUrl} onImportFile={connection.importOpenApiFile} onAuthChange={connection.setAuth} onSave={connection.saveAuth} />,
    models: <ModelsPage models={modelConfigs.models} active={active} selectedId={modelConfigs.selectedId} onSelect={modelConfigs.setSelectedId} onEdit={() => { setEditorModel(active); setShowEditor(true); }} onAdd={() => { setEditorModel(undefined); setShowEditor(true); }} onDuplicate={modelActions.duplicate} onMakeDefault={modelActions.setDefault} onDelete={modelActions.remove} editor={showEditor} editorModel={editorModel} onClose={() => { setShowEditor(false); setEditorModel(undefined); }} onSave={modelActions.save} onTest={modelActions.test} testing={modelActions.testing} builtInPromptTemplates={BUILT_IN_PROMPT_TEMPLATES} customPromptTemplates={customPromptTemplates} onPromptTemplatesChange={updatePromptTemplates} />,
  };
  const page = routeViews[route];
  return <div className="app"><WorkbenchSidebar route={route} onNavigate={navigate} onNotice={setNotice}/>{page}{notice && <div className="toast">{notice}<button onClick={() => setNotice("")}><X size={14}/></button></div>}</div>;
}
