# Studio downloaden en bijwerken

## Hoe het werkt
1. **Bouwen:** een GitHub Action (`.github/workflows/release.yml`) bouwt Studio voor Windows (installer), macOS (Apple Silicon en Intel) en Linux en zet ze op **GitHub Releases** van deze repository. Ze maakt ook `latest.json` aan: het bestand waarin de app kan zien wat de nieuwste versie is.
2. **Downloaden:** open https://github.com/GymWiki/Local-App-Builder/releases/latest en kies het bestand voor jouw systeem (Windows: de `.exe` of `.msi`; macOS: de `.dmg`; Linux: `.AppImage` of `.deb`).
3. **Bijwerken in de app:** bij het openen kijkt Studio (in Rust, `src-tauri/src/updates.rs`) naar `https://github.com/GymWiki/Local-App-Builder/releases/latest/download/latest.json`. Is er een nieuwere versie, dan verschijnt de vraag "Er is een nieuwe versie van Studio" met wat er nieuw is. Bij "Nu bijwerken" downloadt Studio de update, sluit je projecten netjes af, installeert en start opnieuw op. "Later" doet niets.
4. **Veilig:** elke update is ondertekend. Studio installeert alleen een update waarvan de handtekening klopt met de publieke sleutel in `src-tauri/tauri.conf.json`. Zonder de privésleutel (die alleen in GitHub staat) kan niemand een update uitgeven.
5. **Uitzetten:** Instellingen → Mijn programma → "Controleer bij het openen op een nieuwe versie". Daar staat ook "Nu zoeken naar een nieuwe versie". Er gaat geen gegeven van de gebruiker mee; het is één GET naar het adres hierboven.

In de ontwikkelversie (`npm run tauri dev`) wordt niet bijgewerkt; Instellingen zegt dat dan.

## Eenmalig instellen (door de eigenaar van de repository)
```
npm run setup:updates
```
Draai dit in een gewone terminal (Windows PowerShell werkt). Het script vraagt:
1. **Wachtwoord?** Aanbevolen: ja. Je kiest zelf een wachtwoord (minstens 8 tekens, verborgen invoer, twee keer). Daarna vraagt het sleutelprogramma van Tauri **zelf** om een wachtwoord (ook twee keer): typ daar hetzelfde. Het script controleert daarna of het klopt en laat je anders opnieuw beginnen. Kies je "nee", dan wordt de sleutel zonder wachtwoord gemaakt.
2. Het maakt een sleutelpaar in de map `.tauri` in je persoonlijke map (`%USERPROFILE%\.tauri\studio.key` op Windows) en zet de **publieke** sleutel in `src-tauri/tauri.conf.json`.
3. Is de GitHub CLI `gh` ingelogd? Dan zet het de privésleutel als geheim `TAURI_SIGNING_PRIVATE_KEY` én (bij een wachtwoord) het wachtwoord als `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in GitHub. Anders toont het precies wat je zelf moet invullen (GitHub → Settings → Secrets and variables → Actions → New repository secret). De release-workflow geeft beide geheimen mee.

Het wachtwoord staat nooit op een commandoregel: het gaat alleen via een omgevingsvariabele of via stdin naar een ander programma, en komt niet in een bestand of log.

**Bewaar altijd twee dingen veilig** (wachtwoordmanager + back-up): het bestand `studio.key` **en** het wachtwoord. Verlies je er één, dan kun je geen updates meer uitgeven en moeten mensen met een geïnstalleerde versie opnieuw downloaden.

**Opnieuw draaien kan veilig:** bestaat er al een sleutel, dan vraagt het script of die moet worden hergebruikt (standaard ja). Een nieuwe sleutel kan alleen als je letterlijk `JA, NIEUWE SLEUTEL` typt; de oude sleutel wordt dan hernoemd (`studio.key.oud-<tijdstip>`) en nooit overschreven of verwijderd.

Commit en push daarna `src-tauri/tauri.conf.json`. Zolang daarin `NOG-NIET-INGESTELD` staat, zegt Studio "Bijwerken is nog niet ingesteld" en weigert de release-workflow met een duidelijke fout.

## Een nieuwe versie uitgeven
```
npm run release -- 0.2.0
git push --follow-tags
```
Het script zet het versienummer in `package.json`, `tauri.conf.json` en `Cargo.toml`, maakt een commit en de tag `v0.2.0`. Na de push bouwt GitHub Actions de installers (ongeveer 15–30 minuten) en publiceert de release. Gebruikers met een oudere versie krijgen de update-vraag bij het volgende openen. De workflow controleert dat de tag bij het versienummer past.

Handmatig starten kan ook: GitHub → Actions → Release → Run workflow (gebruikt het versienummer uit `tauri.conf.json`).

## Wat je moet weten
- **De repository moet openbaar blijven** (dat is hij nu): de app leest `latest.json` zonder inloggegevens. Bij een privé-repository werkt het controleren niet.
- **Windows** toont bij een niet-ondertekende installer een SmartScreen-waarschuwing ("onbekende uitgever"): kies "Meer informatie → Toch uitvoeren". Dat is een code-ondertekeningscertificaat (kost geld) en staat los van het ondertekenen van updates.
- **macOS** blokkeert niet-genotariseerde apps ("kan niet worden geopend"): rechtsklik → Open. Notariseren vraagt een Apple-ontwikkelaarsaccount.
- Studio heeft **Node.js 20+** en **Git** op de computer nodig tijdens het gebruik (MCP-server en versies); dat zit niet in de installer.
- Gebouwd wordt met `src-tauri/tauri.release.conf.json` (zet `createUpdaterArtifacts` aan). Een gewone `npm run tauri build` lokaal maakt dus geen updatebestanden en vraagt geen sleutel.
- **Netwerk:** naast de koppelingen (zie `docs/koppelingen.md`) maakt Studio nu één extra, optionele verbinding: de update-controle naar `github.com` (de plug-in volgt daarna de download-adressen van GitHub zelf). Uit te zetten in Instellingen.

## Tests
`cargo test updates` (configuratie wijst alleen naar de releases van Studio; plaatshouder telt als niet ingesteld), `src/components/app/update/update.test.tsx`, `npm run ux:start` (de updatevraag, screenshot `docs/ui/start-update.png`). De echte keten (bouwen, ondertekenen, updaten) kan alleen met een echte release: zie "Handmatig testen" hieronder.

## Handmatig testen
1. `npm run setup:updates`, commit en push `src-tauri/tauri.conf.json`.
2. `npm run release -- 0.1.1` en `git push --follow-tags`. Wacht tot de Actions klaar zijn en de release er staat.
3. Installeer **die** versie (0.1.1) vanaf de Releases-pagina.
4. Geef daarna `npm run release -- 0.1.2` uit en push.
5. Open de geïnstalleerde Studio (0.1.1): de vraag "Er is een nieuwe versie" moet verschijnen. Kies "Nu bijwerken": Studio herstart als 0.1.2 (zie Instellingen → onderaan de versie).
