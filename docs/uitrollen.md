# Uitrollen: wat jij zelf moet regelen

Dit is de lijst van dingen die **niet** in de code op te lossen zijn en die je zelf met een account of betaling moet regelen voordat je Studio aan andere mensen geeft. Ik heb geen certificaten, sleutels of accounts verzonnen of aangemaakt. Waar iets al gebouwd is, staat het erbij.

## 1. Wat er al is (en wat niet)

| Onderdeel | Stand |
|---|---|
| Installer bouwen via GitHub Actions (Windows, macOS, Linux) | Bestaat (`.github/workflows/release.yml`), **nog nooit echt gedraaid** |
| Update binnen Studio: controleren, "Nu bijwerken", "Wat is nieuw" (de releasenotities staan in de updatevraag) | Bestaat (`src-tauri/src/updates.rs`, `docs/updates.md`) |
| Updates ondertekenen (Tauri-sleutel) | Script bestaat (`npm run setup:updates`); **sleutel moet jij maken** |
| Installer ondertekenen: Windows | **Niet ingesteld** (zie §2) |
| Installer ondertekenen en notariseren: macOS | **Niet ingesteld** (zie §3) |
| Node.js meeleveren in de installer | **Niet gedaan** (zie §5) |
| Git meeleveren | **Niet gedaan**: lokale versies gebruiken de Git van de computer |
| Licentie-haakje | Bestaat, staat uit; Studio is overal gratis (zie §6) |
| Statistieken of metingen | **Bestaan niet.** Studio verstuurt niets. Dat staat zo in Instellingen → Privacy |

## 2. Windows: code-signing certificaat
**Waarom:** zonder certificaat toont Windows SmartScreen "onbekende uitgever" bij elke download. Mensen die niet technisch zijn, stoppen dan.
**Wat je regelt:** een code-signing certificaat van een erkende certificaatautoriteit (OV of EV; EV bouwt sneller reputatie op bij SmartScreen). Kosten: ongeveer enkele honderden euro per jaar; vraag actuele prijzen en eisen na bij de aanbieder, ik heb ze niet gecontroleerd.
**Stappen (globaal):**
1. Kies een aanbieder en rond de bedrijfs- of persoonscontrole af (kan dagen duren).
2. Je krijgt een certificaat (vaak op een hardware-token). Controleer in de documentatie van Tauri (v2, "Windows Code Signing") hoe je dat in een CI-bouw gebruikt; bij een hardware-token is dat vaak een eigen runner of een ondertekeningsdienst in de cloud.
3. Zet de benodigde waarden als **GitHub-geheimen** (Settings → Secrets and variables → Actions). Zet ze nooit in de repository.
4. Pas de release-workflow aan zodat de bouw het certificaat gebruikt (nog niet gedaan: dit hangt af van welk soort certificaat je krijgt).

## 3. macOS: Developer ID en notarisering
**Waarom:** zonder dit zegt macOS "kan niet worden geopend omdat de ontwikkelaar niet is geverifieerd".
**Wat je regelt:** een Apple Developer-account (jaarlijks lidmaatschap; controleer de actuele prijs bij Apple) en daarin een "Developer ID Application"-certificaat plus een app-specifiek wachtwoord of API-sleutel voor notarisering.
**Stappen (globaal):** certificaat aanmaken in je Apple-account → exporteren → als GitHub-geheim opslaan → in de workflow de omgevingsvariabelen van Tauri voor macOS-ondertekening en notarisering zetten (zie de Tauri-documentatie, "macOS Code Signing"). Nog niet gedaan.

## 4. De updatesleutel en waar updates staan
1. Draai één keer `npm run setup:updates` (zie `docs/updates.md`). Bewaar `studio.key` **en** het wachtwoord op twee plekken (wachtwoordmanager + back-up). Verlies je ze, dan kun je geen updates meer uitgeven.
2. Updates staan op **GitHub Releases** (`latest.json` plus de installers). De repository moet daarvoor **openbaar** zijn. Wil je dat niet, dan moet je een eigen plek voor `latest.json` regelen en het adres in `tauri.conf.json` aanpassen; dat is niet gebouwd.
3. Test **voor** je het aan anderen geeft één echte update: geef versie 0.1.1 uit, installeer die, geef 0.1.2 uit en kijk of de updatevraag verschijnt en werkt (testlijst in `docs/updates.md`).

## 5. Node.js zit nog niet in de installer
Studio heeft Node.js (20 of nieuwer, voor ontwikkelen 22.22+) nodig voor de MCP-server en de preview van apps met Node. Bij een computer zonder Node toont de systeemcheck bij de eerste start een downloadknop en uitleg. Dat is voor een beginner nog een hobbel.
**Wat er nodig is om dit op te lossen (nog niet gedaan):** een Node-binary per platform meeleveren als Tauri-"sidecar" (`bundle.externalBin`), in de release-workflow ophalen van nodejs.org met controle van de checksum, en `src-tauri/src/node.rs` laten zoeken naast het programma. Dat kan ik niet zonder echte Windows-, macOS- en Linux-bouwen testen. Plan daar een testronde voor.

## 6. Licentie en betalingen
- Studio is nu **overal gratis**. Er is een haakje (`src-tauri/src/licentie.rs`): een licentiebestand wordt **offline** gecontroleerd met een publieke sleutel (minisign/Ed25519). De publieke sleutel in `config/licentie.json` is leeg, dus er is geen licentiesysteem en niets wordt beperkt.
- Wil je later licenties: maak zelf een minisign-sleutelpaar (`minisign -G`), zet de **publieke** sleutel in `config/licentie.json`, bewaar de **privésleutel** zoals de updatesleutel, en onderteken licentiebestanden (inhoud, een regel `---`, daarna het handtekeningblok). Betalen, facturen, btw en een verkooppagina moet je zelf regelen; daar is niets van gebouwd.

## 7. Juridisch en voorwaarden (zelf regelen)
- **Privacyverklaring en gebruiksvoorwaarden** voor mensen buiten jezelf. In Studio staat een korte privacytekst (Instellingen → Mijn programma); dat is geen juridisch advies.
- **Voorwaarden van de AI-aanbieders.** Studio laat mensen hun **eigen** AI-account gebruiken (Claude, Gemini). Controleer de actuele voorwaarden van Anthropic en Google over het gebruik van hun CLI's en abonnementen door een andere app (en of doorverkopen of "AI-gebruik als dienst" mag). Ik heb die voorwaarden niet gelezen of beoordeeld.
- **Licenties van onderdelen.** Controleer de licenties van de gebruikte pakketten (`npm run kit:validate` bewaakt dit voor kits; de rest niet). Graphify is bewust niet ingebouwd omdat de licentie tegenstrijdig gemeld wordt.
- **De winkels.** Google Play en de App Store hebben eigen voorwaarden en een jaarlijkse of eenmalige vergoeding voor een ontwikkelaarsaccount; zie `docs/winkels.md`.

## 8. Vóór je iemand uitnodigt: korte checklist
1. [ ] `npm run setup:updates` gedaan, sleutel + wachtwoord veilig bewaard.
2. [ ] Eén echte release en één echte update getest op een schone Windows-computer.
3. [ ] Besloten wat je doet met de SmartScreen-waarschuwing (certificaat of uitleg).
4. [ ] Besloten wat je doet met Node.js (§5).
5. [ ] Voorwaarden en privacy bekeken (§7).
6. [ ] Eén beginner laten testen volgens `docs/ux-rapport.md` ("wat jij zelf moet testen").
