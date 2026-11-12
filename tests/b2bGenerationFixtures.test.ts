import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  evaluateFixtures,
  FIXTURE_DIR,
  isLiveRequested,
  LIVE_REQUIRED_ENV,
} from "../scripts/evaluate-business-generation.mjs";

const directory = new URL("../tests/fixtures/b2b-generation/", import.meta.url);

test("offline fixture suite covers every required scenario category", async () => {
  const report = await evaluateFixtures();
  assert.ok(report.total >= 24, `expected at least 24 scenarios, got ${report.total}`);
  assert.equal(report.mode, "offline");
  assert.equal(report.live, "not run");
  assert.equal(report.failed, 0, JSON.stringify(report.cases.filter((item) => !item.pass)));
  assert.equal(report.passed, report.total);
  for (const category of report.requiredCategories)
    assert.ok(report.categories.includes(category), `missing category: ${category}`);
  assert.deepEqual(report.layers, ["contract", "binding", "execution"]);
});

test("fixtures are structurally complete and never assert on prompt keywords", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", directory), "utf8"));
  const ids = new Set<string>();
  let count = 0;
  for (const file of manifest.files) {
    const group = JSON.parse(fs.readFileSync(new URL(file, directory), "utf8"));
    for (const item of group.cases) {
      count++;
      assert.equal(ids.has(item.id), false, `duplicate id ${item.id}`);
      ids.add(item.id);
      assert.equal(typeof item.category, "string");
      assert.equal(typeof item.input.prompt, "string");
      assert.ok(item.expected && Object.keys(item.expected).length > 0);
      for (const key of Object.keys(item.expected)) {
        assert.equal(
          key.startsWith("prompt") || key.includes("keyword") || key.includes("message"),
          false,
          `${item.id} must not assert prompt text`,
        );
      }
    }
  }
  assert.equal(count, 32);
  assert.equal(fs.existsSync(FIXTURE_DIR), true);
});

test("live model evaluation is never enabled automatically", () => {
  assert.equal(isLiveRequested([], {}), false);
  assert.equal(isLiveRequested(["--live"], {}), false);
  assert.equal(isLiveRequested(["--live"], { [LIVE_REQUIRED_ENV]: "0" }), false);
  assert.equal(isLiveRequested(["--live"], { [LIVE_REQUIRED_ENV]: "1" }), true);
  assert.equal(isLiveRequested([], { [LIVE_REQUIRED_ENV]: "1" }), false);
});
