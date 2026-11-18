# GitHub-back-up

Onderzoek, keuzes en werking van de optionele back-up van een project op het **eigen** GitHub-account van de gebruiker.
Onderzocht op 18 november 2026. Per feit staat of het uit een bron is gelezen of niet te controleren was. Ik vul niets aan uit het geheugen.

## 1. Wat uit bronnen is gelezen

Bronnen: `github/docs` op github.com (de bron van docs.github.com, dat zelf niet bereikbaar was).

| Feit | Bron |
|---|---|
| Aanbevolen maximum van een repository op schijf: 10 GB (`.git`); een push is begrensd op 2 GB; een enkel bestand wordt bij 100 MB geweigerd (aanbevolen: 1 MB) | `repositories/creating-and-managing-repositories/repository-limits.md` |
| Aanbevolen: repository liefst kleiner dan 1 GB, zeker kleiner dan 5 GB | `repositories/working-with-files/managing-large-files/about-large-files-on-github.md` |
| Bestanden boven de waarschuwingsgrens geven bij het pushen een waarschuwing; de push slaagt wel. (De exacte getallen stonden in sjabloonvariabelen die niet werden ingevuld; 50 MiB/100 MiB staat dus **niet** letterlijk in de gelezen tekst, alleen "enforced at 100 MB".) | idem |
| Aanbeveling: niet meer dan 6 pushes per minuut per repository; 15 leesbewerkingen per seconde per repository | `repository-limits.md` |
| REST-limieten: headers `x-ratelimit-limit/-remaining/-used/-reset/-resource`; bij overschrijding 403 of 429 met `x-ratelimit-remaining: 0`; niet opnieuw proberen vóór `x-ratelimit-reset`. Secundaire limiet: 403/429; wacht `retry-after` seconden, anders minstens een minuut, daarna oplopend. Blijven aandringen kan tot een ban leiden | `rest/using-the-rest-api/rate-limits-for-the-rest-api.md` |
| Git-referenties bewaren: GitHub raadt de GitHub CLI of de Git Credential Manager aan, of SSH-sleutels | `get-started/git-basics/caching-your-github-credentials-in-git.md` |

## 2. Wat niet te controleren was (en hoe Studio daarmee omgaat)

De pagina's met de eindpunt-details zijn gegenereerd uit een OpenAPI-bestand van 10,5 MB dat niet leesbaar was. Niet geverifieerd in deze sessie:

- De exacte velden van `POST /user/repos`, de vereiste scope (`repo` vs `public_repo`), de vorm van de 422-fout bij een bestaande naam.
- Naamregels van een repository (toegestane tekens, lengte, gereserveerde namen).
- Paginering van `GET /user/repos`.
- De gebruikersnaam bij git-over-HTTPS met een token, en of push-protection standaard aanstaat voor privé-repositories.
- Dat een push die niet "fast-forward" is wordt geweigerd tenzij geforceerd.

**Gevolg voor de bouw (defensief):**

- Namen maakt Studio bewust strenger dan nodig: alleen `a-z 0-9 - _`, maximaal 80 tekens, begint met een letter of cijfer. Dat is geldig onder elke redelijke regel.
- Beschikbaarheid: eerst `GET /repos/{eigenaar}/{naam}`; 404 = vrij, 200 = bezet. Een 422 bij het aanmaken wordt ook als "naam bezet" getoond, andere fouten als algemene fout met de HTTP-status.
- De scope is `repo` (zoals de provider al vraagt). Een 403/404 bij aanmaken wordt vertaald naar "onvoldoende rechten".
- Paginering: `per_page=100` en de `page`-parameter tot er minder dan 100 terugkomen (met een bovengrens), zonder aan te nemen hoe de headers eruitzien.
- Studio vertrouwt **niet** op de server om geschiedenis te beschermen: zelf alleen fast-forward pushen (zie 3) en nooit een `+`-refspec.
- De gebruikersnaam voor git is de accountnaam van de gebruiker (standaard, door GitHub gedocumenteerd gebruik van een persoonlijk token als wachtwoord); het echte gedrag kon hier niet met GitHub zelf worden getest en staat daarom op de handmatige testlijst (§7).
- Pushlimiet: Studio blokkeert zelf bestanden boven 100 MB (harde grens uit de bron) en waarschuwt boven 50 MB (eigen, voorzichtige keuze; geen brontekst).

## 3. Hoe Studio git uitvoert

Twee soorten git-werk:

1. **Lokale versies** (checkpoints, terugzetten): bestaat al in `mcp-server/src/git.ts` en gebruikt het **systeem-`git`**. Dit is een bestaande keuze van Studio. Op een schone Windows-pc zonder Git werkt dat niet; dat is een bekend gat, genoteerd in `docs/cli-notes.md`-stijl onder "Open punten" hieronder, en valt buiten deze opdracht.
2. **Naar GitHub sturen** (nieuw): in Rust met **libgit2** (crate `git2`, `vendored-libgit2`, `https`). Redenen:
   - geen extra installatie nodig voor deze functie: het wordt in Studio ingebouwd;
   - het token bestaat alleen in het geheugen, in de `credentials`-callback. Er is geen askpass-bestand, geen URL met token en geen opdrachtregel waarin het kan lekken;
   - ahead/behind en fast-forward-controle zonder een proces te starten;
   - testbaar met een lokale kale repository (`file://`).
   - gitoxide (gix) is niet gekozen omdat pushen daar nog niet volledig is.
   - Nadeel: groter programma (libgit2 is ingebouwd) en een C-bouwstap. Dat is aanvaardbaar.

**Vaste regels in de code:**

- De remote-URL is altijd `https://github.com/<eigenaar>/<repo>.git`, opgebouwd uit gecontroleerde delen. Nooit met `@` of token erin.
- Push gebruikt de refspec `refs/heads/<tak>:refs/heads/<tak>`. Een refspec met `+` wordt geweigerd door de code zelf (test).
- Eerst `fetch`, dan ahead/behind. Is de remote voor of uiteengelopen: niets doen en de gebruiker opties tonen.
- Er is geen functie voor force-push, geschiedenis herschrijven, verwijderen van repositories of het wijzigen van instellingen.

## 4. Wat de functie doet

Zie het scherm *Eerdere versies → Back-up op GitHub*:

- Eerste keer: privé-repository aanmaken (openbaar alleen na uitleg en extra bevestiging), link opslaan, eerste back-up.
- Daarna "Back-up bijwerken": alleen nieuwe lokale versies sturen.
- Voor elke back-up: scan op geheimen en te grote bestanden (zie 5). Gevonden = geblokkeerd met uitleg en "Laat de AI dit herstellen".
- Optie "Maak automatisch een back-up na elke opgeslagen versie" (standaard uit).
- Project ophalen van GitHub: lijst van eigen repositories, kiezen, klonen naar een nieuw Studio-project.

## 5. Veiligheidscontroles

- **Scan** van alle bestanden die meegaan (boomstructuur van de laatste versie): bestandsnamen (`.env*`, `*.pem`, `*.key`, `id_rsa*`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, certificaten) en inhoud (privésleutelblokken, bekende tokenvormen, wachtwoordtoewijzingen). In het weergegeven resultaat staat nooit de geheime waarde, alleen bestand, regel en soort.
- **Geschiedenis:** dezelfde scan over bestanden die in de te sturen commits zijn toegevoegd; een treffer is een waarschuwing ("staat al in je versies; wordt niet automatisch verwijderd; vervang de sleutel").
- **Openbaar:** strengere scan en een extra waarschuwing.
- **`.gitignore`:** Studio controleert vaste regels en voegt een afgebakend blok toe. Bestanden die al in de geschiedenis staan, worden niet automatisch verwijderd.
- **Grootte:** > 50 MB waarschuwing, > 100 MB blokkade.

## 6. Netwerk

Alleen `api.github.com` en `github.com`, via Rust (`connect/providers::allowed_hosts`). De frontend doet zelf niets. Libgit2 maakt zijn eigen HTTPS-verbinding naar `github.com`; Studio laat de URL alleen toe als de host precies `github.com` is (zie `github/repo.rs`).

Voorbereid voor later: GitHub Actions (bouwen van iOS-apps) gebruikt dezelfde koppeling en dezelfde repository; geen aparte aanpassing nodig in het ontwerp.

## 7. Handmatig testen (met eigen account)

1. Koppel GitHub met de Verbinden-knop. Maak een back-up: er verschijnt een **privé**-repository.
2. Wijzig iets, sla een versie op, werk de back-up bij. Controleer de commit op github.com.
3. Maak met git een commit rechtstreeks op GitHub; werk daarna de back-up bij: je krijgt de melding "uiteengelopen" en er gebeurt niets.
4. Zet een nepsleutel in een bestand: de back-up wordt geblokkeerd.
5. Controleer dat het token nergens in de remote-URL staat (`git remote -v` in de projectmap).

## 8. Open punten

- Lokale versies leunen op systeem-git; op een schone Windows-pc moet Git nog worden geïnstalleerd. Aparte opdracht.
- Gebruikersnaam/token-gedrag van libgit2 tegen github.com kon hier niet met het echte GitHub worden getest.
