import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { alive, makeExample, waitFor } from "./helpers.js";

/** Het echte proces (gebundeld bestand), zoals de app het start. */
describe("procesleven van de gebundelde server", () => {
  it("sluiten van stdin stopt server én dev-boom (geen zombies)", async () => {
    const ex = await makeExample({ dev: "node scripts/spawner.mjs", previewUrl: undefined });
    const child = spawn(process.execPath, [path.resolve("dist/index.mjs")], {
      env: { ...process.env, STUDIO_PROJECT_DIR: ex.dir, STUDIO_PROJECT_NAME: "x", STUDIO_MCP_TOKEN: "z".repeat(40) },
      stdio: ["pipe", "pipe", "ignore"],
    });
    const events: Record<string, unknown>[] = [];
    const replies = new Map<number, Record<string, unknown>>();
    let buf = "";
    child.stdout.on("data", (b: Buffer) => {
      buf += b.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) {
        const o = JSON.parse(l);
        if (o.event === "reply") replies.set(o.id, o);
        else events.push(o);
      }
    });
    let n = 0;
    const ask = async (cmd: string, args: object = {}) => {
      const id = ++n;
      child.stdin.write(JSON.stringify({ id, cmd, args }) + "\n");
      await waitFor(`antwoord ${cmd}`, () => replies.has(id));
      const r = replies.get(id)!;
      expect(r.ok, JSON.stringify(r)).toBe(true);
      return r.result as Record<string, unknown>;
    };
    const exited = new Promise<number | null>((r) => child.on("exit", (c) => r(c)));

    await waitFor("ready", () => events.some((e) => e.event === "ready"));
    const cfg = await ask("config.get");
    expect(cfg.trusted).toBe(false);
    await ask("trust.set", { hash: cfg.hash });
    expect((await ask("config.get")).trusted).toBe(true);
    await ask("dev.start");
    await waitFor("gestart", async () => (await ask("dev.status")).pid != null);
    const devPid = ((await ask("dev.status")).pid as number) ?? 0;
    await waitFor("kindproces-pid", async () => {
      try {
        await readFile(path.join(ex.dir, "gc.pid"), "utf8");
        return true;
      } catch {
        return false;
      }
    });
    const grandchild = Number(await readFile(path.join(ex.dir, "gc.pid"), "utf8"));
    expect(alive(devPid) && alive(grandchild)).toBe(true);

    child.stdin.end(); // de app sluit het project
    expect(await exited).toBe(0);
    await waitFor("dev-proces weg", () => !alive(devPid) && !alive(grandchild), 8000);
  });
});
