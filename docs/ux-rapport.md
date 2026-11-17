# UX-rapport Studio – Fase A (blind testen)

Datum: 2026-11-17. Getest zonder broncode te lezen: alleen wat een gebruiker ziet en kan doen.

## Testmethode en beperking

- **Gebruikte methode: (b)** de echte Vite-frontend in Chromium (Playwright) met een *stateful nagebootste* Tauri-laag. De mock simuleert projecten, AI-antwoorden, preview, versies, accounts en foutsituaties (offline, CLI ontbreekt, niet ingelogd, MCP weg).
  Scripts: `scripts/ux-sim.mjs`, `scripts/ux-run.mjs` (`node scripts/ux-run.mjs <joke|daan|sanne|fouten|matrix>`). Alle schermen staan in licht én donker in `docs/ux/<scenario>/` met meetgegevens (`metingen-*.json`: afgekapte tekst, kleine klikdoelen, dubbele scroll, Engels, buiten beeld).
- **Methode (a), de echte Tauri-app, is niet gedaan.** Er is hier geen venstermanager, geen tauri-driver/WebDriver en geen computer-use. Zie "Niet getest".
- Schaal 125/150% is nagebootst via viewport = fysiek/schaal (1920×1080@125% = 1536×864 CSS-px). Dat is hetzelfde wat Windows de webview geeft, maar niet echte DPI-rendering.
- De AI-antwoorden zijn nep: oordelen over de *kwaliteit* van de AI hoort hier niet bij.

## Samenvatting – top 10 problemen

| # | Ernst | Probleem |
|---|-------|----------|
| 1 | **Blokkerend** | Het invoerveld voor de opdracht is een smalle verticale streep (±30 px breed, tekst loopt per letter onder elkaar). Bij elke vensterbreedte < ±2400 px. De gebruiker ziet niet waar je typt en niet wat je typt. |
| 2 | **Blokkerend** | De knop "Versturen" en soms "Verbeter mijn opdracht" vallen buiten beeld/worden afgekapt naast de smalle streep. Enter werkt, maar dat staat nergens. |
| 3 | **Groot** | Gesprek is bij een leeg project bijna onzichtbaar: de voorbeelden verdringen alles, het gesprek scrollt in een klein venster tussen vaste balken (dubbele scroll, 5 vaste blokken onder elkaar nemen ±55% van de hoogte). |
| 4 | **Groot** | Bij 900×600 (minimum) en 1000×700 is het "Nieuw project"-venster boven en onder afgesneden; "Project aanmaken" is niet zonder scrollen bereikbaar. |
| 5 | **Groot** | Foutmelding "Claude is niet geïnstalleerd" toont `npm install -g …` en "een gewone terminal" – jargon voor Joke; geen knop "Installeer voor mij" of "Hulp". |
| 6 | **Groot** | Foutmelding "Geen verbinding met internet" en "Je bent nog niet ingelogd" zijn begrijpelijk, maar staan in rood en met onduidelijke volgorde van knoppen ("Probeer opnieuw" is primair, ook al heeft dat zonder inlog geen zin). Technische details staan in de standaardweergave. |
| 7 | **Groot** | Veel Engels/jargon in de standaardweergave: "Technische weergave", "MCP", "run_checks", "Template: leeg", "checkpoints", "Close" (schermlezer-label van de dialoogknop), "Project sluiten (stopt terminals en MCP)". |
| 8 | **Middel** | Rechterpaneel "Projectinfo" neemt ±18% breedte voor info die een gebruiker niet nodig heeft (map, template, tijdstempel met seconden), terwijl het gesprek smal is. |
| 9 | **Middel** | Preview-knoppenbalk (Stop/Herstart/Kies een onderdeel/Telefoon/Tablet/Computer/Vernieuwen) loopt buiten het paneel; "Tablet", "Computer" en "Vernieuwen" zijn niet zichtbaar bij ≤1920 px. |
| 10 | **Middel** | Klikdoelen kleiner dan 32 px: "Verwijderen uit lijst" (23×23), het sluit-kruisje van dialogen (23×23), het invoerveld/radio in dialogen (23×23). |

## Wat goed werkt

- Eerste scherm is rustig; één duidelijke blauwe knop "Nieuw project".
- Veldfouten staan bij het veld, in gewoon Nederlands ("Geef je project een naam.", "Kies eerst een map waarin het project komt.") en het eerste fout veld krijgt de focus.
- Het Nieuw-project-venster legt uit wat er gebeurt: "Er wordt een map … aangemaakt in de gekozen locatie".
- Terugzetten van een versie vraagt bevestiging en zegt wat er gebeurt: "Je huidige werk wordt eerst bewaard… Er gaat niets verloren." Escape sluit dialogen.
- Status van de AI is zichtbaar (Bezig met nadenken → Controleert of alles werkt → Klaar) en er is een groene balk "Preview beschikbaar".
- Preview van de nep-website verschijnt vanzelf; de downloadpagina legt uit wat wel/niet in de zip zit.
- Donker thema is consistent; geen horizontale paginascroll in één van de matrixformaten.

## Persona 1 – Joke (62, hovenier; 1920×1080 @125%)

Screenshots: `ux/joke/` (nummers hieronder).

1. **Openen (01).** *Zie:* links "Studio", blauwe knop "Nieuw project", midden "Kies of maak een project om te beginnen.", rechts "PROJECTINFO – Geen project geselecteerd". *Verwacht:* uitleg wat Studio doet. *Twijfel:* "Projecten", "Projectinfo" – wat is dat? Ze klikt uit nieuwsgierigheid op Instellingen (02): thema- en taalkeuzes, prima, maar "Taal van de AI: Eenvoudige taal" is verwarrend ("welke taal praat ik dan?"). Het lege midden is saai; het nodigt niet uit tot de grote knop. → **Middel**: lege toestand mist een duidelijke primaire actie en uitleg in 1 zin.
2. **Nieuw project (04–08).** Leeg verzenden geeft een rode tekst bij het veld (goed, 05). Enter in het naamveld (06) werkt niet zonder map en toont de fout over de map onderaan: ze moet "Map kiezen" begrijpen; knop zegt "Map kiezen…" maar het is niet duidelijk dat dat een venster van Windows opent. "Soort project: Leeg project / Web-app met React" – "React" is jargon. Na aanmaken komt ze direct in het gesprek. → **Middel** (jargon "React"/"Web-app"), **Klein** (geen focus naar de map-fout).
3. **Opdracht geven (09–12).** *Zie:* een brede lege plek onderaan waar een tekstveld zou moeten zijn; alleen een smalle streep met één letter onder elkaar (09). *Verwacht:* een groot tekstvak met "Wat wil je maken?". Ze weet niet waar ze moet klikken; probeert Bestand toevoegen (verkeerd). Ze komt er pas doorheen door op de streep te klikken. → **Blokkerend (#1, #2)**. De voorbeeldkaarten ("Takenlijst-app", "Menukaart…") helpen wél, maar tonen halfafgesneden tekst bij scrollen (09).
4. **Preview (12, 16).** De groene balk "Preview beschikbaar" + "Bekijk preview" is duidelijk. Een tweede wijziging ("maak de kop groen") lukt alleen via de streep. De preview-knoppenbalk is rommelig: "Stop", "Herstart", "Kies een onderdeel", "Telefoon" – "Herstart" van wat? → **Middel**.
5. **Fout (zie Fouten).**
6. **Terugzetten (17–19).** *Zie:* "Versies" (knop in de gespreksbalk) én rechts "Terug naar vorige versie" (staat grijs). Twee plekken voor hetzelfde. De bevestiging (18) is goed. Na Escape (19) is ze terug zonder wijziging; ze weet niet of het gelukt is. → **Middel**: geen bevestiging/toast "Teruggezet naar …" in dit scenario getoond; rechterknop lijkt uitgeschakeld.
7. **Wissel van AI / account (20–22).** "Wissel van AI" opent een keuze; "AI-accounts" toont "Studio bewaart nooit wachtwoorden of tokens… Provider/Label/Account toevoegen" – *jargon:* "Provider", "Label", "profielmap", "CLI". Joke begrijpt niet wat een account hier is. → **Groot**.
8. **Publiceren (23–25).** Er is alleen "Download je project" en "Controleer veiligheid" – er is geen echte publicatie; de titel "Publiceren en delen" belooft meer. Er staat niet wat ze nodig heeft (domein, hosting). Toast "Klaar: 5 bestanden opgeslagen in /home/…" (onderin) overlapt de knoppen rechtsonder (26). → **Groot** (beloofd/geleverd mismatch), **Klein** (toast overlapt).
9. **Sluiten en heropenen (27–28).** Na "Project sluiten" blijft de tab "Geavanceerd" staan met lege "Kies of maak een project…". Het project staat nog in de lijst; klikken opent het weer. Geen bevestiging of uitleg ("Alles is bewaard"). → **Middel**.

## Persona 2 – Daan (24, student; 1366×768)

Screenshots: `ux/daan/`.

- Maakt project (04–05), klikt voorbeeld "Takenlijst-app" (06): dat werkt goed en voelt snel. AI denkt (07) → klaar (08) met preview.
- "Kies een onderdeel" (09) – klikt in preview om iets aan te wijzen; werkt, maar niet duidelijk wat er daarna gebeurt (waar komt zijn opmerking?). → **Middel**.
- "Telefoon" (10): schakelt weergave; "Tablet" en "Computer" zijn buiten beeld bij 1366 px (**Middel**).
- "Uiterlijk" (11): kitkeuze, duidelijk voor hem; leg niet uit dat dit de hele app verandert. **Klein**.
- Thema wisselen (12): werkt direct.
- "Wissel van AI" na andere acties: niet te vinden met de tekst "Wissel van AI" tijdens de tweede stap in dit scenario (script-notitie; waarschijnlijk veroorzaakt door dialoog die nog open stond). Ik rapporteer dit niet als gebruikersprobleem.
- Hij mist een zichtbare plek om te zien *wat de AI net veranderd heeft*, behalve "Wat is er veranderd?" als snelknop (gebruikt jargon "Er klopt iets niet" als suggestiechip, prima).
- Zelfde blokkades #1/#2 bij typen.

## Persona 3 – Sanne (38, snel, 1920×1080)

Screenshots: `ux/sanne/`.

- **Lange projectnaam met emoji (04).** Dialoog zegt "Kies een korte naam (maximaal 60 tekens)" – goed, wat te doen staat erbij. In de projectlijst wordt de naam afgekapt met "…" (goed), maar de volledige naam is niet te lezen (geen tooltip te zien). **Klein**.
- **Lange opdracht met speciale tekens/emoji (06–07).** Het veld blijft een streep van ±30 px; de lange tekst loopt per letter verticaal. Shift+Enter voegt een regel toe, maar ze ziet het niet. Er staat nergens "Enter = versturen, Shift+Enter = nieuwe regel". **Blokkerend (#1)**, **Middel** (uitleg ontbreekt).
- Lange woorden in het Nieuw-project-venster lopen door tot buiten het venster in de uitleg "Er wordt een map … aangemaakt" (eerdere run, 05–10): tekst valt buiten de dialoog. **Middel**.
- **Venster verkleinen (10–12).** 1280×720: sidebar en preview blijven bruikbaar. 1000×700 en 900×600: de preview verdwijnt (goed), maar het gesprek wordt het enige paneel met vaste balken boven/onder; de hoofdknop "Bestand toevoegen" is groter dan het tekstveld. **Groot** (#1/#3).
- **Tab-volgorde (13).** Focusring zichtbaar op "Bestand toevoegen"; geen val. De Tab-volgorde begint bij de zijbalk, dan tabs, dan gesprek – logisch. Het tekstveld krijgt pas laat focus. **Klein**.
- **Versies + Escape (14–15).** Werkt.
- Sanne wil "snel": ze ziet de blauwe knop "Bouwen" in de modusschakelaar "Eerst overleggen | Bouwen" en denkt dat het een verstuurknop is. Dat is een modus, geen actie. **Groot**: twee blauwe elementen (Bouwen en Versturen) met onduidelijke rol; de echte verstuurknop zit buiten beeld.

## Fouten (screenshots `ux/fout-*/`)

| Situatie | Wat de gebruiker ziet | Oordeel |
|----------|----------------------|---------|
| AI niet geïnstalleerd (`fout-cli_weg/06`) | Kaart "Claude is niet geïnstalleerd. Installeer de CLI met een van onderstaande commando's in een gewone terminal. Installeer via npm `npm install -g @anthropic-ai/claude-code`" | Jargon, geen knop die het voor je doet, kaart wordt afgesneden door het gesprekspaneel. **Groot** |
| Geen internet (`fout-offline/08`) | "Geen verbinding met internet. Controleer je internetverbinding en probeer opnieuw." + knoppen "Probeer opnieuw" / "Technische details" | Begrijpelijk en met actie. **Klein**: "Technische details" hoort ingeklapt en minder opvallend; rode tekstkleur voor alles. |
| Niet ingelogd (`fout-niet_ingelogd/08`) | "Je bent nog niet ingelogd. Log eerst in bij je AI-account. Dat doe je bij 'AI-accounts'." + "Probeer opnieuw" (primair) / "Naar AI-accounts" | Tekst goed, maar primaire knop is de verkeerde. **Middel** |
| MCP weg (`fout-mcp_weg/06`) | Rode balk "MCP-server niet beschikbaar. Node.js is niet gevonden op deze computer. Installeer Node.js 20 of nieuwer van https://nodejs.org …" met `spawn node ENOENT` | Jargon (MCP, Node.js, ENOENT) in de standaardweergave. **Groot** |

## Venstergroottes en schaal (matrix: `ux/matrix/*`)

| Formaat | Bevinding |
|---------|-----------|
| 900×600 (minimum) | Dialoog "Nieuw project" afgesneden boven en onder; primaire knop alleen met scrollen. Gesprek heeft ±100 px nuttige hoogte. **Groot** |
| 1280×720 (en 1920×1080 @150%) | Gesprek te smal (±455 px); invoerveld streep; preview-knoppen lopen buiten beeld; projectinfo-paneel weg. |
| 1366×768 | Idem, iets ruimer. |
| 1536×864 (1920@125%) | Idem. Beste bruikbaarheid van de preview, maar nog steeds streep. |
| 1920×1080 | Zelfde indeling; veel witruimte in het midden bij leeg gesprek. |
| 2560×1440 | Alles klein; het invoerveld is het enige formaat waarin het veld bruikbaar breed is, maar het gesprek en de rest blijven klein (geen schaling van de lettergrootte; gebruikt maximale breedte niet). **Klein** |

Meetwaarden over alle runs: 198× een knop van 23×23 px (sluit-kruisje), 126× "Verwijderen uit lijst", 128× afgekapt "Wat wil je maken of veranderen?" (de tekst boven de streep), 122× een textarea van 30×110 px, 26× "Vernieuwen" en 20× "Computer" buiten beeld.

## Toetsenbord en toegankelijkheid

- Escape sluit dialogen (Versies, Instellingen). Geen toetsenbordval gevonden buiten de terminal (die is niet getest).
- Focusring zichtbaar; contrast in licht en donker oogt in orde (er is een eigen WCAG-test, `src/theme.test.ts`); blauwe en rode statussen hebben ook een icoon of tekst.
- Het sluit-kruisje heeft Engels label "Close" voor schermlezers. **Klein**

## Alle problemen met ernst

| ID | Ernst | Persona | Taak | Wat ik zag | Wat ik verwachtte | Screenshot | Waarschijnlijke oorzaak (zichtbaar) | Voorstel |
|----|-------|---------|------|-----------|-------------------|-----------|----------------------------------|----------|
| U01 | Blokkerend | Alle | 3 | Opdrachtveld is ±30 px breed, tekst per letter onder elkaar | Breed tekstveld met "Wat wil je maken?" | joke/09, matrix/*/04 | Veld deelt een rij met brede knoppen en wordt platgedrukt | Veld op eigen rij, volle breedte, groeit tot max. hoogte en scrolt |
| U02 | Blokkerend | Alle | 3 | "Versturen" onzichtbaar/afgekapt rechts | Eén duidelijke verstuurknop naast het veld | joke/09, sanne/06 | Knoppenrij te breed voor het paneel | Rij laten omslaan; één primaire knop "Versturen" altijd zichtbaar; hint "Enter verstuurt, Shift+Enter = nieuwe regel" |
| U03 | Groot | Joke, Sanne | 3 | Voorbeelden + chips + modus + knoppen vullen het paneel; gesprek heeft weinig ruimte, dubbele scroll | Gesprek krijgt de ruimte | joke/12, sanne/09 | Vijf vaste blokken in een kolom | Chips en modus compacter/inklapbaar; voorbeelden alleen in leeg gesprek |
| U04 | Groot | Sanne | 5 | Dialoog afgesneden bij 900×600 | Knoppen altijd zichtbaar | matrix/minimaal*/02 | Dialoog niet scrollbaar met vaste knoppen | Dialoog met scrollbare inhoud en vaste knoppenrij; max-hoogte van viewport |
| U05 | Groot | Joke | 5 | CLI-fout met npm-commando | Knop die het regelt / hulp | fout-cli_weg/06 | Technische tekst in standaardweergave | Eenvoudige tekst + knop "Installeren" + "Hulp"; commando alleen onder "Technische details" |
| U06 | Groot | Joke | 5 | MCP/Node-fout met `spawn node ENOENT` | Gewone uitleg | fout-mcp_weg/06 | Idem | Idem; bij "Geavanceerd" houden |
| U07 | Groot | Joke | 7 | "Provider", "Label", "profielmap", "CLI" bij accounts | "Welke AI en welke naam?" | joke/21 | Technische termen | "Welke AI?" / "Naam van dit account"; uitleg in gewone woorden |
| U08 | Groot | Joke | 8 | Publiceren = alleen download en veiligheid | Uitleg wat nodig is om online te komen | joke/23–25 | Titel belooft meer dan er is | Titel "Delen"; stappenlijst "Wat heb je nodig om online te gaan?" |
| U09 | Groot | Sanne | 3 | "Bouwen" (blauw) lijkt verstuurknop | Eén primaire actie | joke/12 | Modusschakelaar opvallender dan verstuurknop | Modus kleiner/neutraal met uitleg; primair = Versturen |
| U10 | Middel | Joke | 1 | Leeg midden, "Projectinfo" zonder uitleg | Uitleg + knop | joke/01 | Lege toestand zonder actie | Lege toestand met korte uitleg en grote knop "Maak je eerste project" |
| U11 | Middel | Joke | 2 | "Web-app met React" | Gewone woorden | joke/04 | Jargon | "Website of app met voorbeeldpagina's" |
| U12 | Middel | Joke | 6 | Terugzetten op twee plekken, geen bevestiging achteraf | Eén plek, melding "Teruggezet" | joke/17–19 | Dubbele ingang | Eén ingang; melding na terugzetten |
| U13 | Middel | Joke | 9 | Na sluiten blijft tab "Geavanceerd" met leeg scherm | Terug naar start, "Je werk is bewaard" | joke/27 | Tabstaat niet gereset | Terug naar startscherm met melding |
| U14 | Middel | Daan | 4 | Preview-knoppenbalk loopt buiten beeld (Tablet/Computer/Vernieuwen) | Alles zichtbaar | daan/09, matrix/*/04 | Rij zonder wrap | Omslaan of scroll/overflowmenu; "Herstart" → "Opnieuw laden" |
| U15 | Middel | Joke | 1–9 | Rechterpaneel met mapnaam, template, tijd met seconden, "Laatste checks"/"Tijdlijn" | Alleen wat ik nodig heb | joke/12 | Technische info standaard zichtbaar | Inklapbaar, standaard dicht; of verwijderen uit standaardweergave |
| U16 | Middel | Joke | 5 | Primaire knop bij "niet ingelogd" is "Probeer opnieuw" | "Naar AI-accounts" primair | fout-niet_ingelogd/08 | Vaste volgorde | Primaire actie per fouttype |
| U17 | Middel | Sanne | 3 | Geen uitleg over Enter/Shift+Enter | Hint onder veld | sanne/06 | — | Hint in veld/onder veld |
| U18 | Middel | Sanne | 2 | Lange woorden lopen uit dialoog | Tekst breekt | sanne (eerste run) | Geen woordafbreking | `break-words` op dialoogteksten |
| U19 | Middel | Joke | 7 | "Taal van de AI: Eenvoudige taal" onduidelijk | — | joke/02 | — | Uitleg "Hoe de AI tegen je praat" |
| U20 | Middel | Alle | — | Jargon: "Technische weergave", "MCP", "checkpoints", "run_checks", "Template" | Gewone woorden | joke/12 | — | Hernoemen in nl.json |
| U21 | Middel | Daan | 4 | "Kies een onderdeel": niet duidelijk wat daarna gebeurt | Korte uitleg | daan/09 | — | Hulptekst bij actief maken van de keuze |
| U22 | Klein | Alle | — | Klikdoelen 23×23 (kruisje, verwijder uit lijst) | ≥ 32–40 px | metingen | Iconknoppen klein | Hitarea vergroten |
| U23 | Klein | Joke | 8 | Toast overlapt knoppen rechtsonder | Geen overlap | joke/26 | Vaste positie | Toast boven of verschuiven |
| U24 | Klein | Sanne | 2 | Lange projectnaam afgekapt, geen volledige naam | Tooltip | sanne/09 | — | Tooltip/titel |
| U25 | Klein | Alle | — | Schermlezer-label "Close" (Engels) | "Sluiten" | metingen | Standaardtekst shadcn | Label in i18n |
| U26 | Klein | Sanne | 5 | Eerste focus in een dialoog / tabvolgorde: veld pas laat | Veld eerst | sanne/13 | — | Focus naar eerste veld |
| U27 | Klein | Alle | — | Groot scherm (2560): alles klein, veel leegte | Schaalt mee | matrix/groot | Vaste lettergrootte | Basisgrootte schalen vanaf ±1920 px |

## Niet getest (en waarom)

- **De echte Tauri-app / Windows-venster:** geen venstermanager, geen tauri-driver/WebKitWebDriver, geen computer-use in deze container. Daardoor niet gecontroleerd: native bestandskiezer, vensterrand, minimumgrootte door het OS, slepen/schalen met de muis, DPI-rendering van Windows (125/150% is alleen nagebootst met een viewport).
- **Echte terminal (xterm) en toetsenbord-val daarin**, echte CLI-installatie/inlog (Claude/Gemini/Codex), echte MCP-start, echte AI-wachttijden en gevoelde snelheid, echte preview-server, laden van lettertypes bij koude start, flikkeren tijdens echte streaming.
- **Echte offline-situatie:** nagebootst als foutmelding.
- **Gebruikers zelf:** de personas zijn gespeeld door mij; echte gebruikers kunnen andere dingen doen (andere woorden zoeken, in andere volgorde klikken).
- **Contrastmetingen per pixel:** alleen visueel en door de bestaande WCAG-test.
- Eén aanname: de nep-AI toont de berichten die de echte AI-adapter ook stuurt (foutcodes `network`, `not_logged_in`); echte meldingen kunnen afwijken.


---

# Fase B – status na reparatie

Alle reparaties staan als aparte commits op branch `ccr-b2c1b01d-7ba1q7` (zoek op `UX U..`). Na elke stap: lint, tsc, vitest (231 tests) en build groen; `npm run ui:a11y` geeft 0 schendingen. Nieuw: `npm run ux:test` (scripts/ux-test.mjs) draait op de zeven formaten de hoofdflow (nieuw project → opdracht typen → Enter → antwoord), controleert onder meer breedte van het invoerveld, zichtbaarheid van "Versturen" en "Project aanmaken", horizontale scroll en klikdoelen, en vergelijkt screenshots met `docs/ux/basis/` (`--update` zet nieuwe basis).

## Status per probleem

| ID | Ernst | Status | Wat er gedaan is |
|----|-------|--------|------------------|
| U01 | Blokkerend | **Opgelost** | Invoerveld staat op een eigen rij, volle breedte, groeit tot een maximum (30% van de vensterhoogte) en scrolt daarna. Test: ≥ 240 px breed op alle formaten. |
| U02 | Blokkerend | **Opgelost** | Knoppen onder het veld slaan om; "Versturen" staat rechts en is op alle formaten binnen beeld. Knoplabels korter: "Bestand", "Verbeter tekst". |
| U03 | Groot | **Deels** | Snelle acties alleen in een lopend gesprek (in een leeg gesprek staan de voorbeelden), op lage vensters (≤ 760 px hoog) verdwijnen chips en hint (hint blijft voor schermlezers), gesprek heeft minimaal 10 rem. Op 900×600 moet het paneel nog scrollen om het invoerveld volledig te zien. |
| U04 | Groot | **Opgelost** | Dialogen hebben een maximale hoogte en scrollen intern; test: "Project aanmaken" bereikbaar op 900×600. |
| U05 | Groot | **Deels** | Tekst in gewoon Nederlands ("Claude is nog niet geïnstalleerd… plak in de Terminal… Hulp bij installeren"). Het commando blijft zichtbaar; een knop "Installeer voor mij" is een functiewijziging en is bewust niet gemaakt. |
| U06 | Groot | **Opgelost** | Titel en hints zonder jargon; `spawn node ENOENT` en logregels staan onder "Technische details". |
| U07 | Groot | **Opgelost** | "Welke AI?", "Naam van dit account", geen "profielmap"/"CLI". |
| U08 | Groot | **Opgelost** | Titel "Delen en online zetten"; uitleg met drie dingen die je nodig hebt, plus knop "Vraag de AI om hulp hierbij" (gebruikt de bestaande chat). Echt publiceren blijft niet gebouwd (bewust, fase 2). |
| U09 | Groot | **Opgelost** | Modusknop is neutraal (niet meer blauw), met kop "De AI mag:". Alleen "Versturen" is primair. |
| U10 | Middel | **Opgelost** | Welkomstscherm met uitleg en één knop "Maak je eerste project"; tabs zijn verborgen zolang er geen project is. |
| U11 | Middel | **Opgelost** | "Startklare website" i.p.v. "Web-app met React". |
| U12 | Middel | **Bewust niet** | Bij nader inzien bestond de bevestiging al (melding in het Versies-venster na terugzetten); mijn test klikte niet op "Ja, ga terug". De tweede ingang in het infopaneel blijft: het is dezelfde actie op een andere plek. |
| U13 | Middel | **Opgelost** | Na sluiten terug naar het welkomstscherm, tab gereset, melding "Je werk is bewaard". |
| U14 | Middel | **Opgelost** | Preview-knoppen slaan om; "Herstart" heet nu "Opnieuw starten". |
| U15 | Middel | **Deels** | Jargon eruit (Soort project, Laatste controle, Eerdere versies), maar het paneel blijft staan. Nog te beoordelen: inklappen of weghalen. |
| U16 | Middel | **Opgelost** | Bij "niet ingelogd" is "Naar AI-accounts" de hoofdactie. |
| U17 | Middel | **Opgelost** | Hint onder het veld: "Enter verstuurt je bericht. Shift + Enter begint een nieuwe regel." |
| U18 | Middel | **Opgelost** | Dialogen breken lange woorden af. |
| U19 | Middel | **Opgelost** | "Hoe de AI tegen je praat". |
| U20 | Middel | **Deels** | Template/checks/checkpoints/tijdlijn/run_checks/runtime vervangen. Nog Engels/techniek in de standaardweergave: "MCP: …"-badge en "Technische weergave" op het tabblad Geavanceerd. |
| U21 | Middel | **Opgelost** | Uitleg bij "Kies een onderdeel" is concreter. |
| U22 | Klein | **Opgelost** | Verwijderknop 36 px; test controleert klikdoelen ≥ 32 px. Het keuzevakje "Automatisch naar de preview wisselen" is 20 px, maar het label ernaast (≥ 36 px) is ook klikbaar. |
| U23 | Klein | **Deels** | Meldingen verplaatst naar boven in het midden: ze overlappen niet meer met knoppen rechtsonder, wel kort met de tabbalk. |
| U24 | Klein | **Opgelost** | Volledige projectnaam als tooltip. |
| U25 | Klein | **Opgelost** | Sluitknop-label "Sluiten". |
| U26 | Klein | **Bewust niet** | In dialogen krijgt het eerste veld al focus; de volgorde op de hoofdpagina is logisch. Niet aangepast. |
| U27 | Klein | **Opgelost** | Vanaf 2200 px breed is het lettertype 21 px i.p.v. 17 px; schermen daaronder blijven ongewijzigd. |

## Voor/na (licht)

| Onderwerp | Voor | Na |
|-----------|------|----|
| Gesprek met invoerveld op 1280×720 | `ux/voor-na/voor-matrix-laptop-1280x720-04-d-na-opdracht-licht.png` | `ux/voor-na/na-matrix-laptop-1280x720-04-d-na-opdracht-licht.png` |
| Nieuw project op 900×600 | `ux/voor-na/voor-matrix-minimaal-900x600-02-b-nieuw-project-licht.png` | `ux/voor-na/na-matrix-minimaal-900x600-02-b-nieuw-project-licht.png` |
| Startscherm | `ux/voor-na/voor-joke-01-…` | `ux/voor-na/na-joke-01-…` |
| AI niet geïnstalleerd | `ux/voor-na/voor-fout-cli_weg-06-…` | `ux/voor-na/na-fout-cli_weg-06-…` |
| Node ontbreekt | `ux/voor-na/voor-fout-mcp_weg-06-…` | `ux/voor-na/na-fout-mcp_weg-06-…` |
| Accounts | `ux/voor-na/voor-joke-21-…` | `ux/voor-na/na-joke-21-…` |
| Delen en online zetten | `ux/voor-na/voor-joke-23-…` | `ux/voor-na/na-joke-23-…` |

Alle schermen na de reparatie (licht en donker) staan opnieuw in `docs/ux/<scenario>/`; de basis voor de regressietest in `docs/ux/basis/`.

## Herhaalde test als de drie personas

- **Joke:** weet nu wat ze moet doen (welkomstscherm), ziet een breed tekstvak met uitleg over Enter, begrijpt de accountpagina en foutmeldingen. Blijft lastig: "Technische weergave", "Geavanceerd" en de MCP-badge zijn nog technisch; Publiceren is nog geen echte publicatie.
- **Daan:** kan direct typen en voorbeelden gebruiken; preview-balk slaat om. Nog onduidelijk wat "Uiterlijk" precies verandert.
- **Sanne:** typen en Enter werken, de lange opdracht blijft binnen het veld; chips scrollen horizontaal en "Er klopt iets niet" is op smalle vensters deels afgekapt (Klein, nieuw gevonden).
- **Nieuw gevonden bij de hertest:** de melding "Project gesloten" overlapt kort de tabbalk (Klein); op 900×600 moet het gesprekspaneel nog scrollen om het invoerveld volledig te zien (Middel, zie U03).

## Dit moet u zelf nog beoordelen

1. Zijn de nieuwe knoplabels ("Bestand", "Verbeter tekst", "De AI mag:") duidelijk genoeg voor uw doelgroep?
2. Moet het infopaneel rechts standaard dicht of weg (U15)?
3. Wilt u de tabbladnaam "Geavanceerd" en de knop "Technische weergave" hernoemen (bijv. "Voor ervaren gebruikers")?
4. Wilt u een knop "Installeer voor mij" voor de AI-programma's (nieuwe functie, vereist een beveiligingsafweging)?
5. Moet "Publiceren" echt online zetten kunnen (Vercel e.d.), of blijft het bij uitleg + hulp van de AI?

## Wat niet geverifieerd kon worden

- Alles uit de lijst "Niet getest" in fase A blijft gelden: de echte Tauri-app, echte Windows-schaling (125/150% is nagebootst via viewportgrootte), de native bestandskiezer, de echte terminal en echte CLI's.
- `field-sizing: content` (het meegroeien van het invoerveld) is in Chromium getest. In oudere WebKit-versies (Linux/macOS) valt het veld terug op een vaste hoogte met scrollen; dat is nog niet in de echte app gezien.
- De visuele regressietest vergelijkt met schermafbeeldingen uit dezelfde omgeving (Chromium, Linux, lokale lettertypen); op een andere machine kunnen kleine afwijkingen voorkomen en moet `--update` gebruikt worden.
- Of de nieuwe teksten voor echte niet-technische gebruikers begrijpelijk zijn is niet gemeten met echte mensen, alleen beoordeeld door mijn persona's.
