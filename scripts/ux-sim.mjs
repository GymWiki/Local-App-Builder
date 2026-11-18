// UX-simulatie: bedient Studio als een gebruiker (via de browser, met nagebootste Tauri-aanroepen) en legt per stap
// een screenshot en metingen vast (afgekapte tekst, scrollbalken, kleine klikdoelen, Engelse woorden).
// Gebruik: node scripts/ux-sim.mjs <persoon|matrix|fouten> [licht,donker]
// Uitvoer: docs/ux/<persoon>/<nn>-<stap>-<thema>.png en docs/ux/<persoon>/metingen.json
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const THUMB = `data:image/jpeg;base64,${readFileSync(path.join(root, "scripts/fixtures/thumb-demo.jpg")).toString("base64")}`;
const require = createRequire(path.join(root, "mcp-server", "package.json"));
const { chromium } = require("playwright-core");

const { PICKER_SCRIPT } = await import("../mcp-server/src/picker-script.ts");
const DEMO = (naam) => `<!doctype html><html lang="nl"><head><title>${naam}</title><style>:root{--primary:#15803d;--radius-lg:8px;--spacing-md:12px}.knop{padding:12px 20px;border:0;border-radius:var(--radius-lg);background:var(--primary);color:#fff;font-size:16px}</style></head><body style="font-family:Georgia,serif;margin:0;background:#f0fdf4;color:#14532d"><header style="padding:32px;background:#166534;color:#fff"><h1 style="margin:0">${naam}</h1><p>Tuinaanleg, onderhoud en beplanting</p></header><main style="padding:24px"><h2>Wat wij doen</h2><p>Een mooie tuin zonder zorgen.</p><button class="knop" data-slot="button">Vraag een offerte aan</button></main><script src="/__studio/picker.js"></script></body></html>`;
const demo = createServer((req, res) => (req.url === "/__studio/picker.js" ? res.writeHead(200, { "content-type": "text/javascript" }).end(PICKER_SCRIPT) : res.writeHead(200, { "content-type": "text/html" }).end(DEMO("Hovenier Joke"))));
await new Promise((r) => demo.listen(0, "127.0.0.1", r));
const demoUrl = `http://127.0.0.1:${demo.address().port}/`;

const PORT = 1441;
const vite = spawn(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "ignore" });
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break;
  } catch {
    /* nog niet klaar */
  }
  await new Promise((r) => setTimeout(r, 300));
}

// ---- de nagebootste Tauri-kant, mét toestand (draait in de pagina) ----
function mock({ demoUrl, scenario, THUMB }) {
  const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");
  const S = (window.__S = {
    projects: (scenario.seed || []).map((x, i) => ({ id: i + 1, naam: x.naam, pad: `/home/joke/Documenten/${x.naam}`, template: "leeg", created_at: "2026-11-01 10:00:00", default_account_id: null, last_used_at: x.last ?? null })),
    next: (scenario.seed || []).length + 1,
    layouts: {},
    flags: {},
    assets: {},
    descr: {},
    thumbs: Object.fromEntries((scenario.seed || []).map((x, i) => [i + 1, x.thumb === "demo" ? THUMB : (x.thumb ?? null)])),
    accounts: [],
    nextAcc: 1,
    messages: {},
    msgId: 1,
    busy: false,
    preview: {},
    versions: {},
    settings: { theme: scenario.theme, communication_mode: "simple", permission_mode: "important", loop_threshold: "3", preview_auto_switch: "0" },
    cliMissing: !!scenario.cliMissing,
    offline: !!scenario.offline,
    notLoggedIn: !!scenario.notLoggedIn,
    mcpDown: !!scenario.mcpDown,
    speed: 1,
    sent: [],
    opened: [],
    antwoorden: [],
    opslag: {},
    noodknop: 0,
    supaPauze: false,
    supaCheck: scenario.supaCheck || [],
    supaProjecten: [{ reference: "abcdefghij", name: "Winkel", region: "eu-west-1", status: "ACTIVE_HEALTHY" }],
    supa: scenario.supaGekoppeld ? { gekoppeld: true, naam: "Winkel", referentie: "abcdefghij", regio: "eu-west-1", niveau: scenario.supaNiveau || "voorzichtig", volledig_resterend: scenario.supaNiveau === "volledig" ? 1800 : null, volledig_secs: 3600 } : { gekoppeld: false, naam: "", referentie: "", regio: "", niveau: "voorzichtig", volledig_resterend: null, volledig_secs: 3600 },
    supaActies: [
      { id: 3, at: 1763460000, tool: "db_run_sql", class: 3, level: "zelfstandig", status: "uitgevoerd", summary: [{ code: "rijen_verwijderen", params: { tabel: "klanten" } }], detail: { backup: "gemaakt" }, kan_ongedaan: true, undone: false },
      { id: 2, at: 1763459000, tool: "db_run_sql", class: 3, level: "voorzichtig", status: "geweigerd", summary: [{ code: "tabel_verwijderen", params: { tabel: "oud" } }], detail: { code: "niet_toegestaan" }, kan_ongedaan: false, undone: false },
      { id: 1, at: 1763458000, tool: "db_apply_migration", class: 2, level: "zelfstandig", status: "uitgevoerd", summary: [{ code: "tabel_toevoegen", params: { tabel: "bestellingen" } }, { code: "rls_aan_automatisch", params: {} }], detail: {}, kan_ongedaan: true, undone: false },
    ],
    conn: Object.fromEntries(
      ["github", "vercel", "supabase"].map((id) => [
        id,
        { id, strategie: id === "github" ? "oauth_device" : "token_plakken", status: (scenario.connStatus || {})[id] || "niet_gekoppeld", account: (scenario.connStatus || {})[id] === "werkt" ? "pieter" : null, fout: null, bezig: null, verloopt: null },
      ]),
    ),
  });
  S.supaState = () => ({ ...S.supa });
  // ---- GitHub-back-up (nagebootst): koppeling, eerste back-up, bijwerken, uitkomsten
  S.ghLink = scenario.ghLink ?? null;
  S.ghNieuw = scenario.ghNieuw ?? 0;
  S.ghUitkomst = scenario.ghUitkomst ?? null; // een vaste uitkomst voor de volgende back-up (bijvoorbeeld geheimen)
  S.ghVrij = scenario.ghVrij ?? true;
  S.ghState = () => ({ werkt: S.conn.github.status === "werkt", account: S.conn.github.account, link: S.ghLink, versies: 3, nieuw: S.ghNieuw, bezig: false, nu: Math.floor(Date.now() / 1000) });
  window.__stuurActie = (req) => emit("actie-confirm", req);
  window.__stuurBevestiging = (req) => emit("db-confirm", req);
  S.connLijst = () =>
    Object.values(S.conn).map((c) => ({
      ...c,
      rechten: [c.id === "github" ? "repo" : c.id === "vercel" ? "projecten" : "account"],
      functies: [c.id === "github" ? "backup" : c.id === "vercel" ? "onlinezetten" : "gegevens"],
      links: { signup: `https://${c.id}.com/signup`, token_page: `https://${c.id}.com/tokens`, manage: `https://${c.id}.com/apps` },
    }));
  // Test-hulp: de gebruiker heeft op de pagina van de dienst toestemming gegeven (apparaatcode).
  window.__connectDone = (id) => {
    Object.assign(S.conn[id], { status: "werkt", account: "pieter", bezig: null, fout: null });
    emit("connect-changed", null);
  };
  window.__connectFail = (id, fout) => {
    Object.assign(S.conn[id], { status: "niet_gekoppeld", bezig: null, fout });
    emit("connect-changed", null);
  };
  const callbacks = {};
  const listeners = {};
  let nextId = 1;
  const emit = (event, payload) => (listeners[event] || []).forEach((h) => callbacks[h]?.({ event, id: 0, payload }));
  window.__emit = emit;
  const msg = (pid, kind, payload) => {
    const m = { id: S.msgId++, project_id: pid, kind, payload, created_at: now() };
    (S.messages[pid] ||= []).push(m);
    emit("chat-out", { type: "message", project_id: pid, message: m });
    return m;
  };
  const update = (m, payload) => {
    m.payload = payload;
    emit("chat-out", { type: "update", project_id: m.project_id, message: m });
  };
  const status = (pid, state, busy) => {
    S.busy = busy;
    emit("chat-out", { type: "status", project_id: pid, state, busy });
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms * S.speed));
  const mcp = () => (S.mcpDown ? { state: "unavailable", port: null, error: "Node.js is niet gevonden op deze computer.", kind: "node_missing", log: ["spawn node ENOENT"] } : { state: "connected", port: 4000, error: null, kind: null, log: [] });
  const emptyPreview = { mode: "empty", status: "idle", url: null, hmr: false, problem: { kind: "empty", message: "Er zijn nog geen previewbare bestanden.", log: [] }, plan: { entry: null, dev_script: null, needs_install: false } };
  const livePreview = { mode: "static", status: "running", url: demoUrl, hmr: true, problem: null, plan: { entry: "index.html", dev_script: null, needs_install: false } };

  async function simulate(pid, text) {
    msg(pid, "user", { text });
    S.sent.push(text);
    status(pid, "thinking", true);
    await wait(900);
    if (S.offline) {
      msg(pid, "error", { code: "network", technical: "getaddrinfo ENOTFOUND api.anthropic.com", retry: true });
      status(pid, "idle", false);
      return;
    }
    if (S.notLoggedIn) {
      msg(pid, "error", { code: "not_logged_in", technical: "Please run /login", retry: true });
      status(pid, "idle", false);
      return;
    }
    msg(pid, "assistant", { text: "Leuk! Ik maak **een mooie website** voor je bedrijf met:\n\n- een kop met de naam\n- een stukje over wat je doet\n- een knop om contact op te nemen" });
    await wait(900);
    status(pid, "editing", true);
    const a = msg(pid, "action", { kind: "file_created", state: "running", params: { file: "index.html", page: true } });
    await wait(1100);
    update(a, { kind: "file_created", state: "done", params: { file: "index.html", page: true }, summary: "index.html (32 regels)" });
    S.preview[pid] = livePreview;
    emit("preview-state", { project_id: pid, info: livePreview });
    emit("preview-available", { project_id: pid });
    status(pid, "checking", true);
    const c = msg(pid, "action", { kind: "run_checks", state: "running", params: {} });
    await wait(900);
    update(c, { kind: "run_checks", state: "done", params: {}, fixed: false });
    const v = (S.versions[pid] ||= []);
    v.unshift({ hash: `h${v.length + 1}abcdef`.padEnd(10, "0"), short: `h${v.length + 1}abcde`, date: new Date().toISOString(), message: v.length ? "Kop aangepast" : "Eerste versie van de website" });
    msg(pid, "version", { hash: v[0].hash, title: v[0].message, working: true });
    msg(pid, "assistant", { text: "Klaar! Kijk rechts naar het voorbeeld. Wil je dat ik iets verander?" });
    status(pid, "done", false);
  }

  const handlers = {
    list_projects: () => S.projects,
    create_project: (a) => {
      const p = { id: S.next++, naam: a.naam, pad: `${a.bovenliggendPad}/${a.naam}`, template: a.template || "leeg", created_at: now(), default_account_id: null, last_used_at: null };
      S.projects.push(p);
      return p;
    },
    delete_project: (a) => void (S.projects = S.projects.filter((p) => p.id !== a.id)),
    rename_project: (a) => {
      const p = S.projects.find((x) => x.id === a.id);
      p.naam = a.naam.trim();
      return p;
    },
    project_pages: (a) => (S.preview[a.projectId] ? [{ naam: "Startpagina", pad: "/", bestand: "index.html" }, { naam: "Over ons", pad: "/over-ons.html", bestand: "over-ons.html" }] : []),
    project_files: () => [{ pad: "index.html", grootte: 640 }, { pad: "PROJECT.md", grootte: 220 }, { pad: "style.css", grootte: 1500 }],
    project_file_read: (a) => ({ tekst: a.path === "index.html" ? "<h1>Hovenier Joke</h1>" : "# Project\n", ingekort: false }),
    project_signals: (a) => ({ project_md_ingevuld: false, needs_data: !!S.flags[a.projectId + ":needs"], needs_data_reden: S.flags[a.projectId + ":needs"] ?? null, heeft_database: false, aantal_assets: (S.assets[a.projectId] || []).length }),
    assets_list: (a) => S.assets[a.projectId] || [],
    assets_delete: (a) => void (S.assets[a.projectId] = (S.assets[a.projectId] || []).filter((x) => x.pad !== a.path)),
    chat_attach: (a) => {
      const f = { naam: a.name, name: a.name, pad: "assets/" + a.name, path: "assets/" + a.name, soort: "image", kind: "image", grootte: 2048, size: 2048 };
      (S.assets[a.projectId] ||= []).push(f);
      return f;
    },
    data_overview: () => [],
    data_rows: () => ({ kolommen: [], rijen: [], totaal: 0 }),
    project_description_get: (a) => S.descr[a.projectId] ?? "",
    project_description_set: (a) => void (S.descr[a.projectId] = a.text),
    project_flags: (a) => Object.fromEntries(Object.entries(S.flags).filter(([k]) => k.startsWith(a.projectId + ":") && !k.endsWith(":needs")).map(([k, v]) => [k.split(":")[1], v])),
    project_flag_set: (a) => void (a.value == null ? delete S.flags[a.projectId + ":" + a.key] : (S.flags[a.projectId + ":" + a.key] = a.value)),
    reset_ui_setting: (a) => void delete S.settings[a.key],
    // ---- Supabase (nagebootst): koppeling, niveau, tabellen, log, bevestigingen
    supa_state: () => S.supaState(),
    supa_projects: () => ({ projecten: S.supaProjecten, organisaties: [{ slug: "mijn-bedrijf", name: "Mijn bedrijf", plan: "free" }] }),
    supa_link: (a) => {
      const p = S.supaProjecten.find((x) => x.reference === a.reference);
      S.supa = { gekoppeld: true, naam: p.name, referentie: p.reference, regio: p.region, niveau: "voorzichtig", volledig_resterend: null, volledig_secs: 3600 };
      emit("supa-changed", { project_id: a.projectId });
      return { status: "uitgevoerd", tekst: "Gekoppeld.", data: { naam: p.name } };
    },
    supa_create: (a) => {
      S.supa = { gekoppeld: true, naam: a.naam, referentie: "nieuwproj1", regio: "eu-central-1", niveau: "voorzichtig", volledig_resterend: null, volledig_secs: 3600 };
      S.supaNieuw = a.naam;
      emit("supa-changed", { project_id: a.projectId });
      return { status: "uitgevoerd", tekst: "Het project wordt gemaakt.", data: { naam: a.naam, status: "COMING_UP" } };
    },
    supa_unlink: (a) => void ((S.supa = { ...S.supa, gekoppeld: false }), emit("supa-changed", { project_id: a.projectId })),
    supa_wake: () => ({ status: "uitgevoerd", tekst: "Wakker." }),
    supa_set_level: (a) => {
      if (a.niveau === "volledig" && String(a.bevestiging || "").toLowerCase() !== "volledig") throw "bevestiging_ontbreekt";
      S.supa = { ...S.supa, niveau: a.niveau, volledig_resterend: a.niveau === "volledig" ? S.supa.volledig_secs : null };
      emit("supa-changed", { project_id: a.projectId });
    },
    supa_set_duration: (a) => void (S.supa = { ...S.supa, volledig_secs: a.seconden }),
    supa_emergency: (a) => {
      S.noodknop = (S.noodknop || 0) + 1;
      S.supa = { ...S.supa, niveau: "voorzichtig", volledig_resterend: null };
      emit("supa-changed", { project_id: a.projectId });
    },
    supa_actions: () => S.supaActies,
    supa_undo: (a) => {
      S.supaActies = S.supaActies.map((x) => (x.id === a.actie ? { ...x, undone: true } : x));
      return { status: "uitgevoerd", tekst: "Ongedaan gemaakt." };
    },
    supa_confirm_answer: (a) => void (S.antwoorden.push([a.id, a.toestaan]), true),
    supa_tables: () => ({
      tabellen: [
        { tabel: "klanten", rls: true, rijen: 3, kolommen: [{ kolom: "id", type: "integer", verplicht: true }, { kolom: "naam", type: "text", verplicht: false }], beleid: [{ naam: "eigen" }] },
        { tabel: "bestellingen", rls: false, rijen: 12, kolommen: [{ kolom: "id", type: "integer", verplicht: true }], beleid: [] },
      ],
    }),
    supa_rows: (a) => ({ kolommen: ["id", "naam"], rijen: a.pagina === 0 ? [["1", "Jan"], ["2", "Piet"], ["3", "Klaas"]] : [], meer: a.pagina === 0, pagina: a.pagina }),
    supa_row_save: () => ({ status: "uitgevoerd", tekst: "Uitgevoerd." }),
    supa_users: () => ({ gebruikers: [{ id: "u1", email: "jan@voorbeeld.nl", created_at: "2026-11-01T10:00:00Z", last_sign_in_at: null }] }),
    supa_security_check: () => ({ bevindingen: S.supaCheck }),
    supa_status: () => ({ status: "uitgevoerd", tekst: "Gekoppeld.", data: { gekoppeld: S.supa.gekoppeld, gepauzeerd: !!S.supaPauze, status: "ACTIVE_HEALTHY" } }),
    supa_write_config: () => ({ status: "uitgevoerd", tekst: "" }),
    supa_auth_skill: () => true,
    supa_sql: () => ({ status: "uitgevoerd", tekst: "Resultaat.", data: [] }),
    project_storage_get: (a) => S.opslag[a.projectId] ?? null,
    project_storage_set: (a) => void (S.opslag[a.projectId] = a.keuze),
    github_state: () => S.ghState(),
    github_suggest_name: (a) => ({ naam: a.naam ?? "hovenier-joke", geldig: /^[a-z0-9][a-z0-9_-]*$/.test(a.naam ?? "hovenier-joke"), vrij: S.ghVrij }),
    github_first_backup: (a) => {
      if (a.openbaar && !a.openbaarBevestigd) return { status: "geweigerd", code: "openbaar_bevestig", params: {} };
      if (S.ghUitkomst) return S.ghUitkomst;
      S.ghLink = { eigenaar: "pieter", repo: a.naam, privaat: !a.openbaar, url: `https://github.com/pieter/${a.naam}`, tak: "main", laatste: Math.floor(Date.now() / 1000), laatste_aantal: 3, auto: false, ai_vraagt: true, uiteengelopen: null, probleem: null };
      S.ghNieuw = 0;
      emit("github-voortgang", { project_id: 1, stap: "gewijzigd", klaar: 0, totaal: 0 });
      return { status: "uitgevoerd", code: "back_up_klaar", params: { aantal: 3 } };
    },
    github_backup: () => {
      if (S.ghUitkomst) return S.ghUitkomst;
      const n = S.ghNieuw;
      S.ghLink = { ...S.ghLink, laatste: Math.floor(Date.now() / 1000), laatste_aantal: n };
      S.ghNieuw = 0;
      emit("github-voortgang", { project_id: 1, stap: "gewijzigd", klaar: 0, totaal: 0 });
      return n ? { status: "uitgevoerd", code: "back_up_klaar", params: { aantal: n } } : { status: "uitgevoerd", code: "al_bijgewerkt", params: {} };
    },
    github_set_auto: (a) => void ((S.ghLink = { ...S.ghLink, auto: a.aan }), emit("github-voortgang", { project_id: 1, stap: "gewijzigd", klaar: 0, totaal: 0 })),
    github_set_ai_ask: (a) => void ((S.ghLink = { ...S.ghLink, ai_vraagt: a.vraagt }), emit("github-voortgang", { project_id: 1, stap: "gewijzigd", klaar: 0, totaal: 0 })),
    github_unlink: () => void ((S.ghLink = null), emit("github-voortgang", { project_id: 1, stap: "gewijzigd", klaar: 0, totaal: 0 })),
    github_list_repos: () => ({ repos: [{ eigenaar: "pieter", naam: "winkel", privaat: true, beschrijving: "Mijn webwinkel", bijgewerkt: "" }, { eigenaar: "pieter", naam: "blog", privaat: false, beschrijving: "", bijgewerkt: "" }] }),
    github_import: (a) => {
      const p = { id: S.next++, naam: a.repo, pad: `${a.bovenliggendPad}/${a.repo}`, template: "leeg", created_at: now(), default_account_id: null, last_used_at: null };
      S.projects.push(p);
      return { project: p, herkend: { soort: "static", template: "leeg", studio_json: false, niet_herkend: ["geen_studio_json"] } };
    },
    actie_confirm_answer: (a) => void (S.actieAntwoorden = [...(S.actieAntwoorden || []), [a.id, a.toestaan]]),
    // ---- koppelingen (GitHub: apparaatcode, Vercel en Supabase: sleutel plakken)
    connect_list: () => S.connLijst(),
    connect_start: (a) => {
      const c = S.conn[a.id];
      c.fout = null;
      if (c.strategie === "oauth_device") {
        c.status = "bezig";
        c.bezig = { soort: "apparaat", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900 };
        emit("connect-changed", null);
        return c.bezig;
      }
      return { soort: "plakken" };
    },
    connect_paste: (a) => {
      const c = S.conn[a.id];
      if (a.token === "goed-token") {
        c.status = "werkt";
        c.account = a.id === "github" ? "pieter" : a.id === "vercel" ? "joke" : "Mijn bedrijf";
        c.fout = null;
        c.bezig = null;
        emit("connect-changed", null);
        return S.connLijst().find((x) => x.id === a.id);
      }
      throw "ongeldig_token";
    },
    connect_cancel: (a) => void (S.conn[a.id].bezig = null, S.conn[a.id].status = S.conn[a.id].account ? "werkt" : "niet_gekoppeld", emit("connect-changed", null)),
    connect_test: (a) => S.connLijst().find((x) => x.id === a.id),
    connect_test_all: () => S.connLijst(),
    connect_disconnect: (a) => {
      Object.assign(S.conn[a.id], { status: "niet_gekoppeld", account: null, fout: null, bezig: null });
      emit("connect-changed", null);
      return { ingetrokken: false, beheer_url: "https://github.com/settings/applications" };
    },
    connect_open: (a) => void S.opened.push(a.url),
    layout_get: (a) => S.layouts[a.projectId] ?? null,
    layout_set: (a) => void (S.layouts[a.projectId] = { versie: a.versie, json: a.json }),
    layout_reset: (a) => void delete S.layouts[a.projectId],
    project_thumbnail_get: (a) => S.thumbs[a.id] ?? null,
    project_thumbnail_set: (a) => void (S.thumbs[a.id] = a.dataUrl),
    close_project: () => null,
    open_project: (a) => {
      const p = S.projects.find((x) => x.id === a.id);
      if (p) p.last_used_at = new Date().toISOString();
      return mcp();
    },
    mcp_status: () => mcp(),
    preview_info: (a) => S.preview[a.id] || emptyPreview,
    preview_start: (a) => S.preview[a.id] || emptyPreview,
    preview_stop: (a) => S.preview[a.id] || emptyPreview,
    preview_restart: (a) => S.preview[a.id] || emptyPreview,
    get_ui_setting: (a) => S.settings[a.key] ?? null,
    set_ui_setting: (a) => void (S.settings[a.key] = a.value),
    list_accounts: () => S.accounts,
    create_account: (a) => {
      const acc = { id: S.nextAcc++, provider: a.provider, label: a.label, profile_dir: `/home/joke/.studio/profielen/${a.provider}-${S.nextAcc}`, created_at: now() };
      S.accounts.push(acc);
      return acc;
    },
    delete_account: (a) => void (S.accounts = S.accounts.filter((x) => x.id !== a.id)),
    set_default_account: () => null,
    cli_status: (a) => ({ provider: a.provider ?? "claude", installed: !S.cliMissing, path: S.cliMissing ? null : "/usr/bin/claude", install_steps: [{ label: "Installeer via npm", command: "npm install -g @anthropic-ai/claude-code" }], docs_url: "https://docs.claude.com" }),
    chat_target: () => ({ provider: "claude", account_id: null, account_label: null, structured: true, mode: "build" }),
    chat_history: (a) => S.messages[a.projectId] || [],
    chat_busy: () => S.busy,
    chat_send: (a) => void simulate(a.projectId, a.text),
    chat_retry: (a) => void simulate(a.projectId, S.sent.at(-1) || ""),
    chat_stop: (a) => status(a.projectId, "idle", false),
    chat_mode_set: () => null,
    chat_switch: (a) => ({ provider: a.provider, account_id: a.accountId, account_label: null, structured: a.provider === "claude", mode: "build" }),
    permission_answer: () => null,
    last_checks: () => [],
    kit_list: () => ({ stack: null, kits: [], geweigerd: [] }),
    kit_current: () => ({ kit: null, tokens: null, attributie: { required: false, ok: true } }),
    runtime_call: (a) => {
      if (a.cmd === "git.list") return S.versions[a.projectId] || [];
      if (a.cmd === "git.restore") {
        const v = S.versions[a.projectId] || [];
        v.unshift({ hash: "terug00000", short: "terug00", date: new Date().toISOString(), message: "Terug naar: Eerste versie van de website" });
        return { hash: "terug00000", unchanged: false, safety: "bak0000" };
      }
      if (a.cmd === "security.check") return { scanned: 6, findings: [] };
      if (a.cmd === "preview.thumbnail") return { data_url: THUMB };
      if (a.cmd === "picker.url") return { url: demoUrl };
      if (a.cmd === "picker.shot") return { path: ".studio/picks/pick-1.jpg", found: true };
      return {};
    },
    start_shell: () => ({ id: "s" + nextId, kind: "shell", provider: null, account_id: null, account_label: null, project_id: 1, warnings: [] }),
    start_ai: () => ({ id: "a" + nextId, kind: "ai", provider: "claude", account_id: null, account_label: null, project_id: 1, warnings: [] }),
    start_login: () => ({ id: "l" + nextId, kind: "login", provider: "claude", account_id: 1, account_label: "x", project_id: null, warnings: [] }),
    pty_snapshot: () => ({ data: "Welkom bij Claude Code\r\n> ", end_offset: 30, exited: false, exit_code: null }),
    pty_resize: () => null,
    pty_write: () => null,
    pty_close: () => null,
    verify_claude_mcp: () => ({ verdict: "connected", output: "" }),
    export_project: () => ({ path: "/home/joke/Downloads/project.zip", files: 5, bytes: 2000, skipped_secrets: [], skipped_large: [] }),
    chat_asset_data: () => null,
  };
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => {
      const id = nextId++;
      callbacks[id] = cb;
      return id;
    },
    unregisterCallback: () => undefined,
    convertFileSrc: (p) => p,
    invoke: async (cmd, args = {}) => {
      if (cmd === "plugin:event|listen") {
        (listeners[args.event] ||= []).push(args.handler);
        return args.handler;
      }
      if (cmd === "plugin:dialog|open") return "/home/joke/Documenten";
      if (cmd === "plugin:dialog|save") return "/home/joke/Downloads/project.zip";
      if (cmd.startsWith("plugin:")) return null;
      const h = handlers[cmd];
      if (!h) return null;
      const r = h(args);
      return r instanceof Promise ? r : r;
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
}

// ---- metingen in de pagina: wat ziet een gebruiker (afgekapt, scrollbalken, kleine klikdoelen, Engels) ----
function measure() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && el.closest("[hidden]") === null;
  };
  const label = (el) => (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || el.tagName).replace(/\s+/g, " ").trim().slice(0, 40);
  const out = { vw, vh, paginaScroltHorizontaal: document.documentElement.scrollWidth > vw + 1, paginaScroltVerticaal: document.documentElement.scrollHeight > vh + 1, afgekapt: [], klein: [], buitenBeeld: [], engels: [], dubbeleScroll: [] };
  const ENG = /\b(the|loading|error|submit|cancel|close|please|failed|undefined|null|click|settings|save|delete|open|retry|project)\b/i;
  const NL_OK = new Set(["project", "open"]);
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 2 && (cs.overflow === "hidden" || cs.textOverflow === "ellipsis" || cs.overflowX === "hidden") && el.innerText?.trim()) out.afgekapt.push(label(el));
    if (el.matches("button, a[href], input:not([type=hidden]), textarea, [role=tab], [role=radio], [role=checkbox], [role=switch], select, [role=combobox]") && r.height < 32 && r.height > 0 && !el.closest("[data-slot=resizable-handle]")) out.klein.push(`${label(el)} (${Math.round(r.width)}x${Math.round(r.height)})`);
    if (el.matches("button, a[href], input, textarea, [role=tab]") && (r.right > vw + 1 || r.left < -1 || (r.bottom > vh + 1 && cs.position === "fixed"))) out.buitenBeeld.push(label(el));
    if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 40) out.dubbeleScroll.push(`${el.tagName.toLowerCase()}${el.getAttribute("data-slot") ? "[" + el.getAttribute("data-slot") + "]" : ""} ${Math.round(r.width)}x${Math.round(r.height)}`);
    if (el.children.length === 0 && el.innerText) {
      const m = el.innerText.match(ENG);
      if (m && !NL_OK.has(m[1].toLowerCase()) && !el.closest("pre, code, iframe, [data-testid=bubble-user]")) out.engels.push(el.innerText.trim().slice(0, 50));
    }
  }
  const uniq = (a) => [...new Set(a)];
  out.afgekapt = uniq(out.afgekapt);
  out.klein = uniq(out.klein);
  out.buitenBeeld = uniq(out.buitenBeeld);
  out.engels = uniq(out.engels);
  out.dubbeleScroll = uniq(out.dubbeleScroll);
  return out;
}

const browser = await chromium.launch({ executablePath: process.env.STUDIO_BROWSER_PATH ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

export async function openApp({ w, h, scale = 1, theme = "licht", scenario = {} }) {
  const ctx = await browser.newContext({ viewport: { width: Math.round(w / scale), height: Math.round(h / scale) }, deviceScaleFactor: scale, colorScheme: theme === "licht" ? "light" : "dark" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
  page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 200)));
  await page.addInitScript(mock, { THUMB, demoUrl, scenario: { ...scenario, theme: theme === "licht" ? "light" : "dark" } });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForLoadState("networkidle");
  return { page, ctx, errors };
}

export function recorder(naam, theme) {
  const dir = path.join(root, "docs", "ux", naam);
  mkdirSync(dir, { recursive: true });
  const log = [];
  let n = 0;
  return {
    async shot(page, stap, notitie = "") {
      n++;
      const file = `${String(n).padStart(2, "0")}-${stap}-${theme}.png`;
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(dir, file) });
      const m = await page.evaluate(measure);
      log.push({ stap, file, notitie, ...m });
      return m;
    },
    save() {
      writeFileSync(path.join(dir, `metingen-${theme}.json`), JSON.stringify(log, null, 1));
      return log;
    },
  };
}

export async function stop() {
  await browser.close();
  vite.kill();
  demo.close();
}

export { measure };
