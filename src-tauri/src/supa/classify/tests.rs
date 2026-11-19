use super::*;

fn klasse(sql: &str) -> Class {
    analyze(sql).class
}

#[test]
fn lezen() {
    for sql in [
        "SELECT * FROM bestellingen",
        "select id, naam from public.klanten where id = 3 limit 10",
        "SELECT count(*) FROM bestellingen",
        "SELECT a.id, b.naam FROM a JOIN b ON b.id = a.b_id ORDER BY 1",
        "WITH x AS (SELECT 1) SELECT * FROM x",
        "SHOW search_path",
        "EXPLAIN SELECT * FROM klanten",
        "SELECT * FROM information_schema.tables",
        "SELECT * FROM auth.users LIMIT 5", // lezen uit een beschermd schema mag
        "SELECT now(), lower('A'), coalesce(null, 1)",
        "/* een opmerking */ SELECT 1 -- nog een",
        "SELECT 'DROP TABLE x; DELETE FROM y' AS tekst", // gevaarlijke woorden in een tekst zijn geen instructie
        "SELECT $$DROP TABLE x$$",
        "BEGIN; SELECT 1; COMMIT;",
    ] {
        let a = analyze(sql);
        assert_eq!(a.class, Class::Lezen, "{sql}: {:?}", a.statements);
        assert!(a.read_only, "{sql}");
    }
}

#[test]
fn veilig_schrijven() {
    for sql in [
        "CREATE TABLE bestellingen (id uuid primary key, naam text)",
        "create table if not exists public.klanten (id serial primary key)",
        "ALTER TABLE klanten ADD COLUMN telefoon text",
        "ALTER TABLE klanten ENABLE ROW LEVEL SECURITY",
        "ALTER TABLE klanten ALTER COLUMN naam SET NOT NULL",
        "ALTER TABLE klanten ALTER COLUMN naam SET DEFAULT 'onbekend'",
        "CREATE INDEX idx_klanten_naam ON klanten (naam)",
        "CREATE UNIQUE INDEX CONCURRENTLY idx_k_mail ON klanten (email)",
        "CREATE POLICY \"eigen rijen\" ON klanten FOR SELECT TO authenticated USING ((select auth.uid()) = user_id)",
        "CREATE POLICY p ON klanten FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id)",
        "INSERT INTO klanten (naam) VALUES ('Jan'), ('Piet')",
        "INSERT INTO klanten (naam) SELECT naam FROM oud",
        "CREATE EXTENSION IF NOT EXISTS pgcrypto",
        "CREATE EXTENSION \"uuid-ossp\"",
        "CREATE SCHEMA werk",
        "COMMENT ON TABLE klanten IS 'alle klanten'",
        "CREATE TYPE status AS ENUM ('open', 'dicht')",
        "CREATE SEQUENCE volgnummer",
        "CREATE VIEW overzicht WITH (security_invoker = true) AS SELECT * FROM klanten",
        "CREATE FUNCTION plus_een(i integer) RETURNS integer AS $$ SELECT i + 1 $$ LANGUAGE sql",
        "ANALYZE klanten",
    ] {
        let a = analyze(sql);
        assert_eq!(a.class, Class::Veilig, "{sql}: {:?}", a.statements);
        assert!(!a.read_only);
    }
}

#[test]
fn gevaarlijk() {
    for sql in [
        "DROP TABLE klanten",
        "drop table if exists public.klanten cascade",
        "DROP SCHEMA werk CASCADE",
        "DROP POLICY p ON klanten",
        "DROP INDEX idx",
        "DROP FUNCTION plus_een",
        "TRUNCATE klanten",
        "TRUNCATE TABLE a, b RESTART IDENTITY CASCADE",
        "DELETE FROM klanten",
        "DELETE FROM klanten WHERE id = 1",
        "UPDATE klanten SET naam = 'x'",
        "UPDATE klanten SET naam = 'x' WHERE id = 1",
        "ALTER TABLE klanten DROP COLUMN telefoon",
        "ALTER TABLE klanten RENAME TO oud",
        "ALTER TABLE klanten RENAME COLUMN a TO b",
        "ALTER TABLE klanten ALTER COLUMN naam TYPE integer USING naam::integer",
        "ALTER TABLE klanten DROP CONSTRAINT c",
        "ALTER TABLE klanten DISABLE ROW LEVEL SECURITY",
        "ALTER TABLE klanten OWNER TO iemand",
        "GRANT ALL ON klanten TO anon",
        "REVOKE ALL ON klanten FROM authenticated",
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon",
        "CREATE ROLE hacker LOGIN PASSWORD 'x'",
        "ALTER ROLE postgres SET statement_timeout = 0",
        "CREATE POLICY p ON klanten FOR ALL USING (true)",
        "CREATE POLICY p ON klanten FOR INSERT TO anon WITH CHECK (true)",
        "CREATE POLICY p ON klanten FOR SELECT USING (true)", // verruimt de leesrechten
        "CREATE POLICY p ON klanten FOR UPDATE USING (1=1)",
        "INSERT INTO klanten (id, naam) VALUES (1, 'x') ON CONFLICT (id) DO UPDATE SET naam = excluded.naam",
        "CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql",
        "CREATE FUNCTION f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$",
        "CREATE VIEW alles AS SELECT * FROM klanten", // zonder security_invoker omzeilt een view RLS
        "CREATE EXTENSION dblink",
        "COPY klanten TO PROGRAM 'rm -rf /'",
        "COPY klanten FROM '/etc/passwd'",
        "DO $$ BEGIN DELETE FROM klanten; END $$",
        "CALL iets()",
        "SET ROLE postgres",
        "SET search_path = evil",
        "LOCK TABLE klanten",
        "VACUUM FULL klanten",
        "NOTIFY kanaal",
        "INSERT INTO auth.users (id) VALUES (gen_random_uuid())",
        "UPDATE auth.users SET email = 'x'",
        "CREATE TABLE auth.extra (id int)",
        "ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY",
        "CREATE TABLE t AS SELECT * FROM klanten", // niet gevaarlijk — zie hieronder, hier juist veilig
    ]
    .iter()
    .filter(|s| !s.starts_with("CREATE TABLE t AS"))
    {
        let a = analyze(sql);
        assert_eq!(a.class, Class::Gevaarlijk, "{sql}: {:?}", a.statements);
    }
}

#[test]
fn select_dat_toch_schrijft() {
    for sql in [
        "SELECT * INTO nieuwe FROM klanten",
        "WITH d AS (DELETE FROM klanten RETURNING *) SELECT * FROM d",
        "WITH u AS (UPDATE klanten SET a = 1 RETURNING *) SELECT * FROM u",
        "WITH i AS (INSERT INTO klanten (naam) VALUES ('x') RETURNING *) SELECT * FROM i",
        "SELECT * FROM klanten FOR UPDATE",
        "SELECT nextval('volgnummer')",
        "SELECT setval('volgnummer', 1)",
        "SELECT pg_terminate_backend(123)",
        "SELECT pg_sleep(100)",
        "SELECT set_config('role', 'postgres', false)",
        "SELECT lo_import('/etc/passwd')",
        "SELECT pg_read_file('/etc/passwd')",
        "SELECT dblink_exec('host=x', 'drop table y')",
        "SELECT pg_notify('a', 'b')",
        "EXPLAIN ANALYZE DELETE FROM klanten",
        "EXPLAIN ANALYZE SELECT pg_sleep(5)",
    ] {
        let a = analyze(sql);
        assert_eq!(a.class, Class::Gevaarlijk, "{sql}: {:?}", a.statements);
        assert!(!a.read_only, "{sql}");
    }
}

#[test]
fn meerdere_instructies_hoogste_klasse_telt() {
    assert_eq!(klasse("SELECT 1; SELECT 2"), Class::Lezen);
    assert_eq!(klasse("SELECT 1; CREATE TABLE a (id int)"), Class::Veilig);
    assert_eq!(klasse("CREATE TABLE a (id int); SELECT 1"), Class::Veilig);
    assert_eq!(klasse("SELECT 1; DROP TABLE a"), Class::Gevaarlijk);
    assert_eq!(klasse("CREATE TABLE a (id int); CREATE TABLE b (id int); DELETE FROM a"), Class::Gevaarlijk);
    assert_eq!(klasse("INSERT INTO a (x) VALUES (1); TRUNCATE a; SELECT 1"), Class::Gevaarlijk);
    let a = analyze("SELECT 1; DROP TABLE a; SELECT 2");
    assert_eq!(a.statements.len(), 3);
    assert_eq!(a.statements.iter().map(|s| s.class).collect::<Vec<_>>(), vec![Class::Lezen, Class::Gevaarlijk, Class::Lezen]);
}

#[test]
fn trucs_om_de_indeling_te_omzeilen() {
    // Commentaar tussen of in de instructie.
    assert_eq!(klasse("SELECT 1; /* onschuldig */ DROP /* kijk niet */ TABLE a"), Class::Gevaarlijk);
    assert_eq!(klasse("SELECT 1 -- ; DROP TABLE a\n; DELETE FROM b"), Class::Gevaarlijk);
    // Hoofdletters, spaties, nieuwe regels, tabs.
    assert_eq!(klasse("dRoP\n\tTaBlE   a"), Class::Gevaarlijk);
    assert_eq!(klasse("  \n  delete\nfrom a  "), Class::Gevaarlijk);
    // Aangehaalde namen en schema's.
    assert_eq!(klasse("DROP TABLE \"public\".\"klanten\""), Class::Gevaarlijk);
    assert_eq!(klasse("SELECT 1; \"x\""), Class::Gevaarlijk); // geen geldige instructie
    // Een puntkomma in een tekst begint geen nieuwe instructie, en verbergt er ook geen.
    assert_eq!(klasse("SELECT 'a; DROP TABLE x' AS t"), Class::Lezen);
    assert_eq!(klasse("INSERT INTO t (a) VALUES ('x; DELETE FROM t')"), Class::Veilig);
    // Dollar-quotes en escape-tekens.
    assert_eq!(klasse("SELECT $a$ ; DROP TABLE x; $a$"), Class::Lezen);
    assert_eq!(klasse("SELECT 1 $$"), Class::Gevaarlijk); // onleesbaar
    // Een transactie eromheen verandert niets aan de klasse.
    assert_eq!(klasse("BEGIN; DROP TABLE a; ROLLBACK;"), Class::Gevaarlijk);
    assert_eq!(klasse("START TRANSACTION; DELETE FROM a; COMMIT"), Class::Gevaarlijk);
    // Een nepschema met dezelfde naam als een beschermd schema in een andere schrijfwijze.
    assert_eq!(klasse("INSERT INTO \"AUTH\".users (id) VALUES (1)"), Class::Gevaarlijk);
    assert_eq!(klasse("INSERT INTO Auth.users (id) VALUES (1)"), Class::Gevaarlijk);
    // Functies met een hoofdletter of schema ervoor.
    assert_eq!(klasse("SELECT PG_SLEEP(10)"), Class::Gevaarlijk);
    assert_eq!(klasse("SELECT pg_catalog.pg_sleep(10)"), Class::Gevaarlijk);
}

#[test]
fn onleesbaar_leeg_te_groot_of_vreemde_tekens() {
    for sql in ["", "   ", ";", "dit is geen sql", "SELEKT * FROM a", "SELECT * FROM", "DROP", "'", "SELECT (", "\0SELECT 1", "SELECT 1\u{1b}[31m"] {
        let a = analyze(sql);
        assert_eq!(a.class, Class::Gevaarlijk, "{sql:?}");
        assert!(a.onleesbaar, "{sql:?}");
        assert!(!a.read_only);
    }
    let groot = format!("SELECT '{}'", "x".repeat(MAX_SQL_BYTES));
    assert!(analyze(&groot).onleesbaar);
    // Tabs en nieuwe regels zijn gewoon toegestaan.
    assert_eq!(klasse("SELECT\t1\r\n"), Class::Lezen);
}

#[test]
fn nieuwe_tabellen_krijgen_automatisch_rls() {
    let a = analyze("CREATE TABLE bestellingen (id uuid primary key, naam text)");
    assert!(a.final_sql.contains("ALTER TABLE bestellingen ENABLE ROW LEVEL SECURITY;"), "{}", a.final_sql);
    assert!(a.findings.iter().any(|f| f.code == "rls_automatisch_aan" && f.tabel.as_deref() == Some("bestellingen")));
    assert!(a.statements[0].changes.iter().any(|c| c.code == "rls_aan_automatisch"));
    assert_eq!(a.class, Class::Veilig);
    // Staat RLS er al bij, dan verandert er niets.
    let b = analyze("CREATE TABLE t (id int); ALTER TABLE t ENABLE ROW LEVEL SECURITY;");
    assert_eq!(b.final_sql.trim_end(), "CREATE TABLE t (id int); ALTER TABLE t ENABLE ROW LEVEL SECURITY;");
    assert!(b.findings.is_empty());
    // Een eigen schema of een tijdelijke tabel krijgt het niet.
    assert!(!analyze("CREATE TABLE werk.t (id int)").final_sql.contains("ENABLE ROW LEVEL SECURITY"));
    assert!(!analyze("CREATE TEMP TABLE t (id int)").final_sql.contains("ENABLE ROW LEVEL SECURITY"));
    // Meerdere tabellen: allemaal.
    let c = analyze("CREATE TABLE a (id int); CREATE TABLE public.b (id int)");
    assert_eq!(c.final_sql.matches("ENABLE ROW LEVEL SECURITY").count(), 2);
    // De SQL die we uitvoeren is nog steeds leesbaar en blijft in dezelfde klasse.
    assert_eq!(analyze(&c.final_sql).class, Class::Veilig);
}

#[test]
fn rls_uitzetten_en_beleid_dat_alles_toestaat_worden_gemeld_of_geweigerd() {
    let a = analyze("ALTER TABLE klanten DISABLE ROW LEVEL SECURITY");
    assert!(a.findings.contains(&Finding { code: "rls_uit", tabel: Some("klanten".into()), ernst: Ernst::Weiger }));
    let b = analyze("CREATE POLICY p ON klanten FOR ALL TO anon USING (true) WITH CHECK (true)");
    assert!(b.findings.contains(&Finding { code: "beleid_alles_schrijfbaar", tabel: Some("klanten".into()), ernst: Ernst::Weiger }));
    let c = analyze("CREATE POLICY p ON klanten FOR SELECT USING (true)");
    assert!(c.findings.contains(&Finding { code: "beleid_alles_leesbaar", tabel: Some("klanten".into()), ernst: Ernst::Waarschuw }));
    // Een nette voorwaarde levert geen melding op.
    assert!(analyze("CREATE POLICY p ON klanten FOR SELECT TO authenticated USING ((select auth.uid()) = user_id)").findings.is_empty());
}

#[test]
fn veranderingen_in_gewone_woorden() {
    let a = analyze("CREATE TABLE bestellingen (id int)");
    assert_eq!(a.statements[0].changes[0].code, "tabel_toevoegen");
    assert_eq!(a.statements[0].changes[0].params.get("tabel").map(String::as_str), Some("bestellingen"));
    let b = analyze("ALTER TABLE public.klanten ADD COLUMN telefoon text");
    assert_eq!(b.statements[0].changes[0].code, "kolom_toevoegen");
    assert_eq!(b.statements[0].changes[0].params["kolom"], "telefoon");
    assert_eq!(b.statements[0].changes[0].params["tabel"], "klanten");
    let c = analyze("INSERT INTO klanten (naam) VALUES ('a'), ('b'), ('c')");
    assert_eq!(c.statements[0].changes[0].params["aantal"], "3");
}

#[test]
fn tellen_hoeveel_rijen_een_instructie_raakt() {
    let a = analyze("DELETE FROM klanten WHERE id > 5");
    assert_eq!(a.statements[0].impact[0].soort, "rijen_verwijderen");
    assert_eq!(a.statements[0].impact[0].telsql.as_deref(), Some("SELECT count(*) FROM klanten WHERE id > 5"));
    let b = analyze("UPDATE klanten SET a = 1");
    assert_eq!(b.statements[0].impact[0].telsql.as_deref(), Some("SELECT count(*) FROM klanten"));
    let c = analyze("TRUNCATE a, b");
    assert_eq!(c.statements[0].impact.len(), 2);
    let d = analyze("DROP TABLE a");
    assert_eq!(d.statements[0].impact[0].soort, "tabel_verwijderen");
    // Een DELETE met USING of een join is niet netjes te tellen: dan telt het als "veel".
    let e = analyze("DELETE FROM a USING b WHERE a.id = b.a_id");
    assert!(e.statements[0].impact[0].telsql.is_none());
    // De telopdracht is zelf altijd alleen-lezen.
    for sql in ["DELETE FROM a WHERE x = 1", "UPDATE a SET b = 2 WHERE c = 3", "TRUNCATE a", "DROP TABLE a"] {
        for i in &analyze(sql).statements[0].impact {
            assert_eq!(analyze(i.telsql.as_deref().unwrap()).class, Class::Lezen, "{sql}");
        }
    }
}
