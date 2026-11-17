// UX-simulatie: bedient Studio als een gebruiker (via de browser, met nagebootste Tauri-aanroepen) en legt per stap
// een screenshot en metingen vast (afgekapte tekst, scrollbalken, kleine klikdoelen, Engelse woorden).
// Gebruik: node scripts/ux-sim.mjs <persoon|matrix|fouten> [licht,donker]
// Uitvoer: docs/ux/<persoon>/<nn>-<stap>-<thema>.png en docs/ux/<persoon>/metingen.json
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "mcp-server", "package.json"));
const { chromium } = require("playwright-core");

const DEMO = (naam) => `<!doctype html><html lang="nl"><body style="font-family:Georgia,serif;margin:0;background:#f0fdf4;color:#14532d"><header style="padding:32px;background:#166534;color:#fff"><h1 style="margin:0">${naam}</h1><p>Tuinaanleg, onderhoud en beplanting</p></header><main style="padding:24px"><h2>Wat wij doen</h2><p>Een mooie tuin zonder zorgen.</p><button style="padding:12px 20px;border:0;border-radius:8px;background:#15803d;color:#fff;font-size:16px">Vraag een offerte aan</button></main></body></html>`;
const demo = createServer((_, res) => res.writeHead(200, { "content-type": "text/html" }).end(DEMO("Hovenier Joke")));
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
function mock({ demoUrl, scenario }) {
  const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");
  const S = (window.__S = {
    projects: [],
    next: 1,
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
  });
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
      const p = { id: S.next++, naam: a.naam, pad: `${a.bovenliggendPad}/${a.naam}`, template: a.template || "leeg", created_at: now(), default_account_id: null };
      S.projects.push(p);
      return p;
    },
    delete_project: (a) => void (S.projects = S.projects.filter((p) => p.id !== a.id)),
    close_project: () => null,
    open_project: () => mcp(),
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
  await page.addInitScript(mock, { demoUrl, scenario: { ...scenario, theme: theme === "licht" ? "light" : "dark" } });
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
