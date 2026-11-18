# Koppelingen met diensten (onderzoek en keuzes)

Status: onderzoek gedaan op 2026-11-18. Alle feiten komen uit de officiële documentatie van de diensten; wat ik niet kon vinden staat als **niet bevestigd**. Studio heeft geen eigen server en bouwt er ook geen voor tokens. Alle koppelingen zijn optioneel.

## Hoe ik gelezen heb
- Supabase en Vercel: via de documentatie-zoekfunctie van de aangesloten Supabase- en Vercel-connectors.
- GitHub: `docs.github.com` was vanuit mijn omgeving niet bereikbaar. De bronbestanden van de officiële documentatie staan openbaar in de repo `github/docs`; die heb ik gelezen (de sjabloontags in die bestanden worden niet uitgewerkt, dus hosts leid ik af uit de paden).

## Gekozen methode per dienst

| Dienst | Methode | Waarom | Terugval |
|---|---|---|---|
| **GitHub** | **OAuth device flow** (`oauth_device`) | Device flow heeft geen client-geheim nodig ("The client_secret is not needed for the device flow"); alleen de publieke client-ID. Verversen van een device-flow-token vraagt ook geen geheim. | Toegangstoken plakken (fijnmazig token) |
| **Vercel** | **Toegangstoken plakken** (`token_plakken`) | "Sign in with Vercel" vraagt een `client_secret` bij het token-eindpunt en geeft alleen identiteitsrechten (openid, email, profile, offline_access), geen REST-rechten voor projecten en deployments. Het oudere "Integrations"-pad werkt met een geheim en een webserver. | n.v.t. (dit is de terugval zelf) |
| **Supabase** | **Toegangstoken plakken** (`token_plakken`) | OAuth voor de Management API vraagt `client_id` én `client_secret` (Basic auth op het token-eindpunt). Een publieke client zonder geheim staat niet in de documentatie (niet bevestigd). | n.v.t. |
| Google Play, Apple | later | nog niet onderzocht | |

De strategie **OAuth met PKCE en loopback-terugkeer** (`oauth_loopback_pkce`) is wel gebouwd en getest (generiek, voor diensten die een publieke client toestaan), maar geen enkele dienst gebruikt hem nu. Reden: voor alle drie de diensten vraagt het token-eindpunt een client-geheim, of er is een betere geheimloze route.

## Feiten per dienst

### GitHub (OAuth-app)
- Device flow: `POST https://github.com/login/device/code` (`client_id`, `scope`), daarna pollen met `POST https://github.com/login/oauth/access_token` (`client_id`, `device_code`, `grant_type=urn:ietf:params:oauth:grant-type:device_code`). `user_code` van 8 tekens, `expires_in` standaard 900 s, `interval` standaard 5 s; bij `slow_down` komt er 5 s bij.
- Fouten: `authorization_pending`, `slow_down`, `expired_token`, `access_denied`, `incorrect_device_code`, `incorrect_client_credentials`, `unsupported_grant_type`, `device_flow_disabled`. Er geldt een limiet van 50 code-invoeren per uur per app.
- "Enable Device Flow" moet in de instellingen van de app aan staan.
- PKCE (alleen `S256`) bestaat voor de webflow, maar `client_secret` blijft daar "Required" in de tabel. Terugkeeradres: poort mag afwijken van het geregistreerde adres bij `127.0.0.1` (aanbevolen boven `localhost`).
- Tokens: standaard lang geldig; verlopende tokens zijn een optie van de app ("8 uur, refresh-token 6 maanden zonder gebruik"). Een refresh-token is eenmalig. Verversen vraagt `client_secret` **tenzij** het token met de device flow is gemaakt.
- Rechten: een OAuth-app gebruikt scopes. `public_repo` geeft alleen publieke repositories; `repo` geeft volledige toegang tot publieke en privé-repositories. Voor een back-up in een **privé**-repository is `repo` nodig. Dat is veel; de uitleg in Studio zegt dat eerlijk. Zonder scope geeft GitHub alleen publieke gegevens.
- Intrekken: `DELETE /applications/{client_id}/token` staat genoemd; welke authenticatie die vraagt (waarschijnlijk Basic met client-geheim) is **niet bevestigd**. Daarom kan Studio bij GitHub niet zelf intrekken zonder geheim; de gebruiker beheert toegang op https://github.com/settings/applications (URL **niet bevestigd** in de gelezen pagina's, wel de vorm `/settings/connections/applications/:client_id`).
- GitHub-apps (met fijnmazige rechten) kunnen ook device flow, maar de rechtennamen voor "repository maken en pushen" heb ik niet kunnen bevestigen. Daarom kies ik de OAuth-app.

### Vercel
- "Sign in with Vercel": `GET https://vercel.com/oauth/authorize` (PKCE `S256` verplicht), `POST https://api.vercel.com/login/oauth/token` met `client_secret` verplicht. Scopes `openid email profile offline_access`. Geen REST-scopes. Publieke client **niet bevestigd**.
- Toegangstokens: `Authorization: Bearer <token>`, voorvoegsel `vcp_`; teamgebonden of projectgebonden mogelijk. Controle: `GET /v10/projects?limit=1` (bevestigd), teams: `GET /v2/teams` (bevestigd), `GET /v2/user` **niet bevestigd**. Intrekken: `DELETE /v3/user/tokens/{tokenId}` (bevestigd, vraagt het token-ID; Studio kent dat niet) — de gebruiker trekt het in op https://vercel.com/account/tokens (pagina **niet bevestigd** in de gelezen docs).
- Deployen: `POST /v13/deployments` (met `teamId`), bestanden eerst via `POST /v2/files` (digest-header **niet bevestigd**). Dit komt in een latere stap ("Online zetten").

### Supabase
Zie `docs/supabase.md`.

## Wat Pieter moet registreren
Alleen **GitHub** heeft een geregistreerde app nodig. Vul daarna het client-ID (publiek, geen geheim) in `config/koppelingen.json` in (`"github": { "client_id": "…" }`). Is het leeg, dan valt de knop automatisch terug op "token plakken".

**GitHub OAuth-app** — https://github.com/settings/developers → *OAuth Apps* → *New OAuth App* (liefst onder een organisatie of persoonlijk account van u; de app is voor iedereen bruikbaar):

| Veld | Waarde |
|---|---|
| Application name | `Studio` (of een naam naar keuze; gebruikers zien die bij het toestaan) |
| Homepage URL | de pagina van uw project, bijvoorbeeld `https://github.com/GymWiki/Local-App-Builder` |
| Application description | `Lokale app om apps te maken met je eigen AI. Bewaart een kopie van je project in je eigen GitHub.` |
| Authorization callback URL | `http://127.0.0.1/callback` (verplicht veld; de device flow gebruikt het niet) |
| **Enable Device Flow** | **aanvinken** |
| Client secret | **niet aanmaken en niet in de app zetten** |
| Optioneel | "Opt-in to user-to-server token expiration" aanzetten: tokens gelden dan 8 uur en worden zonder geheim ververst (Studio ondersteunt dat) |

Studio vraagt de scope `repo` (zie hierboven). Dat is het enige dat u instelt; kopieer het **Client ID**.

Voor **Vercel**, **Supabase**: niets registreren (gebruikers plakken een eigen toegangstoken). Alleen als Supabase of Vercel later publieke OAuth-clients bevestigen, komt hier een nieuwe lijst.

## Wat ik bewust niet gedaan heb
- Geen eigen server of proxy voor tokenuitwisseling.
- Geen client-geheim in de app.
- Geen OAuth voor Supabase en Vercel (zie hierboven).
