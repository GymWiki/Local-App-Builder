import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveInside } from "./paths.js";

const exec = promisify(execFile);
export const NOTES_FILE = "PROJECT.md";
const MAX_NOTES_BYTES = 1_000_000;

export interface ProjectCtx {
  projectDir: string;
  projectName: string;
}

export interface CallRecord {
  tool: string;
  ok: boolean;
  ms: number;
  /** Alleen metadata (sleutels/groottes), nooit inhoud of tokens. */
  summary: string;
}

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
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
  async function run(tool: string, summary: string, fn: () => Promise<string>): Promise<Result> {
    const start = Date.now();
    try {
      const out = await fn();
      record({ tool, ok: true, ms: Date.now() - start, summary });
      return text(out);
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
}
