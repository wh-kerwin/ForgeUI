import type { StyleToken, ThemeStyle } from "../../types/domain";

export const THEME_PRESETS: Record<ThemeStyle, StyleToken> = {
  "forge-default": {
    primary: "#d5fa61",
    primaryBg: "#d5fa61",
    primaryBgHover: "#e1ff83",
    surface: "#0b0e13",
    surfaceAlt: "#10151d",
    surfaceControl: "#101720",
    border: "#242a35",
    borderControl: "#2d3949",
    focusRing: "#d5fa61",
    text: "#e9edf5",
    textMuted: "#768195",
    textSubtle: "#687187",
    danger: "#ff9aa0",
    dangerBg: "#25171d",
    success: "#9ddc5b",
    radius: "md",
    density: "comfortable",
  },
  "enterprise-blue": {
    primary: "#1677ff",
    primaryBg: "#1677ff",
    primaryBgHover: "#4096ff",
    surface: "#f0f2f5",
    surfaceAlt: "#ffffff",
    surfaceControl: "#fafafa",
    border: "#d9d9d9",
    borderControl: "#d9d9d9",
    focusRing: "#1677ff",
    text: "#000000e0",
    textMuted: "#00000073",
    textSubtle: "#00000040",
    danger: "#ff4d4f",
    dangerBg: "#fff1f0",
    success: "#52c41a",
    radius: "sm",
    density: "compact",
  },
  "clean-light": {
    primary: "#4096ff",
    primaryBg: "#4096ff",
    primaryBgHover: "#66b1ff",
    surface: "#ffffff",
    surfaceAlt: "#fafafa",
    surfaceControl: "#f5f7fa",
    border: "#e8e8e8",
    borderControl: "#e4e7ed",
    focusRing: "#4096ff",
    text: "#141414",
    textMuted: "#8c8c8c",
    textSubtle: "#c0c4cc",
    danger: "#f5222d",
    dangerBg: "#fff1f0",
    success: "#52c41a",
    radius: "md",
    density: "relaxed",
  },
  "minimal-dark": {
    primary: "#fafafa",
    primaryBg: "#fafafa",
    primaryBgHover: "#e4e4e7",
    surface: "#09090b",
    surfaceAlt: "#18181b",
    surfaceControl: "#1f1f23",
    border: "#27272a",
    borderControl: "#3f3f46",
    focusRing: "#fafafa",
    text: "#fafafa",
    textMuted: "#a1a1aa",
    textSubtle: "#71717a",
    danger: "#ef4444",
    dangerBg: "#271b1e",
    success: "#22c55e",
    radius: "lg",
    density: "comfortable",
  },
  custom: {},
};

export function resolveThemeTokens(
  theme: ThemeStyle | undefined,
  customTokens?: StyleToken,
): StyleToken {
  return { ...THEME_PRESETS[theme ?? "forge-default"], ...customTokens };
}

const radiusValues: Record<NonNullable<StyleToken["radius"]>, string> = {
  none: "0",
  sm: "4px",
  md: "7px",
  lg: "10px",
  full: "999px",
};

function onPrimary(background?: string): string | undefined {
  if (!background) return undefined;
  const raw = background.slice(1);
  const expanded =
    raw.length <= 4
      ? raw
          .slice(0, 3)
          .split("")
          .map((value) => value + value)
          .join("")
      : raw.slice(0, 6);
  if (!/^[\da-f]{6}$/i.test(expanded)) return undefined;
  const channels = [0, 2, 4]
    .map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.179 ? "#101418" : "#ffffff";
}

export function themeCssVariables(tokens: StyleToken): Record<string, string> {
  const variables = Object.fromEntries(
    Object.entries(tokens)
      .filter(([key, value]) => value !== undefined && key !== "density")
      .map(([key, value]) => [
        `--fg-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
        key === "radius" ? radiusValues[value as NonNullable<StyleToken["radius"]>] : String(value),
      ]),
  );
  const foreground = onPrimary(tokens.primaryBg);
  if (foreground) variables["--fg-on-primary"] = foreground;
  return variables;
}
