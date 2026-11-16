import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitFor(what: string, f: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await f()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`time-out: ${what}`);
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

if (!process.env.STUDIO_BROWSER_PATH && existsSync("/opt/pw-browsers/chromium")) {
  process.env.STUDIO_BROWSER_PATH = "/opt/pw-browsers/chromium";
}

const SERVER = `
import { createServer } from "node:http";
const port = Number(process.env.PORT || process.argv[2]);
createServer((req, res) => {
  if (req.url === "/missing") { res.writeHead(404); return res.end("nope"); }
  res.writeHead(200, { "content-type": "text/html" });
  res.end('<!doctype html><html><body style="background:#fde68a"><h1>Voorbeeld</h1><script>console.error("boom-console"); fetch("/missing");</script></body></html>');
}).listen(port, "127.0.0.1", () => console.log("dev server listening on " + port));
setInterval(() => {}, 1000);
`;

const SPAWNER = `
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const c = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
writeFileSync("gc.pid", String(c.pid));
setInterval(() => {}, 1000);
`;

export interface Example {
  dir: string;
  port: number;
  hash: string;
}

/** Klein voorbeeldproject: lint/build/test/dev als losse node-scripts, plus git. `fail-build` in de map laat de build falen. */
export async function makeExample(extra: Record<string, unknown> = {}): Promise<Example> {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-ex-"));
  const port = await freePort();
  await mkdir(path.join(dir, "scripts"));
  await writeFile(path.join(dir, "scripts/lint.mjs"), 'console.log("lint ok");');
  await writeFile(path.join(dir, "scripts/test.mjs"), 'console.log("tests ok");');
  await writeFile(
    path.join(dir, "scripts/build.mjs"),
    `import { existsSync } from "node:fs";
if (existsSync("fail-build")) {
  for (let i = 0; i < 400; i++) console.log("noise line " + i);
  console.error("Error: build broke at src/app.ts:12");
  for (let i = 0; i < 30; i++) console.log("trailing " + i);
  process.exit(1);
}
console.log("build ok");`,
  );
  await writeFile(path.join(dir, "scripts/server.mjs"), SERVER);
  await writeFile(path.join(dir, "scripts/spawner.mjs"), SPAWNER);
  const cfg = {
    dev: `node scripts/server.mjs ${port}`,
    build: "node scripts/build.mjs",
    lint: "node scripts/lint.mjs",
    test: "node scripts/test.mjs",
    previewUrl: `http://127.0.0.1:${port}/`,
    ...extra,
  };
  const raw = JSON.stringify(cfg, null, 2);
  await writeFile(path.join(dir, "studio.json"), raw);
  await writeFile(path.join(dir, "PROJECT.md"), "# Voorbeeld\n");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return { dir, port, hash: createHash("sha256").update(raw).digest("hex") };
}

export const read = (p: string) => readFile(p, "utf8");
