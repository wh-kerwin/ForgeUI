import assert from "node:assert/strict";
import test from "node:test";
import type { ModelConfig, PageSpec, PromptTemplate } from "../src/types/domain";
import { buildModelRequest, buildRefineModelRequest } from "../src/features/workbench/modelRequest";
import { PromptCompositionError } from "../src/features/workbench/PromptComposer";
import {
  diffPageDefinitions,
  initialRefineState,
  reconcileRefinement,
  refineReducer,
  type RefinePreview,
  type RefineUndo,
} from "../src/features/pages/pageRefinement";

function base(): PageSpec {
  return {
    version: 1,
    title: "Orders",
    description: "Order list",
    filters: ["keyword"],
    stats: [],
    columns: ["id", "amount"],
    columnMeta: [{ name: "amount", type: "money", format: "number" }],
    rows: [],
    operations: [
      {
        operation_id: "listOrders",
        method: "GET",
        path: "/orders",
        role: "list",
        pagination: { pageParam: "page", sizeParam: "size", defaultSize: 20 },
      },
    ],
    views: [{ type: "list", title: "Orders" }],
    permissionRole: "viewer",
  };
}

const preview: RefinePreview = {
  candidate: base(),
  diff: diffPageDefinitions(base(), base()),
  instruction: "把金额改为货币格式",
  projectId: "p1",
  apiDocumentIds: ["doc-1"],
};
const undo: RefineUndo = {
  page: base(),
  apiDocumentIds: ["doc-1"],
  projectId: "p1",
  requiresRequery: false,
};

test("formatting an amount is a field change that must not re-query", () => {
  const after = base();
  after.columnMeta![0].format = "currency:CNY";
  const diff = diffPageDefinitions(base(), after);
  assert.ok(
    diff.entries.some(
      (entry) => entry.category === "field" && entry.key === "amount" && entry.change === "changed",
    ),
  );
  assert.equal(diff.requiresRequery, false);
  assert.equal(diff.counts.changed, 1);
});

test("hiding a column and reordering columns are cosmetic changes", () => {
  const hidden = base();
  hidden.columnMeta![0].visible = false;
  assert.equal(diffPageDefinitions(base(), hidden).requiresRequery, false);
  const reordered = base();
  reordered.columns = ["amount", "id"];
  const diff = diffPageDefinitions(base(), reordered);
  assert.equal(diff.requiresRequery, false);
  assert.ok(
    diff.entries.some((entry) => entry.category === "metadata" && entry.key === "columnOrder"),
  );
  assert.equal(
    diff.entries.some((entry) => entry.category === "field"),
    false,
    "stable field keys must not turn a reorder into an add/remove pair",
  );
});

test("adding a filter changes the data scope and requires a re-query", () => {
  const after = base();
  after.filters = ["keyword", "owner"];
  const diff = diffPageDefinitions(base(), after);
  assert.ok(
    diff.entries.some(
      (entry) => entry.category === "filter" && entry.key === "owner" && entry.change === "added",
    ),
  );
  assert.equal(diff.requiresRequery, true);
});

test("title, view, permission, binding and list-operation changes are classified by stable keys", () => {
  const after = base();
  after.title = "Order board";
  after.views = [...after.views!, { type: "list", title: "Board" }];
  after.permissionRole = "admin";
  after.operations![0].apiDocumentId = "doc-1";
  let diff = diffPageDefinitions(base(), after);
  assert.equal(diff.requiresRequery, false);
  for (const category of ["metadata", "view", "permission", "binding"]) {
    assert.ok(
      diff.entries.some((entry) => entry.category === category),
      category,
    );
  }

  const changedSource = base();
  changedSource.operations![0].path = "/v2/orders";
  diff = diffPageDefinitions(base(), changedSource);
  assert.equal(diff.requiresRequery, true);
  assert.ok(
    diff.entries.some((entry) => entry.category === "operation" && entry.change === "added"),
  );
});

test("unauthorized new operations and out-of-scope documents are refused", () => {
  const before = base();
  const candidate = base();
  candidate.operations!.push({
    operation_id: "deleteOrder",
    method: "DELETE",
    path: "/orders/{id}",
    role: "delete",
  });
  const scope = { allowedDocumentIds: ["doc-1"], allowedOperations: [] };
  const refused = reconcileRefinement(before, candidate, scope);
  assert.equal(refused.accepted, false);
  assert.ok(refused.issues.some((issue) => issue.code === "REFINE_OPERATION_UNAUTHORIZED"));

  const authorized = reconcileRefinement(before, candidate, {
    ...scope,
    allowedOperations: [
      {
        key: "DELETE /orders/{id} · deleteOrder",
        method: "DELETE",
        path: "/orders/{id}",
        operationId: "deleteOrder",
      },
    ],
  });
  assert.equal(authorized.accepted, true);

  const widened = base();
  widened.operations![0].apiDocumentId = "other-project-doc";
  const expanded = reconcileRefinement(before, widened, scope);
  assert.equal(expanded.accepted, false);
  assert.ok(expanded.issues.some((issue) => issue.code === "REFINE_SCOPE_EXPANDED"));

  // Existing operations never need re-authorization just because they are retained.
  assert.equal(reconcileRefinement(before, base(), scope).accepted, true);
});

test("the reducer keeps one undoable version and drops everything on a project switch", () => {
  let state = refineReducer(initialRefineState, { type: "submit" });
  assert.equal(state.status, "generating");
  state = refineReducer(state, { type: "preview", preview });
  assert.equal(state.status, "previewDiff");
  assert.equal(state.preview?.instruction, "把金额改为货币格式");
  state = refineReducer(state, { type: "apply" });
  assert.equal(state.status, "applying");
  state = refineReducer(state, { type: "applied", undo });
  assert.equal(state.status, "idle");
  assert.equal(state.preview, null);
  assert.equal(state.undo?.page.title, "Orders");

  const discarded = refineReducer(refineReducer(state, { type: "preview", preview }), {
    type: "discard",
  });
  assert.equal(discarded.status, "idle");
  assert.equal(discarded.preview, null);
  assert.ok(discarded.undo, "discarding a new preview keeps the previous undo");

  const failed = refineReducer(refineReducer(initialRefineState, { type: "submit" }), {
    type: "error",
    issues: [{ code: "REFINE_OPERATION_UNAUTHORIZED", message: "未授权" }],
  });
  assert.equal(failed.status, "error");
  assert.equal(failed.preview, null);

  const switched = refineReducer(
    { ...state, preview, issues: [{ code: "X", message: "stale" }] },
    { type: "project-changed" },
  );
  assert.deepEqual(switched, initialRefineState);
  assert.equal(switched.undo, null);
});

test("a refinement request skips capability discovery and carries only the safe projection", () => {
  const model: ModelConfig = {
    id: "m",
    name: "Model",
    protocol: "openai",
    baseUrl: "http://localhost",
    model: "m",
    apiKey: "",
    temperature: 0.2,
    maxTokens: 2048,
    streaming: false,
    enabled: true,
    timeoutSeconds: 30,
    structuredOutput: "jsonObject",
    customHeaders: {},
    notes: "",
  };
  const crudTemplate: PromptTemplate = {
    id: "crud",
    name: "CRUD",
    scene: "crud",
    systemPrompt: "Return a complete page definition JSON.",
  };
  const marker = "secret-marker";
  const polluted = {
    ...base(),
    rows: [[marker]],
    stats: [{ label: "total", value: marker }],
    secretRef: marker,
  } as unknown as PageSpec;

  assert.throws(
    () => buildModelRequest(model, "create and delete", [], undefined, crudTemplate),
    (error: unknown) => error instanceof PromptCompositionError && error.code === "capability_gap",
  );
  const request = buildRefineModelRequest(
    model,
    "把金额改为货币格式",
    [], // no newly activated documents: scope never unions the active selection
    polluted,
    crudTemplate,
  );
  const serialized = JSON.stringify(request);
  assert.equal(serialized.includes(marker), false);
  assert.ok(serialized.includes("把金额改为货币格式"));
  assert.ok(serialized.includes("Orders"), "structural title survives the projection");
  assert.deepEqual(request.allowed_operations, []);
});
