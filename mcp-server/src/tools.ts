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
export const MAX_TITLE_WORDS = 8;
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

  // Toestemmingen voor de chat-weergave: `claude --permission-prompt-tool mcp__studio__permission_prompt`.
  // Moet één tekstblok met JSON teruggeven en geen structuredContent (dus geen outputSchema), zie docs/cli-notes.md.
  server.registerTool(
    "permission_prompt",
    {
      description: "Interne tool van Studio: vraagt de gebruiker om toestemming voor een actie van de AI. Niet zelf aanroepen.",
      inputSchema: {
        tool_name: z.string().optional(),
        input: z.record(z.string(), z.unknown()).optional(),
        tool_use_id: z.string().optional(),
      },
    },
    ({ tool_name, input, tool_use_id }) =>
      run("permission_prompt", "", async () => {
        if (!tool_name) return JSON.stringify({ behavior: "deny", message: "Onleesbare toestemmingsvraag; de actie is niet uitgevoerd." });
        const r = await rt.requestPermission(tool_name, input ?? {}, tool_use_id);
        return JSON.stringify(r.allow ? { behavior: "allow", updatedInput: input ?? {} } : { behavior: "deny", message: r.message ?? "De gebruiker heeft dit niet toegestaan." });
      }),
  );

  server.registerTool(
    "run_checks",
    {
      description:
        "Draait de checks van het project en geeft per stap geslaagd/mislukt met de relevante foutregels (max 200). Heeft het project een gekozen UI-kit, dan draait ook de stap ‘kit’: die meldt losse kleuren, losse pixelwaarden, gewone HTML-onderdelen waar de kit een component voor heeft en imports uit andere UI-bibliotheken (status ‘warned’ = waarschuwing, ‘failed’ = geblokkeerd; herstel ze). Bij een project met lint-/build-/test-scripts (package.json of studio.json) draaien die; bij een statisch project (index.html) controleert het: html (aanwezig), links (geen kapotte lokale verwijzingen) en console (geen console- of netwerkfouten in de preview). Roep dit aan na elke wijziging.",
      inputSchema: { steps: z.array(z.enum(["lint", "build", "test", "kit", "html", "links", "console"])).optional() },
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
        "Screenshot (JPEG) van de preview, genomen met een onzichtbare browser. Werkt voor statische projecten (index.html) en dev-servers; de preview moet draaien (Studio start hem vanzelf). Optioneel viewport (desktop 1280x800 of mobile 390x844), een pad binnen de preview (bijv. /over) en fullPage.",
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
        const plan = rt.getPlan();
        if (!logs.length && plan?.kind === "static") {
          return `Statische preview${plan.staticUrl ? ` op ${plan.staticUrl}` : ""}: er is geen dev-proces en dus geen dev-logs. Gebruik get_console_errors voor fouten in de browser.`;
        }
        const head = `dev-server: ${st.state}${st.error ? ` (${st.error})` : ""}`;
        if (!logs.length) return `${head}\n(nog geen uitvoer; start de dev-server via de Preview-tab)`;
        return `${head}\n${logs.join("\n")}`;
      }),
  );

  server.registerTool(
    "git_checkpoint",
    {
      description:
        "Slaat een versie op (git add -A + commit). Het bericht is een titel van maximaal 8 woorden in gewone taal, zonder jargon; de gebruiker ziet die in zijn tijdlijn. Gevoelige bestanden (.env, sleutels) worden nooit meegenomen. Doe dit pas als run_checks slaagt.",
      inputSchema: { bericht: z.string().min(1).max(200) },
    },
    ({ bericht }) =>
      run("git_checkpoint", `len=${bericht.length}`, async () => {
        // De titel is bedoeld voor mensen (tijdlijn in Studio): kort en in gewone taal.
        const words = bericht.trim().split(/\s+/).length;
        if (words > MAX_TITLE_WORDS) throw new Error(`Gebruik een titel van maximaal ${MAX_TITLE_WORDS} woorden in gewone taal (nu ${words}).`);
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
