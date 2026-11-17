import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadKit, KitError, type LoadedKit } from "./registry.js";
import type { Kit, Tokens } from "./schema.js";
import { tailorTokens, toCss, toFlutter, type Tailor } from "./tokens.js";
import { writeCatalog, CATALOG_FILE, type CatalogResult } from "./catalog.js";
import { writeKitInstructions } from "./instructions.js";

export type Stack = "react-vite" | "flutter";

export interface RunResult {
  exitCode: number | null;
  output: string;
}
/** Voert een commando uit in de projectmap. Alleen door ons samengestelde commando's (gevalideerde namen en versies). */
export type Run = (command: string, cwd: string) => Promise<RunResult>;

export interface DesignInfo {
  kit: string;
  naam: string;
  versie: string | null;
  pakketnaam: string | null;
  licentie: string;
  stack: Stack;
}

const exists = (p: string) => existsSync(p);

export async function detectStack(dir: string): Promise<Stack | null> {
  if (exists(path.join(dir, "pubspec.yaml"))) return "flutter";
  try {
    const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    if (all.react && all.vite) return "react-vite";
  } catch {
    /* geen package.json */
  }
  return null;
}

export async function currentKit(dir: string): Promise<DesignInfo | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, "design", "kit.json"), "utf8")) as DesignInfo;
  } catch {
    return null;
  }
}

export interface PlanInfo {
  kitId: string;
  naam: string;
  stack: Stack;
  /** Pakketten die erbij komen (naam@versie). */
  pakketten: string[];
  /** Pakketten die verdwijnen (bij wisselen). */
  verwijderen: string[];
  licentie: string;
  attributieVerplicht: boolean;
  /** Draait het pakket volgens de kit installatiescripts? Dan vraagt Studio eerst bevestiging. */
  installatiescripts: boolean;
  /** Wat er verandert, in gewoon Nederlands. */
  stappen: string[];
}

/** Controleert of de kit past en laat zien wat er zou gebeuren. Schrijft niets. */
export async function planApply(packsDir: string, kitId: string, projectDir: string): Promise<PlanInfo> {
  const { kit } = loadKit(packsDir, kitId); // weigert o.a. niet-toegestane licenties
  const stack = await detectStack(projectDir);
  if (!stack) throw new KitError("Dit project herkent Studio niet als een React-project (Vite) of Flutter-project, dus ik kan er nog geen uiterlijk aan geven.");
  if (!kit.stacks.includes(stack)) {
    throw new KitError(`Deze kit past niet bij dit project. Hij is gemaakt voor: ${kit.stacks.join(", ")}. Dit project is: ${stack}.`);
  }
  if (stack === "react-vite") await checkMainPatchable(projectDir);
  const before = await currentKit(projectDir);
  const pakketten = kit.type === "npm" ? [`${kit.pakketnaam}@${kit.versie}`, ...kit.extraPakketten.map((p) => `${p.naam}@${p.versie}`)] : kit.extraPakketten.map((p) => `${p.naam}@${p.versie}`);
  const verwijderen = before?.pakketnaam && before.kit !== kit.id && before.pakketnaam !== kit.pakketnaam ? [before.pakketnaam] : [];
  return {
    kitId: kit.id,
    naam: kit.naam,
    stack,
    pakketten,
    verwijderen,
    licentie: kit.licentie,
    attributieVerplicht: kit.attributie.verplicht,
    installatiescripts: kit.installatiescripts,
    stappen: kit.installatiestappen,
  };
}

async function checkMainPatchable(dir: string): Promise<void> {
  const main = path.join(dir, "src", "main.tsx");
  if (!exists(main)) throw new KitError("Ik vind src/main.tsx niet, dus ik weet niet waar ik het uiterlijk moet aansluiten.");
  const src = await readFile(main, "utf8");
  if (src.includes("./kit/KitProvider")) return;
  if (!/<App\s*\/>/.test(src)) throw new KitError("Ik kan het uiterlijk niet veilig aansluiten: in src/main.tsx staat geen <App />. Vraag de AI om <KitProvider> om je app heen te zetten.");
}

function providerFile(kit: Kit): string {
  const p = kit.setup.provider;
  if (!p) return `import type { ReactNode } from "react";\n\nexport default function KitProvider({ children }: { children: ReactNode }) {\n  return <>{children}</>;\n}\n`;
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(p.naam)) throw new KitError("Ongeldige providernaam in de kit.");
  const props = Object.entries(p.props)
    .map(([k, v]) => {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(k) || /["\\<>{}\n]/.test(v)) throw new KitError("Ongeldige provider-instelling in de kit.");
      return ` ${k}="${v}"`;
    })
    .join("");
  return `import type { ReactNode } from "react";\nimport { ${p.naam} } from "${p.pakket}";\n\nexport default function KitProvider({ children }: { children: ReactNode }) {\n  return <${p.naam}${props}>{children}</${p.naam}>;\n}\n`;
}

function indexFile(kit: Kit): string {
  const lines = ["// Gemaakt door Studio voor het gekozen uiterlijk. Niet met de hand aanpassen."];
  for (const s of kit.setup.stijlImports) {
    if (/["\n\\]/.test(s)) throw new KitError("Ongeldige stijl-import in de kit.");
    lines.push(`import "${s}";`);
  }
  lines.push(`import "./tokens.css";`);
  for (const [k, v] of Object.entries(kit.setup.rootAttributen)) {
    if (!/^[a-z-]+$/.test(k) || /["\\\n]/.test(v)) throw new KitError("Ongeldig attribuut in de kit.");
    lines.push(`document.documentElement.setAttribute("${k}", "${v}");`);
  }
  return lines.join("\n") + "\n";
}

async function copyTree(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const e of await readdir(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const st = await lstat(src);
    if (st.isSymbolicLink()) throw new KitError(`De kit bevat een snelkoppeling (${e.name}); die kopieer ik niet.`);
    if (st.isDirectory()) await copyTree(src, path.join(to, e.name));
    else if (st.isFile()) await cp(src, path.join(to, e.name));
  }
}

const NOTICE_START = "<!-- studio-kit-attributie:start -->";
const NOTICE_END = "<!-- studio-kit-attributie:end -->";

export function noticeBlock(kit: Kit): string {
  return `${NOTICE_START}\n## Uiterlijk (UI-kit)\n\n${kit.attributie.tekst.trim()}\n\nKit: ${kit.naam}, licentie ${kit.licentie}. Bron: ${kit.bron}\n${NOTICE_END}\n`;
}

/** Zet (of verwijdert) de vermelding in NOTICE.md zonder andere tekst van de gebruiker aan te raken. */
export async function writeNotice(projectDir: string, kit: Kit | null): Promise<void> {
  const file = path.join(projectDir, "NOTICE.md");
  let body = exists(file) ? await readFile(file, "utf8") : "";
  const re = new RegExp(`${NOTICE_START}[\\s\\S]*?${NOTICE_END}\\n?`);
  body = body.replace(re, "");
  if (kit?.attributie.verplicht) body = (body.trim() ? body.trimEnd() + "\n\n" : "# Vermeldingen\n\n") + noticeBlock(kit);
  if (!body.trim() || body.trim() === "# Vermeldingen") {
    await rm(file, { force: true });
    return;
  }
  await writeFile(file, body);
}

/** Staat de verplichte vermelding er nog? (Waarschuwen als de gebruiker die weghaalt.) */
export async function attributionIntact(projectDir: string): Promise<{ required: boolean; ok: boolean }> {
  const info = await currentKit(projectDir);
  if (!info) return { required: false, ok: true };
  const marker = path.join(projectDir, "design", "attributie-verplicht");
  const required = exists(marker);
  if (!required) return { required: false, ok: true };
  const notice = exists(path.join(projectDir, "NOTICE.md")) ? await readFile(path.join(projectDir, "NOTICE.md"), "utf8") : "";
  return { required, ok: notice.includes(NOTICE_START) && notice.includes(NOTICE_END) };
}

export interface ApplyOptions {
  packsDir: string;
  projectDir: string;
  kitId: string;
  run: Run;
  tailor?: Tailor;
}

export interface ApplyResult {
  plan: PlanInfo;
  /** Pakketten met installatiescripts die NIET zijn uitgevoerd (wachten op bevestiging). */
  scriptsSkipped: string[];
  files: string[];
  catalog: Pick<CatalogResult, "tokens" | "components" | "source">;
}

async function lockScripts(dir: string): Promise<Set<string>> {
  try {
    const lock = JSON.parse(await readFile(path.join(dir, "package-lock.json"), "utf8")) as { packages?: Record<string, { hasInstallScript?: boolean }> };
    const out = new Set<string>();
    for (const [p, v] of Object.entries(lock.packages ?? {})) if (v.hasInstallScript && p.includes("node_modules/")) out.add(p.split("node_modules/").pop()!);
    return out;
  } catch {
    return new Set();
  }
}

function fail(what: string, r: RunResult): never {
  const tail = r.output.trim().split("\n").slice(-6).join("\n");
  throw new KitError(`${what} lukte niet.\n${tail}`);
}

/** Past een kit toe op een project: pakketten, tokens, aansluiting. Wacht nooit op bevestiging; installatiescripts blijven uit. */
export async function applyKit(o: ApplyOptions): Promise<ApplyResult> {
  const plan = await planApply(o.packsDir, o.kitId, o.projectDir);
  const loaded = loadKit(o.packsDir, o.kitId);
  const { kit } = loaded;
  const dir = o.projectDir;
  const files: string[] = [];
  const write = async (rel: string, content: string) => {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
    files.push(rel.split(path.sep).join("/"));
  };

  const before = await lockScripts(dir);
  if (plan.verwijderen.length) {
    const r = await o.run(`npm uninstall --ignore-scripts ${plan.verwijderen.join(" ")}`, dir);
    if (r.exitCode !== 0) fail("Het oude uiterlijk verwijderen", r);
  }
  if (plan.pakketten.length) {
    const r = await o.run(`npm install --save-exact --ignore-scripts ${plan.pakketten.join(" ")}`, dir);
    if (r.exitCode !== 0) fail("Het installeren", r);
  }
  const after = await lockScripts(dir);
  const scriptsSkipped = [...after].filter((p) => !before.has(p));

  // Tokens: eigen aanpassingen van de gebruiker (bij wisselen) vervallen niet stilzwijgend: nieuwe kit = nieuwe tokens.
  let tokens: Tokens = loaded.tokens;
  if (o.tailor) tokens = tailorTokens(tokens, o.tailor);
  await write("design/tokens.json", JSON.stringify(tokens, null, 2) + "\n");
  const info: DesignInfo = { kit: kit.id, naam: kit.naam, versie: kit.versie ?? null, pakketnaam: kit.pakketnaam ?? null, licentie: kit.licentie, stack: plan.stack };
  await write("design/kit.json", JSON.stringify(info, null, 2) + "\n");
  if (kit.attributie.verplicht) await write("design/attributie-verplicht", "Deze kit vraagt een vermelding (zie NOTICE.md). Studio waarschuwt als die ontbreekt.\n");
  else await rm(path.join(dir, "design", "attributie-verplicht"), { force: true });
  await writeNotice(dir, kit);
  if (kit.attributie.verplicht) files.push("NOTICE.md");

  await write(
    "design/kit-check.json",
    JSON.stringify({ strengheid: (await currentCheckLevel(dir)) ?? "waarschuwen", vervangNative: kit.kitCheck.vervangNative, verbodenImports: kit.kitCheck.verbodenImports }, null, 2) + "\n",
  );
  for (const f of ["kit-scan.mjs", "eslint-kit.mjs"]) {
    await mkdir(path.join(dir, "design"), { recursive: true });
    await cp(path.join(o.packsDir, "_tools", f), path.join(dir, "design", f));
    files.push(`design/${f}`);
  }

  if (plan.stack === "react-vite") {
    await rm(path.join(dir, "src", "kit", "components"), { recursive: true, force: true });
    await write("src/kit/tokens.css", toCss(kit, tokens));
    await write("src/kit/index.ts", indexFile(kit));
    await write("src/kit/KitProvider.tsx", providerFile(kit));
    if (kit.type === "bestanden") {
      const from = path.resolve(o.packsDir, kit.componenten!);
      if (!from.startsWith(path.resolve(o.packsDir) + path.sep)) throw new KitError("De componenten-map ligt buiten design-packs.");
      await copyTree(from, path.join(dir, "src", "kit", "components"));
      files.push("src/kit/components/");
    }
    await patchMain(dir);
  } else {
    await write("lib/theme/app_theme.dart", toFlutter(tokens));
  }
  // De AI laten aansluiten: catalogus (docs/ui-kit.md) en bouwregels (CLAUDE.md/GEMINI.md/AGENTS.md + skill use-kit).
  const rules = await readFile(path.join(loaded.dir, kit.regels), "utf8").catch(() => "");
  const cat = await writeCatalog(dir, kit, tokens, rules);
  files.push(CATALOG_FILE);
  const ins = await writeKitInstructions(dir, kit, rules);
  files.push(...ins.files);
  return { plan, scriptsSkipped, files, catalog: { tokens: cat.tokens, components: cat.components, source: cat.source } };
}

/** Blijft de gekozen strengheid behouden als je van kit wisselt? Ja. */
async function currentCheckLevel(dir: string): Promise<string | null> {
  try {
    const v = (JSON.parse(await readFile(path.join(dir, "design", "kit-check.json"), "utf8")) as { strengheid?: string }).strengheid;
    return v === "blokkeren" ? "blokkeren" : "waarschuwen";
  } catch {
    return null;
  }
}

async function patchMain(dir: string): Promise<void> {
  const main = path.join(dir, "src", "main.tsx");
  const src = await readFile(main, "utf8");
  if (src.includes("./kit/KitProvider")) return;
  const imports = `import "./kit";\nimport KitProvider from "./kit/KitProvider";\n`;
  const lines = src.split("\n");
  let last = -1;
  lines.forEach((l, i) => {
    if (/^import\s/.test(l)) last = i;
  });
  lines.splice(last + 1, 0, ...imports.trimEnd().split("\n"));
  await writeFile(main, lines.join("\n").replace(/<App\s*\/>/, "<KitProvider>\n      <App />\n    </KitProvider>"));
}

/** Tokens van het project aanpassen (hoofdkleur, afronding, ruimte, lettertype) en de gegenereerde bestanden vernieuwen. */
export async function tailorProject(packsDir: string, projectDir: string, t: Tailor, reset = false): Promise<Tokens> {
  const info = await currentKit(projectDir);
  if (!info) throw new KitError("Dit project heeft nog geen uiterlijk gekozen.");
  const { kit } = loadKit(packsDir, info.kit);
  const cur = reset ? loadKit(packsDir, info.kit).tokens : (JSON.parse(await readFile(path.join(projectDir, "design", "tokens.json"), "utf8")) as Tokens);
  const next = tailorTokens(cur, t);
  await writeFile(path.join(projectDir, "design", "tokens.json"), JSON.stringify(next, null, 2) + "\n");
  if (info.stack === "react-vite") await writeFile(path.join(projectDir, "src", "kit", "tokens.css"), toCss(kit, next));
  else await writeFile(path.join(projectDir, "lib", "theme", "app_theme.dart"), toFlutter(next));
  return next;
}

export type { LoadedKit };
