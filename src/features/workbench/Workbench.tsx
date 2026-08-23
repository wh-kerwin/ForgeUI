import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import "../../styles.css";
import "../../generated.css";
import type { ModelConfig, PageSpec, TemplateRecord } from "../../types/domain";
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

export function Workbench() {
  const [notice, setNotice] = useState("");
  const [prompt, setPrompt] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [editorModel, setEditorModel] = useState<ModelConfig | undefined>();
  const [refining, setRefining] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const { route, navigate } = useAppRouter();
  const connection = useBusinessConnection(setNotice);
  const modelConfigs = useModelConfigurations();
  const generated = useGeneratedPageActions({ spec: connection.spec, auth: connection.auth, onNotice: setNotice });
  const persistence = useWorkbenchPersistence({ onNotice: setNotice });
  const active = modelConfigs.activeModel;
  const selectedTemplate = persistence.templates.find((template) => template.id === selectedTemplateId);
  const modelActions = useWorkbenchModelActions({ active, saveModel: modelConfigs.saveModel, makeDefault: modelConfigs.makeDefault, removeModel: modelConfigs.removeModel, onSaved: () => { setShowEditor(false); setEditorModel(undefined); }, onNotice: setNotice });

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

  async function generate() {
    if (!prompt.trim()) return setNotice("请先描述你想生成的业务页面");
    if (!active) return setNotice("请先配置模型服务");
    setNotice("模型正在生成受控 UI DSL…");
    try {
      const page = await invoke<PageSpec>("generate_page", { input: buildModelRequest(active, prompt, connection.spec, parseTemplate(selectedTemplate)) });
      generated.setPage(page);
      await persistence.saveSession(active.id, prompt, page);
      setNotice("已生成真实模型 PageSpec 页面");
    } catch (error) { setNotice(String(error)); }
  }
  async function refinePage(instruction: string) {
    const current = generated.page;
    if (!active || !current) return;
    setRefining(true);
    try {
      const refinementPrompt = `Modify the existing PageSpec according to this instruction: ${instruction}\nExisting PageSpec structure (loaded rows and metrics intentionally excluded): ${JSON.stringify(toModelSafePageSpec(current))}`;
      const page = await invoke<PageSpec>("generate_page", { input: buildModelRequest(active, refinementPrompt, connection.spec) });
      generated.setPage(page);
      await persistence.saveSession(active.id, instruction, page);
      setNotice("页面已按对话要求更新");
    } catch (error) { setNotice(String(error)); } finally { setRefining(false); }
  }
  const generatePage = <main className="route-main"><PromptGenerator prompt={prompt} onPromptChange={setPrompt} onGenerate={generate} onOpenSettings={() => navigate("models")} templates={persistence.templates} selectedTemplateId={selectedTemplateId} onTemplateSelect={setSelectedTemplateId} onTemplateClear={() => setSelectedTemplateId("")} /><GeneratedWorkbenchView page={generated.page} modelId={active?.id} templateId={selectedTemplateId || undefined} templateName={selectedTemplate?.name} operations={connection.spec?.operations || []} detail={generated.detail} onDetail={generated.loadDetail} onSaved={persistence.refreshTemplates} onQuery={generated.query} onMutation={generated.mutate} onDelete={generated.deleteRecord} querying={generated.querying} onRefine={refinePage} refining={refining} sessions={persistence.sessions} templates={persistence.templates} versions={persistence.versions} selectedTemplateId={persistence.versionTemplateId} onOpenSession={generated.setPage} onUseTemplate={useTemplate} onShowVersions={persistence.showVersions} onRestore={persistence.restoreVersion} onInvalid={setNotice} onExport={persistence.exportTemplate} onImport={persistence.importTemplate} onDeleteTemplate={persistence.removeTemplate} onRenameTemplate={persistence.renameSavedTemplate} /></main>;
  const page = route === "overview" ? <OverviewPage templates={persistence.templates} sessions={persistence.sessions} spec={connection.spec ?? undefined} modelReady={isModelConfigured(active)} onNavigate={navigate} onStartGenerate={(nextPrompt = "") => { setPrompt(nextPrompt); setSelectedTemplateId(""); navigate("generate"); }} /> : route === "generate" ? generatePage : route === "templates" ? <TemplateRoute templates={persistence.templates} versions={persistence.versions} selectedTemplateId={persistence.versionTemplateId} onOpen={generated.setPage} onUse={useTemplate} onShowVersions={persistence.showVersions} onRestore={persistence.restoreVersion} onInvalid={() => setNotice("Template content is invalid")} onExport={persistence.exportTemplate} onImport={persistence.importTemplate} onDelete={persistence.removeTemplate} onRename={persistence.renameSavedTemplate} /> : route === "business" ? <BusinessPage spec={connection.spec} auth={connection.auth} secret={connection.secret} onAuthChange={connection.setAuth} onSecretChange={connection.setSecret} onSave={connection.saveAuth}/> : route === "openapi" ? <OpenApiPage spec={connection.spec} auth={connection.auth} onImport={connection.importSwaggerUrl} onImportFile={connection.importOpenApiFile} onAuthChange={connection.setAuth} onSave={connection.saveAuth}/> : <ModelsPage models={modelConfigs.models} active={active} selectedId={modelConfigs.selectedId} onSelect={modelConfigs.setSelectedId} onEdit={() => { setEditorModel(active); setShowEditor(true); }} onAdd={() => { setEditorModel(undefined); setShowEditor(true); }} onDuplicate={modelActions.duplicate} onMakeDefault={modelActions.setDefault} onDelete={modelActions.remove} editor={showEditor} editorModel={editorModel} onClose={() => { setShowEditor(false); setEditorModel(undefined); }} onSave={modelActions.save} onTest={modelActions.test} testing={modelActions.testing}/>;
  return <div className="app"><WorkbenchSidebar route={route} onNavigate={navigate} onNotice={setNotice}/>{page}{notice && <div className="toast">{notice}<button onClick={() => setNotice("")}><X size={14}/></button></div>}</div>;
}
