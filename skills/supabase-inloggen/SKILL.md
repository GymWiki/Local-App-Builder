---
name: supabase-inloggen
description: E-mail-inloggen met Supabase Auth toevoegen aan een web-app (React/Vite) of Flutter-app. Alleen gebruiken als de gebruiker inloggen kiest. Legt de e-mailinstellingen en omleidings-URL's uit in gewone taal.
---

# Inloggen met e-mail toevoegen (alleen als de gebruiker het kiest)

Vraag de gebruiker eerst: "Moeten mensen kunnen inloggen in je app?" Doe niets als het antwoord nee is. Zorg dat Supabase gekoppeld is (`db_status`).

## Web (React + Vite)
1. Installeer `@supabase/supabase-js` (de client staat in `src/lib/supabase.ts`; Studio heeft die gemaakt en gebruikt alleen de publieke sleutel).
2. Maak een eenvoudig inlogformulier met e-mail en wachtwoord (of een "magische link"): `supabase.auth.signUp({ email, password })` en `supabase.auth.signInWithPassword({ email, password })`. Toon fouten in gewone Nederlandse zinnen.
3. Haal de ingelogde gebruiker op met `supabase.auth.getUser()` en laat uitloggen toe met `supabase.auth.signOut()`.
4. Koppel gegevens aan de gebruiker: een kolom `user_id uuid references auth.users` en beleid per rol met `(select auth.uid()) = user_id`. Gebruik `db_propose_migration` (zie de skill supabase-veilig).

## Flutter
1. Voeg `supabase_flutter` toe en start met `await Supabase.initialize(url: ..., anonKey: <publiceerbare sleutel>)` (de parameter heet nog `anonKey`; de waarde is de publiceerbare sleutel).
2. Gebruik `Supabase.instance.client.auth.signUp(...)` en `signInWithPassword(...)`.

## E-mailinstellingen en omleidings-URL's (leg dit aan de gebruiker uit)
- **Bevestigingsmail**: standaard moet iemand zijn e-mail bevestigen. Dat is veilig. Zet het niet uit zonder het te bespreken.
- **Verzenden van e-mail**: de ingebouwde e-mail van Supabase stuurt alleen naar de teamleden van het Supabase-account en is bedoeld om te proberen. Voor echte gebruikers is een eigen e-mailaccount (SMTP) nodig; dat stelt de gebruiker zelf in bij Supabase onder ‘Authentication’. Met eigen SMTP is de standaardgrens 30 nieuwe gebruikers per uur.
- **Omleidings-URL's**: na het klikken op de link in de mail stuurt Supabase de gebruiker terug naar je app. Het adres daarvan moet op de lijst van toegestane adressen staan (`uri_allow_list`) en de `site_url` moet het hoofdadres van je app zijn. Voor lokaal testen is `http://localhost:5173/**` handig; zet voor de echte site liever een exact adres. Een mobiele app gebruikt een eigen link-schema (bijvoorbeeld `com.mijnapp://login-callback/`).
- Stel dit in met `db_configure_auth` (altijd gevaarlijk: de gebruiker moet het goedkeuren). Alleen `site_url`, `uri_allow_list`, `mailer_autoconfirm`, `disable_signup` en `external_email_enabled` zijn toegestaan.

<!-- studio:managed:supabase-inloggen (door Studio beheerd; wijzig dit bestand niet, het wordt bijgewerkt) -->
