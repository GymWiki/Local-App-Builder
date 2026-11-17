// Maakt screenshots van de belangrijkste schermen van Studio, zonder Tauri: de Tauri-aanroepen worden nagebootst.
// Gebruik: node scripts/ui-shots.mjs <voorvoegsel> [licht,donker]      bijv.  node scripts/ui-shots.mjs voor donker
// De afbeeldingen komen in docs/ui/<voorvoegsel>-<scherm>-<thema>.png
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prefix = process.argv[2] ?? "na";
const themes = (process.argv[3] ?? "licht,donker").split(",");
const out = path.join(root, "docs", "ui");
mkdirSync(out, { recursive: true });
const require = createRequire(path.join(root, "mcp-server", "package.json"));
const { chromium } = require("playwright-core");

const DEMO = `<!doctype html><html lang="nl"><body style="font-family:system-ui;margin:0;background:#fff7ed;color:#1c1917"><header style="padding:24px;background:#fb923c;color:#fff"><h1 style="margin:0">Kapsalon Mila</h1></header><main style="padding:24px"><h2>Welkom!</h2><p>Knippen, kleuren en stylen. Maak direct een afspraak.</p><button style="padding:12px 20px;border:0;border-radius:8px;background:#c2410c;color:#fff;font-size:16px">Afspraak maken</button></main></body></html>`;
const demo = createServer((_, res) => res.writeHead(200, { "content-type": "text/html" }).end(DEMO));
await new Promise((r) => demo.listen(0, "127.0.0.1", r));
const demoUrl = `http://127.0.0.1:${demo.address().port}/`;

const PORT = 1439;
const vite = spawn(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "ignore" });
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break;
  } catch {
    /* nog niet klaar */
  }
  await new Promise((r) => setTimeout(r, 300));
}

// ---- de nagebootste Tauri-kant (draait in de pagina) ----
function mockScript({ theme, demoUrl, scene }) {
  const projects = [
    { id: 1, naam: "Kapsalon Mila", pad: "/demo/kapsalon", template: "web-react-vite", created_at: "2026-11-01 10:00:00", default_account_id: 1 },
    { id: 2, naam: "Boekenclub", pad: "/demo/boekenclub", template: "leeg", created_at: "2026-11-05 10:00:00", default_account_id: null },
  ];
  const accounts = [{ id: 1, provider: "claude", label: "Persoonlijk", profile_dir: "/demo/p1", created_at: "2026-10-01" }, { id: 2, provider: "gemini", label: "Werk", profile_dir: "/demo/p2", created_at: "2026-10-02" }];
  const mcpUp = { state: "connected", port: 4000, error: null, kind: null, log: [] };
  const mcpDown = { state: "unavailable", port: null, error: "Node.js is niet gevonden.", kind: "node_missing", log: ["spawn node ENOENT"] };
  const previewInfo = { mode: "static", status: "running", url: demoUrl, hmr: true, problem: null, plan: { entry: "index.html", dev_script: null, needs_install: false } };
  const msg = (id, kind, payload) => ({ id, project_id: 1, kind, payload, created_at: "2026-11-17 10:00:00" });
  const history = [
    msg(1, "user", { text: "Maak een website voor mijn kapsalon met een knop om een afspraak te maken." }),
    msg(2, "assistant", { text: "Leuk! Ik maak **een mooie startpagina** met:\n\n- een kop met de naam van je kapsalon\n- een knop ‘Afspraak maken’" }),
    msg(3, "action", { kind: "file_created", state: "done", params: { file: "index.html", page: true }, summary: "index.html (24 regels)" }),
    msg(4, "action", { kind: "run_checks", state: "done", params: {}, fixed: true }),
    msg(5, "version", { hash: "a1b2c3d4", title: "Startpagina van de kapsalon", working: true }),
    msg(6, "assistant", { text: "Klaar! Kijk rechts naar het voorbeeld. Wil je dat ik iets verander?" }),
  ];
  if (scene === "toestemming") history.push(msg(7, "permission", { state: "asked", req_id: "r1", tool: "Bash", kind: "run_command", danger: false, detail: "npm install", params: { command: "npm install" } }));
  const kits = [
    { id: "fragments-ui", naam: "Fragments UI", beschrijving: "Een complete, rustige componentenbibliotheek.", label: "Snel en compleet", licentie: "MIT", stacks: ["react-vite"], compatible: true, attributieVerplicht: false, installatiescripts: false, pakketten: ["@usefragments/ui@4.5.0"], preview: null, kleuren: { primair: "#3d5ae8", achtergrond: "#fffefd", tekst: "#1b1916" } },
    { id: "warm", naam: "Warm en speels", beschrijving: "Zachte kleuren en ronde hoeken.", label: "Vrolijk", licentie: "MIT", stacks: ["react-vite"], compatible: true, attributieVerplicht: false, installatiescripts: false, pakketten: [], preview: null, kleuren: { primair: "#ea580c", achtergrond: "#fff7ed", tekst: "#1c1917" } },
    { id: "material", naam: "Material", beschrijving: "Het uiterlijk van Android-apps.", label: "Voor Flutter", licentie: "BSD-3-Clause", stacks: ["flutter"], compatible: false, attributieVerplicht: false, installatiescripts: false, pakketten: [], preview: null, kleuren: { primair: "#6750a4", achtergrond: "#fffbfe", tekst: "#1c1b1f" } },
  ];
  const settings = { communication_mode: "simple", permission_mode: "important", loop_threshold: "3", preview_auto_switch: "0", theme };
  const handlers = {
    list_projects: () => projects,
    list_accounts: () => accounts,
    cli_status: (a) => ({ provider: a.provider ?? "claude", installed: true, path: "/usr/bin/claude", install_steps: [], docs_url: "" }),
    open_project: () => (scene === "mcp-fout" ? mcpDown : mcpUp),
    mcp_status: () => mcpUp,
    preview_info: () => previewInfo,
    get_ui_setting: (a) => settings[a.key] ?? null,
    set_ui_setting: () => null,
    chat_target: () => ({ provider: "claude", account_id: 1, account_label: "Persoonlijk", structured: true, mode: "build" }),
    chat_history: () => history,
    chat_busy: () => false,
    last_checks: () => [{ id: 1, ok: true, created_at: "2026-11-17T10:00:00", steps: [{ name: "lint", status: "passed", exitCode: 0, durationMs: 800, output: [] }, { name: "build", status: "passed", exitCode: 0, durationMs: 2100, output: [] }] }],
    runtime_call: (a) => (a.cmd === "git.list" ? [{ hash: "a1b2c3d4e5", short: "a1b2c3d", date: "2026-11-17T10:00:00+01:00", message: "Startpagina van de kapsalon" }, { hash: "b2c3d4e5f6", short: "b2c3d4e", date: "2026-11-16T09:00:00+01:00", message: "Eerste versie" }] : a.cmd === "git.status" ? { status: "", dirty: false } : {}),
    kit_list: () => ({ stack: "react-vite", kits, geweigerd: [] }),
    kit_current: () => ({ kit: null, tokens: null, attributie: { required: false, ok: true } }),
    start_shell: () => ({ id: "s1", kind: "shell", provider: null, account_id: null, account_label: null, project_id: 1, warnings: [] }),
    pty_snapshot: () => ({ data: "\u001b[32mmila@studio\u001b[0m:\u001b[34m~/kapsalon\u001b[0m$ npm run dev\r\n\r\n  VITE v7 ready in 312 ms\r\n  ➜  Local: http://localhost:5173/\r\n", end_offset: 120, exited: false, exit_code: null }),
    pty_resize: () => null,
    pty_write: () => null,
    pty_close: () => null,
    verify_claude_mcp: () => ({ verdict: "connected", output: "" }),
  };
  const callbacks = {};
  let nextId = 1;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => {
      const id = nextId++;
      callbacks[id] = cb;
      return id;
    },
    unregisterCallback: () => undefined,
    convertFileSrc: (p) => p,
    invoke: async (cmd, args = {}) => {
      if (cmd === "plugin:event|listen") return nextId++;
      if (cmd.startsWith("plugin:")) return null;
      const h = handlers[cmd];
      return h ? h(args) : null;
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
}

const browser = await chromium.launch({ executablePath: process.env.STUDIO_BROWSER_PATH ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

async function shoot(theme, name, setup) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: theme === "licht" ? "light" : "dark" });
  const page = await ctx.newPage();
  await page.addInitScript(mockScript, { theme: theme === "licht" ? "light" : "dark", demoUrl, scene: name });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForLoadState("networkidle");
  await setup(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, `${prefix}-${name}-${theme}.png`) });
  console.log("✔", `${prefix}-${name}-${theme}.png`);
  await ctx.close();
}

const open = async (page) => {
  await page.getByText("Kapsalon Mila").first().click();
  await page.waitForTimeout(800);
};

const scenes = {
  "projecten-chat": open,
  toestemming: open,
  "mcp-fout": open,
  uiterlijk: async (page) => {
    await open(page);
    await page.getByRole("tab", { name: "Uiterlijk" }).click();
  },
  geavanceerd: async (page) => {
    await open(page);
    await page.getByRole("tab", { name: "Geavanceerd" }).click();
    await page.getByRole("button", { name: "Nieuwe terminal" }).click();
    await page.waitForTimeout(1500);
  },
  "nieuw-project": async (page) => {
    await page.getByRole("button", { name: /Nieuw project/ }).first().click();
  },
  accounts: async (page) => {
    await page.getByRole("button", { name: /Accounts|AI-accounts/ }).first().click();
  },
  instellingen: async (page) => {
    await page.getByRole("button", { name: /Instellingen/ }).first().click();
  },
};

try {
  for (const theme of themes) {
    for (const [name, setup] of Object.entries(scenes)) {
      try {
        await shoot(theme, name, setup);
      } catch (e) {
        console.log("✘", name, theme, String(e.message).split("\n")[0]);
      }
    }
  }
} finally {
  await browser.close();
  vite.kill();
  demo.close();
}
