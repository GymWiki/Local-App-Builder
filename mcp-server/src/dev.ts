import type { ChildProcess } from "node:child_process";
import { killTree, spawnTree } from "./proc.js";
import { LineBuffer, stripAnsi as stripAnsiLocal } from "./text.js";

export type DevState = "stopped" | "starting" | "running" | "stopping" | "error";

export interface DevStatus {
  state: DevState;
  pid: number | null;
  url: string | null;
  exitCode: number | null;
  error: string | null;
}

export interface DevDeps {
  cwd: string;
  /** Geeft het (vertrouwde) dev-commando terug. Zonder `url` wordt de poort uit de uitvoer van het dev-proces gehaald. */
  resolve: () => Promise<{ command: string; url?: string }>;
  onChange: (s: DevStatus) => void;
  readyTimeoutMs?: number;
}

const URL_RE = /\bhttps?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})(\/[^\s'")\]]*)?/i;
const PORT_RE = /\b(?:listening|running|started|serving|ready)\b[^\n]*?(?:port|:)\s*(\d{4,5})\b/i;

/** Haalt de lokale preview-URL uit een regel dev-uitvoer (Vite, Next, CRA, Astro, Express, …). Netwerk-URL's (LAN) negeren we. */
export function detectUrl(line: string): string | null {
  const m = URL_RE.exec(line);
  if (m) {
    const host = m[1] === "0.0.0.0" ? "127.0.0.1" : m[1] === "[::]" || m[1] === "[::1]" ? "localhost" : m[1];
    return `http://${host}:${m[2]}/`;
  }
  if (/ws:\/\/|debugger|inspector/i.test(line)) return null;
  const p = PORT_RE.exec(line);
  return p ? `http://localhost:${p[1]}/` : null;
}

const BUSY_RE = /EADDRINUSE|address already in use|port \d+ is (?:already )?in use|port is already (?:allocated|in use)/i;

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500), redirect: "manual" });
    return true; // elke HTTP-respons betekent: de server luistert
  } catch {
    return false;
  }
}

export class DevServer {
  readonly logs = new LineBuffer(1000);
  private child: ChildProcess | null = null;
  private poll: NodeJS.Timeout | null = null;
  private s: DevStatus = { state: "stopped", pid: null, url: null, exitCode: null, error: null };
  private stopping = false;

  constructor(private readonly deps: DevDeps) {}

  status(): DevStatus {
    return { ...this.s };
  }

  private set(patch: Partial<DevStatus>): void {
    this.s = { ...this.s, ...patch };
    this.deps.onChange(this.status());
  }

  async start(): Promise<DevStatus> {
    if (this.child && (this.s.state === "starting" || this.s.state === "running")) return this.status();
    if (this.child) await this.stop();
    const { command, url } = await this.deps.resolve();
    this.stopping = false;
    this.logs.add(`--- ${new Date().toISOString()} · ${command} ---`);
    const child = spawnTree(command, this.deps.cwd);
    this.child = child;
    const onData = (b: Buffer) => {
      const text = b.toString("utf8");
      this.logs.push(text);
      if (!this.s.url && this.child === child) {
        for (const line of text.split(/\r?\n/)) {
          const found = detectUrl(stripAnsiLocal(line));
          if (found) {
            this.set({ url: found });
            break;
          }
        }
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (e) => {
      this.logs.add(`[fout] ${e.message}`);
      if (this.child === child) this.finish(child, null, e.message);
    });
    child.on("close", (code) => this.finish(child, code, null));
    this.set({ state: "starting", pid: child.pid ?? null, url: url ?? null, exitCode: null, error: null });
    this.watchReady(child, url);
    return this.status();
  }

  private finish(child: ChildProcess, code: number | null, err: string | null): void {
    if (this.child !== child) return;
    this.child = null;
    this.clearPoll();
    // Achtergebleven kindprocessen (bijv. een dev-server die zijn shell overleeft) altijd opruimen.
    void killTree(child, 500);
    if (this.stopping || (code === 0 && !err)) {
      this.set({ state: "stopped", pid: null, exitCode: code, error: null });
    } else {
      const recent = this.logs.last(40).join("\n");
      const busy = BUSY_RE.test(recent);
      const port = /(?:port|:)\s*(\d{2,5})\b[^\n]*(?:in use|EADDRINUSE)|EADDRINUSE[^\n]*?:(\d{2,5})/i.exec(recent);
      const which = port ? port[1] ?? port[2] : null;
      this.set({
        state: "error",
        pid: null,
        exitCode: code,
        error: err ?? (busy ? `${which ? `Poort ${which}` : "De poort"} is al in gebruik door een ander programma.` : `Dev-server stopte onverwacht (code ${code ?? "?"}).`),
      });
    }
  }

  private watchReady(child: ChildProcess, configuredUrl?: string): void {
    const started = Date.now();
    const limit = this.deps.readyTimeoutMs ?? 60_000;
    let timedOut = false;
    const tick = async () => {
      if (this.child !== child) return;
      const url = this.s.url;
      if (!url) {
        // Poort nog niet bekend: wachten op de uitvoer van het dev-proces.
        if (!configuredUrl && Date.now() - started > limit && !timedOut) {
          timedOut = true;
          this.set({ state: "error", error: "De poort van de dev-server staat niet in de uitvoer. Zet \"previewUrl\" in studio.json." });
        }
      } else if (await reachable(url)) {
        if (this.child === child) this.set({ state: "running", error: null });
        return;
      } else if (!timedOut && Date.now() - started > limit) {
        timedOut = true;
        if (this.child === child) this.set({ state: "error", error: `Preview niet bereikbaar op ${url} binnen ${Math.round(limit / 1000)} s.` });
      }
      if (this.child === child) this.poll = setTimeout(() => void tick(), timedOut ? 2000 : 400);
    };
    this.poll = setTimeout(() => void tick(), 300);
  }

  private clearPoll(): void {
    if (this.poll) clearTimeout(this.poll);
    this.poll = null;
  }

  async stop(): Promise<DevStatus> {
    const child = this.child;
    if (!child) return this.status();
    this.stopping = true;
    this.clearPoll();
    this.set({ state: "stopping" });
    await killTree(child);
    if (this.child === child) this.finish(child, child.exitCode, null);
    return this.status();
  }

  async restart(): Promise<DevStatus> {
    await this.stop();
    return this.start();
  }
}
