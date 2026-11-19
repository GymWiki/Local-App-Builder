use super::*;
use crate::supa::classify::analyze;

fn d(level: Level, sql: &str, f: Facts) -> Decision {
    decide(level, &analyze(sql), &f)
}
fn allow() -> Decision {
    Decision::Allow
}
fn confirm(r: &[&'static str]) -> Decision {
    Decision::Confirm { redenen: r.to_vec() }
}

#[test]
fn drie_niveaus_en_drie_klassen() {
    let lees = "SELECT 1";
    let veilig = "CREATE TABLE a (id int)";
    let gevaar = "DELETE FROM a WHERE id = 1";
    let f = || Facts { rows: RowCount::Exact(1), ..Default::default() };
    // Voorzichtig: alleen lezen is vrij.
    assert_eq!(d(Level::Voorzichtig, lees, f()), allow());
    assert_eq!(d(Level::Voorzichtig, veilig, f()), confirm(&["niveau"]));
    assert_eq!(d(Level::Voorzichtig, gevaar, f()), confirm(&["niveau"]));
    // Zelfstandig: lezen en veilig schrijven zijn vrij.
    assert_eq!(d(Level::Zelfstandig, lees, f()), allow());
    assert_eq!(d(Level::Zelfstandig, veilig, f()), allow());
    assert_eq!(d(Level::Zelfstandig, gevaar, f()), confirm(&["gevaarlijk"]));
    // Volledig: ook gevaarlijk is vrij (met weinig rijen en een back-up).
    let mut vol = f();
    vol.backup = Backup::Gemaakt;
    assert_eq!(d(Level::Volledig, lees, f()), allow());
    assert_eq!(d(Level::Volledig, veilig, f()), allow());
    assert_eq!(d(Level::Volledig, gevaar, vol), allow());
}

#[test]
fn kosten_vragen_altijd_bevestiging_in_elk_niveau() {
    for level in [Level::Voorzichtig, Level::Zelfstandig, Level::Volledig] {
        let a = Analysis { class: Class::Kosten, ..analyze("SELECT 1") };
        match decide(level, &a, &Facts::default()) {
            Decision::Confirm { redenen } => assert!(redenen.contains(&"kosten"), "{level:?}"),
            x => panic!("{level:?}: {x:?}"),
        }
    }
}

#[test]
fn volledige_controle_heeft_nog_steeds_grenzen() {
    let gevaar = "DELETE FROM a";
    // Veel rijen of niet te tellen: toch bevestigen.
    assert_eq!(d(Level::Volledig, gevaar, Facts { rows: RowCount::Exact(101), backup: Backup::Gemaakt, inserted: None }), confirm(&["veel_rijen"]));
    assert_eq!(d(Level::Volledig, gevaar, Facts { rows: RowCount::Onbekend, backup: Backup::Gemaakt, inserted: None }), confirm(&["veel_rijen"]));
    assert_eq!(d(Level::Volledig, gevaar, Facts { rows: RowCount::Exact(100), backup: Backup::Gemaakt, inserted: None }), allow());
    // Geen back-up gelukt: altijd bevestigen en melden.
    assert_eq!(d(Level::Volledig, gevaar, Facts { rows: RowCount::Exact(1), backup: Backup::Mislukt, inserted: None }), confirm(&["geen_backup"]));
    // Onleesbare SQL telt als gevaarlijk én vraagt altijd bevestiging.
    assert_eq!(d(Level::Volledig, "dit is geen sql", Facts::default()), confirm(&["onleesbaar"]));
    // Een groot aantal seed-rijen vraagt bevestiging, ook zelfstandig.
    assert_eq!(d(Level::Zelfstandig, "INSERT INTO a (x) VALUES (1)", Facts { inserted: Some(501), ..Default::default() }), confirm(&["veel_rijen"]));
    assert_eq!(d(Level::Zelfstandig, "INSERT INTO a (x) VALUES (1)", Facts { inserted: Some(500), ..Default::default() }), allow());
}

#[test]
fn gevaarlijke_veiligheidsregels_alleen_in_volledige_controle() {
    for sql in ["ALTER TABLE a DISABLE ROW LEVEL SECURITY", "CREATE POLICY p ON a FOR ALL TO anon USING (true)"] {
        for level in [Level::Voorzichtig, Level::Zelfstandig] {
            assert!(matches!(d(level, sql, Facts { rows: RowCount::Geen, ..Default::default() }), Decision::Refuse { .. }), "{level:?} {sql}");
        }
        // In "Volledige controle" mag het (met een waarschuwing in het log).
        assert_eq!(d(Level::Volledig, sql, Facts::default()), allow(), "{sql}");
    }
    // Een melding die alleen waarschuwt weigert nooit.
    assert!(!matches!(d(Level::Voorzichtig, "CREATE POLICY p ON a FOR SELECT USING (true)", Facts::default()), Decision::Refuse { .. }));
}

#[test]
fn volledige_controle_loopt_af_en_valt_terug_op_zelfstandig() {
    let st = LevelState { level: Level::Volledig, full_until: Some(1000) };
    assert_eq!(st.effective(999), Level::Volledig);
    assert_eq!(st.full_left(999), Some(1));
    assert_eq!(st.effective(1000), Level::Zelfstandig);
    assert_eq!(st.full_left(1000), None);
    // Zonder einde is "volledig" niet geldig: nooit onbeperkt.
    assert_eq!(LevelState { level: Level::Volledig, full_until: None }.effective(0), Level::Zelfstandig);
    assert_eq!(LevelState { level: Level::Voorzichtig, full_until: Some(5) }.effective(0), Level::Voorzichtig);
    assert_eq!(clamp_full_secs(1), FULL_MIN_SECS);
    assert_eq!(clamp_full_secs(i64::MAX), FULL_MAX_SECS);
    assert_eq!(clamp_full_secs(FULL_DEFAULT_SECS), FULL_DEFAULT_SECS);
}

#[test]
fn onbekende_niveaus_zijn_voorzichtig() {
    assert_eq!(Level::parse("zelfstandig"), Level::Zelfstandig);
    assert_eq!(Level::parse("volledig"), Level::Volledig);
    for s in ["", "Volledig", "alles", "root", "voorzichtig"] {
        assert_eq!(Level::parse(s), Level::Voorzichtig, "{s}");
    }
}

#[test]
fn schrijflimiet_per_minuut_en_per_sessie() {
    let mut l = WriteLimiter::default();
    for i in 0..WRITES_PER_MINUTE {
        assert!(l.check(i as i64).is_ok());
        l.record(i as i64);
    }
    assert_eq!(l.check(30), Err(LimitError::PerMinuut));
    assert!(l.check(70).is_ok()); // na een minuut weer ruimte
    let mut l = WriteLimiter::default();
    for i in 0..WRITES_PER_SESSION {
        l.check(i as i64 * 100).unwrap();
        l.record(i as i64 * 100);
    }
    assert_eq!(l.check(1_000_000), Err(LimitError::PerSessie));
    l.reset_session();
    assert!(l.check(1_000_000).is_ok());
}

#[test]
fn kosten_van_een_nieuw_project() {
    assert_eq!(create_project_cost(Some("free"), None), Cost { plan: "gratis_plan", per_maand: None });
    assert_eq!(create_project_cost(Some("pro"), None), Cost { plan: "betaald_plan", per_maand: Some(10.0) });
    assert_eq!(create_project_cost(None, None), Cost { plan: "onbekend_plan", per_maand: Some(10.0) });
    assert_eq!(create_project_cost(Some("pro"), Some("small")).per_maand, Some(15.0));
    assert_eq!(create_project_cost(Some("free"), Some("large")).per_maand, Some(110.0));
    assert_eq!(instance_per_month("onbekend"), None);
}
