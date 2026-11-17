---
name: add-kit
description: Voegt een UI-kit, thema of componentenbibliotheek toe aan de kit library van Studio (design-packs/). Gebruik dit bij elk verzoek om een UI-kit, thema of componentenbibliotheek aan de kit library toe te voegen, ook als dat in één zin gebeurt ("voeg Mantine toe aan de kit library") of als de gebruiker /add-kit <pakketnaam of URL> typt.
argument-hint: "<pakketnaam of URL>"
---

# Een kit toevoegen aan de kit library

Doel: de kit in `$ARGUMENTS` (npm-pakketnaam of URL; bij een gewone zin: de kit die de gebruiker noemt) veilig en gecontroleerd toevoegen aan `design-packs/`, zodat gebruikers hem in Studio kunnen kiezen (kit-kiezer) en de AI hem consequent gebruikt. Lees eerst `docs/kits.md` (formaat, register, eerdere kits) en `design-packs/kit.schema.json`. Praat met de gebruiker in eenvoudig Nederlands.

## Harde regels (altijd)
- **Geen installatiescripts uitvoeren** van onbekende pakketten zonder bevestiging van de gebruiker. Installeer in tests altijd met `--ignore-scripts` (de scripts `kit:try` en `kit:test` doen dat al). Zie je `preinstall`/`install`/`postinstall`, meld het en zet `installatiescripts: true` in `kit.json`.
- **Nooit een kit met een niet-toegestane licentie.** Toegestaan: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC. Controleer de licentie in de **officiële repository** (LICENSE-bestand), niet alleen op npm.
- **Geen code kopiëren uit kits met een onbekende of ontbrekende licentie.**
- Bij twijfel: **stoppen, niets toevoegen en de gebruiker laten beslissen.**
- Versies altijd **exact vastzetten** (geen `^`, `~`, `latest`).

## Stappen

### 1. Onderzoeken
Zoek op: npm-pagina (`npm view <pakket> --json`), repository, README, documentatie. Noteer: naam, laatste versie, **licentie**, onderhoudsstatus (laatste release, open problemen), **peer-dependencies**, setup (provider, stijlimport, config), componentenlijst, thema/tokens. Controleer en meld **installatiescripts** (`npm view <pakket> scripts`). Pak voor de inspectie het pakket uit in een eigen lege map (`npm pack`), draai nooit code uit het pakket.

### 2. Beslissen
Ga na: is de licentie toegestaan, past de stack bij een template (nu: `react-vite`, template `templates/web-react-vite`; Flutter heeft hier geen toolchain), is het onderhouden (recente release, geen verlaten project), is de setup op te lossen met wat de engine kan (`setup.stijlImports`, `provider`, `tokenMap`, `vitePlugins`, `alias`, `extraPakketten`)? **Bij twijfel stoppen** en de gebruiker de keuze voorleggen, met de feiten erbij.

### 3. Manifest maken
Maak `design-packs/<id>/` met:
- `kit.json` (volgens het schema; `bron`, `licentie`, exacte `versie`, `stacks`, `installatiestappen` in eenvoudig Nederlands, `kitcontext.catalogus`: `fragments-json` / `typings` / `bestanden`, `kitcontext.kern`: de 10-15 componenten die een pagina of formulier het vaakst nodig heeft, `kitCheck.vervangNative` en `verbodenImports`);
- `tokens.json` (kleuren licht/donker, rondingen, spacing, schaduw, typografie) en de `tokenMap` naar de CSS-variabelen van de kit;
- `rules.md`: **kort** (5-8 regels: importpad, samengestelde onderdelen, tokens, labels);
- `voorbeeld.tsx` (een kleine pagina met kitcomponenten) en `preview.png` (wordt in stap 5 gemaakt).
Zet bij type `bestanden` de componenten in `design-packs/_shared/<naam>/components/` (en verwijs ernaar met `componenten`).

### 4. Catalogus controleren
Maak een proefproject buiten de repo en kijk naar `docs/ui-kit.md`:
```
npm run kit:try -- <id> /tmp/kit-proef-<id>
```
Controleer: staan de belangrijkste componenten erin met props en voorbeeld, is het compact (richtwaarde < 6000 tokens), klopt het importpad.

### 5. Testen
```
npm run kit:validate
npm run kit:test -- <id> --preview     # install, build, lint, kit-check, catalogus, browser; maakt preview.png
```
Laat daarna **een AI-run in het proefproject** een landingspagina en een formulier bouwen (volg `docs/ui-kit.md` en de bouwregels in CLAUDE.md van het proefproject). Draai dan `npm run kit:check -- /tmp/kit-proef-<id>`: de kit-check moet **groen** zijn en de pagina's moeten kitcomponenten hergebruiken (geen losse kleuren, pixelwaarden, gewone `<button>`/`<input>`). Herstel afwijkingen, of pas `rules.md`/`kern` aan als de AI steeds dezelfde fout maakt.

### 6. Vastleggen
- Voeg een regel toe aan het register in `docs/kits.md` (kolommen: kit-id, bron, licentie, versie, datum, bevindingen: peers, scripts, onderhoud, bijzonderheden).
- Draai `npm run kit:validate`. De kit staat daarna automatisch in de kit-kiezer (die leest `design-packs/`); er is geen code-aanpassing nodig.
- Draai `npm run kit:test -- --all` zodat bestaande kits niet kapot zijn.

### 7. Rapporteren (eenvoudig Nederlands)
Vertel kort: wat is toegevoegd (naam, versie), de licentie en waar je die controleerde, wat is getest (validate, kit:test, AI-run, kit-check), wat de gebruiker nog moet beslissen, en welke beperkingen er zijn. Maak **één commit** met een duidelijk bericht, bijvoorbeeld `Kit toegevoegd: <naam> <versie> (<licentie>)`. Push alleen als de gebruiker dat wil.

## Hulpmiddelen in deze repo
- `npm run kit:validate` — schema, bestanden, licentielijst, exacte versie, regel in docs/kits.md
- `npm run kit:test -- <id> [--preview]` / `--all` — kit toepassen op een leeg template en alles draaien
- `npm run kit:try -- <id> <map>` — proefproject om de kit mee uit te proberen
- `npm run kit:check -- <map>` — kit-check op een project (losse kleuren, pixels, native controls, andere bibliotheken)
- `npm run kit:schema` — `design-packs/kit.schema.json` opnieuw maken na een wijziging in `mcp-server/src/kits/schema.ts`
