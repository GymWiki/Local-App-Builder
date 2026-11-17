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
