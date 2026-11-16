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

**Installatie** (README): `npm install -g @google/gemini-cli`, of `brew install gemini-cli`.

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
