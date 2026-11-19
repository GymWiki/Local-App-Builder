// Maakt de componenten voor de kit "shadcn" uit de shadcn-onderdelen van Studio zelf (src/components/ui).
// Zo draait Studio op dezelfde opzet als de kit. De imports worden relatief gemaakt, zodat de kit in elk Vite-project werkt.
// Gebruik: node scripts/build-shadcn-kit.mjs      (schrijft design-packs/_shared/shadcn/components/)
//          src/design-packs-sync.test.ts bewaakt dat de bestanden in de repo kloppen met de bron.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const COMPONENTS = ["alert", "avatar", "badge", "button", "card", "checkbox", "dialog", "input", "label", "progress", "select", "separator", "skeleton", "switch", "tabs", "textarea"];

/** Herschrijft de @-imports van Studio naar relatieve imports binnen de kit-map. */
export function rewrite(source) {
  return source
    .replace(/from "@\/components\/ui\/([a-z-]+)"/g, 'from "./$1"')
    .replace(/from "@\/lib\/utils"/g, 'from "./utils"')
    .replace(/^"use client"\n+/, "");
}

export function buildKitComponents(root) {
  const out = {};
  for (const name of COMPONENTS) {
    const src = readFileSync(path.join(root, "src", "components", "ui", `${name}.tsx`), "utf8");
    const result = rewrite(src);
    if (/from "@\//.test(result)) throw new Error(`${name}.tsx heeft nog een @-import na het herschrijven.`);
    out[`${name}.tsx`] = result;
  }
  out["utils.ts"] = 'export { cn } from "cn";\n';
  out["index.ts"] = COMPONENTS.map((n) => `export * from "./${n}";`).join("\n") + '\nexport { cn } from "./utils";\n';
  return out;
}

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(here, "..");
  const dir = path.join(root, "design-packs", "_shared", "shadcn", "components");
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(buildKitComponents(root))) writeFileSync(path.join(dir, file), content);
  console.log(`✔ ${COMPONENTS.length} componenten geschreven naar ${path.relative(root, dir)}`);
}
