# UI-kits in Studio

Dit document hoort bij `design-packs/`. Het bevat het onderzoek, het kit-formaat en het **register**: elke kit in `design-packs/` móét hier een regel hebben (`npm run kit:validate` controleert dat).

## Onderzoek (2026-11-17)

### Claude Code: skills en slash-commando's (bron: code.claude.com/docs/en/skills)
- Een projectskill staat in `.claude/skills/<naam>/SKILL.md` en wordt meegecommit. YAML-frontmatter tussen `---` (de eerste regel van het bestand), daarna Markdown. SKILL.md liefst onder 500 regels; lange tekst in losse bestanden.
- Handige frontmatter: `name`, `description` (+ `when_to_use`; samen max. ±1536 tekens in de lijst), `argument-hint`, `disable-model-invocation`, `user-invocable`, `allowed-tools`.
- Argumenten: `$ARGUMENTS` (alles), `$0`/`$1` (positioneel), `${CLAUDE_SKILL_DIR}`. Komt er geen placeholder in de tekst voor, dan hangt Claude Code `ARGUMENTS: <waarde>` achteraan.
- `.claude/commands/*.md` werkt nog, maar is samengevoegd met skills. Heten een skill en een commando hetzelfde, dan wint de skill. **Besluit:** `/add-kit <pakketnaam of URL>` bouwen we als skill `.claude/skills/add-kit/SKILL.md` (geen apart commandobestand).
- Let op: de pagina over built-in commando's beschrijft eigen commando's niet; de regels komen van de skills-pagina. Controleer in je eigen build met `/help`.

### @usefragments/ui (bronnen: npmjs-registry, tarball van versie 4.5.0, README in het pakket, officiële repository fragments-sdk/ui)
- **Licentie: MIT** (veld `license` in package.json én het bestand LICENSE in het pakket én het LICENSE-bestand in de officiële repository: "Copyright (c) 2024-present Conan McNicholl"). Toegestaan. Afhankelijkheden: `@base-ui/react` 1.8.0 (MIT), `@phosphor-icons/react` (MIT). Geen verplichte attributie; MIT vraagt wel dat de licentietekst meegaat met kopieën van de code. Bij gebruik als npm-pakket gebeurt dat via het pakket zelf.
- **Versies:** 4.5.0 is "latest" (2026-10-13); 32 releases sinds 2026-07-10, dus actief onderhouden maar jong en met één beheerder (bus-factor). Daarom pinnen we de **exacte** versie 4.5.0.
- **Installatiescripts:** geen `preinstall`/`install`/`postinstall` in de pakketgegevens. (Het mcp-server-pakket draait wel `postinstall`; dat is ons eigen.)
- **Peer-dependencies:** verplicht alleen `react` en `react-dom` (`^18 || ^19`). De rest (recharts, tiptap, date-fns, shiki, react-day-picker, @tanstack/…) is optioneel en alleen nodig voor Chart, Editor, DatePicker enz. Studio installeert die **niet** automatisch.
- **Styling:** voorgebouwde CSS: `import "@usefragments/ui/styles"` (bevat tokens + donkere modus). Géén Tailwind nodig; SCSS (`sass`) alleen voor eigen seed-instellingen via `@use "@usefragments/ui/scss" with (...)`. Studio gebruikt de runtime-aanpak: CSS-variabelen/attributen, zodat geen Sass-build nodig is.
- **Thema-instellingen (runtime):** `<Theme brand radius scale font …>` of dezelfde CSS-variabelen op `:root`/`[data-fui-theme]`: `--fui-seed-brand`, `--fui-seed-neutral`, `--fui-radius`, `--fui-scale` (vermenigvuldigt spacing), `--fui-font-sans`; attribuut `data-fui-radius-style` = `sharp|subtle|rounded|pill` (afwezig = default); `data-theme` = `light|dark`. Dit past 1-op-1 op onze instellingen voor hoofdkleur, afronding, spacing en lettertype.
- **Componenten (±70):** Accordion, Alert, AlertDialog, AppShell, Avatar, Badge, Box, Breadcrumbs, Button, ButtonGroup, Card, Chart*, Checkbox, Chip, CodeBlock*, Collapsible, ColorPicker*, Combobox, Command, DataTable*, DatePicker*, Dialog, Drawer, Editor*, EmptyState, Field, Fieldset, FilterBar, Form, Grid, Header, Icon, IconButton, Image, Input, Kbd, Link, List, Listbox, Loading, Main, Markdown*, Menu, NumberField, Pagination, Popover, Progress, RadioGroup, ScrollArea, Select, Separator, Sidebar, Skeleton, Slider, Stack, Switch, Table*, Tabs, Text, Textarea, Theme, ThinkingIndicator, Toast, ToggleGroup, Tooltip, VisuallyHidden (* = eigen subpad of optionele peer). Samengestelde componenten: `Card.Header`, `Field.Label` enz.
- **Machineleesbare documentatie in het pakket:** `fragments.json` (±700 kB) met per component beschrijving, props (type, default, waarden), gebruiksrichtlijnen en codevoorbeelden; `tokens.css` met alle publieke tokens; `dist/index.d.ts`. Daaruit genereert Studio de catalogus `docs/ui-kit.md`.
- **Aandachtspunten:** pakket is groot (±4,8 MB uitgepakt); Next.js kan `transpilePackages: ["@usefragments/ui"]` nodig hebben; Base UI-primitieven.
- **Beslissing:** licentie klopt → toegevoegd als eerste npm-kit (zie register).

## Kit-formaat
Elke kit staat in `design-packs/<id>/`:

| Bestand | Inhoud |
|---|---|
| `kit.json` | gegevens (zie `design-packs/kit.schema.json`) |
| `tokens.json` | kleuren (licht/donker), rondingen, spacing, schaduw, typografie — één bron van waarheid |
| `rules.md` | korte AI-regels voor deze kit |
| `preview.png`, `voorbeeld.tsx` | plaatje en kleine voorbeeldpagina |
| `components/` | alleen bij type `bestanden` |

Toegestane licenties: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC. Versies zijn exact (geen `^`/`~`/`latest`).

## De AI laten aansluiten op de kit (deel 3)
- **Catalogus `docs/ui-kit.md`** (in het project): wordt gemaakt bij het toepassen van een kit, uit `fragments.json` van het pakket (bij andere kits uit `index.d.ts` of de componentbestanden). Inhoud: importpad, tokens van het project, regels van de kit, componenten met delen (`Card.Header`), belangrijkste props en een voorbeeld. Budget: `kitcontext.maxTokens` (6000, geschat op 3,5 tekens per token). Past het niet, dan krijgen gewone componenten minder detail; de `kitcontext.kern`-componenten houden hun details. Gemeten voor Fragments UI: ±5600 tokens voor 71 componenten. Wordt vernieuwd als de geïnstalleerde versie afwijkt van de kop `<!-- studio:catalogus kit=… versie=… -->` (gecontroleerd bij het openen van het tabblad Uiterlijk).
- **Bouwregels:** afgebakend blok `use-kit` in CLAUDE.md, GEMINI.md en AGENTS.md (zelfde markeringen als `instructions.rs`) en de skill `.claude/skills/use-kit/SKILL.md`. Bij wisselen van kit wordt het blok vervangen; een eigen skill met dezelfde naam (zonder onze markering) blijft ongemoeid.
- **Kit-check:** `design/kit-scan.mjs` (één bestand, geen afhankelijkheden) draait zowel in Studio (stap `kit` van `run_checks`) als in het project via ESLint (`design/eslint-kit.mjs`, regel `kit/gebruik-kit`). Regels: losse kleuren (#hex, rgb/hsl/oklch), losse pixelwaarden (behalve 0px/1px en in mediaqueries), losse lettertypes, gewone `<button> <input> <select> <textarea> <dialog>` waar de kit een component heeft (`kitCheck.vervangNative`), imports uit andere UI-bibliotheken (`kitCheck.verbodenImports`). De map `src/kit/`, `design/`, tests en `.d.ts` worden niet gecontroleerd. Strengheid in `design/kit-check.json`: `waarschuwen` (stap-status `warned`, run blijft geslaagd) of `blokkeren` (stap `failed`).

## Register
<!-- kit-register -->
| Kit | Bron | Licentie | Versie | Datum | Bevindingen |
|---|---|---|---|---|---|
| `fragments-ui` | https://github.com/fragments-sdk/ui (npm: @usefragments/ui) | MIT (LICENSE in pakket én in officiële repo gecontroleerd 2026-11-17) | 4.5.0 | 2026-11-17 | Alleen react/react-dom verplicht; geen installatiescripts; runtime-thema via `--fui-seed-brand`, `--fui-radius`, `--fui-scale`, `--fui-font-sans`; `fragments.json` levert de catalogus. |
| `shadcn` | https://github.com/shadcn-ui/ui (LICENSE.md, "Copyright (c) 2023 shadcn", gecontroleerd 2026-11-17) | MIT | CLI 4.23.0, componenten uit Studio zelf | 2026-11-17 | Copy-paste-kit (type bestanden): 16 componenten in `src/kit/components/` uit `src/components/ui` van Studio (`node scripts/build-shadcn-kit.mjs`). Extra pakketten: radix-ui 1.8.1 (MIT), lucide-react 1.74.0 (ISC), class-variance-authority 0.7.1 (Apache-2.0), cn 0.5.2 (MIT), tailwindcss 4.3.5 en @tailwindcss/vite 4.3.5 (MIT), tw-animate-css 1.4.0 (MIT). Zet Tailwind-plugin en alias `@` in vite.config.ts/tsconfig.json. **Studio draait zelf ook op shadcn/ui.** |
| `shadcn-neutraal` | zelfde bron als `shadcn` (https://github.com/shadcn-ui/ui) | MIT | zie `shadcn` | 2026-11-17 | Kleurenthema "Neutraal" (grijs/wit, radius 8 px) op de 16 shadcn-componenten; eigen tokens en regels. Pakketten en licenties als bij `shadcn`. |
| `shadcn-warm` | zelfde bron als `shadcn` | MIT | zie `shadcn` | 2026-11-17 | Kleurenthema "Warm en speels" (oranje op crème, radius 20 px, Trebuchet). |
| `shadcn-zakelijk` | zelfde bron als `shadcn` | MIT | zie `shadcn` | 2026-11-17 | Kleurenthema "Zakelijk" (donkerblauw, scherpe hoeken 4 px). |
| `material-flutter` | https://github.com/flutter/flutter (LICENSE: "Copyright 2014 The Flutter Authors", BSD-3-Clause, gecontroleerd 2026-11-17) | BSD-3-Clause | Flutter-SDK (Material 3 ingebouwd) | 2026-11-17 | Geen pakket: alleen `lib/theme/app_theme.dart` (ThemeData uit tokens) + regels en een handmatige catalogus (`catalogus.md`). **Niet gebouwd of gedraaid**: Flutter is niet geïnstalleerd in de ontwikkelomgeving; `kit:test` controleert alleen de gegenereerde bestanden. |

## Verificatie met de echte AI (2026-11-17)
Dezelfde opdracht in een leeg web-template (`templates/web-react-vite`, via `npm run kit:try`): *een landingspagina voor een kapsalon (kop, uitleg, openingstijden, prijslijst, knop ‘Afspraak maken’) en een afspraakformulier (naam, e-mail, datum, opmerking, bedankt-melding), nieuwe onderdelen in `src/components/app/`, daarna `npm run build` en `npm run lint`*. Uitgevoerd met `claude -p --output-format json` (rechten: lezen, schrijven, bewerken, build en lint). Alle drie de runs liepen tegelijk, één keer per variant.

| Variant | Kit-check | Build | Gewone `<button>/<input>/…` in nieuwe onderdelen | Kitcomponenten hergebruikt | Uitvoer-tokens | Cache-aanmaak (context) | Tijd | Kosten |
|---|---|---|---|---|---|---|---|---|
| `fragments-ui` (catalogus ±5600 tokens) | **groen** (4 bestanden) | gelukt | 0 | ja (`@usefragments/ui`: Button, Card, Field, Input…) | 5.549 | 32.253 | 42 s | $0,220 |
| `shadcn-warm` (catalogus ±1000 tokens) | **groen** (4 bestanden) | gelukt | 0 | ja (`@/kit/components`: Button, Card, Input, Label, Textarea, Alert…) | 4.559 | 25.894 | 33 s | $0,176 |
| Eigen stijl (geen kit) | niet van toepassing | gelukt | 8 (7 in het formulier, 1 op de pagina) + eigen `salon.css` | niet van toepassing | 5.909 | 21.349 | 39 s | $0,174 |

**Wat dit wel en niet zegt**
- De kit levert wat we wilden: de AI bouwde met kitcomponenten, de kit-check is groen en er staan geen losse HTML-controls in de nieuwe onderdelen. Zonder kit koos de AI zelf een stijl met eigen CSS en gewone formulierelementen.
- Het kost **niet** minder voor één kleine opdracht: de totale kosten liggen binnen een paar cent van elkaar (de grote catalogus van Fragments UI maakt de context groter en de run iets duurder; de compacte catalogus van shadcn was iets goedkoper). Het voordeel zit in consistentie en herbruikbaarheid bij vervolgopdrachten, niet in tokens voor een eerste pagina. Dat is hier **niet** gemeten.
- Eén run per variant en gelijktijdig uitgevoerd: tijd en kosten zijn indicatief, geen statistiek. De AI had hier de Studio MCP-tools (`run_checks`) niet; de kit-check is achteraf met `npm run kit:check` gedraaid.
