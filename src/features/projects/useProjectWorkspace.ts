import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ApiDocument, BusinessAuth, OpenApiSummary, Project } from "../../types/domain";
import { reportError, toUserMessage } from "../../lib/errors";
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
import { createRequestScope, createSnapshotStore } from "../pages/requestContext";

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
const native = {
  createProject: createProjectRecord,
  deleteApiDocument: deleteApiDocumentRecord,
  deleteProject: deleteProjectRecord,
  deleteSecret,
  listApiDocuments,
  listProjects,
  renameProject: renameProjectRecord,
  saveApiDocument,
  saveProjectDocumentSelection,
  setApiDocumentEnabled,
  discover: (url: string) => invoke<string[]>("discover_openapi_candidates", { url }),
  importUrl: (url: string) => invoke<OpenApiSummary>("import_openapi_url", { url }),
  parseFile: (content: string) => invoke<OpenApiSummary>("parse_openapi_file", { content }),
  saveSecret: (secretRef: string, value: string) => invoke("save_secret", { secretRef, value }),
  readRememberedProject: () => window.localStorage.getItem(ACTIVE_PROJECT_KEY) ?? "",
  rememberProject: (id: string) => window.localStorage.setItem(ACTIVE_PROJECT_KEY, id),
  prompt: (message: string, value?: string) => window.prompt(message, value),
  confirm: (message: string) => window.confirm(message),
  newId: () => crypto.randomUUID(),
};

export function createProjectWorkspace(
  onNotice: (message: string) => void,
  dependencies: Partial<typeof native> = {},
) {
  const deps = { ...native, ...dependencies };
  const store = createSnapshotStore({
    projects: [] as Project[],
    activeProjectId: "",
    documents: [] as ApiDocument[],
    activeDocumentId: "",
    selectedDocumentIds: [] as string[],
    secret: "",
  });
  const requestScope = createRequestScope();
  let live = true,
    lifetime = 0,
    projectSequence = 0,
    documentSequence = 0;
  let documentRevision = 0,
    authorizationRevision = 0;
  function ticket() {
    const context = requestScope.capture(),
      life = lifetime;
    return { context, valid: () => live && life === lifetime && requestScope.isCurrent(context) };
  }
  type Ticket = ReturnType<typeof ticket>;
  function changed(documents = false, authorization = false) {
    if (documents) documentRevision++;
    if (authorization) authorizationRevision++;
    requestScope.update({
      projectId: store.getSnapshot().activeProjectId,
      apiDocumentIds: store.getSnapshot().selectedDocumentIds,
      documentRevision,
      authorizationRevision,
    });
  }
  function clearDocuments() {
    store.patch({ documents: [], activeDocumentId: "", selectedDocumentIds: [], secret: "" });
    changed(true, true);
  }
  function switchProject(id: string) {
    if (id === store.getSnapshot().activeProjectId) return;
    store.patch({ activeProjectId: id });
    clearDocuments();
    deps.rememberProject(id);
  }
  async function guarded(work: (t: Ticket) => Promise<void>) {
    const t = ticket();
    if (!t.valid()) return;
    try {
      await work(t);
    } catch (error) {
      if (t.valid()) onNotice(toUserMessage(error));
    }
  }
  async function refreshProjects(preferredId?: string) {
    const t = ticket(),
      sequence = ++projectSequence;
    const rows = await deps.listProjects();
    if (!t.valid() || sequence !== projectSequence) return null;
    const requested =
      preferredId || store.getSnapshot().activeProjectId || deps.readRememberedProject();
    const nextId = rows.some((row) => row.id === requested) ? requested : (rows[0]?.id ?? "");
    store.patch({ projects: rows });
    switchProject(nextId);
    const completed = ticket();
    return {
      rows,
      nextId,
      valid: () =>
        completed.valid() &&
        sequence === projectSequence &&
        store.getSnapshot().activeProjectId === nextId,
    };
  }
  async function refreshDocuments(
    projectId = store.getSnapshot().activeProjectId,
    projectRows = store.getSnapshot().projects,
  ) {
    if (!live || projectId !== store.getSnapshot().activeProjectId) return null;
    const previousId = store.getSnapshot().activeDocumentId;
    clearDocuments();
    const t = ticket(),
      sequence = ++documentSequence;
    try {
      const rows = projectId ? await deps.listApiDocuments(projectId) : [];
      if (!t.valid() || sequence !== documentSequence) return null;
      const documents = rows.filter((row) => row.projectId === projectId);
      const remembered =
        projectRows.find((row) => row.id === projectId)?.selectedApiDocumentIds ?? [];
      store.patch({
        documents,
        activeDocumentId: documents.some((row) => row.id === previousId)
          ? previousId
          : (documents[0]?.id ?? ""),
        selectedDocumentIds: remembered.filter((id) =>
          documents.some((row) => row.id === id && row.enabled),
        ),
      });
      changed(true, true);
      const completed = ticket();
      return {
        rows: documents,
        valid: () =>
          completed.valid() &&
          sequence === documentSequence &&
          store.getSnapshot().documents === documents &&
          store.getSnapshot().activeProjectId === projectId,
      };
    } catch (error) {
      if (t.valid() && sequence === documentSequence) onNotice(toUserMessage(error));
      return null;
    }
  }
  async function reload(t: Ticket, notice: string, activeId?: string) {
    if (!t.valid()) return;
    const result = await refreshDocuments();
    if (!result?.valid()) return;
    if (activeId && result.rows.some((row) => row.id === activeId))
      store.patch({ activeDocumentId: activeId });
    if (result.valid()) onNotice(notice);
  }
  async function persistImportedSpec(imported: OpenApiSummary, t: Ticket) {
    if (!t.valid()) return;
    if (!t.context.projectId) throw new Error("请先创建项目");
    const id = deps.newId();
    const document: ApiDocument = {
      id,
      projectId: t.context.projectId,
      name: imported.title,
      enabled: true,
      spec: imported,
      auth: defaultAuth(id, imported),
      createdAt: "",
      updatedAt: "",
    };
    await deps.saveApiDocument(document);
    await reload(t, `已导入 ${imported.title}，发现 ${imported.operation_count} 个接口`, id);
  }
  const actions = {
    refreshProjects,
    refreshDocuments,
    async selectProject(projectId: string) {
      if (!live || projectId === store.getSnapshot().activeProjectId) return;
      switchProject(projectId);
      await refreshDocuments(projectId);
    },
    async createProject() {
      const name = deps.prompt("项目名称")?.trim();
      if (!name) return;
      await guarded(async (t) => {
        const id = deps.newId();
        await deps.createProject(id, name);
        if (!t.valid()) return;
        // The preferred project applies only while the initiating scope is current.
        const result = await refreshProjects(id);
        if (!result?.valid()) return;
        const rows = await refreshDocuments(result.nextId, result.rows);
        if (rows?.valid()) onNotice(`项目「${name}」已创建`);
      });
    },
    async renameProject() {
      const project = store
        .getSnapshot()
        .projects.find((row) => row.id === store.getSnapshot().activeProjectId);
      if (!project) return;
      const name = deps.prompt("重命名项目", project.name)?.trim();
      if (!name || name === project.name) return;
      await guarded(async (t) => {
        await deps.renameProject(project.id, name);
        if (!t.valid()) return;
        const result = await refreshProjects(project.id);
        if (result?.valid() && t.valid()) onNotice("项目已重命名");
      });
    },
    async deleteProject() {
      const project = store
        .getSnapshot()
        .projects.find((row) => row.id === store.getSnapshot().activeProjectId);
      if (!project || !deps.confirm(`删除项目「${project.name}」？只有空项目可以删除。`)) return;
      await guarded(async (t) => {
        await deps.deleteProject(project.id);
        if (!t.valid()) return;
        const result = await refreshProjects();
        if (!result?.valid()) return;
        const rows = await refreshDocuments(result.nextId, result.rows);
        if (rows?.valid()) onNotice("项目已删除");
      });
    },
    async importSwaggerUrl() {
      const url = deps.prompt("输入 Swagger/OpenAPI URL");
      if (!url) return;
      await guarded(async (t) => {
        onNotice("正在获取 OpenAPI 文档…");
        const candidates = await deps.discover(url);
        if (!t.valid()) return;
        const selection =
          candidates.length < 2
            ? "1"
            : deps.prompt(
                `发现 ${candidates.length} 个 Swagger/OpenAPI 规范，请输入要导入的编号：\n${candidates.map((candidate, index) => `${index + 1}. ${candidate}`).join("\n")}`,
                "1",
              );
        if (!selection) return;
        const selected = candidates[Number(selection) - 1];
        if (!selected) return onNotice("选择的 OpenAPI 规范编号无效");
        const imported = await deps.importUrl(selected);
        if (t.valid()) await persistImportedSpec(imported, t);
      });
    },
    async importOpenApiFile(file: File) {
      await guarded(async (t) => {
        const content = await file.text();
        if (!t.valid()) return;
        const imported = await deps.parseFile(content);
        if (t.valid()) await persistImportedSpec(imported, t);
      });
    },
    setActiveDocumentId(next: SetStateAction<string>) {
      const id = applyState(store.getSnapshot().activeDocumentId, next);
      if (id === store.getSnapshot().activeDocumentId) return;
      store.patch({ activeDocumentId: id, secret: "" });
      changed(true);
    },
    setSecret(next: SetStateAction<string>) {
      store.patch({ secret: applyState(store.getSnapshot().secret, next) });
      changed(false, true);
    },
    setAuth(next: SetStateAction<BusinessAuth>) {
      const state = store.getSnapshot();
      const active = state.documents.find((row) => row.id === state.activeDocumentId);
      if (!active) return;
      store.patch({
        documents: state.documents.map((row) =>
          row.id === active.id ? { ...row, auth: applyState(row.auth, next) } : row,
        ),
      });
      changed(false, true);
    },
    async saveAuth() {
      const state = store.getSnapshot();
      const document = state.documents.find((row) => row.id === state.activeDocumentId);
      if (!document) return onNotice("请先选择 API 文档");
      changed(false, true);
      await guarded(async (t) => {
        if (document.auth.type !== "none" && state.secret) {
          await deps.saveSecret(document.auth.secretRef, state.secret);
        } else if (document.auth.type === "none") {
          await deps.deleteSecret(document.auth.secretRef).catch(() => undefined);
        }
        if (!t.valid()) return;
        await deps.saveApiDocument(document);
        await reload(t, "API 文档配置已保存", document.id);
      });
    },
    async renameDocument(document: ApiDocument) {
      if (document.projectId !== store.getSnapshot().activeProjectId) return;
      const name = deps.prompt("重命名 API 文档", document.name)?.trim();
      if (!name || name === document.name) return;
      await guarded(async (t) => {
        await deps.saveApiDocument({ ...document, name });
        await reload(t, "API 文档已重命名", document.id);
      });
    },
    async toggleDocument(document: ApiDocument) {
      if (document.projectId !== store.getSnapshot().activeProjectId) return;
      const selected = store.getSnapshot().selectedDocumentIds.filter((id) => id !== document.id);
      // Revoke the local grant immediately, before native persistence resolves.
      store.patch({
        documents: store
          .getSnapshot()
          .documents.map((row) =>
            row.id === document.id ? { ...row, enabled: !document.enabled } : row,
          ),
        selectedDocumentIds: selected,
      });
      changed(true, true);
      await guarded(async (t) => {
        await deps.setApiDocumentEnabled(t.context.projectId, document.id, !document.enabled);
        if (!t.valid()) return;
        if (document.enabled)
          await deps.saveProjectDocumentSelection(t.context.projectId, selected);
        if (!t.valid()) return;
        const result = await refreshProjects(t.context.projectId);
        if (result?.valid())
          await reload(t, document.enabled ? "API 文档已停用" : "API 文档已启用");
      });
    },
    async deleteDocument(document: ApiDocument) {
      if (
        document.projectId !== store.getSnapshot().activeProjectId ||
        !deps.confirm(`删除 API 文档「${document.name}」？`)
      )
        return;
      store.patch({
        documents: store.getSnapshot().documents.filter((row) => row.id !== document.id),
        selectedDocumentIds: store
          .getSnapshot()
          .selectedDocumentIds.filter((id) => id !== document.id),
        secret: "",
      });
      changed(true, true);
      await guarded(async (t) => {
        await deps.deleteApiDocument(t.context.projectId, document.id);
        if (!t.valid()) return;
        await deps.deleteSecret(document.auth.secretRef).catch(() => undefined);
        if (!t.valid()) return;
        const result = await refreshProjects(t.context.projectId);
        if (result?.valid()) await reload(t, "API 文档已删除");
      });
    },
    async setSelectedDocumentIds(ids: string[]) {
      const state = store.getSnapshot();
      if (!state.activeProjectId) return;
      const unique = [...new Set(ids)].filter((id) =>
        state.documents.some((row) => row.id === id && row.enabled),
      );
      store.patch({
        selectedDocumentIds: unique,
        projects: state.projects.map((row) =>
          row.id === state.activeProjectId ? { ...row, selectedApiDocumentIds: unique } : row,
        ),
      });
      changed(true, true);
      await guarded(async () => {
        await deps.saveProjectDocumentSelection(state.activeProjectId, unique);
      });
    },
  };
  return {
    ...store,
    actions,
    requestScope,
    async start() {
      live = true;
      const t = ticket();
      try {
        const result = await refreshProjects();
        if (result?.valid()) await refreshDocuments(result.nextId, result.rows);
      } catch (error) {
        if (t.valid()) onNotice(`初始化项目工作区失败：${reportError("workspace.init", error)}`);
      }
    },
    stop() {
      live = false;
      lifetime++;
      requestScope.invalidate();
    },
  };
}

export function useProjectWorkspace(onNotice: (message: string) => void) {
  const [notice] = useState(() => ({ current: onNotice }));
  useLayoutEffect(() => {
    notice.current = onNotice;
  });
  const [controller] = useState(() => createProjectWorkspace((message) => notice.current(message)));
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    void controller.start();
    return () => controller.stop();
  }, [controller]);
  const activeProject = state.projects.find((row) => row.id === state.activeProjectId);
  const activeDocument = state.documents.find((row) => row.id === state.activeDocumentId) ?? null;
  const selectedDocuments = state.documents.filter(
    (row) => row.enabled && state.selectedDocumentIds.includes(row.id),
  );
  const grantedRoles = useMemo(
    () => [...new Set(state.documents.flatMap((row) => row.auth.grantedRoles ?? []))],
    [state.documents],
  );
  return {
    ...state,
    ...controller.actions,
    activeProject,
    activeDocument,
    selectedDocuments,
    grantedRoles,
    requestScope: controller.requestScope,
  };
}
