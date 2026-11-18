# De app zelf testen

## 1. Starten (Windows, macOS of Linux)
1. Installeer Node.js 20+, Rust (stable) en Git. Windows: ook de Microsoft C++ Build Tools en WebView2. Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev`.
2. In de projectmap:
   ```
   npm install
   npm run tauri dev
   ```
   De eerste keer bouwen duurt enkele minuten (libgit2 wordt mee gebouwd; daar is `cmake` of een C-compiler voor nodig, op Windows de C++ Build Tools).
3. Geen keychain op je machine (bijvoorbeeld in een container)? Start met `STUDIO_VAULT=memory npm run tauri dev`. Dan bewaart Studio niets na afsluiten (alleen voor ontwikkelen).

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
