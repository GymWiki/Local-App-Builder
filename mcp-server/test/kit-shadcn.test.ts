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

describe("startkits (neutraal, warm, zakelijk) en Material voor Flutter", () => {
  it("de drie webkits delen de componenten maar hebben een eigen thema, en de kiezer toont ze allemaal", async () => {
    const { listKits } = await import("../src/kits/ops.js");
    const dir = await project();
    const l = await listKits(PACKS, dir);
    const ids = l.kits.map((k) => k.id);
    for (const id of ["fragments-ui", "shadcn", "shadcn-neutraal", "shadcn-warm", "shadcn-zakelijk"]) expect(ids).toContain(id);
    expect(l.kits.filter((k) => k.compatible).length).toBeGreaterThanOrEqual(5);
    expect(l.kits.find((k) => k.id === "material-flutter")!.compatible).toBe(false); // past niet bij een React-project
    const css: Record<string, string> = {};
    for (const id of ["shadcn-neutraal", "shadcn-warm", "shadcn-zakelijk"]) {
      const d = await project();
      await applyKit({ packsDir: PACKS, projectDir: d, kitId: id, run: npm });
      css[id] = await readFile(path.join(d, "src/kit/tokens.css"), "utf8");
      expect(await readFile(path.join(d, "src/kit/components/button.tsx"), "utf8")).toContain("buttonVariants");
    }
    expect(new Set(Object.values(css)).size).toBe(3);
    expect(css["shadcn-warm"]).toContain("--radius: 28px;");
    expect(css["shadcn-zakelijk"]).toContain("--radius: 6px;");
    expect(css["shadcn-neutraal"]).toContain("--primary: #3f3f46;");
  });

  it("wisselt tussen twee webkits: tokens vervangen, dezelfde componenten blijven", async () => {
    const dir = await project();
    await applyKit({ packsDir: PACKS, projectDir: dir, kitId: "shadcn-neutraal", run: npm });
    await applyKit({ packsDir: PACKS, projectDir: dir, kitId: "shadcn-warm", run: npm });
    const css = await readFile(path.join(dir, "src/kit/tokens.css"), "utf8");
    expect(css).toContain("--primary: #c2410c;");
    expect(css).not.toContain("#3f3f46");
    expect(JSON.parse(await readFile(path.join(dir, "design/kit.json"), "utf8")).kit).toBe("shadcn-warm");
    expect((await readFile(path.join(dir, "CLAUDE.md"), "utf8")).match(/studio:use-kit:start/g)).toHaveLength(1);
    expect(await readFile(path.join(dir, "CLAUDE.md"), "utf8")).toContain("Warm en speels");
  });

  async function flutterProject(): Promise<string> {
    const d = await mkdtemp(path.join(tmpdir(), "flutterkit-"));
    tmps.push(d);
    await writeFile(path.join(d, "pubspec.yaml"), "name: x\n");
    return d;
  }

  it("past Material toe op een Flutter-project: thema, catalogus en Flutter-regels, zonder pakketten", async () => {
    const dir = await flutterProject();
    const calls: string[] = [];
    const r = await applyKit({ packsDir: PACKS, projectDir: dir, kitId: "material-flutter", run: async (c) => (calls.push(c), { exitCode: 0, output: "" }) });
    expect(calls).toEqual([]);
    expect(r.plan.pakketten).toEqual([]);
    const dart = await readFile(path.join(dir, "lib/theme/app_theme.dart"), "utf8");
    expect(dart).toContain("Color(0xFF6750A4)");
    expect(dart).toContain("ThemeData");
    const cat = await readFile(path.join(dir, "docs/ui-kit.md"), "utf8");
    expect(cat).toContain("FilledButton");
    expect(cat).toContain("lib/widgets/app/");
    expect(cat).not.toContain("src/components/app");
    const claude = await readFile(path.join(dir, "CLAUDE.md"), "utf8");
    expect(claude).toContain("lib/widgets/app/");
    expect(claude).toContain("AppTheme.licht()");
    expect(claude).not.toContain("node_modules");
    expect(JSON.parse(await readFile(path.join(dir, "design/kit.json"), "utf8"))).toMatchObject({ kit: "material-flutter", licentie: "BSD-3-Clause", stack: "flutter" });
  });

  it("weigert webkits op een Flutter-project en Material op een React-project", async () => {
    await expect(planApply(PACKS, "shadcn", await flutterProject())).rejects.toThrow(/past niet bij dit project/);
    await expect(planApply(PACKS, "material-flutter", await project())).rejects.toThrow(/past niet bij dit project/);
  });
});
