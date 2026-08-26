import assert from "node:assert/strict";
import test from "node:test";
import { classifyConformanceFailure, conformanceCaseDistribution, conformanceThresholdStatus, createConformanceCases, isRetryableConformanceFailure } from "../scripts/model-conformance-cases";

test("default conformance sampling allocates 20 enterprise theme attempts", () => {
  const cases = createConformanceCases(50);
  assert.equal(cases.length, 50);
  assert.deepEqual(conformanceCaseDistribution(cases), {
    dashboard: 15,
    crud: 15,
    "enterprise-theme": 20,
  });
});

test("conformance sampling rotates varied prompts for every acceptance category", () => {
  const cases = createConformanceCases(50);
  const unique = (key: string) => new Set(cases.filter((testCase) => testCase.key === key).map((testCase) => testCase.prompt));
  assert.equal(unique("dashboard").size, 5);
  assert.equal(unique("crud").size, 5);
  assert.equal(unique("enterprise-theme").size, 10);
  assert.ok([...unique("enterprise-theme")].every((prompt) => /enterprise-blue|企业蓝|蓝白|Ant Design/i.test(prompt)));
});

test("conformance sampling is reproducible and validates its bounds", () => {
  assert.deepEqual(createConformanceCases(37), createConformanceCases(37));
  assert.throws(() => createConformanceCases(0), /integer from 1 to 200/);
  assert.throws(() => createConformanceCases(201), /integer from 1 to 200/);
  assert.throws(() => createConformanceCases(1.5), /integer from 1 to 200/);
});

test("conformance failures retry only transient provider conditions", () => {
  assert.equal(classifyConformanceFailure(new Error("模型服务返回 HTTP 429")), "rate-limit");
  assert.equal(classifyConformanceFailure(new Error("Client model probe timed out")), "timeout");
  assert.equal(classifyConformanceFailure(new Error("模型服务返回 HTTP 503")), "unavailable");
  assert.equal(classifyConformanceFailure(new Error("模型输出不符合 PageSpec")), "invalid-output");
  assert.equal(classifyConformanceFailure(new Error("模型服务返回 HTTP 401")), "auth");
  assert.equal(isRetryableConformanceFailure("rate-limit"), true);
  assert.equal(isRetryableConformanceFailure("timeout"), true);
  assert.equal(isRetryableConformanceFailure("unavailable"), true);
  assert.equal(isRetryableConformanceFailure("invalid-output"), false);
  assert.equal(isRetryableConformanceFailure("auth"), false);
});

test("conformance threshold stops once the remaining attempts cannot reach 95 percent", () => {
  assert.deepEqual(conformanceThresholdStatus(5, 8, 50), {
    reachable: false,
    requiredPasses: 48,
    maximumPasses: 47,
    maximumRate: 0.94,
  });
  assert.equal(conformanceThresholdStatus(6, 8, 50).reachable, true);
  assert.equal(conformanceThresholdStatus(18, 19, 20).reachable, true);
  assert.equal(conformanceThresholdStatus(18, 20, 20).reachable, false);
  assert.equal(conformanceThresholdStatus(0, 0, 0).maximumRate, 1);
});
