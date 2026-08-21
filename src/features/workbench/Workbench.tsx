import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import "../../styles.css";
import "../../generated.css";
import type { ModelConfig, PageSpec } from "../../types/domain";
import { useBusinessConnection } from "../connections/useBusinessConnection";
import { useModelConfigurations } from "../models/useModelConfigurations";
import { GeneratedPage } from "../pages/GeneratedPage";
import { useGeneratedPageActions } from "../pages/useGeneratedPageActions";
import { TemplateLibrary } from "../templates/TemplateLibrary";
import { GenerationHistory } from "../sessions/GenerationHistory";
import { PromptGenerator } from "./PromptGenerator";
import { WorkbenchSidebar } from "./WorkbenchSidebar";
import { toModelSafePageSpec } from "../pages/modelSafePageSpec";
import { useWorkbenchPersistence } from "./useWorkbenchPersistence";
import { buildModelRequest } from "./modelRequest";
import "../../route.css";
import { useAppRouter } from "../../app/useAppRouter";
import { OpenApiPage } from "../openapi/OpenApiPage";
import { BusinessPage } from "../business/BusinessPage";
import { ModelsPage } from "../models/ModelsPage";

export function Workbench() {
  const [notice, setNotice] = useState("");
  const [prompt, setPrompt] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [editorModel, setEditorModel] = useState<ModelConfig | undefined>();
  const [testing, setTesting] = useState(false);
  const [refining, setRefining] = useState(false);
  const { route, navigate } = useAppRouter();
  const connection = useBusinessConnection(setNotice);
  const modelConfigs = useModelConfigurations();
  const generated = useGeneratedPageActions({ spec: connection.spec, auth: connection.auth, onNotice: setNotice });
  const persistence = useWorkbenchPersistence({ onNotice: setNotice });
  const active = modelConfigs.activeModel;

  async function saveModel(config: ModelConfig) { try { await modelConfigs.saveModel(config); setShowEditor(false); setEditorModel(undefined); setNotice("模型配置已保存，密钥已交给系统钥匙串"); } catch (error) { setNotice(String(error)); } }
  async function duplicateActiveModel() {
    if (!active) return;
    try {
      const copy = { ...active, id: crypto.randomUUID(), name: `${active.name}（副本）`, secretRef: undefined, apiKey: "" };
      await modelConfigs.saveModel(copy);
      setNotice("已复制模型配置；如需使用密钥，请为副本重新填写 API Key");
    } catch (error) { setNotice(String(error)); }
  }
  async function makeDefaultModel() { if (!active) return; try { await modelConfigs.makeDefault(active.id); setNotice(`已将「${active.name}」设为默认模型`); } catch (error) { setNotice(String(error)); } }
  async function deleteActiveModel() { if (!active || !window.confirm(`删除模型配置「${active.name}」？该操作不会删除其他配置。`)) return; try { await modelConfigs.removeModel(active.id); setNotice("模型配置已删除"); } catch (error) { setNotice(String(error)); } }
  async function testModel(config: ModelConfig) {
    setTesting(true);
    try {
      const result = await invoke<{ message: string; protocol: string; model: string; response_time_ms: number; status: number }>("validate_model_config", { input: { base_url: config.baseUrl, protocol: config.protocol, model: config.model, api_key: config.apiKey || null, secret_ref: config.secretRef || null, custom_headers: config.customHeaders, custom_header_secret_refs: config.customHeaderSecretRefs, timeout_seconds: config.timeoutSeconds } });
      setNotice(`${result.message} · ${result.protocol} · ${result.response_time_ms}ms · HTTP ${result.status}`);
    }
    catch (error) { setNotice(String(error)); } finally { setTesting(false); }
  }
  async function generate() {
    if (!prompt.trim()) return setNotice("请先描述你想生成的业务页面");
    if (!active) return setNotice("请先配置模型服务");
    setNotice("模型正在生成受控 UI DSL…");
    try {
      const page = await invoke<PageSpec>("generate_page", { input: buildModelRequest(active, prompt, connection.spec) });
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
  const generatePage = <main className="route-main"><PromptGenerator prompt={prompt} onPromptChange={setPrompt} onGenerate={generate} onOpenSettings={() => navigate("models")} />{generated.page && <GeneratedPage page={generated.page} modelId={active?.id} operations={connection.spec?.operations || []} detail={generated.detail} onDetail={generated.loadDetail} onSaved={persistence.refreshTemplates} onQuery={generated.query} onMutation={generated.mutate} onDelete={generated.deleteRecord} querying={generated.querying} onRefine={refinePage} refining={refining} />}<GenerationHistory sessions={persistence.sessions} onOpen={generated.setPage} onInvalid={() => setNotice("生成历史内容已损坏")} /><TemplateLibrary templates={persistence.templates} versions={persistence.versions} selectedTemplateId={persistence.versionTemplateId} onOpen={generated.setPage} onShowVersions={persistence.showVersions} onRestore={persistence.restoreVersion} onInvalidTemplate={() => setNotice("模板内容已损坏")} onExport={persistence.exportTemplate} onImport={persistence.importTemplate} onDelete={persistence.removeTemplate} /></main>;
  const page = route === "generate" ? generatePage : route === "business" ? <BusinessPage spec={connection.spec} auth={connection.auth} secret={connection.secret} onAuthChange={connection.setAuth} onSecretChange={connection.setSecret} onSave={connection.saveAuth}/> : route === "openapi" ? <OpenApiPage spec={connection.spec} auth={connection.auth} onImport={connection.importSwaggerUrl} onImportFile={connection.importOpenApiFile} onAuthChange={connection.setAuth} onSave={connection.saveAuth}/> : <ModelsPage models={modelConfigs.models} active={active} selectedId={modelConfigs.selectedId} onSelect={modelConfigs.setSelectedId} onEdit={() => { setEditorModel(active); setShowEditor(true); }} onAdd={() => { setEditorModel(undefined); setShowEditor(true); }} onDuplicate={duplicateActiveModel} onMakeDefault={makeDefaultModel} onDelete={deleteActiveModel} editor={showEditor} editorModel={editorModel} onClose={() => { setShowEditor(false); setEditorModel(undefined); }} onSave={saveModel} onTest={testModel} testing={testing}/>;
  return <div className="app"><WorkbenchSidebar route={route} onNavigate={navigate} onNotice={setNotice}/>{page}{notice && <div className="toast">{notice}<button onClick={() => setNotice("")}><X size={14}/></button></div>}</div>;
}
