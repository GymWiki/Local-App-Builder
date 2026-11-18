# Gebruiksklaar: stand van zaken

Dit document is de integratie-inventaris voor de weg naar "een leek komt van idee tot gepubliceerde app, zonder terminal en zonder jargon". Het is geschreven door de code en de bestaande rapporten door te nemen, niet uit het hoofd. Het wordt aan het eind van dit traject afgemaakt met een gereedheidslijst (zie "Afronding" onderaan).

Datum inventaris: 18 november 2026, versie 0.1.0 (commit-hash staat onderaan Instellingen).

## DEEL 0 · Inventarisatie

### Wat werkt end-to-end (in code, met tests; met nagebootste AI)

| Onderdeel | Stand |
|---|---|
| Projecten (maken, hernoemen, uit lijst halen, miniatuur) | Werkt. Bestanden van gebruikers worden nooit gewist. |
| Homescherm met projectkaarten en werkruimte met docking (flexlayout), standaardindeling herstellen | Werkt. |
| Linkermenu met statusbolletjes en vier-stappenvoortgang (Start) | Werkt. |
| Chat per AI-CLI (Claude, Gemini via adapter) met toestemmingsdialogen, plan-modus ("Eerst overleggen"), foutkaarten in gewone taal, bug-lus-bewaking | Werkt. Codex heeft geen adapter (valt terug op terminal). |
| MCP-server + runtime (checks, dev-server, screenshots, checkpoints, console-fouten) | Werkt; een storing blokkeert de rest niet (`begin_mcp`), met een foutkaart. |
| Preview (statisch, Node, studio.json, Flutter-uitleg), aanwijzen in de preview, checkpoints/versies met terugzetten | Werkt. |
| Kits (shadcn-varianten, Fragments UI, Material voor Flutter) en kit-check | Werkt. |
| Instellingen in vier groepen, bedieningsniveaus, standaard herstellen, versie- en buildindicator | Werkt. |
| Koppelingen (Verbinden-knop) met GitHub, Vercel, Supabase; kluis (OS-keychain) | Werkt, getest met nagebootste diensten; echte accounts nog niet door mij getest. |
| Supabase (tabellen, niveaus, vangnet, log, noodknop) | Werkt (nagebootst getest). |
| GitHub-back-up (alleen vooruit, geheimenscan, ophalen van GitHub) | Werkt (lokale test-remote). |
| Vercel online zetten (voorbeeld/echt met bevestiging, variabelen, terugzetten, domein) | Werkt (nagebootst getest). |
| In de appwinkel: gegevens, klaar-check, formulierhulp, teksten | Eerste stap werkt; geen verbinding met Google of Apple. |
| Downloaden/bijwerken (GitHub Actions, ondertekende updates) | Gebouwd; nog nooit een echte release gedraaid. |

### Half af

| Onderdeel | Wat ontbreekt |
|---|---|
| Eerste start | Bestond niet: geen welkomstscherm, geen keuze van AI en bedieningsniveau bij de eerste keer. (DEEL 1.) |
| Systeemcheck | Alleen losse stukken: AI-programma's (`cli_status`) en Node (foutkaart bij MCP). Geen Git-, internet-, schijfruimte- of rechtencheck, geen samenvatting. (DEEL 1.) |
| Route "van idee tot app" | Er zijn 4 stappen (idee, voorbeeld, aanpassen, online). De opdracht vraagt 8 (idee, plan, uiterlijk, bouwen, aanpassen, gegevens, testen, delen). Ontbrekend: plan goedkeuren, test-rapport, "delen" als gezamenlijke stap, route bovenin het project, stap op de projectkaart. (DEEL 2.) |
| Startprojecten | Er is één template (`web-react-vite`). (DEEL 3.) |
| Foutmeldingen | Chat-fouten zijn vertaald; algemene fouten ("Er ging iets mis: …") tonen nog de ruwe tekst. Geen "Toon details", geen probleemrapport. (DEEL 4.) |
| Herstel na crash | Projecten staan altijd op schijf en de versies zijn er, maar er is geen "Je werk is bewaard, wil je verdergaan?" bij opstarten. (DEEL 4.) |
| Privacy | De instelling zegt dat Studio niets verstuurt; er is geen aparte privacyverklaring. Er bestaat geen gebruiksstatistiek (dus ook geen keuze nodig). (DEEL 6.) |
| Installer | Er is een installerbouw, maar **Node.js en Git moeten nog op de computer staan**; dat is niet meegeleverd. Voor een leek is dat een harde blokkade. (DEEL 6: gedocumenteerd, niet op te lossen zonder een grote bouwstap.) |
| Licentie | Geen licentiehaak; Studio is overal gratis. (DEEL 6.) |

### Ontbreekt, of kon niet (nog) niet

- Alles uit de winkelopdracht na de eerste stap: bouwen en uploaden naar Google Play en App Store, schermafbeeldingen, pictogrammen, exporteren. (Google-bronnen waren niet bereikbaar.)
- Een Flutter-template, een "publish-kit" en een privacyverklaring-generator bestaan niet (de eerdere opdrachten gingen ervan uit).
- Een echte test met een beginner en met echte AI-accounts (kan hier niet).
- Meegeleverde Node.js en Git; code-ondertekening van de installer (certificaat); macOS-notarisatie; echte release gedraaid.

### Opdrachten uit het plan die kennelijk niet (volledig) zijn uitgevoerd

1. Codex-chatadapter (bewust niet: eerst de uitvoer van de echte CLI als fixture).
2. Winkelopdracht C deel 2 t/m 6 en D (zie boven).
3. Echte (niet nagebootste) controle van Supabase, GitHub, Vercel met eigen accounts: staat op de handmatige testlijsten.
4. De "echte-app-controle" (Playwright tegen de Tauri-app) kon hier niet; alleen nagebootst.

### Top 10: waar een leek vermoedelijk vastloopt

| # | Plek | Waarom | Oplossing in dit traject |
|---|---|---|---|
| 1 | **Installeren** | Node.js en Git ontbreken, de leek weet niet wat dat is | Systeemcheck met uitleg + downloadknop (DEEL 1); meeleveren is een apart traject (docs/uitrollen.md) |
| 2 | **Eerste start** | Geen uitleg wat Studio doet of wat eerst moet | Eerste-startscherm in drie stappen (DEEL 1) |
| 3 | **AI koppelen** | Weet niet welke AI, of dat een eigen account nodig is | Stap 2 van de eerste start, met uitleg per AI |
| 4 | **Bedieningsniveau** | Termen als "toestemming" begrijpt niemand | Drie keuzes in gewone taal (DEEL 1) |
| 5 | **Wat nu?** | Na het maken van een project is niet duidelijk wat de volgende stap is | Route-balk bovenin het project met één grote knop (DEEL 2) |
| 6 | **Idee beschrijven** | Leeg invoerveld; geen idee wat te typen | Voorbeelden, maximaal drie vragen, plan in mensentaal (DEEL 2/3) |
| 7 | **Preview/fouten** | Ruwe foutteksten, of de AI loopt vast | Vertaalde fouten + "Toon details" + probleemrapport (DEEL 4); lus-bewaking bestaat al |
| 8 | **Terugkeer na sluiten of crash** | Weet niet of er iets verloren is | "Je werk is bewaard" bij opstarten (DEEL 4) |
| 9 | **Online zetten** | Accounts, tokens, kosten, de bevestiging | Stappen met Verbinden-knop bestaan; kosten- en uitlegzinnen worden aangescherpt (DEEL 4) |
| 10 | **Voor de winkel klaarmaken** | Veel formulieren, wachttijden, kosten | Klaar-check en formulierhulp bestaan; bouwen/uploaden niet |

Voortgang per deel staat hieronder bij elk deel; de definitieve gereedheidslijst volgt bij "Afronding".


## DEEL 1 · Eerste start en klaar-check (gedaan)

- **Eerste-startscherm in drie stappen** (`src/components/app/eerstestart/EersteStart.tsx`): welkom in twee zinnen (met "Studio verstuurt zelf niets over jou"); AI kiezen en inloggen (Claude en Gemini; maakt zo nodig zelf een account aan en opent het bestaande inlogvenster dat ook de installatie-uitleg toont); hoeveel de AI zelf mag doen, in drie keuzes in gewone taal (zelf bepalen / vraag bij belangrijke dingen / laat de AI zijn gang gaan, met waarschuwing). Elke stap is over te slaan ("Later doen") en alles is terug te vinden bij Instellingen ("Eerste start opnieuw tonen").
- **Systeemcheck** (`src-tauri/src/systeemcheck.rs`, ook onder Hulp): Node, Git, AI-programma's, internet (alleen een verbinding naar poort 443, niets verstuurd), schijfruimte (waarschuwing onder 1 GB, fout onder 200 MB) en schrijfrechten. Elk punt heeft een uitleg in gewone taal en bij Node en Git een knop naar de downloadpagina.
- **Beperking, eerlijk:** Studio levert Node.js en Git nog **niet** mee en kan ze niet zelf installeren; de leek krijgt uitleg en een downloadknop. "Los dit voor mij op" bestaat dus alleen voor wat Studio echt zelf kan (opnieuw proberen, inloggen). Meeleveren is een aparte bouwstap (zie docs/uitrollen.md).
- **Codex** wordt nog niet ondersteund (er is geen adapter; eerst de uitvoer van de echte CLI opnemen). Het scherm zegt dat.
- **MCP/runtime blokkeert nooit:** bestond al (`begin_mcp`, foutkaart met "Opnieuw proberen"); onveranderd.
- **Hulp-paneel:** had al uitleg, voorbeeldvragen en een vraagveld; nu ook de systeemcheck. "Meld een probleem" komt bij DEEL 4.
- Tests: `cargo test systeemcheck`, `eerstestart.test.tsx`.

## DEEL 2 · De route "van idee tot app" (gedaan, met beperkingen)

- **Route-balk bovenin elk project** (`RouteBalk.tsx`): acht stappen (idee, plan, uiterlijk, bouwen, aanpassen, gegevens, testen, delen) met bolletjes, de huidige stap met uitleg en geschatte duur, één grote knop en "Overslaan". De route is een hulpmiddel: elke stap is aan te klikken en over te slaan; niets is verplicht.
- **Eén bron van waarheid:** feiten komen uit Rust (`route_feiten`: gesprek, PROJECT.md, plan-vlag, uiterlijk, versies, controles, back-up/online/winkel), de stappen uit `src/lib/route.ts` (getest). Balk en homescherm zeggen daardoor altijd hetzelfde. De bestaande vier stappen onder **Start** blijven ongewijzigd.
- **Homescherm:** elke projectkaart toont "Stap 3 van 8: Uiterlijk" en één knop "Verder gaan".
- **Idee:** dialoog met voorbeelden (afsprakenapp, takenlijst, kleine webshop, portfolio, kassa-app); de AI krijgt de opdracht maximaal drie korte vragen te stellen, met keuzes, en daarna een plan in PROJECT.md te schrijven in mensentaal. **Beperking:** de keuzes verschijnen als tekst in het gesprek (de chat heeft nog geen aanklikbare antwoordknoppen); de gebruiker typt of plakt een keuze.
- **Plan:** dialoog toont het plan uit PROJECT.md met "Klopt dit?" (goedkeuren, aanpassen of laten maken). Alleen de lege koppen telt als "geen plan".
- **Uiterlijk:** opent de bestaande kitkiezer. **"Verras me" bestaat niet** (niet gebouwd).
- **Bouwen/Testen:** een vaste opdracht aan de AI om per stap in gewone taal te vertellen wat hij doet, en om na afloop een groen/oranje/rood-rapport te geven. Het rapport is chat-tekst; er is geen apart testscherm.
- **Gegevens:** alleen open als de app opslag nodig heeft; anders "niet nodig".
- **Delen:** opent Online zetten (waar back-up, Vercel en winkel staan). Live zetten en insturen vragen daar altijd bevestiging.
- Tests: `cargo test route`, `route.test.ts`, `route.test.tsx`; alle `ux:`-suites slagen met de balk erin.

## DEEL 3 · Startprojecten en voorbeelden (gedaan, met beperkingen)

- **Nieuw project** biedt nu "Beschrijf je idee" (leeg project) en "Begin met een voorbeeld". Voorbeelden (alle in `templates/`, samen minder dan 60 kB elk, zonder externe bronnen, met ingevulde PROJECT.md zodat de route direct een plan heeft):
  | Voorbeeld | Soort | Gegevens |
  |---|---|---|
  | Takenlijst (`start-takenlijst`) | web | zonder database (bewaard in de browser) |
  | Portfolio (`start-portfolio`) | web | zonder database; contactformulier opent het e-mailprogramma |
  | Kleine webshop (`start-webshop`) | web | met een kant-en-klaar **voorstel** voor een Supabase-tabel (`supabase/migrations/`, beveiliging per rij aan, nog geen beleid); werkt zonder database |
  | Kassa (`start-kassa`) | web, gemaakt voor een telefoon | zonder database |
  | Startklare website (`web-react-vite`) | web (React), met kitkiezer | bestaand template |
- **Draait in een minuut:** statische voorbeelden hebben geen installatie nodig; de preview start direct (getest: `detect` ziet "static").
- **Beperking, eerlijk:** er is **geen echte mobiele app (Flutter) als voorbeeld**: er bestaat geen Flutter-template en ik heb er geen gebouwd (niet te testen zonder Flutter). Het kassa-voorbeeld is een website voor op een telefoon.
- **Kits:** de voorbeelden gebruiken eigen stijlvariabelen (licht en donker, focusringen, grote knoppen), geen kit; de kitkiezer en kit-check blijven bij het React-template. De "Uiterlijk"-stap wordt voor de statische voorbeelden daarom niet automatisch geopend.
- Tests: `cargo test templates` (elk voorbeeld kopieert, is klein, heeft een plan, geen geheimen, geen externe verbindingen), `npm run ux:startprojecten` (elk voorbeeld draait echt in een browser met klikken en toetsenbord op 390×844, 1280×720 en 1920×1080).

## DEEL 4 — Als er iets misgaat, en vertrouwen

| Onderdeel | Wat er nu is | Plek |
|---|---|---|
| Fouten in gewone taal | Elke fout krijgt een titel, een oorzaak en een oplossing. De technische tekst staat achter "Toon details". | `src/lib/fouten.ts`, `FoutBanner.tsx`, `fouten.*` in `nl.json` |
| Meld een probleem | In Hulp: maakt een rapport zonder geheimen en zonder gebruikersnaam in paden. Je kopieert het zelf; er wordt niets verstuurd. | `rapport.rs`, `ProbleemRapport.tsx` |
| Herstel na een storing | Bij de volgende start: "Je werk is bewaard, wil je verdergaan?" | `herstel.rs`, `HerstelMelding.tsx` |
| Geheimenscan bij export | `export_zip` scant eerst; een gevonden geheim blokkeert de export. Back-up en online zetten hadden dit al. | `export.rs`, `github/scan.rs` |

Nog niet gedaan in dit deel: een tijdlijn met miniaturen per eerder moment (de lijst met versies bestaat al, zonder miniaturen) en een kostenzin voor elke actie.

Tests: `src/lib/fouten.test.ts`, `src/components/app/fouten.test.tsx`, `cargo test herstel rapport export`.
