// Zuinige uitvoer van de MCP-tools: eerst een korte samenvatting, de volledige log alleen op aanvraag.
import { relevantLines } from "./text.js";
import type { ChecksResult, StepResult } from "./runtime.js";
import type { ConsoleEntry } from "./preview.js";

const BESTAND_REGEL = /((?:[A-Za-z]:)?[\w@./\\-]+\.(?:tsx?|jsx?|mjs|cjs|css|scss|html|dart|vue|svelte|json|sql)):(\d+)(?::(\d+))?/;
const FOUT = /\b(error|errors|failed|failure|fatal|exception|assertion|cannot|unexpected)\b|✖|✗|×|ERR!/i;

/** De eerste echte fout uit een log: bij voorkeur een regel met bestand en regelnummer, anders de eerste foutregel. */
export function eersteFout(regels: string[]): string | null {
  const schoon = regels.map((r) => r.trim()).filter(Boolean);
  const metBestand = schoon.find((r) => BESTAND_REGEL.test(r) && FOUT.test(r)) ?? schoon.find((r) => BESTAND_REGEL.test(r));
  const r = metBestand ?? schoon.find((x) => FOUT.test(x)) ?? schoon[0] ?? null;
  return r && (r.length > 240 ? `${r.slice(0, 240)}…` : r);
}

const WOORD: Record<StepResult["status"], string> = { passed: "geslaagd", failed: "MISLUKT", timeout: "TIJD OVER", skipped: "overgeslagen", warned: "waarschuwing" };

/** Korte samenvatting; met `uitgebreid` de (beperkte) log van elke stap erbij. Geen ingesprongen JSON: dat kost alleen tokens. */
export function samenvattingChecks(r: ChecksResult, uitgebreid = false): string {
  const kop = r.ok ? "ALLE CHECKS GESLAAGD" : "CHECKS MISLUKT";
  const regels = r.steps.map((s) => `- ${s.name}: ${WOORD[s.status]}${s.durationMs >= 1000 ? ` (${Math.round(s.durationMs / 1000)} s)` : ""}`);
  const uit = [kop, ...regels];
  for (const s of r.steps.filter((x) => x.status === "failed" || x.status === "timeout" || x.status === "warned")) {
    const eerste = eersteFout(s.output);
    uit.push(`\nEerste fout bij ${s.name}: ${eerste ?? "(geen uitvoer)"}`);
    const toon = uitgebreid ? s.output : relevantLines(s.output.join("\n"), 12);
    if (toon.length > 1 || uitgebreid) uit.push(toon.join("\n"));
    if (!uitgebreid && s.output.length > toon.length) uit.push(`(${s.output.length - toon.length} regels niet getoond; vraag run_checks met uitgebreid=true voor de hele log)`);
  }
  return uit.join("\n");
}

/** Dezelfde melding vaak achter elkaar? Telt ze samen en toont de eerste gevallen. */
export function ontdubbel(entries: ConsoleEntry[], max = 10): string {
  if (!entries.length) return "Geen console- of netwerkfouten sinds de vorige aanroep.";
  const groepen = new Map<string, { e: ConsoleEntry; n: number }>();
  for (const e of entries) {
    const sleutel = `${e.kind}|${e.text.replace(/\d+/g, "#").slice(0, 200)}`;
    const g = groepen.get(sleutel);
    if (g) g.n++;
    else groepen.set(sleutel, { e, n: 1 });
  }
  const lijst = [...groepen.values()];
  const uit = [`${entries.length} melding(en), ${lijst.length} verschillend:`];
  for (const { e, n } of lijst.slice(0, max)) uit.push(`- [${e.kind}] ${e.text.length > 300 ? `${e.text.slice(0, 300)}…` : e.text}${e.url ? ` (${e.url})` : ""}${n > 1 ? ` — ${n}×` : ""}`);
  if (lijst.length > max) uit.push(`… en ${lijst.length - max} andere meldingen.`);
  return uit.join("\n");
}

/** Dev-logs: de gevraagde staart, maar bij veel regels eerst de foutregels met context. */
export function logsKort(regels: string[], max: number): string[] {
  if (regels.length <= max) return regels;
  return relevantLines(regels.join("\n"), max);
}
