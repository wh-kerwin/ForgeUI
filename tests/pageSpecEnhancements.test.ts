import assert from "node:assert/strict";
import test from "node:test";
import { formatColumnValue } from "../src/features/pages/columnFormatting.ts";
import { parsePageSpec } from "../src/features/pages/parsePageSpec.ts";
import { resolveThemeTokens, themeCssVariables } from "../src/features/pages/themePresets.ts";

const base = {
  version: 1,
  title: "Orders",
  description: "Order overview",
  filters: [],
  stats: [],
  columns: ["id", "amount"],
  rows: [["1", "12.5"]],
};

test("recursive tabs and split views parse with column and batch metadata", () => {
  const page = parsePageSpec({
    ...base,
    columnMeta: [{ name: "amount", type: "money", format: "$#,##0.00", sortable: true, filterable: true, searchMode: "range", width: "140px" }],
    views: [{ type: "tabs", items: [{ key: "overview", label: "Overview", view: { type: "split", splitRatio: .6, left: { type: "list", defaultSort: { column: "amount", order: "desc" } }, right: { type: "chart", title: "Amounts", chartType: "bar", xAxisColumn: "id", yAxisColumn: "amount" } } }] }],
    batchActions: [{ operation_id: "archiveOrders", method: "POST", path: "/orders/archive", payloadBuilder: { type: "ids" } }],
  });
  assert.ok(page);
  assert.equal(page.views?.[0].type, "tabs");
  assert.equal(page.columnMeta?.[0].sortable, true);
  assert.equal(page.batchActions?.[0].operation_id, "archiveOrders");
});

test("invalid recursive views and incomplete custom batch payloads are rejected", () => {
  assert.equal(parsePageSpec({ ...base, views: [{ type: "tabs", items: [] }] }), null);
  assert.equal(parsePageSpec({ ...base, views: [{ type: "split", splitRatio: .95, left: { type: "list" }, right: { type: "list" } }] }), null);
  assert.equal(parsePageSpec({ ...base, batchActions: [{ operation_id: "x", method: "POST", path: "/x", payloadBuilder: { type: "custom" } }] }), null);
});

test("page metadata, documented operation roles, and linked body schemas parse", () => {
  const parsed = parsePageSpec({
    ...base,
    layout: "sidebar",
    breadcrumb: ["Operations", "Orders"],
    permissionRole: "order.manager",
    createdAt: "2026-08-25T10:00:00Z",
    updatedAt: "2026-08-25T11:00:00Z",
    operations: [{
      apiDocumentId: "orders-api",
      operation_id: "updateOrder",
      method: "PATCH",
      path: "/orders/{id}",
      role: "update",
      bodySchema: [
        { name: "status", type: "enum", required: true, enumValues: ["open", "closed"] },
        { name: "reason", type: "string", required: true, visibleWhen: { field: "status", equals: "closed" } },
      ],
    }, { operation_id: "exportOrders", method: "GET", path: "/orders/export", role: "export" }],
  });
  assert.equal(parsed?.layout, "sidebar");
  assert.equal(parsed?.operations?.[0].bodySchema?.[1].visibleWhen?.field, "status");
  assert.equal(parsed?.operations?.[0].apiDocumentId, "orders-api");
  assert.equal(parsePageSpec({ ...base, layout: "popover" }), null);
  assert.equal(parsePageSpec({ ...base, operations: [{ operation_id: "x", method: "POST", path: "/x", role: "create", bodySchema: [{ name: "reason", type: "string", required: true, visibleWhen: { field: "status", equals: [] } }] }] }), null);
  assert.equal(parsePageSpec({ ...base, operations: [{ apiDocumentId: 42, operation_id: "x", method: "GET", path: "/x", role: "list" }] }), null);
});

test("money formatting follows the declared currency symbol", () => {
  const usd = formatColumnValue("12.5", { name: "amount", type: "money", format: "$#,##0.00" });
  assert.match(usd, /\$12\.50|US\$12\.50/);
});

test("theme presets merge custom tokens and expose stable CSS variables", () => {
  const enterprise = resolveThemeTokens("enterprise-blue");
  assert.equal(enterprise.primary, "#1677ff");
  assert.equal(enterprise.surface, "#f0f2f5");
  const clean = resolveThemeTokens("clean-light");
  assert.equal(clean.primary, "#4096ff");
  assert.equal(clean.surface, "#ffffff");
  assert.equal(clean.radius, "md");
  const custom = resolveThemeTokens("forge-default", { primary: "#ffffff", radius: "lg" });
  assert.equal(custom.primary, "#ffffff");
  assert.equal(themeCssVariables(custom)["--fg-radius"], "10px");
  assert.equal(themeCssVariables(clean)["--fg-on-primary"], "#101418");
  assert.equal(parsePageSpec({ ...base, theme: "clean-light" })?.theme, "clean-light");
  assert.equal(parsePageSpec({ ...base, theme: "unknown" }), null);
  assert.equal(parsePageSpec({ ...base, theme: "custom", styleTokens: { primary: "url(https://example.com/pixel)" } }), null);
  assert.equal(parsePageSpec({ ...base, theme: "custom", styleTokens: { text: "#000000e0" } })?.styleTokens?.text, "#000000e0");
});
