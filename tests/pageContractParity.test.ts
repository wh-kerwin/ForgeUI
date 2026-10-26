import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import * as parser from "../src/features/pages/parsePageSpec.ts";
const directory = new URL("../contracts/fixtures/v1/", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", directory), "utf8"));
for (const fixture of manifest.cases) {
  test(`v1 Rust contract: ${fixture.id}`, () => {
    const value = JSON.parse(fs.readFileSync(new URL(fixture.file, directory), "utf8"));
    assert.equal(parser.parsePageSpec(value) !== null, fixture.accepted);
    if (fixture.issuePath)
      assert.equal(parser.parsePageSpecDetailed(value).issues[0].path, fixture.issuePath);
    if (fixture.id === "missing-version") assert.equal(parser.parsePageSpec(value)?.version, 1);
    if (fixture.context) {
      assert.equal(typeof parser.validatePageBindingContext, "function");
      assert.equal(
        parser.validatePageBindingContext(parser.parsePageSpec(value)!, fixture.context).length ===
          0,
        fixture.authorized,
      );
    }
  });
}
test("detailed parser exposes safe issues and rejects lossy rows", () => {
  assert.equal(typeof parser.parsePageSpecDetailed, "function");
  const input = JSON.parse(fs.readFileSync(new URL("long-row.json", directory), "utf8"));
  const result = parser.parsePageSpecDetailed(input);
  assert.equal(result.page, null);
  assert.equal(result.issues[0].path, "/rows");
  assert.equal(result.issues[0].severity, "error");
  assert.ok(!JSON.stringify(result.issues).includes("secret-row"));
});
test("safe JSON envelopes report repairs; syntax errors never echo input", () => {
  assert.equal(typeof parser.parsePageSpecJsonDetailed, "function");
  const payload = fs.readFileSync(new URL("missing-version.json", directory), "utf8");
  const result = parser.parsePageSpecJsonDetailed("```json\n" + payload + "\n```");
  assert.ok(result.page);
  assert.equal(result.repaired, true);
  assert.equal(result.issues[0].stage, "syntax");
  assert.equal(result.issues[0].severity, "warning");
  const rejected = parser.parsePageSpecJsonDetailed("secret-token: not json");
  assert.equal(rejected.page, null);
  assert.ok(!JSON.stringify(rejected.issues).includes("secret-token"));
});
