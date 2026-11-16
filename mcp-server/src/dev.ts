import type { ChildProcess } from "node:child_process";
import { killTree, spawnTree } from "./proc.js";
import { LineBuffer } from "./text.js";

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
  /** Geeft het (vertrouwde) dev-commando en de preview-URL terug, of gooit een fout. */
  resolve: () => Promise<{ command: string; url?: string }>;
  onChange: (s: DevStatus) => void;
  readyTimeoutMs?: number;
}

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
    child.stdout?.on("data", (b: Buffer) => this.logs.push(b.toString("utf8")));
    child.stderr?.on("data", (b: Buffer) => this.logs.push(b.toString("utf8")));
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
      this.set({ state: "error", pid: null, exitCode: code, error: err ?? `Dev-server stopte onverwacht (code ${code ?? "?"}).` });
    }
  }

  private watchReady(child: ChildProcess, url?: string): void {
    const started = Date.now();
    const limit = this.deps.readyTimeoutMs ?? 60_000;
    let timedOut = false;
    const tick = async () => {
      if (this.child !== child) return;
      if (!url) {
        if (Date.now() - started > 1500) return this.set({ state: "running" });
      } else if (await reachable(url)) {
        if (this.child === child) this.set({ state: "running", error: null });
        return;
      } else if (!timedOut && Date.now() - started > limit) {
        timedOut = true;
        if (this.child === child) this.set({ state: "error", error: `Preview niet bereikbaar op ${url} binnen ${Math.round(limit / 1000)} s.` });
      }
      if (this.child === child) this.poll = setTimeout(() => void tick(), timedOut ? 2000 : 500);
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
