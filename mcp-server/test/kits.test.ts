import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyKit, attributionIntact, currentKit, detectStack, planApply, tailorProject, type Run } from "../src/kits/apply.js";
import { checkProject } from "../src/kits/check.js";
import { loadKit, validateAll } from "../src/kits/registry.js";
import { kitJsonSchema } from "../src/kits/schema.js";
import { tailorTokens, toCss, toFlutter } from "../src/kits/tokens.js";

const REPO = path.resolve(__dirname, "../..");
const tmps: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "kits-test-"));
  tmps.push(d);
  return d;
}
afterAll(async () => {
  for (const d of tmps) await rm(d, { recursive: true, force: true });
});

/** Een repo-kopie met alleen docs en één kit, om fouten in te kunnen bouwen. */
async function fakeRepo(): Promise<string> {
  const root = await tmp();
  await cp(path.join(REPO, "design-packs"), path.join(root, "design-packs"), { recursive: true });
  await mkdir(path.join(root, "docs"));
  await cp(path.join(REPO, "docs", "kits.md"), path.join(root, "docs", "kits.md"));
  return root;
}
async function editKit(root: string, id: string, f: (k: Record<string, unknown>) => void): Promise<void> {
  const file = path.join(root, "design-packs", id, "kit.json");
  const k = JSON.parse(await readFile(file, "utf8"));
  f(k);
  await writeFile(file, JSON.stringify(k, null, 2));
}

describe("kit-validate", () => {
  it("keurt de meegeleverde kits goed en het schema staat gelijk aan de code", async () => {
    expect(validateAll(REPO)).toEqual([]);
    expect(JSON.parse(await readFile(path.join(REPO, "design-packs", "kit.schema.json"), "utf8"))).toEqual(JSON.parse(JSON.stringify(kitJsonSchema())));
  });

  it("faalt bij een ontbrekend verplicht veld", async () => {
    const root = await fakeRepo();
    await editKit(root, "fragments-ui", (k) => delete k.licentie);
    const i = validateAll(root);
    expect(i.some((x) => x.kit === "fragments-ui" && /licentie/.test(x.message))).toBe(true);
  });

  it("faalt bij een verboden licentie en weigert de kit te laden", async () => {
    const root = await fakeRepo();
    for (const lic of ["GPL-3.0", "UNLICENSED", "CC-BY-NC-4.0", "mit"]) {
      await editKit(root, "fragments-ui", (k) => (k.licentie = lic));
      expect(validateAll(root).some((x) => /niet toegestaan/.test(x.message)), lic).toBe(true);
      expect(() => loadKit(path.join(root, "design-packs"), "fragments-ui")).toThrow(/geweigerd/);
    }
    for (const lic of ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"]) {
      await editKit(root, "fragments-ui", (k) => (k.licentie = lic));
      expect(validateAll(root)).toEqual([]);
    }
  });

  it("faalt bij een niet-vastgezette versie", async () => {
    const root = await fakeRepo();
    for (const v of ["^4.5.0", "~4.5.0", "latest", "4.5", ">=4"]) {
      await editKit(root, "fragments-ui", (k) => (k.versie = v));
      expect(validateAll(root).some((x) => /exacte versie/.test(x.message)), v).toBe(true);
    }
  });

  it("faalt bij een ontbrekend bestand, een verkeerde map-id en een ontbrekende regel in docs/kits.md", async () => {
    const root = await fakeRepo();
    await rm(path.join(root, "design-packs", "fragments-ui", "rules.md"));
    expect(validateAll(root).some((x) => /rules\.md ontbreekt/.test(x.message))).toBe(true);
    const root2 = await fakeRepo();
    const docs = (await readFile(path.join(root2, "docs", "kits.md"), "utf8")).split("\n").filter((l) => !l.includes("`fragments-ui`")).join("\n");
    await writeFile(path.join(root2, "docs", "kits.md"), docs);
    expect(validateAll(root2).some((x) => /register van docs\/kits\.md/.test(x.message))).toBe(true);
    const root3 = await fakeRepo();
    await editKit(root3, "fragments-ui", (k) => (k.id = "iets-anders"));
    expect(validateAll(root3).some((x) => /gelijk zijn aan de mapnaam/.test(x.message))).toBe(true);
  });

  it("faalt bij een tokenverwijzing die niet bestaat en bij onbekende velden", async () => {
    const root = await fakeRepo();
    await editKit(root, "fragments-ui", (k) => ((k.setup as { tokenMap: Record<string, string> }).tokenMap["--x"] = "kleuren.paars"));
    expect(validateAll(root).some((x) => /bestaat niet/.test(x.message))).toBe(true);
    await editKit(root, "fragments-ui", (k) => (k.verrassing = 1));
    expect(validateAll(root).length).toBeGreaterThan(0);
  });

  it("verplichte attributie zonder tekst wordt afgekeurd", async () => {
    const root = await fakeRepo();
    await editKit(root, "fragments-ui", (k) => (k.attributie = { verplicht: true, tekst: "" }));
    expect(validateAll(root).some((x) => /attributie/i.test(x.message))).toBe(true);
  });
});

describe("tokens", () => {
  const packs = path.join(REPO, "design-packs");
  const { kit, tokens } = loadKit(packs, "fragments-ui");

  it("maakt CSS-variabelen uit de tokens", () => {
    const css = toCss(kit, tokens);
    expect(css).toContain("--fui-seed-brand: #3d5ae8;");
    expect(css).toContain("--fui-radius: 5px;");
    expect(css).toContain("--fui-scale: 1;");
  });

  it("past hoofdkleur, afronding, ruimte en lettertype aan, en weigert onzin", () => {
    const t = tailorTokens(tokens, { hoofdkleur: "#FF0066", afronding: "rond", ruimte: "ruim", lettertype: "Georgia, serif" });
    const css = toCss(kit, t);
    expect(css).toContain("--fui-seed-brand: #ff0066;");
    expect(css).toContain("--fui-radius: 16px;");
    expect(css).toContain("--fui-scale: 1.15;");
    expect(css).toContain("--fui-font-sans: Georgia, serif;");
    expect(t.instellingen).toEqual({ afronding: "rond", ruimte: "ruim" });
    expect(tokens.kleuren.licht.primair).toBe("#3d5ae8"); // origineel blijft ongemoeid
    expect(() => tailorTokens(tokens, { hoofdkleur: "rood" })).toThrow(/hoofdkleur/);
    expect(() => tailorTokens(tokens, { lettertype: "x; } body { display:none" })).toThrow(/lettertype/);
    expect(() => tailorTokens(tokens, { afronding: "bol" as never })).toThrow();
  });

  it("CSS-waarden kunnen niet uit hun regel breken", () => {
    const bad = structuredClone(tokens);
    bad.typografie.lettertype = "a; } body { background: red";
    expect(() => toCss(kit, bad)).toThrow(/Ongeldige tokenwaarde/);
  });

  it("maakt een Flutter-thema uit dezelfde tokens", () => {
    const dart = toFlutter(tokens);
    expect(dart).toContain("Color(0xFF3D5AE8)");
    expect(dart).toContain("ThemeData");
    expect(dart).toContain("radiusMidden = 5.0");
  });
});

/** Nep-npm: legt het pakket vast in package.json en laat node_modules met rust. */
function fakeNpm(opts: { failInstall?: boolean; scripts?: string[] } = {}): { run: Run; calls: string[] } {
  const calls: string[] = [];
  const run: Run = async (command, cwd) => {
    calls.push(command);
    if (opts.failInstall && /npm install/.test(command)) return { exitCode: 1, output: "npm ERR! 404 Not Found - GET registry/@usefragments/ui" };
    const pkgFile = path.join(cwd, "package.json");
    const pkg = JSON.parse(await readFile(pkgFile, "utf8"));
    const m = /(?:install|uninstall) .*?((?:@[\w.-]+\/)?[\w.-]+)(?:@([\d.]+))?$/.exec(command);
    if (/npm install/.test(command)) {
      for (const spec of command.split(" ").filter((a) => /^(?:@[\w.-]+\/)?[\w.-]+@\d/.test(a))) {
        const i = spec.lastIndexOf("@");
        pkg.dependencies = { ...pkg.dependencies, [spec.slice(0, i)]: spec.slice(i + 1) };
      }
      const packages: Record<string, unknown> = {};
      for (const s of opts.scripts ?? []) packages[`node_modules/${s}`] = { hasInstallScript: true };
      await writeFile(path.join(cwd, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }));
    } else if (/npm uninstall/.test(command) && m) {
      delete pkg.dependencies?.[m[1]];
    }
    await writeFile(pkgFile, JSON.stringify(pkg, null, 2));
    return { exitCode: 0, output: "" };
  };
  return { run, calls };
}

async function project(): Promise<string> {
  const dir = await tmp();
  await cp(path.join(REPO, "templates", "web-react-vite"), dir, { recursive: true });
  return dir;
}
const PACKS = path.join(REPO, "design-packs");

describe("kit toepassen", () => {
  it("herkent de stack, zet bestanden neer en sluit de app aan op de kit", async () => {
    const dir = await project();
    expect(await detectStack(dir)).toBe("react-vite");
    const { run, calls } = fakeNpm();
    const r = await applyKit({ packsDir: PACKS, projectDir: dir, kitId: "fragments-ui", run });
    expect(calls).toEqual(["npm install --save-exact --ignore-scripts @usefragments/ui@4.5.0"]);
    expect(r.plan.pakketten).toEqual(["@usefragments/ui@4.5.0"]);
    expect(await readFile(path.join(dir, "src/kit/index.ts"), "utf8")).toContain('import "@usefragments/ui/styles";');
    expect(await readFile(path.join(dir, "src/kit/KitProvider.tsx"), "utf8")).toContain("<Theme>{children}</Theme>");
    expect(await readFile(path.join(dir, "src/kit/tokens.css"), "utf8")).toContain("--fui-seed-brand: #3d5ae8;");
    expect(JSON.parse(await readFile(path.join(dir, "design/kit.json"), "utf8"))).toMatchObject({ kit: "fragments-ui", versie: "4.5.0", licentie: "MIT" });
    expect(existsSync(path.join(dir, "design/tokens.json"))).toBe(true);
    expect(JSON.parse(await readFile(path.join(dir, "design/kit-check.json"), "utf8")).vervangNative.button).toBe("Button");
    expect(existsSync(path.join(dir, "design/eslint-kit.mjs"))).toBe(true);
    expect(JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")).dependencies["@usefragments/ui"]).toBe("4.5.0");
    expect((await currentKit(dir))?.kit).toBe("fragments-ui");
  });

  it("voert installatiescripts niet uit en meldt welke pakketten erop wachten", async () => {
    const dir = await project();
    const { run, calls } = fakeNpm({ scripts: ["esbuild"] });
    const r = await applyKit({ packsDir: PACKS, projectDir: dir, kitId: "fragments-ui", run });
    expect(r.scriptsSkipped).toEqual(["esbuild"]);
    expect(calls.every((c) => !/install(?!.*--ignore-scripts)/.test(c) || /uninstall/.test(c))).toBe(true);
    expect(calls[0]).toContain("--ignore-scripts");
  });

  it("meldt een mislukte installatie begrijpelijk en laat de app-bestanden ongemoeid", async () => {
    const dir = await project();
    const before = await readFile(path.join(dir, "src/main.tsx"), "utf8");
    await expect(applyKit({ packsDir: PACKS, projectDir: dir, kitId: "fragments-ui", run: fakeNpm({ failInstall: true }).run })).rejects.toThrow(/Het installeren lukte niet[\s\S]*404/);
    expect(await readFile(path.join(dir, "src/main.tsx"), "utf8")).toBe(before);
    expect(existsSync(path.join(dir, "design/kit.json"))).toBe(false);
    expect(await readFile(path.join(dir, "src/kit/index.ts"), "utf8")).toContain("Zonder kit");
  });

  it("past main.tsx één keer aan, ook als het project er niet uit een template komt", async () => {
    const dir = await project();
    await writeFile(path.join(dir, "src/main.tsx"), 'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.body).render(<App />);\n');
    const { run } = fakeNpm();
    await applyKit({ packsDir: PACKS, projectDir: dir, kitId: "fragments-ui", run });
    await applyKit({ packsDir: PACKS, projectDir: dir, kitId: "fragments-ui", run });
    const main = await readFile(path.join(dir, "src/main.tsx"), "utf8");
    expect(main.match(/KitProvider from/g)).toHaveLength(1);
    expect(main).toContain("<KitProvider>");
    await writeFile(path.join(dir, "src/main.tsx"), "console.log(1);\n");
    await expect(planApply(PACKS, "fragments-ui", dir)).rejects.toThrow(/<App \/>/);
  });

  it("weigert een kit die niet bij de stack past, en een project dat geen React is", async () => {
    const root = await fakeRepo();
    await editKit(root, "fragments-ui", (k) => (k.stacks = ["flutter"]));
    await expect(planApply(path.join(root, "design-packs"), "fragments-ui", await project())).rejects.toThrow(/past niet bij dit project/);
    const leeg = await tmp();
    await expect(planApply(PACKS, "fragments-ui", leeg)).rejects.toThrow(/herkent Studio niet/);
  });

  it("weigert een kit zonder toegestane licentie voordat er iets gebeurt", async () => {
    const root = await fakeRepo();
    await editKit(root, "fragments-ui", (k) => (k.licentie = "GPL-3.0"));
    const dir = await project();
    const { run, calls } = fakeNpm();
    await expect(applyKit({ packsDir: path.join(root, "design-packs"), projectDir: dir, kitId: "fragments-ui", run })).rejects.toThrow(/niet toegestaan/);
    expect(calls).toEqual([]);
    expect(existsSync(path.join(dir, "design"))).toBe(false);
  });

  it("past de tokens aan zonder AI en werkt tokens.css bij", async () => {
    const dir = await project();
    await applyKit({ packsDir: PACKS, projectDir: dir, kitId: "fragments-ui", run: fakeNpm().run });
    await tailorProject(PACKS, dir, { hoofdkleur: "#009966", afronding: "scherp", ruimte: "compact" });
    const css = await readFile(path.join(dir, "src/kit/tokens.css"), "utf8");
    expect(css).toContain("--fui-seed-brand: #009966;");
    expect(css).toContain("--fui-radius: 4px;");
    expect(css).toContain("--fui-scale: 0.875;");
    expect(JSON.parse(await readFile(path.join(dir, "design/tokens.json"), "utf8")).instellingen).toEqual({ afronding: "scherp", ruimte: "compact" });
    await expect(tailorProject(PACKS, await project(), { afronding: "rond" })).rejects.toThrow(/nog geen uiterlijk/);
    await tailorProject(PACKS, dir, {}, true); // terug naar de standaard van de kit
    expect(await readFile(path.join(dir, "src/kit/tokens.css"), "utf8")).toContain("--fui-seed-brand: #3d5ae8;");
    expect(JSON.parse(await readFile(path.join(dir, "design/tokens.json"), "utf8")).instellingen).toBeUndefined();
  });
});

describe("licentie-vermelding", () => {
  it("zet bij verplichte attributie een vermelding in NOTICE.md, laat andere tekst staan en waarschuwt bij weghalen", async () => {
    const root = await fakeRepo();
    await editKit(root, "fragments-ui", (k) => (k.attributie = { verplicht: true, tekst: "Dit uiterlijk is gemaakt door Voorbeeld BV." }));
    const dir = await project();
    await writeFile(path.join(dir, "NOTICE.md"), "# Vermeldingen\n\nEigen tekst.\n");
    await applyKit({ packsDir: path.join(root, "design-packs"), projectDir: dir, kitId: "fragments-ui", run: fakeNpm().run });
    const notice = await readFile(path.join(dir, "NOTICE.md"), "utf8");
    expect(notice).toContain("Eigen tekst.");
    expect(notice).toContain("gemaakt door Voorbeeld BV.");
    expect(await attributionIntact(dir)).toEqual({ required: true, ok: true });
    await writeFile(path.join(dir, "NOTICE.md"), "# Vermeldingen\n\nEigen tekst.\n"); // gebruiker haalt het weg
    expect(await attributionIntact(dir)).toEqual({ required: true, ok: false });
  });

  it("zonder verplichte attributie is er niets om te waarschuwen", async () => {
    const dir = await project();
    await applyKit({ packsDir: PACKS, projectDir: dir, kitId: "fragments-ui", run: fakeNpm().run });
    expect(existsSync(path.join(dir, "NOTICE.md"))).toBe(false);
    expect(await attributionIntact(dir)).toEqual({ required: false, ok: true });
  });
});

describe("kit-check op bewust foute code", () => {
  const BAD_TSX = `import { Button } from "@usefragments/ui";
import { Modal } from "@mui/material";

export function Slecht() {
  return (
    <div style={{ color: "#ff0000", padding: "13px", background: "rgb(1, 2, 3)", fontFamily: "Comic Sans MS" }}>
      <button onClick={() => 1}>Gewone knop</button>
      <input type="text" />
      <select></select>
      <dialog open></dialog>
      <Button>Goede knop</Button>
      <a href="#top">anker</a> Item #123
    </div>
  );
}
`;
  async function proj(files: Record<string, string>): Promise<string> {
    const dir = await project();
    await applyKit({ packsDir: PACKS, projectDir: dir, kitId: "fragments-ui", run: fakeNpm().run });
    for (const [f, c] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, f)), { recursive: true });
      await writeFile(path.join(dir, f), c);
    }
    return dir;
  }

  it("vindt kleuren, pixels, lettertypes, native elementen en andere bibliotheken", async () => {
    const dir = await proj({ "src/components/app/Slecht.tsx": BAD_TSX, "src/components/app/slecht.css": ".a { color: #abc; margin: 12px; border: 1px solid red; font-family: Arial; }\n@media (min-width: 600px) { .a { top: 0px } }" });
    const r = await checkProject(dir);
    const by = (rule: string) => r.findings.filter((f) => f.rule === rule);
    expect(by("kleur").map((f) => f.file + ":" + f.line).sort()).toEqual(["src/components/app/Slecht.tsx:6", "src/components/app/Slecht.tsx:6", "src/components/app/slecht.css:1"]);
    expect(by("pixels").map((f) => f.message).join(" ")).toMatch(/13px/);
    expect(by("pixels").some((f) => f.file.endsWith("slecht.css") && /12px/.test(f.message))).toBe(true);
    expect(by("pixels").some((f) => /\b1px|\b0px|600px/.test(f.message))).toBe(false);
    expect(by("lettertype")).toHaveLength(2);
    expect(by("native").map((f) => f.message.match(/<(\w+)>/)![1])).toEqual(["button", "input", "select", "dialog"]);
    expect(by("native")[0].fix).toBe("Gebruik <Button> uit de kit.");
    expect(by("bibliotheek")).toHaveLength(1);
    expect(r.findings.some((f) => /#top|#123/.test(f.message))).toBe(false); // ankers en "#123" zijn geen kleuren
    expect(r.findings.some((f) => f.line === 12)).toBe(false); // de goede <Button> en het anker
  });

  it("laat goede code, de kit-map en commentaar met rust", async () => {
    const dir = await proj({
      "src/components/app/Goed.tsx": `import { Button, Stack } from "@usefragments/ui";\n// kleur #ff0000 in commentaar\n/* 13px ook */\nexport const Goed = () => <Stack><Button>Ok</Button></Stack>;\n`,
      "src/kit/extra.css": ".x { color: #fff; margin: 13px }",
    });
    const r = await checkProject(dir);
    expect(r.findings).toEqual([]);
    expect(r.scanned).toBeGreaterThan(0);
  });

  it("doet niets zonder gekozen kit en kent de twee strengheden", async () => {
    expect((await checkProject(await project())).enabled).toBe(false);
    const dir = await proj({});
    expect((await checkProject(dir)).strengheid).toBe("waarschuwen");
    const cfgFile = path.join(dir, "design/kit-check.json");
    const cfg = JSON.parse(await readFile(cfgFile, "utf8"));
    await writeFile(cfgFile, JSON.stringify({ ...cfg, strengheid: "blokkeren" }));
    expect((await checkProject(dir)).strengheid).toBe("blokkeren");
  });
});
