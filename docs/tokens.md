# Tokengebruik van Studio

Doel: de AI in Studio (Claude, Gemini, Codex via het eigen account van de gebruiker) minder laten lezen en herhalen, zonder dat de apps slechter worden.
Gelezen op 18 november 2026. Per feit staat de bron. Wat niet na te kijken was, staat er als "niet gevonden".

## 1. Hoe we meten

| Wat | Hoe | Plek |
|---|---|---|
| Tokens (invoer, uitvoer, cache lezen/schrijven), kosten, duur, beurten | uit het `result`-bericht van `--output-format stream-json` | `mcp-server/src/gebruik.ts` (`parseClaudeStream`) |
| Tool-aanroepen en gelezen bestanden | tellen van `tool_use`-blokken; `Read` met `file_path` | idem |
| Vaste context van Studio zelf | tekens/4 (**schatting**) van instructieblokken, PROJECT.md en tool-beschrijvingen | `node scripts/tokens-meet.mjs statisch` |
| Echte taken | zes vaste taken op de startprojecten (`scripts/tokens-taken.json`) | `STUDIO_BENCH_OK=1 node scripts/tokens-meet.mjs live <label>` |
| Opgenomen uitvoer inlezen | tabel met alle cijfers | `node scripts/tokens-meet.mjs parse <bestand…>` |

**Kwaliteit telt mee.** Elke taak heeft in `tokens-taken.json` wat na afloop moet kloppen. Een besparing die daarop inlevert, draaien we terug.

**Wat de CLI's zelf geven**
- Claude Code: in echte opnames (`src-tauri/tests/fixtures/claude/real_*.jsonl`) staan `usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`), `total_cost_usd`, `num_turns`, `duration_ms`. Dat is uit onze eigen opnames gelezen, niet uit de docs: de pagina over headless-gebruik is niet gelezen.
- Gemini CLI: `--output-format stream-json` geeft een `result`-gebeurtenis met `stats` en tokengebruik per model (bron: `docs/cli/headless.md`). De exacte veldnamen staan **niet** in wat ik las en ik heb geen echte opname. `parseGeminiStream` leest voorzichtig en meldt "gedeeltelijk".
- Codex: **niet gevonden** (developers.openai.com was niet bereikbaar). Studio heeft ook geen Codex-adapter; daar valt dus niets te meten.

## 2. Nulmeting

### 2a. Gemeten uit echte opnames (Claude Code, model claude-sonnet-5-5)

| Opname | Invoer | Uitvoer | Cache lezen | Cache schrijven | Tool-aanroepen | Kosten |
|---|---|---|---|---|---|---|
| "Hallo" (`real_hello_mcp_failed`) | 2 | 29 | 0 | **41.259** | 0 | $0,165 |
| Eén pagina schrijven (`real_write_page`) | 4 | 233 | 70.245 | 12.392 | 1 | $0,059 |

Lees dit zo: een simpele "Hallo" kost al ± 41.000 tokens vaste context. Die komt van Claude Code zelf (zijn eigen instructies en tools), niet van Studio. Cache lezen is veel goedkoper dan nieuwe invoer, maar telt bij abonnementen wel mee voor de limiet.

### 2b. Vaste context die Studio zelf toevoegt (schatting, `scripts/tokens-meet.mjs statisch`)

| Onderdeel | Tekens | Tokens (≈) |
|---|---|---|
| Instructieblok control-loop (altijd) | 3.035 | 759 |
| Instructieblok eenvoudig-communiceren (alleen in "Eenvoudige taal") | 1.483 | 371 |
| Instructieblok supabase-veilig (alleen met Supabase) | 3.106 | 777 |
| PROJECT.md van een startproject | 580–690 | 145–173 |
| MCP-tool-beschrijvingen (15 stuks, alleen de tekst) | 3.659 | 915 |
| **Totaal per taak, ruim genomen** | | **± 2.800 + PROJECT.md** |

**Eerste conclusie (eerlijk):** Studio's vaste tekst is ± 3.000 tokens, ongeveer 7% van wat Claude Code zelf al meebrengt. Het grote verlies zit dus niet in onze instructiebestanden maar in wat de AI tijdens een taak leest en herhaalt: bestanden doorzoeken, volledige logs, schermafbeeldingen, en vastlopen in een lus. Daar richten de volgende delen zich op. Het inkorten van CLAUDE.md levert weinig op; dat meten we eerst voordat we het doen.

### 2c. Taken op de startprojecten

Nog **niet gemeten**. Een echte meting laat de AI zes taken uitvoeren en verbruikt AI-gebruik van het ingelogde account. In deze omgeving is dat niet zonder meer aan; het meetscript weigert te draaien zonder `STUDIO_BENCH_OK=1`. De eigenaar draait één keer:

```
STUDIO_BENCH_OK=1 node scripts/tokens-meet.mjs live nulmeting
```

en na elk deel opnieuw met een ander label (`na-deel-1` …). De uitvoer komt in `docs/tokens-opnames/<label>/` en de cijfers in de tabel hieronder.

| Taak | Label | Invoer | Uitvoer | Cache | Tools | Bestanden gelezen | Sec | Geslaagd |
|---|---|---|---|---|---|---|---|---|
| (wacht op nulmeting) | | | | | | | | |

## 3. Onderzoek (bronnen)

### Claude Code (code.claude.com/docs/en/…; delen van `mcp`, `sub-agents` en `model-config` waren afgekapt en zijn gemarkeerd "samenvatting")
- CLAUDE.md: "target under 200 lines per CLAUDE.md file" (`memory`). Skills laden alleen op aanvraag (`costs`). Regels met een pad laden pas als Claude een passend bestand leest (`memory`).
- `/clear` voor ander werk; `/compact` kan instructies krijgen, maar "reads the conversation it summarizes", dus compacten is zelf ook een grote aanvraag (`costs`).
- Cache: het eerste bericht na een pauze langer dan de cache-levensduur mist de cache en verwerkt alles opnieuw; een voorbeeld van een oorzaak is "tool definitions changed" (`costs`). De volledige lijst staat op de pagina `prompt-caching`, **niet gelezen**.
- MCP: tools worden standaard uitgesteld geladen en op aanvraag gevonden ("tool search"); instelling `ENABLE_TOOL_SEARCH` (`true`, `auto`, `auto:N`, `false`) (`mcp`). `MAX_MCP_OUTPUT_TOKENS` is standaard 25.000; te grote resultaten gaan naar een bestand (`mcp`). Beschrijvingen: limiet 4.096 tekens (samenvatting).
- Subagents: eigen, schone context, geven alleen een samenvatting terug, maar tellen mee voor dezelfde limieten (`sub-agents`, `costs`). Een agentteam kost "approximately 7x more tokens" (`costs`).
- Modellen en inspanning: `--model` (aliassen o.a. `sonnet`, `opus`, `haiku`, `fable`, `opusplan`), `--effort` met `low`, `medium`, `high`, `xhigh`, `max` (samenvatting); `MAX_THINKING_TOKENS`; denken kan bij de nieuwste modellen niet uit (`model-config`, samenvatting).

### Gemini CLI (github.com/google-gemini/gemini-cli, map docs/)
- GEMINI.md: alle gevonden bestanden worden samengevoegd en bij elke prompt meegestuurd; `@bestand.md` imports; instelling `context.fileName`. Een maximale grootte: **niet gevonden**.
- Tokencache: automatisch **alleen met API-sleutel** (Gemini API of Vertex AI), **niet met inloggen via een Google-account** (`cli/token-caching.md`). Dat betekent dat gebruikers via account geen cache-besparing hebben; we mogen die niet beloven.
- `/compress` vervangt de hele context door een samenvatting; automatisch bij `model.compressionThreshold` (standaard 0,5) (`reference/commands.md`, `cli/settings.md`).
- MCP-tools filteren per server met `includeTools` en `excludeTools` (`tools/mcp-server.md`).
- Subagents bestaan (`codebase_investigator`, eigen context; `core/subagents.md`).
- Model: `-m/--model` (`auto`, `pro`, `flash`, `flash-lite`), `model.name`. Een "inspanning"-instelling: **niet gevonden**; het dichtstbijzijnde is `thinkingBudget` in `modelConfigs`.

### Codex
**Niet gevonden.** De documentatie staat op developers.openai.com en dat was vanuit deze omgeving niet bereikbaar (DNS). De GitHub-map `docs/` verwijst er alleen naar. Niets over Codex mag dus als feit in Studio komen zonder dit eerst na te kijken.

### Graphify en vergelijkbare tools
- Graphify (PyPI-pakket `graphifyy`, repository Graphify-Labs/graphify, ook verwezen als safishamsi/graphify): bouwt een kennisgraaf van code en documenten voor AI-assistenten. Code wordt lokaal met tree-sitter geparsed zonder AI; documenten, pdf's en afbeeldingen gaan door een AI-stap die **tokens kost**. Vereist Python (PyPI: ≥3.11; oudere README: 3.10). Integreert via een skill, een hook die vóór zoekacties naar de graaf wijst, en een optionele MCP-server.
- Beweringen van het project zelf (niet door ons nagemeten): "71.5x fewer tokens per query" op een corpus van 52 bestanden; in zijn eigen voorbeeld 5,4× bij 4 bestanden en ± 1× bij 6 bestanden, dus de besparing groeit met de grootte.
- **Licentie: tegenstrijdig gemeld** (PyPI: Apache-2.0; pyproject in de repository: MIT; LICENSE-bestand niet leesbaar). Voordat Studio het aanbiedt, moet dat uitgezocht zijn; Studio mag er niet van afhangen.
- Vergelijkbaar: `code-review-graph` (MIT; tree-sitter-graaf in één SQLite-bestand, via MCP; claimt in zijn eigen benchmark een mediaan van ± 6,65× tegen een grep-agent). Aider repo map: **niet gevonden** (aider.chat onbereikbaar).
- Wat we hieruit overnemen: de kern (lokale parser, geen AI-tokens, vraag-gericht opvragen) bouwen we zelf in SQLite en Node (deel 1). Dat past bij "local-first" en we krijgen geen Python-afhankelijkheid.

## 4. Voortgang per deel

| Deel | Status |
|---|---|
| 0 Meten | meetinstrument + tests + onderzoek klaar; taakmeting wacht op de eigenaar (kost AI-gebruik) |
| 1–8 | nog niet gedaan |
