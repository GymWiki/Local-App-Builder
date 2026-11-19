import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { isAllowedLicense, KitSchema, TokensSchema, type Kit, type Tokens } from "./schema.js";
import { resolveToken } from "./tokens.js";

export interface LoadedKit {
  dir: string;
  kit: Kit;
  tokens: Tokens;
}

export class KitError extends Error {}

const NOT_ALLOWED = "Toegestaan: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC.";

/** Leest en controleert kit.json en tokens.json van één kit. Gooit een KitError met een begrijpelijke melding. */
export function loadKit(packsDir: string, id: string): LoadedKit {
  const dir = path.join(packsDir, id);
  const kitFile = path.join(dir, "kit.json");
  if (!existsSync(kitFile)) throw new KitError(`${id}: kit.json ontbreekt.`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(kitFile, "utf8"));
  } catch (e) {
    throw new KitError(`${id}: kit.json is geen geldige JSON (${(e as Error).message}).`);
  }
  const parsed = KitSchema.safeParse(raw);
  if (!parsed.success) {
    throw new KitError(`${id}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "kit.json"}: ${i.message}`).join("; ")}`);
  }
  const kit = parsed.data;
  if (kit.id !== id) throw new KitError(`${id}: het veld id (“${kit.id}”) moet gelijk zijn aan de mapnaam.`);
  if (!isAllowedLicense(kit.licentie)) {
    throw new KitError(`${id}: de licentie “${kit.licentie}” is niet toegestaan, dus deze kit wordt geweigerd. ${NOT_ALLOWED}`);
  }
  const tokFile = path.join(dir, kit.tokens);
  if (!existsSync(tokFile)) throw new KitError(`${id}: ${kit.tokens} ontbreekt.`);
  const tp = TokensSchema.safeParse(JSON.parse(readFileSync(tokFile, "utf8")));
  if (!tp.success) throw new KitError(`${id}: ${kit.tokens}: ${tp.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return { dir, kit, tokens: tp.data };
}

/** Alle kits in design-packs/ (mappen die met _ beginnen zijn gedeelde bronnen, geen kits). */
export function listKitIds(packsDir: string): string[] {
  if (!existsSync(packsDir)) return [];
  return readdirSync(packsDir)
    .filter((n) => !n.startsWith("_") && !n.startsWith(".") && statSync(path.join(packsDir, n)).isDirectory())
    .sort();
}

export interface Issue {
  kit: string;
  message: string;
}

/** Staat er een regel voor deze kit in het register van docs/kits.md? */
export function registerHasKit(docs: string, id: string): boolean {
  return docs.split("\n").some((l) => l.startsWith("|") && l.split("|")[1]?.trim().replace(/`/g, "") === id);
}

/** De volledige controle van `npm run kit:validate`. Geeft alle problemen terug (leeg = alles goed). */
export function validateAll(root: string): Issue[] {
  const packs = path.join(root, "design-packs");
  const issues: Issue[] = [];
  const docsFile = path.join(root, "docs", "kits.md");
  const docs = existsSync(docsFile) ? readFileSync(docsFile, "utf8") : "";
  if (!docs) issues.push({ kit: "-", message: "docs/kits.md ontbreekt." });
  for (const id of listKitIds(packs)) {
    const add = (message: string) => issues.push({ kit: id, message });
    let loaded: LoadedKit;
    try {
      loaded = loadKit(packs, id);
    } catch (e) {
      add((e as Error).message.replace(`${id}: `, ""));
      continue;
    }
    const { kit, dir } = loaded;
    for (const f of [kit.regels, kit.preview, kit.voorbeeld]) if (!existsSync(path.join(dir, f))) add(`${f} ontbreekt.`);
    if (kit.type === "bestanden") {
      const comp = path.resolve(packs, kit.componenten!);
      if (!comp.startsWith(packs + path.sep) || !existsSync(comp) || !statSync(comp).isDirectory()) add(`de componenten-map “${kit.componenten}” bestaat niet.`);
    }
    for (const map of [kit.setup.tokenMap, kit.setup.tokenMapDonker]) {
      for (const p of Object.values(map)) {
        try {
          resolveToken(loaded.tokens, p);
        } catch (e) {
          add((e as Error).message);
        }
      }
    }
    if (kit.setup.uitvoer === "css" && Object.keys(kit.setup.tokenMap).length === 0) add("setup.tokenMap is leeg: de tokens zouden nergens naartoe gaan.");
    if (docs && !registerHasKit(docs, id)) add("er staat geen regel voor deze kit in het register van docs/kits.md.");
  }
  return issues;
}
