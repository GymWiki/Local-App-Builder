# De app zelf testen

## 1. Starten (Windows, macOS of Linux)
1. Installeer Node.js 22.22+ of 24.15+ (lager werkt niet: `npm install` stopt dan met een duidelijke melding), Rust (stable) en Git. Windows: ook de Microsoft C++ Build Tools en WebView2. Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev`.
2. In de projectmap:
   ```
   npm install
   npm run tauri dev
   ```
   De eerste keer bouwen duurt enkele minuten (libgit2 wordt mee gebouwd; daar is `cmake` of een C-compiler voor nodig, op Windows de C++ Build Tools).
3. Geen keychain op je machine (bijvoorbeeld in een container)? Start met `STUDIO_VAULT=memory npm run tauri dev`. Dan bewaart Studio niets na afsluiten (alleen voor ontwikkelen).

### Zie je een oude interface?
1. `git branch --show-current` moet `ccr-b2c1b01d-7ba1q7` zijn en `git log -1` de laatste commit tonen. Een andere map of een oude kloon geeft een oude app.
2. `npm run tauri dev` stopt nu met een duidelijke fout als poort 1420 al bezet is (`scripts/dev-check.mjs`). Sluit dan het oude venster of proces. Zonder deze controle kon Studio stilletjes een oude Vite-server van een eerdere sessie tonen.
3. Kijk onderaan **Instellingen** bij "Welke versie draait er?": versie, commit en bouwtijd. Klopt de commit niet met `git rev-parse --short HEAD`, dan draait er een andere versie.
4. Wis caches: `rm -rf node_modules/.vite dist` (Windows: `rmdir /s /q node_modules\.vite dist`) en start opnieuw.
5. Schone start: sluit Studio en hernoem de map `nl.studio.desktop` in je app-datamap (Windows: `%APPDATA%`, macOS: `~/Library/Application Support`, Linux: `~/.local/share`). Je projecten op schijf blijven staan; alleen de lijst en instellingen beginnen opnieuw.
6. Controleer zonder de echte app: `npm run ux:start` maakt screenshots in `docs/ui/start-*.png`.

## 2. Zonder accounts (alles lokaal)
Maak een project (Nieuw project) en laat de AI iets bouwen. Open **Eerdere versies**: de sectie *Back-up op GitHub* vraagt dan om te verbinden; dat is optioneel.

## 3. GitHub-back-up (eigen GitHub-account)
Stappen en wat je moet zien: `docs/github.md` §7. Kort: verbinden → eerste back-up (privé) → bijwerken → een commit op github.com maken en nogmaals bijwerken ("uiteengelopen", niets verandert) → een nepsleutel in een bestand zetten (de back-up blokkeert). Ook: *Ophalen van GitHub* op het homescherm.

## 4. Vercel (eigen Vercel-account, gratis plan volstaat)
Stappen: `docs/vercel.md` §8. Kort: verbinden met een token (maak er een op vercel.com/account/tokens) → onder **Online zetten** een voorbeeld online zetten → echt online zetten (eerst de bevestiging) → een fout maken en de samenvatting bekijken → een variabele toevoegen → terugzetten.
Let extra op de punten onder "niet te controleren" in `docs/vercel.md` §2 (project aanmaken, upload, status, annuleren, domeinen): meld wat er afwijkt.

## 5. Automatische controles
```
npm run check          # lint, tests, bouwen, clippy, cargo test
npm run ux:github && npm run ux:vercel && npm run ux:menu && npm run ux:koppel && npm run ux:supabase
```
De `ux:`-tests gebruiken een nagebootste Tauri-laag; test indelingswijzigingen ook in de echte app.

## 6. Nog niet gebouwd
In de appwinkel (Google Play en App Store) en het Winkelpakket zijn nog niet begonnen.
