import { mkdir } from "node:fs/promises";
import { DevServer, type DevStatus } from "./dev.js";
import { initConfig, loadConfig, type StudioConfig } from "./config.js";
import { Git } from "./git.js";
import { PreviewObserver } from "./preview.js";
import { runCommand } from "./proc.js";
import { relevantLines } from "./text.js";

export type CheckName = "lint" | "build" | "test";
export const CHECK_ORDER: CheckName[] = ["lint", "build", "test"];

export interface StepResult {
  name: CheckName;
  command?: string;
  status: "passed" | "failed" | "timeout" | "skipped";
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
}

export class Runtime {
  readonly projectDir: string;
  readonly projectName: string;
  readonly git: Git;
  readonly dev: DevServer;
  readonly observer: PreviewObserver;
  private trustedHash: string | null = null;
  private last: ChecksResult | null = null;
  private checking: AbortController | null = null;
  private readonly emit: Emit;

  constructor(o: RuntimeOptions) {
    this.projectDir = o.projectDir;
    this.projectName = o.projectName;
    this.emit = o.emit ?? (() => undefined);
    this.git = new Git(o.projectDir);
    this.dev = new DevServer({
      cwd: o.projectDir,
      readyTimeoutMs: o.readyTimeoutMs,
      resolve: async () => {
        const c = await this.trustedConfig();
        if (!c.dev) throw new Error('Geen "dev"-commando ingesteld in studio.json.');
        return { command: c.dev, url: c.previewUrl };
      },
      onChange: (s) => this.emit({ event: "dev", ...s }),
    });
    this.observer = new PreviewObserver(async () => {
      const { config } = await this.requireConfig();
      if (!config.previewUrl) throw new Error('Geen "previewUrl" ingesteld in studio.json.');
      return config.previewUrl;
    });
  }

  setTrustedHash(hash: string | null): void {
    this.trustedHash = hash;
  }

  private async requireConfig(): Promise<{ config: StudioConfig; hash: string }> {
    const l = await loadConfig(this.projectDir);
    if (!l.exists) throw new Error("studio.json ontbreekt in de projectmap. Maak het aan (zie de Preview-tab).");
    if (!l.config || !l.hash) throw new Error(`studio.json is ongeldig: ${l.error ?? "onbekende fout"}`);
    return { config: l.config, hash: l.hash };
  }

  /** Commando's uit studio.json draaien alleen als de gebruiker precies deze versie van het bestand heeft goedgekeurd. */
  async trustedConfig(): Promise<StudioConfig> {
    const { config, hash } = await this.requireConfig();
    if (hash !== this.trustedHash) {
      throw new Error(
        "studio.json is nieuw of gewijzigd en nog niet goedgekeurd door de gebruiker. Vraag de gebruiker om in de Preview-tab op ‘Vertrouwen’ te klikken.",
      );
    }
    return config;
  }

  async runChecks(steps?: CheckName[]): Promise<ChecksResult> {
    if (this.checking) throw new Error("Er loopt al een check-run. Wacht tot die klaar is.");
    const config = await this.trustedConfig();
    const wanted = CHECK_ORDER.filter((n) => !steps || steps.includes(n));
    if (!wanted.some((n) => config[n])) throw new Error("Geen lint, build of test ingesteld in studio.json.");
    const ac = new AbortController();
    this.checking = ac;
    const timeoutMs = (config.timeoutSec ?? 300) * 1000;
    const results: StepResult[] = [];
    try {
      for (const name of wanted) {
        const command = config[name];
        if (!command) {
          results.push({ name, status: "skipped", exitCode: null, durationMs: 0, output: ["Niet ingesteld in studio.json."] });
          continue;
        }
        const r = await runCommand(command, this.projectDir, timeoutMs, ac.signal);
        const status = r.timedOut ? "timeout" : r.exitCode === 0 ? "passed" : "failed";
        const output =
          status === "passed" ? [] : relevantLines(r.output, 200).concat(r.timedOut ? [`[time-out na ${timeoutMs / 1000} s]`] : []);
        results.push({ name, command, status, exitCode: r.exitCode, durationMs: r.durationMs, output });
        if (r.aborted) break;
      }
    } finally {
      this.checking = null;
    }
    const res: ChecksResult = { ok: results.every((s) => s.status === "passed" || s.status === "skipped"), at: new Date().toISOString(), steps: results };
    this.last = res;
    this.emit({ event: "checks", ok: res.ok, at: res.at, steps: res.steps.map((s) => ({ ...s, output: s.output.slice(0, 40) })) });
    return res;
  }

  lastChecks(): ChecksResult | null {
    return this.last;
  }

  /** Antwoorden op commando's die de app (UI) via stdin stuurt. Alleen deze lijst is bereikbaar. */
  async control(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
    switch (cmd) {
      case "config.get": {
        const l = await loadConfig(this.projectDir);
        return { ...l, trusted: !!l.hash && l.hash === this.trustedHash };
      }
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
      default:
        throw new Error(`Onbekend commando: ${cmd}`);
    }
  }

  /** Stopt alles wat dit project draait: checks, dev-server en de onzichtbare browser. */
  async close(): Promise<void> {
    this.checking?.abort();
    await Promise.all([this.dev.stop(), this.observer.close()]);
  }
}

export type { DevStatus };
