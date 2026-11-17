import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectUrl } from "../src/dev.js";
import { Runtime, type PlanPush } from "../src/runtime.js";
import { alive, freePort, waitFor } from "./helpers.js";

describe("poortdetectie uit dev-uitvoer", () => {
  it.each([
    ["  ➜  Local:   http://localhost:5173/", "http://localhost:5173/"],
    ["  ▲ Next.js 15\n   - Local:        http://localhost:3000", "http://localhost:3000/"],
    ["  Local    http://127.0.0.1:4321/", "http://127.0.0.1:4321/"],
    ["Server running at http://0.0.0.0:8080", "http://127.0.0.1:8080/"],
    ["listening on [::1]:9000 http://[::1]:9000/", "http://localhost:9000/"],
    ["Listening on port 3001", "http://localhost:3001/"],
    ["  Local: \u001b[36mhttp://localhost:\u001b[1m5174\u001b[22m/\u001b[0m", null], // ANSI wordt eerst gestript door de aanroeper
  ])("%j", (line, want) => {
    expect(detectUrl(line)).toBe(want);
  });
  it("negeert netwerk-URL's en debuggers", () => {
    expect(detectUrl("  ➜  Network: http://192.168.1.20:5173/")).toBeNull();
    expect(detectUrl("Debugger listening on ws://127.0.0.1:9229/abc")).toBeNull();
    expect(detectUrl("compiled successfully")).toBeNull();
  });
});

/** Een dev-"framework" dat zich als Vite gedraagt: kiest de volgende vrije poort en print de URL. */
const FAKE_VITE = `
import { createServer } from "node:http";
import { createServer as net } from "node:net";
const start = Number(process.argv[2]);
function tryListen(port) {
  const s = createServer((req, res) => { res.writeHead(200, {"content-type":"text/html"}); res.end("<h1>vite-app</h1>"); });
  s.once("error", (e) => { if (e.code === "EADDRINUSE" && process.env.STRICT !== "1") tryListen(port + 1); else { console.error("Error: listen EADDRINUSE: address already in use 127.0.0.1:" + port); process.exit(1); } });
  s.listen(port, "127.0.0.1", () => { console.log("\\n  VITE v5.0.0  ready in 120 ms\\n\\n  ➜  Local:   http://localhost:" + port + "/\\n  ➜  Network: use --host to expose"); });
}
tryListen(start);
setInterval(() => {}, 1000);
`;

async function viteProject(scripts: Record<string, string>, extra: Record<string, unknown> = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-vite-"));
  await writeFile(path.join(dir, "fake-vite.mjs"), FAKE_VITE);
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "demo", scripts, ...extra }));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

describe("package.json-project (zero-config dev-server)", () => {
  let rt: Runtime;
  const events: Record<string, unknown>[] = [];
  afterEach(async () => {
    await rt?.close();
  });
  const plan = (over: Partial<PlanPush> = {}, port?: number): PlanPush => ({
    kind: "node",
    devScript: "dev",
    scripts: { dev: `node fake-vite.mjs ${port ?? 0}` },
    trusted: true,
    needsInstall: false,
    ...over,
  });

  it("start vanzelf, haalt de poort uit de uitvoer en wordt 'running'", async () => {
    const port = await freePort();
    const dir = await viteProject({ dev: `node fake-vite.mjs ${port}` });
    rt = new Runtime({ projectDir: dir, projectName: "x", emit: (e) => events.push(e) });
    rt.setPlan(plan({}, port));
    expect(await rt.control("dev.autostart")).toEqual({ started: true });
    await waitFor("running", () => rt.dev.status().state === "running");
    const st = rt.dev.status();
    expect(st.url).toBe(`http://localhost:${port}/`);
    expect(await rt.previewUrl()).toBe(`http://localhost:${port}/`);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
    expect(await rt.control("dev.autostart")).toMatchObject({ started: false, reason: "already_running" });
    const pid = st.pid!;
    await rt.close();
    await waitFor("proces weg", () => !alive(pid), 6000);
    expect(events.filter((e) => e.event === "dev").map((e) => e.state)).toEqual(expect.arrayContaining(["starting", "running", "stopped"]));
  });

  it("poort bezet: Vite-achtig script kiest de volgende poort en Studio toont die", async () => {
    const busyPort = await freePort();
    const busy: Server = createServer((_q, r) => r.end("bezet")).listen(busyPort, "127.0.0.1");
    try {
      const dir = await viteProject({ dev: `node fake-vite.mjs ${busyPort}` });
      rt = new Runtime({ projectDir: dir, projectName: "x" });
      rt.setPlan(plan({}, busyPort));
      await rt.control("dev.autostart");
      await waitFor("running", () => rt.dev.status().state === "running");
      expect(rt.dev.status().url).toBe(`http://localhost:${busyPort + 1}/`);
    } finally {
      busy.close();
    }
  });

  it("poort bezet en strikt: duidelijke foutmelding met logregels in plaats van 'onverwacht gestopt'", async () => {
    const busyPort = await freePort();
    const busy: Server = createServer((_q, r) => r.end("bezet")).listen(busyPort, "127.0.0.1");
    try {
      const dir = await viteProject({ dev: `node fake-vite.mjs ${busyPort}` });
      rt = new Runtime({ projectDir: dir, projectName: "x" });
      rt.setPlan(plan({}, busyPort));
      process.env.STRICT = "1";
      await rt.control("dev.autostart");
      await waitFor("error", () => rt.dev.status().state === "error");
      const st = rt.dev.status();
      expect(st.error).toContain(`Poort ${busyPort} is al in gebruik`);
      expect(rt.dev.logs.last(10).join("\n")).toContain("EADDRINUSE");
      expect(st.pid).toBeNull();
    } finally {
      delete process.env.STRICT;
      busy.close();
    }
  });

  it("weigert te starten zolang de scripts niet zijn goedgekeurd of dependencies ontbreken, met een reden", async () => {
    const dir = await viteProject({ dev: "node fake-vite.mjs 0" });
    rt = new Runtime({ projectDir: dir, projectName: "x" });
    rt.setPlan(plan({ trusted: false }));
    expect(await rt.control("dev.autostart")).toMatchObject({ started: false, reason: "untrusted" });
    expect(rt.dev.status().state).toBe("stopped");
    rt.setPlan(plan({ needsInstall: true }));
    expect(await rt.control("dev.autostart")).toEqual({ started: false, reason: "deps_missing" });
    rt.setPlan(plan({ devScript: null, scripts: {} }));
    expect(await rt.control("dev.autostart")).toEqual({ started: false, reason: "no_dev" });
  });

  it("run_checks gebruikt de npm-scripts uit package.json (alleen als goedgekeurd)", async () => {
    const dir = await viteProject({ lint: `node -e "console.log('lint ok')"`, build: `node -e "console.error('Error: kapot');process.exit(1)"`, test: "node -e 0" });
    rt = new Runtime({ projectDir: dir, projectName: "x" });
    const scripts = { lint: "x", build: "x", test: "x" };
    rt.setPlan({ kind: "node", scripts, trusted: false });
    await expect(rt.runChecks()).rejects.toThrow(/goedgekeurd/);
    rt.setPlan({ kind: "node", scripts, trusted: true });
    const r = await rt.runChecks();
    expect(r.steps.map((s) => [s.name, s.status])).toEqual([["lint", "passed"], ["build", "failed"], ["test", "passed"]]);
    expect(r.steps[1].output.join("\n")).toContain("Error: kapot");
    expect(r.steps[0].command).toBe("npm run lint");
  });

  it("studio.json blijft leidend boven package.json", async () => {
    const dir = await viteProject({ dev: "node fake-vite.mjs 1" });
    const port = await freePort();
    const raw = JSON.stringify({ dev: `node fake-vite.mjs ${port}`, previewUrl: `http://127.0.0.1:${port}/` });
    await writeFile(path.join(dir, "studio.json"), raw);
    rt = new Runtime({ projectDir: dir, projectName: "x" });
    rt.setPlan(plan({ trusted: true }));
    expect(await rt.control("dev.autostart")).toMatchObject({ reason: "untrusted" }); // studio.json eerst goedkeuren
    const { createHash } = await import("node:crypto");
    rt.setTrustedHash(createHash("sha256").update(raw).digest("hex"));
    expect(await rt.control("dev.autostart")).toEqual({ started: true });
    await waitFor("running", () => rt.dev.status().state === "running");
    expect(rt.dev.status().url).toBe(`http://127.0.0.1:${port}/`);
  });
});

/* ---------- statische modus ---------- */

describe("statische modus: checks en preview-URL", () => {
  let rt: Runtime;
  let dir: string;
  let srv: Server;
  let port: number;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "studio-static-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    port = await freePort();
    srv = createServer(async (req, res) => {
      const { readFile } = await import("node:fs/promises");
      try {
        const f = req.url === "/" ? "index.html" : (req.url ?? "").slice(1);
        const body = await readFile(path.join(dir, f));
        res.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html" });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("nope");
      }
    }).listen(port, "127.0.0.1");
    rt = new Runtime({ projectDir: dir, projectName: "x" });
    rt.setPlan({ kind: "static", entry: "index.html", staticRoot: "", staticUrl: `http://127.0.0.1:${port}/` });
  });
  afterEach(async () => {
    srv.close();
    await rt.close();
  });

  it("html + links slagen voor een gezond project (console draait mee of wordt overgeslagen zonder browser)", async () => {
    await writeFile(path.join(dir, "index.html"), '<!doctype html><html><body><a href="about.html">over</a><a href="#top">top</a><a href="https://example.com/x">ext</a><a href="mailto:a@b.nl">m</a><img src="img/logo.svg"></body></html>');
    await writeFile(path.join(dir, "about.html"), '<html><body><a href="/">terug</a><a href="index.html?x=1#y">home</a></body></html>');
    await mkdir(path.join(dir, "img"));
    await writeFile(path.join(dir, "img/logo.svg"), "<svg/>");
    const r = await rt.runChecks();
    expect(r.steps.map((s) => s.name)).toEqual(["html", "links", "console"]);
    expect(r.steps[0].status).toBe("passed");
    expect(r.steps[1].status).toBe("passed");
    expect(["passed", "skipped"], JSON.stringify(r.steps[2])).toContain(r.steps[2].status);
    expect(r.ok).toBe(true);
  });

  it("html faalt zonder index.html; links vindt kapotte verwijzingen en verwijzingen buiten de map", async () => {
    let r = await rt.runChecks(["html"]);
    expect(r.ok).toBe(false);
    expect(r.steps[0].output[0]).toContain("ontbreekt");

    await writeFile(path.join(dir, "index.html"), '<html><body><a href="bestaat-niet.html">x</a><script src="app.js"></script><a href="../geheim.html">y</a><a href="sub/">z</a></body></html>');
    r = await rt.runChecks(["links"]);
    expect(r.ok).toBe(false);
    const out = r.steps[0].output.join("\n");
    expect(out).toContain('"bestaat-niet.html" bestaat niet');
    expect(out).toContain('"app.js" bestaat niet');
    expect(out).toContain("buiten de projectmap");
    expect(out).toContain('"sub/" bestaat niet');
  });

  it("verwijderd bestand wordt direct als kapotte link gezien en na terugzetten weer groen", async () => {
    await writeFile(path.join(dir, "index.html"), '<html><body><a href="p.html">p</a></body></html>');
    await writeFile(path.join(dir, "p.html"), "<html><body>p</body></html>");
    expect((await rt.runChecks(["links"])).ok).toBe(true);
    const { rm } = await import("node:fs/promises");
    await rm(path.join(dir, "p.html"));
    expect((await rt.runChecks(["links"])).ok).toBe(false);
    await writeFile(path.join(dir, "p.html"), "<html><body>p</body></html>");
    expect((await rt.runChecks(["links"])).ok).toBe(true);
  });

  it("console-check vindt console-errors in de statische preview; screenshot werkt zonder dev-server", async (ctx) => {
    await writeFile(path.join(dir, "index.html"), '<html><body style="background:#bbf7d0"><h1>Statisch</h1><script>console.error("statische-boom")</script></body></html>');
    const r = await rt.runChecks(["console"]);
    if (r.steps[0].status === "skipped") return ctx.skip(); // geen browser in deze omgeving
    expect(r.ok).toBe(false);
    expect(r.steps[0].output.join("\n")).toContain("statische-boom");
    const shot = await rt.observer.screenshot({ viewport: "mobile" });
    expect(shot.data.subarray(0, 2).toString("hex")).toBe("ffd8");
  });

  it("zonder scripts en zonder statische plan: duidelijke melding", async () => {
    const empty = new Runtime({ projectDir: dir, projectName: "x" });
    await expect(empty.runChecks()).rejects.toThrow(/Geen checks beschikbaar/);
    await expect(empty.previewUrl()).rejects.toThrow(/preview draait niet/);
  });
});

describe("afhankelijkheden installeren", () => {
  it("gebruikt npm install en meldt een mislukte installatie met uitvoer", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "studio-deps-"));
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "d", version: "1.0.0", dependencies: { "dit-pakket-bestaat-echt-niet-xyz-123": "1.0.0" } }));
    const rt = new Runtime({ projectDir: dir, projectName: "x" });
    await expect(rt.installDeps()).rejects.toThrow(/mislukte/);
    await rt.close();
  });
});

/** Echte Vite (vereist internet): `STUDIO_REAL_VITE=1 npm test`. Controleert dat poortdetectie ook met het echte framework klopt. */
describe("echte Vite", () => {
  it.skipIf(!process.env.STUDIO_REAL_VITE)("installeren, starten, poort detecteren en netjes stoppen", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "studio-realvite-"));
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "v", private: true, type: "module", scripts: { dev: "vite" }, devDependencies: { vite: "^5" } }));
    await writeFile(path.join(dir, "index.html"), '<!doctype html><html><body><h1>Echte Vite</h1><script type="module" src="/main.js"></script></body></html>');
    await writeFile(path.join(dir, "main.js"), 'console.log("hoi")');
    const rt = new Runtime({ projectDir: dir, projectName: "v" });
    rt.setPlan({ kind: "node", devScript: "dev", scripts: { dev: "vite" }, trusted: true, needsInstall: true });
    expect(await rt.control("dev.autostart")).toEqual({ started: false, reason: "deps_missing" });
    await rt.installDeps();
    rt.setPlan({ kind: "node", devScript: "dev", scripts: { dev: "vite" }, trusted: true, needsInstall: false });
    expect(await rt.control("dev.autostart")).toEqual({ started: true });
    await waitFor("running", () => rt.dev.status().state === "running", 60_000);
    const url = rt.dev.status().url!;
    expect(url).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/);
    expect(await (await fetch(url)).text()).toContain("Echte Vite");
    const pid = rt.dev.status().pid!;
    await rt.close();
    await waitFor("vite weg", () => !alive(pid), 8000);
    await expect(fetch(url)).rejects.toThrow();
  }, 180_000);
});
