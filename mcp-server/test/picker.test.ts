import { createServer, type Server } from "node:http";
import net from "node:net";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { injectPicker, SCRIPT_PATH, startPickerProxy, type PickerProxy } from "../src/picker.js";
import { ensureExcluded, writePick } from "../src/picks.js";
import { Runtime } from "../src/runtime.js";
import "./helpers.js";

const tmps: string[] = [];
const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});
afterAll(async () => {
  for (const d of tmps) await rm(d, { recursive: true, force: true });
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "picker-"));
  tmps.push(d);
  return d;
}

async function upstream(): Promise<{ url: string; server: Server; hits: string[] }> {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url} ae=${req.headers["accept-encoding"] ?? "-"}`);
    if (req.url === "/data.json") return void res.writeHead(200, { "content-type": "application/json" }).end('{"a":1}');
    if (req.url === "/nergens") return void res.writeHead(404, { "content-type": "text/plain" }).end("weg");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end('<html><body><h1 id="titel">Hoi</h1></body></html>');
  });
  // WebSocket-achtige verbinding (hot reload): bevestig de upgrade en echo daarna alles.
  const upgraded = new Set<net.Socket>();
  server.on("upgrade", (req, socket) => {
    upgraded.add(socket as net.Socket);
    hits.push(`UPGRADE ${req.url}`);
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.on("data", (d) => socket.write(d));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => new Promise<void>((r) => (upgraded.forEach((u) => u.destroy()), server.closeAllConnections(), server.close(() => r()))));
  return { url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/`, server, hits };
}

describe("klik-en-beschrijf: pickerscript in de preview", () => {
  it("injectPicker zet het script voor </body> of aan het eind en laat de rest staan", () => {
    expect(injectPicker("<html><body>x</body></html>")).toBe(`<html><body>x<script src="${SCRIPT_PATH}"></script></body></html>`);
    expect(injectPicker("<p>zonder body</p>")).toBe(`<p>zonder body</p><script src="${SCRIPT_PATH}"></script>`);
    expect(injectPicker("<BODY>x</BODY >")).toContain(`<script src="${SCRIPT_PATH}"></script></BODY >`);
  });

  it("de tussenserver voegt het script toe aan HTML, laat andere bestanden en foutcodes ongemoeid en serveert het script zelf", async () => {
    const up = await upstream();
    const proxy: PickerProxy = await startPickerProxy(up.url);
    closers.push(() => proxy.close());
    expect(proxy.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const html = await (await fetch(proxy.url, { headers: { "accept-encoding": "gzip" } })).text();
    expect(html).toContain(`<script src="${SCRIPT_PATH}"></script></body>`);
    expect(html).toContain('<h1 id="titel">Hoi</h1>');
    const res = await fetch(proxy.url);
    expect(res.headers.get("content-length")).toBe(String(Buffer.byteLength(await res.text())));
    expect(await (await fetch(`${proxy.url}data.json`)).json()).toEqual({ a: 1 });
    const missing = await fetch(`${proxy.url}nergens`);
    expect([missing.status, await missing.text()]).toEqual([404, "weg"]);
    const script = await fetch(`${proxy.url}__studio/picker.js`);
    expect(script.headers.get("content-type")).toContain("javascript");
    expect(await script.text()).toContain("studio-pick");
    expect(up.hits.some((h) => h.includes("ae=gzip"))).toBe(false); // geen compressie doorgeven: dan kunnen we de HTML lezen
    expect(up.hits.some((h) => h.includes("picker.js"))).toBe(false); // het script komt van de tussenserver, niet van het project
  });

  it("geeft WebSocket-verbindingen (hot reload) door", async () => {
    const up = await upstream();
    const proxy = await startPickerProxy(up.url);
    closers.push(() => proxy.close());
    const port = Number(new URL(proxy.url).port);
    const antwoord = await new Promise<string>((resolve, reject) => {
      const s = net.connect(port, "127.0.0.1", () => s.write("GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n"));
      let buf = "";
      s.on("data", (d) => {
        buf += d.toString();
        if (buf.includes("101") && !buf.includes("ping")) s.write("ping");
        if (buf.includes("ping")) {
          s.destroy();
          resolve(buf);
        }
      });
      s.on("error", reject);
      setTimeout(() => reject(new Error("time-out")), 5000);
    });
    expect(antwoord).toContain("101 Switching Protocols");
    expect(antwoord).toContain("ping");
    expect(up.hits).toContain("UPGRADE /ws");
  });

  it("de bestemming moet loopback zijn en de tussenserver luistert alleen op 127.0.0.1", async () => {
    await expect(startPickerProxy("http://example.com/")).rejects.toThrow(/localhost|127\.0\.0\.1/);
    await expect(startPickerProxy("javascript:alert(1)")).rejects.toThrow();
  });

  it("meldt een onbereikbare preview in gewone taal (502)", async () => {
    const proxy = await startPickerProxy("http://127.0.0.1:1/");
    closers.push(() => proxy.close());
    const r = await fetch(proxy.url);
    expect([r.status, await r.text()]).toEqual([502, "De preview is niet bereikbaar."]);
  });
});

describe("klik-en-beschrijf: schermafbeelding van het onderdeel", () => {
  it("writePick bewaart in .studio/picks, houdt .studio/ uit git en ruimt oude op", async () => {
    const dir = await tmp();
    execFileSync("git", ["init", "-q"], { cwd: dir });
    await writeFile(path.join(dir, "index.html"), "x");
    const p = await writePick(dir, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(p).toMatch(/^\.studio\/picks\/pick-\d+\.jpg$/);
    expect(existsSync(path.join(dir, p))).toBe(true);
    expect(await readFile(path.join(dir, ".git/info/exclude"), "utf8")).toContain(".studio/");
    await ensureExcluded(dir);
    expect((await readFile(path.join(dir, ".git/info/exclude"), "utf8")).match(/\.studio\//g)).toHaveLength(1);
    execFileSync("git", ["add", "-A"], { cwd: dir });
    expect(execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: dir, encoding: "utf8" }).trim()).toBe("index.html"); // niets uit .studio
    const picks = path.join(dir, ".studio/picks");
    await mkdir(picks, { recursive: true });
    for (let i = 1; i <= 40; i++) await writeFile(path.join(picks, `pick-${i}.jpg`), "x");
    await writeFile(path.join(picks, "eigen-bestand.txt"), "blijft");
    await writePick(dir, Buffer.from([1]));
    const left = await readdir(picks);
    expect(left.filter((f) => f.startsWith("pick-")).length).toBe(30);
    expect(left).toContain("eigen-bestand.txt");
  });

  it("via de runtime: picker.url start de tussenserver zonder het project te wijzigen; picker.shot maakt een afbeelding van het onderdeel (zonder browser: overgeslagen)", async (ctx) => {
    const up = await upstream();
    const dir = await tmp();
    execFileSync("git", ["init", "-q"], { cwd: dir });
    await writeFile(path.join(dir, "index.html"), '<h1 id="titel">Hoi</h1>');
    await writeFile(path.join(dir, "studio.json"), JSON.stringify({ previewUrl: up.url }));
    const before = (await readdir(dir)).sort();
    const rt = new Runtime({ projectDir: dir, projectName: "t" });
    closers.push(() => rt.close());
    const { url } = (await rt.control("picker.url")) as { url: string };
    expect(await (await fetch(url)).text()).toContain(SCRIPT_PATH);
    expect(((await rt.control("picker.url")) as { url: string }).url).toBe(url); // hergebruikt
    expect((await readdir(dir)).sort()).toEqual(before); // geen bestand in het project aangeraakt
    expect(await readFile(path.join(dir, "index.html"), "utf8")).toBe('<h1 id="titel">Hoi</h1>');
    let shot: { path: string; found: boolean };
    try {
      shot = (await rt.control("picker.shot", { selector: "#titel", path: "/" })) as typeof shot;
    } catch (e) {
      if (/Geen browser/.test((e as Error).message)) return ctx.skip();
      throw e;
    }
    expect(shot.found).toBe(true);
    expect(shot.path).toMatch(/^\.studio\/picks\/pick-\d+\.jpg$/);
    expect((await readFile(path.join(dir, shot.path))).subarray(0, 2).toString("hex")).toBe("ffd8");
    const nergens = (await rt.control("picker.shot", { selector: "#bestaat-niet", path: "/" })) as { found: boolean };
    expect(nergens.found).toBe(false); // valt terug op het hele scherm
    await expect(rt.control("picker.shot", { selector: "h1", path: "http://evil.example/" })).rejects.toThrow(/buiten de preview/);
  });

  it("preview.thumbnail geeft een JPEG-data-URL voor het homescherm en schrijft niets in het project (zonder browser: overgeslagen)", async (ctx) => {
    const up = await upstream();
    const dir = await tmp();
    execFileSync("git", ["init", "-q"], { cwd: dir });
    await writeFile(path.join(dir, "index.html"), "<h1>Hoi</h1>");
    await writeFile(path.join(dir, "studio.json"), JSON.stringify({ previewUrl: up.url }));
    const before = (await readdir(dir)).sort();
    const rt = new Runtime({ projectDir: dir, projectName: "t" });
    closers.push(() => rt.close());
    let r: { data_url: string };
    try {
      r = (await rt.control("preview.thumbnail")) as typeof r;
    } catch (e) {
      if (/Geen browser/.test((e as Error).message)) return ctx.skip();
      throw e;
    }
    expect(r.data_url).toMatch(/^data:image\/jpeg;base64,/);
    expect(Buffer.from(r.data_url.split(",")[1], "base64").subarray(0, 2).toString("hex")).toBe("ffd8");
    expect((await readdir(dir)).sort()).toEqual(before);
  });
});
