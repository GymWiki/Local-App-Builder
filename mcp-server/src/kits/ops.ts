import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { applyKit, attributionIntact, currentKit, detectStack, planApply, tailorProject, type PlanInfo, type Run, type Stack } from "./apply.js";
import { KitError, listKitIds, loadKit } from "./registry.js";
import type { Tokens } from "./schema.js";
import { type Tailor } from "./tokens.js";
import type { Checkpoint } from "../git.js";

/** Wat de kit-acties van het project nodig hebben. In de runtime is dit het echte project; in tests een nep. */
export interface KitHost {
  projectDir: string;
  packsDir: string;
  git: {
    checkpoint(message: string): Promise<{ created: boolean; hash?: string }>;
    restore(hash: string): Promise<{ hash: string; unchanged: boolean }>;
    list(limit: number): Promise<Checkpoint[]>;
  };
  run: Run;
  /** Draait de controles van het project (build/lint). `skipped` = reden waarom het niet kon. */
  checks: () => Promise<{ ok: boolean; lines: string[]; skipped?: string }>;
  /** Screenshot van de preview als data-URL, of null als dat nu niet kan. */
  screenshot?: () => Promise<string | null>;
}

export interface KitCard {
  id: string;
  naam: string;
  beschrijving: string;
  label: string;
  licentie: string;
  stacks: string[];
  compatible: boolean;
  attributieVerplicht: boolean;
  pakketten: string[];
  preview: string | null;
  /** Kleuren om te laten zien op de kaart. */
  kleuren: { primair: string; achtergrond: string; tekst: string };
}

export interface KitList {
  stack: Stack | null;
  kits: KitCard[];
  /** Kits die Studio weigert (bijv. licentie), met reden. */
  geweigerd: { id: string; reden: string }[];
}

function previewUrl(file: string): string | null {
  try {
    if (!existsSync(file) || statSync(file).size > 400_000) return null;
    return `data:image/png;base64,${readFileSync(file).toString("base64")}`;
  } catch {
    return null;
  }
}

/** Alle kits voor de kiezer. `stack` = de stack van het project; kits die er niet bij passen zijn niet kiesbaar. */
export async function listKits(packsDir: string, projectDir: string | null, stackHint?: Stack): Promise<KitList> {
  const stack = stackHint ?? (projectDir ? await detectStack(projectDir) : null);
  const kits: KitCard[] = [];
  const geweigerd: KitList["geweigerd"] = [];
  for (const id of listKitIds(packsDir)) {
    try {
      const { kit, tokens, dir } = loadKit(packsDir, id);
      kits.push({
        id,
        naam: kit.naam,
        beschrijving: kit.beschrijving,
        label: kit.label,
        licentie: kit.licentie,
        stacks: kit.stacks,
        compatible: stack ? kit.stacks.includes(stack) : true,
        attributieVerplicht: kit.attributie.verplicht,
        pakketten: kit.type === "npm" ? [`${kit.pakketnaam}@${kit.versie}`, ...kit.extraPakketten.map((p) => `${p.naam}@${p.versie}`)] : kit.extraPakketten.map((p) => `${p.naam}@${p.versie}`),
        preview: previewUrl(path.join(dir, kit.preview)),
        kleuren: { primair: tokens.kleuren.licht.primair, achtergrond: tokens.kleuren.licht.achtergrond, tekst: tokens.kleuren.licht.tekst },
      });
    } catch (e) {
      geweigerd.push({ id, reden: (e as Error).message.replace(`${id}: `, "") });
    }
  }
  return { stack, kits, geweigerd };
}

export interface CurrentInfo {
  kit: { kit: string; naam: string; versie: string | null; licentie: string; stack: Stack } | null;
  tokens: Tokens | null;
  attributie: { required: boolean; ok: boolean };
}

export async function current(projectDir: string): Promise<CurrentInfo> {
  const kit = await currentKit(projectDir);
  let tokens: Tokens | null = null;
  if (kit) {
    try {
      tokens = JSON.parse(await readFile(path.join(projectDir, "design", "tokens.json"), "utf8")) as Tokens;
    } catch {
      tokens = null;
    }
  }
  return { kit, tokens, attributie: await attributionIntact(projectDir) };
}

export type ApplyCode = "ok" | "refused" | "install_failed" | "checks_failed" | "no_repo";

export interface ApplyOutcome {
  ok: boolean;
  code: ApplyCode;
  rolledBack: boolean;
  /** Technische of al-in-gewoon-Nederlands uitleg (voor "Details"). */
  detail?: string;
  plan?: PlanInfo;
  scriptsSkipped: string[];
  /** Waarom de controles na het toepassen niet liepen (bijv. scripts nog niet goedgekeurd). */
  checksSkipped?: string;
  /** Het checkpoint van vóór de wijziging (om terug te kunnen). */
  before?: string;
  /** Het nieuwe checkpoint. */
  version?: string;
  switched: boolean;
  shotBefore?: string | null;
  shotAfter?: string | null;
}

/**
 * Past een kit veilig toe: eerst een checkpoint, dan installeren en instellen, dan de controles.
 * Gaat er iets mis, dan zet Studio alles terug (als nieuwe commit na een back-up; niets gaat verloren).
 */
export async function applyWithSafety(host: KitHost, kitId: string, tailor?: Tailor): Promise<ApplyOutcome> {
  const base: ApplyOutcome = { ok: false, code: "refused", rolledBack: false, scriptsSkipped: [], switched: false };
  // 1. Past de kit en mag hij? (schrijft niets)
  let plan: PlanInfo;
  try {
    plan = await planApply(host.packsDir, kitId, host.projectDir);
  } catch (e) {
    return { ...base, detail: (e as Error).message };
  }
  const prev = await currentKit(host.projectDir);
  base.plan = plan;
  base.switched = !!prev && prev.kit !== kitId;

  // 2. Checkpoint van de huidige staat.
  let before: string;
  try {
    const cp = await host.git.checkpoint(`Voor het nieuwe uiterlijk: ${plan.naam}`);
    before = cp.hash ?? (await host.git.list(1))[0]?.hash;
    if (!before) return { ...base, code: "no_repo", detail: "Er is nog geen versie om naar terug te kunnen. Maak eerst een versie van je project." };
  } catch (e) {
    return { ...base, code: "no_repo", detail: (e as Error).message };
  }
  base.before = before;
  base.shotBefore = host.screenshot ? await host.screenshot().catch(() => null) : null;

  const rollback = async (code: ApplyCode, detail: string, extra: Partial<ApplyOutcome> = {}): Promise<ApplyOutcome> => {
    try {
      await host.git.restore(before);
    } catch (e) {
      detail += `\nTerugzetten lukte niet automatisch: ${(e as Error).message}`;
      return { ...base, ...extra, code, detail, rolledBack: false };
    }
    return { ...base, ...extra, code, detail, rolledBack: true };
  };

  // 3. Toepassen.
  let result;
  try {
    result = await applyKit({ packsDir: host.packsDir, projectDir: host.projectDir, kitId, run: host.run, tailor });
  } catch (e) {
    const msg = (e as Error).message;
    return rollback(/lukte niet/.test(msg) ? "install_failed" : "refused", msg);
  }

  // 4. Controles (build/lint). Kunnen ze niet draaien, dan melden we dat; mislukken ze, dan terugdraaien.
  const checks = await host.checks().catch((e) => ({ ok: false, lines: [(e as Error).message] as string[], skipped: undefined }));
  if (!checks.skipped && !checks.ok) return rollback("checks_failed", checks.lines.slice(0, 20).join("\n"));

  // 5. Vastleggen.
  const saved = await host.git.checkpoint(`Nieuw uiterlijk: ${plan.naam}`).catch(() => ({ created: false, hash: undefined }));
  const after = host.screenshot ? await host.screenshot().catch(() => null) : null;
  return {
    ...base,
    ok: true,
    code: "ok",
    scriptsSkipped: result.scriptsSkipped,
    checksSkipped: checks.skipped,
    version: saved.hash,
    shotAfter: after,
  };
}

/** Pakketinstallatiescripts uitvoeren, nadat de gebruiker dat heeft bevestigd. */
export async function runScripts(host: Pick<KitHost, "projectDir" | "run">, packages: string[]): Promise<{ ok: boolean; detail?: string }> {
  const ok = packages.every((p) => /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(p));
  if (!ok || packages.length === 0 || packages.length > 50) throw new KitError("Ongeldige pakketnamen.");
  const r = await host.run(`npm rebuild ${packages.join(" ")}`, host.projectDir);
  return r.exitCode === 0 ? { ok: true } : { ok: false, detail: r.output.trim().split("\n").slice(-6).join("\n") };
}

export async function tailor(host: Pick<KitHost, "projectDir" | "packsDir">, t: Tailor): Promise<Tokens> {
  return tailorProject(host.packsDir, host.projectDir, t);
}
