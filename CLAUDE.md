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

## Paden naar Node (Windows)
- Geef `node` nooit een `\\?\`-pad (extended-length). Laat paden voor scripts/omgevingsvariabelen via `winpath::for_node` / `winpath::clean_path` lopen en gebruik `Path`/`PathBuf`, geen string-splits op `:` of `\`. Tests met spaties en schijfletters staan in `winpath.rs` en `mcp.rs`.
- De MCP-start is nooit blokkerend voor de rest van de app (`begin_mcp` in `commands.rs`); gebruik `wait_ready` met een korte time-out als iets de uitkomst nodig heeft.

## Chat-weergave
- Eén adapter per CLI (`src-tauri/src/chat/`): `ChatAdapter` (`launch`, `encode_user`, `parse_line`). Zonder adapter = terugval op de terminal. Voeg nooit een adapter toe zonder de uitvoer van de échte CLI te hebben opgenomen als fixture.
- UI-tekst voor acties/vragen/fouten zit in `src/i18n/nl.json` (`chat.*`), niet in Rust: de backend levert alleen codes + parameters.
- Gevaarlijke acties (`danger`) en schrijven buiten de projectmap vragen altijd toestemming, in elke stand (`chat/policy.rs`).
- Instructieblokken in CLAUDE.md/GEMINI.md/AGENTS.md zijn afgebakend per naam (`instructions.rs`); alleen eigen blokken toevoegen/verversen/verwijderen.

## Studio-UI (shadcn/ui)
- De interface van Studio zelf gebruikt **uitsluitend shadcn-componenten en de thematokens**. Nieuwe, samengestelde onderdelen bouw je uit shadcn-onderdelen in `src/components/app/` (de chat staat in `src/components/app/chat/`).
- Voeg shadcn-componenten toe via de **CLI of de shadcn MCP**, nooit met de hand: `npx shadcn@latest add <naam>` (antwoord "nee" op een vraag om `button.tsx` te overschrijven; die is bewust groter gemaakt voor grote klikdoelen). Instellingen staan in `components.json` (stijl `radix-nova`, alias `@/…`). `src/components/ui/` is gegenereerde code: pas dat alleen aan voor het thema of de klikdoelen en noteer het in `docs/ui.md`.
- **Geen losse kleuren of pixelwaarden.** Kleuren, radius, spacing en lettertypes staan op één plek: `src/index.css` (CSS-variabelen; licht en donker). Gebruik tokens als `bg-primary`, `text-muted-foreground`, `rounded-lg`. Een nieuwe kleur? Voeg eerst een token toe aan beide thema's en breid `src/theme.test.ts` uit (WCAG AA is verplicht).
- Teksten altijd via de i18n-structuur (`src/i18n/nl.json`), in eenvoudig Nederlands.
- **Lint-regels** (eslint.config.js, geldt voor `src/`, behalve `src/components/ui/` en tests): geen `#hex`, `rgb()`, `hsl()` of `oklch()` in code en geen gewone `<button>`, `<input>`, `<select>`, `<textarea>` of `<dialog>`; gebruik de shadcn-onderdelen. Alleen de verborgen bestandskiezer in de chat heeft een gemotiveerde uitzondering.
- Thema: de klasse `dark` staat op `<html>` (ThemeProvider, instelling `ui:theme`: system/light/dark). De terminal (xterm) leest zijn kleuren uit dezelfde variabelen (`src/lib/terminal-theme.ts`, `--term-*`) en wisselt mee.
- Screenshots van de belangrijkste schermen maak je met `node scripts/ui-shots.mjs <voorvoegsel> [licht,donker]` (Tauri-aanroepen worden nagebootst); ze komen in `docs/ui/`.

## UI-kits toevoegen (ontwikkelwerkwijze)
- Een nieuwe UI-kit, thema of componentenbibliotheek aan de kit library toevoegen gaat via de skill `add-kit` (`.claude/skills/add-kit/SKILL.md`): typ `/add-kit <pakketnaam of URL>` of vraag in één zin "voeg [kit] toe aan de kit library". De skill onderzoekt, beslist (alleen MIT, Apache-2.0, BSD-2/3-Clause, ISC; exacte versie), maakt `design-packs/<id>/`, test (`npm run kit:validate`, `kit:test`, `kit:try`, `kit:check`) en legt het vast in `docs/kits.md`. Formaat en achtergrond: `docs/kits.md`.
- Voer nooit installatiescripts van onbekende pakketten uit zonder bevestiging, gebruik geen kit met een niet-toegestane licentie en kopieer geen code uit kits met een onbekende licentie.

## Indeling (homescherm en werkruimte)
- Homescherm met projectkaarten (`src/components/app/home/`) en een werkruimte per project (`src/components/app/workspace/`) met docking via **flexlayout-react** (keuze en reden: `docs/ui.md`). De iconenbalk, panelen en menu's gebruiken alleen shadcn-onderdelen en thematokens; de kleuren van flexlayout staan in `src/index.css` (`.studio-layout`).
- De indeling per project staat in SQLite (`project_layouts`) en wordt beheerd door de Layout-service (`src/lib/layout/`). Wijzig je het formaat, verhoog dan `LAYOUT_VERSION` en voeg een migratie toe; een ongeldige indeling valt altijd terug op de standaard. Nieuwe panelen: `panels.ts` + `factory` in `ProjectWorkspace.tsx` + `werkruimte.paneel.<id>` in `nl.json`.
- Een commando in Rust mag de `Db`-vergrendeling nooit vasthouden terwijl er code wordt aangeroepen die zelf `db.conn()` neemt (ChatManager, AppStore): dat blokkeert het hele venster. Beperk de vergrendeling tot een blok.
- Test wijzigingen aan de indeling met `npm run ux:test` én in de echte app (`npm run tauri dev`); de nagebootste Tauri-laag vangt zulke fouten niet.


## Menu en instellingen (beginnersweergave)
- Het linkermenu (`workspace/WorkspaceMenu.tsx`) heeft hoogstens acht zichtbare onderdelen; techniek staat onder "Voor gevorderden". Statusbolletjes, stappen op Start en de zichtbaarheid van Gegevens komen **alleen** uit de Status-service (`src/lib/menu`), niet uit losse componenten.
- Nieuwe instelling: voeg hem toe aan het register in `src/lib/settings/index.ts` (standaardwaarde + controle), aan `UI_SETTINGS`/`valid_setting` in `commands.rs` en aan `SettingsView` met label, uitleg, bereik (alle projecten of dit project) en "Standaard herstellen". Verandert het formaat, verhoog dan `SETTINGS_VERSION` en voeg een migratie toe.
- Gebruik de vaste woorden uit `woordenlijst` in `nl.json`; de test `woordenlijst.test.ts` bewaakt dat vaktaal niet in de gewone weergave komt.
- Test menu en instellingen met `npm run ux:menu` én in de echte app.

## Koppelingen en Supabase (eigen account van de gebruiker)
- Tokens, refresh-tokens, het databasewachtwoord en alle sleutels staan **uitsluitend** in de OS-keychain (`connect/vault.rs`, per dienst een eigen `ProviderVault`). Nooit in SQLite, projectbestanden, logs, de chat, tooluitvoer of AI-context. Fouten en logs gaan door `supa::api::scrub`. Een token gebruik je alleen binnen `Manager::authorized`.
- Alle uitgaande verbindingen van koppelingen lopen via Rust met een vaste lijst hosts (`connect/http.rs`, `providers::allowed_hosts`); de frontend doet zelf geen netwerkverzoeken (test: `src/netwerk.test.ts`). Studio bouwt geen eigen server of proxy voor tokens en levert geen client-geheim mee. Client-ID's (publiek) staan in `config/koppelingen.json`.
- Nieuwe dienst: provider in `connect/providers/`, strategie (`oauth_device`, `oauth_loopback_pkce` of `token_plakken`), teksten onder `koppelingen.<id>` in `nl.json`, en een `VerbindKnop` op de plek waar de koppeling nodig is.
- Elke wijziging aan de database van de gebruiker gaat door **één** pijplijn (`supa/engine/write.rs`): indelen met de parser (`classify.rs`), besluit volgens het niveau (`policy.rs`), vangnet, log. Bij twijfel (onleesbaar, onbekend, meerdere instructies) telt de hoogste klasse. Kosten vragen altijd een bevestiging in de Studio-UI. De AI krijgt alleen `UITGEVOERD`, `GEWEIGERD` of `MISLUKT`; voeg nooit een tool toe die een sleutel teruggeeft of vraagt.
- Nieuwe `db_*`-tool: in `mcp-server/src/tools.ts` (dunne laag), `supa/app.rs::host`, en een test in `supa/engine/tests.rs`. Hou `docs/supabase.md` (risicoklassen) bij.
- Test: `npm run ux:koppel` en `npm run ux:supabase`, en echt in de app met een eigen testproject.

## GitHub-back-up (eigen account van de gebruiker)
- Alles in `src-tauri/src/github/` (onderzoek, keuzes en testlijst: `docs/github.md`). Naar GitHub sturen gaat met **libgit2** (`git2`, `repo.rs`); het token bestaat alleen in de `credentials`-callback binnen `Manager::authorized`. De lokale versies (checkpoints) blijven systeem-git in `mcp-server/src/git.ts`.
- **Nooit** force-push, `+`-refspec voor sturen, geschiedenis herschrijven, repositories verwijderen of instellingen wijzigen: er bestaat geen codepad voor; de test `nooit_een_force_push_of_herschreven_geschiedenis` bewaakt dat. Eerst ophalen en vergelijken; uiteengelopen = niets doen en de gebruiker opties tonen.
- De remote-URL wordt alleen opgebouwd met `name::remote_url` (`https://github.com/<eigenaar>/<repo>.git`, nooit met token of `@`). Foutmeldingen van git2/GitHub gaan nooit naar UI of AI: alleen vaste codes (`GhError`, `Uitkomst`); de tekst staat onder `github.*` in `nl.json`.
- Voor elke back-up: `.gitignore` aanvullen (`gitignore.rs`, eigen blok) en scannen (`scan.rs`: laatste versie + wat er in te sturen versies is toegevoegd). Geheimen (`hoog`) blokkeren altijd; `midden` en geheimen in eerdere versies blokkeren alleen bij een openbare kopie. In het resultaat staat nooit de waarde zelf. Patronen staan gelijk aan `mcp-server/src/security.ts`: pas ze samen aan. Testgeheimen in tests altijd uit stukjes samenstellen (secret scanning van GitHub).
- Een back-up door de AI (`git_backup`) vraagt, als `ai_ask` aan staat, bevestiging via `confirm.rs` (`actie-confirm`; dialoog `ActieBevestig`). Dat is de algemene bevestiging voor acties buiten de computer; gebruik hem ook voor Vercel en de winkels. Plan-modus ("Eerst overleggen") weigert altijd.
- Automatisch een back-up na een opgeslagen versie staat standaard uit (`auto_backup`); de hook zit in het `git`-runtime-event in `lib.rs` (`github::app::auto_backup`).
- Test: `cargo test github`, `npm run ux:github`, en echt met een eigen account (zie docs/github.md §7).
