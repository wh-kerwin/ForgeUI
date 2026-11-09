import assert from "node:assert/strict";
import test from "node:test";
import {
  THEME_PRESETS,
  antdTokenFor,
  isDarkThemeTokens,
  resolveThemeTokens,
  themeCssVariables,
} from "../src/features/pages/themePresets";
import type { ThemeStyle } from "../src/types/domain";

const themes: ThemeStyle[] = ["forge-default", "enterprise-blue", "clean-light", "minimal-dark"];

test("antd tokens and generated-page CSS variables share one palette", () => {
  for (const theme of themes) {
    const tokens = resolveThemeTokens(theme);
    const antd = antdTokenFor(tokens);
    const css = themeCssVariables(tokens);
    assert.equal(antd.colorPrimary, tokens.primary, `${theme} primary`);
    assert.equal(antd.colorBgContainer, tokens.surfaceAlt, `${theme} surface`);
    assert.equal(antd.colorText, tokens.text, `${theme} text`);
    assert.equal(css["--fg-primary"], tokens.primary, `${theme} css primary`);
    assert.equal(antd.colorTextLightSolid, css["--fg-on-primary"], `${theme} on-primary`);
  }
});

test("light presets use the default algorithm and dark presets use the dark algorithm", () => {
  assert.equal(isDarkThemeTokens(resolveThemeTokens("enterprise-blue")), false);
  assert.equal(isDarkThemeTokens(resolveThemeTokens("clean-light")), false);
  assert.equal(isDarkThemeTokens(resolveThemeTokens("forge-default")), true);
  assert.equal(isDarkThemeTokens(resolveThemeTokens("minimal-dark")), true);
});

test("radius and density map to antd control sizing", () => {
  const compact = antdTokenFor(resolveThemeTokens("enterprise-blue"));
  const relaxed = antdTokenFor(resolveThemeTokens("clean-light"));
  assert.equal(compact.borderRadius, 4);
  assert.equal(compact.controlHeight, 28);
  assert.equal(relaxed.borderRadius, 7);
  assert.equal(relaxed.controlHeight, 40);
});

test("custom themes merge styleTokens and derive the algorithm from the surface colour", () => {
  const custom = resolveThemeTokens("custom", { surface: "#ffffff", primary: "#1677ff" });
  assert.equal(custom.surface, "#ffffff");
  assert.equal(antdTokenFor(custom).colorPrimary, "#1677ff");
  assert.equal(isDarkThemeTokens(custom), false);
  assert.ok(Object.keys(THEME_PRESETS).includes("custom"));
});
