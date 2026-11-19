use super::engine::{Actor, Doel, Engine, Hooks};
use super::*;
use crate::confirm::Scripted;
use crate::connect::config::Config;
use crate::connect::error::ConnectError;
use crate::connect::http::{Body, Http, Request, Response};
use crate::connect::manager::Manager;
use crate::connect::provider::Strategy;
use crate::connect::store::{ConnSource, MemMeta, Meta, MetaStore, Status};
use crate::connect::vault::{MemoryStore, SecretStore};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const TOKEN: &str = "vcp_geheim_testtoken_1234567890abc";

type Call = (String, String, String, Vec<(String, String)>);
type WachtHaak = Arc<Mutex<Option<Box<dyn Fn() + Send>>>>;

/// Een nagebootst Vercel: onthoudt alle verzoeken en antwoordt volgens een script.
#[derive(Default)]
struct Fake {
    calls: Mutex<Vec<Call>>,
    /// Statussen die opeenvolgende vragen naar een deployment teruggeven (daarna blijft de laatste staan).
    states: Mutex<Vec<&'static str>>,
    teller: AtomicUsize,
    gepolld: AtomicUsize,
    log: Mutex<Vec<String>>,
    taken: Mutex<Vec<String>>,
    fail_create_deployment: Mutex<Option<(u16, String)>>,
    promote_reply: Mutex<Option<(u16, String)>>,
    list: Mutex<Vec<(String, &'static str)>>,
    offline: Mutex<bool>,
}

impl Http for Fake {
    fn send(&self, req: Request) -> Result<Response, ConnectError> {
        if *self.offline.lock().unwrap() {
            return Err(ConnectError::Offline);
        }
        let body = match &req.body {
            Body::Json(j) => j.clone(),
            Body::Bytes { data, .. } => format!("<{} bytes>", data.len()),
            _ => String::new(),
        };
        assert!(req.url.starts_with("https://api.vercel.com/"), "alleen api.vercel.com: {}", req.url);
        assert!(req.headers.iter().any(|(k, v)| k == "Authorization" && v == &format!("Bearer {TOKEN}")), "token alleen in de header");
        self.calls.lock().unwrap().push((req.method.to_string(), req.url.clone(), body.clone(), req.headers.clone()));
        let ok = |s: u16, b: &str| Ok(Response { status: s, body: b.to_string() });
        let u = req.url.as_str();
        if u.ends_with("/v11/projects") {
            let v: serde_json::Value = serde_json::from_str(&body).unwrap();
            let n = v["name"].as_str().unwrap();
            if self.taken.lock().unwrap().iter().any(|t| t == n) {
                return ok(409, "{}");
            }
            return ok(200, &json!({ "id": format!("prj_{n}"), "name": n }).to_string());
        }
        if u.ends_with("/v2/files") {
            return ok(200, "{}");
        }
        if u.contains("/v13/deployments?") {
            if let Some((s, b)) = self.fail_create_deployment.lock().unwrap().take() {
                return ok(s, &b);
            }
            let n = self.teller.fetch_add(1, Ordering::SeqCst) + 1;
            self.gepolld.store(0, Ordering::SeqCst);
            return ok(200, &json!({ "id": format!("dpl_{n}"), "url": format!("app-{n}.vercel.app"), "readyState": "QUEUED" }).to_string());
        }
        if let Some(rest) = u.strip_prefix("https://api.vercel.com/v13/deployments/") {
            let st = self.states.lock().unwrap().clone();
            let i = self.gepolld.fetch_add(1, Ordering::SeqCst).min(st.len().saturating_sub(1));
            let state = st.get(i).copied().unwrap_or("READY");
            return ok(200, &json!({ "id": rest, "url": format!("app-{}.vercel.app", rest.trim_start_matches("dpl_")), "readyState": state, "alias": ["app.vercel.app"] }).to_string());
        }
        if u.contains("/cancel") {
            return ok(200, "{}");
        }
        if u.contains("/events") {
            let l: Vec<serde_json::Value> = self.log.lock().unwrap().iter().rev().map(|t| json!({ "text": t })).collect();
            return ok(200, &serde_json::Value::Array(l).to_string());
        }
        if u.contains("/v6/deployments") {
            let l: Vec<serde_json::Value> = self.list.lock().unwrap().iter().map(|(id, doel)| json!({ "uid": id, "url": format!("{id}.vercel.app"), "target": doel, "state": "READY", "created": 1_700_000_000_000i64 })).collect();
            return ok(200, &json!({ "deployments": l }).to_string());
        }
        if u.contains("/promote/") {
            if let Some((s, b)) = self.promote_reply.lock().unwrap().take() {
                return ok(s, &b);
            }
            return ok(200, "{}");
        }
        if u.contains("/env?upsert=true") {
            return ok(201, "{}");
        }
        ok(404, "{}")
    }
}

struct Haken {
    dir: tempfile::TempDir,
    checks: Mutex<Option<bool>>,
    kit: Mutex<bool>,
    beveiliging: Mutex<usize>,
    checkpoints: Mutex<Vec<String>>,
    stops: AtomicUsize,
    drempel: usize,
}
impl Hooks for Haken {
    fn project_dir(&self, _p: i64) -> Option<PathBuf> {
        Some(self.dir.path().to_path_buf())
    }
    fn checkpoint(&self, _p: i64, m: &str) -> Option<String> {
        self.checkpoints.lock().unwrap().push(m.to_string());
        Some("abc1234".into())
    }
    fn run_checks(&self, _p: i64) -> Option<bool> {
        *self.checks.lock().unwrap()
    }
    fn kit_blocks(&self, _p: i64) -> bool {
        *self.kit.lock().unwrap()
    }
    fn security_high(&self, _p: i64) -> usize {
        *self.beveiliging.lock().unwrap()
    }
    fn stop_ai(&self, _p: i64) {
        self.stops.fetch_add(1, Ordering::SeqCst);
    }
    fn loop_threshold(&self) -> usize {
        self.drempel
    }
    fn changed(&self, _p: i64) {}
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
    ja: Arc<Scripted>,
    haken: Arc<Haken>,
    kluis: Arc<MemoryStore>,
    bron: Arc<Bron>,
    meta: Arc<MemMeta>,
    tijd: Arc<AtomicI64>,
    /// Wordt aangeroepen bij elke wachttijd (om bijvoorbeeld te annuleren).
    bij_wachten: WachtHaak,
}

fn rig() -> Rig {
    let http = Arc::new(Fake { states: Mutex::new(vec!["BUILDING", "READY"]), ..Default::default() });
    let kluis = Arc::new(MemoryStore::default());
    let meta = Arc::new(MemMeta::default());
    meta.put(&Meta { provider: "vercel".into(), status: Status::Werkt, account: Some("joke".into()), error: None, method: Some(Strategy::TokenPlakken), connected_at: Some(1), expires_at: None });
    kluis.set("connect/vercel/tokens", &serde_json::to_string(&crate::connect::tokens::TokenSet::plain(TOKEN)).unwrap()).unwrap();
    let mgr = Manager::new(crate::connect::providers::all(), kluis.clone(), http.clone(), meta.clone(), Config::default(), Arc::new(|| {}));
    let mut conn = Connection::open_in_memory().unwrap();
    crate::db::migrate(&mut conn).unwrap();
    conn.execute("INSERT INTO projects (id, naam, pad, template) VALUES (1, 'Hovenier Joke', '/p', 'leeg')", []).unwrap();
    let bron = Arc::new(Bron(Mutex::new(conn)));
    let ja = Scripted::new();
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), "<h1>Hovenier Joke</h1>").unwrap();
    std::fs::write(dir.path().join("PROJECT.md"), "# x").unwrap();
    let haken = Arc::new(Haken { dir, checks: Mutex::new(Some(true)), kit: Mutex::new(false), beveiliging: Mutex::new(0), checkpoints: Mutex::new(vec![]), stops: AtomicUsize::new(0), drempel: 3 });
    let tijd = Arc::new(AtomicI64::new(10_000));
    let bij_wachten: WachtHaak = Arc::new(Mutex::new(None));
    let (t1, t2, bw) = (tijd.clone(), tijd.clone(), bij_wachten.clone());
    let e = Engine::new(
        mgr,
        kluis.clone(),
        Box::new(Gedeeld(bron.clone())),
        ja.clone(),
        haken.clone(),
        Arc::new(move || t1.load(Ordering::SeqCst)),
        Arc::new(move |d: Duration| {
            t2.fetch_add(d.as_secs() as i64, Ordering::SeqCst);
            if let Some(f) = bw.lock().unwrap().as_ref() {
                f();
            }
        }),
        Arc::new(|_, _, _, _| {}),
    );
    Rig { e, http, ja, haken, kluis, bron, meta, tijd, bij_wachten }
}

impl Rig {
    fn aanroepen(&self, deel: &str) -> Vec<Call> {
        self.http.calls.lock().unwrap().iter().filter(|c| c.1.contains(deel)).cloned().collect()
    }
    fn alle_sqlite_tekst(&self) -> String {
        let c = self.bron.0.lock().unwrap();
        let mut out = String::new();
        for t in ["vercel_links", "vercel_deployments", "vercel_env"] {
            let mut st = c.prepare(&format!("SELECT * FROM {t}")).unwrap();
            let n = st.column_count();
            let rows = st.query_map([], |r| Ok((0..n).map(|i| format!("{:?}", r.get_ref(i).unwrap())).collect::<Vec<_>>().join("|"))).unwrap();
            for r in rows {
                out.push_str(&r.unwrap());
                out.push('\n');
            }
        }
        out
    }
}

fn geheim() -> String {
    ["ghp", "_", &"k9Lm".repeat(9)].concat()
}

#[test]
fn een_voorbeeld_online_zetten_uploadt_bouwt_en_geeft_een_adres_zonder_extra_vraag() {
    let r = rig();
    let u = r.e.deploy(1, Doel::Voorbeeld, Actor::Gebruiker, false);
    assert_eq!((u.status, u.code.as_str()), ("uitgevoerd", "voorbeeld_online"), "{u:?}");
    assert_eq!(u.params["url"], "https://app-1.vercel.app");
    assert!(r.ja.asked.lock().unwrap().is_empty(), "een voorbeeld vraagt niets extra's");
    // Project aangemaakt (eerste keer), bestanden geüpload (de PROJECT.md en index.html), deployment zonder productie-doel.
    assert_eq!(r.aanroepen("/v11/projects").len(), 1);
    assert_eq!(r.aanroepen("/v2/files").len(), 2);
    let dep = r.aanroepen("/v13/deployments?")[0].2.clone();
    let v: serde_json::Value = serde_json::from_str(&dep).unwrap();
    assert!(v["target"].is_null(), "een voorbeeld heeft geen productie-doel: {v}");
    assert_eq!(v["files"].as_array().unwrap().len(), 2);
    assert!(v["files"][0]["sha"].as_str().unwrap().len() == 40);
    assert!(r.aanroepen("/v2/files")[0].3.iter().any(|(k, v)| k == "x-vercel-digest" && v.len() == 40));
    // Lokale versie vooraf en een regel in het logboek met het adres.
    assert_eq!(r.haken.checkpoints.lock().unwrap().len(), 1);
    let s = r.e.state(1);
    assert_eq!(s.voorbeeld.as_ref().and_then(|l| l.url.clone()).as_deref(), Some("https://app-1.vercel.app"));
    assert_eq!(s.voorbeeld.unwrap().checkpoint.as_deref(), Some("abc1234"));
    assert!(s.live.is_none());
}

#[test]
fn echt_online_zetten_vraagt_altijd_een_bevestiging_van_de_gebruiker() {
    let r = rig();
    // De gebruiker zonder bevestiging: niets gebeurt, er gaat niets naar Vercel.
    let u = r.e.deploy(1, Doel::Live, Actor::Gebruiker, false);
    assert_eq!((u.status, u.code.as_str()), ("geweigerd", "bevestiging_nodig"));
    assert!(r.http.calls.lock().unwrap().is_empty());
    // De AI: altijd de dialoog (zwaar), "nee" = niets online.
    r.e.ensure_link(1).unwrap();
    let calls = r.http.calls.lock().unwrap().len();
    r.ja.answer_with(false);
    let u = r.e.deploy(1, Doel::Live, Actor::Ai, false);
    assert_eq!((u.status, u.code.as_str()), ("geweigerd", "niet_bevestigd"));
    assert!(r.ja.asked.lock().unwrap()[0].zwaar && r.ja.asked.lock().unwrap()[0].soort == "vercel_live");
    assert_eq!(r.http.calls.lock().unwrap().len(), calls, "na 'nee' is er niets verstuurd");
    // "ja": productie-doel, en het vaste adres.
    r.ja.answer_with(true);
    let u = r.e.deploy(1, Doel::Live, Actor::Ai, false);
    assert_eq!((u.status, u.code.as_str()), ("uitgevoerd", "live_online"), "{u:?}");
    assert_eq!(u.params["url"], "https://app.vercel.app");
    let v: serde_json::Value = serde_json::from_str(&r.aanroepen("/v13/deployments?").last().unwrap().2).unwrap();
    assert_eq!(v["target"], "production");
    assert_eq!(r.haken.checkpoints.lock().unwrap().last().unwrap(), "Voor het echt online zetten");
    // De gebruiker mét bevestiging (zijn eigen dialoog) mag ook; de AI kan nooit zonder dialoog live.
    assert!(r.e.deploy(1, Doel::Live, Actor::Gebruiker, true).is_ok());
}

#[test]
fn zonder_eerste_keer_instellen_kan_de_ai_niets_online_zetten() {
    let r = rig();
    let u = r.e.deploy(1, Doel::Voorbeeld, Actor::Ai, false);
    assert_eq!(u.code, "niet_ingesteld");
    assert!(r.http.calls.lock().unwrap().is_empty());
}

#[test]
fn controles_die_niet_groen_zijn_houden_het_online_zetten_tegen() {
    let r = rig();
    *r.haken.checks.lock().unwrap() = Some(false);
    *r.haken.kit.lock().unwrap() = true;
    *r.haken.beveiliging.lock().unwrap() = 2;
    let u = r.e.deploy(1, Doel::Voorbeeld, Actor::Gebruiker, false);
    assert_eq!((u.status, u.code.as_str()), ("geweigerd", "controles"));
    let codes: Vec<&str> = u.params["problemen"].as_array().unwrap().iter().map(|p| p["code"].as_str().unwrap()).collect();
    assert_eq!(codes, vec!["controles_falen", "kit", "beveiliging"]);
    assert!(u.ai_tekst().contains("Herstel dat eerst"));
    assert!(r.http.calls.lock().unwrap().is_empty());
    *r.haken.checks.lock().unwrap() = None;
    *r.haken.kit.lock().unwrap() = false;
    *r.haken.beveiliging.lock().unwrap() = 0;
    assert_eq!(r.e.deploy(1, Doel::Voorbeeld, Actor::Gebruiker, false).params["problemen"][0]["code"], "controles_niet_gedraaid");
}

#[test]
fn geheimen_in_bestanden_worden_nooit_geupload_en_een_env_bestand_gaat_niet_mee() {
    let r = rig();
    std::fs::write(r.haken.dir.path().join(".env"), "A=1").unwrap();
    std::fs::create_dir_all(r.haken.dir.path().join("src")).unwrap();
    std::fs::write(r.haken.dir.path().join("src/a.ts"), format!("const t = '{}';", geheim())).unwrap();
    let u = r.e.deploy(1, Doel::Voorbeeld, Actor::Gebruiker, false);
    assert_eq!(u.code, "controles");
    let p = u.params["problemen"].as_array().unwrap().iter().find(|p| p["code"] == "geheimen").unwrap().clone();
    assert_eq!(p["bestanden"][0]["bestand"], "src/a.ts");
    assert!(!serde_json::to_string(&u).unwrap().contains(&geheim()));
    assert!(r.aanroepen("/v2/files").is_empty(), "er is niets geüpload");
    // Zonder de sleutel gaat het door, maar .env wordt nooit meegestuurd.
    std::fs::write(r.haken.dir.path().join("src/a.ts"), "export {}").unwrap();
    assert!(r.e.deploy(1, Doel::Voorbeeld, Actor::Gebruiker, false).is_ok());
    let v: serde_json::Value = serde_json::from_str(&r.aanroepen("/v13/deployments?")[0].2).unwrap();
    let namen: Vec<&str> = v["files"].as_array().unwrap().iter().map(|f| f["file"].as_str().unwrap()).collect();
    assert!(!namen.contains(&".env"), "{namen:?}");
}

#[test]
fn een_mislukte_bouw_geeft_een_samenvatting_zonder_geheimen() {
    let r = rig();
    *r.http.states.lock().unwrap() = vec!["BUILDING", "ERROR"];
    *r.http.log.lock().unwrap() = vec!["Running build".into(), format!("export TOKEN={}", geheim()), "Error: Cannot find module 'leaflet'".into(), "Error: Command \"npm run build\" exited with 1".into()];
    let u = r.e.deploy(1, Doel::Voorbeeld, Actor::Gebruiker, false);
    assert_eq!((u.status, u.code.as_str()), ("mislukt", "bouw_mislukt"), "{u:?}");
    assert_eq!(u.params["soort"], "module_ontbreekt");
    let tekst = serde_json::to_string(&u).unwrap();
    assert!(!tekst.contains(&geheim()) && tekst.contains("[geheim]"), "{tekst}");
    assert!(u.ai_tekst().contains("Doe niet alsof het gelukt is"));
    assert_eq!(r.e.state(1).laatste.unwrap().state, "ERROR");
    // De samenvatting is ook later op te vragen.
    assert_eq!(r.e.build_summary(1, None).unwrap()["soort"], "module_ontbreekt");
}

#[test]
fn dezelfde_fout_steeds_opnieuw_stopt_de_ai() {
    let r = rig();
    r.e.ensure_link(1).unwrap();
    *r.http.states.lock().unwrap() = vec!["ERROR"];
    *r.http.log.lock().unwrap() = vec!["Error: Cannot find module 'leaflet'".into()];
    for _ in 0..2 {
        assert_eq!(r.e.deploy(1, Doel::Voorbeeld, Actor::Ai, false).code, "bouw_mislukt");
    }
    let u = r.e.deploy(1, Doel::Voorbeeld, Actor::Ai, false);
    assert_eq!((u.status, u.code.as_str()), ("geweigerd", "lus"));
    assert_eq!(r.haken.stops.load(Ordering::SeqCst), 1);
    assert!(u.ai_tekst().contains("gestopt"));
}

#[test]
fn annuleren_stopt_de_bouw_en_meldt_dat_eerlijk() {
    let r = rig();
    *r.http.states.lock().unwrap() = vec!["BUILDING"];
    let e = r.e.clone();
    *r.bij_wachten.lock().unwrap() = Some(Box::new(move || e.cancel(1)));
    let u = r.e.deploy(1, Doel::Voorbeeld, Actor::Gebruiker, false);
    assert_eq!((u.status, u.code.as_str()), ("mislukt", "geannuleerd"));
    assert_eq!(r.aanroepen("/cancel").len(), 1);
    assert_eq!(r.e.state(1).laatste.unwrap().state, "CANCELED");
}

#[test]
fn een_bouw_die_te_lang_duurt_loopt_af_en_wordt_gestopt() {
    let r = rig();
    *r.http.states.lock().unwrap() = vec!["BUILDING"];
    let t0 = r.tijd.load(Ordering::SeqCst);
    let u = r.e.deploy(1, Doel::Voorbeeld, Actor::Gebruiker, false);
    assert_eq!((u.status, u.code.as_str()), ("mislukt", "time_out"));
    assert!(r.tijd.load(Ordering::SeqCst) - t0 >= engine::BUILD_TIMEOUT_SECS);
    assert_eq!(r.aanroepen("/cancel").len(), 1);
}

#[test]
fn fouten_van_vercel_worden_gewone_codes_en_een_ongeldig_token_zet_de_koppeling_op_verlopen() {
    for (status, code) in [(401, "ongeldig_token"), (403, "geen_rechten"), (429, "te_veel_verzoeken")] {
        let r = rig();
        *r.http.fail_create_deployment.lock().unwrap() = Some((status, "{}".into()));
        let u = r.e.deploy(1, Doel::Voorbeeld, Actor::Gebruiker, false);
        assert_eq!((u.status, u.code.as_str()), ("mislukt", code), "{status}");
        assert!(!serde_json::to_string(&u).unwrap().contains(TOKEN) && !u.ai_tekst().contains(TOKEN));
        if status == 401 {
            assert_eq!(r.meta.get("vercel").unwrap().status, Status::Verlopen);
        }
    }
    let r = rig();
    *r.http.offline.lock().unwrap() = true;
    assert_eq!(r.e.deploy(1, Doel::Voorbeeld, Actor::Gebruiker, false).code, "geen_internet");
}

#[test]
fn het_project_krijgt_een_vrije_naam_en_het_juiste_framework() {
    let r = rig();
    std::fs::write(r.haken.dir.path().join("package.json"), r#"{"devDependencies":{"vite":"1"}}"#).unwrap();
    r.http.taken.lock().unwrap().push("hovenier-joke".into());
    let l = r.e.ensure_link(1).unwrap();
    assert_eq!((l.name.as_str(), l.framework.as_deref()), ("hovenier-joke-2", Some("vite")));
    assert_eq!(r.aanroepen("/v11/projects").len(), 2);
    // Een tweede keer maakt niets nieuws.
    r.e.ensure_link(1).unwrap();
    assert_eq!(r.aanroepen("/v11/projects").len(), 2);
}

#[test]
fn ontbrekende_variabelen_blokkeren_live_en_waarschuwen_bij_een_voorbeeld() {
    let r = rig();
    std::fs::create_dir_all(r.haken.dir.path().join("src")).unwrap();
    std::fs::write(r.haken.dir.path().join("src/a.ts"), "const u = import.meta.env.VITE_WINKEL_NAAM;").unwrap();
    assert_eq!(r.e.state(1).ontbrekend, vec!["VITE_WINKEL_NAAM"]);
    let live = r.e.deploy(1, Doel::Live, Actor::Gebruiker, true);
    assert_eq!(live.code, "controles");
    assert_eq!(live.params["problemen"][0]["namen"][0], "VITE_WINKEL_NAAM");
    let voorbeeld = r.e.deploy(1, Doel::Voorbeeld, Actor::Gebruiker, false);
    assert!(voorbeeld.is_ok());
    assert_eq!(voorbeeld.params["waarschuwingen"][0]["code"], "variabelen_ontbreken");
    // Na het invoeren is het compleet.
    let al: Vec<String> = ["production", "preview"].iter().map(|s| s.to_string()).collect();
    assert!(r.e.env_set(1, "VITE_WINKEL_NAAM", "Joke", "openbaar", &al, "handmatig", true).is_ok());
    assert!(r.e.state(1).ontbrekend.is_empty());
    assert!(r.e.deploy(1, Doel::Live, Actor::Gebruiker, true).is_ok());
}

#[test]
fn waarden_van_variabelen_staan_alleen_in_de_kluis_en_komen_nergens_terug() {
    let r = rig();
    r.e.ensure_link(1).unwrap();
    std::fs::create_dir(r.haken.dir.path().join("api")).unwrap(); // een serverdeel
    let waarde = "supergeheime-waarde-987654";
    let al: Vec<String> = ["production", "preview", "development"].iter().map(|s| s.to_string()).collect();
    // Voor productie is een bevestiging nodig.
    assert_eq!(r.e.env_set(1, "STRIPE_SECRET_KEY", waarde, "server", &al, "handmatig", false).code, "bevestiging_nodig");
    let u = r.e.env_set(1, "STRIPE_SECRET_KEY", waarde, "server", &al, "handmatig", true);
    assert_eq!((u.status, u.code.as_str()), ("uitgevoerd", "env_gezet"), "{u:?}");
    // Kluis: ja. SQLite, uitkomst, status, lijst: nee.
    assert_eq!(r.kluis.get("vercel-env/1/STRIPE_SECRET_KEY").unwrap().as_deref(), Some(waarde));
    let alles = format!("{}{}{}{}", r.alle_sqlite_tekst(), serde_json::to_string(&u).unwrap(), serde_json::to_string(&r.e.env_list(1)).unwrap(), serde_json::to_string(&r.e.ai_status(1)).unwrap());
    assert!(!alles.contains(waarde), "waarde gelekt: {alles}");
    // Naar Vercel: in de body (als gevoelig, zonder development), nooit in de URL.
    let c = &r.aanroepen("/env?upsert=true")[0];
    let v: serde_json::Value = serde_json::from_str(&c.2).unwrap();
    assert_eq!((v["value"].as_str(), v["type"].as_str()), (Some(waarde), Some("sensitive")));
    assert_eq!(v["target"], json!(["production", "preview"]));
    assert!(!c.1.contains(waarde));
    // Verwijderen haalt hem uit de kluis.
    r.e.env_remove(1, "STRIPE_SECRET_KEY");
    assert_eq!(r.kluis.get("vercel-env/1/STRIPE_SECRET_KEY").unwrap(), None);
    assert!(r.e.env_list(1).is_empty());
}

#[test]
fn een_serversleutel_komt_nooit_in_een_clientvariabele() {
    let r = rig();
    let al: Vec<String> = vec!["production".into()];
    let sleutel = ["sb_secret", "_", "ABCDEFGHIJKLMNOPQRST"].concat();
    let u = r.e.env_set(1, "VITE_SUPABASE_KEY", &sleutel, "openbaar", &al, "handmatig", true);
    assert_eq!((u.code.as_str(), u.params["reden"].as_str()), ("env_ongeldig", Some("geheim_als_openbaar")));
    assert_eq!(r.e.env_set(1, "NEXT_PUBLIC_GEHEIM", "x", "server", &al, "handmatig", true).params["reden"], "server_met_openbare_naam");
    assert_eq!(r.e.env_set(1, "GEHEIM", "x", "server", &al, "handmatig", true).params["reden"], "geen_servergedeelte");
    assert_eq!(r.kluis.get("vercel-env/1/VITE_SUPABASE_KEY").unwrap(), None, "niets bewaard");
    assert!(r.aanroepen("/env").is_empty());
}

#[test]
fn de_ai_stuurt_alleen_door_wat_de_gebruiker_zelf_heeft_ingevoerd_en_productie_vraagt_een_dialoog() {
    let r = rig();
    r.e.ensure_link(1).unwrap();
    assert_eq!(r.e.env_push_for_ai(1, "ONBEKEND").code, "env_onbekend");
    // De gebruiker voert in (voor productie, bevestigd); de AI mag opnieuw doorsturen, maar via de dialoog.
    r.e.env_set(1, "SITE_NAAM", "Joke", "openbaar", &["production".to_string()], "handmatig", true);
    r.ja.answer_with(false);
    assert_eq!(r.e.env_push_for_ai(1, "SITE_NAAM").code, "niet_bevestigd");
    let n = r.aanroepen("/env?upsert=true").len();
    r.ja.answer_with(true);
    assert!(r.e.env_push_for_ai(1, "SITE_NAAM").is_ok());
    assert_eq!(r.aanroepen("/env?upsert=true").len(), n + 1);
    // Voor alleen "preview" geen dialoog.
    r.e.env_set(1, "ANDER", "x", "openbaar", &["preview".to_string()], "handmatig", false);
    let gevraagd = r.ja.asked.lock().unwrap().len();
    assert!(r.e.env_push_for_ai(1, "ANDER").is_ok());
    assert_eq!(r.ja.asked.lock().unwrap().len(), gevraagd);
}

#[test]
fn terugdraaien_is_altijd_bevestigd_en_eerlijk_over_het_gratis_plan() {
    let r = rig();
    r.e.ensure_link(1).unwrap();
    *r.http.list.lock().unwrap() = vec![("dpl_9".into(), "production"), ("dpl_8".into(), "production")];
    assert_eq!(r.e.rollback(1, "dpl_8", Actor::Gebruiker, false).code, "bevestiging_nodig");
    assert!(r.aanroepen("/promote/").is_empty());
    assert_eq!(r.e.rollback(1, "dpl_8", Actor::Gebruiker, true).code, "teruggezet");
    assert_eq!(r.aanroepen("/promote/").len(), 1);
    // Een versie die niet bij dit project hoort, wordt nooit gebruikt.
    assert_eq!(r.e.rollback(1, "dpl_van_een_ander", Actor::Gebruiker, true).code, "niet_gevonden");
    assert_eq!(r.aanroepen("/promote/").len(), 1);
    // AI: altijd de dialoog.
    r.ja.answer_with(false);
    assert_eq!(r.e.rollback(1, "dpl_8", Actor::Ai, false).code, "niet_bevestigd");
    // Gratis plan: verder terug dan de vorige kan niet.
    *r.http.promote_reply.lock().unwrap() = Some((403, r#"{"error":{"message":"To rollback further than the previous production deployment, upgrade to pro."}}"#.into()));
    let u = r.e.rollback(1, "dpl_8", Actor::Gebruiker, true);
    assert_eq!((u.status, u.code.as_str()), ("mislukt", "rollback_pro"));
    assert!(u.ai_tekst().contains("gratis plan"));
    // De lijst met eerdere versies.
    let l = r.e.deployments(1).unwrap();
    assert_eq!((l.len(), l[0]["doel"].as_str()), (2, Some("production")));
}

#[test]
fn domeinen_koppelen_geeft_door_wat_vercel_vraagt() {
    let r = rig();
    r.e.ensure_link(1).unwrap();
    assert!(r.e.domain_add(1, "geen domein").is_err());
    assert!(r.e.domain_add(1, "../x.nl").is_err());
}

#[test]
fn niets_lekt_het_token_staat_nergens_en_alleen_api_vercel_com_wordt_gebruikt() {
    let r = rig();
    assert!(r.e.deploy(1, Doel::Voorbeeld, Actor::Gebruiker, false).is_ok());
    let alles = format!("{}{}{}", serde_json::to_string(&r.e.state(1)).unwrap(), r.alle_sqlite_tekst(), r.e.ai_status(1));
    assert!(!alles.contains(TOKEN));
    for f in std::fs::read_dir(r.haken.dir.path()).unwrap().flatten() {
        if f.path().is_file() {
            assert!(!std::fs::read_to_string(f.path()).unwrap_or_default().contains(TOKEN));
        }
    }
    for c in r.http.calls.lock().unwrap().iter() {
        assert!(!c.1.contains(TOKEN) && !c.2.contains(TOKEN));
    }
    for code in ["voorbeeld_online", "live_online", "niet_ingesteld", "niet_bevestigd", "bevestiging_nodig", "controles", "bouw_mislukt", "geannuleerd", "time_out", "lus", "plan_modus", "bezig", "env_gezet", "env_onbekend", "teruggezet", "rollback_pro", "geen_internet", "ongeldig_token", "geen_rechten", "te_veel_verzoeken"] {
        let t = Uitkomst::nee(code, json!({ "url": "https://x.vercel.app", "samenvatting": "iets" })).ai_tekst();
        assert!(!t.is_empty() && !t.contains(TOKEN), "{code}");
    }
}

#[test]
fn flutter_en_lege_projecten_worden_eerlijk_geweigerd() {
    let r = rig();
    std::fs::remove_file(r.haken.dir.path().join("index.html")).unwrap();
    assert_eq!(r.e.deploy(1, Doel::Voorbeeld, Actor::Gebruiker, false).code, "niets_om_te_zetten");
    std::fs::write(r.haken.dir.path().join("pubspec.yaml"), "name: x\nflutter:\n").unwrap();
    assert_eq!(r.e.deploy(1, Doel::Voorbeeld, Actor::Gebruiker, false).code, "flutter");
}
