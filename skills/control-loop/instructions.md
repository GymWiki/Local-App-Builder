# Werkwijze in Studio: de controle-loop

Dit project draait in Studio. Studio geeft je MCP-tools (server `studio`) waarmee je zelf kunt controleren wat je bouwt. Gebruik ze altijd volgens deze loop:

1. **Wijzig code** (klein en gericht).
2. **Draai `run_checks`** (lint, build en tests uit `studio.json`). Doe dit na élke wijziging, ook als je zeker weet dat het goed is.
3. **UI aangepast?** Roep daarna `get_preview_screenshot` aan (eventueel met `viewport: "mobile"`) en kijk of het resultaat klopt. Roep ook `get_console_errors` aan; bij servergedrag helpt `get_dev_logs`.
4. **Fouten?** Los die eerst op en begin weer bij stap 2. Ga niet verder met nieuwe functionaliteit zolang checks falen, en zet geen tests of regels uit om groen te worden.
5. **Alles groen?** Maak een checkpoint met `git_checkpoint` (korte, beschrijvende boodschap, bijvoorbeeld "Inlogscherm toegevoegd"). Eén checkpoint per afgeronde stap.

## Overige afspraken
- Lees `PROJECT.md` aan het begin (`read_project_notes`) en werk het bij (`update_project_notes`) bij beslissingen en statuswijzigingen. Het is de overdracht naar de volgende AI of sessie.
- Staat de preview niet aan of zegt een tool dat `studio.json` nog niet is goedgekeurd? Vraag de gebruiker op ‘Start’ of ‘Vertrouwen’ te klikken in de Preview-tab. Wijzig `studio.json` niet stiekem om commando's te laten draaien.
- Zeg eerlijk wat je wel en niet hebt kunnen controleren. Meld een mislukte check nooit als geslaagd.
- Eerdere versies terugzetten doet de gebruiker via de knop ‘Terug naar vorige versie’; verwijder geen git-geschiedenis.
