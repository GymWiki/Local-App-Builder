import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadKit } from "./registry.js";
import type { Kit, Tokens } from "./schema.js";
import { resolveToken } from "./tokens.js";

/** Grove schatting: 1 token ≈ 3,5 tekens (Nederlands en code). */
export const CHARS_PER_TOKEN = 3.5;
export const estimateTokens = (s: string): number => Math.ceil(s.length / CHARS_PER_TOKEN);

export const CATALOG_FILE = "docs/ui-kit.md";
const HEADER_RE = /<!-- studio:catalogus kit=(\S+) versie=(\S+) -->/;

interface Entry {
  name: string;
  category: string;
  description: string;
  /** Extra pakket nodig (optionele peer-dependency)? */
  extra: boolean;
  core?: boolean;
  props: { name: string; type: string; values?: string[]; def?: string; required?: boolean }[];
  subs: string[];
  example: string;
}

const CATEGORY_ORDER = ["actions", "inputs", "layout", "navigation", "feedback", "overlays", "display", "ai", "utilities"];
/** Voorbeeldcode zonder import-regels (die verwijzen naar de bronmap van het pakket, niet naar het gebruik in een project). */
const cleanExample = (s: string) => oneLine(s.replace(/import\s[^;]*;?/g, " "));
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");

interface FragmentsJson {
  fragments: Record<string, {
    meta?: { description?: string; category?: string };
    props?: Record<string, { type?: string; values?: unknown[]; default?: unknown; required?: boolean }>;
    variants?: { code?: string; canonical?: boolean }[];
    ai?: { subComponents?: string[]; commonPatterns?: string[] };
  }>;
}

/** Componenten met een eigen subpad of optionele peer: vragen een extra pakket. */
function extraSet(pkg: { exports?: Record<string, unknown>; peerDependenciesMeta?: Record<string, { optional?: boolean }> }): Set<string> {
  const names = new Set<string>();
  const hasOptional = Object.keys(pkg.peerDependenciesMeta ?? {}).length > 0;
  if (!hasOptional) return names;
  for (const k of Object.keys(pkg.exports ?? {})) {
    const m = /^\.\/([a-z-]+)$/.exec(k);
    if (m && ["chart", "codeblock", "colorpicker", "datepicker", "data-table", "editor", "markdown", "table"].includes(m[1])) {
      names.add(m[1].replace(/-/g, "").toLowerCase());
    }
  }
  return names;
}

function entriesFromFragments(json: FragmentsJson, extras: Set<string>, core: Set<string>): Entry[] {
  return Object.entries(json.fragments ?? {}).map(([name, f]) => {
    const props = Object.entries(f.props ?? {})
      .filter(([k]) => !["children", "className", "style", "render", "as", "ref"].includes(k))
      .map(([k, p]) => ({ name: k, type: p.type ?? "", values: p.values?.map(String), def: p.default === undefined || p.default === null ? undefined : String(p.default).replace(/^"|"$/g, ""), required: p.required }));
    props.sort((a, b) => Number(!!b.required) - Number(!!a.required) || Number(!!b.values) - Number(!!a.values));
    const example = cleanExample(f.variants?.find((v) => v.canonical)?.code ?? f.ai?.commonPatterns?.[0] ?? f.variants?.[0]?.code ?? "");
    return {
      name,
      category: f.meta?.category ?? "utilities",
      description: oneLine(f.meta?.description ?? ""),
      extra: extras.has(name.toLowerCase()),
      core: core.has(name),
      props,
      subs: (f.ai?.subComponents ?? []).filter((x) => x !== "Root"),
      example,
    };
  });
}

function renderEntry(e: Entry, tier: 1 | 2 | 3): string {
  const head = `- **${e.name}**${e.extra ? " (extra pakket nodig)" : ""}: ${clip(e.description, tier === 1 ? 70 : 110)}`;
  if (tier === 1) return head;
  const props = e.props
    .slice(0, tier === 3 ? 6 : 3)
    .map((p) => `${p.name}${p.required ? "*" : ""}: ${p.values?.length ? p.values.slice(0, 6).join("|") : p.type}${p.def && p.def.length <= 20 ? ` =${p.def}` : ""}`)
    .join("; ");
  const lines = [head];
  if (e.subs.length) lines.push(`  Delen: ${e.subs.slice(0, 8).map((s) => `${e.name}.${s}`).join(", ")}`);
  if (props) lines.push(`  Props: ${props}`);
  if (tier === 3 && e.example) lines.push(`  Voorbeeld: \`${clip(e.example, 170)}\``);
  return lines.join("\n");
}

function renderGroups(sorted: Entry[], tier: Map<string, 0 | 1 | 2 | 3>): string {
  const byCat = new Map<string, Entry[]>();
  for (const e of sorted) byCat.set(e.extra ? "extra" : e.category, [...(byCat.get(e.extra ? "extra" : e.category) ?? []), e]);
  const order = [...CATEGORY_ORDER, "extra"].filter((c) => byCat.has(c));
  for (const c of byCat.keys()) if (!order.includes(c)) order.push(c);
  return order
    .map((c) => {
      const list = byCat.get(c)!;
      const lines = list.filter((e) => tier.get(e.name)! > 0).map((e) => renderEntry(e, tier.get(e.name) as 1 | 2 | 3));
      const names = list.filter((e) => tier.get(e.name) === 0).map((e) => e.name);
      if (names.length) lines.push(`- Ook: ${names.join(", ")}`);
      return `### ${c === "extra" ? "Met extra pakket" : c}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

/** Kiest per component de uitgebreidste weergave zodat het geheel binnen het tokenbudget blijft. */
export function fitEntries(entries: Entry[], budgetChars: number): { text: string; tiers: Record<string, number> } {
  const prio = (e: Entry) => [CATEGORY_ORDER.indexOf(e.category) === -1 ? 99 : CATEGORY_ORDER.indexOf(e.category), e.extra ? 1 : 0] as const;
  const sorted = [...entries].sort((a, b) => Number(!!b.core) - Number(!!a.core) || prio(a)[1] - prio(b)[1] || prio(a)[0] - prio(b)[0] || a.name.localeCompare(b.name));
  const tier = new Map<string, 0 | 1 | 2 | 3>(sorted.map((e) => [e.name, 3]));
  const size = () => render().length;
  const render = () => renderGroups(sorted, tier);
  // Eerst de gewone componenten (achteraan beginnen) omlaag, laag voor laag; de kerncomponenten pas als het echt niet anders kan.
  for (const group of [false, true]) {
    for (const level of [2, 1, 0] as const) {
      for (let i = sorted.length - 1; i >= 0 && size() > budgetChars; i--) {
        if (!!sorted[i].core === group) tier.set(sorted[i].name, level);
      }
    }
  }
  const text = render();
  return { text, tiers: Object.fromEntries(tier) };
}

/** Belangrijkste tokens uit de CSS van het pakket (alleen namen en waarden van de basisrol, geen hover/active). */
function tokenLines(css: string): string[] {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  const out: string[] = [];
  for (const m of root.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) {
    const [, name, value] = m;
    if (name.startsWith("--_") || /-(hover|active|tint|wash|fill)/.test(name) || /on-accent|stroke|opacity|pending/.test(name)) continue;
    out.push(`${name}: ${oneLine(value)}`);
  }
  return out.slice(0, 50);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Namen die `index.d.ts` exporteert (voor kits zonder machineleesbare documentatie). */
async function exportsFromTypings(pkgDir: string, types: string | undefined): Promise<string[]> {
  if (!types) return [];
  try {
    const src = await readFile(path.join(pkgDir, types), "utf8");
    const names = new Set<string>();
    for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(",")) {
        if (/^\s*type\s/.test(part)) continue; // alleen echte componenten, geen typen
        const n = part.trim().split(/\s+as\s+/).pop()!.trim();
        if (/^[A-Z][A-Za-z0-9]*$/.test(n)) names.add(n);
      }
    }
    for (const m of src.matchAll(/export\s+(?:declare\s+)?(?:const|function|class)\s+([A-Z][A-Za-z0-9]*)/g)) names.add(m[1]);
    return [...names].sort();
  } catch {
    return [];
  }
}

async function exportsFromFiles(dir: string): Promise<{ name: string; file: string }[]> {
  const out: { name: string; file: string }[] = [];
  async function walk(d: string): Promise<void> {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (/\.tsx$/.test(e.name)) {
        const src = await readFile(full, "utf8");
        for (const m of src.matchAll(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9]*)/g)) out.push({ name: m[1], file: path.relative(dir, full).split(path.sep).join("/") });
        for (const m of src.matchAll(/export\s+const\s+([A-Z][A-Za-z0-9]*)\s*=/g)) out.push({ name: m[1], file: path.relative(dir, full).split(path.sep).join("/") });
      }
    }
  }
  await walk(dir);
  return out;
}

export interface CatalogResult {
  text: string;
  tokens: number;
  components: number;
  source: "fragments-json" | "typings" | "bestanden" | "geen-pakket";
}

/** Maakt de catalogus (Markdown) voor een kit in een project. Het pakket moet al in node_modules staan (bij type npm). */
export async function buildCatalog(projectDir: string, kit: Kit, tokens: Tokens, rules: string): Promise<CatalogResult> {
  const budgetTokens = kit.kitcontext.maxTokens;
  const version = kit.versie ?? "-";
  const tokenRows = Object.entries(kit.setup.tokenMap).map(([v, p]) => `| \`${v}\` | ${resolveToken(tokens, p)} | ${p} |`);
  const intro = [
    `# UI-kit: ${kit.naam}${kit.pakketnaam ? ` (${kit.pakketnaam} ${version})` : ""}`,
    `<!-- studio:catalogus kit=${kit.id} versie=${version} -->`,
    "Door Studio gemaakt uit het pakket. Niet met de hand aanpassen; het wordt vernieuwd bij een versie-update.",
    "",
    "## Gebruik",
    `- Importeer altijd uit \`${kit.kitcontext.importPad}\`. Nieuwe eigen componenten komen in \`src/components/app/\`.`,
    "- Kleuren, ruimte, afronding en lettertype komen uit tokens (`design/tokens.json` → `src/kit/tokens.css`). Gebruik nooit losse kleuren, pixelwaarden of lettertypes.",
    "- Onderdelen met een punt (zoals `Card.Header`) zijn delen van één component.",
    "",
    "## Tokens van dit project",
    "| Variabele | Waarde | Bron |",
    "|---|---|---|",
    ...tokenRows,
    "",
  ];
  const rulesBlock = ["## Regels van deze kit", rules.trim(), ""];
  const fixed = [...intro, ...rulesBlock].join("\n");
  const pkgForTokens = kit.pakketnaam ? path.join(projectDir, "node_modules", ...kit.pakketnaam.split("/")) : null;
  const css = pkgForTokens ? await readFile(path.join(pkgForTokens, "tokens.css"), "utf8").catch(() => "") : "";
  const tokenLinesList = kit.kitcontext.catalogus === "fragments-json" ? tokenLines(css) : [];
  const tokenSection = tokenLinesList.length ? `\n## Beschikbare tokens (hoofdlijnen)\n\`\`\`css\n${tokenLinesList.join("\n")}\n\`\`\`\n` : "";
  // 5% marge: de schatting van tekens naar tokens is grof.
  const budgetChars = Math.max(1000, Math.floor(budgetTokens * CHARS_PER_TOKEN * 0.95) - fixed.length - tokenSection.length - 200);

  let body = "";
  let components = 0;
  let source: CatalogResult["source"] = "geen-pakket";
  const pkgDir = kit.pakketnaam ? path.join(projectDir, "node_modules", ...kit.pakketnaam.split("/")) : null;

  if (kit.type === "npm" && pkgDir && existsSync(pkgDir)) {
    const pkg = (await readJson<{ types?: string; exports?: Record<string, unknown>; peerDependenciesMeta?: Record<string, { optional?: boolean }> }>(path.join(pkgDir, "package.json"))) ?? {};
    const frags = kit.kitcontext.catalogus === "fragments-json" ? await readJson<FragmentsJson>(path.join(pkgDir, "fragments.json")) : null;
    if (frags?.fragments) {
      const entries = entriesFromFragments(frags, extraSet(pkg), new Set(kit.kitcontext.kern));
      components = entries.length;
      source = "fragments-json";
      body = `## Componenten (${components})\n\`*\` = verplicht. Waarden met | zijn de toegestane keuzes.\n\n${fitEntries(entries, budgetChars).text}\n`;
      body += tokenSection;
    } else {
      const names = await exportsFromTypings(pkgDir, pkg.types);
      components = names.length;
      source = "typings";
      body = `## Componenten uit de typings (${names.length})\n${names.length ? names.map((n) => `\`${n}\``).join(", ") : "Geen exports gevonden; lees de typings van het pakket."}\n\nKijk voor props in \`node_modules/${kit.pakketnaam}/${pkg.types ?? ""}\`.\n`;
    }
  } else if (kit.type === "bestanden") {
    const dir = path.join(projectDir, "src", "kit", "components");
    const found = await exportsFromFiles(dir);
    components = found.length;
    source = "bestanden";
    body = `## Componenten (${found.length}), te vinden in \`src/kit/components/\`\n${found.map((f) => `- **${f.name}** (\`${f.file}\`)`).join("\n")}\n`;
  } else {
    body = "## Componenten\nHet pakket is nog niet geïnstalleerd. Draai `npm install` en vernieuw dit bestand via Studio (Uiterlijk).\n";
  }

  const text = `${fixed}\n${body}`;
  return { text, tokens: estimateTokens(text), components, source };
}

/** Schrijft docs/ui-kit.md in het project. */
export async function writeCatalog(projectDir: string, kit: Kit, tokens: Tokens, rules: string): Promise<CatalogResult> {
  const res = await buildCatalog(projectDir, kit, tokens, rules);
  const file = path.join(projectDir, CATALOG_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, res.text);
  return res;
}

/** Staat de catalogus nog gelijk aan de geïnstalleerde versie van de kit? */
export async function catalogStale(projectDir: string, kit: Kit): Promise<boolean> {
  if (kit.type !== "npm" || !kit.pakketnaam) return false;
  const installed = (await readJson<{ version?: string }>(path.join(projectDir, "node_modules", ...kit.pakketnaam.split("/"), "package.json")))?.version;
  if (!installed) return false; // niet geïnstalleerd: niets om te vernieuwen
  const head = await readFile(path.join(projectDir, CATALOG_FILE), "utf8").catch(() => "");
  const m = HEADER_RE.exec(head);
  return !m || m[1] !== kit.id || m[2] !== installed;
}

/** Vernieuwt de catalogus als de geïnstalleerde versie afwijkt (bijv. de AI of de gebruiker werkte het pakket bij). */
export async function refreshCatalogIfStale(projectDir: string, packsDir: string, kitId: string): Promise<boolean> {
  const { kit, dir } = loadKit(packsDir, kitId);
  if (!(await catalogStale(projectDir, kit))) return false;
  const tokens = await readJson<Tokens>(path.join(projectDir, "design", "tokens.json"));
  if (!tokens) return false;
  const installed = (await readJson<{ version?: string }>(path.join(projectDir, "node_modules", ...kit.pakketnaam!.split("/"), "package.json")))?.version;
  const rules = await readFile(path.join(dir, kit.regels), "utf8").catch(() => "");
  await writeCatalog(projectDir, { ...kit, versie: installed ?? kit.versie }, tokens, rules);
  return true;
}
