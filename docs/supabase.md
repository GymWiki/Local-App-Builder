# Supabase-koppeling (onderzoek en keuzes)

Onderzoek op 2026-11-18, uit de actuele Supabase-documentatie (zoekfunctie van de aangesloten Supabase-connector; `supabase.com` zelf was vanuit mijn omgeving niet bereikbaar). Wat niet in de documentatie staat, is gemarkeerd als **niet bevestigd**; dat moet bij de handmatige test met een echt account worden gecontroleerd. De Management API-referentie toont paden, methoden en foutcodes, maar **geen** request- of responsevelden; die velden zijn daarom deels afgeleid uit gidsen.

## Keuze: eigen tools (route a), niet de officiële MCP-server (route b)
Gekozen: **eigen MCP-tools in Studio bovenop de Management API**.

Redenen:
1. De officiële server vraagt van de AI-CLI zelf een token (OAuth in de browser, of een `Authorization: Bearer`-token in de config). Het token zou dan in de configuratie of omgeving van de AI-CLI staan. Studio wil dat de sleutels nooit bij de AI komen.
2. De officiële server heeft geen risicoklassen, geen bevestigingen in gewone taal in de Studio-UI, geen vangnet (checkpoint, back-up, actielog) en geen noodknop. De documentatie zegt zelf: *"never connect the MCP server to production data… only designed for development and testing"*, en adviseert handmatige goedkeuring per aanroep.
3. De beperkingen die hij biedt (`read_only`, `project_ref`, `features`) zijn grof: alleen lezen of alles.
4. Studio kan zo kosten bevestigen met een eigen prijstabel (een kosten-eindpunt is niet bevestigd).

Wat we wel overnemen: de indeling in groepen (database, ontwikkeling, edge functions, debuggen, opslag), de aanbeveling om op één project te beperken, en de waarschuwing voor prompt-injectie (resultaten van queries zijn gegevens, geen opdrachten; wij geven ze met een duidelijke afbakening terug).

## Koppelmethode
- **Persoonlijk toegangstoken** in de OS-keychain. Aanmaken op https://supabase.com/dashboard/account/tokens. Header `Authorization: Bearer <token>`, basis-URL `https://api.supabase.com`.
- Er bestaan *klassieke* tokens (volledige toegang tot alle organisaties en projecten, ook toekomstige) en *beperkte* tokens (alpha, geleidelijk uitgerold; kiezen organisaties, projecten en rechten). Supabase raadt beperkte tokens aan voor AI-agents. Studio adviseert dat, maar legt eerlijk uit dat de meeste gebruikers (nog) een klassiek token krijgen met veel rechten.
- **OAuth** (voor later): app registreren bij organisatie-instellingen, `GET /v1/oauth/authorize`, `POST /v1/oauth/token` met Basic-auth van `client_id:client_secret`; PKCE `S256` wordt aanbevolen maar het geheim wordt in de voorbeelden altijd meegestuurd. Een publieke client zonder geheim, regels voor loopback-adressen en levensduur van tokens zijn **niet bevestigd**. Daarom nu niet gebouwd (zie `docs/koppelingen.md`).

## Limieten en kosten (gratis plan)
- 2 gratis projecten, geteld over alle organisaties waar u eigenaar of beheerder bent; gepauzeerde projecten tellen niet mee.
- Pauzeren na lage activiteit over 7 dagen (waarschuwingsmail ongeveer een week eerder). Herstellen kan 90 dagen vanuit het dashboard; daarna alleen een back-up downloaden. Betaalde projecten worden niet gepauzeerd; pauzeren via de API kan alleen bij gratis projecten.
- Per project 500 MB database; per organisatie 1 GB opslag, 5 GB dataverkeer, 50.000 maandelijkse gebruikers, 500.000 edge-function-aanroepen, 2 miljoen realtime-berichten. Bestanden maximaal 50 MB. Edge functions: 20 MB, 150 s, 100 functies, geheimen maximaal 100 × 48 KiB.
- Geen downloadbare back-ups op het gratis plan.
- Pro: 25 dollar per maand per organisatie, met 10 dollar rekenkrediet (één Micro-project). Rekenkracht per uur: Micro 0,01344 dollar (±10 per maand), Small ±15, Medium ±60, Large ±110, XL ±210. Elk extra project verhoogt de rekenkosten. Branching vraagt Pro (±0,01344 dollar per uur per branch).
- Verwijderen van een project is **onomkeerbaar** (ook back-ups verdwijnen).
- Ingebouwde e-mail voor inloggen werkt alleen naar teamleden van de organisatie; eigen SMTP is nodig voor gewone gebruikers (standaard 30 nieuwe gebruikers per uur).

## Eindpunten (Management API, `https://api.supabase.com`)
| Doel | Eindpunt | Klasse |
|---|---|---|
| organisaties | `GET /v1/organizations` | lezen |
| projecten lijsten | `GET /v1/projects` (**niet bevestigd** in de gelezen docs; zusterpad van het bevestigde `POST`) | lezen |
| project aanmaken | `POST /v1/projects` `{name, organization_slug, db_pass, region_selection:{type:"smartGroup",code:"americas\|emea\|apac"}, desired_instance_size?}`; zonder `desired_instance_size` Nano (gratis). `db_pass` is later niet te wijzigen of op te vragen. | kosten |
| beschikbare regio's | `GET /v1/projects/available-regions?organization_slug=&continent=EU` (beta) | lezen |
| project ophalen / gezondheid | `GET /v1/projects/{ref}`, `GET /v1/projects/{ref}/health?services=` | lezen |
| pauzeren / herstellen | `POST /v1/projects/{ref}/pause`, `/restore` | gevaarlijk |
| verwijderen | `DELETE /v1/projects/{ref}` | gevaarlijk (onomkeerbaar) |
| API-sleutels | `GET /v1/projects/{ref}/api-keys?reveal=true` (publishable `sb_publishable_…`, secret `sb_secret_…`; verouderd: anon, service_role) | lezen (secret nooit naar AI) |
| SQL | `POST /v1/projects/{ref}/database/query` `{query}` (beta, experimenteel); `POST …/database/query/read-only` (als `supabase_read_only_user`, objecten schema-gekwalificeerd) | per classificatie |
| migraties | `GET/POST /v1/projects/{ref}/database/migrations` `{query,name}` met `Idempotency-Key`; volgens de gids soms alleen voor geselecteerde klanten → terugval op `database/query` plus een eigen geschiedenis in `supabase/migrations/` | veilig / gevaarlijk |
| typings | `GET /v1/projects/{ref}/types/typescript?included_schemas=public` | veilig |
| back-ups | `GET /v1/projects/{ref}/database/backups` (herstel-eindpunten beperkt) | lezen |
| edge functions | `GET /functions`, `POST /functions/deploy` (multipart: zip + metadata `name, entrypoint_path, verify_jwt`) | veilig |
| edge-geheimen | `GET/POST/DELETE /v1/projects/{ref}/secrets` (waarden bij `GET`: **niet bevestigd**; wij tonen ze nooit) | gevaarlijk bij overschrijven/verwijderen |
| opslag | `GET /storage/buckets`, `PATCH /config/storage` | veilig / gevaarlijk |
| inlog-instellingen | `GET/PATCH /config/auth` (bevestigde velden: `rate_limit_*`; `site_url`, `uri_allow_list`: **niet bevestigd**, worden uit de `GET`-uitvoer gelezen) | gevaarlijk |
| logs | `GET /analytics/endpoints/logs` (`logs.all` is verwijderd: 410) | lezen |
| adviezen | `GET /advisors/security`, `/advisors/performance` (experimenteel) | lezen |
| branching | `GET/POST /branches` (Pro) | kosten |
Foutcodes in de referentie: 401, 403, 429 en bij plan-limiet 402. Het aantal verzoeken per minuut van de Management API is **niet bevestigd**.

## Sleutels en RLS (bevestigd)
- Publishable key (`sb_publishable_…`): veilig in browser, app en broncode. Secret key (`sb_secret_…`, rol `service_role` met BYPASSRLS): nooit in een browser, bundel, broncode, URL, chat of log. Verouderde `anon`/`service_role` werken tot eind 2026.
- RLS moet aan staan op elke tabel in een blootgesteld schema (`public`). Tabellen uit het dashboard hebben RLS standaard aan; **tabellen die met SQL zijn gemaakt niet**: dan zelf `enable row level security` en alleen de nodige rechten geven. RLS aan zonder beleid = niets bereikbaar met de publishable key. Weergaven omzeilen RLS tenzij `security_invoker = true`. Aanbevolen: `to authenticated`, `(select auth.uid()) = user_id`.
- Opslag: zonder beleid op `storage.objects` zijn uploads niet toegestaan.

## Clients (bevestigd)
- Vite/React: `@supabase/supabase-js`, `VITE_SUPABASE_URL` en `VITE_SUPABASE_PUBLISHABLE_KEY`, `createClient(url, key)`.
- Next.js: `@supabase/ssr` (`createBrowserClient`, `createServerClient` met `cookies`), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; op de server `getClaims()`, niet `getSession()`.
- Flutter: `Supabase.initialize(url:, anonKey: <publishable key>)` (de parameter heet nog `anonKey`).
- `@supabase/ssr` voor Vite: **niet bevestigd**, niet nodig.

## CLI (bevestigd)
`SUPABASE_ACCESS_TOKEN`, `supabase link --project-ref`, `supabase migration new <naam>` → `supabase/migrations/<JJJJMMDDUUMMSS>_<naam>.sql`, `supabase db push` (`SUPABASE_DB_PASSWORD` om de vraag te vermijden; of het strikt nodig is: niet bevestigd), `supabase gen types typescript --project-id`. Bijhouden in `supabase_migrations.schema_migrations`. **Geen automatische down-migraties**: terugdraaien = een nieuwe migratie die de wijziging ongedaan maakt ("rolling forward"); `supabase migration repair` past alleen de boekhouding aan. Studio gebruikt de CLI niet (geen extra installatie); alles gaat via de Management API.

## Indeling in risicoklassen
1. **Lezen**: schema, tabellen, kolommen, beleid, RLS-status, logs, adviezen, functies, opslag (alleen metadata), projectstatus, publieke configuratie, `SELECT` met limiet.
2. **Veilig schrijven**: `CREATE TABLE` (met RLS), `ADD COLUMN` (nullable of met standaardwaarde), `CREATE INDEX`, `CREATE POLICY` die niet ruimer is dan nodig, `INSERT` van seed-gegevens, functie plaatsen, opslagmap aanmaken, typings maken, gratis extensies.
3. **Gevaarlijk**: `DROP`, `TRUNCATE`, `DELETE`, `UPDATE` (ook met `WHERE`), `ALTER … DROP/TYPE/RENAME`, RLS uitzetten, beleid verruimen (`USING (true)`, `to anon` met schrijfrechten), `GRANT`/`REVOKE`, rolwijzigingen, inlog-instellingen of providers wijzigen, geheimen overschrijven of verwijderen, project pauzeren of verwijderen, migraties terugdraaien, `DO`-blokken, `COPY … PROGRAM`, alles wat niet leesbaar is of meerdere statements bevat met een gevaarlijk deel. **Bij twijfel = gevaarlijk.**
4. **Kosten**: betaald project aanmaken, rekenkracht of add-ons, branching.

## Netwerk
Alle verbindingen van deze functie lopen via Studio's Rust-kant met een vaste lijst toegestane hosts (alleen `api.supabase.com`). De frontend roept Supabase nooit zelf aan. Pagina's als de aanmeldpagina openen alleen in de systeembrowser.

## Bewust nu niet
- OAuth (zie hierboven), de officiële MCP-server, branching, het herstellen van back-ups via de API (beperkt), het lezen van edge-geheimen.

---

# Resultaat: wat er is gebouwd (2026-11-18)

## Hoe het werkt
- **Alles gaat via Studio (Rust).** De AI roept `db_*`-tools aan (MCP-server). De Node-server doet zelf niets met Supabase: hij stuurt de vraag naar de app (`host_request`) en krijgt een uitslag terug (`UITGEVOERD`, `GEWEIGERD` of `MISLUKT`). Het token uit de OS-kluis, het databasewachtwoord en alle sleutels blijven in Rust. Er is geen tool of veld waarmee de AI een sleutel kan opvragen of meegeven (een test bewaakt dat).
- **Eén pijplijn voor elke schrijfactie** (`src-tauri/src/supa/engine/write.rs`): SQL lezen en indelen (parser, `classify.rs`) → rijen tellen → back-up → besluit (`policy.rs`: toestaan, bevestigen of weigeren) → vangnet (git-checkpoint, momentopname van het schema) → uitvoeren → log. Dezelfde pijplijn geldt voor de AI, voor de gebruiker (scherm Gegevens, SQL-venster) en voor "ongedaan maken".
- **Bevestigingen** zijn een dialoog in de Studio-UI (nooit in het gesprek met de AI), met de verandering in gewone woorden, het aantal rijen, een waarschuwing bij verlies, de back-upstatus en kosten. "Niet toestaan" heeft de focus; Escape telt als nee; zonder antwoord binnen 10 minuten is het nee.

## Acties per risicoklasse
| Klasse | Voorbeelden | Voorzichtig | Zelfstandig | Volledige controle |
|---|---|---|---|---|
| 1 Lezen | `SELECT` met limiet, schema, beleid, logs, adviezen, typen, projectstatus, publieke configuratie | vrij | vrij | vrij |
| 2 Veilig schrijven | tabel/kolom/index/beleid toevoegen, seed-gegevens (≤ 500 rijen), functie plaatsen, nieuw edge-geheim, privé-opslagmap, extensie uit de gratis lijst, project wakker maken | bevestigen | vrij | vrij |
| 3 Gevaarlijk | `DELETE`, `UPDATE`, `DROP`, `TRUNCATE`, kolom verwijderen, `ALTER` (hernoemen, type), `GRANT`/`REVOKE`, schrijven in `auth`/`storage`, beleid verruimen, inlog-instellingen, geheim overschrijven, project pauzeren, migratie terugdraaien, onleesbare SQL, meerdere instructies met een gevaarlijk deel | bevestigen | bevestigen | vrij, **maar** bevestigen bij > 100 rijen of niet te tellen, zonder gelukte back-up, en bij onleesbare SQL |
| 4 Kosten | project maken, rekenkracht, add-ons | altijd bevestigen | altijd bevestigen | altijd bevestigen |
Veiligheidsregels (alleen in Volledige controle toegestaan, met een waarschuwing in het log): RLS uitzetten en een beleid dat iedereen laat schrijven. Nieuwe tabellen in het publieke schema krijgen automatisch RLS aan. "Volledige controle" vraagt een waarschuwing en het getypte woord *volledig*, heeft een einde (standaard 1 uur, 15 min tot 4 uur kiesbaar), geldt per project, toont een rode balk en valt daarna terug op Zelfstandig.

## Vangnet
Checkpoint (git), momentopname van het schema (in het log), lokale back-up (JSON, op deze computer, nooit in het project; ≤ 5000 rijen en 5 MB per tabel), actielog (SQLite `db_actions`) met "Maak ongedaan" voor: nieuwe tabel/kolom/index/beleid (omgekeerde SQL), verwijderde rijen (terugzetten uit de back-up) en inlog-instellingen. Schrijflimiet: 10 per minuut en 100 per sessie. Bij dezelfde fout (drempel uit Instellingen, standaard 3) stopt de bug-lus bewaker de AI. De noodknop breekt wachtende acties af, zet het niveau op Voorzichtig en stopt de AI.

## Wat niet ongedaan kan
- Een tabel of kolom die verdween (alleen de rijen staan in de back-up; de tabel zelf niet).
- Gewijzigde rijen (`UPDATE`): de oude waarden staan in het log van de back-up, maar Studio zet ze niet automatisch terug.
- Toegevoegde rijen, aangezette extensies, geplaatste functies en geheimen.
- Een gepauzeerd project dat langer dan 90 dagen stilligt, en een verwijderd project (Studio verwijdert nooit een project).

## Wat ik niet kon bevestigen (controleren met een echt account)
Zie `docs/supabase.md` hierboven bij "niet bevestigd": `GET /v1/projects` (pad), de velden van `config/auth`, of `GET /secrets` waarden teruggeeft (Studio gooit ze weg), de velden van het antwoord bij `database/query`, het gedrag van `functions/deploy` (multipart), het aantal verzoeken per minuut en of een plan-veld in `/v1/organizations` staat (zo niet toont Studio beide kostenmogelijkheden).

## Bewust niet gedaan
OAuth voor Supabase (zie boven), de officiële MCP-server, branching, de Supabase CLI, het lezen van edge-geheimen, een eigen server voor tokens.
