# Online zetten met Vercel

Onderzoek, keuzes en werking van het online zetten van websites en web-apps op het **eigen** Vercel-account van de gebruiker.
Onderzocht op 18 november 2026 via de documentatie-index van Vercel (de officiële docs zijn niet rechtstreeks leesbaar). Per feit staat of het in de bron stond of niet te controleren was; er is niets uit het geheugen aangevuld zonder dat te zeggen.

## 1. Wat uit de documentatie is gelezen

| Feit | Bron |
|---|---|
| Deployment zonder Git: eerst elk bestand uploaden met `POST /v2/files` (inhoud als binaire body, antwoord 200), daarna `POST /v13/deployments` met de bestanden per SHA of kleine bestanden direct erin | rest-api/deployments (upload-deployment-files, create-a-new-deployment) |
| Velden van `POST /v13/deployments`: `name`, `project`, `files`, `target` (`production`; weggelaten = preview), `projectSettings` (`framework`, `buildCommand`, `installCommand`, `outputDirectory`, `rootDirectory`, `nodeVersion`, …). `projectSettings` is **verplicht bij de eerste deployment** van een project; `null` = automatisch detecteren | idem |
| `skipAutoDetectionConfirmation` en `forceNew` als queryparameters | idem |
| Bouwlogboek: `GET /v3/deployments/{idOrUrl}/events` (met `direction`, `limit`, `follow`, `since`, `builds`, …) | rest-api/deployments/get-deployment-events |
| Productie verwijzen naar een deployment (zonder opnieuw te bouwen): `POST /v10/projects/{projectId}/promote/{deploymentId}` | rest-api/projects/point-production-traffic… |
| Terugdraaien op het **Hobby**-plan: alleen naar de **vorige** productie-deployment; verder terug geeft "To rollback further than the previous production deployment, upgrade to pro." | cli/rollback |
| Omgevingsvariabelen: `POST /v10/projects/{idOrName}/env` met `key`, `value`, `type` (`system`, `encrypted`, `plain`, `sensitive`), `target` (`production`, `preview`, `development`); `?upsert=true` werkt een bestaande bij; lijst: `GET /v10/projects/{idOrName}/env` | rest-api/projects |
| Aangepaste omgevingen bestaan (`/v9/projects/{id}/custom-environments`); Studio gebruikt ze niet | idem |
| Op het Hobby-plan kan één functieregio worden gekozen | project-configuration |

## 2. Wat niet te controleren was (en hoe Studio daarmee omgaat)

- **Voorwaarden van het gratis (Hobby-)plan** (zoals "alleen niet-commercieel gebruik", limieten voor deployments, bandbreedte en functies): de zoekopdracht gaf alleen het rollback-punt hierboven. Studio belooft daarom niets over limieten of commercieel gebruik. Het scherm zegt: "Het gratis plan van Vercel heeft eigen voorwaarden (onder andere over commercieel gebruik en limieten). Lees ze op vercel.com voordat je een bedrijfswebsite online zet", met een link naar `vercel.com/pricing`.
- Het exacte aanmaken van een project (`POST /v11/projects`), de statusvelden (`readyState`), annuleren (`PATCH /v12/deployments/{id}/cancel`), de lijst met deployments (`GET /v6/deployments`) en domeinen: de eindpunten zijn bekend uit eerder gebruik maar niet in deze sessie met de bron vergeleken. De code leest daarom alleen velden die er hoogstens ontbreken (alles optioneel; een onverwacht antwoord wordt een nette fout), en elke aanname staat in `src-tauri/src/vercel/api.rs` met een test op een nagebootst antwoord. **Zet dit op de handmatige testlijst (§8).**
- **Bestandsnaam bij het uploaden:** dat Vercel de bestanden onder hun **SHA-1** (hex) verwacht en de header `x-vercel-digest` voor `POST /v2/files` gebruikt, stond niet in de gelezen tekst (alleen "reference them by SHA"). De code volgt dit gangbare gebruik; controleer het bij de eerste echte test.
- Dat een "gevoelig" (`sensitive`) variabele niet voor de omgeving `development` kan, is een aanname; Studio stuurt serversleutels daarom alleen naar `production` en `preview`.
- Runtime-logboek van de live site (fouten die bezoekers veroorzaken): eindpunt en vorm niet te controleren. **Niet gebouwd**; wel het bouwlogboek.
- Domeinen kopen: kost geld en de vorm van het antwoord is niet geverifieerd. **Niet gebouwd**; Studio legt uit hoe je een bestaand domein koppelt en toont wat Vercel zelf aangeeft.

## 3. Keuzes

1. **Alles via de REST-API vanuit Studio (Rust).** Geen Vercel-CLI en geen Node nodig. Het token blijft in de kluis (`Manager::authorized`).
2. **Vercel bouwt zelf.** We uploaden de bronbestanden (geen `node_modules`, geen `.git`, geen geheimen) en laten Vercel het framework detecteren en bouwen (`framework: "vite"` voor het meegeleverde template, `null` voor een gewone site). Een eigen "prebuilt output" is dus niet nodig.
3. **Git-gekoppelde automatische deployments:** niet te bouwen zonder dat de gebruiker de Vercel-GitHub-app installeert (de `gitSource` in de API verwijst naar die koppeling). Daarom bouwt Studio dat **niet**; "Maak automatisch een back-up" (GitHub) en "zet online" blijven aparte stappen. Een schakelaar "Zet automatisch een voorbeeld online na elke back-up" is niet gebouwd (zou stil dingen online zetten).
4. **Voorbeeld ≠ echt.** Een voorbeeld (preview) krijgt een eigen adres en vraagt geen bevestiging. **Echt online zetten** vraagt altijd een bevestiging in de Studio-UI, op elk niveau, ook als de AI het vraagt.
5. **Geen zware bestanden:** per bestand maximaal 50 MB en in totaal 200 MB (eigen keuze; de limieten van Vercel zelf waren niet te controleren).
6. **Flutter** wordt hier niet online gezet (geen webbouw); het scherm zegt dat eerlijk.

## 4. Veiligheid

- Token nooit in logs, opdrachtregels, de chat, tooluitvoer of AI-context. Foutmeldingen van Vercel worden niet doorgegeven: alleen vaste codes en een samenvatting van het bouwlogboek (waarbij geheimen worden gemaskeerd).
- Voor het uploaden: dezelfde scan op geheimen als bij de GitHub-back-up op de bestanden die meegaan.
- Waarden van omgevingsvariabelen staan alleen in de OS-kluis; in SQLite staan alleen de namen. Een waarde wordt nooit teruggegeven, ook niet aan de AI. De AI kan alleen vragen om een al ingevoerde waarde door te sturen (`vercel_set_env`).
- Een geheime sleutel (server) gaat nooit in een naam die de browser te zien krijgt (`VITE_`, `NEXT_PUBLIC_`, `PUBLIC_`, `REACT_APP_`) en alleen naar projecten met een serverdeel. Een geheime Supabase-sleutel in een "openbare" variabele wordt geweigerd.
- Netwerk: alleen `api.vercel.com`. Geen enkele derde partij.

## 5. Wat er gebouwd is

Zie `src-tauri/src/vercel/` (`api.rs`, `files.rs`, `engine.rs`, `env.rs`, `store.rs`, `app.rs`), migratie `0009_vercel.sql`, scherm onder Online zetten (`src/components/app/vercel/`), de vijf stappen in `src/lib/online.ts`, MCP-tools in `mcp-server/src/tools.ts`.

- **Stappen en één grote knop** (deel 7): controles groen → Vercel gekoppeld (Verbinden-knop op die plek) → variabelen compleet → voorbeeld → echt online. `onlineStappen`/`volgendeOnlineStap` bepalen alles; het scherm toont alleen het resultaat.
- **Voorbeeld/echt:** voorbeeld zonder extra vraag; echt online vraagt altijd een bevestiging (gebruiker: dialoog in het scherm, backend weigert zonder `bevestigd`; AI: `confirm.rs`-dialoog, zwaar). Voor elke deployment een lokale versie en een regel in het logboek met het adres.
- **Mislukte bouw:** bouwlogboek ophalen, soort fout in gewone taal, laatste regels (geheimen gemaskeerd), "Laat de AI dit herstellen". Dezelfde fout herhaaldelijk bij de AI: de AI wordt gestopt (zelfde drempel als bij Supabase).
- **Annuleren en time-out:** "Stoppen" annuleert bij Vercel; na 15 minuten geeft Studio het op en annuleert.
- **Variabelen** (deel 3): waarden alleen in de OS-kluis; Supabase-aanbod (alleen openbaar adres + publiceerbare sleutel); controle op ontbrekende variabelen vóór het online zetten (blokkeert echt, waarschuwt bij voorbeeld).
- **Eerdere versies en terugzetten** (deel 4): lijst van Vercel + eigen logboek; "Terug naar deze versie" met bevestiging; op het gratis plan eerlijke melding.
- **Domein** (deel 5): een bestaand domein koppelen en controleren; Studio toont wat Vercel vraagt. Kopen niet gebouwd.
- **Netwerk** (deel 8): API-verzoeken alleen naar `api.vercel.com`; de browser mag `*.vercel.app` (je eigen sites) openen, er wordt daar niets opgehaald.

## 6. Bewust niet gebouwd

Git-gekoppelde deployments; domeinen kopen; runtime-logboek van de live site; automatisch online zetten na een back-up; prebuilt output; Flutter-web.

## 7. Tests

`cargo test vercel` (nagebootste API: project maken en koppelen, upload en deployment, voortgang, annuleren, mislukte bouw met logsamenvatting, omgevingsvariabelen, terugdraaien, 401/403/429/time-out, bevestigingsregel voor live, geen geheimen in logs/tooluitvoer/projectbestanden, geen serversleutel in een clientvariabele), `src/components/app/vercel/*.test.tsx`, `npm run ux:vercel` op 1280×720, 1366×768 en 1920×1080.

## 8. Handmatig testen (eigen account)

1. Koppel Vercel (token plakken). Zet een voorbeeld online: je krijgt een adres dat werkt.
2. Zet echt online: er verschijnt eerst een bevestiging; daarna staat de site live.
3. Maak een fout in het project, zet een voorbeeld online: de bouw mislukt en je ziet een samenvatting in gewone taal.
4. Voeg een omgevingsvariabele toe en controleer in Vercel dat hij er staat (de waarde is daar niet meer leesbaar als hij als "gevoelig" is opgeslagen).
5. Draai terug naar de vorige versie (Hobby: alleen de vorige).
6. Controleer dat de velden en antwoorden in §2 kloppen met het echte Vercel (vooral project maken, status, annuleren, lijst, domeinen).
