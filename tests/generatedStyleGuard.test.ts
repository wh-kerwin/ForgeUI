import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

const antdComponentColourOverride =
  /\.ant-(?:btn|pagination|input|select|form|modal|drawer|checkbox|table|popover|tooltip|alert|picker|switch|radio|upload)[a-z-]*[^}]*\{[^}]*--fg-/g;

test("generated page styles no longer override antd component colours", () => {
  const css = read("src/wide-layout.css");
  assert.doesNotMatch(css, /\.page-modal/, "self-drawn modal styles must stay removed");
  assert.doesNotMatch(css, /\.table-wrap/, "dead table wrapper styles must stay removed");
  assert.deepEqual(
    css.match(antdComponentColourOverride) ?? [],
    [],
    "antd colours must come from ConfigProvider only",
  );
});

test("global table selectors do not leak into antd Table", () => {
  const css = read("src/generated.css");
  assert.doesNotMatch(css, /\.table-wrap/);
  assert.doesNotMatch(css, /(?:^|\n)\s*(?:table|th|td|thead|tbody)\s*\{/);
});

test("generated page forms use antd controls instead of raw form elements", () => {
  for (const file of [
    "src/features/pages/MutationPanel.tsx",
    "src/features/pages/PageHeader.tsx",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /<(?:input|textarea|select)\b/, `${file} renders a raw control`);
    assert.doesNotMatch(source, /<button\b/, `${file} renders a raw button`);
  }
});

test("the generated page owns a local ConfigProvider that follows the page theme", () => {
  const source = read("src/features/pages/GeneratedPage.tsx");
  assert.match(source, /<ConfigProvider theme=\{antdConfig\}>/);
  assert.match(source, /antdTokenFor\(themeTokens\)/);
  assert.match(source, /isDarkThemeTokens\(themeTokens\)/);
});
