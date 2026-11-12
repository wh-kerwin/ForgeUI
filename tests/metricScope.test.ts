import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import type { MetricDefinition, PageSpec } from "../src/types/domain";
import {
  propagateMetricFilters,
  resolveMetrics,
  type MetricResponse,
} from "../src/features/pages/metrics/metricScope";
import { forTemplate } from "../src/features/pages/contracts/pageProjections";
import { selectStats } from "../src/features/pages/runtime/runtimeSelectors";
import {
  applyQueryResult,
  createPageRuntimeState,
} from "../src/features/pages/runtime/pageRuntimeState";
import { runtimeFromV1Definition } from "../src/features/pages/runtime/runtimeSelectors";
import { validatePageDefinition } from "../src/features/pages/contracts/pageDefinition";

const records = [
  { id: "1", amount: 20 },
  { id: "2", amount: 30 },
  { id: "3", amount: "10" },
];

function page(metrics: MetricDefinition[]): PageSpec {
  return {
    title: "Orders",
    description: "",
    filters: [],
    stats: [],
    columns: ["id", "amount"],
    rows: [],
    metrics,
  };
}

const count: MetricDefinition = {
  key: "pageCount",
  label: "Page count",
  scope: "currentPage",
  aggregation: "count",
};
const sum: MetricDefinition = {
  key: "pageSum",
  label: "Page sum",
  scope: "currentPage",
  aggregation: "sum",
  fieldKey: "amount",
};
const total: MetricDefinition = {
  key: "total",
  label: "Total",
  scope: "serverAggregate",
  operationRef: "orderStats",
  valuePointer: "/total",
};

const resolve = (
  metrics: MetricDefinition[],
  responses: Record<string, MetricResponse> = {},
  truncated = false,
) =>
  resolveMetrics({
    metrics,
    records,
    fieldKeys: ["id", "amount"],
    responses,
    truncated,
  });

test("current-page aggregations are bounded, labelled and never presented as a whole dataset", () => {
  const results = resolve([count, sum]);
  assert.deepEqual(
    results.map((result) => result.value),
    ["3", "60"],
  );
  assert.ok(results.every((result) => result.scope === "currentPage"));
  assert.ok(results.every((result) => result.note.includes("当前已加载页")));
  const truncated = resolve([count, sum], {}, true);
  assert.ok(truncated.every((result) => result.truncated));
  assert.ok(truncated[0].note.includes("截断"));
  for (const aggregation of ["avg", "min", "max"] as const) {
    const [result] = resolve([{ ...sum, aggregation }]);
    assert.equal(result.state, "success");
  }
  assert.equal(resolve([{ ...sum, aggregation: "avg" }])[0].value, "20");
});

test("current-page metrics reject missing aggregation, undeclared fields and mixed scopes", () => {
  const results = resolve([
    { key: "noAgg", label: "No aggregation", scope: "currentPage" },
    { ...sum, key: "undeclared", fieldKey: "missing" },
    { key: "mixed", label: "Mixed", scope: "currentPage", aggregation: "count", operationRef: "x" },
    { ...sum, key: "noNumber", fieldKey: "id" },
  ]);
  assert.deepEqual(
    results.map((result) => result.state),
    ["invalid", "invalid", "invalid", "success"],
  );
  assert.deepEqual(
    results.slice(0, 3).map((result) => result.issue),
    ["metric.aggregation_missing", "metric.field_undeclared", "metric.scope_mixed"],
  );
  assert.equal(results[3].value, "6");
});

test("an unbound server metric shows unbound, never a fabricated total", () => {
  const results = resolve([
    { key: "missing", label: "Missing", scope: "serverAggregate", valuePointer: "/total" },
    { key: "noPointer", label: "No pointer", scope: "serverAggregate", operationRef: "orderStats" },
    { ...total, key: "mixed", label: "Mixed", aggregation: "count" },
  ]);
  assert.deepEqual(
    results.map((result) => result.state),
    ["unbound", "unbound", "invalid"],
  );
  assert.ok(results.every((result) => result.value === ""));
});

test("each server metric has its own loading, pending, error, empty and success state", () => {
  const metrics: MetricDefinition[] = [
    total,
    { ...total, key: "loading", label: "Loading", operationRef: "slow" },
    { ...total, key: "failed", label: "Failed", operationRef: "broken" },
    { ...total, key: "empty", label: "Empty", operationRef: "none" },
    { ...total, key: "pending", label: "Pending", operationRef: "notExecuted" },
  ];
  const results = resolve(metrics, {
    orderStats: { status: "success", body: { total: 1280 } },
    slow: { status: "loading" },
    broken: { status: "error", message: "统计端点超时" },
    none: { status: "empty" },
  });
  assert.deepEqual(
    results.map((result) => result.state),
    ["success", "loading", "error", "empty", "pending"],
  );
  assert.equal(results[0].value, "1280");
  assert.ok(results[0].note.includes("真实统计端点"));
  assert.equal(results[2].value, "");
  assert.equal(results[2].note, "统计端点超时");
  assert.equal(results[4].issue, "metric.pending");
  assert.equal(results[1].value, "");
});

test("a bad stats response keeps an error region instead of becoming zero", () => {
  const cases: Array<[unknown, string]> = [
    [{ other: 1 }, "metric.pointer_missing"],
    [{ total: "n/a" }, "metric.value_invalid"],
  ];
  for (const [body, issue] of cases) {
    const [result] = resolve([total], {
      orderStats: { status: "success", body },
    });
    assert.equal(result.state, "error");
    assert.equal(result.issue, issue);
    assert.equal(result.value, "");
  }
});

test("filter propagation sends only declared query parameters", () => {
  const result = propagateMetricFilters({ status: "open", owner: "me", guessed: "x" }, [
    "status",
    "owner",
  ]);
  assert.deepEqual(result.sent, { status: "open", owner: "me" });
  assert.deepEqual(result.skipped, ["guessed"]);
});

test("structural projection keeps named metrics but drops loaded values", () => {
  const projected = forTemplate(page([count, total]));
  assert.equal(JSON.stringify(projected).includes("secret-marker"), false);
  assert.deepEqual(
    projected.metrics?.map((metric) => metric.key),
    ["pageCount", "total"],
  );
  assert.deepEqual(projected.rows, []);
  assert.deepEqual(projected.stats, []);
});

test("selectStats exposes metric scope, state and truncation to the UI", () => {
  const runtime = applyQueryResult(createPageRuntimeState("e1"), {
    records,
    columns: ["id", "amount"],
    rowKeyPointer: "/id",
  });
  const stats = selectStats(runtime, page([count, total]));
  assert.equal(stats[0].scope, "currentPage");
  assert.equal(stats[0].value, "3");
  assert.equal(stats[1].scope, "serverAggregate");
  assert.equal(stats[1].state, "pending");
  assert.equal(stats[1].value, "—");
});

test("a definition-sample runtime never aggregates samples as current-page data", () => {
  const definition = page([count]);
  const runtime = runtimeFromV1Definition(definition);
  const stats = selectStats(runtime, definition);
  assert.equal(stats[0].value, "—");
  assert.equal(stats[0].state, "pending");
  assert.match(stats[0].note, /定义示例/);
});

test("shared v2 metric fixtures agree with the TS contract validator", () => {
  const directory = new URL("../contracts/fixtures/v2/", import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", directory), "utf8"));
  const metricCases = manifest.cases.filter((item: { id: string }) =>
    item.id.startsWith("metrics-"),
  );
  assert.equal(metricCases.length, 5);
  for (const item of metricCases) {
    const value = JSON.parse(fs.readFileSync(new URL(item.file, directory), "utf8"));
    const result = validatePageDefinition(value);
    assert.equal(result.definition !== null, item.accepted, item.id);
    if (item.issueCode)
      assert.ok(
        result.issues.some(
          (issue: { code: string; path: string }) =>
            issue.code === item.issueCode && issue.path === item.issuePath,
        ),
        item.id,
      );
  }
});
