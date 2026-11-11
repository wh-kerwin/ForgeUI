import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ApiDocument,
  GenerationSession,
  PageSpec,
  TemplateRecord,
  TemplateVersion,
} from "../../types/domain";
import {
  deleteGenerationSession,
  deleteTemplate,
  listGenerationSessions,
  listTemplateVersions,
  listTemplates,
  renameTemplate,
  restoreTemplateVersion,
  saveGenerationSession,
} from "../../lib/tauri/storage";
import { toUserMessage } from "../../lib/errors";
import { forSession, sessionPromptPolicy } from "../pages/contracts/pageProjections";
import {
  createRequestScope,
  createSnapshotStore,
  type RequestContext,
  type RequestScope,
} from "../pages/requestContext";

const native = {
  deleteGenerationSession,
  deleteTemplate,
  listGenerationSessions,
  listTemplateVersions,
  listTemplates,
  renameTemplate,
  restoreTemplateVersion,
  saveGenerationSession,
  importTemplate: (document: string, projectId: string) =>
    invoke("import_template", { document, projectId }),
  exportTemplate: (id: string) => invoke<string>("export_template", { id }),
  download(document: string, name: string) {
    const url = URL.createObjectURL(new Blob([document], { type: "application/json" }));
    try {
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${name}.forge-template.json`;
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  },
  confirm: (message: string) => window.confirm(message),
  prompt: (message: string, value: string) => window.prompt(message, value),
};
type Dependencies = typeof native;

export function createWorkbenchPersistence(
  projectId: string,
  onNotice: (message: string) => void,
  dependencies: Partial<Dependencies> = {},
  sharedScope?: RequestScope,
  options: { getDocuments?: () => readonly ApiDocument[] } = {},
) {
  const deps = { ...native, ...dependencies };
  const requestScope = sharedScope ?? createRequestScope({ projectId });
  const store = createSnapshotStore({
    templates: [] as TemplateRecord[],
    versions: [] as TemplateVersion[],
    versionTemplateId: "",
    sessions: [] as GenerationSession[],
  });
  let currentProject = projectId;
  let live = true;
  let lifetime = 0;
  function ticket(context = requestScope.capture()) {
    const life = lifetime;
    const project = currentProject;
    return {
      context,
      valid: () =>
        live &&
        life === lifetime &&
        project === currentProject &&
        context.projectId === project &&
        requestScope.isCurrent(context),
    };
  }
  function notify(t: ReturnType<typeof ticket>, message: string) {
    if (t.valid()) onNotice(message);
  }
  let templateSequence = 0,
    sessionSequence = 0,
    versionSequence = 0;

  async function refreshTemplates(context?: RequestContext) {
    const t = ticket(context);
    if (!t.valid()) return;
    const sequence = ++templateSequence;
    if (!t.context.projectId) return store.patch({ templates: [] });
    try {
      const templates = await deps.listTemplates(t.context.projectId);
      if (t.valid() && sequence === templateSequence) store.patch({ templates });
    } catch {
      /* Native database is unavailable in browser previews. No state is written. */
    }
  }
  async function refreshSessions(context?: RequestContext) {
    const t = ticket(context);
    if (!t.valid()) return;
    const sequence = ++sessionSequence;
    if (!t.context.projectId) return store.patch({ sessions: [] });
    try {
      const sessions = await deps.listGenerationSessions(t.context.projectId);
      if (t.valid() && sequence === sessionSequence) store.patch({ sessions });
    } catch {
      /* Native database is unavailable in browser previews. No state is written. */
    }
  }
  async function mutation(work: (t: ReturnType<typeof ticket>) => Promise<void>) {
    const t = ticket();
    if (!t.valid()) return;
    try {
      await work(t);
    } catch (error) {
      notify(t, toUserMessage(error));
    }
  }
  const actions = {
    refreshTemplates,
    refreshSessions,
    async saveSession(
      modelId: string,
      prompt: string,
      page: PageSpec,
      apiDocumentIds: string[],
      context?: RequestContext,
    ) {
      const t = ticket(context);
      if (!t.valid()) return;
      if (!t.context.projectId) throw new Error("请先选择项目");
      try {
        await deps.saveGenerationSession(
          t.context.projectId,
          modelId,
          sessionPromptPolicy(prompt).value,
          JSON.stringify(forSession(page)),
          [...apiDocumentIds],
        );
        if (t.valid()) await refreshSessions(t.context);
      } catch (error) {
        if (t.valid()) throw error;
      }
    },
    async removeSession(id: string) {
      if (!deps.confirm("删除这条生成历史？")) return;
      await mutation(async (t) => {
        await deps.deleteGenerationSession(id);
        if (!t.valid()) return;
        await refreshSessions(t.context);
        notify(t, "生成历史已删除");
      });
    },
    async showVersions(id: string) {
      const sequence = ++versionSequence;
      const t = ticket();
      if (!t.valid()) return;
      try {
        const versions = await deps.listTemplateVersions(id);
        if (t.valid() && sequence === versionSequence)
          store.patch({ versions, versionTemplateId: id });
      } catch (error) {
        if (sequence === versionSequence) notify(t, toUserMessage(error));
      }
    },
    async restoreVersion(version: number) {
      const id = store.getSnapshot().versionTemplateId;
      if (!id) return;
      await mutation(async (t) => {
        // Restoring a version must not revive a binding to a document that was
        // deleted, disabled or moved to another project.
        const template = store.getSnapshot().templates.find((item) => item.id === id);
        const documents = options.getDocuments?.() ?? [];
        const stale = (template?.apiDocumentIds ?? []).filter(
          (documentId) =>
            !documents.some(
              (document) =>
                document.id === documentId &&
                document.enabled &&
                document.projectId === currentProject,
            ),
        );
        if (stale.length > 0) {
          notify(t, "模板绑定的 API 文档已失效，请先重绑定后再恢复历史版本");
          return;
        }
        await deps.restoreTemplateVersion(id, version);
        if (!t.valid()) return;
        await refreshTemplates(t.context);
        notify(
          t,
          `已恢复模板版本 v${version}：仅结构定义，不恢复业务记录、选择或表单草稿；使用前仍需确认当前项目绑定`,
        );
      });
    },
    async exportTemplate(id: string, name: string) {
      await mutation(async (t) => {
        const document = await deps.exportTemplate(id);
        if (!t.valid()) return;
        deps.download(document, name);
        notify(t, "模板已导出：仅含页面结构，不含已加载记录、字面统计、自定义载荷或凭证");
      });
    },
    async importTemplate(file: File) {
      await mutation(async (t) => {
        const document = await file.text();
        if (!t.valid()) return;
        await deps.importTemplate(document, t.context.projectId);
        if (!t.valid()) return;
        await refreshTemplates(t.context);
        notify(
          t,
          "模板已导入：仅含页面结构，不含已加载记录、字面统计、自定义载荷或凭证；原项目文档 ID 未沿用，请在模板列表中确认绑定后使用",
        );
      });
    },
    async removeTemplate(id: string, name: string) {
      if (!deps.confirm(`删除模板「${name}」及其版本历史？`)) return;
      await mutation(async (t) => {
        await deps.deleteTemplate(id);
        if (!t.valid()) return;
        if (store.getSnapshot().versionTemplateId === id) {
          versionSequence++;
          store.patch({ versionTemplateId: "", versions: [] });
        }
        await refreshTemplates(t.context);
        notify(t, "模板已删除");
      });
    },
    async renameSavedTemplate(id: string, currentName: string) {
      const name = deps.prompt("Rename template", currentName)?.trim();
      if (!name || name === currentName) return;
      await mutation(async (t) => {
        await deps.renameTemplate(id, name);
        if (!t.valid()) return;
        await refreshTemplates(t.context);
        notify(t, "Template renamed");
      });
    },
  };
  return {
    ...store,
    actions,
    requestScope,
    setProject(nextId: string) {
      if (currentProject === nextId) return;
      currentProject = nextId;
      lifetime++;
      if (!sharedScope) requestScope.update({ projectId: nextId });
      store.patch({ templates: [], sessions: [], versions: [], versionTemplateId: "" });
    },
    async start() {
      live = true;
      await Promise.all([refreshTemplates(), refreshSessions()]);
    },
    stop() {
      live = false;
      lifetime++;
    },
  };
}

type Args = {
  projectId: string;
  onNotice: (message: string) => void;
  requestScope?: RequestScope;
  getDocuments?: () => readonly ApiDocument[];
};
export function useWorkbenchPersistence({ projectId, onNotice, requestScope, getDocuments }: Args) {
  // The coordinator owns the scope; React subscribes to its immutable snapshots.
  const [notice] = useState(() => ({ current: onNotice }));
  const [documentsRef] = useState(() => ({ current: getDocuments }));
  useLayoutEffect(() => {
    documentsRef.current = getDocuments;
  });
  const [controller] = useState(() =>
    createWorkbenchPersistence(projectId, (message) => notice.current(message), {}, requestScope, {
      getDocuments: () => documentsRef.current?.() ?? [],
    }),
  );
  useLayoutEffect(() => {
    notice.current = onNotice;
  });
  useLayoutEffect(() => {
    controller.setProject(projectId);
  }, [controller, projectId]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    void controller.start();
    return () => controller.stop();
  }, [controller, projectId]);
  return { ...state, ...controller.actions, requestScope: controller.requestScope };
}
