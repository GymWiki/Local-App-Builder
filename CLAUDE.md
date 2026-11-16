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
