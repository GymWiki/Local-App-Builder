# Studio — fase 3

Lokale desktop-app om apps te maken met je eigen AI-CLI's. Fase 1: projecten en SQLite. Fase 2: terminal, lokale MCP-server, AI-accounts. Fase 3: de feedbackloop (preview, checks, screenshots, checkpoints).

## Vereisten
- Node.js 20+ (ook nodig tijdens gebruik: de MCP-server draait op Node; staat het op een ongebruikelijke plek, zet dan `STUDIO_NODE_PATH` naar `node.exe`), Rust (stable), `git` in je PATH
- Minstens één AI-CLI: Claude Code of Gemini CLI (Studio toont installatie-uitleg als hij ontbreekt)
- Tauri-systeemvereisten: https://v2.tauri.app/start/prerequisites/
  - Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev`
  - Windows: Microsoft C++ Build Tools + WebView2
  - macOS: Xcode Command Line Tools

## Starten
```
npm install
npm run tauri dev
```

## Controles
```
npm run lint && npm test && npm run build
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```

De database (`studio.db`) staat in de app-datamap van het besturingssysteem (`nl.studio.app`).

## Hoe fase 2 werkt
- **Terminal**: PTY in Rust (`portable-pty`), xterm.js in de UI, meerdere tabs, laatste 512 KiB uitvoer per sessie.
- **MCP-server** (`mcp-server/`): per geopend project een Node-proces op `127.0.0.1` (willekeurige poort, bearer-token per app-sessie). Tools: `project_status`, `read_project_notes`, `update_project_notes` (alleen PROJECT.md). Aanroepen worden zonder inhoud gelogd in `mcp_calls`.
- **Auto-config**: bij een AI-klik voegt Studio alleen een `studio`-entry toe aan `.mcp.json` (Claude) of `.gemini/settings.json` (Gemini). URL en token staan er alleen als `${VAR}`; de waarden gaan via de omgeving van het proces. Bestaande config wordt nooit overschreven; bij ongeldige JSON of een vreemde `studio`-entry weigert Studio en meldt het dat.
- **Accounts**: label + provider + profielmap in de app-datamap. `CLAUDE_CONFIG_DIR` / `GEMINI_CLI_HOME` wijst naar die map; je logt zelf in via de CLI. Geen tokens in SQLite of bestanden.
- Bronnen en verificatie: `docs/cli-notes.md`.
- Claude vraagt bij de eerste start om goedkeuring van de projectserver uit `.mcp.json`; dat is bedoeld gedrag.

## Zero-config preview (fase 4)
Studio detecteert bij het openen van een project én bij elke bestandswijziging (file watcher) wat het is:
- **Alleen `index.html`** (root of `public/`): ingebouwde statische server in Rust, alleen `127.0.0.1` op een willekeurige poort, zonder Node.js. Wijzigingen verversen de pagina automatisch (Server-Sent Events + een klein script dat in de HTML wordt geplakt). Dotfiles (`.env`, `.git`), `..` en symlinks naar buiten de map worden niet geserveerd.
- **`package.json` met `dev`- of `start`-script**: Studio draait het script (via de Node-runtime), leest de poort uit de uitvoer (Vite, Next, Astro, CRA, …) en toont die URL. Ontbreken de dependencies, dan meldt Studio dat (met knop **npm install uitvoeren**) en start de preview zodra ze er zijn. Frameworks zonder eigen hot reload worden bij een wijziging herladen.
- **Flutter / overig**: een duidelijke melding met wat er nodig is.
- **`studio.json` met `dev`** blijft leidend.
- **Vertrouwen**: de eerste keer dat Studio scripts uit `package.json` ziet, worden die vertrouwd (het is jouw project); wijzigen ze daarna, dan vraagt Studio eerst opnieuw om goedkeuring. Dit voorkomt dat een AI-wijziging in package.json ongezien commando's laat draaien.
- **Preview beschikbaar**: zodra er voor het eerst iets draait, toont Studio een melding met knop, of wisselt automatisch naar de preview-tab (instelbaar onderaan de Preview-tab).
- **MCP**: `get_preview_screenshot`, `get_console_errors` en `run_checks` werken ook voor de statische modus (checks: html aanwezig, geen kapotte lokale links, geen console-fouten).

## Fase 3: de feedbackloop
Alleen voor afwijkende situaties: zet in de projectmap een `studio.json` (leidend boven de detectie):
```json
{ "dev": "npm run dev", "build": "npm run build", "lint": "npm run lint", "test": "npm test",
  "previewUrl": "http://localhost:5173", "timeoutSec": 300 }
```
- **Goedkeuring**: commando's uit `studio.json` draaien pas nadat jij het bestand in de Preview-tab hebt goedgekeurd (hash van de inhoud). Wijzigt het bestand, dan vervalt dat. Dit geldt ook voor de AI via `run_checks`.
- **Preview-tab**: start/stopt/herstart het dev-commando, toont status (draait/starten/stoppen/fout), logs en de preview in een iframe. `previewUrl` mag alleen naar localhost/127.0.0.1.
- **MCP-tools**: `run_checks`, `get_preview_screenshot` (desktop/mobiel, JPEG), `get_console_errors`, `get_dev_logs`, `git_checkpoint`, `git_list_checkpoints` (plus de drie van fase 2). Alle processen hebben een time-out en draaien in een eigen procesgroep; bij sluiten worden ze (met kindprocessen) gestopt.
- **Screenshots/console-fouten** komen van een onzichtbare browser (Playwright, gebruikt je eigen Chrome of Edge). Die ziet dus wat een nieuwe bezoeker ziet, niet wat jij zelf in de preview aanklikt.
- **Checkpoints**: `git add -A` + commit, zonder `.env`, sleutels en dergelijke. "Terug naar vorige versie" zet het project terug als nieuwe commit, nadat niet-opgeslagen werk automatisch als back-upcheckpoint is vastgelegd: er gaat niets verloren.
- **Werkwijze voor de AI**: `skills/control-loop/instructions.md` wordt als gemarkeerd blok in `CLAUDE.md`, `GEMINI.md` en `AGENTS.md` gezet (eigen tekst in die bestanden blijft staan).
- De zijbalk toont de laatste check-resultaten en de tijdlijn.

## Problemen met de MCP-server
- De MCP-server start op een **achtergrondthread**: terminal, preview en git werken meteen, ook als de server faalt. De terminalbalk toont ‘MCP: starten…’ en daarna ‘gereed’ of de echte foutreden met **Opnieuw proberen**.
- In een dev-build (`tauri dev`) staat het exacte startcommando in de console van `tauri dev` (`[studio] start: …`; het token wordt nooit getoond) en als eerste regel in de logregels van de foutmelding.
- Paden naar Node worden schoongemaakt (geen `\\?\C:\…`, geen `..`, geen gemengde scheidingstekens; werkt met spaties). Een `\\?\`-pad laat Node op Windows crashen met `EISDIR … lstat 'C:'`.
- `npm run tauri dev` en de release-build draaien eerst `scripts/mcp-prepare.mjs`: installeert zo nodig de dependencies van `mcp-server/` en bouwt `dist/index.mjs`.
- Studio zoekt Node in PATH en op bekende plekken (Program Files, nvm, fnm, Volta, scoop, Homebrew), start `node --version` en eist versie 20+.
- Mislukt het starten, dan toont de terminalbalk en de Preview-tab de echte reden (Node ontbreekt/te oud, serverbestand ontbreekt, crash met laatste logregels, time-out) en een knop **Opnieuw proberen**.
- Studio keurt de `studio`-server voor Claude goed via `.claude/settings.local.json` (alleen onze naam wordt toegevoegd; een eerdere afwijzing door jou wordt gerespecteerd; het bestand blijft uit git). Claude vraagt bij de eerste start in een nieuwe map nog wel eenmalig of je de map vertrouwt: kies Ja, anders blijft de server ‘Pending approval’. De knop **Controleer in Claude** draait `claude mcp get studio` met de juiste omgeving en meldt connected / wacht op goedkeuring / mislukt.

## Bewust niet gedaan
- Geen MCP-tool om de dev-server te starten: dat doet de gebruiker in de Preview-tab (vertrouwensgrens). De AI krijgt een duidelijke melding als de preview niet draait.
- Console-fouten uit het iframe zelf worden niet opgevangen (cross-origin); alleen die van de onzichtbare browser. Geen eigen Tauri-subwebview.
- Zonder Node.js werkt niets uit fase 3 (de runtime leeft in het Node-proces). Zonder Chrome/Edge geen screenshots (duidelijke melding).
- Als het Node-proces met geweld wordt gedood (SIGKILL/crash van de app), kan een dev-server blijven doorlopen; bij normaal sluiten of wegvallen van de app stopt alles.
- De gebundelde app (inclusief `playwright-core` als resource) is niet gebouwd of getest; alleen `tauri dev` en de tests.
- Windows/macOS niet getest (procesgroepen vs. `taskkill`, `.cmd`-shims).
- Codex nog steeds uitgeschakeld (zie `docs/cli-notes.md`); of Gemini/Claude screenshots goed tonen is niet met een echte CLI geprobeerd.
- Fase 1/2-beperkingen gelden nog: geen templates, geen externe koppelingen, alleen Nederlands, terminaluitvoer niet bewaard over herstarts.
