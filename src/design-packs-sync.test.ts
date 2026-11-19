import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: gewoon JavaScript-bestand (script); geen typen nodig
import { buildKitComponents, COMPONENTS, rewrite } from "../scripts/build-shadcn-kit.mjs";

const root = process.cwd();
const dir = path.join(root, "design-packs", "_shared", "shadcn", "components");

describe("kit ‘shadcn’ komt uit de shadcn-onderdelen van Studio zelf", () => {
  const built = buildKitComponents(root) as Record<string, string>;

  it("de bestanden in design-packs staan gelijk aan de bron (draai anders: node scripts/build-shadcn-kit.mjs)", () => {
    for (const [file, content] of Object.entries(built)) {
      expect(readFileSync(path.join(dir, file), "utf8"), file).toBe(content);
    }
    const onDisk = readdirSync(dir).filter((f) => f !== "shadcn.css").sort();
    expect(onDisk).toEqual(Object.keys(built).sort());
  });

  it("maakt alle imports relatief en laat geen @-alias van Studio achter", () => {
    for (const [file, content] of Object.entries(built)) {
      expect(content, file).not.toMatch(/from "@\//);
    }
    expect(rewrite('import { cn } from "@/lib/utils"\nimport { Button } from "@/components/ui/button"')).toBe('import { cn } from "./utils"\nimport { Button } from "./button"');
    expect(COMPONENTS.length).toBe(16);
  });

  it("heeft een barrel-bestand dat alle componenten exporteert", () => {
    for (const n of COMPONENTS) expect(built["index.ts"]).toContain(`export * from "./${n}";`);
  });

  it("het thema van de kit definieert alle kleuren die de componenten gebruiken", () => {
    const css = readFileSync(path.join(dir, "shadcn.css"), "utf8");
    const used = new Set<string>();
    for (const content of Object.values(built)) for (const m of content.matchAll(/\b(?:bg|text|border|ring|outline)-(background|foreground|card|popover|primary|secondary|muted|accent|destructive|border|input|ring)(?:-foreground)?\b/g)) used.add(m[0].replace(/^[a-z]+-/, ""));
    for (const token of used) expect(css, token).toContain(`--color-${token}: var(--`);
  });
});
