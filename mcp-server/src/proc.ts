import { spawn, type ChildProcess } from "node:child_process";

const IS_WIN = process.platform === "win32";

/** Omgeving voor projectprocessen: niets van Studio zelf (geen token). */
function cleanEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  for (const k of Object.keys(env)) if (k.startsWith("STUDIO_")) delete env[k];
  env.FORCE_COLOR = "0";
  env.NO_COLOR = "1";
  return env;
}

/** Start een shellcommando in een eigen procesgroep (Unix) zodat we de hele boom kunnen stoppen. */
export function spawnTree(command: string, cwd: string, extraEnv?: NodeJS.ProcessEnv): ChildProcess {
  return spawn(command, {
    cwd,
    shell: true,
    detached: !IS_WIN,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: cleanEnv(extraEnv),
  });
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stopt het proces én alle kindprocessen. Eerst netjes (SIGTERM), na `graceMs` hard (SIGKILL). Veilig om vaker aan te roepen. */
export async function killTree(child: ChildProcess, graceMs = 3000): Promise<void> {
  const pid = child.pid;
  if (!pid) return;
  if (IS_WIN) {
    await new Promise<void>((resolve) => {
      const k = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      k.on("error", () => resolve());
      k.on("close", () => resolve());
    });
    return;
  }
  const signal = (s: NodeJS.Signals) => {
    try {
      process.kill(-pid, s);
    } catch {
      /* groep bestaat niet meer */
    }
  };
  signal("SIGTERM");
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && groupAlive(pid)) await sleep(50);
  if (groupAlive(pid)) {
    signal("SIGKILL");
    const hard = Date.now() + 2000;
    while (Date.now() < hard && groupAlive(pid)) await sleep(25);
  }
}

export interface RunResult {
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  durationMs: number;
  output: string;
}

const MAX_OUTPUT = 2_000_000;

/** Draait een commando tot het klaar is, met verplichte time-out. Ruimt daarna altijd de hele procesboom op. */
export function runCommand(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<RunResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawnTree(command, cwd);
    let output = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    const onData = (b: Buffer) => {
      output += b.toString("utf8");
      if (output.length > MAX_OUTPUT) output = output.slice(-MAX_OUTPUT);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    const finish = async (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      await killTree(child, 500); // achtergebleven kindprocessen (bijv. watchers) opruimen
      resolve({ exitCode: code, timedOut, aborted, durationMs: Date.now() - start, output });
    };
    const stop = () => void killTree(child).then(() => finish(child.exitCode));
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    const onAbort = () => {
      aborted = true;
      stop();
    };
    signal?.addEventListener("abort", onAbort);
    child.on("error", (e) => {
      output += `\n${e.message}`;
      void finish(null);
    });
    child.on("close", (code) => void finish(code));
  });
}
