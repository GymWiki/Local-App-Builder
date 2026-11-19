import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "node_modules", "mcp-server", "templates", "design-packs", "src/components/ui", "src/hooks/use-mobile.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["scripts/**/*.mjs"], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  // Regels voor de Studio-UI zelf (zie CLAUDE.md): alleen shadcn-onderdelen en thematokens.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/**", "src/**/*.test.{ts,tsx}", "src/test-setup.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]", message: "Geen hardgecodeerde kleuren (#hex). Gebruik een thematoken, bijvoorbeeld bg-primary of text-muted-foreground." },
        { selector: "Literal[value=/\\b(rgb|rgba|hsl|hsla|oklch)\\(/]", message: "Geen hardgecodeerde kleuren (rgb(), hsl(), oklch()). Gebruik een thematoken uit src/index.css." },
        { selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b|\\b(rgb|rgba|hsl|hsla|oklch)\\(/]", message: "Geen hardgecodeerde kleuren. Gebruik een thematoken uit src/index.css." },
        { selector: "JSXOpeningElement[name.name='button']", message: "Gebruik <Button> uit @/components/ui/button in plaats van een gewone <button>." },
        { selector: "JSXOpeningElement[name.name='input']", message: "Gebruik <Input>, <Checkbox>, <Switch> of <RadioGroup> uit @/components/ui in plaats van een gewone <input>." },
        { selector: "JSXOpeningElement[name.name='select']", message: "Gebruik <Select> uit @/components/ui/select in plaats van een gewone <select>." },
        { selector: "JSXOpeningElement[name.name='textarea']", message: "Gebruik <Textarea> uit @/components/ui/textarea in plaats van een gewone <textarea>." },
        { selector: "JSXOpeningElement[name.name='dialog']", message: "Gebruik <Dialog> of <AlertDialog> uit @/components/ui in plaats van een gewone <dialog>." },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
