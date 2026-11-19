---
name: supabase-veilig
description: Zo werk je veilig met Supabase in Studio: RLS altijd aan, beleid per rol, nooit de service-role-sleutel in de app, geen geheimen in de repo, eerst voorstellen en dan toepassen. Gebruik dit bij elke wijziging aan de database.
---

# Supabase veilig gebruiken

Lees de regels in het blok ‘supabase-veilig’ in CLAUDE.md, GEMINI.md of AGENTS.md. Kort:

1. RLS altijd aan; beleid per rol met een voorwaarde; nooit `using (true)`.
2. Nooit een geheime sleutel in de code, in `.env.local` of in git. Alleen de URL en de publiceerbare sleutel.
3. Eerst `db_propose_migration`, uitleggen in gewone woorden, dan pas `db_apply_migration`.
4. Weghalen of aanpassen van gegevens is gevaarlijk: Studio vraagt toestemming en maakt een back-up.
5. Een GEWEIGERD-uitslag betekent dat er niets is gebeurd. Doe niet alsof het gelukt is.

<!-- studio:managed:supabase-veilig (door Studio beheerd; wijzig dit bestand niet, het wordt bijgewerkt) -->
