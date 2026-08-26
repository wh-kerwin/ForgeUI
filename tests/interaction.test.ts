import assert from "node:assert/strict";
import test from "node:test";
import type { FieldSchema, PageSpec } from "../src/types/domain";
import { serializeFieldValues, validateField, visibleFieldSchemas } from "../src/features/pages/formValidation";
import { resolveInteraction, usesOverlay, usesRedirect } from "../src/features/pages/interactionModes";
import { resolvePageLayout } from "../src/features/pages/pageLayout";
import { parsePageSpec } from "../src/features/pages/parsePageSpec";

const legacyPage: PageSpec = {
  version: 1,
  title: "Devices",
  description: "Legacy page",
  filters: [],
  stats: [],
  columns: ["ID", "Name"],
  rows: [["1", "Router"]],
};

test("legacy PageSpec keeps compatible interaction defaults", () => {
  assert.deepEqual(resolveInteraction(legacyPage), {
    create: "inline",
    update: "inline",
    delete: "modal",
    detail: "inline",
  });
  assert.equal(parsePageSpec(legacyPage)?.title, "Devices");
});

test("generated pages default to a vertical full layout and streaming drafts stay full width", () => {
  assert.equal(resolvePageLayout(legacyPage), "full");
  assert.equal(resolvePageLayout({ ...legacyPage, layout: "sidebar" }), "sidebar");
  assert.equal(resolvePageLayout({ ...legacyPage, layout: "sidebar" }, true), "full");
});

test("explicit modal and drawer interaction modes parse and resolve", () => {
  const page = { ...legacyPage, interaction: { create: "modal", update: "drawer", delete: "modal", detail: "modal" } } as const;
  assert.deepEqual(parsePageSpec(page)?.interaction, page.interaction);
  const resolved = resolveInteraction(page);
  assert.equal(resolved.create, "modal");
  assert.equal(resolved.update, "drawer");
  assert.equal(usesOverlay(resolved.create), true);
  assert.equal(usesOverlay(resolved.update), true);
});

test("CRUD pages always use modal operations regardless of model interaction or prompt scene", () => {
  const page = { ...legacyPage, interaction: { create: "inline", update: "redirect", delete: "inline", detail: "drawer" } } as const;
  assert.deepEqual(resolveInteraction(page, true), {
    create: "modal",
    update: "modal",
    delete: "modal",
    detail: "modal",
  });
});

test("redirect is a dedicated navigation mode, not an overlay", () => {
  assert.equal(usesOverlay("redirect"), false);
  assert.equal(usesRedirect("redirect"), true);
  assert.equal(usesRedirect("inline"), false);
});

test("parser rejects unknown interaction modes and keys", () => {
  assert.equal(parsePageSpec({ ...legacyPage, interaction: { create: "popover" } }), null);
  assert.equal(parsePageSpec({ ...legacyPage, interaction: { archive: "modal" } }), null);
});

test("field validation reports required, numeric, integer, and enum errors", () => {
  const fields: FieldSchema[] = [
    { name: "name", type: "string", required: true },
    { name: "amount", type: "number", required: true },
    { name: "count", type: "integer", required: true },
    { name: "status", type: "enum", required: true, enumValues: ["active", "paused"] },
  ];
  assert.match(validateField(fields[0], "", false), /required/);
  assert.match(validateField(fields[1], "abc", false), /number/);
  assert.match(validateField(fields[2], "1.5", false), /integer/);
  assert.match(validateField(fields[3], "missing", false), /valid/);
  const invalid = serializeFieldValues(fields, { name: "", amount: "abc", count: "1.5", status: "missing" }, false);
  assert.equal(invalid.payload, null);
  assert.equal(Object.keys(invalid.errors).length, 4);
});

test("schema field values serialize to their API types", () => {
  const fields: FieldSchema[] = [
    { name: "name", type: "string", required: true },
    { name: "amount", type: "number", required: true },
    { name: "count", type: "integer", required: true },
    { name: "enabled", type: "boolean", required: true },
    { name: "date", type: "date", required: false },
  ];
  const result = serializeFieldValues(fields, { name: "Router", amount: "12.5", count: "2", enabled: "false", date: "2026-08-25" }, false);
  assert.deepEqual(JSON.parse(result.payload ?? "{}"), { name: "Router", amount: 12.5, count: 2, enabled: false, date: "2026-08-25" });
});

test("linked fields are rendered and serialized only when their condition matches", () => {
  const fields: FieldSchema[] = [
    { name: "status", type: "enum", required: true, enumValues: ["active", "closed"] },
    { name: "closedReason", type: "string", required: true, visibleWhen: { field: "status", equals: "closed" } },
    { name: "reviewer", type: "string", required: false, visibleWhen: { field: "status", equals: ["active", "closed"] } },
  ];
  const activeFields = visibleFieldSchemas(fields, { status: "active", closedReason: "stale" });
  assert.deepEqual(activeFields.map((field) => field.name), ["status", "reviewer"]);
  assert.deepEqual(JSON.parse(serializeFieldValues(activeFields, { status: "active", closedReason: "stale", reviewer: "Ada" }, false).payload ?? "{}"), { status: "active", reviewer: "Ada" });
  assert.deepEqual(visibleFieldSchemas(fields, { status: "closed" }).map((field) => field.name), ["status", "closedReason", "reviewer"]);
});
