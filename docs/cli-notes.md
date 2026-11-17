# CLI-notities (fase 2)

Gecontroleerd op 2026-11-16 tegen de actuele officiële documentatie. Bron per bevinding tussen haakjes.
Niets hieronder komt uit het geheugen; wat niet te controleren was staat onder "Niet geverifieerd".

## Claude Code (`claude`)
Bronnen: code.claude.com/docs/en/{mcp,env-vars,cli-reference,setup}.md

**(a) MCP per project**
- Projectscope = `.mcp.json` in de projectroot, formaat `{"mcpServers": {"<naam>": {...}}}`.
- HTTP-server: `{"type":"http","url":"...","headers":{...}}`. Een `url` zonder `type` wordt als stdio gelezen en overgeslagen: `type` is verplicht.
- `${VAR}` en `${VAR:-default}` worden uitgebreid in `command`, `args`, `env`, `url` en `headers`. Wij gebruiken `${STUDIO_MCP_URL}` en `Bearer ${STUDIO_MCP_TOKEN}`, zodat **geen token en geen poort in het bestand staan** (het bestand kan dus veilig in git). Alleen enkele credential-variabelen (o.a. `ANTHROPIC_*`) worden in remote `url`/`headers` als leeg gelezen; onze eigen namen vallen daar niet onder.
- Projectservers uit `.mcp.json` vragen bij de eerste interactieve start om goedkeuring (status "Pending approval"). Dat is bewust en blijft zo; wij omzeilen het niet.

**(b) Aparte config/profiel per account**
- `CLAUDE_CONFIG_DIR` = configmap (standaard `~/.claude`); instellingen, sessiegeschiedenis en plugins staan eronder. Bedoeld voor meerdere accounts naast elkaar. Absoluut pad opgeven.
- Inloggen: `claude auth login`; status: `claude auth status` (exit 0 = ingelogd).

**(c) Hervatten**
- `claude -c` / `--continue`: meest recente gesprek in de huidige map. `claude -r "<id|naam>"`: op ID of naam. Sessies leven onder de configmap, dus hervatten werkt alleen binnen hetzelfde account.
- Startprompt: `claude "tekst"` (positioneel) start interactief met die prompt.

**Installatie** (setup.md): macOS/Linux `curl -fsSL https://claude.ai/install.sh | bash`; Windows PowerShell `irm https://claude.ai/install.ps1 | iex`; ook `brew install --cask claude-code` en `winget install Anthropic.ClaudeCode`.

**MCP-timeouts en afbeeldingen (fase 3)**
- Per serverentry in `.mcp.json` verhoogt `timeout` (ms) de limiet; voor HTTP/SSE-servers geldt standaard 60 s per verzoek en pas boven 60000 stijgt die (env-vars.md, `MCP_TOOL_TIMEOUT`; mcp.md). Wij zetten `"timeout": 900000` zodat `run_checks` niet wordt afgekapt.
- MCP-tools mogen PNG/JPEG/GIF/WebP teruggeven; Claude ziet ze inline (mcp.md). Afbeeldingen vallen onder `MAX_MCP_OUTPUT_TOKENS` (standaard 25000); daarom leveren we screenshots als JPEG (kwaliteit 70).
- Projectservers uit `.mcp.json` vragen goedkeuring bij eerste gebruik (zie boven).

**Geverifieerd met de echte CLI (Claude Code, fase 3b, Linux; tijdelijke configmap)**
- `.mcp.json` met `${STUDIO_MCP_URL}` / `Bearer ${STUDIO_MCP_TOKEN}` wordt door `claude mcp get studio` gelezen als "Scope: Project config", "Type: http", "Timeout: 900000ms".
- Zonder goedkeuring toont Claude `⏸ Pending approval (run \`claude\` to approve)`: de server wordt dan **niet** verbonden en de tools zijn onzichtbaar. Dit is de standaard, ook als de server draait. De gebruiker moet bij de eerste interactieve start ‘Ja’ kiezen (of de map vertrouwen).
- Na goedkeuring (getest via `enabledMcpjsonServers` in de gebruikersinstellingen van een tijdelijke configmap) toont `claude mcp get/list` `√ Connected`, en de server meldde een client. De omgevingsvariabelen worden dus echt uitgebreid.
- Ontbreekt `STUDIO_MCP_TOKEN` in de omgeving (bijv. Claude buiten Studio's terminal gestart), dan waarschuwt Claude "Missing environment variables" en kan hij niet verbinden. `claude mcp list` werkt daarom alleen met dezelfde omgeving als de ingebouwde terminal; Studio's knop "Controleer in Claude" geeft die mee.
- **Automatische goedkeuring (met toestemming van de gebruiker)**: Studio zet `"enabledMcpjsonServers": ["studio"]` in `.claude/settings.local.json` van het project (settings-reference.md; een afwijzing via `disabledMcpjsonServers` gaat voor en wordt gerespecteerd). Het bestand wordt via `.git/info/exclude` uit git gehouden (docs: zelf aangemaakte bestanden moet je zelf negeren) en `git_checkpoint` neemt het nooit mee.
- **Geverifieerd**: `claude mcp get studio` blijft `Pending approval` zolang de map niet vertrouwd is (ook mét dit bestand, zoals de docs zeggen: lokale instellingen tellen pas na de workspace-trust-dialoog). Met `hasTrustDialogAccepted` voor de map in de tijdelijke configmap, wat de trust-dialoog zet, wordt het `√ Connected`. Studio omzeilt die trust-dialoog bewust niet: Claude vraagt er één keer om bij de eerste start in een nieuwe map.
- Windows: voor HTTP-servers is geen speciale configuratie nodig (de `cmd /c`-regel in de docs gaat over stdio-servers).

## Gemini CLI (`gemini`)
Bronnen: github.com/google-gemini/gemini-cli `docs/reference/configuration.md`, `docs/tools/mcp-server.md`, `docs/cli/session-management.md`, `docs/cli/cli-reference.md`, README.

**(a) MCP per project**
- Projectsettings = `.gemini/settings.json` in de projectroot (overschrijft `~/.gemini/settings.json`), sleutel `mcpServers`.
- Streamable HTTP: `{"httpUrl":"...","headers":{...}}` (`url` = SSE). Optioneel `timeout`, `trust`. Wij zetten `trust` **niet** aan.
- Stringwaarden in settings.json ondersteunen `$VAR`, `${VAR}` en `${VAR:-default}`: zelfde aanpak als bij Claude.

**(b) Aparte config/profiel**
- `GEMINI_CLI_HOME` = rootmap voor gebruikersconfig; de CLI maakt daarin zelf `.gemini/` aan. Bedoeld voor geïsoleerde state.
- Inloggen gebeurt in de interactieve start (auth-dialoog); wij sturen daarom `gemini` zonder argumenten in een terminal met `GEMINI_CLI_HOME`.

**(c) Hervatten**
- `gemini --resume` / `-r` (laatste), `-r "latest"`, `-r <index|id>`; lijst met `--list-sessions`.
- Startprompt + interactief: `gemini -i "tekst"` (`-p` is niet-interactief en dus niet geschikt).

**MCP-timeout/afbeeldingen (fase 3)**: per server `timeout` in ms (standaard 600000); MCP-resultaten mogen tekst, afbeeldingen en audio bevatten (`docs/tools/mcp-server.md`). Wij zetten `timeout: 900000`. Niet in de praktijk geprobeerd of Gemini onze JPEG-resultaten correct toont.

**Installatie** (README): `npm install -g @google/gemini-cli`, of `brew install gemini-cli`.

## Vaste werkwijze-bestanden
Claude Code leest `CLAUDE.md`, Gemini CLI `GEMINI.md` en Codex `AGENTS.md` als projectinstructies. Dat Claude `CLAUDE.md` leest staat in de Claude-docs; voor `GEMINI.md` (standaard contextbestand, `~/.gemini/GEMINI.md` is in configuration.md genoemd) en `AGENTS.md` is dit niet apart gecontroleerd voor fase 3 (Codex blijft onverifieerd). De inhoud is bij alle drie gelijk, binnen een door Studio beheerd blok.

## Codex CLI (`codex`) — NIET GEVERIFIEERD
`developers.openai.com`/`learn.chatgpt.com` waren niet bereikbaar vanuit deze omgeving, en de GitHub-docs verwijzen alleen daarheen. Het uitvoeren van de CLI voor `--help` werd niet toegestaan. Daarom is Codex in de UI **uitgeschakeld** en schrijven we er geen config voor. Te verifiëren voordat dit aan gaat:
1. MCP-config per project (bestaat er een projectbestand naast `~/.codex/config.toml`? HTTP-transport + bearer uit env-var?)
2. Env-var voor een aparte profielmap (we vermoeden `CODEX_HOME`: niet bevestigd)
3. Hervatten (`codex resume`?) en login-commando.

## Beslissingen die hieruit volgen
- Eén servernaam `studio` in beide configbestanden; nooit andere entries aanraken. Bestaand bestand dat geen geldige JSON is → we weigeren en laten het ongemoeid.
- Token en URL gaan via omgevingsvariabelen van het PTY-proces, nooit het bestand in.
- Profiel per account: Claude → `CLAUDE_CONFIG_DIR`, Gemini → `GEMINI_CLI_HOME`.
- "Wissel van AI" hervat **niet** (sessies zijn per account/CLI en onderling niet uitwisselbaar): de nieuwe AI start vers en krijgt PROJECT.md als overdracht.
- Op Windows zijn npm-CLI's `.cmd`-shims: die starten we via `cmd.exe /D /C`. Niet op Windows getest.

---

# Gestructureerde uitvoer voor de chat-weergave (fase 5)

Gecontroleerd op 2026-11-17 tegen de actuele documentatie. Bronnen: code.claude.com/docs/en/{headless,cli-reference,errors,permissions,memory,skills}.md,
code.claude.com/docs/en/agent-sdk/{typescript,streaming-vs-single-mode}.md, github.com/google-gemini/gemini-cli `docs/cli/{headless,gemini-md,cli-reference}.md`.

## Claude Code — wél gestructureerd (gebouwd)
- **Uitvoer**: `claude -p --output-format stream-json --verbose` geeft per regel één JSON-gebeurtenis (headless.md). `--include-partial-messages` voegt `stream_event`-delta's toe (woord-voor-woord); wij gebruiken die **niet** (zie "niet gedaan").
- **Invoer (meerdere beurten in één proces)**: `--input-format stream-json` met per regel `{"type":"user","message":{"role":"user","content":"…"}}` (streaming-vs-single-mode.md; `content` mag ook een lijst blokken zijn). Het proces blijft draaien tussen beurten; extra berichten die tijdens een beurt binnenkomen worden in de wachtrij gezet (cli-reference `--max-turns`).
- **Gebeurtenissen** (SDK-typen, agent-sdk/typescript.md):
  - `system` met `subtype: "init"`: eerste gebeurtenis, bevat `session_id`, model, tools, `mcp_servers` en `mcp_server_errors`. Ook `system/api_retry` (met `error`: `authentication_failed`, `rate_limit`, `overloaded`, `billing_error`, …).
  - `assistant`: `message.content` is een lijst blokken (`text`, `thinking`, `tool_use` met `id`/`name`/`input`); optioneel `error` (dezelfde foutcategorieën) en `parent_tool_use_id` (≠ null = subagent).
  - `user`: bevat `tool_result`-blokken (`tool_use_id`, `content`, `is_error`).
  - `result`: laatste regel van een beurt; `subtype: "success"` of `error_max_turns` / `error_during_execution` / …, met `is_error`, `result`, `session_id`, `duration_ms`, `total_cost_usd`, `permission_denials`.
- **Hervatten**: `--resume <session_id>` (cli-reference; het id komt uit `system/init` of `result`). `--session-id <uuid>` kiest zelf een id. Sessies staan onder de configmap, dus hervatten werkt per account (zie fase 2).
- **Toestemmingen**: `--permission-prompt-tool mcp__<server>__<tool>` (cli-reference). Sinds v2.1.302 start `claude -p` in *Manual mode*: een aanroep die toestemming nodig heeft wordt geweigerd tenzij de prompt-tool (of een hook) hem goedkeurt (headless.md). De tool moet **één tekstblok** teruggeven met JSON `{"behavior":"allow"}` (optioneel `updatedInput`) of `{"behavior":"deny","message":"…"}`, zonder `structuredContent` en dus zonder `outputSchema` (errors.md). Claude wacht tot de MCP-server verbonden is (MCP_TIMEOUT, standaard 30 s). Een `allow` voor een MCP-tool die ‘user interaction’ vereist wordt een deny.
- **Niet gedocumenteerd, dus niet geverifieerd**: de **namen van de invoerargumenten** die Claude aan de prompt-tool geeft. Onze tool accepteert daarom `tool_name`, `input` en `tool_use_id` (de namen uit de SDK-callback `canUseTool`), laat ze alle drie optioneel en weigert bij onleesbare invoer.
- **MCP bij `-p`**: `--mcp-config` laadt servers uit een bestand/string; `${VAR}`-uitbreiding geldt volgens mcp.md voor `.mcp.json`, `~/.claude.json` en `--mcp-config`-bestanden (zelfde aanpak als fase 2: geen token op de commandoregel of in het bestand). Entries zonder `type` worden overgeslagen (`mcp_server_errors`).
- **Instructiebestanden**: `./CLAUDE.md` of `./.claude/CLAUDE.md` (memory.md). `AGENTS.md` leest Claude **alleen als er géén** `CLAUDE.md` is; bestaan beide, dan telt alleen `CLAUDE.md` (memory.md, tabel). Onze identieke blokken in beide bestanden worden dus nooit dubbel geladen.
- **Skills**: `.claude/skills/<naam>/SKILL.md` met YAML-frontmatter (`name`, `description`); de beschrijving bepaalt wanneer Claude de skill inzet; projectskills horen in de repo te staan (skills.md).

## Gemini CLI — gestructureerde uitvoer bestaat, niet gebouwd (adapter volgt)
- `gemini -p "…" --output-format stream-json` geeft JSONL met typen `init` (sessie-id, model), `message` (gebruiker/assistent), `tool_use`, `tool_result`, `error` en `result` (headless.md). Exitcodes: 0, 1, 42 (invoerfout), 53 (beurtlimiet).
- Er is **geen gedocumenteerde invoer via stdin voor meerdere beurten**; een chat zou per beurt een proces starten met `--resume` (zie fase 2). Toestemmingen via een MCP-tool zijn voor Gemini niet gedocumenteerd.
- Instructiebestand: `GEMINI.md` in de werkmap en bovenliggende mappen, plus `~/.gemini/GEMINI.md` (gemini-md.md); de bestanden worden samengevoegd.
- Besluit voor nu: **terugval op de terminal-weergave** tot de adapter er is.

## Codex CLI — NIET GEVERIFIEERD
`developers.openai.com`/`learn.chatgpt.com` zijn niet bereikbaar (zie eerder); de GitHub-README noemt geen structuur-uitvoer. We nemen dus niets aan over `codex exec --json`, toestemmingen of hervatten. Codex blijft uitgeschakeld en valt terug op de terminal. `AGENTS.md` als instructiebestand voor Codex is **niet** uit de Codex-docs bevestigd; Claude leest het wel (zie boven), en we schrijven het omdat de gebruiker erom vroeg.

## Beslissingen
- Adapter-interface in Rust (`chat::ChatAdapter`): `command`, `encode_user`, `parse_line`. Alleen `ClaudeAdapter` is ingevuld; voor andere providers geeft het register `None` en toont de UI de terminal-weergave.
- Terugval ook tijdens het draaien: komt er van Claude geen geldige JSON (oude versie, onbekende vlag), dan meldt de chat dat en opent de technische weergave.
- De fixtures voor de parser (`src-tauri/tests/fixtures/claude/*.jsonl`) zijn **handgeschreven naar het gedocumenteerde schema**, niet opgenomen uit een live sessie (er is geen ingelogde CLI in deze omgeving).
