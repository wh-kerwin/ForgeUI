import assert from "node:assert/strict";
import test from "node:test";
import type { ApiDocument, PageSpec, TemplateRecord } from "../src/types/domain";
import { operationKey } from "../src/features/pages/pageOperations";
import {
  applyTemplateBindings,
  bindingSummaryFor,
  reconcileTemplateBindings,
  verifyTemplateBindings,
} from "../src/features/templates/templateBinding";
import { createWorkbenchPersistence } from "../src/features/workbench/useWorkbenchPersistence";

const LIST_KEY = operationKey("GET", "/orders", "listOrders");

function document(options: {
  id: string;
  operations?: string[];
  projectId?: string;
  enabled?: boolean;
  fields?: string[];
}): ApiDocument {
  const operationId = "listOrders";
  return {
    id: options.id,
    projectId: options.projectId ?? "p1",
    name: `Document ${options.id}`,
    enabled: options.enabled ?? true,
    spec: {
      title: "",
      version: "",
      spec_version: "",
      operation_count: 0,
      operations: options.operations ?? [LIST_KEY],
      api_base_url: "",
      discovered_url: "",
      fieldSchemas: options.fields
        ? {
            [operationId]: options.fields.map((name) => ({
              name,
              type: "string",
              required: false,
            })),
          }
        : undefined,
    },
    auth: { type: "", secretRef: "", apiKeyName: "", caPem: "" },
    createdAt: "",
    updatedAt: "",
  };
}

function page(): PageSpec {
  return {
    title: "Orders",
    description: "",
    filters: [],
    stats: [],
    columns: ["id"],
    rows: [],
    operations: [{ operation_id: "listOrders", method: "GET", path: "/orders", role: "list" }],
  };
}

function template(apiDocumentIds: string[] = ["doc-1"]): TemplateRecord {
  return {
    id: "t1",
    projectId: "p1",
    name: "Orders",
    payload: JSON.stringify(page()),
    version: 2,
    updatedAt: "",
    apiDocumentIds,
  };
}

function reconcile(
  apiDocumentIds: string[],
  documents: readonly ApiDocument[],
  sourcePage = page(),
) {
  return reconcileTemplateBindings({
    template: template(apiDocumentIds),
    page: sourcePage,
    documents,
    projectId: "p1",
  });
}

test("an intact binding is applicable without prompting", () => {
  const result = reconcile(["doc-1"], [document({ id: "doc-1", fields: ["id", "amount"] })]);
  assert.equal(result.canApply, true);
  assert.equal(result.summary, "bound");
  assert.deepEqual(result.selections, { [LIST_KEY]: "doc-1" });
  assert.equal(result.entries[0].candidates[0].fields.join(","), "id,amount");
});

test("deleted, disabled and foreign documents require an explicit rebind", () => {
  for (const [label, documents, code] of [
    ["deleted", [], "TEMPLATE_BINDING_MISSING_DOCUMENT"],
    ["disabled", [document({ id: "doc-1", enabled: false })], "TEMPLATE_BINDING_DISABLED"],
    ["foreign", [document({ id: "doc-1", projectId: "p2" })], "TEMPLATE_BINDING_FOREIGN"],
  ] as const) {
    const result = reconcile(["doc-1"], documents);
    assert.equal(result.canApply, false, label);
    assert.ok(
      result.issues.some((issue) => issue.code === code),
      label,
    );
    assert.equal(result.entries[0].state === "bound", false, label);
  }
});

test("a same-operationId document with a different path is never auto-matched", () => {
  const result = reconcile(
    ["doc-1"],
    [document({ id: "doc-2", operations: ["GET /v2/orders · listOrders"] })],
  );
  assert.equal(result.entries[0].state, "mismatch");
  assert.deepEqual(result.entries[0].candidates, []);
  assert.equal(result.canApply, false);
  assert.equal(result.summary, "no-candidate");
});

test("no candidate, multiple candidates and partial bindings are surfaced", () => {
  const none = reconcile(["doc-1"], []);
  assert.equal(none.entries[0].state, "no-candidate");
  assert.equal(none.canApply, false);

  const ambiguous = reconcile(["doc-1"], [document({ id: "doc-1" }), document({ id: "doc-2" })]);
  assert.equal(ambiguous.entries[0].state, "ambiguous");
  assert.equal(ambiguous.entries[0].candidates.length, 2);
  assert.equal(ambiguous.selections[LIST_KEY], undefined);
  assert.equal(ambiguous.summary, "ambiguous");

  const twoOperations = page();
  twoOperations.operations!.push({
    operation_id: "deleteOrder",
    method: "DELETE",
    path: "/orders/{id}",
    role: "delete",
  });
  const partial = reconcile(["doc-1"], [document({ id: "doc-1" })], twoOperations);
  assert.equal(partial.canApply, false);
  assert.equal(partial.summary, "no-candidate");
  assert.equal(Object.keys(partial.selections).length, 1);
});

test("only confirmed selections are written and the host re-verifies authorization", () => {
  const documents = [document({ id: "doc-1" })];
  const bound = applyTemplateBindings(page(), { [LIST_KEY]: "doc-1" });
  assert.equal(bound.operations![0].apiDocumentId, "doc-1");
  assert.equal(verifyTemplateBindings(bound, documents, "p1"), true);
  assert.equal(verifyTemplateBindings(bound, documents, "p2"), false);
  assert.equal(
    verifyTemplateBindings(bound, [document({ id: "doc-1", enabled: false })], "p1"),
    false,
  );
  assert.equal(
    verifyTemplateBindings(
      bound,
      [document({ id: "doc-1", operations: ["GET /other · listOrders"] })],
      "p1",
    ),
    false,
  );
  const unbound = applyTemplateBindings(page(), {});
  assert.equal(unbound.operations![0].apiDocumentId, undefined);
  assert.equal(verifyTemplateBindings(unbound, documents, "p1"), false);
});

test("a purely presentational template needs no binding confirmation", () => {
  const presentational = page();
  presentational.operations = [];
  const result = reconcile([], [], presentational);
  assert.equal(result.canApply, true);
  assert.equal(result.summary, "bound");
  assert.equal(verifyTemplateBindings(presentational, [], "p1"), true);
});

test("template list summaries reflect the binding state", () => {
  const good = bindingSummaryFor({
    template: template(["doc-1"]),
    page: page(),
    documents: [document({ id: "doc-1" })],
    projectId: "p1",
  });
  assert.equal(good.state, "bound");
  const stale = bindingSummaryFor({
    template: template(["doc-1"]),
    page: page(),
    documents: [],
    projectId: "p1",
  });
  assert.notEqual(stale.state, "bound");
});

test("restoring a version is refused when its binding is no longer authorized", async () => {
  const source = template(["doc-1"]);
  let restorations = 0;
  const notices: string[] = [];
  const controller = createWorkbenchPersistence(
    "p1",
    (message) => notices.push(message),
    {
      listTemplates: async () => [source],
      listGenerationSessions: async () => [],
      listTemplateVersions: async () => [],
      restoreTemplateVersion: async () => {
        restorations++;
      },
    },
    undefined,
    { getDocuments: () => [] },
  );
  await controller.start();
  await controller.actions.showVersions("t1");
  await controller.actions.restoreVersion(1);
  assert.equal(restorations, 0);
  assert.ok(notices.some((message) => message.includes("重绑定")));
  controller.stop();
});
