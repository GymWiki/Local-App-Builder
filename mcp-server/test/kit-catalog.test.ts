import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { applyKit, type Run } from "../src/kits/apply.js";
import { buildCatalog, catalogStale, estimateTokens, fitEntries, refreshCatalogIfStale } from "../src/kits/catalog.js";
import { applyBlock, writeKitInstructions } from "../src/kits/instructions.js";
import { loadKit } from "../src/kits/registry.js";
import { setStrictness } from "../src/kits/check.js";
import { Runtime } from "../src/runtime.js";

const REPO = path.resolve(__dirname, "../..");
const PACKS = path.join(REPO, "design-packs");
const tmps: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "kitcat-"));
  tmps.push(d);
  return d;
}
afterAll(async () => {
  for (const d of tmps) await rm(d, { recursive: true, force: true });
});

/** Een klein voorbeeldpakket met fragments.json zoals @usefragments/ui dat levert. */
async function examplePackage(dir: string, version = "4.5.0", count = 3): Promise<void> {
  const pkg = path.join(dir, "node_modules", "@usefragments", "ui");
  await mkdir(pkg, { recursive: true });
  await writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: "@usefragments/ui", version, types: "dist/index.d.ts", exports: { ".": "./dist/index.js", "./chart": "./dist/chart.js" }, peerDependenciesMeta: { recharts: { optional: true } } }));
  const fragments: Record<string, unknown> = {
    Button: {
      meta: { description: "Triggers an action — save, submit, delete, open.", category: "actions" },
      props: { variant: { type: "enum", values: ["solid", "soft", "ghost"], default: '"solid"' }, onClick: { type: "function" }, children: { type: "node" } },
      variants: [{ name: "Solid", code: '<Button variant="solid">Save</Button>', canonical: true }],
    },
    Card: {
      meta: { description: "Container for grouping related content", category: "layout" },
      props: { padding: { type: "enum", values: ["sm", "md"] } },
      ai: { subComponents: ["Header", "Title", "Body"], commonPatterns: ["<Card><Card.Body>{content}</Card.Body></Card>"] },
    },
    Chart: { meta: { description: "Composable chart wrapper for recharts.", category: "display" } },
  };
  for (let i = 0; i < count; i++) {
    fragments[`Extra${i}`] = { meta: { description: "Een zeer lange beschrijving die veel ruimte inneemt. ".repeat(6), category: "display" }, props: Object.fromEntries(Array.from({ length: 8 }, (_, j) => [`prop${j}`, { type: "string" }])), variants: [{ code: `<Extra${i} a="b" c="d" e="f" g="h" />` }] };
  }
  await writeFile(path.join(pkg, "fragments.json"), JSON.stringify({ fragments }));
  await writeFile(path.join(pkg, "tokens.css"), ":root {\n  --fui-bg-primary: #fffefd;\n  --fui-bg-hover: #00000010;\n  --_fui-intern: 1;\n  --fui-text-primary: #1b1916;\n}\n");
}

async function project(): Promise<string> {
  const dir = await tmp();
  await cp(path.join(REPO, "templates", "web-react-vite"), dir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}
const npmOk: Run = async (command, cwd) => {
  const file = path.join(cwd, "package.json");
  const pkg = JSON.parse(await readFile(file, "utf8"));
  pkg.dependencies = { ...pkg.dependencies, "@usefragments/ui": "4.5.0" };
  await writeFile(file, JSON.stringify(pkg));
  return { exitCode: 0, output: "" };
};

describe("catalogus (docs/ui-kit.md)", () => {
  it("maakt een compacte catalogus met importpad, tokens, regels, componenten, delen en voorbeelden", async () => {
    const dir = await project();
    await examplePackage(dir);
    const { kit, tokens } = loadKit(PACKS, "fragments-ui");
    const c = await buildCatalog(dir, kit, tokens, "- Gebruik Button.");
    expect(c.source).toBe("fragments-json");
    expect(c.components).toBe(6);
    expect(c.text).toContain("# UI-kit: Fragments UI (@usefragments/ui 4.5.0)");
    expect(c.text).toContain('Importeer altijd uit `@usefragments/ui`');
    expect(c.text).toContain("| `--fui-seed-brand` | #3d5ae8 |");
    expect(c.text).toContain("- Gebruik Button.");
    expect(c.text).toMatch(/\*\*Button\*\*: Triggers an action/);
    expect(c.text).toContain("Props: variant: solid|soft|ghost =solid");
    expect(c.text).not.toContain("children"); // children/onClick-ruis zit niet in de top van de props, children wordt weggelaten
    expect(c.text).toContain("Delen: Card.Header, Card.Title, Card.Body");
    expect(c.text).toContain("Voorbeeld: `<Card><Card.Body>{content}</Card.Body></Card>`");
    expect(c.text).toContain("**Chart** (extra pakket nodig)");
    expect(c.text).toContain("--fui-bg-primary: #fffefd");
    expect(c.text).not.toContain("--fui-bg-hover");
    expect(c.text).not.toContain("--_fui");
    expect(c.text).toContain("studio:catalogus kit=fragments-ui versie=4.5.0");
  });

  it("blijft onder het tokenbudget door details van minder belangrijke componenten weg te laten", async () => {
    const dir = await project();
    await examplePackage(dir, "4.5.0", 80);
    const { kit, tokens } = loadKit(PACKS, "fragments-ui");
    const small = { ...kit, kitcontext: { ...kit.kitcontext, maxTokens: 1500 } };
    const c = await buildCatalog(dir, small, tokens, "- regel");
    expect(c.tokens).toBeLessThanOrEqual(1700);
    expect(c.text).toMatch(/\*\*Button\*\*/); // belangrijke componenten blijven
    expect(c.components).toBe(83);
    const full = await buildCatalog(dir, kit, tokens, "- regel");
    expect(full.tokens).toBeLessThanOrEqual(kit.kitcontext.maxTokens);
    expect(full.tokens).toBeGreaterThan(c.tokens);
  });

  it("fitEntries geeft de belangrijkste componenten de meeste details", () => {
    const mk = (name: string, category: string) => ({ name, category, description: "x ".repeat(40), extra: false, props: [{ name: "a", type: "string" }], subs: [], example: "<A />" });
    const e = [mk("Button", "actions"), mk("Zzz", "display"), mk("Yyy", "display")];
    const r = fitEntries(e, 200);
    expect(r.tiers.Button).toBeGreaterThanOrEqual(r.tiers.Zzz);
    expect(r.tiers.Zzz).toBeLessThan(3);
  });

  it("valt terug op de typings zonder fragments.json en meldt een niet-geïnstalleerd pakket", async () => {
    const dir = await project();
    const pkg = path.join(dir, "node_modules", "@usefragments", "ui");
    await mkdir(path.join(pkg, "dist"), { recursive: true });
    await writeFile(path.join(pkg, "package.json"), JSON.stringify({ version: "4.5.0", types: "dist/index.d.ts" }));
    await writeFile(path.join(pkg, "dist/index.d.ts"), "export { Button, Card as Kaart, type ButtonProps };\nexport declare const Tabs: unknown;\nexport declare function Menu(): void;");
    const { kit, tokens } = loadKit(PACKS, "fragments-ui");
    const t = await buildCatalog(dir, kit, tokens, "");
    expect(t.source).toBe("typings");
    expect(t.text).toContain("`Button`, `Kaart`, `Menu`, `Tabs`".replace("`Button`, ", "`Button`, ")); expect(t.text).not.toContain("ButtonProps");
    const leeg = await buildCatalog(await project(), kit, tokens, "");
    expect(leeg.source).toBe("geen-pakket");
    expect(leeg.text).toContain("nog niet geïnstalleerd");
  });

  it("wordt vernieuwd als het pakket een andere versie heeft gekregen", async () => {
    const dir = await project();
    await examplePackage(dir);
    await applyKit({ packsDir: PACKS, projectDir: dir, kitId: "fragments-ui", run: npmOk });
    const { kit } = loadKit(PACKS, "fragments-ui");
    expect(await catalogStale(dir, kit)).toBe(false);
    expect(await refreshCatalogIfStale(dir, PACKS, "fragments-ui")).toBe(false);
    await examplePackage(dir, "4.6.0"); // pakket bijgewerkt
    expect(await catalogStale(dir, kit)).toBe(true);
    expect(await refreshCatalogIfStale(dir, PACKS, "fragments-ui")).toBe(true);
    expect(await readFile(path.join(dir, "docs/ui-kit.md"), "utf8")).toContain("versie=4.6.0");
    expect(await catalogStale(dir, kit)).toBe(false);
  });
});

describe("bouwregels in de instructiebestanden en de skill", () => {
  it("applyBlock voegt toe, vervangt en verwijdert alleen het eigen blok en weigert bij kapotte markeringen", () => {
    const a = applyBlock("Mijn tekst\n", "regels A") as string;
    expect(a).toContain("Mijn tekst");
    expect(a).toContain("studio:use-kit:start");
    const b = applyBlock(a, "regels B") as string;
    expect(b).toContain("regels B");
    expect(b).not.toContain("regels A");
    expect(b.match(/studio:use-kit:start/g)).toHaveLength(1);
    expect(applyBlock(b, null)).toBe("Mijn tekst\n");
    expect(applyBlock(null, null)).toBeNull();
    expect(applyBlock("<!-- studio:use-kit:start (x) -->\nhalf", "nieuw")).toBe("skip");
  });

  it("zet de regels in alle drie de bestanden en de skill, laat eigen tekst staan en vervangt het blok bij wisselen", async () => {
    const dir = await project();
    await writeFile(path.join(dir, "CLAUDE.md"), "# Eigen notities\n\nBlijf netjes.\n");
    const { kit } = loadKit(PACKS, "fragments-ui");
    const r = await writeKitInstructions(dir, kit, "- Gebruik Stack voor indeling.");
    expect(r.files).toEqual(["CLAUDE.md", "GEMINI.md", "AGENTS.md", ".claude/skills/use-kit/SKILL.md"]);
    const claude = await readFile(path.join(dir, "CLAUDE.md"), "utf8");
    expect(claude).toContain("Blijf netjes.");
    for (const needle of ["docs/ui-kit.md", "src/components/app/", "node_modules", "@usefragments/ui", "Gebruik Stack voor indeling.", "run_checks"]) expect(claude).toContain(needle);
    const skill = await readFile(path.join(dir, ".claude/skills/use-kit/SKILL.md"), "utf8");
    expect(skill.startsWith("---\nname: use-kit\ndescription:")).toBe(true);
    // wisselen naar een andere kit: oude regels weg
    await writeKitInstructions(dir, { ...kit, naam: "Andere Kit", kitcontext: { ...kit.kitcontext, importPad: "andere-kit" } }, "- Andere regel.");
    const after = await readFile(path.join(dir, "CLAUDE.md"), "utf8");
    expect(after).toContain("Andere Kit");
    expect(after).not.toContain("Gebruik Stack");
    expect(after.match(/studio:use-kit:start/g)).toHaveLength(1);
    // verwijderen
    await writeKitInstructions(dir, null);
    expect(await readFile(path.join(dir, "CLAUDE.md"), "utf8")).toBe("# Eigen notities\n\nBlijf netjes.\n");
    expect(existsSync(path.join(dir, "GEMINI.md"))).toBe(false);
    expect(existsSync(path.join(dir, ".claude"))).toBe(false);
  });

  it("raakt een eigen skill met dezelfde naam niet aan", async () => {
    const dir = await project();
    await mkdir(path.join(dir, ".claude/skills/use-kit"), { recursive: true });
    await writeFile(path.join(dir, ".claude/skills/use-kit/SKILL.md"), "---\nname: use-kit\n---\nMijn eigen skill");
    const { kit } = loadKit(PACKS, "fragments-ui");
    const r = await writeKitInstructions(dir, kit, "");
    expect(r.skipped).toContain(".claude/skills/use-kit/SKILL.md");
    expect(await readFile(path.join(dir, ".claude/skills/use-kit/SKILL.md"), "utf8")).toContain("Mijn eigen skill");
  });

  it("applyKit maakt catalogus en regels aan", async () => {
    const dir = await project();
    await examplePackage(dir);
    const r = await applyKit({ packsDir: PACKS, projectDir: dir, kitId: "fragments-ui", run: npmOk });
    expect(r.catalog).toMatchObject({ source: "fragments-json", components: 6 });
    expect(r.files).toContain("docs/ui-kit.md");
    expect(existsSync(path.join(dir, "AGENTS.md"))).toBe(true);
    expect(estimateTokens(await readFile(path.join(dir, "docs/ui-kit.md"), "utf8"))).toBeLessThan(6000);
  });
});

describe("kit-check als onderdeel van run_checks", () => {
  async function withKit(): Promise<{ dir: string; rt: Runtime }> {
    const dir = await project();
    await applyKit({ packsDir: PACKS, projectDir: dir, kitId: "fragments-ui", run: npmOk });
    await mkdir(path.join(dir, "src/components/app"), { recursive: true });
    await writeFile(path.join(dir, "src/components/app/Slecht.tsx"), 'export const S = () => <button style={{ color: "#ff0000", margin: "13px" }}>Hoi</button>;\n');
    return { dir, rt: new Runtime({ projectDir: dir, projectName: "t" }) };
  }

  it("waarschuwt standaard (status warned, run blijft ok) met regels in gewone taal en een herstelhint", async () => {
    const { rt } = await withKit();
    const r = await rt.runChecks(["kit"]);
    const step = r.steps[0];
    expect(step.name).toBe("kit");
    expect(step.status).toBe("warned");
    expect(r.ok).toBe(true);
    expect(step.output.join("\n")).toMatch(/Slecht\.tsx:1 \[kleur\] Losse kleur #ff0000/);
    expect(step.output.join("\n")).toMatch(/\[native\] Gewone <button>.*Gebruik <Button> uit de kit/);
    await rt.close();
  });

  it("blokkeert als de strengheid op blokkeren staat, en draait niet zonder gekozen kit", async () => {
    const { dir, rt } = await withKit();
    await setStrictness(dir, "blokkeren");
    const r = await rt.runChecks(["kit"]);
    expect(r.steps[0].status).toBe("failed");
    expect(r.ok).toBe(false);
    await expect(setStrictness(await project(), "blokkeren")).rejects.toThrow(/nog geen uiterlijk/);
    await rt.close();
  });

  it("draait standaard mee in run_checks zodra er een kit is en meldt schone code als geslaagd", async () => {
    const dir = await project();
    await applyKit({ packsDir: PACKS, projectDir: dir, kitId: "fragments-ui", run: npmOk });
    const rt = new Runtime({ projectDir: dir, projectName: "t" });
    rt.setPlan({ kind: "node", trusted: true, scripts: {}, needsInstall: false });
    const r = await rt.runChecks();
    expect(r.steps.map((s) => s.name)).toContain("kit");
    expect(r.steps.find((s) => s.name === "kit")?.status).toBe("passed");
    await rt.close();
  });
});
