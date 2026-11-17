import { existsSync } from "node:fs";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Kit } from "./schema.js";

/** Zelfde markeringen als src-tauri/src/instructions.rs, zodat Studio één soort blok kent. */
export const BLOCK_NAME = "use-kit";
const START_PREFIX = `<!-- studio:${BLOCK_NAME}:start`;
const START = `${START_PREFIX} (door Studio beheerd; eigen tekst hierbuiten blijft ongemoeid) -->`;
const END = `<!-- studio:${BLOCK_NAME}:end -->`;
export const FILES = ["CLAUDE.md", "GEMINI.md", "AGENTS.md"] as const;
const SKILL_MARKER = "<!-- studio:managed:use-kit";

/** De vaste bouwregels. Het enige dat per kit verschilt: naam, importpad en de eigen regels van de kit. */
export function rulesText(kit: Kit, kitRules: string): string {
  const pkg = kit.pakketnaam ? ` (${kit.pakketnaam} ${kit.versie})` : "";
  return `## Uiterlijk (UI-kit): ${kit.naam}
Deze app gebruikt de UI-kit **${kit.naam}**${pkg}. Houd je altijd aan deze bouwregels:

1. Gebruik altijd eerst bestaande kitcomponenten. Kijk in \`docs/ui-kit.md\` welke er zijn en importeer ze uit \`${kit.kitcontext.importPad}\`.
2. Nieuwe componenten komen in \`src/components/app/\`. Bouw ze op uit kitcomponenten en alleen tokens (\`design/tokens.json\` → \`src/kit/tokens.css\`): geen losse kleuren, pixelwaarden of lettertypes.
3. Pas kitcomponenten nooit aan in \`node_modules\` en kopieer ze niet. Heb je een variant nodig, maak dan een wrapper in \`src/components/app/\`.
4. Houd naamgeving, spacing en gedrag (hover, focus, uitgeschakeld) gelijk aan de kit.
5. Gebruik geen gewone \`<button>\`, \`<input>\`, \`<select>\`, \`<textarea>\` of \`<dialog>\` als de kit er een component voor heeft, en importeer niets uit andere UI-bibliotheken.
6. Draai na elke wijziging \`run_checks\`. De kit-check meldt afwijkingen; herstel die voordat je klaar bent.

Regels van deze kit:
${kitRules.trim()}`;
}

function skillText(kit: Kit, kitRules: string): string {
  return `---
name: use-kit
description: Gebruik dit bij elke taak die schermen, pagina's of onderdelen bouwt of verandert in deze app. Zorgt dat de gekozen UI-kit (${kit.naam}) consequent wordt gebruikt.
---
<!-- studio:managed:use-kit (door Studio beheerd; wordt vervangen als je van uiterlijk wisselt) -->

${rulesText(kit, kitRules)}
`;
}

const render = (body: string) => `${START}\n${body.trimEnd()}\n${END}\n`;

/** Past het blok toe op de tekst. `body === null` haalt ons blok weg. Geeft `null` terug als de markeringen niet kloppen (dan raken we niets aan). */
export function applyBlock(existing: string | null, body: string | null): string | null | "skip" {
  if (existing === null) return body === null ? null : render(body);
  const s = existing.indexOf(START_PREFIX);
  const e = existing.indexOf(END);
  if (s !== -1 && e !== -1 && e > s) {
    const tail = existing.slice(e + END.length).replace(/^\n/, "");
    if (body !== null) return existing.slice(0, s) + render(body) + tail;
    const head = existing.slice(0, s).replace(/\n+$/, "");
    const rest = tail.replace(/^\n+/, "");
    return head && rest ? `${head}\n\n${rest}` : head ? `${head}\n` : rest;
  }
  if (s !== -1 || e !== -1) return "skip";
  if (body === null) return existing;
  return existing.trim() ? `${existing.trimEnd()}\n\n${render(body)}` : render(body);
}

export interface InstructionResult {
  files: string[];
  skipped: string[];
}

/** Zet de bouwregels van de kit in CLAUDE.md, GEMINI.md en AGENTS.md en maakt de skill `use-kit`. Met `kit = null`: weghalen. */
export async function writeKitInstructions(projectDir: string, kit: Kit | null, kitRules = ""): Promise<InstructionResult> {
  const files: string[] = [];
  const skipped: string[] = [];
  for (const name of FILES) {
    const file = path.join(projectDir, name);
    const existing = existsSync(file) ? await readFile(file, "utf8") : null;
    const next = applyBlock(existing, kit ? rulesText(kit, kitRules) : null);
    if (next === "skip") {
      skipped.push(name);
      continue;
    }
    if (next === null || next === existing) continue;
    if (!next.trim()) await rm(file, { force: true });
    else await writeFile(file, next);
    files.push(name);
  }
  const skill = path.join(projectDir, ".claude", "skills", "use-kit", "SKILL.md");
  const cur = existsSync(skill) ? await readFile(skill, "utf8") : null;
  if (cur !== null && !cur.includes(SKILL_MARKER)) {
    skipped.push(".claude/skills/use-kit/SKILL.md"); // van de gebruiker zelf: niet aanraken
  } else if (kit) {
    await mkdir(path.dirname(skill), { recursive: true });
    await writeFile(skill, skillText(kit, kitRules));
    files.push(".claude/skills/use-kit/SKILL.md");
  } else if (cur !== null) {
    await rm(skill, { force: true });
    for (const d of [path.dirname(skill), path.dirname(path.dirname(skill)), path.dirname(path.dirname(path.dirname(skill)))]) await rmdir(d).catch(() => undefined);
    files.push(".claude/skills/use-kit/SKILL.md");
  }
  return { files, skipped };
}
