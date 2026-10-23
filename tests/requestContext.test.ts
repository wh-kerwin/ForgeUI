import assert from "node:assert/strict";
import test from "node:test";
import * as workspaceModule from "../src/features/projects/useProjectWorkspace.ts";
import * as persistenceModule from "../src/features/workbench/useWorkbenchPersistence.ts";
import { createRequestScope, type RequestScope } from "../src/features/pages/requestContext.ts";
const page = { title: "page", description: "", filters: [], stats: [], columns: [], rows: [] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const project = (id: string) => ({
  id,
  name: id,
  selectedApiDocumentIds: [id + "-doc"],
  createdAt: "",
  updatedAt: "",
});
const document = (id: string) => ({
  id: id + "-doc",
  projectId: id,
  name: id,
  enabled: true,
  createdAt: "",
  updatedAt: "",
  spec: {
    title: id,
    version: "1",
    spec_version: "3",
    operation_count: 1,
    operations: ["GET /items"],
    api_base_url: "",
    discovered_url: "",
  },
  auth: {
    type: "none",
    secretRef: id,
    apiKeyName: "x-api-key",
    caPem: "",
    authorizedOperations: ["GET /items"],
    grantedRoles: ["reader"],
  },
});
function workspace(overrides = {}) {
  assert.equal(
    typeof workspaceModule.createProjectWorkspace,
    "function",
    "the hook must expose its injectable coordinator",
  );
  const notices: string[] = [];
  const controller = workspaceModule.createProjectWorkspace(
    (message: string) => notices.push(message),
    {
      listProjects: async () => [project("A"), project("B"), project("C")],
      listApiDocuments: async (id: string) => [document(id)],
      readRememberedProject: () => "A",
      rememberProject: () => {},
      prompt: () => "renamed",
      confirm: () => true,
      newId: () => "00000000-0000-0000-0000-000000000001",
      ...overrides,
    },
  );
  return { controller, notices };
}
function persistence(overrides = {}, requestScope?: RequestScope) {
  assert.equal(
    typeof persistenceModule.createWorkbenchPersistence,
    "function",
    "the hook must expose its injectable coordinator",
  );
  const notices: string[] = [];
  const controller = persistenceModule.createWorkbenchPersistence(
    "A",
    (message: string) => notices.push(message),
    {
      listTemplates: async () => [],
      listGenerationSessions: async () => [],
      confirm: () => true,
      ...overrides,
    },
    requestScope,
  );
  return { controller, notices };
}

test("mount bootstrap cannot reclaim a project selected while listProjects is pending", async () => {
  const initial = deferred<ReturnType<typeof project>[]>();
  const { controller } = workspace({ listProjects: () => initial.promise });
  const boot = controller.start();
  await controller.actions.selectProject("B");
  initial.resolve([project("A"), project("B")]);
  await boot;
  assert.equal(controller.getSnapshot().activeProjectId, "B");
  assert.deepEqual(
    controller.getSnapshot().documents.map((row) => row.projectId),
    ["B"],
  );
});

test("rapid A/B/C selection clears documents and secret immediately and discards late B", async () => {
  const b = deferred<ReturnType<typeof document>[]>();
  const { controller } = workspace({
    listApiDocuments: (id: string) => (id === "B" ? b.promise : Promise.resolve([document(id)])),
  });
  await controller.start();
  controller.actions.setSecret("A-secret");
  const pending = controller.actions.selectProject("B");
  assert.deepEqual(controller.getSnapshot().documents, []);
  assert.equal(controller.getSnapshot().secret, "");
  await controller.actions.selectProject("C");
  b.resolve([document("B")]);
  await pending;
  assert.equal(controller.getSnapshot().activeProjectId, "C");
  assert.deepEqual(controller.getSnapshot().selectedDocumentIds, ["C-doc"]);
  assert.deepEqual(
    controller.getSnapshot().documents.map((row) => row.projectId),
    ["C"],
  );
});

test("late bootstrap failure does not notify a new project", async () => {
  const boot = deferred<ReturnType<typeof project>[]>();
  const { controller, notices } = workspace({ listProjects: () => boot.promise });
  const starting = controller.start();
  await controller.actions.selectProject("B");
  boot.reject(new Error("old init"));
  await starting;
  assert.deepEqual(notices, []);
});

test("document authorization and selection invalidate captured contexts without a project change", async () => {
  const { controller } = workspace();
  await controller.start();
  const auth = controller.requestScope.capture();
  controller.actions.setAuth((value) => ({ ...value, authorizedOperations: [] }));
  assert.equal(controller.requestScope.isCurrent(auth), false);
  const selection = controller.requestScope.capture();
  await controller.actions.setSelectedDocumentIds([]);
  assert.equal(controller.requestScope.isCurrent(selection), false);
  assert.equal(auth.projectId, "A");
  assert.deepEqual(auth.apiDocumentIds, ["A-doc"]);
  assert.equal(Object.isFrozen(auth), true);
  assert.equal(Object.isFrozen(auth.apiDocumentIds), true);
});

test("document refresh clears secret at initiation and rejects foreign project rows", async () => {
  const pending = deferred<ReturnType<typeof document>[]>();
  let reads = 0;
  const { controller } = workspace({
    listApiDocuments: async (id: string) => (++reads === 1 ? [document(id)] : pending.promise),
  });
  await controller.start();
  controller.actions.setSecret("draft");
  const refresh = controller.actions.refreshDocuments();
  assert.equal(controller.getSnapshot().secret, "");
  assert.deepEqual(controller.getSnapshot().documents, []);
  const switching = controller.actions.selectProject("B");
  pending.resolve([document("A")]);
  await Promise.all([refresh, switching]);
  assert.equal(controller.getSnapshot().activeProjectId, "B");
  assert.deepEqual(controller.getSnapshot().documents, [], "foreign rows are never accepted");
});

test("old template/session/version completions cannot overwrite the new project", async () => {
  const templates = deferred<unknown[]>();
  const sessions = deferred<unknown[]>();
  const versions = deferred<unknown[]>();
  const { controller } = persistence({
    listTemplates: (id: string) =>
      id === "A" ? templates.promise : Promise.resolve([{ id: "B-template", projectId: "B" }]),
    listGenerationSessions: (id: string) =>
      id === "A" ? sessions.promise : Promise.resolve([{ id: "B-session", projectId: "B" }]),
    listTemplateVersions: () => versions.promise,
  });
  const a = controller.start();
  const v = controller.actions.showVersions("A-template");
  controller.setProject("B");
  await controller.start();
  templates.resolve([{ id: "A-template", projectId: "A" }]);
  sessions.resolve([{ id: "A-session", projectId: "A" }]);
  versions.resolve([{ version: 1 }]);
  await Promise.all([a, v]);
  assert.deepEqual(
    controller.getSnapshot().templates.map((row) => row.id),
    ["B-template"],
  );
  assert.deepEqual(
    controller.getSnapshot().sessions.map((row) => row.id),
    ["B-session"],
  );
  assert.deepEqual(controller.getSnapshot().versions, []);
});

test("same-project latest list refresh wins even if the first finishes last", async () => {
  const old = deferred<unknown[]>();
  let reads = 0;
  const { controller } = persistence({
    listTemplates: () => (++reads === 1 ? old.promise : Promise.resolve([{ id: "new" }])),
  });
  const first = controller.actions.refreshTemplates();
  await controller.actions.refreshTemplates();
  old.resolve([{ id: "old" }]);
  await first;
  assert.deepEqual(
    controller.getSnapshot().templates.map((row) => row.id),
    ["new"],
  );
});

test("session writes use the initiating context project and stale completion never refreshes lists", async () => {
  const saved = deferred<void>();
  const writes: unknown[][] = [];
  const reads: string[] = [];
  const { controller } = persistence({
    saveGenerationSession: (...args: unknown[]) => {
      writes.push(args);
      return saved.promise;
    },
    listGenerationSessions: async (id: string) => {
      reads.push(id);
      return [];
    },
  });
  const context = controller.requestScope.capture();
  const save = controller.actions.saveSession("model", "prompt", page, ["A-doc"], context);
  controller.setProject("B");
  saved.resolve();
  await save;
  assert.equal(writes[0][0], "A");
  assert.deepEqual(reads, []);
  await controller.actions.saveSession("model", "late", page, [], context);
  assert.equal(writes.length, 1, "an already invalid commit must not reach storage");
});

test("authorization revocation invalidates persistence continuations through the shared scope", async () => {
  const save = deferred<void>();
  const { controller: projects } = workspace();
  await projects.start();
  const { controller, notices } = persistence(
    { deleteTemplate: () => save.promise },
    projects.requestScope,
  );
  const pending = controller.actions.removeTemplate("template", "name");
  projects.actions.setAuth((auth) => ({ ...auth, grantedRoles: [] }));
  save.reject(new Error("old authorization error"));
  await pending;
  assert.deepEqual(notices, []);
});

test("project creation selects its newly persisted project", async () => {
  let created = false;
  const { controller, notices } = workspace({
    createProject: async () => {
      created = true;
    },
    listProjects: async () =>
      created ? [project("A"), project("00000000-0000-0000-0000-000000000001")] : [project("A")],
  });
  await controller.start();
  await controller.actions.createProject();
  assert.equal(controller.getSnapshot().activeProjectId, "00000000-0000-0000-0000-000000000001");
  assert.equal(notices.length, 1);
});

test("old refreshProjects preferred selection cannot reclaim a newly selected project", async () => {
  const old = deferred<ReturnType<typeof project>[]>();
  let calls = 0;
  const { controller } = workspace({
    listProjects: () =>
      ++calls === 1 ? Promise.resolve([project("A"), project("B")]) : old.promise,
  });
  await controller.start();
  const refresh = controller.actions.refreshProjects("A");
  await controller.actions.selectProject("B");
  old.resolve([project("A"), project("B")]);
  await refresh;
  assert.equal(controller.getSnapshot().activeProjectId, "B");
});

test("older version-list error stays silent after a newer list succeeds", async () => {
  const old = deferred<unknown[]>();
  const { controller, notices } = persistence({
    listTemplateVersions: (id: string) =>
      id === "old" ? old.promise : Promise.resolve([{ version: 2 }]),
  });
  const pending = controller.actions.showVersions("old");
  await controller.actions.showVersions("new");
  old.reject(new Error("obsolete version failure"));
  await pending;
  assert.equal(controller.getSnapshot().versionTemplateId, "new");
  assert.deepEqual(notices, []);
});

test("latest request guards success, catch and finally while revisions invalidate all lanes", async () => {
  const scope = createRequestScope({ projectId: "A", apiDocumentIds: ["doc"] });
  const old = deferred<void>();
  const state = { loading: true, notice: "", page: "B" };
  const context = scope.begin("query");
  const pending = old.promise
    .then(() => {
      if (scope.isLatest("query", context)) state.page = "A";
    })
    .catch(() => {
      if (scope.isLatest("query", context)) state.notice = "old error";
    })
    .finally(() => {
      if (scope.isLatest("query", context)) state.loading = false;
    });
  const fresh = scope.begin("query");
  old.reject(new Error("late"));
  await pending;
  assert.deepEqual(state, { loading: true, notice: "", page: "B" });
  assert.equal(scope.isLatest("query", fresh), true);
  scope.update({ definitionRevision: 1 });
  assert.equal(scope.isCurrent(fresh), false);
  assert.equal(
    scope.isCurrent({ ...scope.capture() }),
    false,
    "copied or foreign contexts cannot authorize commits",
  );
});

test("project switch between document commit and caller continuation suppresses the old success notice", async () => {
  const { controller, notices } = workspace({ saveApiDocument: async () => {} });
  await controller.start();
  const unsubscribe = controller.subscribe(() => {
    if (
      controller.getSnapshot().documents.length &&
      controller.getSnapshot().documents[0].name === "A"
    ) {
      unsubscribe();
      void controller.actions.selectProject("B");
    }
  });
  await controller.actions.renameDocument(document("A"));
  assert.equal(controller.getSnapshot().activeProjectId, "B");
  assert.deepEqual(notices, []);
});

test("late project mutation failure cannot notify the next project", async () => {
  const write = deferred<void>();
  const { controller, notices } = workspace({ renameProject: () => write.promise });
  await controller.start();
  const pending = controller.actions.renameProject();
  await controller.actions.selectProject("B");
  write.reject(new Error("old rename failure"));
  await pending;
  assert.deepEqual(notices, []);
});

test("auth save cannot continue writing a document after switching projects", async () => {
  const secret = deferred<void>();
  const writes: string[] = [];
  const { controller, notices } = workspace({
    saveSecret: () => secret.promise,
    saveApiDocument: async (row: ReturnType<typeof document>) => {
      writes.push(row.projectId);
    },
  });
  await controller.start();
  controller.actions.setAuth((auth) => ({ ...auth, type: "bearer" }));
  controller.actions.setSecret("old-secret");
  const pending = controller.actions.saveAuth();
  await controller.actions.selectProject("B");
  controller.actions.setSecret("new-secret");
  secret.resolve();
  await pending;
  assert.deepEqual(writes, []);
  assert.deepEqual(notices, []);
  assert.equal(controller.getSnapshot().secret, "new-secret");
});

test("file import stops before native parsing or import after its scope expires", async () => {
  const text = deferred<string>();
  const writes: string[] = [];
  const { controller, notices } = persistence({
    importTemplate: async (_text: string, projectId: string) => {
      writes.push(projectId);
    },
  });
  const pending = controller.actions.importTemplate({ text: () => text.promise } as File);
  controller.setProject("B");
  text.resolve("{}");
  await pending;
  assert.deepEqual(writes, []);
  assert.deepEqual(notices, []);
});

test("project epoch prevents ABA completion when the user returns to the original project", async () => {
  const old = deferred<unknown[]>();
  let reads = 0;
  const { controller } = persistence({
    listTemplates: () => (++reads === 1 ? old.promise : Promise.resolve([{ id: "fresh-A" }])),
  });
  const pending = controller.actions.refreshTemplates();
  controller.setProject("B");
  controller.setProject("A");
  await controller.actions.refreshTemplates();
  old.resolve([{ id: "obsolete-A" }]);
  await pending;
  assert.deepEqual(
    controller.getSnapshot().templates.map((row) => row.id),
    ["fresh-A"],
  );
});

test("unmount rejects pending successful and failed continuations, remount can bootstrap", async () => {
  const old = deferred<unknown[]>();
  const { controller, notices } = persistence({ listTemplateVersions: () => old.promise });
  const pending = controller.actions.showVersions("template");
  controller.stop();
  old.reject(new Error("unmounted"));
  await pending;
  assert.deepEqual(notices, []);
  await controller.start();
  assert.deepEqual(controller.getSnapshot().versions, []);
});
