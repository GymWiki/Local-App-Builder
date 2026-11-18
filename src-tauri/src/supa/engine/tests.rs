use super::*;
use crate::connect::config::Config;
use crate::connect::http::{Body, Http, Request, Response};
use crate::connect::provider::Strategy;
use crate::connect::store::{MemMeta, Meta, MetaStore, Status};
use crate::connect::vault::{MemoryStore, SecretStore};
use rusqlite::Connection;
use std::sync::atomic::AtomicI64;

const TOKEN: &str = "sbp_geheim_toegangstoken_123456";
const REF: &str = "abcdefghij";

/// Een nagebootste Supabase: antwoordt op grond van pad en inhoud, en onthoudt alle verzoeken.
#[derive(Default)]
struct Fake {
    calls: Mutex<Vec<(String, String, String)>>,
    /// Aantal rijen dat een telvraag teruggeeft.
    count: Mutex<u64>,
    /// Rijen die een "SELECT * FROM"-vraag (back-up) teruggeeft.
    rows: Mutex<Vec<Value>>,
    /// Zo ja: de volgende schrijf-aanroep mislukt met deze status en tekst.
    fail_write: Mutex<Vec<(u16, String)>>,
    status: Mutex<String>,
    secret_names: Mutex<Vec<String>>,
}

impl Http for Fake {
    fn send(&self, req: Request) -> Result<Response, ConnectError> {
        let body = match &req.body {
            Body::Json(j) => j.clone(),
            Body::Bytes { data, .. } => String::from_utf8_lossy(data).into_owned(),
            _ => String::new(),
        };
        self.calls.lock().unwrap().push((req.method.to_string(), req.url.clone(), body.clone()));
        let u = req.url.as_str();
        let ok = |s: u16, b: &str| Ok(Response { status: s, body: b.to_string() });
        if u.ends_with("/v1/organizations") {
            return ok(200, r#"[{"id":"o1","name":"Mijn bedrijf","slug":"mijn-bedrijf","plan":"free"}]"#);
        }
        if u.ends_with("/v1/projects") && req.method == "POST" {
            return ok(201, r#"{"id":"nieuwproj1","name":"Nieuw","region":"eu-central-1","status":"COMING_UP"}"#);
        }
        if u.ends_with(&format!("/v1/projects/{REF}")) {
            let st = self.status.lock().unwrap().clone();
            return ok(200, &format!(r#"{{"id":"{REF}","name":"Winkel","region":"eu-west-1","status":"{}"}}"#, if st.is_empty() { "ACTIVE_HEALTHY" } else { &st }));
        }
        if u.contains("/api-keys") {
            return ok(200, r#"[{"name":"service_role","api_key":"GEHEIME-SERVICE-SLEUTEL"},{"type":"secret","api_key":"sb_secret_GEHEIM"},{"type":"publishable","api_key":"sb_publishable_OPENBAAR"}]"#);
        }
        if u.ends_with("/secrets") && req.method == "GET" {
            let namen: Vec<Value> = self.secret_names.lock().unwrap().iter().map(|n| json!({ "name": n, "value": "WAARDE-NIET-TONEN" })).collect();
            return ok(200, &Value::Array(namen).to_string());
        }
        if u.contains("/database/query") {
            let read_only = u.ends_with("/read-only");
            if !read_only {
                if let Some((s, m)) = self.fail_write.lock().unwrap().pop() {
                    return ok(s, &json!({ "message": m }).to_string());
                }
                return ok(201, "[]");
            }
            if body.contains("count(*)") {
                return ok(201, &json!([{ "count": *self.count.lock().unwrap() }]).to_string());
            }
            if body.contains("json_agg(x") {
                return ok(201, r#"[{"data":[{"tabel":"klanten","rls":true}]}]"#);
            }
            if body.contains("SELECT * FROM") {
                return ok(201, &Value::Array(self.rows.lock().unwrap().clone()).to_string());
            }
            return ok(201, r#"[{"id":1,"naam":"Jan"}]"#);
        }
        ok(200, "{}")
    }
}

struct Antwoorden {
    vragen: Mutex<Vec<ConfirmRequest>>,
    /// Het antwoord per vraag; leeg = ja.
    plan: Mutex<Vec<bool>>,
    /// Een actie die uitgevoerd wordt tijdens het vragen (bijvoorbeeld de noodknop).
    tijdens: Mutex<Option<Box<dyn Fn() + Send>>>,
}
impl Confirmer for Antwoorden {
    fn ask(&self, req: &ConfirmRequest) -> bool {
        self.vragen.lock().unwrap().push(req.clone());
        if let Some(f) = self.tijdens.lock().unwrap().take() {
            f();
        }
        let mut p = self.plan.lock().unwrap();
        if p.is_empty() { true } else { p.remove(0) }
    }
}

struct Haken {
    checkpoints: Mutex<Vec<String>>,
    stops: Mutex<Vec<i64>>,
    dir: tempfile::TempDir,
    drempel: usize,
    veranderd: AtomicI64,
}
impl Hooks for Haken {
    fn checkpoint(&self, _p: i64, m: &str) -> Option<String> {
        self.checkpoints.lock().unwrap().push(m.to_string());
        Some("abc1234".into())
    }
    fn stop_ai(&self, p: i64) {
        self.stops.lock().unwrap().push(p);
    }
    fn project_dir(&self, _p: i64) -> Option<PathBuf> {
        Some(self.dir.path().to_path_buf())
    }
    fn loop_threshold(&self) -> usize {
        self.drempel
    }
    fn changed(&self, _p: i64) {
        self.veranderd.fetch_add(1, Ordering::SeqCst);
    }
}

struct Bron(Mutex<Connection>);
impl ConnSource for Bron {
    fn with(&self, f: &mut dyn FnMut(&Connection)) {
        f(&self.0.lock().unwrap());
    }
}
struct Gedeeld(Arc<Bron>);
impl ConnSource for Gedeeld {
    fn with(&self, f: &mut dyn FnMut(&Connection)) {
        self.0.with(f)
    }
}

struct Rig {
    e: Arc<Engine>,
    http: Arc<Fake>,
    ja: Arc<Antwoorden>,
    haken: Arc<Haken>,
    kluis: Arc<MemoryStore>,
    bron: Arc<Bron>,
    tijd: Arc<AtomicI64>,
    _backups: tempfile::TempDir,
}

fn rig() -> Rig {
    let http = Arc::new(Fake::default());
    let kluis = Arc::new(MemoryStore::default());
    let meta = Arc::new(MemMeta::default());
    meta.put(&Meta { provider: "supabase".into(), status: Status::Werkt, account: Some("Mijn bedrijf".into()), error: None, method: Some(Strategy::TokenPlakken), connected_at: Some(1), expires_at: None });
    kluis.set("connect/supabase/tokens", &serde_json::to_string(&crate::connect::tokens::TokenSet::plain(TOKEN)).unwrap()).unwrap();
    let mgr = Manager::new(crate::connect::providers::all(), kluis.clone(), http.clone(), meta, Config::default(), Arc::new(|| {}));
    let mut conn = Connection::open_in_memory().unwrap();
    crate::db::migrate(&mut conn).unwrap();
    conn.execute("INSERT INTO projects (id, naam, pad, template) VALUES (1, 'P', '/p', 'leeg')", []).unwrap();
    store::link_set(&conn, 1, REF, "Winkel", "eu-west-1", 1000).unwrap();
    let bron = Arc::new(Bron(Mutex::new(conn)));
    let ja = Arc::new(Antwoorden { vragen: Mutex::new(vec![]), plan: Mutex::new(vec![]), tijdens: Mutex::new(None) });
    let haken = Arc::new(Haken { checkpoints: Mutex::new(vec![]), stops: Mutex::new(vec![]), dir: tempfile::tempdir().unwrap(), drempel: 3, veranderd: AtomicI64::new(0) });
    let backups = tempfile::tempdir().unwrap();
    let tijd = Arc::new(AtomicI64::new(10_000));
    let t = tijd.clone();
    let e = Engine::new(mgr, kluis.clone(), Box::new(Gedeeld(bron.clone())), ja.clone(), haken.clone(), backups.path().to_path_buf(), Arc::new(move || t.load(Ordering::SeqCst)));
    Rig { e, http, ja, haken, kluis, bron, tijd, _backups: backups }
}

impl Rig {
    fn niveau(&self, l: Level) {
        let until = (l == Level::Volledig).then_some(10_000 + 3600);
        store::level_set(&self.bron.0.lock().unwrap(), 1, l, until).unwrap();
    }
    fn schrijf_aanroepen(&self) -> Vec<String> {
        self.http.calls.lock().unwrap().iter().filter(|c| c.1.ends_with("/database/query")).map(|c| c.2.clone()).collect()
    }
    fn log(&self) -> Vec<store::Action> {
        store::actions(&self.bron.0.lock().unwrap(), 1, 50)
    }
    fn vragen(&self) -> Vec<ConfirmRequest> {
        self.ja.vragen.lock().unwrap().clone()
    }
}

// ---------------------------------------------------------------- niveaus

#[test]
fn voorzichtig_vraagt_bij_elke_schrijfactie_en_leest_vrij() {
    let r = rig();
    // Lezen: geen vraag, via het alleen-lezen-eindpunt.
    let l = r.e.run_sql(1, "db_run_sql", "SELECT * FROM klanten", Actor::Ai);
    assert_eq!(l.status, "uitgevoerd");
    assert!(r.vragen().is_empty());
    assert!(r.schrijf_aanroepen().is_empty());
    // Schrijven: vraagt, "nee" voert niets uit en wordt gelogd.
    r.ja.plan.lock().unwrap().push(false);
    let n = r.e.run_sql(1, "db_run_sql", "CREATE TABLE bestellingen (id int)", Actor::Ai);
    assert_eq!(n.status, "geweigerd");
    assert!(n.tekst.contains("Doe niet alsof het gelukt is"));
    assert!(r.schrijf_aanroepen().is_empty());
    let q = r.vragen();
    assert_eq!(q.len(), 1);
    assert_eq!((q[0].class, q[0].level, q[0].redenen.clone()), (2, Level::Voorzichtig, vec!["niveau"]));
    assert_eq!(q[0].changes[0].code, "tabel_toevoegen");
    assert_eq!(r.log()[0].status, "geweigerd");
    // "ja": uitgevoerd, met checkpoint en een log met "ongedaan maken".
    let ja = r.e.run_sql(1, "db_run_sql", "CREATE TABLE bestellingen (id int)", Actor::Ai);
    assert_eq!(ja.status, "uitgevoerd", "{}", ja.tekst);
    assert_eq!(r.haken.checkpoints.lock().unwrap().len(), 1);
    let uitgevoerd = r.schrijf_aanroepen();
    assert_eq!(uitgevoerd.len(), 1);
    assert!(uitgevoerd[0].contains("ENABLE ROW LEVEL SECURITY"), "RLS moet automatisch aan: {}", uitgevoerd[0]);
    assert!(ja.tekst.contains("RLS"));
    let log = r.log();
    assert_eq!((log[0].status.as_str(), log[0].kan_ongedaan), ("uitgevoerd", true));
    assert!(log[0].detail["schema_voor"].is_array(), "momentopname van het schema ontbreekt: {:?}", log[0].detail);
    assert_eq!(log[0].detail["checkpoint"], "abc1234");
}

#[test]
fn zelfstandig_staat_veilig_schrijven_toe_maar_vraagt_bij_gevaarlijk() {
    let r = rig();
    r.niveau(Level::Zelfstandig);
    *r.http.count.lock().unwrap() = 3;
    *r.http.rows.lock().unwrap() = vec![json!({"id":1,"naam":"a"}), json!({"id":2,"naam":"b"}), json!({"id":3,"naam":"c"})];
    assert_eq!(r.e.run_sql(1, "db_run_sql", "ALTER TABLE klanten ADD COLUMN telefoon text", Actor::Ai).status, "uitgevoerd");
    assert!(r.vragen().is_empty());
    // Gevaarlijk: vraag, met aantal rijen, verlies en een gemaakte back-up.
    let d = r.e.run_sql(1, "db_run_sql", "DELETE FROM klanten WHERE actief = false", Actor::Ai);
    assert_eq!(d.status, "uitgevoerd", "{}", d.tekst);
    let q = r.vragen();
    assert_eq!(q.len(), 1);
    assert_eq!((q[0].class, q[0].rijen, q[0].verlies, q[0].backup), (3, Some(3), true, "gemaakt"));
    assert_eq!(q[0].redenen, vec!["gevaarlijk"]);
    // De back-up staat lokaal en bevat de rijen; het log wijst ernaar en biedt "Maak ongedaan".
    let acties = r.log();
    let a = &acties[0];
    assert!(a.kan_ongedaan);
    let bestand = a.detail["back_up"][0]["bestand"].as_str().unwrap().to_string();
    assert!(std::fs::read_to_string(&bestand).unwrap().contains("\"naam\":\"b\""));
}

#[test]
fn ongedaan_maken_van_verwijderde_rijen_zet_ze_terug_na_bevestiging() {
    let r = rig();
    r.niveau(Level::Zelfstandig);
    *r.http.count.lock().unwrap() = 2;
    *r.http.rows.lock().unwrap() = vec![json!({"id":1}), json!({"id":2})];
    r.e.run_sql(1, "db_run_sql", "DELETE FROM klanten", Actor::Ai);
    let id = r.log()[0].id;
    r.ja.vragen.lock().unwrap().clear();
    let u = r.e.undo(1, id);
    assert_eq!(u.status, "uitgevoerd", "{}", u.tekst);
    // De gebruiker moest bevestigen (ook al is het niveau Zelfstandig).
    assert_eq!(r.vragen().len(), 1);
    assert_eq!(r.vragen()[0].actor, Actor::Gebruiker);
    let w = r.schrijf_aanroepen();
    assert!(w.last().unwrap().contains("jsonb_populate_recordset"), "{w:?}");
    assert!(r.log().iter().find(|a| a.id == id).unwrap().undone);
    // Twee keer ongedaan maken kan niet.
    assert_eq!(r.e.undo(1, id).status, "geweigerd");
}

#[test]
fn ongedaan_maken_van_een_nieuwe_tabel_haalt_hem_weg_maar_vraagt_eerst() {
    let r = rig();
    r.niveau(Level::Zelfstandig);
    r.e.run_sql(1, "db_run_sql", "CREATE TABLE t (id int)", Actor::Ai);
    let id = r.log()[0].id;
    let u = r.e.undo(1, id);
    assert_eq!(u.status, "uitgevoerd", "{}", u.tekst);
    assert!(r.schrijf_aanroepen().last().unwrap().contains("DROP TABLE IF EXISTS t"));
    assert_eq!(r.vragen().last().unwrap().class, 3); // het weghalen van een tabel is gevaarlijk
}

#[test]
fn volledige_controle_laat_gevaarlijk_toe_met_grenzen() {
    let r = rig();
    r.niveau(Level::Volledig);
    *r.http.count.lock().unwrap() = 5;
    *r.http.rows.lock().unwrap() = vec![json!({"id":1}); 5];
    assert_eq!(r.e.run_sql(1, "db_run_sql", "DELETE FROM klanten WHERE id < 6", Actor::Ai).status, "uitgevoerd");
    assert!(r.vragen().is_empty(), "weinig rijen met back-up: geen vraag");
    // Te veel rijen: toch vragen.
    *r.http.count.lock().unwrap() = 500;
    r.e.run_sql(1, "db_run_sql", "DELETE FROM klanten", Actor::Ai);
    assert_eq!(r.vragen().last().unwrap().redenen, vec!["veel_rijen"]);
    // Back-up niet mogelijk (te veel rijen): vragen en melden.
    *r.http.count.lock().unwrap() = 50;
    *r.http.rows.lock().unwrap() = vec![json!({"id":1}); BACKUP_MAX_ROWS + 1];
    r.e.run_sql(1, "db_run_sql", "DELETE FROM klanten WHERE x = 1", Actor::Ai);
    let q = r.vragen().last().unwrap().clone();
    assert!(q.redenen.contains(&"geen_backup"));
    assert_eq!(q.backup, "mislukt");
}

#[test]
fn volledige_controle_loopt_af_en_valt_terug_op_zelfstandig() {
    let r = rig();
    r.niveau(Level::Volledig);
    assert_eq!(r.e.level(1), Level::Volledig);
    r.tijd.store(10_000 + 3600, Ordering::SeqCst);
    assert_eq!(r.e.level(1), Level::Zelfstandig);
    // Het wordt ook bewaard.
    assert_eq!(r.e.link(1).unwrap().level, Level::Zelfstandig);
    assert_eq!(r.e.link(1).unwrap().full_until, None);
}

#[test]
fn volledige_controle_aanzetten_vraagt_een_getypte_bevestiging_en_heeft_een_einde() {
    let r = rig();
    assert_eq!(r.e.set_level(1, Level::Volledig, None), Err("bevestiging_ontbreekt"));
    assert_eq!(r.e.set_level(1, Level::Volledig, Some("ja")), Err("bevestiging_ontbreekt"));
    assert_eq!(r.e.level(1), Level::Voorzichtig);
    r.e.set_level(1, Level::Volledig, Some(" Volledig ")).unwrap();
    assert_eq!(r.e.level(1), Level::Volledig);
    assert_eq!(r.e.link(1).unwrap().full_until, Some(10_000 + 3600));
    r.e.set_full_duration(1, 600);
    r.e.set_level(1, Level::Volledig, Some("volledig")).unwrap();
    assert_eq!(r.e.link(1).unwrap().full_until, Some(10_000 + 600));
    r.e.set_level(1, Level::Voorzichtig, None).unwrap();
    assert_eq!(r.e.link(1).unwrap().full_until, None);
    assert_eq!(r.e.set_level(99, Level::Zelfstandig, None), Err("niet_gekoppeld"));
}

// ---------------------------------------------------------------- veiligheid van de database

#[test]
fn rls_uitzetten_en_beleid_voor_iedereen_worden_geweigerd_behalve_bij_volledige_controle() {
    for sql in ["ALTER TABLE klanten DISABLE ROW LEVEL SECURITY", "CREATE POLICY p ON klanten FOR ALL TO anon USING (true) WITH CHECK (true)"] {
        let r = rig();
        for l in [Level::Voorzichtig, Level::Zelfstandig] {
            r.niveau(l);
            let n = r.e.run_sql(1, "db_run_sql", sql, Actor::Ai);
            assert_eq!(n.status, "geweigerd", "{l:?} {sql}");
            assert!(n.tekst.starts_with("Geweigerd door veiligheidsregel"));
        }
        assert!(r.vragen().is_empty() && r.schrijf_aanroepen().is_empty());
        r.niveau(Level::Volledig);
        *r.http.count.lock().unwrap() = 0;
        let v = r.e.run_sql(1, "db_run_sql", sql, Actor::Ai);
        assert_eq!(v.status, "uitgevoerd", "{}", v.tekst);
        assert_eq!(r.log()[0].detail["waarschuwing"], true, "{sql}"); // waarschuwing in het log
    }
}

// ---------------------------------------------------------------- vangnet en grenzen

#[test]
fn schrijflimiet_per_minuut() {
    let r = rig();
    r.niveau(Level::Zelfstandig);
    for i in 0..10 {
        let x = r.e.run_sql(1, "db_run_sql", &format!("CREATE TABLE t{i} (id int)"), Actor::Ai);
        assert_eq!(x.status, "uitgevoerd", "{i}: {}", x.tekst);
    }
    let elf = r.e.run_sql(1, "db_run_sql", "CREATE TABLE t11 (id int)", Actor::Ai);
    assert_eq!(elf.status, "geweigerd");
    assert!(elf.tekst.contains("te veel wijzigingen per minuut"));
    r.tijd.fetch_add(61, Ordering::SeqCst);
    assert_eq!(r.e.run_sql(1, "db_run_sql", "CREATE TABLE t12 (id int)", Actor::Ai).status, "uitgevoerd");
}

#[test]
fn noodknop_tijdens_het_wachten_voert_niets_uit_en_zet_terug_naar_voorzichtig() {
    let r = rig();
    r.niveau(Level::Zelfstandig);
    *r.http.count.lock().unwrap() = 1;
    *r.http.rows.lock().unwrap() = vec![json!({"id":1})];
    let e = r.e.clone();
    *r.ja.tijdens.lock().unwrap() = Some(Box::new(move || e.emergency_stop(1)));
    let x = r.e.run_sql(1, "db_run_sql", "DELETE FROM klanten", Actor::Ai); // de gebruiker zegt "ja" maar drukte ook op de noodknop
    assert_eq!(x.status, "geweigerd");
    assert!(x.tekst.contains("noodknop"));
    assert!(r.schrijf_aanroepen().is_empty());
    assert_eq!(r.e.level(1), Level::Voorzichtig);
    assert_eq!(*r.haken.stops.lock().unwrap(), vec![1]);
    assert_eq!(r.log()[0].status, "afgebroken");
}

#[test]
fn herhaalde_dezelfde_fout_stopt_de_ai() {
    let r = rig();
    r.niveau(Level::Zelfstandig);
    for i in 0..3 {
        r.http.fail_write.lock().unwrap().push((400, "syntax error at or near \"x\"".into()));
        let x = r.e.run_sql(1, "db_run_sql", &format!("CREATE TABLE a{i} (id int)"), Actor::Ai);
        assert_eq!(x.status, "mislukt");
        if i < 2 {
            assert!(r.haken.stops.lock().unwrap().is_empty());
        } else {
            assert!(x.tekst.contains("gestopt"));
        }
    }
    assert_eq!(*r.haken.stops.lock().unwrap(), vec![1]);
    // Een gelukte actie zet de teller weer op nul.
    assert_eq!(r.e.run_sql(1, "db_run_sql", "CREATE TABLE ok1 (id int)", Actor::Ai).status, "uitgevoerd");
}

#[test]
fn een_fout_van_de_database_bevat_nooit_het_token() {
    let r = rig();
    r.niveau(Level::Zelfstandig);
    r.http.fail_write.lock().unwrap().push((400, format!("fout met sleutel {TOKEN} en sbp_andere_sleutel_999 en eyJhbGciOi.eyJyb2xlIjoi.abc")));
    let x = r.e.run_sql(1, "db_run_sql", "CREATE TABLE a (id int)", Actor::Ai);
    assert_eq!(x.status, "mislukt");
    let alles = format!("{x:?} {:?}", r.log());
    assert!(!alles.contains(TOKEN) && !alles.contains("sbp_andere") && !alles.contains("eyJhbGciOi"), "{alles}");
}

// ---------------------------------------------------------------- lezen

#[test]
fn readonly_tool_weigert_schrijfacties_en_meerdere_instructies() {
    let r = rig();
    for sql in ["DELETE FROM a", "SELECT 1; SELECT 2", "SELECT * FROM a FOR UPDATE", "SELECT pg_sleep(5)", "kapot"] {
        let x = r.e.readonly_query(1, sql, 10);
        assert_eq!(x.status, "geweigerd", "{sql}");
    }
    assert!(r.http.calls.lock().unwrap().iter().all(|c| !c.1.contains("/database/query")));
    let ok = r.e.readonly_query(1, "SELECT * FROM klanten", 10);
    assert_eq!(ok.status, "uitgevoerd");
    assert!(r.http.calls.lock().unwrap().last().unwrap().1.ends_with("/read-only"));
}

#[test]
fn resultaten_worden_begrensd() {
    let r = rig();
    // 300 rijen in het antwoord, maximaal 200 aan de AI.
    *r.http.rows.lock().unwrap() = (0..300).map(|i| json!({ "id": i })).collect();
    let _ = &r;
    let v = Value::Array((0..300).map(|i| json!({ "id": i })).collect());
    let (d, cut) = limit_value(&v, 200);
    assert!(cut);
    assert_eq!(d.as_array().unwrap().len(), 200);
}

#[test]
fn publieke_configuratie_bevat_nooit_de_geheime_sleutel() {
    let r = rig();
    let c = r.e.public_config(1);
    assert_eq!(c.status, "uitgevoerd");
    let d = c.data.unwrap();
    assert_eq!(d["url"], format!("https://{REF}.supabase.co"));
    assert_eq!(d["publiceerbare_sleutel"], "sb_publishable_OPENBAAR");
    let t = format!("{d} {}", c.tekst);
    assert!(!t.contains("GEHEIM") && !t.contains("sb_secret"));
}

#[test]
fn status_toont_gepauzeerd_en_zonder_koppeling_een_duidelijke_melding() {
    let r = rig();
    *r.http.status.lock().unwrap() = "INACTIVE".into();
    let s = r.e.status(1);
    assert_eq!(s.data.as_ref().unwrap()["gepauzeerd"], true);
    let n = r.e.run_sql(2, "db_run_sql", "CREATE TABLE a (id int)", Actor::Ai);
    assert_eq!(n.status, "geweigerd");
    assert!(n.tekst.contains("nog niet gekoppeld"));
}

// ---------------------------------------------------------------- kosten en sleutels

#[test]
fn project_maken_vraagt_altijd_een_kostenbevestiging_en_bewaart_het_wachtwoord_alleen_in_de_kluis() {
    for level in [Level::Voorzichtig, Level::Zelfstandig, Level::Volledig] {
        let r = rig();
        r.niveau(level);
        let x = r.e.create_project(1, "Nieuwe app", None, Actor::Ai);
        assert_eq!(x.status, "uitgevoerd", "{level:?} {}", x.tekst);
        let q = r.vragen();
        assert_eq!(q.len(), 1, "{level:?}");
        assert_eq!((q[0].class, q[0].redenen.clone()), (4, vec!["kosten"]));
        assert_eq!(q[0].kosten.as_ref().unwrap().plan, "gratis_plan");
        // Het wachtwoord staat in de kluis…
        let pass = r.kluis.get("connect/supabase/dbpass:nieuwproj1").unwrap().expect("wachtwoord in de kluis");
        assert_eq!(pass.len(), 32);
        // …en nergens anders.
        let alles = format!("{x:?} {:?} {:?} {:?}", r.log(), q, serde_json::to_string(&q));
        assert!(!alles.contains(&pass), "{level:?}");
        // De koppeling is gelegd, op Voorzichtig.
        let l = r.e.link(1).unwrap();
        assert_eq!((l.reference.as_str(), l.level), ("nieuwproj1", Level::Voorzichtig));
        // Het verzoek aan Supabase had de Europese regio en geen instance size.
        let post = r.http.calls.lock().unwrap().iter().find(|c| c.0 == "POST" && c.1.ends_with("/v1/projects")).unwrap().2.clone();
        assert!(post.contains("\"emea\"") && !post.contains("desired_instance_size") && post.contains(&pass));
    }
}

#[test]
fn project_maken_zonder_bevestiging_maakt_niets() {
    let r = rig();
    r.ja.plan.lock().unwrap().push(false);
    let x = r.e.create_project(1, "Nieuwe app", None, Actor::Ai);
    assert_eq!(x.status, "geweigerd");
    assert!(r.http.calls.lock().unwrap().iter().all(|c| !(c.0 == "POST" && c.1.ends_with("/v1/projects"))));
    assert_eq!(r.e.link(1).unwrap().reference, REF); // de oude koppeling blijft
}

#[test]
fn edge_geheimen_zijn_schrijfbaar_maar_nooit_leesbaar() {
    let r = rig();
    r.niveau(Level::Zelfstandig);
    r.http.secret_names.lock().unwrap().push("BESTAAND".into());
    // Nieuw geheim: vrij (veilig), de waarde gaat alleen naar Supabase.
    let n = r.e.set_edge_secret(1, "STRIPE_SLEUTEL", "stripe-supergeheim-1234");
    assert_eq!(n.status, "uitgevoerd");
    assert!(r.vragen().is_empty());
    assert!(!format!("{n:?} {:?}", r.log()).contains("SUPERGEHEIM"));
    // Overschrijven is gevaarlijk: vraagt, ook bij Zelfstandig.
    let o = r.e.set_edge_secret(1, "BESTAAND", "nieuwe-waarde-123");
    assert_eq!(o.status, "uitgevoerd");
    assert_eq!(r.vragen().len(), 1);
    assert_eq!(r.vragen()[0].changes[0].code, "geheim_overschrijven");
    assert!(!format!("{:?} {:?}", r.vragen(), r.log()).contains("nieuwe-waarde"));
    // De waarden die Supabase eventueel meegeeft bij het lijsten worden nooit doorgegeven.
    assert!(!format!("{o:?}").contains("WAARDE-NIET-TONEN"));
    // Ongeldige namen worden geweigerd.
    for slecht in ["SUPABASE_URL", "klein", "MET SPATIE", ""] {
        assert_eq!(r.e.set_edge_secret(1, slecht, "x").status, "geweigerd", "{slecht}");
    }
}

#[test]
fn inlog_instellingen_alleen_een_vaste_lijst_en_altijd_gevaarlijk() {
    let r = rig();
    r.niveau(Level::Zelfstandig);
    let slecht = r.e.configure_auth(1, &json!({ "jwt_secret": "x" }));
    assert_eq!(slecht.status, "geweigerd");
    assert_eq!(r.e.configure_auth(1, &json!({})).status, "geweigerd");
    let ok = r.e.configure_auth(1, &json!({ "site_url": "https://mijnapp.nl" }));
    assert_eq!(ok.status, "uitgevoerd", "{}", ok.tekst);
    assert_eq!(r.vragen().last().unwrap().class, 3);
}

#[test]
fn project_pauzeren_is_gevaarlijk_en_wakker_maken_kan_vrij_bij_zelfstandig() {
    let r = rig();
    r.niveau(Level::Zelfstandig);
    assert_eq!(r.e.pause_project(1).status, "uitgevoerd");
    assert_eq!(r.vragen().last().unwrap().changes[0].code, "project_pauzeren");
    let n = r.vragen().len();
    assert_eq!(r.e.restore_project(1).status, "uitgevoerd");
    assert_eq!(r.vragen().len(), n, "wakker maken vraagt niets bij Zelfstandig");
}

// ---------------------------------------------------------------- migraties

#[test]
fn voorstel_schrijft_een_bestand_met_tijdstempel_en_voert_niets_uit() {
    let r = rig();
    let x = r.e.propose_migration(1, "Bestellingen toevoegen!", "CREATE TABLE bestellingen (id int)");
    assert_eq!(x.status, "uitgevoerd", "{}", x.tekst);
    let map = r.haken.dir.path().join("supabase/migrations");
    let namen: Vec<String> = std::fs::read_dir(&map).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
    assert_eq!(namen.len(), 1);
    assert!(namen[0].starts_with("19700101") || namen[0].len() > 20, "{namen:?}");
    assert!(namen[0].ends_with("_bestellingen_toevoegen.sql"), "{namen:?}");
    let inhoud = std::fs::read_to_string(map.join(&namen[0])).unwrap();
    assert!(inhoud.contains("CREATE TABLE bestellingen") && inhoud.contains("ENABLE ROW LEVEL SECURITY"));
    // Niets uitgevoerd: geen enkele aanroep naar de database.
    assert!(r.http.calls.lock().unwrap().iter().all(|c| !c.1.contains("/database/query")));
    assert!(r.vragen().is_empty());
    // Opnieuw voorstellen met dezelfde naam overschrijft dat bestand.
    r.e.propose_migration(1, "bestellingen toevoegen", "CREATE TABLE bestellingen (id int, naam text)");
    assert_eq!(std::fs::read_dir(&map).unwrap().count(), 1);
    // Onleesbare SQL en lege namen worden geweigerd.
    assert_eq!(r.e.propose_migration(1, "x", "dit is geen sql").status, "geweigerd");
    assert_eq!(r.e.propose_migration(1, "!!!", "SELECT 1").status, "geweigerd");
}

#[cfg(unix)]
#[test]
fn migratiemap_die_naar_buiten_het_project_wijst_wordt_geweigerd() {
    let r = rig();
    let buiten = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(r.haken.dir.path().join("supabase")).unwrap();
    std::os::unix::fs::symlink(buiten.path(), r.haken.dir.path().join("supabase/migrations")).unwrap();
    let x = r.e.propose_migration(1, "x", "CREATE TABLE a (id int)");
    assert_eq!(x.status, "geweigerd");
    assert_eq!(std::fs::read_dir(buiten.path()).unwrap().count(), 0);
}

#[test]
fn migratie_toepassen_vraagt_bevestiging_op_het_juiste_niveau_en_terugdraaien_werkt() {
    let r = rig();
    let x = r.e.apply_migration(1, "tabel a", "CREATE TABLE a (id int)");
    assert_eq!(x.status, "uitgevoerd", "{}", x.tekst);
    assert_eq!(r.vragen().len(), 1); // Voorzichtig: vraagt
    assert_eq!(r.log()[0].tool, "db_apply_migration");
    let t = r.e.rollback_migration(1, "tabel a");
    assert_eq!(t.status, "uitgevoerd", "{}", t.tekst);
    assert!(r.schrijf_aanroepen().last().unwrap().contains("DROP TABLE IF EXISTS a"));
    // Niets meer terug te draaien.
    assert_eq!(r.e.rollback_migration(1, "tabel a").status, "geweigerd");
}

// ---------------------------------------------------------------- opslag, functies, koppelen

#[test]
fn opslagmap_is_altijd_privé_en_namen_worden_gecontroleerd() {
    let r = rig();
    r.niveau(Level::Zelfstandig);
    assert_eq!(r.e.manage_storage(1, "maken", "foto-s", true).status, "geweigerd");
    assert_eq!(r.e.manage_storage(1, "maken", "a'; drop table x; --", false).status, "geweigerd");
    assert_eq!(r.e.manage_storage(1, "maken", "foto-s", false).status, "uitgevoerd");
    assert!(r.schrijf_aanroepen().last().unwrap().contains("false)"));
    assert_eq!(r.e.manage_storage(1, "lijst", "", false).status, "uitgevoerd");
}

#[test]
fn functie_plaatsen_controleert_naam_en_inhoud() {
    let r = rig();
    r.niveau(Level::Zelfstandig);
    assert_eq!(r.e.deploy_function(1, "../x", "console.log(1)").status, "geweigerd");
    assert_eq!(r.e.deploy_function(1, "mijn-functie", "  ").status, "geweigerd");
    assert_eq!(r.e.deploy_function(1, "mijn-functie", "Deno.serve(() => new Response('hoi'))").status, "uitgevoerd");
    let c = r.http.calls.lock().unwrap().iter().find(|c| c.1.contains("/functions/deploy")).cloned().unwrap();
    assert!(c.1.ends_with("?slug=mijn-functie"));
}

#[test]
fn project_kiezen_en_ontkoppelen_raakt_supabase_niet() {
    let r = rig();
    assert_eq!(r.e.link_project(1, "../etc").status, "geweigerd");
    assert_eq!(r.e.link_project(1, REF).status, "uitgevoerd");
    r.kluis.set("connect/supabase/dbpass:abcdefghij", "wachtwoord").unwrap();
    let voor = r.http.calls.lock().unwrap().len();
    r.e.unlink(1);
    assert!(r.e.link(1).is_none());
    assert!(r.kluis.get("connect/supabase/dbpass:abcdefghij").unwrap().is_none());
    assert_eq!(r.http.calls.lock().unwrap().len(), voor, "ontkoppelen doet geen enkele aanroep naar Supabase");
}

#[test]
fn zonder_geldig_token_krijgt_de_ai_een_duidelijke_melding_en_wordt_de_koppeling_verlopen() {
    let r = rig();
    r.kluis.delete("connect/supabase/tokens").unwrap();
    let x = r.e.run_sql(1, "db_run_sql", "SELECT 1", Actor::Ai);
    assert_eq!(x.status, "mislukt");
    assert!(x.tekst.contains("niet gekoppeld"), "{}", x.tekst);
}

#[test]
fn gebruiker_in_het_scherm_bevestigt_altijd_ook_bij_volledige_controle() {
    let r = rig();
    r.niveau(Level::Volledig);
    *r.http.count.lock().unwrap() = 1;
    let x = r.e.run_sql(1, "gegevens_scherm", "UPDATE klanten SET naam = 'Piet' WHERE id = 1", Actor::Gebruiker);
    assert_eq!(x.status, "uitgevoerd", "{}", x.tekst);
    assert_eq!(r.vragen().len(), 1);
    assert_eq!(r.vragen()[0].actor, Actor::Gebruiker);
}

#[test]
fn de_vraag_aan_de_gebruiker_bevat_nooit_een_sleutel() {
    let r = rig();
    r.niveau(Level::Zelfstandig);
    *r.http.count.lock().unwrap() = 1;
    r.e.run_sql(1, "db_run_sql", "DELETE FROM klanten WHERE id = 1", Actor::Ai);
    let j = serde_json::to_string(&r.vragen()).unwrap();
    assert!(!j.contains(TOKEN) && !j.contains("sbp_"));
}
