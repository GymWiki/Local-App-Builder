# Studio — fase 2

Lokale desktop-app om apps te maken met je eigen AI-CLI's. Fase 1: projecten en SQLite. Fase 2: ingebouwde terminal, lokale MCP-server en AI-accounts.

## Vereisten
- Node.js 20+ (ook nodig tijdens gebruik: de MCP-server draait op Node), Rust (stable), `git` in je PATH
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

## Bewust niet gedaan
- Codex staat uitgeschakeld: de documentatie was niet bereikbaar en niets is uit het geheugen aangenomen (zie `docs/cli-notes.md`)
- Terminal-uitvoer wordt alleen in het geheugen bewaard (niet over app-herstarts heen)
- "Wissel van AI" vraagt de oude AI niet automatisch om PROJECT.md bij te werken; de UI geeft er een tip over. Sessies hervatten over accounts heen kan niet (alleen `resume` binnen hetzelfde account via de backend, nog zonder knop)
- Node.js wordt niet meegeleverd; zonder Node.js is MCP "niet beschikbaar" en start de CLI gewoon zonder
- Config wordt herschreven als pretty JSON (2 spaties): inhoud blijft behouden, opmaak niet; bestanden met opmerkingen worden geweigerd
- Het MCP-token staat in de omgeving van de AI-sessie, dus de AI kan het zelf lezen (de server is wel alleen lokaal en beperkt tot het project)
- Windows (`.cmd`-shims via `cmd.exe`, ConPTY) en macOS zijn niet getest; alleen Linux
- De gebundelde app (resource `mcp-server/index.mjs`) is niet gebouwd of getest, alleen `tauri dev`
- Geen UI-test met een echte CLI (er zijn geen CLI's ingelogd in deze omgeving): geautomatiseerd getest zijn PTY, MCP-auth, padvalidatie, config-schrijven, accounts en de installatie-check
- Fase 1-lijst blijft gelden: geen templates, geen externe koppelingen, alleen Nederlands
