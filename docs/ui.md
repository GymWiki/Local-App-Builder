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
