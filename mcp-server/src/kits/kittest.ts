import { createServer } from "node:http";
import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCommand } from "../proc.js";
import { applyKit, type Run } from "./apply.js";
import { loadKit } from "./registry.js";
import { launchBrowser } from "../preview.js";
import { checkProject } from "./check.js";

export interface StepReport {
  naam: string;
  status: "gelukt" | "mislukt" | "overgeslagen";
  detail?: string;
}

export const realRun: Run = async (command, cwd) => {
  const r = await runCommand(command, cwd, 10 * 60 * 1000);
  return { exitCode: r.timedOut ? null : r.exitCode, output: r.output };
};

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

/** Serveert een map tijdelijk op 127.0.0.1 (alleen voor de screenshot). */
async function serve(dir: string): Promise<{ url: string; close: () => void }> {
  const root = path.resolve(dir);
  const server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const file = path.resolve(root, "." + (rel.endsWith("/") ? rel + "index.html" : rel));
    if (!file.startsWith(root)) return void res.writeHead(403).end();
    readFile(file)
      .then((b) => res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" }).end(b))
      .catch(() => res.writeHead(404).end());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}/`, close: () => server.close() };
}

/** De browser geeft kleuren als rgb(…) terug; maak #hex vergelijkbaar. */
function norm(v: string): string {
  const t = v.trim().toLowerCase();
  const m = /^#([0-9a-f]{6})$/.exec(t);
  return m ? `rgb(${parseInt(m[1].slice(0, 2), 16)}, ${parseInt(m[1].slice(2, 4), 16)}, ${parseInt(m[1].slice(4, 6), 16)})` : t;
}

export interface KitTestOptions {
  root: string;
  kitId: string;
  /** Schrijf het screenshot naar design-packs/<id>/preview.png. */
  updatePreview?: boolean;
  /** Voor tests: hergebruik dit commando i.p.v. echt npm. */
  run?: Run;
  log?: (s: string) => void;
}

/** Past de kit toe op een leeg template in een tijdelijke map en draait install, build, lint en kit-check. */
export async function kitTest(o: KitTestOptions): Promise<StepReport[]> {
  const log = o.log ?? (() => undefined);
  const packs = path.join(o.root, "design-packs");
  const steps: StepReport[] = [];
  const run = o.run ?? realRun;
  const step = async (naam: string, f: () => Promise<string | void>): Promise<boolean> => {
    log(`… ${naam}`);
    try {
      const detail = await f();
      steps.push({ naam, status: "gelukt", detail: detail || undefined });
      return true;
    } catch (e) {
      steps.push({ naam, status: "mislukt", detail: (e as Error).message.split("\n").slice(0, 12).join("\n") });
      return false;
    }
  };

  let loaded: ReturnType<typeof loadKit> | undefined;
  if (!(await step("kit lezen en controleren", async () => void (loaded = loadKit(packs, o.kitId))))) return steps;
  const kit = loaded!.kit;
  const stack = kit.stacks[0];
  if (stack !== "react-vite") {
    steps.push({ naam: `bouwen (${stack})`, status: "overgeslagen", detail: `Geen testtemplate of toolchain voor ${stack} in deze omgeving; alleen bestanden gegenereerd en gecontroleerd.` });
    return steps;
  }
  const tmp = await mkdtemp(path.join(tmpdir(), `kit-test-${o.kitId}-`));
  try {
    await step("template kopiëren", async () => {
      await cp(path.join(o.root, "templates", "web-react-vite"), tmp, { recursive: true });
    });
    if (!(await step("npm install (template)", async () => {
      const r = await run("npm install --ignore-scripts --no-audit --no-fund", tmp);
      if (r.exitCode !== 0) throw new Error(r.output.split("\n").slice(-8).join("\n"));
    }))) return steps;
    if (!(await step("kit toepassen", async () => {
      const r = await applyKit({ packsDir: packs, projectDir: tmp, kitId: o.kitId, run });
      return `${r.files.length} bestanden, pakketten: ${r.plan.pakketten.join(", ") || "geen"}`;
    }))) return steps;
    await step("voorbeeldpagina plaatsen", async () => {
      await cp(path.join(packs, o.kitId, kit.voorbeeld), path.join(tmp, "src", "App.tsx"));
    });
    for (const [naam, cmd] of [["build", "npm run build"], ["lint", "npm run lint"]] as const) {
      await step(naam, async () => {
        const r = await run(cmd, tmp);
        if (r.exitCode !== 0) throw new Error(r.output.split("\n").slice(-14).join("\n"));
      });
    }
    await step("kit-check", async () => {
      const res = await checkProject(tmp);
      if (res.findings.length) throw new Error(res.findings.slice(0, 10).map((f) => `${f.file}:${f.line} ${f.message}`).join("\n"));
      return `${res.scanned} bestanden gecontroleerd`;
    });
    await step("tokens in de browser", async () => {
      const dist = path.join(tmp, "dist");
      if (!existsSync(path.join(dist, "index.html"))) throw new Error("dist/index.html ontbreekt.");
      const srv = await serve(dist);
      let browser;
      try {
        browser = await launchBrowser();
        const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
        await page.goto(srv.url, { waitUntil: "networkidle" });
        const first = Object.keys(kit.setup.tokenMap)[0];
        if (first) {
          const want = (await readFile(path.join(tmp, "src", "kit", "tokens.css"), "utf8")).match(new RegExp(`${first}:\\s*([^;]+);`))?.[1]?.trim();
          const got = (await page.evaluate((n: string) => getComputedStyle(document.documentElement).getPropertyValue(n), first)) as string;
          if (want && norm(got) !== norm(want)) throw new Error(`${first} is ${got.trim()} in de browser, verwacht ${want}.`);
        }
        const text = ((await page.textContent("body")) ?? "").trim();
        if (!text) throw new Error("De pagina is leeg.");
        if (o.updatePreview) {
          await page.screenshot({ path: path.join(packs, o.kitId, kit.preview) });
        } else {
          await mkdir(path.join(tmp, ".shots"), { recursive: true });
        }
      } finally {
        await browser?.close();
        srv.close();
      }
    });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return steps;
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  await writeFile(file, JSON.stringify(data, null, 2) + "\n");
}
