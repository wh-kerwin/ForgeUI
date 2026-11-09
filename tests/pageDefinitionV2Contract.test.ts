import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validatePageDefinition } from "../src/features/pages/contracts/pageDefinition.ts";

const directory = new URL("../contracts/fixtures/v2/", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", directory), "utf8"));
for (const fixture of manifest.cases) {
  test(`v2 shared contract: ${fixture.id}`, () => {
    const value = JSON.parse(fs.readFileSync(new URL(fixture.file, directory), "utf8"));
    const result = validatePageDefinition(value);
    assert.equal(result.definition !== null, fixture.accepted, JSON.stringify(result.issues));
    if (!fixture.accepted) assert.ok(result.issues.length > 0);
    if (fixture.issueCode) {
      assert.ok(
        result.issues.some(
          (issue) => issue.code === fixture.issueCode && issue.path === fixture.issuePath,
        ),
        JSON.stringify(result.issues),
      );
    }
  });
}

test("enum length fixtures retain decimal/exponent tokens and accept equal boundaries", () => {
  for (const [file, constraint, token] of [
    ["enum-min-length-decimal.json", "minLength", "2.0"],
    ["enum-min-length-exponent.json", "minLength", "2e0"],
    ["enum-max-length-decimal.json", "maxLength", "1.0"],
    ["enum-max-length-exponent.json", "maxLength", "1e0"],
  ]) {
    const raw = fs.readFileSync(new URL(file, directory), "utf8");
    assert.ok(raw.includes(`"${constraint}": ${token}`), `${file} lost its raw number token`);
    const value = JSON.parse(raw);
    value.operations[0].bodySchema[0].enumValues =
      constraint === "minLength" ? ["AB", "😀A"] : ["A", "😀"];
    assert.deepEqual(validatePageDefinition(value).issues, []);
    assert.deepEqual(validatePageDefinition(JSON.parse(JSON.stringify(value))).issues, []);
  }
});

for (const kind of ["deep", "cycle", "wide"] as const) {
  test(`v2 rejects ${kind} input before recursive schema validation`, () => {
    const value = JSON.parse(fs.readFileSync(new URL("minimal-v2.json", directory), "utf8"));
    if (kind === "wide") value.extra = Array(20001).fill(null);
    else {
      let view = value.views[0];
      if (kind === "cycle") {
        view.type = "split";
        view.left = view;
        view.right = view;
      } else {
        for (let i = 0; i < 10000; i++)
          view = { key: `v${i}`, type: "tabs", items: [{ key: "tab", label: "Tab", view }] };
        value.views = [view];
      }
    }
    const result = validatePageDefinition(value);
    assert.equal(result.definition, null);
    assert.equal(
      result.issues[0]?.code,
      kind === "cycle" ? "PAGE_V2_INPUT_CYCLE" : "PAGE_V2_INPUT_LIMIT_EXCEEDED",
    );
  });
}

test("valid role methods, equal bounds and locally scoped keys remain accepted", () => {
  const value = JSON.parse(fs.readFileSync(new URL("minimal-v2.json", directory), "utf8"));
  for (const [role, method] of [
    ["create", "POST"],
    ["update", "PUT"],
    ["update", "PATCH"],
    ["delete", "DELETE"],
    ["detail", "GET"],
    ["read", "GET"],
    ["stat", "GET"],
    ["stats", "GET"],
    ["export", "GET"],
  ]) {
    value.operations.push({
      ...value.operations[0],
      key: `${role}${method}`,
      role,
      method,
      bodySchema: [
        {
          key: "shared",
          type: "number",
          constraints: { min: 0, max: 0 },
        },
        {
          key: "text",
          type: "string",
          constraints: { minLength: 0, maxLength: 0 },
        },
      ],
    });
  }
  assert.deepEqual(validatePageDefinition(value).issues, []);
});

test("version dispatcher preserves the v1 wrapper and rejects unknown versions", async () => {
  const parser = await import("../src/features/pages/parsePageSpec.ts");
  const v1 = JSON.parse(
    fs.readFileSync(
      new URL("../contracts/fixtures/v1/missing-version.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(parser.parsePageSpec(v1)?.version, 1);
  assert.equal(validatePageDefinition({ ...v1, version: 99 }).definition, null);
});
