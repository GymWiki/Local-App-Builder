import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseConfig, validatePreviewUrl } from "../src/config.js";
import { runCommand } from "../src/proc.js";
import { Runtime } from "../src/runtime.js";
import { LineBuffer, relevantLines, stripAnsi } from "../src/text.js";
import { alive, makeExample, read, waitFor, type Example } from "./helpers.js";

describe("studio.json", () => {
  it("accepteert alleen loopback-URL's", () => {
    expect(validatePreviewUrl("http://localhost:5173")).toContain("localhost");
    expect(validatePreviewUrl("http://127.0.0.1:3000/x")).toContain("127.0.0.1");
    for (const bad of ["https://example.com", "http://192.168.1.5:3000", "file:///etc/passwd", "javascript:alert(1)", "nope"]) {
      expect(() => validatePreviewUrl(bad), bad).toThrow();
    }
  });
  it("valideert velden", () => {
    expect(parseConfig('{"dev":" npm run dev ","timeoutSec":10,"onbekend":1}')).toEqual({ dev: "npm run dev", timeoutSec: 10 });
    expect(() => parseConfig('{"dev":""}')).toThrow();
    expect(() => parseConfig('{"lint":"a\\nb"}')).toThrow();
    expect(() => parseConfig('{"timeoutSec":99999}')).toThrow();
    expect(() => parseConfig("[]")).toThrow();
  });
});

describe("tekst", () => {
  it("relevantLines houdt max 200 regels met de foutregel en de staart", () => {
    const out = [...Array(500).fill("ruis"), "Error: kapot", ...Array(500).fill("meer ruis"), "laatste regel"].join("\n");
    const r = relevantLines(out, 200);
    expect(r.length).toBeLessThanOrEqual(200);
    expect(r).toContain("Error: kapot");
    expect(r.at(-1)).toBe("laatste regel");
  });
  it("korte uitvoer blijft heel", () => {
    expect(relevantLines("a\nb\n")).toEqual(["a", "b"]);
  });
  it("LineBuffer voegt halve regels samen en strip ANSI", () => {
    const b = new LineBuffer(3);
    b.push("\u001b[31mro");
    b.push("od\u001b[0m\nvol");
    b.push("gende\n1\n2\n3\n");
    expect(b.last(10)).toEqual(["1", "2", "3"]);
    expect(stripAnsi("\u001b[31mx\u001b[0m")).toBe("x");
  });
});

describe("processen: time-outs en opruimen", () => {
  it("time-out stopt het commando", async () => {
    const t = Date.now();
    const r = await runCommand(`node -e "setInterval(()=>{},1000)"`, tmpdir(), 600);
    expect(r.timedOut).toBe(true);
    expect(Date.now() - t).toBeLessThan(8000);
  });

  it("time-out ruimt ook kindprocessen op", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "studio-gc-"));
    await writeFile(path.join(dir, "spawner.mjs"), `import { spawn } from "node:child_process";import { writeFileSync } from "node:fs";
const c = spawn(process.execPath, ["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});writeFileSync("gc.pid",String(c.pid));setInterval(()=>{},1000);`);
    const r = await runCommand("node spawner.mjs", dir, 1500);
    expect(r.timedOut).toBe(true);
    const pid = Number(await readFile(path.join(dir, "gc.pid"), "utf8"));
    await waitFor("kindproces weg", () => !alive(pid), 5000);
  });

  it("afgesloten commando laat geen achtergrondproces achter", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "studio-bg-"));
    await writeFile(path.join(dir, "bg.mjs"), `import { spawn } from "node:child_process";import { writeFileSync } from "node:fs";
const c = spawn(process.execPath, ["-e","setInterval(()=>{},1000)"],{stdio:"ignore",detached:false});c.unref();writeFileSync("gc.pid",String(c.pid));`);
    const r = await runCommand("node bg.mjs", dir, 10_000);
    expect(r.exitCode).toBe(0);
    const pid = Number(await readFile(path.join(dir, "gc.pid"), "utf8"));
    await waitFor("achtergrondproces weg", () => !alive(pid), 5000);
  });
});

describe("Runtime tegen een voorbeeldproject", () => {
  let ex: Example;
  let rt: Runtime;
  const events: Record<string, unknown>[] = [];

  beforeEach(async () => {
    events.length = 0;
    ex = await makeExample();
    rt = new Runtime({ projectDir: ex.dir, projectName: "Voorbeeld", emit: (e) => events.push(e) });
  });
  afterEach(async () => {
    await rt.close();
  });

  it("weigert commando's zolang studio.json niet is goedgekeurd, ook na wijziging", async () => {
    await expect(rt.runChecks()).rejects.toThrow(/goedgekeurd/);
    await expect(rt.dev.start()).rejects.toThrow(/goedgekeurd/);
    rt.setTrustedHash(ex.hash);
    expect((await rt.runChecks()).ok).toBe(true);
    await writeFile(path.join(ex.dir, "studio.json"), JSON.stringify({ lint: "echo pwned" }));
    await expect(rt.runChecks()).rejects.toThrow(/goedgekeurd/);
  });

  it("run_checks: alles geslaagd", async () => {
    rt.setTrustedHash(ex.hash);
    const r = await rt.runChecks();
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => [s.name, s.status])).toEqual([["lint", "passed"], ["build", "passed"], ["test", "passed"]]);
    expect(events.some((e) => e.event === "checks" && e.ok === true)).toBe(true);
  });

  it("run_checks: mislukte build geeft de foutregel terug, max 200 regels", async () => {
    rt.setTrustedHash(ex.hash);
    await writeFile(path.join(ex.dir, "fail-build"), "");
    const r = await rt.runChecks();
    expect(r.ok).toBe(false);
    const build = r.steps.find((s) => s.name === "build")!;
    expect(build.status).toBe("failed");
    expect(build.exitCode).toBe(1);
    expect(build.output.length).toBeLessThanOrEqual(200);
    expect(build.output.join("\n")).toContain("Error: build broke at src/app.ts:12");
    expect(r.steps.find((s) => s.name === "test")!.status).toBe("passed");
  });

  it("run_checks: time-out per stap en overslaan van niet-ingestelde stappen", async () => {
    await writeFile(path.join(ex.dir, "studio.json"), JSON.stringify({ lint: `node -e "setInterval(()=>{},1000)"`, timeoutSec: 1 }));
    const { loadConfig } = await import("../src/config.js");
    rt.setTrustedHash((await loadConfig(ex.dir)).hash);
    const r = await rt.runChecks();
    expect(r.steps[0].status).toBe("timeout");
    expect(r.steps.map((s) => s.status)).toEqual(["timeout", "skipped", "skipped"]);
    expect(r.ok).toBe(false);
  });

  it("dev-server: start, logs, status en netjes stoppen zonder zombie", async () => {
    rt.setTrustedHash(ex.hash);
    const st = await rt.dev.start();
    expect(st.state).toBe("starting");
    const pid = st.pid!;
    await waitFor("running", () => rt.dev.status().state === "running");
    expect((await fetch(`http://127.0.0.1:${ex.port}/`)).status).toBe(200);
    expect(rt.dev.logs.last(10).join("\n")).toContain("dev server listening");

    await rt.dev.stop();
    expect(rt.dev.status().state).toBe("stopped");
    await waitFor("pid weg", () => !alive(pid), 5000);
    await expect(fetch(`http://127.0.0.1:${ex.port}/`)).rejects.toThrow();
    expect(events.filter((e) => e.event === "dev").map((e) => e.state)).toEqual(expect.arrayContaining(["starting", "running", "stopping", "stopped"]));
  });

  it("dev-server: onverwachte stop is status 'error'; herstart werkt", async () => {
    await writeFile(path.join(ex.dir, "studio.json"), JSON.stringify({ dev: `node -e "process.exit(3)"` }));
    const { loadConfig } = await import("../src/config.js");
    rt.setTrustedHash((await loadConfig(ex.dir)).hash);
    await rt.dev.start();
    await waitFor("error", () => rt.dev.status().state === "error");
    expect(rt.dev.status().exitCode).toBe(3);
  });

  it("dev-server die nooit bereikbaar wordt, krijgt status 'error' met melding", async () => {
    const quick = new Runtime({ projectDir: ex.dir, projectName: "x", readyTimeoutMs: 600 });
    await writeFile(path.join(ex.dir, "studio.json"), JSON.stringify({ dev: `node -e "setInterval(()=>{},1000)"`, previewUrl: "http://127.0.0.1:9/" }));
    const { loadConfig } = await import("../src/config.js");
    quick.setTrustedHash((await loadConfig(ex.dir)).hash);
    const pid = (await quick.dev.start()).pid!;
    await waitFor("error", () => quick.dev.status().state === "error");
    expect(quick.dev.status().error).toMatch(/niet bereikbaar/);
    await quick.close();
    await waitFor("pid weg", () => !alive(pid), 5000);
  });

  it("close() stopt de dev-server", async () => {
    rt.setTrustedHash(ex.hash);
    const pid = (await rt.dev.start()).pid!;
    await rt.close();
    await waitFor("pid weg", () => !alive(pid), 5000);
  });

  it("git: checkpoint, lijst, geheimen overslaan en niets-te-committen", async () => {
    await writeFile(path.join(ex.dir, "a.txt"), "een");
    await writeFile(path.join(ex.dir, ".env"), "SECRET=1");
    const r = (await rt.control("git.checkpoint", { message: "eerste" })) as { created: boolean; skipped: string[] };
    expect(r.created).toBe(true);
    expect(r.skipped).toContain(".env");
    const tracked = execFileSync("git", ["ls-files"], { cwd: ex.dir, encoding: "utf8" });
    expect(tracked).toContain("a.txt");
    expect(tracked).not.toContain(".env");
    expect(await read(path.join(ex.dir, ".env"))).toBe("SECRET=1");

    expect(((await rt.control("git.checkpoint", { message: "niks" })) as { created: boolean }).created).toBe(false);
    const list = await rt.git.list();
    expect(list.map((c) => c.message)).toEqual(["eerste"]);
    await expect(rt.control("git.checkpoint", { message: "  " })).rejects.toThrow();
  });

  it("git: persoonlijke Claude-instellingen (goedkeuring) komen nooit in een checkpoint", async () => {
    await mkdir(path.join(ex.dir, ".claude"));
    await writeFile(path.join(ex.dir, ".claude/settings.local.json"), '{"enabledMcpjsonServers":["studio"]}');
    await writeFile(path.join(ex.dir, "a.txt"), "x");
    const r = (await rt.control("git.checkpoint", { message: "met claude-map" })) as { skipped: string[] };
    expect(r.skipped).toContain(".claude/settings.local.json");
    expect(execFileSync("git", ["ls-files"], { cwd: ex.dir, encoding: "utf8" })).not.toContain("settings.local.json");
  });

  it("git restore: zet terug als nieuwe commit en bewaart niet-opgeslagen werk eerst", async () => {
    const f = path.join(ex.dir, "a.txt");
    await writeFile(f, "versie A");
    await rt.control("git.checkpoint", { message: "A" });
    const [a] = await rt.git.list();
    await writeFile(f, "versie B");
    await writeFile(path.join(ex.dir, "nieuw.txt"), "alleen in B");
    await rt.control("git.checkpoint", { message: "B" });
    await writeFile(f, "versie C (niet opgeslagen)");

    const r = (await rt.control("git.restore", { hash: a.hash })) as { safety?: string; unchanged: boolean };
    expect(r.unchanged).toBe(false);
    expect(r.safety).toBeTruthy();
    expect(await read(f)).toBe("versie A");
    await expect(read(path.join(ex.dir, "nieuw.txt"))).rejects.toThrow();

    const msgs = (await rt.git.list()).map((c) => c.message);
    expect(msgs[0]).toMatch(/^Terug naar: A/);
    expect(msgs).toEqual(expect.arrayContaining(["A", "B", "Studio: automatische back-up vóór terugzetten"]));
    expect(await rt.git.isDirty()).toBe(false);

    // Niets is verloren: de niet-opgeslagen versie C is terug te halen via de back-up.
    await rt.control("git.restore", { hash: r.safety });
    expect(await read(f)).toBe("versie C (niet opgeslagen)");
  });

  it("git restore: weigert ongeldige of onbekende ids en is een no-op bij gelijke staat", async () => {
    await writeFile(path.join(ex.dir, "a.txt"), "x");
    await rt.control("git.checkpoint", { message: "A" });
    const [a] = await rt.git.list();
    await expect(rt.control("git.restore", { hash: "--hard" })).rejects.toThrow(/Ongeldige/);
    await expect(rt.control("git.restore", { hash: "deadbeef" })).rejects.toThrow(/bestaat niet/);
    expect(((await rt.control("git.restore", { hash: a.hash })) as { unchanged: boolean }).unchanged).toBe(true);
  });
});
