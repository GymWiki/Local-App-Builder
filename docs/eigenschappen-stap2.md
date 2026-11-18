# Eigenschappen stap 2 – directe aanpassing zonder AI (onderzoek en voorstel)

Status: **alleen onderzoek. Er is niets gebouwd.** Stap 1 (kiezen, bekijken en een wens naar de chat sturen) is klaar. Voor stap 2 wacht ik op uw keuze (onderaan).

## Wat stap 2 moet kunnen

Eenvoudige dingen aanpassen zonder de AI: tekst, kleur (alleen uit de thematokens), afronding, ruimte en zichtbaarheid. Daarvoor moet Studio van een element in de preview terugvinden **welke regel in welk bestand** het is.

## Wat ik heb uitgezocht

1. **React 19 (het startproject `web-react-vite` gebruikt 19.2):** de oude route (`element._debugSource`, de bestandsnaam en regel die React zelf bijhield) is er niet meer. Ik heb dat geprobeerd in een proefopstelling met React 19.2.0: `_debugSource` is leeg. Wél bewaart React 19 in de ontwikkelversie een `_debugStack` (een foutmelding met de plek waar het element is gemaakt). De bovenste regel daarvan wijst naar de plek waar `<button>` in de code staat, **als gegenereerde code**. Om daar de echte regel in het bronbestand van te maken, moet Studio de sourcemap van de Vite-ontwikkelserver lezen. Dat kan zonder iets aan het project toe te voegen, maar het is nog niet bewezen in de echte Tauri-preview (proef nodig).
2. **Een Vite-plugin die `data-`attributen met bestand en regel toevoegt** (uw voorstel) kan ook en is de meest voorspelbare route voor React, Vue en Svelte. Het nadeel: de plugin moet in de Vite-configuratie van het project. Dat mag Studio niet zomaar aanpassen (regel: alleen eigen blokken, bij twijfel weigeren). Een veilige manier is een **eigen configuratiebestand van Studio buiten het project** (`studio.vite.config.mjs` in de app-map) dat de config van het project inleest en de plugin toevoegt, met `vite --config …` alleen voor de preview. Dat werkt alleen als het dev-script gewoon `vite` is. Voor andere dev-scripts (Next.js, eigen scripts) werkt het niet.
3. **Statische sites (`index.html` + css):** de tussenserver die Studio al voor de element-kiezer gebruikt, ziet de HTML toch al. Met een kleine HTML-lezer (bijvoorbeeld `parse5`, MIT-licentie, geeft regel en kolom per element) kan de tussenserver in de preview-kopie per element een `data-studio-loc` zetten. Het bestand op schijf en de export blijven ongemoeid. Dit is de **betrouwbaarste** route en werkt zonder Node-dev-server.
4. **Tokens aanpassen:** een kleur uit de tokens kiezen is simpel als het element een eigen `style` of eigen CSS-regel heeft (de regel wijzigen). Bij Tailwind-klassen (`bg-primary`) moet de klasse worden vervangen door een andere uit dezelfde familie (`bg-secondary`); dat is te doen voor een vaste lijst, maar niet voor willekeurige klassen.

## Beperkingen en risico's

- **Eén bron, veel plekken:** staat een knop in een component die vijf keer wordt gebruikt, dan verandert een tekstwijziging in de bron alle vijf. De gebruiker moet dat vooraf zien ("Dit onderdeel wordt op 5 plekken gebruikt").
- **Tekst die niet letterlijk in de code staat** (`{naam}`, vertalingen, gegevens uit een lijst) is niet direct te wijzigen. Dan bieden we het niet aan, of sturen we de wens naar de AI.
- **De AI schrijft tegelijk in dezelfde bestanden.** Studio mag niets wijzigen terwijl de AI bezig is, en moet controleren dat het bestand sinds het kiezen niet veranderd is (hash). Anders weigeren.
- **Sourcemaps kloppen niet altijd** (bij sommige plugins, na lange bewerkingen). Bij twijfel (regel wijst naar iets anders dan verwacht) wordt niet gewijzigd.
- **Alleen in ontwikkelmodus.** De markeringen komen nooit in de export of in de bouwversie.
- **Frameworks:** React/Vite eerst; Vue, Svelte, Next.js en Flutter zijn aparte routes. Voor die projecten blijft de wens-naar-AI-route.
- **Beveiliging:** alle bestandspaden gaan via de bestaande paden-controle van de MCP-server (alleen binnen de projectmap, symlinks gecontroleerd). Er wordt nooit een commando uitgevoerd.

## Veiligheid en ongedaan maken

Voor elke wijziging maakt Studio een git-checkpoint (bestaande functie `git.checkpoint`), toont eerst wat er verandert ("Tekst op regel 42 van `src/App.tsx`: ‘Hallo’ → ‘Welkom’") en vraagt een bevestiging. "Ongedaan maken" zet het checkpoint terug (bestaande functie `git.restore`, altijd als nieuwe commit na een automatische back-up). Wijzigen gebeurt alleen als de oude tekst op de verwachte plek **precies één keer** voorkomt.

## Voorstel

Bouw in drie kleine stappen, elk met eigen commit en tests:

1. **Statische sites** (tussenserver + HTML-lezer): tekst en zichtbaarheid wijzigen in HTML, kleur/afronding/ruimte via de bijbehorende CSS-regel. Het kleinste en veiligste deel.
2. **React 19 + Vite, alleen letterlijke tekst en inline stijlen**, via de sourcemap-route (zonder plugin) óf de Studio-config-route. Eerst een proef in de echte app om te zien welke van de twee betrouwbaar is.
3. **Tokens in Tailwind-klassen** uit een vaste lijst.

Testplan: unit-tests voor het zoeken en vervangen (precies één treffer, bestand veranderd, buiten de projectmap, symlink), Playwright-tests op de nagebootste preview, en een handmatige controle in de echte Tauri-app.

## Wat ik van u nodig heb

1. Mag ik beginnen met **stap 1 van dit voorstel (statische sites)**, of wilt u liefst direct React?
2. Voor React: welke route heeft uw voorkeur?
   - **A. Sourcemap lezen** (geen wijziging aan het project, maar nog niet bewezen in de echte app), of
   - **B. Eigen Vite-configuratie van Studio met een kleine plugin** (voorspelbaarder, werkt alleen bij `vite` als dev-script, vraagt een aparte goedkeuring van dat bestand).
3. Is "wijziging in de bron raakt alle plekken waar het onderdeel wordt gebruikt" acceptabel, mits Studio het vooraf duidelijk meldt?
