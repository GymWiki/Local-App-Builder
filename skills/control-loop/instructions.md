# Werkwijze in Studio: de controle-loop

Dit project draait in Studio. Studio geeft je MCP-tools (server `studio`) waarmee je zelf kunt controleren wat je bouwt.

**De preview werkt vanzelf, zonder configuratie.** Zodra je bestanden aanmaakt, detecteert Studio wat het is en toont het live in de Preview-tab:
- Alleen een `index.html` (zonder `package.json`): Studio serveert de map statisch en ververst de pagina bij elke bestandswijziging.
- Een `package.json` met een `dev`- of `start`-script: Studio draait dat script, leest de poort uit de uitvoer en toont die URL. Zijn de afhankelijkheden er nog niet, draai dan zelf `npm install`; de preview start daarna vanzelf.
- `studio.json` is alleen nodig voor afwijkende situaties (eigen commando's of URL) en is dan leidend.

Je hoeft de preview dus niet zelf te starten of te configureren. Gebruik de tools volgens deze loop:

1. **Wijzig code** (klein en gericht).
2. **Draai `run_checks`** (lint, build en tests uit `package.json` of `studio.json`; bij een statisch project: html, links en console). Doe dit na élke wijziging, ook als je zeker weet dat het goed is.
3. **Roep na elke wijziging `get_preview_screenshot` aan** zodra de MCP-tools beschikbaar zijn (eventueel met `viewport: "mobile"`) en kijk of het resultaat klopt. Roep ook `get_console_errors` aan; bij servergedrag helpt `get_dev_logs`. Bij een statisch project controleert `run_checks` bovendien of de HTML aanwezig is, of lokale links kloppen en of de console schoon is.
4. **Fouten?** Los die eerst op en begin weer bij stap 2. Ga niet verder met nieuwe functionaliteit zolang checks falen, en zet geen tests of regels uit om groen te worden.
5. **Alles groen?** Maak een checkpoint met `git_checkpoint`. De titel is **maximaal 8 woorden in gewone taal, zonder jargon** (bijvoorbeeld "Inlogscherm toegevoegd"); de gebruiker ziet die in zijn tijdlijn met versies. Eén checkpoint per afgeronde stap. Doe je het niet, dan bewaart Studio na je beurt zelf een versie.

## Overige afspraken
- Lees `PROJECT.md` aan het begin (`read_project_notes`) en werk het bij (`update_project_notes`) bij beslissingen en statuswijzigingen. Het is de overdracht naar de volgende AI of sessie.
- Zegt een tool dat de preview niet draait of dat scripts nog niet zijn goedgekeurd? Dan wacht Studio op de gebruiker: vraag die op ‘Start’ of ‘Vertrouwen’ te klikken in de Preview-tab. Wijzig `studio.json` of de scripts in `package.json` niet stiekem om commando's te laten draaien; gewijzigde scripts moeten opnieuw worden goedgekeurd.
- Zeg eerlijk wat je wel en niet hebt kunnen controleren. Meld een mislukte check nooit als geslaagd.
- Eerdere versies terugzetten doet de gebruiker via de knop ‘Terug naar vorige versie’; verwijder geen git-geschiedenis.

**Opslag nodig?** Moet de app gegevens onthouden (bestellingen, inschrijvingen, gebruikers), roep dan `needs_data` aan met één korte zin in gewone taal en bespreek met de gebruiker hoe de opslag moet komen. Doe zelf nog niets aan opslag zonder dat de gebruiker het goedvindt.
