# Studio — fase 1

Lokale desktop-app om apps te maken met je eigen AI-CLI's. Fase 1: fundering (projectenlijst, nieuw project, SQLite).

## Vereisten
- Node.js 20+, Rust (stable), `git` in je PATH
- Tauri-systeemvereisten: https://v2.tauri.app/start/prerequisites/
  - Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev`
  - Windows: Microsoft C++ Build Tools + WebView2
  - macOS: Xcode Command Line Tools

## Starten
```
npm install
npm run tauri dev
```

## Controles
```
npm run lint && npm test && npm run build
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```

De database (`studio.db`) staat in de app-datamap van het besturingssysteem (`nl.studio.app`).

## Bewust niet gedaan in fase 1
- Terminal, Preview en Publiceren zijn lege placeholders
- Geen keychain-integratie (`keyring` wordt pas toegevoegd zodra er iets te bewaren valt, fase 2); `ai_accounts` is een leeg schema zonder secretkolommen
- Geen templates: `template` staat op `leeg`; `templates/`, `skills/`, `design-packs/`, `mcp-server/` zijn leeg
- Geen externe koppelingen (GitHub, Vercel, Supabase, stores)
- Alleen Nederlandse vertaling (structuur voor meer talen staat klaar)
- Geen project herimporteren/heropenen van een bestaande map, geen hernoemen
- Niet getest op Windows/macOS (alleen Linux gebouwd); installers/signing niet geconfigureerd
- Geen end-to-end UI-tests; frontend heeft alleen een kleine component-test
