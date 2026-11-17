import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Na het kiezen van een uiterlijk zet Studio hier de kit-regels neer (design/eslint-kit.mjs).
let kit = [];
try {
  kit = [(await import("./design/eslint-kit.mjs")).default];
} catch {
  /* nog geen uiterlijk gekozen */
}

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: globals.browser } },
  ...kit,
);
