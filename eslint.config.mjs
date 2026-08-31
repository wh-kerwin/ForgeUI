import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "src-tauri", ".codegraph", "*.config.*"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Prettier owns all formatting concerns; ESLint must not fight it.
      ...prettierRules(),
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          // Destructured props are part of a component's public API. Several
          // components (GeneratedPage, GeneratedWorkbenchView) still accept
          // props that are not consumed yet; see README "Known dead code".
          ignoreRestSiblings: true,
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // Warning, not error: auto-fixing these changes effect timing and can
      // introduce infinite loops. Each one needs a deliberate review.
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      eqeqeq: ["error", "smart"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
);

// Keeps formatting rules in one place. Install eslint-config-prettier to replace
// this helper with the canonical rule set (see README "Code style").
function prettierRules() {
  return {
    indent: "off",
    quotes: "off",
    semi: "off",
    "comma-dangle": "off",
    "max-len": "off",
    "no-mixed-spaces-and-tabs": "error",
    "arrow-parens": "off",
    "brace-style": "off",
    "eol-last": "off",
    "object-curly-spacing": "off",
    "quote-props": "off",
  };
}
