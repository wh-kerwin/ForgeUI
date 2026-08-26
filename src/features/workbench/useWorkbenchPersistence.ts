import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GenerationSession, PageSpec, TemplateRecord, TemplateVersion } from "../../types/domain";
import { deleteGenerationSession, deleteTemplate, listGenerationSessions, listTemplateVersions, listTemplates, renameTemplate, restoreTemplateVersion, saveGenerationSession } from "../../lib/tauri/storage";

type Args = { projectId: string; onNotice: (message: string) => void };

export function useWorkbenchPersistence({ projectId, onNotice }: Args) {
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [versionTemplateId, setVersionTemplateId] = useState("");
  const [sessions, setSessions] = useState<GenerationSession[]>([]);

  async function refreshTemplates() {
    if (!projectId) return setTemplates([]);
    try { setTemplates(await listTemplates(projectId)); } catch { /* Browser preview has no native database. */ }
  }

  async function refreshSessions() {
    if (!projectId) return setSessions([]);
    try { setSessions(await listGenerationSessions(projectId)); } catch { /* Browser preview has no native database. */ }
  }

  useEffect(() => {
    setVersions([]);
    setVersionTemplateId("");
    void refreshTemplates();
    void refreshSessions();
  }, [projectId]);

  async function saveSession(modelId: string, prompt: string, page: PageSpec, apiDocumentIds: string[]) {
    if (!projectId) throw new Error("请先选择项目");
    await saveGenerationSession(projectId, modelId, prompt, JSON.stringify(page), apiDocumentIds);
    await refreshSessions();
  }

  async function removeSession(id: string) {
    if (!window.confirm("删除这条生成历史？")) return;
    try { await deleteGenerationSession(id); await refreshSessions(); onNotice("生成历史已删除"); }
    catch (error) { onNotice(String(error)); }
  }

  async function showVersions(id: string) {
    try { setVersions(await listTemplateVersions(id)); setVersionTemplateId(id); }
    catch (error) { onNotice(String(error)); }
  }

  async function restoreVersion(version: number) {
    try { await restoreTemplateVersion(versionTemplateId, version); await refreshTemplates(); onNotice(`已恢复模板版本 v${version}`); }
    catch (error) { onNotice(String(error)); }
  }

  async function exportTemplate(id: string, name: string) {
    try {
      const document = await invoke<string>("export_template", { id });
      const url = URL.createObjectURL(new Blob([document], { type: "application/json" }));
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${name}.forge-template.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      onNotice("模板已导出（不包含任何密钥或业务数据）");
    } catch (error) { onNotice(String(error)); }
  }

  async function importTemplate(file: File) {
    try { await invoke("import_template", { document: await file.text(), projectId }); await refreshTemplates(); onNotice("模板已导入当前项目，请确认 API 文档绑定后使用"); }
    catch (error) { onNotice(String(error)); }
  }

  async function removeTemplate(id: string, name: string) {
    if (!window.confirm(`删除模板「${name}」及其版本历史？`)) return;
    try {
      await deleteTemplate(id);
      if (versionTemplateId === id) { setVersionTemplateId(""); setVersions([]); }
      await refreshTemplates();
      onNotice("模板已删除");
    } catch (error) { onNotice(String(error)); }
  }

  async function renameSavedTemplate(id: string, currentName: string) {
    const name = window.prompt("Rename template", currentName)?.trim();
    if (!name || name === currentName) return;
    try { await renameTemplate(id, name); await refreshTemplates(); onNotice("Template renamed"); }
    catch (error) { onNotice(String(error)); }
  }

  return { templates, versions, versionTemplateId, sessions, refreshTemplates, refreshSessions, saveSession, removeSession, showVersions, restoreVersion, exportTemplate, importTemplate, removeTemplate, renameSavedTemplate };
}
