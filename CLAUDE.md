# Studio

Lokale desktop-app (Tauri 2 + React/TypeScript/Vite + Tailwind, Rust-backend, SQLite via rusqlite) waarmee gebruikers apps maken met hun eigen AI-CLI's (Claude Code, Gemini CLI, Codex). Primair platform: Windows; macOS en Linux moeten ook werken.

## Principes
- **Local-first**: alles werkt zonder account of internet, behalve de AI zelf.
- Elke externe koppeling (GitHub, Vercel, Supabase, stores) is **optioneel** en komt later.
- **Sla nooit API-keys of tokens op** in SQLite of bestanden. Gebruik de OS-keychain (crate `keyring`).
- **Kleine, geteste stappen.** Draai na elke stap build, lint en tests (zie hieronder).
- **Alle UI-teksten in het Nederlands**, via i18n (`src/i18n/nl.json`); geen hardcoded strings in componenten, zodat Engels later kan.
- Projecten verwijderen = alleen uit de lijst; nooit bestanden van gebruikers wissen.

## Structuur
- `src/` frontend · `src-tauri/` Rust · `mcp-server/` (fase 2) · `templates/` · `skills/` · `design-packs/`
- DB-migraties: `src-tauri/migrations/NNNN_*.sql`, geregistreerd in `src-tauri/src/db.rs`. Wijzig nooit een bestaande migratie; voeg een nieuwe toe.

## Commando's
- `npm run tauri dev` — dev-build
- `npm run check` — alles: lint, tests (frontend + mcp-server), build, clippy, cargo test
- `cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test` — backend

## Beveiligingsregels (fase 2)
- MCP-server luistert alleen op `127.0.0.1`; auth vóór alles; token nooit loggen, nooit in config of DB (alleen via omgevingsvariabele).
- MCP-tools raken alleen bestanden binnen de projectmap (`mcp-server/src/paths.ts`, incl. symlink-controle).
- Configbestanden van gebruikers: alleen onze `studio`-entry toevoegen; bij twijfel weigeren en niets schrijven.
- CLI-gedrag alleen uit geverifieerde bronnen: zie `docs/cli-notes.md`.

## Fase 3-regels
- Commando's uit `studio.json` alleen uitvoeren na goedkeuring van exact die bestandsinhoud (hash); `previewUrl` alleen loopback.
- Elk proces heeft een time-out en een eigen procesgroep; ruim altijd de hele boom op (`mcp-server/src/proc.ts`).
- `git_checkpoint` neemt nooit geheimen mee; terugzetten is altijd een nieuwe commit na een automatische back-up. Nooit `reset --hard`/force.
- Wijzig `skills/control-loop/instructions.md` voor de werkwijze van de AI; Studio kopieert dat naar CLAUDE.md/GEMINI.md/AGENTS.md (blokmarkering respecteren).

## Zero-config preview
- Detectie zit op één plek: `src-tauri/src/preview/detect.rs`. De Rust-kant (`preview/mod.rs`) stuurt het plan naar de Node-runtime (`plan.set`); de runtime houdt dev-server, checks en screenshots (`mcp-server/src/runtime.ts`).
- De statische server (`preview/static_server.rs`) is alleen loopback, serveert nooit dotfiles of buiten de projectmap en werkt zonder Node.
- Scripts uit package.json draaien alleen na eerste vertrouwen of herkeuring bij wijziging; nooit zonder die controle automatisch starten.
- Bij sluiten van een project: eerst `previews.close` (watcher + statische server), dan `mcp.stop` (runtime + dev-server). Geen proces mag achterblijven; test dat.
