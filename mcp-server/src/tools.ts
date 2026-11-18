import { securityCheck } from "./security.js";
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

  // De AI meldt dat de app opslag nodig heeft (bijvoorbeeld bestellingen). Studio toont dan het onderdeel "Gegevens" in het menu.
  // Alleen een klein bestand in .studio/ binnen het project; er wordt niets geïnstalleerd of uitgevoerd.
  server.registerTool(
    "needs_data",
    {
      description:
        "Meld aan Studio dat deze app gegevens moet onthouden (zoals bestellingen, inschrijvingen of gebruikers) en dus opslag nodig heeft. Studio laat de gebruiker dan het onderdeel ‘Gegevens’ zien. Geef in `reden` één korte zin in gewone taal. Er wordt niets aangemaakt of geïnstalleerd; kies zelf eerst met de gebruiker hoe de opslag moet komen.",
      inputSchema: { reden: z.string().min(1).max(300) },
    },
    ({ reden }) =>
      run("needs_data", `len=${reden.length}`, async () => {
        const dir = await resolveInside(ctx.projectDir, ".studio");
        await mkdir(dir, { recursive: true });
        const file = await resolveInside(ctx.projectDir, ".studio/needs-data.json");
        await writeFile(file, JSON.stringify({ reden: reden.slice(0, 300), op: new Date().toISOString() }) + "\n");
        return "Genoteerd: Studio laat de gebruiker nu het onderdeel ‘Gegevens’ zien.";
      }),
  );

  const rt = ctx.runtime;
  if (!rt) return;

  // Koppelingen met diensten van de gebruiker (GitHub, Vercel, Supabase). De AI ziet alleen óf iets gekoppeld is, nooit sleutels.
  server.registerTool(
    "koppelingen_status",
    {
      description:
        "Toont welke diensten de gebruiker aan Studio heeft gekoppeld (github, vercel, supabase) en of die werken. Geeft nooit sleutels of accountgegevens. Is een dienst niet gekoppeld, zeg dat dan in gewone woorden en gebruik `koppeling_voorstellen`; probeer nooit zelf een sleutel te vragen of te gebruiken.",
      inputSchema: {},
    },
    () =>
      run("koppelingen_status", "", async () => {
        const r = (await rt.hostCall("connect.status", {}, 15_000)) as { id: string; gekoppeld: boolean; werkt: boolean }[];
        return JSON.stringify({ koppelingen: r });
      }),
  );

  server.registerTool(
    "koppeling_voorstellen",
    {
      description:
        "Laat de gebruiker in het gesprek een knop ‘Verbinden’ zien voor een dienst die nodig is (github, vercel of supabase). De gebruiker verbindt altijd zelf; er gebeurt niets zonder zijn klik. Geef in `reden` één korte zin in gewone taal waarom dit nodig is.",
      inputSchema: { dienst: z.enum(["github", "vercel", "supabase"]), reden: z.string().min(1).max(200) },
    },
    ({ dienst, reden }) =>
      run("koppeling_voorstellen", `dienst=${dienst}`, async () => {
        await rt.hostCall("connect.propose", { dienst, reden: reden.slice(0, 200) }, 15_000);
        return "De knop staat in het gesprek. Wacht tot de gebruiker heeft verbonden; vraag nooit zelf om een sleutel.";
      }),
  );

  // ---- Supabase (de gebruiker koppelt zijn eigen account). Studio voert alles zelf uit en bewaart alle sleutels; de AI krijgt alleen een uitslag.
  type HostReply = { status: "uitgevoerd" | "geweigerd" | "mislukt"; tekst: string; data?: unknown };
  const dbTool = (naam: string, cmd: string, beschrijving: string, inputSchema: z.ZodRawShape, schrijft: boolean) =>
    server.registerTool(naam, { description: beschrijving, inputSchema }, (args: Record<string, unknown>) =>
      run(naam, schrijft ? "schrijfactie" : "lezen", async () => {
        const r = (await rt.hostCall(cmd, args, schrijft ? 12 * 60 * 1000 : 60_000)) as HostReply;
        const kop = r.status === "uitgevoerd" ? "UITGEVOERD" : r.status === "geweigerd" ? "GEWEIGERD" : "MISLUKT";
        const tekst = `${kop}: ${r.tekst}${r.data === undefined || r.data === null ? "" : `\n${JSON.stringify(r.data)}`}`;
        // Een geweigerde of mislukte actie is voor de AI een fout, zodat hij niet doet alsof het gelukt is.
        if (r.status !== "uitgevoerd") throw new Error(tekst);
        return tekst;
      }),
    );
  const SQL = z.string().min(1).max(100_000);
  const UITLEG = z.string().max(500).optional();
  const NAAM = z.string().min(1).max(80);
  const LEES = "Alleen lezen en altijd toegestaan. ";
  const SCHRIJF = "Studio voert dit zelf uit met de gekoppelde Supabase-account van de gebruiker; je krijgt nooit sleutels te zien. Afhankelijk van het bedieningsniveau en de risicoklasse vraagt Studio de gebruiker om bevestiging in de app (dat kan even duren) of weigert het. De uitslag begint met UITGEVOERD, GEWEIGERD of MISLUKT: doe nooit alsof een geweigerde actie is gelukt. ";
  dbTool("db_status", "db.status", LEES + "Is het project gekoppeld aan Supabase, hoe heet het, in welke regio, is het gepauzeerd en welk bedieningsniveau geldt?", {}, false);
  dbTool("db_get_public_config", "db.public_config", LEES + "De project-URL en de publiceerbare sleutel (veilig voor in de app). Nooit de geheime sleutel of het wachtwoord.", {}, false);
  dbTool("db_list_tables", "db.list_tables", LEES + "Tabellen in het publieke schema met kolommen, of RLS aan staat en welk beleid er is.", {}, false);
  dbTool("db_run_readonly_query", "db.readonly", LEES + "Voert één SELECT uit (anders weigert Studio). Het resultaat is begrensd op maximaal 200 rijen.", { sql: SQL, limiet: z.number().int().min(1).max(200).optional() }, false);
  dbTool("db_get_logs", "db.logs", LEES + "De laatste logregels van een onderdeel.", { bron: z.enum(["api", "database", "auth", "functies", "opslag"]), minuten: z.number().int().min(1).max(1440).optional() }, false);
  dbTool("db_get_advisors", "db.advisors", LEES + "Adviezen van Supabase over veiligheid en snelheid.", {}, false);
  dbTool("db_generate_types", "db.types", LEES + "TypeScript-typen van het publieke schema.", {}, false);
  dbTool("db_propose_migration", "db.propose", "Schrijft een voorstel voor een migratie als bestand in supabase/migrations/ (met tijdstempel). Voert NIETS uit; de gebruiker kan het eerst bekijken. Nieuwe tabellen in het publieke schema krijgen automatisch RLS aan; schrijf er beleid per rol bij. Gebruik `db_apply_migration` om het toe te passen.", { naam: NAAM, sql: SQL, uitleg: UITLEG }, true);
  dbTool("db_apply_migration", "db.apply", SCHRIJF + "Past een migratie toe (schrijft ook het bestand in supabase/migrations/). Geef in `uitleg` één korte zin in gewone taal waarom.", { naam: NAAM, sql: SQL, uitleg: UITLEG }, true);
  dbTool("db_rollback_migration", "db.rollback", SCHRIJF + "Draait de laatste toegepaste migratie terug, alleen als Studio weet hoe (bijvoorbeeld een nieuwe tabel weer weghalen). Anders: schrijf een nieuwe migratie.", { naam: NAAM }, true);
  dbTool("db_run_sql", "db.run_sql", SCHRIJF + "Voert SQL uit (één of meer instructies). Studio deelt elke instructie in: lezen, veilig schrijven, gevaarlijk (verwijderen, wijzigen, RLS uit, rechten) of onleesbaar (telt als gevaarlijk). Maakt vooraf een checkpoint, een momentopname van het schema en bij gevaarlijke acties een back-up. Geef in `uitleg` één korte zin in gewone taal waarom.", { sql: SQL, uitleg: UITLEG }, true);
  dbTool("db_deploy_edge_function", "db.deploy", SCHRIJF + "Plaatst een edge function (één bestand, Deno/TypeScript).", { naam: NAAM, code: z.string().min(1).max(200_000) }, true);
  dbTool("db_set_edge_secret", "db.secret", SCHRIJF + "Zet een geheim voor edge functions (alleen schrijven; niemand kan de waarde daarna nog lezen, ook jij niet). Overschrijven van een bestaand geheim is gevaarlijk.", { naam: NAAM, waarde: z.string().min(1).max(48 * 1024) }, true);
  dbTool("db_manage_storage", "db.storage", SCHRIJF + "Opslagmappen: `lijst` of `maken` (altijd privé). Beleid voor bestanden zet je met db_run_sql op storage.objects (dat is altijd gevaarlijk).", { actie: z.enum(["lijst", "maken"]), naam: z.string().max(63).optional(), publiek: z.boolean().optional() }, true);
  dbTool("db_configure_auth", "db.auth", SCHRIJF + "Wijzigt inlog-instellingen (alleen site_url, uri_allow_list, mailer_autoconfirm, disable_signup en external_email_enabled). Altijd gevaarlijk.", { instellingen: z.record(z.string(), z.unknown()) }, true);
  dbTool("db_pause_project", "db.pause", SCHRIJF + "Pauzeert het Supabase-project (gevaarlijk: de app is dan offline).", {}, true);
  dbTool("db_restore_project", "db.restore", SCHRIJF + "Maakt een gepauzeerd project weer wakker.", {}, true);
  dbTool("db_create_project", "db.create", SCHRIJF + "Maakt een nieuw Supabase-project (regio Europa) en koppelt het. Dit kan geld kosten en vraagt daarom ALTIJD een kostenbevestiging van de gebruiker, in elk niveau.", { naam: NAAM, organisatie: z.string().max(80).optional() }, true);

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
    "security_check",
    {
      description:
        "Controleert het project op veiligheid vóór publiceren: API-sleutels of tokens in de code, .env- of geheime bestanden in git of in de uitvoermap (dist/build/public), vaste wachtwoorden en ontbrekende toegangsregels voor de database (Supabase row level security, Firebase-regels). Geeft per bevinding een veilige omschrijving (geheimen staan nooit volledig in de uitvoer). Verhelp bevindingen door geheimen naar een .env-bestand te verplaatsen dat niet in git staat; zeg de gebruiker dat een sleutel die in de code stond ook vernieuwd moet worden.",
      inputSchema: {},
    },
    () =>
      run("security_check", "", async () => {
        const r = await securityCheck(rt.projectDir);
        if (r.findings.length === 0) return `GEEN PROBLEMEN GEVONDEN (${r.scanned} bestanden gecontroleerd).`;
        return [`${r.findings.length} BEVINDING(EN) in ${r.scanned} bestanden:`, ...r.findings.map((f) => `- [${f.severity}] ${f.code} — ${f.file}${f.line ? `:${f.line}` : ""} — ${f.detail}`)].join("\n");
      }),
  );

  server.registerTool(
    "get_last_change",
    {
      description:
        "Geeft de laatste wijziging in het project: niet-opgeslagen werk, of anders de laatste versie ten opzichte van de vorige (bestandslijst + wijzigingen, ingekort, zonder geheimen). Gebruik dit om de gebruiker in gewone woorden uit te leggen wat er veranderd is.",
      inputSchema: {},
    },
    () =>
      run("get_last_change", "", async () => {
        const c = await rt.git.lastChange();
        return [`Bron: ${c.source === "werk" ? "nog niet opgeslagen werk" : "laatste versie"} — ${c.title}`, `Bestanden (${c.files.length}): ${c.files.slice(0, 40).join(", ")}`, c.truncated ? "(de wijzigingen hieronder zijn ingekort)" : "", "", c.diff].join("\n");
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
