import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { DevServer, type DevStatus } from "./dev.js";
import { initConfig, loadConfig, type StudioConfig } from "./config.js";
import { Git } from "./git.js";
import { PreviewObserver } from "./preview.js";
import { runCommand } from "./proc.js";
import { checkHtml, checkLinks } from "./static-checks.js";
import { relevantLines } from "./text.js";
import { checkProject, setStrictness } from "./kits/check.js";
import { refreshCatalogIfStale } from "./kits/catalog.js";
import { applyWithSafety, current as kitCurrent, listKits, runScripts, tailor as kitTailor, type KitHost } from "./kits/ops.js";
import type { Tailor } from "./kits/tokens.js";

export type CheckName = "lint" | "build" | "test" | "kit" | "html" | "links" | "console";
export const CHECK_ORDER: CheckName[] = ["lint", "build", "test", "kit", "html", "links", "console"];
const COMMAND_CHECKS = ["lint", "build", "test"] as const;

/** Wat Studio (de app) over het project heeft gedetecteerd. Wordt bij elke wijziging opnieuw doorgegeven. */
export interface PlanPush {
  kind: "empty" | "static" | "node" | "config" | "flutter" | "unsupported";
  entry?: string | null;
  staticRoot?: string | null;
  devScript?: "dev" | "start" | null;
  scripts?: { dev?: string | null; start?: string | null; lint?: string | null; build?: string | null; test?: string | null };
  /** De gebruiker (of de eerste keer: Studio) heeft precies deze package.json-scripts goedgekeurd. */
  trusted?: boolean;
  staticUrl?: string | null;
  needsInstall?: boolean;
}

export interface StepResult {
  name: CheckName;
  command?: string;
  status: "passed" | "failed" | "timeout" | "skipped" | "warned";
  exitCode: number | null;
  durationMs: number;
  output: string[];
}

export interface ChecksResult {
  ok: boolean;
  at: string;
  steps: StepResult[];
}

export type Emit = (event: Record<string, unknown>) => void;

export interface RuntimeOptions {
  projectDir: string;
  projectName: string;
  emit?: Emit;
  readyTimeoutMs?: number;
  /** Hoe lang een toestemmingsvraag openstaat voordat ze als ‘nee’ verloopt (standaard 10 minuten). */
  permissionTimeoutMs?: number;
}

export class Runtime {
  readonly projectDir: string;
  readonly projectName: string;
  readonly git: Git;
  readonly dev: DevServer;
  readonly observer: PreviewObserver;
  private trustedHash: string | null = null;
  private plan: PlanPush | null = null;
  private last: ChecksResult | null = null;
  private checking: AbortController | null = null;
  private readonly emit: Emit;
  private readonly permissionTimeoutMs: number;
  private readonly permissions = new Map<string, (r: { allow: boolean; message?: string }) => void>();

  constructor(o: RuntimeOptions) {
    this.projectDir = o.projectDir;
    this.projectName = o.projectName;
    this.emit = o.emit ?? (() => undefined);
    this.permissionTimeoutMs = o.permissionTimeoutMs ?? 10 * 60 * 1000;
    this.git = new Git(o.projectDir);
    this.dev = new DevServer({
      cwd: o.projectDir,
      readyTimeoutMs: o.readyTimeoutMs,
      resolve: async () => {
        const command = await this.commandFor("dev");
        if (!command) throw new Error("Er is geen dev-commando: geen ‘dev’/‘start’-script en geen \"dev\" in studio.json.");
        const url = (await this.configUrl()) ?? undefined;
        return { command, url };
      },
      onChange: (s) => this.emit({ event: "dev", ...s }),
    });
    this.observer = new PreviewObserver(() => this.previewUrl());
  }

  setTrustedHash(hash: string | null): void {
    this.trustedHash = hash;
  }

  getPlan(): PlanPush | null {
    return this.plan;
  }

  setPlan(plan: PlanPush | null): void {
    this.plan = plan;
  }

  /** studio.json (indien aanwezig en geldig). Een kapot bestand is een fout, een ontbrekend bestand niet. */
  private async studioConfig(): Promise<{ config: StudioConfig; hash: string | null }> {
    const l = await loadConfig(this.projectDir);
    if (l.exists && !l.config) throw new Error(`studio.json is ongeldig: ${l.error ?? "onbekende fout"}`);
    return { config: l.config ?? {}, hash: l.hash };
  }

  private async configUrl(): Promise<string | null> {
    return (await this.studioConfig()).config.previewUrl ?? null;
  }

  /** De URL waar de preview draait: studio.json, anders de statische server of de poort die uit de dev-uitvoer kwam. */
  async previewUrl(): Promise<string> {
    const url = (await this.configUrl()) ?? this.plan?.staticUrl ?? this.dev.status().url;
    if (!url) throw new Error("De preview draait niet (er is geen URL). Open de Preview-tab in Studio of maak een index.html / dev-script aan.");
    return url;
  }

  /**
   * Het commando voor `dev`, `lint`, `build` of `test`: studio.json is leidend, anders het npm-script uit package.json.
   * Het commando draait alleen als de bron is goedgekeurd (studio.json: exacte inhoud; package.json: door Studio bijgehouden).
   */
  private async commandFor(name: "dev" | CheckName): Promise<string | null> {
    if (name !== "dev" && !(COMMAND_CHECKS as readonly string[]).includes(name)) return null;
    const { config, hash } = await this.studioConfig();
    const own = (config as Record<string, unknown>)[name];
    if (typeof own === "string") {
      if (!hash || hash !== this.trustedHash) {
        throw new Error(
          "studio.json is nieuw of gewijzigd en nog niet goedgekeurd door de gebruiker. Vraag de gebruiker om in de Preview-tab op ‘Vertrouwen’ te klikken.",
        );
      }
      return own;
    }
    const p = this.plan;
    const script = name === "dev" ? p?.devScript : p?.scripts?.[name as "lint" | "build" | "test"] ? name : null;
    if (!script || (p?.kind !== "node" && p?.kind !== "static")) return null;
    if (!p.trusted) {
      throw new Error(
        "De scripts in package.json zijn gewijzigd en nog niet goedgekeurd door de gebruiker. Vraag de gebruiker om in de Preview-tab op ‘Vertrouwen’ te klikken.",
      );
    }
    return `npm run ${script}`;
  }

  private staticRoot(): string | null {
    const p = this.plan;
    return p?.kind === "static" ? path.join(this.projectDir, p.staticRoot ?? "") : null;
  }

  /** Start de dev-server als dat kan en mag; geeft anders de reden terug (voor een duidelijke melding in de UI). */
  async autostart(): Promise<{ started: boolean; reason?: string; detail?: string }> {
    const st = this.dev.status().state;
    if (st === "starting" || st === "running") return { started: false, reason: "already_running" };
    if (this.plan?.needsInstall) return { started: false, reason: "deps_missing" };
    try {
      const command = await this.commandFor("dev");
      if (!command) return { started: false, reason: "no_dev" };
      await this.dev.start();
      return { started: true };
    } catch (e) {
      const msg = (e as Error).message;
      if (/goedgekeurd/.test(msg)) return { started: false, reason: "untrusted", detail: msg };
      throw e;
    }
  }

  async installDeps(): Promise<{ ok: boolean; output: string[] }> {
    const has = (f: string) => existsSync(path.join(this.projectDir, f));
    const cmd = has("pnpm-lock.yaml") ? "pnpm install" : has("yarn.lock") ? "yarn install" : "npm install";
    const r = await runCommand(cmd, this.projectDir, 10 * 60 * 1000);
    const output = relevantLines(r.output, 60);
    if (r.exitCode !== 0) throw new Error(`${cmd} mislukte${r.timedOut ? " (time-out)" : ""}:\n${output.join("\n")}`);
    return { ok: true, output };
  }

  async runChecks(steps?: CheckName[]): Promise<ChecksResult> {
    if (this.checking) throw new Error("Er loopt al een check-run. Wacht tot die klaar is.");
    const sRoot = this.staticRoot();
    const { config } = await this.studioConfig();
    const hasCommand = (n: CheckName) => typeof (config as Record<string, unknown>)[n] === "string" || !!this.plan?.scripts?.[n as "lint" | "build" | "test"];
    const anyCommand = COMMAND_CHECKS.some(hasCommand);
    // Standaard: lint/build/test; in een statisch project zonder eigen scripts: html, links en console.
    const kitOn = existsSync(path.join(this.projectDir, "design", "kit-check.json"));
    const base: CheckName[] = anyCommand ? [...COMMAND_CHECKS] : sRoot ? ["html", "links", "console"] : [...COMMAND_CHECKS];
    const defaults: CheckName[] = kitOn ? [...base, "kit"] : base;
    const wanted = CHECK_ORDER.filter((n) => (steps ?? defaults).includes(n));
    const runnable = wanted.some((n) => (COMMAND_CHECKS as readonly string[]).includes(n) ? hasCommand(n) : n === "console" ? true : n === "kit" ? kitOn : !!sRoot);
    if (!runnable) {
      throw new Error("Geen checks beschikbaar: er is geen lint-, build- of test-script, en dit is geen statisch project (index.html).");
    }
    const ac = new AbortController();
    this.checking = ac;
    const timeoutMs = (config.timeoutSec ?? 300) * 1000;
    const results: StepResult[] = [];
    const skip = (name: CheckName, why: string) =>
      results.push({ name, status: "skipped", exitCode: null, durationMs: 0, output: [why] });
    try {
      for (const name of wanted) {
        if ((COMMAND_CHECKS as readonly string[]).includes(name)) {
          if (!hasCommand(name)) {
            skip(name, "Niet ingesteld (geen script in package.json of studio.json).");
            continue;
          }
          const command = (await this.commandFor(name))!;
          const r = await runCommand(command, this.projectDir, timeoutMs, ac.signal);
          const status = r.timedOut ? "timeout" : r.exitCode === 0 ? "passed" : "failed";
          const output = status === "passed" ? [] : relevantLines(r.output, 200).concat(r.timedOut ? [`[time-out na ${timeoutMs / 1000} s]`] : []);
          results.push({ name, command, status, exitCode: r.exitCode, durationMs: r.durationMs, output });
          if (r.aborted) break;
          continue;
        }
        const t0 = Date.now();
        if (name === "kit") {
          if (!kitOn) {
            skip(name, "Nog geen uiterlijk (UI-kit) gekozen.");
            continue;
          }
          const r = await checkProject(this.projectDir);
          const lines = r.findings.slice(0, 50).map((f) => `${f.file}:${f.line} [${f.rule}] ${f.message} ${f.fix}`);
          if (r.findings.length > 50) lines.push(`… en ${r.findings.length - 50} meer`);
          const status = r.findings.length === 0 ? "passed" : r.strengheid === "blokkeren" ? "failed" : "warned";
          results.push({ name, status, exitCode: null, durationMs: Date.now() - t0, output: lines });
          continue;
        }
        if (name !== "console" && !sRoot) {
          skip(name, "Alleen voor statische projecten (index.html).");
          continue;
        }
        let outcome: { ok: boolean; lines: string[]; skipped?: boolean };
        try {
          if (name === "html") outcome = await checkHtml(sRoot!, this.plan?.entry ?? "index.html");
          else if (name === "links") outcome = await checkLinks(sRoot!);
          else {
            const errors = await this.observer.consoleErrors(true);
            outcome = { ok: errors.length === 0, lines: errors.map((e) => `[${e.kind}] ${e.text}`).slice(0, 100) };
          }
        } catch (e) {
          const msg = (e as Error).message;
          outcome = /^Geen browser/.test(msg) ? { ok: true, skipped: true, lines: [msg] } : { ok: false, lines: [msg] };
        }
        results.push({
          name,
          status: outcome.skipped ? "skipped" : outcome.ok ? "passed" : "failed",
          exitCode: null,
          durationMs: Date.now() - t0,
          output: outcome.ok && !outcome.skipped ? [] : outcome.lines,
        });
      }
    } finally {
      this.checking = null;
    }
    const res: ChecksResult = { ok: results.every((s) => s.status === "passed" || s.status === "skipped" || s.status === "warned"), at: new Date().toISOString(), steps: results };
    this.last = res;
    this.emit({ event: "checks", ok: res.ok, at: res.at, steps: res.steps.map((s) => ({ ...s, output: s.output.slice(0, 40) })) });
    return res;
  }

  lastChecks(): ChecksResult | null {
    return this.last;
  }

  private packsDir(args: Record<string, unknown>): string {
    const p = typeof args.packs === "string" ? args.packs : "";
    if (!path.isAbsolute(p) || !existsSync(p)) throw new Error("De kit-bibliotheek (design-packs) is niet gevonden.");
    return p;
  }

  private kitHost(args: Record<string, unknown>): KitHost {
    return {
      projectDir: this.projectDir,
      packsDir: this.packsDir(args),
      git: this.git,
      run: async (command, cwd) => {
        const r = await runCommand(command, cwd, 10 * 60 * 1000);
        return { exitCode: r.timedOut ? null : r.exitCode, output: r.output };
      },
      checks: async () => {
        try {
          const r = await this.runChecks(["lint", "build"]);
          const bad = r.steps.filter((x) => x.status === "failed" || x.status === "timeout");
          return { ok: bad.length === 0, lines: bad.flatMap((x) => [`[${x.name}]`, ...x.output.slice(0, 20)]) };
        } catch (e) {
          const msg = (e as Error).message;
          if (/Geen checks|goedgekeurd|loopt al/.test(msg)) return { ok: true, lines: [], skipped: msg };
          throw e;
        }
      },
      screenshot: async () => {
        const shot = await this.observer.screenshot({});
        return `data:image/jpeg;base64,${shot.data.toString("base64")}`;
      },
    };
  }

  /** Antwoorden op commando's die de app (UI) via stdin stuurt. Alleen deze lijst is bereikbaar. */
  async control(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
    switch (cmd) {
      case "config.get": {
        const l = await loadConfig(this.projectDir);
        return { ...l, trusted: !!l.hash && l.hash === this.trustedHash };
      }
      case "permission.answer":
        this.answerPermission(String(args.id ?? ""), args.allow === true, typeof args.message === "string" ? args.message : undefined);
        return { ok: true };
      case "plan.set":
        this.plan = (args && typeof args === "object" ? (args as unknown as PlanPush) : null) ?? null;
        return { ok: true };
      case "plan.get":
        return this.plan;
      case "dev.autostart":
        return this.autostart();
      case "deps.install":
        return this.installDeps();
      case "config.init":
        await mkdir(this.projectDir, { recursive: true });
        return { created: await initConfig(this.projectDir) };
      case "trust.set":
        this.trustedHash = typeof args.hash === "string" ? args.hash : null;
        return { ok: true };
      case "dev.start":
        return this.dev.start();
      case "dev.stop":
        return this.dev.stop();
      case "dev.restart":
        return this.dev.restart();
      case "dev.status":
        return this.dev.status();
      case "dev.logs":
        return this.dev.logs.last(Number(args.lines) || 200);
      case "checks.run":
        return this.runChecks(Array.isArray(args.steps) ? (args.steps as CheckName[]) : undefined);
      case "checks.last":
        return this.last;
      case "git.list":
        return this.git.list(Number(args.limit) || 30);
      case "git.status":
        return { status: await this.git.status(), dirty: await this.git.isDirty() };
      case "git.checkpoint": {
        const r = await this.git.checkpoint(String(args.message ?? ""));
        this.emit({ event: "git" });
        return r;
      }
      case "git.restore": {
        const r = await this.git.restore(String(args.hash ?? ""));
        this.emit({ event: "git" });
        return r;
      }
      case "kit.list":
        return listKits(this.packsDir(args), this.projectDir, args.stack === "react-vite" || args.stack === "flutter" ? args.stack : undefined);
      case "kit.current": {
        const cur = await kitCurrent(this.projectDir);
        // Is het pakket bijgewerkt sinds de catalogus werd gemaakt? Dan vernieuwen.
        if (cur.kit && typeof args.packs === "string") await refreshCatalogIfStale(this.projectDir, this.packsDir(args), cur.kit.kit).catch(() => false);
        return cur;
      }
      case "kit.check":
        return checkProject(this.projectDir);
      case "kit.strictness":
        return setStrictness(this.projectDir, args.level === "blokkeren" ? "blokkeren" : "waarschuwen");
      case "kit.apply": {
        const out = await applyWithSafety(this.kitHost(args), String(args.kit ?? ""), (args.tailor as Tailor | undefined) ?? undefined);
        this.emit({ event: "git" });
        return out;
      }
      case "kit.scripts":
        return runScripts(this.kitHost(args), Array.isArray(args.packages) ? args.packages.map(String) : []);
      case "kit.tailor":
        return kitTailor(this.kitHost(args), (args.tailor as Tailor) ?? {});
      default:
        throw new Error(`Onbekend commando: ${cmd}`);
    }
  }

  /**
   * Een toestemmingsvraag van de AI-CLI (`--permission-prompt-tool`). De app beslist (automatisch of via een dialoog);
   * zonder antwoord binnen de tijd of bij sluiten wordt het ‘nee’.
   */
  requestPermission(toolName: string, input: unknown, toolUseId?: string): Promise<{ allow: boolean; message?: string }> {
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.permissions.delete(id)) {
          this.emit({ event: "permission_expired", id });
          resolve({ allow: false, message: "Er kwam geen antwoord van de gebruiker; de actie is niet uitgevoerd." });
        }
      }, this.permissionTimeoutMs);
      timer.unref();
      this.permissions.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      const json = JSON.stringify(input ?? {});
      this.emit({ event: "permission_request", id, tool_name: toolName, tool_use_id: toolUseId ?? null, input: json.length > 20_000 ? { truncated: true } : input ?? {} });
    });
  }

  answerPermission(id: string, allow: boolean, message?: string): void {
    const done = this.permissions.get(id);
    if (!done) throw new Error("Onbekende of al beantwoorde toestemmingsvraag.");
    this.permissions.delete(id);
    done({ allow, message });
  }

  /** Stopt alles wat dit project draait: checks, dev-server en de onzichtbare browser. */
  async close(): Promise<void> {
    for (const [id, done] of [...this.permissions]) {
      this.permissions.delete(id);
      done({ allow: false, message: "Het project is gesloten." });
    }
    this.checking?.abort();
    await Promise.all([this.dev.stop(), this.observer.close()]);
  }
}

export type { DevStatus };
