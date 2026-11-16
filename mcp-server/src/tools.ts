import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveInside } from "./paths.js";
import type { Runtime } from "./runtime.js";

const exec = promisify(execFile);
export const NOTES_FILE = "PROJECT.md";
const MAX_NOTES_BYTES = 1_000_000;

export interface ProjectCtx {
  projectDir: string;
  projectName: string;
  runtime?: Runtime;
}

export interface CallRecord {
  tool: string;
  ok: boolean;
  ms: number;
  /** Alleen metadata (sleutels/groottes), nooit inhoud of tokens. */
  summary: string;
}

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type Result = { content: Content[]; isError?: boolean };
const text = (t: string, isError = false): Result => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });

export async function readNotes(ctx: ProjectCtx): Promise<string> {
  const file = await resolveInside(ctx.projectDir, NOTES_FILE);
  try {
    return await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
}

export async function writeNotes(ctx: ProjectCtx, content: string, mode: "replace" | "append"): Promise<number> {
  if (Buffer.byteLength(content) > MAX_NOTES_BYTES) throw new Error("Notities zijn te groot (max 1 MB).");
  const file = await resolveInside(ctx.projectDir, NOTES_FILE);
  const next = mode === "append" ? (await readNotes(ctx)) + content : content;
  if (Buffer.byteLength(next) > MAX_NOTES_BYTES) throw new Error("Notities zijn te groot (max 1 MB).");
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.studio-tmp`;
  await writeFile(tmp, next, "utf8");
  await rename(tmp, file);
  return Buffer.byteLength(next);
}

export async function gitStatus(ctx: ProjectCtx): Promise<string> {
  try {
    const { stdout } = await exec("git", ["status", "--porcelain=v1", "--branch"], {
      cwd: ctx.projectDir,
      timeout: 10_000,
      windowsHide: true,
    });
    return stdout.trim();
  } catch (e) {
    return `git-status niet beschikbaar: ${(e as Error).message.split("\n")[0]}`;
  }
}

export function registerTools(server: McpServer, ctx: ProjectCtx, record: (r: CallRecord) => void): void {
  async function run(tool: string, summary: string, fn: () => Promise<string | Content[]>): Promise<Result> {
    const start = Date.now();
    try {
      const out = await fn();
      record({ tool, ok: true, ms: Date.now() - start, summary });
      return typeof out === "string" ? text(out) : { content: out };
    } catch (e) {
      record({ tool, ok: false, ms: Date.now() - start, summary });
      return text((e as Error).message, true);
    }
  }

  server.registerTool(
    "project_status",
    { description: "Naam, pad, inhoud van PROJECT.md en git-status van het huidige project." },
    () =>
      run("project_status", "", async () => {
        const [notes, git] = await Promise.all([readNotes(ctx), gitStatus(ctx)]);
        return JSON.stringify({ naam: ctx.projectName, pad: ctx.projectDir, project_md: notes, git_status: git }, null, 2);
      }),
  );

  server.registerTool(
    "read_project_notes",
    { description: "Lees PROJECT.md van het huidige project." },
    () => run("read_project_notes", "", () => readNotes(ctx)),
  );

  server.registerTool(
    "update_project_notes",
    {
      description:
        "Schrijf naar PROJECT.md (het enige bestand dat deze tool aanraakt). mode=replace vervangt alles, mode=append voegt toe aan het einde.",
      inputSchema: { content: z.string(), mode: z.enum(["replace", "append"]).default("replace") },
    },
    ({ content, mode }) =>
      run("update_project_notes", `mode=${mode} bytes=${Buffer.byteLength(content)}`, async () => {
        const n = await writeNotes(ctx, content, mode);
        return `PROJECT.md bijgewerkt (${n} bytes).`;
      }),
  );

  const rt = ctx.runtime;
  if (!rt) return;

  server.registerTool(
    "run_checks",
    {
      description:
        "Draait lint, build en tests uit studio.json (in die volgorde) en geeft per stap geslaagd/mislukt met de relevante foutregels (max 200). Roep dit aan na elke wijziging.",
      inputSchema: { steps: z.array(z.enum(["lint", "build", "test"])).optional() },
    },
    ({ steps }) =>
      run("run_checks", `steps=${(steps ?? ["lint", "build", "test"]).join(",")}`, async () => {
        const r = await rt.runChecks(steps);
        const head = r.ok ? "ALLE CHECKS GESLAAGD" : "CHECKS MISLUKT";
        return `${head}\n` + JSON.stringify(r, null, 2);
      }),
  );

  server.registerTool(
    "get_preview_screenshot",
    {
      description:
        "Screenshot (JPEG) van de preview, genomen met een onzichtbare browser. De dev-server moet draaien. Optioneel viewport (desktop 1280x800 of mobile 390x844), een pad binnen de preview (bijv. /over) en fullPage.",
      inputSchema: {
        viewport: z.enum(["desktop", "mobile"]).default("desktop"),
        path: z.string().max(500).optional(),
        fullPage: z.boolean().default(false),
      },
    },
    ({ viewport, path: p, fullPage }) =>
      run("get_preview_screenshot", `viewport=${viewport}`, async () => {
        const shot = await rt.observer.screenshot({ viewport, path: p, fullPage });
        return [
          { type: "image", data: shot.data.toString("base64"), mimeType: "image/jpeg" },
          { type: "text", text: `Screenshot van ${shot.url} (${viewport}, ${shot.width}x${shot.height}).` },
        ];
      }),
  );

  server.registerTool(
    "get_console_errors",
    {
      description:
        "Console-errors, uncaught exceptions en mislukte netwerkverzoeken van de preview sinds de vorige aanroep. Laadt de pagina standaard opnieuw. Let op: dit is een onzichtbare browser; handelingen die de gebruiker zelf in de preview doet zie je hier niet.",
      inputSchema: { reload: z.boolean().default(true) },
    },
    ({ reload }) =>
      run("get_console_errors", `reload=${reload}`, async () => {
        const e = await rt.observer.consoleErrors(reload);
        return e.length ? JSON.stringify(e, null, 2) : "Geen console- of netwerkfouten sinds de vorige aanroep.";
      }),
  );

  server.registerTool(
    "get_dev_logs",
    {
      description: "De laatste regels uitvoer van het dev-proces (standaard 100, max 500).",
      inputSchema: { lines: z.number().int().min(1).max(500).default(100) },
    },
    ({ lines }) =>
      run("get_dev_logs", `lines=${lines}`, async () => {
        const st = rt.dev.status();
        const logs = rt.dev.logs.last(lines);
        const head = `dev-server: ${st.state}${st.error ? ` (${st.error})` : ""}`;
        if (!logs.length) return `${head}\n(nog geen uitvoer; start de dev-server via de Preview-tab)`;
        return `${head}\n${logs.join("\n")}`;
      }),
  );

  server.registerTool(
    "git_checkpoint",
    {
      description:
        "Maakt een checkpoint: git add -A + commit met het bericht. Gevoelige bestanden (.env, sleutels) worden nooit meegenomen. Doe dit pas als run_checks slaagt.",
      inputSchema: { bericht: z.string().min(1).max(200) },
    },
    ({ bericht }) =>
      run("git_checkpoint", `len=${bericht.length}`, async () => {
        const r = await rt.control("git.checkpoint", { message: bericht });
        return JSON.stringify(r, null, 2);
      }),
  );

  server.registerTool(
    "git_list_checkpoints",
    {
      description: "Lijst met de laatste checkpoints (nieuwste eerst).",
      inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
    },
    ({ limit }) =>
      run("git_list_checkpoints", `limit=${limit}`, async () => {
        const l = await rt.git.list(limit);
        return l.length ? l.map((c) => `${c.short}  ${c.date}  ${c.message}`).join("\n") : "Nog geen checkpoints.";
      }),
  );
}
