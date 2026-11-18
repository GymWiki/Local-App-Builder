# Studio-UI op shadcn/ui

Onderzoek en keuzes voor het omzetten van de interface van Studio zelf naar shadcn/ui. Gemaakt op 2026-11-17.

## Onderzoek

**Bronnen:** ui.shadcn.com (docs: Installation › Vite, Theming, Dark mode › Vite, CLI), de CLI zelf (`npx shadcn@latest init --help`, `add --help`, `mcp --help`) en een proefproject (`/tmp`, `init -t vite`), waarvan ik de gegenereerde bestanden heb bekeken.

- **Versie CLI:** `shadcn` 4.23.0 (npm "latest"). Proefproject: React 19.3.1, Vite 8, Tailwind 4 (`@tailwindcss/vite`), `radix-ui` 1.8, `lucide-react`, `tw-animate-css`, `class-variance-authority`.
- **Tailwind:** v4 (CSS-first, geen `tailwind.config.js`; `components.json` heeft `"tailwind.config": ""`). Studio gebruikt al Tailwind 4.3.5 met `@tailwindcss/vite`; dat past.
- **Alias:** `@/*` → `./src/*` in `vite.config.ts` (`resolve.alias`) én in `tsconfig` (`paths`, bij een Vite-project met losse `tsconfig.app.json` in beide bestanden). `@types/node` is nodig voor `node:path` in `vite.config.ts`.
- **Templates (`init -t`):** `next`, `start`, `vite`, `react-router`, `laravel`, `astro`. We kiezen **`vite`**. Overige opties: `-b/--base radix|base|aria`, `-p/--preset <naam>` (zoals `nova`), `--no-monorepo`, `-y`, `-f`, `--css-variables`. Zonder `--no-monorepo` en `--preset` stelt de CLI interactieve vragen; in een script geef je ze dus mee.
- **components.json (velden):** `$schema`, `style` (bijv. `radix-nova`), `rsc` (false voor Vite), `tsx`, `tailwind.{config,css,baseColor,cssVariables,prefix}`, `iconLibrary` (`lucide`), `rtl`, `aliases.{components,utils,ui,lib,hooks}`, `menuColor`, `menuAccent`, `registries`.
- **Thema's:** CSS-variabelen in `:root` en `.dark` (oklch), semantische paren zoals `--background`/`--foreground`, `--primary`/`--primary-foreground`, `--card`, `--popover`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--sidebar-*` en `--radius`. Tailwind koppelt ze via `@theme inline` aan `bg-background`, `text-foreground`, enz. Donkere modus = de klasse `.dark` op `<html>` (`@custom-variant dark (&:is(.dark *))`).
- **Lettertypen:** de CLI zet `@fontsource-variable/geist` in `index.css`; dat is een lokaal npm-pakket (geen externe verzoeken), dus geschikt voor local-first.
- **Donkere modus voor Vite:** de docs tonen een `ThemeProvider` (klasse `light`/`dark` op `<html>`, `system` via `prefers-color-scheme`) en een `ModeToggle`. Studio bouwt dezelfde aanpak, maar met de instellingen in SQLite (`ui:theme`).
- **shadcn MCP-server:** er is er **geen** beschikbaar in deze Claude Code-sessie (geen `mcp__shadcn__*`-tools). De CLI kent wel `shadcn mcp init` om er één voor je client in te stellen (`npx shadcn@latest mcp init --client claude`). Ik gebruik daarom de CLI (`shadcn add …`, `--dry-run`, `--view`) en de docs. Wil je de MCP-server zelf? Draai dat commando in de repo.

## Keuzes
1. `npx shadcn@latest init -t vite -b radix -p nova --no-monorepo -y` in de bestaande repo; geen wijzigingen aan `beforeDevCommand`/`beforeBuildCommand` van Tauri.
2. Alle shadcn-componenten komen via `npx shadcn@latest add …`, nooit met de hand.
3. Eigen samengestelde onderdelen komen in `src/components/app/` en gebruiken alleen shadcn-onderdelen en thematokens.
4. Thema, radius en spacing staan op één plek: `src/index.css` (CSS-variabelen). Geen losse kleuren in componenten (lint-regel).
5. Lettertypen worden lokaal gebundeld (`@fontsource-variable/*`).
6. Alle gebruikerstekst blijft in `src/i18n/nl.json`.

## Resultaat (2026-11-17)

### Geïnstalleerde versies
shadcn CLI **4.23.0** (stijl `radix-nova`, template `vite`), Tailwind CSS **4.3.5** (`@tailwindcss/vite`), React **19.3.1**, Vite 8.3.8, TypeScript 6.0.3, radix-ui 1.8.1, lucide-react 1.74.0, class-variance-authority 0.7.1, cn 0.5.2, tw-animate-css 1.4.0, sonner 2.0.8, react-hook-form 7.92.0 + zod 4.6.7 + @hookform/resolvers 7.0.7, react-resizable-panels 4.24.0, @xterm/xterm 6.0.0. Lettertypes (lokaal gebundeld): Atkinson Hyperlegible Next en JetBrains Mono (`@fontsource-variable/*`, OFL-1.1). Alleen dev: axe-core 4.14.1.

### Wat is vervangen
| Onderdeel | Nu gebouwd uit |
|---|---|
| Zijbalk: projecten, Nieuw project, accounts, instellingen | `Sidebar`, `Button`, `AlertDialog` (verwijderen uit de lijst) — `components/app/AppSidebar.tsx` |
| Tabs Maken / Uiterlijk / Publiceren / Geavanceerd | `Tabs` (panelen blijven gemount) |
| Chat links, preview rechts | `ResizablePanelGroup` — `components/app/SplitView.tsx` (onthoudt de breedte) |
| Chat | `Card`, `Avatar`, `ScrollArea`, `Textarea`, `Collapsible` (uitklapbare acties), `ToggleGroup` (Eerst overleggen / Bouwen), `Alert` — `components/app/chat/` |
| Toestemming (gevaar → "Nee" als standaardfocus) | `AlertDialog` (alleen Ja of Nee sluit het) |
| Versies, lus-melding, tijdlijn, terugzetten | `Dialog`, `Card`, `Badge`, `AlertDialog`, `Skeleton` |
| Nieuw project, Inloggen, Wissel van AI | `Dialog` (+ `react-hook-form` + `zod` met meldingen in gewone taal bij Nieuw project) |
| AI-accounts | `Field`, `Select`, `Input`, `Card`, `Badge`, `AlertDialog`; formulier met validatie |
| Instellingen | `Sheet` met `RadioGroup`/`Field`; geldige waarde-controle voor de bug-lus drempel (2–10) |
| Status: MCP en account | `Badge`; fouten met "Opnieuw proberen" in `Alert`; laden met `Skeleton` |
| Projectinfo | `Card`, `Select`, `ScrollArea` |
| Foutmelding bovenaan | `Alert` met Sluiten; `Sonner`-toasts voor bevestigingen in de Uiterlijk-schermen |
| Uiterlijk-schermen (kits) | `Card`, `Badge`, `Dialog`, `AlertDialog`, `ToggleGroup`, `Field`, `Input` |
| Terminal (xterm) | blijft onder Geavanceerd; kleuren uit `--term-*` en wisselt mee met het thema |

Nog een gewone HTML-`<input>`: de verborgen bestandskiezer in de chat (shadcn heeft er geen onderdeel voor; de zichtbare knop is een `Button`). Staat met een eslint-uitzondering en uitleg in `ChatPanel.tsx`.

### Thema
Eén bestand, `src/index.css`: `:root` (licht) en `.dark`, plus `--radius: 0.75rem`, `--spacing: 0.27rem` (ruimere marges) en de `--term-*`-kleuren van de terminal. Kleuren zijn oklch; naast de shadcn-tokens zijn `--success` en `--warning` toegevoegd. De keuze (volgens systeem / licht / donker) staat in Instellingen en wordt bewaard als `ui:theme`. `src/theme.test.ts` controleert in beide thema's WCAG AA (4,5:1 voor tekst, 3:1 voor randen van velden en de focusring) en dat alle 16 terminalkleuren leesbaar zijn.

### Aanpassingen aan gegenereerde bestanden (`src/components/ui/`)
Bewust, voor grote klikdoelen en leesbaarheid; bij `shadcn add` altijd "nee" antwoorden op het overschrijven van `button.tsx`:
- `button.tsx`, `input.tsx`, `toggle.tsx`, `tabs.tsx`: groottes verhoogd (standaard 44 px hoog), tekst `text-base`.
- `radio-group.tsx`, `checkbox.tsx`: 20 px in plaats van 16 px.
- `dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`: titels `text-xl font-semibold`.
- `dialog.tsx`: maximale hoogte van het venster en scrollen binnen de dialoog (knoppen blijven bereikbaar bij 900×600), lange woorden breken af; sluitknop-label is "Sluiten" (vast Nederlands in de gegenereerde code, daar geldt de i18n-regel niet).
- `dropdown-menu.tsx`: menu-items groter (`px-3 py-2.5 text-base`) voor grote klikdoelen.
- `sidebar.tsx` (`SidebarMenuAction`): 36 px klikdoel in plaats van 20 px.
- `tabs.tsx`: zichtbare focusring op het tabpaneel (dat is focusbaar).
- `textarea.tsx`: geen `field-sizing-content` (breedte volgt de indeling).
- `sonner.tsx`: gebruikt `useTheme` van Studio in plaats van `next-themes`.
- `eslint.config.js` slaat `src/components/ui/` over (gegenereerde code).

### Controle
- `npm run check` (lint, tests, build, clippy, cargo test) groen; `npm run tauri dev` start onder een virtuele display (Xvfb) en blijft draaien zonder fouten.
- Toegankelijkheid: `npm run ui:a11y` draait axe-core (WCAG 2.0/2.1 A en AA) op 8 schermen × licht/donker: **0 schendingen** (contrast, labels, rollen), plus een toetsenbordtest: alles bereikbaar met Tab en overal een zichtbare focus. Daarbij gevonden en opgelost: keuzerondjes zonder naam, een tablist met sluitknoppen erin, een kaart met te laag contrast (opacity), tabpanelen zonder zichtbare focus.
- Screenshots: `docs/ui/voor-*-donker.png` (vóór de omzetting; Studio was alleen donker) en `docs/ui/na-*-licht.png` / `na-*-donker.png`. Opnieuw maken: `npm run ui:shots -- <voorvoegsel> [licht,donker]`. De screenshots komen uit de Vite-pagina met nagebootste Tauri-aanroepen (de echte Tauri-app is zonder scherm niet te fotograferen).

### Bewust niet gedaan
- De shadcn MCP-server is niet ingesteld (geen toegang in deze sessie en een `.mcp.json` zou jouw configuratie wijzigen); alles ging via de CLI.
- `Progress` is wel toegevoegd en in de kit opgenomen, maar nog nergens in Studio nodig: laden gebeurt met `Skeleton` en een draaiend icoon.
- Het tabblad Publiceren blijft een placeholder.
- Oude Tailwind-klassen met vaste kleuren zijn vervangen door tokens; de lint-regel bewaakt dat verder.

---

# Indeling: homescherm en werkruimte (docking-bibliotheek)

## Onderzoek (2026-11-18)

Gemeten met `npm view`, het lezen van de gebouwde bestanden en een esbuild-bundel (minified + gzip, alleen de JavaScript van de bibliotheek, zonder CSS en React). Daarna zijn dockview en flexlayout allebei in een proefpagina met een iframe uitgeprobeerd: een tabblad naar een ander paneel slepen laat het iframe in beide **niet** opnieuw laden (belangrijk voor de preview en de terminal).

| | dockview-react 8.9.1 | flexlayout-react 0.11.2 | rc-dock 4.1.0 | react-resizable-panels 4.24 (shadcn Resizable) |
|---|---|---|---|---|
| Licentie | MIT | MIT | Apache-2.0 | MIT |
| Onderhoud | release 2026-11-17 | release 2026-11-16 | release 2026-10-25 | release 2026-11-15 |
| Afhankelijkheden | geen (alleen `dockview-core`) | geen | lodash, classnames, @rc-component/* | geen |
| React 19 | ja | ja (18 – 19) | ja | ja |
| Grootte (gzip) | ± 99 kB | **± 51 kB** | ± 70 kB (+ lodash) | al in Studio |
| Panelen slepen/docken, tabs, zwevend, maximaliseren | ja | ja | ja | **nee** |
| Randpanelen (smalle iconenbalk met uitklapbaar paneel) | beperkt (edge groups) | **ja** (`borders`) | nee | nee |
| Indeling als JSON opslaan/laden | ja | ja | ja | alleen groottes |
| Scheidingsgrepen met toetsenbord en schermlezer | **nee** (geen rol, niet focusbaar; bevestigd in proef) | **ja**: `role=separator`, pijltjestoetsen, `aria-valuenow/min/max`, zichtbare focus | nee | ja |
| Tabs en sneltoetsen | `role=tab/tabpanel`, pijltjes, toetsenbord-verplaatsmodus, schermlezer-meldingen | `role=tab/tabpanel`, pijltjes, instelbare sneltoetsen (`keyMap`), `aria-keyshortcuts`, vertaalbaar via `i18nMapper` | enkele `aria-*` | n.v.t. |

**Keuze: flexlayout-react (MIT).** Redenen: (1) de eis dat alle grepen met het toetsenbord en een schermlezer te bedienen zijn, is er al ingebouwd; bij dockview zouden we dat zelf moeten bouwen; (2) randpanelen passen precies bij de gewenste iconenbalk met uitklapbare panelen; (3) de kleinste van de drie, zonder afhankelijkheden; (4) de proef laat zien dat een iframe niet opnieuw laadt na verplaatsen.

*Correctie op een eerdere versie van dit blok:* daar stond dat flexlayout geen ARIA had en dockview wel. Dat was een meetfout (ik had het verkeerde pakket doorzocht). Na controle is het andersom: flexlayout heeft de beste toetsenbord- en schermlezerondersteuning voor de grepen; dockview heeft als enige een toetsenbord-verplaatsmodus voor tabs.

**Beperkingen die we zelf oplossen:**
- Panelen met het toetsenbord *verplaatsen* kent flexlayout niet; Studio biedt daarvoor een menu "Paneel verplaatsen" (links, rechts, boven, onder, naast een ander paneel) naast het slepen.
- Flexlayout levert eigen CSS; die wordt alleen via `--flexlayout-*`-variabelen op onze thematokens gezet (`src/index.css`). Geen losse kleuren.

**shadcn Resizable** (react-resizable-panels) blijft in gebruik voor de vaste tweedeling bij heel kleine vensters (`SplitView`) en voor schermen zonder docking. Voor de werkruimte zelf niet: het kan panelen niet verplaatsen.

## Resultaat: homescherm en werkruimte (2026-11-18)

### Homescherm
- Raster met projectkaarten (`src/components/app/home/`): miniatuur (laatste schermbeeld van de preview, anders een plaatshouder), naam, "Laatst bewerkt", statusbadge en een menu met **Openen**, **Naam wijzigen** en **Uit lijst verwijderen**. Die laatste vraagt altijd een bevestiging en zegt dat de bestanden op de computer blijven staan; Studio kan geen projectbestanden wissen.
- Eerste kaart "Nieuw project" (opent het bestaande venster met de keuze leeg project of startklare website; het uiterlijk kies je daarna in het paneel Uiterlijk), zoekveld, sorteren (laatst gebruikt, naam) en een lege staat met één grote knop.
- Miniaturen: de runtime maakt met `preview.thumbnail` een JPEG van de preview (zelfde onzichtbare browser als `get_preview_screenshot`); de app bewaart die in de app-map (`thumbnails/<id>.jpg`, maximaal 600 kB, alleen JPEG). Zonder browser blijft de plaatshouder staan.
- Statusbadges: "Draait", "Fout", "Niet actief", "Nieuw". **"Gepubliceerd" bestaat nog niet**: Studio publiceert nog niet zelf, dus de badge zou niet kloppen.
- "Alle projecten" laat het project openstaan (preview en terminals lopen door); sluiten kan via het menu "Meer" in de werkruimte.

### Werkruimte
Indeling: `[ iconenbalk | links: onderdelen | midden: voorbeeld | rechts: eigenschappen boven, gesprek onder ]`.
- Iconenbalk met Structuur, Onderdelen, Uiterlijk, Gegevens, Koppelingen en geheimen, Delen (publiceren), Eerdere versies, AI-accounts en Instellingen; **Geavanceerd (terminal)** onderaan. Elk icoon opent of sluit een paneel; open panelen hebben `aria-pressed`.
- Terminal, accountbeheer, instellingen en versies/tijdlijn zijn verhuisd naar panelen; er is niets verwijderd. De oude zijbalk en het Projectinfo-paneel zijn vervangen (de gegevens staan nu in het paneel Instellingen).
- **Onderdelen, Gegevens en Koppelingen** zijn nog plaatsen zonder functie: ze leggen eerlijk uit wat er komt en laten de AI er alvast bij helpen.
- Bovenbalk: terug naar alle projecten, naam, status van voorbeeld en AI-koppeling, het menu **Indeling** (Standaard, Veel voorbeeld, Veel gesprek, Voorbeeld groot maken, Herstel standaardindeling) en een menu **Meer** (Sneltoetsen, Project sluiten).

### Indeling per project (Layout-service)
- `src/lib/layout/`: `panels.ts` (alle panelen, minimale groottes), `defaults.ts` (de drie vaste indelingen), `service.ts` (valideren, migreren, lezen, uitgesteld opslaan, herstellen). Los van de UI en met 33 unit-tests.
- Opslag in SQLite (tabel `project_layouts`, migratie 0005): versienummer + JSON. De indeling wordt **streng gecontroleerd** bij het lezen: alleen bekende panelen, elk hoogstens één keer, preview en gesprek aanwezig, beperkte diepte en aantal, geldige getallen. Vaste eigenschappen (niet sluitbaar, blijft in het geheugen) worden altijd opnieuw gezet.
- **Een kapotte, onbekende of te nieuwe indeling blokkeert nooit**: dan geldt de standaardindeling en de kapotte regel wordt gewist. Oudere versies gaan stap voor stap door `MIGRATIES` (nog leeg: versie 1 is de eerste).
- Opslaan na 400 ms rust, zodat slepen niet bij elke pixel schrijft; een mislukte opslag wordt genegeerd.

### Formaat, verplaatsen en zweven
- Formaat: scheidingsgrepen met muis én toetsenbord (pijltjestoetsen; met Shift grotere stappen). De grepen hebben de rol `separator` met waarden en een naam; de minimale breedte en hoogte per paneel staan in `panels.ts`.
- Verplaatsen: slepen naar links, rechts, boven, onder of als tabblad naast een ander paneel; daarnaast het menu **Paneel verplaatsen** bij elk paneel (voor het toetsenbord). Zwevend: via datzelfde menu ("Los laten zweven"); de zwevende panelen worden mee opgeslagen. Maximaliseren per groep.
- Smal venster (werkruimte < 1000 px): een tijdelijke compacte indeling met twee groepen tabbladen (voorbeeld met de onderdelen; gesprek met eigenschappen). Wijzigingen in die weergave worden niet bewaard; de opgeslagen indeling blijft ongemoeid. Minimale venstergrootte: 900 × 600 (`src-tauri/tauri.conf.json`).
- Op schermen vanaf 2200 px breed is de basisgrootte van de tekst groter (21 px in plaats van 17 px).

### Eigenschappen
- Element-kiezer in de preview (klik op een onderdeel); het paneel toont soort in gewone woorden, tekst, afmetingen, thematokens (met de naam van het token), eigen waarden, of het een onderdeel uit het uiterlijk (kit) is, het kruimelpad, en knoppen om het onderdeel erboven of eronder te kiezen. Het veld "Wat moet hier anders?" stuurt de keuze met een schermafbeelding naar de chat.
- Zonder keuze: korte uitleg en gegevens van de pagina (titel, adres, taal, grootte, kleuren, lettertype), zodra de preview via de tussenserver is geladen.
- Het pickerscript (`mcp-server/src/picker-script.ts`) leest alleen; het verandert niets aan de pagina behalve de omlijning. Alle berichten worden in de app gecontroleerd en ingekort (`pick.ts`).
- **Stap 2 (directe aanpassing)** is niet gebouwd: zie `docs/eigenschappen-stap2.md`.

### Toetsenbord en toegankelijkheid
- Tabvolgorde: bovenbalk, iconenbalk, per paneel de tab, het verplaatsmenu, "groot maken" en de scheidingsgreep, daarna de inhoud. F6 wisselt tussen tabblad en inhoud; `Ctrl+]` en `Ctrl+[` gaan naar de volgende of vorige groep.
- Sneltoetsen: `Ctrl+Shift+G` (naar het gesprek), `E` (Eigenschappen), `L` (linkerpaneel), `M` (voorbeeld groot). Geen Alt, want dat is AltGr op veel toetsenborden. Overzicht in "Meer → Sneltoetsen".
- Alle teksten van de bibliotheek (knoppen, tips, menu's) zijn vertaald via `i18nTranslator`.
- Bekende beperking van flexlayout: `aria-valuenow` van een greep loopt één stap achter; de indeling zelf beweegt direct.

### Prestaties
- Preview, gesprek en terminal blijven in het geheugen (`enableRenderOnDemand: false`). Tijdens slepen, verplaatsen en zweven laadt het iframe van de preview **niet opnieuw** (getest: 0 navigaties).

### Controle
- `npm run ux:test` (Playwright, zeven formaten: 900×600, 1280×720, 1366×768, 1536×864 (1920 bij 125%), 1280×720 (1920 bij 150%), 1920×1080, 2560×1440): lege staat, project maken, werkruimte, invoerveld, opdracht versturen, element kiezen en wens sturen, slepen met bewaren en terugkeren, pijltjestoetsen, docken door slepen, verplaatsmenu, zweven, vaste indelingen, herstel, klikdoelen en een vergelijking met basisscreenshots (`docs/ux/basis/`).
- **Echte Tauri-app** (onder Xvfb, met muisbesturing via XTEST): homescherm met kaart, werkruimte openen, voorbeeld uit een echt project, echte terminal (PTY) in het paneel, accountpaneel, slepen van een greep, docken van een tabblad, herstarten en dezelfde indeling terugzien, "Herstel standaardindeling", element kiezen in de echte preview. Daarbij is een **bestaande fout gevonden en opgelost**: `chat_target` vergrendelde de database twee keer, waardoor het hele venster vastliep bij het openen van een project (zie de commit "Fix: chat_target…"). Screenshots: `docs/ui/indeling-echt-*.png`.
- Voor/na: `docs/ui/indeling-voor-*.png` (oude indeling) en `docs/ui/indeling-na-*.png` (nieuw), plus `indeling-stap2-home-*.png`.

### Bewust niet gedaan of nog niet getest
- Geen zwevende of losse vensters buiten de app (popout): dat is uitgezet; zwevend blijft binnen het venster.
- Schermschaal 125/150% is nagebootst via de venstergrootte; echte Windows-schaling is niet getest (ook niet in de echte app, die draaide op Linux).
- Het compacte pad (smal venster) bewaart niets; als u daar iets verschuift, is het na heropenen weg.
- Een tweede scherm of het verplaatsen van het venster tussen schermen met een andere schaal is niet getest.
