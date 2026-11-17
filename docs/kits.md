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

## Register
<!-- kit-register -->
| Kit | Bron | Licentie | Versie | Datum | Bevindingen |
|---|---|---|---|---|---|
| `fragments-ui` | https://github.com/fragments-sdk/ui (npm: @usefragments/ui) | MIT (LICENSE in pakket én in officiële repo gecontroleerd 2026-11-17) | 4.5.0 | 2026-11-17 | Alleen react/react-dom verplicht; geen installatiescripts; runtime-thema via `--fui-seed-brand`, `--fui-radius`, `--fui-scale`, `--fui-font-sans`; `fragments.json` levert de catalogus. |
