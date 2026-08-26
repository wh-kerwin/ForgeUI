import { useEffect, useMemo, useState, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ApiDocument, BusinessAuth, OpenApiSummary, Project } from "../../types/domain";
import {
  createProject as createProjectRecord,
  deleteApiDocument as deleteApiDocumentRecord,
  deleteProject as deleteProjectRecord,
  deleteSecret,
  listApiDocuments,
  listProjects,
  renameProject as renameProjectRecord,
  saveApiDocument,
  saveProjectDocumentSelection,
  setApiDocumentEnabled,
} from "../../lib/tauri/storage";

const ACTIVE_PROJECT_KEY = "forge-ui:active-project";

function defaultAuth(documentId: string, spec?: OpenApiSummary): BusinessAuth {
  return {
    type: "none",
    secretRef: `business-${documentId}`,
    apiKeyName: "x-api-key",
    caPem: "",
    apiBaseUrl: spec?.api_base_url ?? "",
    authorizedOperations: [],
    grantedRoles: [],
  };
}

function applyState<T>(current: T, next: SetStateAction<T>): T {
  return typeof next === "function" ? (next as (value: T) => T)(current) : next;
}

export function useProjectWorkspace(onNotice: (message: string) => void) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState("");
  const [documents, setDocuments] = useState<ApiDocument[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState("");
  const [selectedDocumentIds, setSelectedDocumentIdsState] = useState<string[]>([]);
  const [secret, setSecret] = useState("");

  const activeProject = projects.find((project) => project.id === activeProjectId);
  const activeDocument = documents.find((document) => document.id === activeDocumentId) ?? null;
  const selectedDocuments = documents.filter((document) => document.enabled && selectedDocumentIds.includes(document.id));
  const grantedRoles = useMemo(
    () => [...new Set(documents.flatMap((document) => document.auth.grantedRoles ?? []))],
    [documents],
  );

  async function refreshProjects(preferredId?: string) {
    const rows = await listProjects();
    setProjects(rows);
    const requested = preferredId || activeProjectId || window.localStorage.getItem(ACTIVE_PROJECT_KEY) || "";
    const nextId = rows.some((project) => project.id === requested) ? requested : rows[0]?.id ?? "";
    setActiveProjectIdState(nextId);
    if (nextId) window.localStorage.setItem(ACTIVE_PROJECT_KEY, nextId);
    return { rows, nextId };
  }

  async function refreshDocuments(projectId = activeProjectId, projectRows = projects) {
    if (!projectId) {
      setDocuments([]);
      setActiveDocumentId("");
      setSelectedDocumentIdsState([]);
      return [];
    }
    const rows = await listApiDocuments(projectId);
    setDocuments(rows);
    setActiveDocumentId((current) => rows.some((document) => document.id === current) ? current : rows[0]?.id ?? "");
    const project = projectRows.find((item) => item.id === projectId);
    const remembered = project?.selectedApiDocumentIds ?? [];
    setSelectedDocumentIdsState(remembered.filter((id) => rows.some((document) => document.id === id && document.enabled)));
    setSecret("");
    return rows;
  }

  useEffect(() => {
    refreshProjects()
      .then(({ rows, nextId }) => refreshDocuments(nextId, rows))
      .catch(() => undefined);
  }, []);

  async function selectProject(projectId: string) {
    if (projectId === activeProjectId) return;
    setActiveProjectIdState(projectId);
    window.localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
    await refreshDocuments(projectId, projects);
  }

  async function createProject() {
    const name = window.prompt("项目名称")?.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    try {
      await createProjectRecord(id, name);
      const { rows } = await refreshProjects(id);
      await refreshDocuments(id, rows);
      onNotice(`项目「${name}」已创建`);
    } catch (error) { onNotice(String(error)); }
  }

  async function renameProject() {
    if (!activeProject) return;
    const name = window.prompt("重命名项目", activeProject.name)?.trim();
    if (!name || name === activeProject.name) return;
    try {
      await renameProjectRecord(activeProject.id, name);
      await refreshProjects(activeProject.id);
      onNotice("项目已重命名");
    } catch (error) { onNotice(String(error)); }
  }

  async function deleteProject() {
    if (!activeProject || !window.confirm(`删除项目「${activeProject.name}」？只有空项目可以删除。`)) return;
    try {
      await deleteProjectRecord(activeProject.id);
      const { rows, nextId } = await refreshProjects();
      await refreshDocuments(nextId, rows);
      onNotice("项目已删除");
    } catch (error) { onNotice(String(error)); }
  }

  async function persistImportedSpec(imported: OpenApiSummary) {
    if (!activeProjectId) throw new Error("请先创建项目");
    const id = crypto.randomUUID();
    const document: ApiDocument = {
      id,
      projectId: activeProjectId,
      name: imported.title,
      enabled: true,
      spec: imported,
      auth: defaultAuth(id, imported),
      createdAt: "",
      updatedAt: "",
    };
    await saveApiDocument(document);
    await refreshDocuments();
    setActiveDocumentId(id);
    return document;
  }

  async function importSwaggerUrl() {
    const url = window.prompt("输入 Swagger/OpenAPI URL");
    if (!url) return;
    onNotice("正在获取 OpenAPI 文档…");
    try {
      const candidates = await invoke<string[]>("discover_openapi_candidates", { url });
      const selectedIndexText = candidates.length < 2 ? "1" : window.prompt(`发现 ${candidates.length} 个 Swagger/OpenAPI 规范，请输入要导入的编号：\n${candidates.map((candidate, index) => `${index + 1}. ${candidate}`).join("\n")}`, "1");
      if (!selectedIndexText) return;
      const selectedUrl = candidates[Number(selectedIndexText) - 1];
      if (!selectedUrl) return onNotice("选择的 OpenAPI 规范编号无效");
      const imported = await invoke<OpenApiSummary>("import_openapi_url", { url: selectedUrl });
      await persistImportedSpec(imported);
      onNotice(`已导入 ${imported.title}，发现 ${imported.operation_count} 个接口`);
    } catch (error) { onNotice(String(error)); }
  }

  async function importOpenApiFile(file: File) {
    try {
      const imported = await invoke<OpenApiSummary>("parse_openapi_file", { content: await file.text() });
      await persistImportedSpec(imported);
      onNotice(`已从本地文件导入 ${imported.title}，发现 ${imported.operation_count} 个接口`);
    } catch (error) { onNotice(String(error)); }
  }

  function setAuth(next: SetStateAction<BusinessAuth>) {
    if (!activeDocument) return;
    setDocuments((current) => current.map((document) => document.id === activeDocument.id
      ? { ...document, auth: applyState(document.auth, next) }
      : document));
  }

  async function saveAuth() {
    const document = documents.find((item) => item.id === activeDocumentId);
    if (!document) return onNotice("请先选择 API 文档");
    try {
      if (document.auth.type !== "none" && secret) {
        await invoke("save_secret", { secretRef: document.auth.secretRef, value: secret });
      } else if (document.auth.type === "none") {
        await deleteSecret(document.auth.secretRef).catch(() => undefined);
      }
      await saveApiDocument(document);
      setSecret("");
      await refreshDocuments();
      setActiveDocumentId(document.id);
      onNotice("API 文档配置已保存");
    } catch (error) { onNotice(String(error)); }
  }

  async function renameDocument(document: ApiDocument) {
    const name = window.prompt("重命名 API 文档", document.name)?.trim();
    if (!name || name === document.name) return;
    try {
      await saveApiDocument({ ...document, name });
      await refreshDocuments();
      setActiveDocumentId(document.id);
      onNotice("API 文档已重命名");
    } catch (error) { onNotice(String(error)); }
  }

  async function toggleDocument(document: ApiDocument) {
    try {
      await setApiDocumentEnabled(activeProjectId, document.id, !document.enabled);
      const nextSelected = document.enabled ? selectedDocumentIds.filter((id) => id !== document.id) : selectedDocumentIds;
      if (document.enabled) await saveProjectDocumentSelection(activeProjectId, nextSelected);
      const { rows } = await refreshProjects(activeProjectId);
      await refreshDocuments(activeProjectId, rows);
      onNotice(document.enabled ? "API 文档已停用" : "API 文档已启用");
    } catch (error) { onNotice(String(error)); }
  }

  async function deleteDocument(document: ApiDocument) {
    if (!window.confirm(`删除 API 文档「${document.name}」？`)) return;
    try {
      await deleteApiDocumentRecord(activeProjectId, document.id);
      await deleteSecret(document.auth.secretRef).catch(() => undefined);
      const { rows } = await refreshProjects(activeProjectId);
      await refreshDocuments(activeProjectId, rows);
      onNotice("API 文档已删除");
    } catch (error) { onNotice(String(error)); }
  }

  async function setSelectedDocumentIds(ids: string[]) {
    if (!activeProjectId) return;
    const unique = [...new Set(ids)].filter((id) => documents.some((document) => document.id === id && document.enabled));
    setSelectedDocumentIdsState(unique);
    setProjects((current) => current.map((project) => project.id === activeProjectId ? { ...project, selectedApiDocumentIds: unique } : project));
    try { await saveProjectDocumentSelection(activeProjectId, unique); }
    catch (error) { onNotice(String(error)); }
  }

  return {
    projects,
    activeProject,
    activeProjectId,
    selectProject,
    createProject,
    renameProject,
    deleteProject,
    documents,
    activeDocument,
    activeDocumentId,
    setActiveDocumentId,
    selectedDocumentIds,
    selectedDocuments,
    setSelectedDocumentIds,
    grantedRoles,
    secret,
    setSecret,
    setAuth,
    saveAuth,
    importSwaggerUrl,
    importOpenApiFile,
    renameDocument,
    toggleDocument,
    deleteDocument,
  };
}
