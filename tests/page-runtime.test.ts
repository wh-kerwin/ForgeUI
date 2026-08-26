import assert from "node:assert/strict";
import test from "node:test";
import { parseRoute } from "../src/app/routes";
import { buildListQuery, firstListSort, generatedActionPath, hasPageAccess, isGeneratedActionPath, parseGrantedRoles } from "../src/features/pages/pageRuntime";

test("page permissions require an explicitly granted role", () => {
  assert.equal(hasPageAccess(undefined, []), true);
  assert.equal(hasPageAccess("admin", ["operator", "admin"]), true);
  assert.equal(hasPageAccess("admin", ["Admin"]), false);
  assert.equal(hasPageAccess("admin", []), false);
});

test("business role input is trimmed, deduplicated, and bounded", () => {
  assert.deepEqual(parseGrantedRoles(" admin, operator;admin\nviewer "), ["admin", "operator", "viewer"]);
  assert.equal(parseGrantedRoles(Array.from({ length: 60 }, (_, index) => `role-${index}`).join(",")).length, 50);
  assert.equal(parseGrantedRoles("x".repeat(140))[0].length, 120);
});

test("list query includes pagination and the declared server sort parameter", () => {
  assert.deepEqual(buildListQuery({ filters: { status: "active" }, page: 2, size: 25, pageParam: "page", sizeParam: "limit", sortParam: "sort", sort: { column: "createdAt", order: "desc" } }), {
    status: "active",
    page: "2",
    limit: "25",
    sort: "createdAt,desc",
  });
  assert.deepEqual(buildListQuery({ filters: {}, page: 1, size: 100, pageParam: "p", sizeParam: "s" }), { p: "1", s: "100" });
});

test("nested views expose the first configured list sort", () => {
  assert.deepEqual(firstListSort({ type: "tabs", items: [{ key: "chart", label: "Chart", view: { type: "chart", title: "Trend", chartType: "line", xAxisColumn: "day", yAxisColumn: "count" } }, { key: "list", label: "List", view: { type: "list", defaultSort: { column: "name", order: "asc" } } }] }), null);
  assert.deepEqual(firstListSort({ type: "split", left: { type: "chart", title: "Trend", chartType: "bar", xAxisColumn: "day", yAxisColumn: "count" }, right: { type: "list", defaultSort: { column: "name", order: "asc" } } }), { column: "name", order: "asc" });
});

test("redirect interactions stay inside the generate client route", () => {
  assert.equal(generatedActionPath("detail", "A/B 1"), "/generate/detail/A%2FB%201");
  assert.equal(isGeneratedActionPath("/generate/update/42"), true);
  assert.equal(isGeneratedActionPath("/business"), false);
  assert.equal(parseRoute("/generate/detail/42"), "generate");
});
