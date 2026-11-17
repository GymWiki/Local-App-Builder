// ESLint-regel voor de kit-check. Studio zet dit bestand als design/eslint-kit.mjs in je project.
// Gebruik in eslint.config.js:  import kit from "./design/eslint-kit.mjs";  …  kit,
import { readFileSync } from "node:fs";
import { scanSource } from "./kit-scan.mjs";

let cfg = {};
try {
  cfg = JSON.parse(readFileSync(new URL("./kit-check.json", import.meta.url), "utf8"));
} catch {
  /* nog geen kit gekozen: geen regels */
}

const rule = {
  meta: { type: "suggestion", schema: [], messages: { x: "{{ tekst }}" } },
  create(context) {
    return {
      Program(node) {
        const file = context.filename.replace(/\\/g, "/").replace(/^.*\/(src\/)/, "$1");
        for (const f of scanSource(file, context.sourceCode.text, cfg)) {
          context.report({ node, loc: { line: f.line, column: f.col - 1 }, messageId: "x", data: { tekst: `${f.message} ${f.fix}` } });
        }
      },
    };
  },
};

export default {
  plugins: { kit: { rules: { "gebruik-kit": rule } } },
  rules: { "kit/gebruik-kit": cfg.strengheid === "blokkeren" ? "error" : "warn" },
};
