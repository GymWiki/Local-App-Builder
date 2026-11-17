import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyKit, planApply, type Run } from "../src/kits/apply.js";

const REPO = path.resolve(__dirname, "../..");
const PACKS = path.join(REPO, "design-packs");
const tmps: string[] = [];
afterAll(async () => {
  for (const d of tmps) await rm(d, { recursive: true, force: true });
});
async function project(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "shadcnkit-"));
  tmps.push(d);
  await cp(path.join(REPO, "templates", "web-react-vite"), d, { recursive: true });
  return d;
}
const npm: Run = async (command, cwd) => {
  const file = path.join(cwd, "package.json");
  const pkg = JSON.parse(await readFile(file, "utf8"));
  for (const spec of command.split(" ").filter((a) => /^(?:@[\w.-]+\/)?[\w.-]+@\d/.test(a))) {
    const i = spec.lastIndexOf("@");
    pkg.dependencies = { ...pkg.dependencies, [spec.slice(0, i)]: spec.slice(i + 1) };
  }
  await writeFile(file, JSON.stringify(pkg));
  return { exitCode: 0, output: "" };
};

describe("kit ‘shadcn’ (type bestanden)", () => {
  it("zet pakketten, componenten, Tailwind-plugin en alias neer", async () => {
    const dir = await project();
    const r = await applyKit({ packsDir: PACKS, projectDir: dir, kitId: "shadcn", run: npm });
    expect(r.plan.pakketten).toEqual(["radix-ui@1.8.1", "lucide-react@1.74.0", "class-variance-authority@0.7.1", "cn@0.5.2", "tailwindcss@4.3.5", "@tailwindcss/vite@4.3.5", "tw-animate-css@1.4.0"]);
    const vite = await readFile(path.join(dir, "vite.config.ts"), "utf8");
    expect(vite).toContain('import tailwindcss from "@tailwindcss/vite";');
    expect(vite).toContain("plugins: [tailwindcss(), react()]");
    expect(vite).toContain('"@": fileURLToPath(new URL("./src", import.meta.url))');
    expect(JSON.parse(await readFile(path.join(dir, "tsconfig.json"), "utf8")).compilerOptions.paths).toEqual({ "@/*": ["./src/*"] });
    expect(await readFile(path.join(dir, "src/kit/components/dialog.tsx"), "utf8")).toContain(`from "./button"`);
    expect(await readFile(path.join(dir, "src/kit/index.ts"), "utf8")).toContain('import "./components/shadcn.css";');
    expect(await readFile(path.join(dir, "src/kit/tokens.css"), "utf8")).toContain("--primary: #4338ca;");
    expect(await readFile(path.join(dir, "src/kit/tokens.css"), "utf8")).toContain('[data-theme="dark"]');
    expect(await readFile(path.join(dir, "docs/ui-kit.md"), "utf8")).toContain("**Button**");
    expect(await readFile(path.join(dir, "CLAUDE.md"), "utf8")).toContain("@/kit/components");
  });

  it("past de configuratie maar één keer aan, ook bij opnieuw toepassen", async () => {
    const dir = await project();
    await applyKit({ packsDir: PACKS, projectDir: dir, kitId: "shadcn", run: npm });
    await applyKit({ packsDir: PACKS, projectDir: dir, kitId: "shadcn", run: npm });
    const vite = await readFile(path.join(dir, "vite.config.ts"), "utf8");
    expect(vite.match(/tailwindcss\(\)/g)).toHaveLength(1);
    expect(vite.match(/alias:/g)).toHaveLength(1);
    expect(vite.match(/import tailwindcss/g)).toHaveLength(1);
  });

  it("weigert als vite.config.ts niet veilig aan te passen is", async () => {
    const dir = await project();
    await writeFile(path.join(dir, "vite.config.ts"), "export default {};\n");
    await expect(planApply(PACKS, "shadcn", dir)).rejects.toThrow(/defineConfig/);
    const d2 = await project();
    await writeFile(path.join(d2, "vite.config.ts"), 'import { defineConfig } from "vite";\nexport default defineConfig({ server: {} });\n');
    await expect(planApply(PACKS, "shadcn", d2)).rejects.toThrow(/plugins-lijst/);
    const d3 = await project();
    await writeFile(path.join(d3, "tsconfig.json"), '{\n  // opmerking\n  "compilerOptions": {}\n}\n');
    await expect(planApply(PACKS, "shadcn", d3)).rejects.toThrow(/tsconfig\.json/);
    const d4 = await project();
    await writeFile(path.join(d4, "vite.config.ts"), 'import { defineConfig } from "vite";\nexport default defineConfig({ plugins: [], resolve: { dedupe: ["react"] } });\n');
    await expect(planApply(PACKS, "shadcn", d4)).rejects.toThrow(/resolve/);
  });

  it("de kit-check vindt gewone knoppen in een project met deze kit", async () => {
    const dir = await project();
    await applyKit({ packsDir: PACKS, projectDir: dir, kitId: "shadcn", run: npm });
    const cfg = JSON.parse(await readFile(path.join(dir, "design/kit-check.json"), "utf8"));
    expect(cfg.vervangNative.button).toBe("Button");
    expect(cfg.verbodenImports).toContain("@usefragments/");
  });
});
