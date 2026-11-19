# In de appwinkel (Google Play en App Store)

Onderzoek, keuzes en stand van zaken. Onderzocht op 18 november 2026. Per feit staat of het uit een officiële tekst is gelezen of niet; er is niets stilzwijgend uit het geheugen aangevuld. Alle limieten en regels staan met bron en datum in `config/store-spec.json` (één bestand; de code leest daaruit en bevat geen losse getallen).

## 1. Wat uit officiële bronnen is gelezen

| Feit | Bron |
|---|---|
| **Apple:** naam max. 30 tekens (min. 2), ondertitel 30, zoekwoorden **100 bytes**, beschrijving 4000, promotietekst 170, "Wat is nieuw" 4000 | developer.apple.com/help/app-store-connect/reference/app-information/ (+ platform-version-information) |
| **Apple:** schermafbeeldingen: minstens 1, maximaal 10 per apparaatmaat; `.jpeg`/`.jpg`/`.png`; geen alfakanaal of transparantie; voorbeeldmaten iPhone 1290×2796, 1284×2778, 1179×2556, 1170×2532, 1242×2208 (de volledige tabel staat bij Apple) | .../screenshot-specifications |
| **Apple:** privacybeleid-link is verplicht (in App Store Connect én in de app); bij een login is een werkend demo-account of demo-modus verplicht; wie accounts kan maken moet ze in de app kunnen verwijderen | developer.apple.com/app-store/review/guidelines/ (5.1.1, 2.1) |
| **Apple:** Developer Program 99 dollar per jaar; inschrijven als persoon of organisatie | developer.apple.com/programs/ |
| **Apple:** een build uploaden kan met Xcode, altool of Transporter (macOS-app); de API-toegang moet de accounthouder aanvragen en een teamsleutel geldt voor alle apps | .../manage-builds/upload-builds, .../app-store-connect-api |
| **Android:** applicationId: minstens twee delen; elk deel begint met een letter; alleen `[a-zA-Z0-9_]`; na publicatie nooit meer wijzigen | developer.android.com/build/configure-app-module#set-application-id |
| **Android:** Play App Signing: Google beheert de definitieve sleutel, jij een uploadsleutel; een verloren uploadsleutel kan via de Play Console worden vervangen; debug-ondertekende apps worden niet geaccepteerd; geldigheid tot na 22 oktober 2033 | developer.android.com/studio/publish/app-signing |

## 2. Wat niet te controleren was

Twee Google-hosts (`support.google.com`, `developers.google.com`) waren in deze omgeving niet bereikbaar. Daardoor is **niets uit de Play Console-documentatie gelezen**. In `store-spec.json` staan alle Google-limieten daarom met `"geverifieerd": false`, en het scherm toont dat bij elk veld ("niet uit de officiële tekst; controleer zelf"):

- limieten van titel, korte en volledige beschrijving en "Wat is nieuw" (30/80/4000/500 zijn gangbare waarden uit algemene kennis);
- maten en aantallen van pictogram, brede afbeelding en schermafbeeldingen;
- de Publishing API (`edits`, `bundles`, `tracks`, `listings`) en wat die **niet** kan (formulieren zoals Data safety en leeftijdsindeling);
- de regels voor een **gesloten test** voor nieuwe persoonlijke accounts (aantal testers en dagen);
- kosten van het Google-account;
- inloggen voor de Publishing API (serviceaccount of OAuth);
- de vereiste doel-API-versie voor nieuwe apps.

Ook bij Apple niet te lezen: het genereren van API-tokens (JWT, ES256, sleutel-ID, uitgever-ID, geldigheid, `aud`), de lijst van wat de App Store Connect API wel en niet kan (app-record aanmaken, TestFlight, indienen, leeftijdsindeling, privacy-label), tekens en lengte van een bundle-ID, en of een Mac vereist is om iOS te bouwen. Het gelezen uploadadvies noemt Xcode en Transporter; een eigen Mac is dus waarschijnlijk nodig of een bouwdienst, maar dat staat niet als regel in de gelezen tekst.

**Gevolg:** alles wat daarvan afhangt (uploaden, API-koppelingen, bouwen) is nog niet gebouwd en staat hieronder bij "Nog niet gebouwd". Vraag de beheerder van de omgeving om `support.google.com` en `developers.google.com` toe te staan, dan kan dit onderzoek worden afgemaakt.

## 3. Wat wel is gebouwd (deel 0 en 1 van C, en de basis van D)

| Onderdeel | Plek |
|---|---|
| Alle limieten en regels met bron, datum en "geverifieerd ja/nee" | `config/store-spec.json`, `src-tauri/src/winkels/spec.rs` |
| Tellen zoals de winkel (zichtbare tekens met emoji en samengestelde tekens als één; zoekwoorden in bytes) | `winkels/spec.rs` (Rust) en `Teksten.tsx` (zelfde regels) |
| Unieke app-naam: controle Android en iPhone, voorstel uit een domeinnaam | `winkels/appid.rs` |
| Versienummer en buildnummer van een Flutter-app lezen en ophogen (alleen de regel `version:` in pubspec.yaml) | `winkels/versie.rs` |
| Gegevens van de app (naam, app-ID's, contact, links, categorie, talen), zonder geheimen | `winkels/data.rs`, migratie `0010_winkels.sql` |
| Teksten per winkel, taal en veld met versies: concept → goedgekeurd (vergrendeld) → vervangen; de AI schrijft alleen concepten | `winkels/data.rs` |
| Klaar-check per winkel met bolletjes; wat je zelf bij de winkel doet is "handmatig" en je vinkt het zelf af | `winkels/klaar.rs`, `KlaarCheck.tsx` |
| Hulp bij de formulieren (gegevensveiligheid, privacy, advertenties, doelgroep, export, leeftijd) met een voorstel en reden uit pakketten, rechten en Supabase; "controleer dit zelf" waar alleen de ontwikkelaar kan beslissen; geen juridisch advies | `winkels/invulhulp.rs`, `Invulhulp.tsx` |
| Controle op inhoud: privacyverklaring ontbreekt of lijkt onecht, gevoelige rechten, testtekst (in winkeltekst = fout, in de app = waarschuwing), links die er niet echt uitzien, sleutelbestanden in het project | `winkels/veilig.rs`, `Veilig.tsx` |
| Scherm "In de appwinkel": Wat heb je nodig (kosten, wachttijden, wie wat doet), gegevens, klaar-check, formulierhulp, controle; tab Winkelpakket → Teksten | `src/components/app/winkels/`, `AppwinkelPanel.tsx` |
| MCP-tools `winkel_status`, `winkel_klaarcheck`, `winkel_schrijf_teksten` (concepten, pas na toestemming van de gebruiker, nooit een goedgekeurde tekst) | `mcp-server/src/tools.ts`, `winkels/app.rs::host` |

**Tests:** `cargo test winkels` (28), `src/components/app/winkels/winkels.test.tsx`, `npm run ux:winkels` (1280×720, 1366×768, 1920×1080).

## 4. Nog niet gebouwd (volgende stappen, in deze volgorde)

- **C deel 2, Android:** toolchain-controle, bouwen (lokaal of via GitHub Actions), uploadsleutel en keystore in de kluis, Play-koppeling, testversie, gesloten test, uitbrengen met bevestiging. Wacht op het onderzoek in §2.
- **C deel 3, iPhone:** App Store Connect-sleutel (.p8) in de kluis, bouwen via GitHub Actions (macOS) of een eigen Mac, TestFlight, indienen (altijd bevestigd).
- **C deel 4:** de overige tools (`winkel_bouw`, `winkel_upload_test`, `winkel_dien_in`, `winkel_breng_uit`, `winkel_haal_status`), **deel 5:** voortgangsbalk, tijdlijn en Status-dots in het menu, **deel 6:** beveiliging en netwerklijst voor Google-, Apple- en GitHub-adressen.
- **D (Winkelpakket):** schermafbeeldingen van de echte app (Flutter: emulator, `adb`, `flutter screenshot`; web: Playwright), stijlen en bijschriften, pictogrammen uit één bronafbeelding, demo-account in de kluis, Kopieer-alles, exporteren, MCP-tools voor schermafbeeldingen en export. De tab Winkelpakket bevat nu alleen **Teksten**.
- **Bestaat nog niet in dit project en moet eerst worden gebouwd** (de opdracht ging ervan uit): een Flutter-template, een "publish-kit" voor schermafbeeldingen en een privacyverklaring-generator. De privacy-link vul je nu zelf in.

## 5. Veiligheid
- Niets geheims in SQLite, projectbestanden, logs, chat of AI-context. Een demo-account krijgt later een plek in de OS-kluis; nu staat alleen "is ingesteld ja/nee".
- Alles wat de winkel zou veranderen (uitbrengen, indienen) vraagt later altijd een bevestiging in de Studio-UI. Nu verandert Studio niets bij een winkel: er is nog geen enkele verbinding met Google of Apple.
- Studio zegt in het scherm wat het zelf doet en wat jij zelf doet.

## 6. Handmatig testen
1. Open **In de appwinkel**. Vul een app-naam in met een cijfer aan het begin van een deel (`nl.1winkel`): je moet een duidelijke fout zien.
2. Gebruik "Doe een voorstel" met je domein; sla op. De bolletjes bij "Unieke app-naam" worden groen.
3. Maak een Flutter-project (of zet een `pubspec.yaml` met `version: 1.0.0+1` in je map): "Versienummer" toont het en "Alleen het buildnummer ophogen" maakt er `+2` van.
4. Onder **Winkelpakket → Teksten**: typ 31 tekens in de ondertitel van de App Store: de teller toont "!" en Goedkeuren is uit. Typ een tekst met een emoji: die telt als één teken. Keur goed: het veld is vergrendeld.
5. Vraag de AI een voorstel te schrijven: je krijgt eerst een vraag om toestemming; daarna staat het voorstel als concept klaar en is een goedgekeurde tekst onaangeroerd.
6. Zet in een testproject `lorem ipsum` in een winkeltekst of laat de privacy-link leeg: onder "Controle voor de beoordeling" verschijnt een fout.
