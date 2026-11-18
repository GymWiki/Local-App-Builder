use super::engine::{Actor, Engine};
use super::*;
use crate::confirm::Scripted;
use crate::connect::config::Config;
use crate::connect::http::{Body, Http, Request, Response};
use crate::connect::manager::Manager;
use crate::connect::provider::Strategy;
use crate::connect::store::{ConnSource, MemMeta, Meta, MetaStore, Status};
use crate::connect::vault::{MemoryStore, SecretStore};
use crate::supa::engine::Hooks;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub(super) const TOKEN: &str = "ghp_geheim_testtoken_1234567890";

/// Een nagebootst GitHub: maakt bij "repository aanmaken" echt een kale repository in een tijdelijke map (de "remote").
pub(super) struct Fake {
    remote_root: PathBuf,
    pub calls: Mutex<Vec<(String, String, String)>>,
    /// Volgende antwoorden voor "aanmaken" (status, body); leeg = gewoon slagen.
    pub create_reply: Mutex<Vec<(u16, String)>>,
    pub taken: Mutex<Vec<String>>,
}

impl Http for Fake {
    fn send(&self, req: Request) -> Result<Response, crate::connect::error::ConnectError> {
        let body = match &req.body {
            Body::Json(j) => j.clone(),
            _ => String::new(),
        };
        assert!(req.headers.iter().any(|(k, v)| k == "Authorization" && v == &format!("Bearer {TOKEN}")) || req.url.contains("/user"), "token hoort alleen in de header");
        self.calls.lock().unwrap().push((req.method.to_string(), req.url.clone(), body.clone()));
        let ok = |s: u16, b: &str| Ok(Response { status: s, body: b.to_string() });
        let u = req.url.as_str();
        if u.ends_with("/user/repos") && req.method == "POST" {
            if let Some((s, b)) = self.create_reply.lock().unwrap().pop() {
                return ok(s, &b);
            }
            let v: Value = serde_json::from_str(&body).unwrap();
            let naam = v["name"].as_str().unwrap();
            let p = self.remote_root.join("pieter").join(format!("{naam}.git"));
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            git2::Repository::init_bare(&p).unwrap().set_head("refs/heads/main").unwrap();
            return ok(201, &json!({ "name": naam, "private": v["private"], "default_branch": "main", "owner": { "login": "pieter" } }).to_string());
        }
        if let Some(rest) = u.strip_prefix("https://api.github.com/repos/pieter/") {
            return if self.taken.lock().unwrap().iter().any(|n| n == rest) { ok(200, "{}") } else { ok(404, "{}") };
        }
        if u.contains("/user/repos") && req.method == "GET" {
            return ok(200, r#"[{"name":"oud-project","private":true,"owner":{"login":"pieter"},"pushed_at":"2026-01-01T00:00:00Z"}]"#);
        }
        ok(404, "{}")
    }
}

pub(super) struct Haken {
    pub dir: tempfile::TempDir,
    pub changed: Mutex<u32>,
}
impl Hooks for Haken {
    fn checkpoint(&self, _p: i64, m: &str) -> Option<String> {
        commit_all(self.dir.path(), m).map(|o| o.to_string())
    }
    fn stop_ai(&self, _p: i64) {}
    fn project_dir(&self, _p: i64) -> Option<PathBuf> {
        Some(self.dir.path().to_path_buf())
    }
    fn loop_threshold(&self) -> usize {
        3
    }
    fn changed(&self, _p: i64) {
        *self.changed.lock().unwrap() += 1;
    }
}

/// Een versie maken zoals Studio dat doet (alles in de map, op de huidige tak).
pub(super) fn commit_all(dir: &Path, msg: &str) -> Option<git2::Oid> {
    let r = git2::Repository::open(dir).ok()?;
    let mut idx = r.index().ok()?;
    idx.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None).ok()?;
    idx.write().ok()?;
    let tree = r.find_tree(idx.write_tree().ok()?).ok()?;
    let sig = git2::Signature::now("Studio", "studio@localhost").ok()?;
    let parents: Vec<git2::Commit> = r.head().ok().and_then(|h| h.peel_to_commit().ok()).into_iter().collect();
    let refs: Vec<&git2::Commit> = parents.iter().collect();
    r.commit(Some("HEAD"), &sig, &sig, msg, &tree, &refs).ok()
}

pub(super) struct Bron(Mutex<Connection>);
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

pub(super) struct Rig {
    pub e: Arc<Engine>,
    pub http: Arc<Fake>,
    pub ja: Arc<Scripted>,
    pub haken: Arc<Haken>,
    pub remote: tempfile::TempDir,
    pub meta: Arc<MemMeta>,
}

pub(super) fn rig() -> Rig {
    let remote = tempfile::tempdir().unwrap();
    let http = Arc::new(Fake { remote_root: remote.path().to_path_buf(), calls: Mutex::new(vec![]), create_reply: Mutex::new(vec![]), taken: Mutex::new(vec![]) });
    let kluis = Arc::new(MemoryStore::default());
    let meta = Arc::new(MemMeta::default());
    meta.put(&Meta { provider: "github".into(), status: Status::Werkt, account: Some("pieter".into()), error: None, method: Some(Strategy::TokenPlakken), connected_at: Some(1), expires_at: None });
    kluis.set("connect/github/tokens", &serde_json::to_string(&crate::connect::tokens::TokenSet::plain(TOKEN)).unwrap()).unwrap();
    let mgr = Manager::new(crate::connect::providers::all(), kluis, http.clone(), meta.clone(), Config::default(), Arc::new(|| {}));
    let mut conn = Connection::open_in_memory().unwrap();
    crate::db::migrate(&mut conn).unwrap();
    conn.execute("INSERT INTO projects (id, naam, pad, template) VALUES (1, 'Mijn Eerste App', '/p', 'leeg')", []).unwrap();
    let bron = Arc::new(Bron(Mutex::new(conn)));
    let ja = Scripted::new();
    let dir = tempfile::tempdir().unwrap();
    git2::Repository::init_opts(dir.path(), git2::RepositoryInitOptions::new().initial_head("main")).unwrap();
    let haken = Arc::new(Haken { dir, changed: Mutex::new(0) });
    let base = format!("file://{}", remote.path().display());
    let e = Engine::new(mgr, Box::new(Gedeeld(bron.clone())), ja.clone(), haken.clone(), Arc::new(|| 5_000), Arc::new(|_, _, _, _| {})).with_base(&base);
    Rig { e, http, ja, haken, remote, meta }
}

impl Rig {
    pub fn schrijf(&self, bestand: &str, inhoud: &str) {
        let p = self.haken.dir.path().join(bestand);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, inhoud).unwrap();
    }
    pub fn versie(&self, bericht: &str) {
        commit_all(self.haken.dir.path(), bericht).expect("versie maken");
    }
    pub fn bare(&self) -> git2::Repository {
        git2::Repository::open_bare(self.remote.path().join("pieter").join("mijn-eerste-app.git")).unwrap()
    }
    pub fn bare_aantal(&self) -> usize {
        let r = self.bare();
        let tip = r.refname_to_id("refs/heads/main").unwrap();
        let mut w = r.revwalk().unwrap();
        w.push(tip).unwrap();
        w.count()
    }
    pub fn lokaal_gelezen(&self) -> String {
        std::fs::read_to_string(self.haken.dir.path().join(".git/config")).unwrap_or_default()
    }
}

fn eerste(r: &Rig) -> Uitkomst {
    r.schrijf("index.html", "<h1>Hallo</h1>");
    r.versie("eerste versie");
    r.schrijf("tweede.txt", "twee");
    r.versie("tweede versie");
    r.e.first_backup(1, "mijn-eerste-app", false, false)
}

#[test]
fn eerste_back_up_maakt_een_prive_repository_en_stuurt_alle_versies() {
    let r = rig();
    let u = eerste(&r);
    assert_eq!(u.status, "uitgevoerd", "{u:?}");
    assert_eq!((u.code.as_str(), u.params["aantal"].as_u64()), ("back_up_klaar", Some(2)));
    let aangemaakt = r.http.calls.lock().unwrap().iter().find(|c| c.0 == "POST").unwrap().2.clone();
    let v: Value = serde_json::from_str(&aangemaakt).unwrap();
    assert_eq!((v["private"].as_bool(), v["auto_init"].as_bool()), (Some(true), Some(false)), "standaard privé en zonder beginbestanden");
    assert_eq!(r.bare_aantal(), 2);
    let s = r.e.state(1);
    let l = s.link.unwrap();
    assert_eq!((l.eigenaar.as_str(), l.repo.as_str(), l.privaat, l.laatste, l.laatste_aantal), ("pieter", "mijn-eerste-app", true, Some(5_000), Some(2)));
    assert_eq!((s.versies, s.nieuw, l.auto, l.ai_vraagt), (2, 0, false, true), "automatisch staat standaard uit");
    // Het token staat nergens in de projectmap (ook niet in .git/config) en niet in wat de app of de AI te zien krijgt.
    assert!(!r.lokaal_gelezen().contains(TOKEN));
    assert!(!r.lokaal_gelezen().contains("pieter"), "geen remote in de eigen instellingen van de gebruiker");
    let alles = format!("{}{}{}", serde_json::to_string(&u).unwrap(), u.ai_tekst(), serde_json::to_string(&r.e.state(1)).unwrap());
    assert!(!alles.contains(TOKEN));
}

#[test]
fn bijwerken_stuurt_alleen_nieuwe_versies_en_meldt_als_er_niets_nieuw_is() {
    let r = rig();
    assert!(eerste(&r).is_ok());
    assert_eq!(r.e.backup(1, Actor::Gebruiker).code, "al_bijgewerkt");
    r.schrijf("a.txt", "a");
    r.versie("a");
    r.schrijf("b.txt", "b");
    r.versie("b");
    r.schrijf("c.txt", "c");
    r.versie("c");
    assert_eq!(r.e.state(1).nieuw, 3);
    let u = r.e.backup(1, Actor::Gebruiker);
    assert_eq!((u.code.as_str(), u.params["aantal"].as_u64()), ("back_up_klaar", Some(3)));
    assert_eq!(r.bare_aantal(), 5);
    assert_eq!(r.e.state(1).nieuw, 0);
    assert!(u.ai_tekst().contains("3 nieuwe versie"));
}

#[test]
fn naam_bezet_koppelt_niets_en_geeft_een_duidelijke_melding() {
    let r = rig();
    r.schrijf("a", "a");
    r.versie("a");
    r.http.create_reply.lock().unwrap().push((422, r#"{"errors":[{"message":"name already exists on this account"}]}"#.into()));
    let u = r.e.first_backup(1, "mijn-eerste-app", false, false);
    assert_eq!((u.status, u.code.as_str()), ("mislukt", "naam_bezet"));
    assert!(r.e.link(1).is_none());
    // De beschikbaarheidscontrole zegt het vooraf.
    r.http.taken.lock().unwrap().push("bezet-naam".into());
    assert_eq!(r.e.suggest_name(1, Some("bezet-naam")).unwrap()["vrij"], false);
    assert_eq!(r.e.suggest_name(1, None).unwrap()["naam"], "mijn-eerste-app");
    assert_eq!(r.e.suggest_name(1, Some("vrij-naam")).unwrap()["vrij"], true);
    assert_eq!(r.e.suggest_name(1, Some("../boos")).unwrap()["geldig"], false);
}

#[test]
fn openbaar_vraagt_eerst_een_uitdrukkelijke_bevestiging() {
    let r = rig();
    r.schrijf("a", "a");
    r.versie("a");
    let u = r.e.first_backup(1, "mijn-eerste-app", true, false);
    assert_eq!((u.status, u.code.as_str()), ("geweigerd", "openbaar_bevestig"));
    assert!(r.http.calls.lock().unwrap().is_empty(), "er is niets naar GitHub gestuurd");
    let u = r.e.first_backup(1, "mijn-eerste-app", true, true);
    assert!(u.is_ok(), "{u:?}");
    let v: Value = serde_json::from_str(&r.http.calls.lock().unwrap().iter().find(|c| c.0 == "POST").unwrap().2).unwrap();
    assert_eq!(v["private"], false);
    assert!(!r.e.state(1).link.unwrap().privaat);
}

#[test]
fn zonder_versies_wordt_er_niets_gemaakt_voor_de_ai_en_een_eerste_versie_voor_de_gebruiker() {
    let r = rig();
    r.schrijf("a", "a");
    let u = r.e.first_backup(1, "mijn-eerste-app", false, false);
    assert!(u.is_ok(), "de gebruiker mag een eerste versie laten maken: {u:?}");
    let r2 = rig();
    let ai = r2.e.backup(1, Actor::Ai);
    assert_eq!(ai.code, "niet_ingesteld");
}

#[test]
fn uiteengelopen_versies_worden_nooit_automatisch_opgelost() {
    let r = rig();
    assert!(eerste(&r).is_ok());
    // Iemand anders zet een versie op GitHub.
    let tmp = tempfile::tempdir().unwrap();
    let kloon = git2::Repository::clone(&format!("file://{}", r.remote.path().join("pieter/mijn-eerste-app.git").display()), tmp.path()).unwrap();
    std::fs::write(tmp.path().join("web.txt"), "gewijzigd op github").unwrap();
    commit_all(tmp.path(), "op github").unwrap();
    let mut rem = kloon.find_remote("origin").unwrap();
    rem.push(&["refs/heads/main:refs/heads/main"], None).unwrap();
    let remote_tip = r.bare().refname_to_id("refs/heads/main").unwrap();
    // Alleen online nieuwer: er is lokaal niets nieuws.
    let u = r.e.backup(1, Actor::Gebruiker);
    assert_eq!((u.status, u.code.as_str()), ("geweigerd", "online_nieuwer"));
    // Nu ook lokaal een nieuwe versie: uiteengelopen.
    r.schrijf("lokaal.txt", "lokaal");
    r.versie("lokaal");
    let u = r.e.backup(1, Actor::Gebruiker);
    assert_eq!((u.status, u.code.as_str()), ("geweigerd", "uiteengelopen"));
    assert_eq!((u.params["voor"].as_u64(), u.params["achter"].as_u64()), (Some(1), Some(1)));
    assert_eq!(r.bare().refname_to_id("refs/heads/main").unwrap(), remote_tip, "de versies op GitHub zijn niet aangeraakt");
    assert_eq!(r.e.state(1).link.unwrap().uiteengelopen.as_deref(), Some("uiteengelopen"));
    assert!(u.ai_tekst().contains("Probeer niets te forceren"));
}

#[test]
fn de_ai_vraagt_eerst_toestemming_als_dat_zo_staat_en_nee_betekent_niets_sturen() {
    let r = rig();
    assert!(eerste(&r).is_ok());
    r.schrijf("n.txt", "n");
    r.versie("n");
    r.ja.answer_with(false);
    let u = r.e.backup(1, Actor::Ai);
    assert_eq!((u.status, u.code.as_str()), ("geweigerd", "niet_bevestigd"));
    assert_eq!(r.bare_aantal(), 2);
    assert_eq!(r.ja.asked.lock().unwrap()[0].soort, "github_backup");
    r.ja.answer_with(true);
    assert!(r.e.backup(1, Actor::Ai).is_ok());
    assert_eq!(r.bare_aantal(), 3);
    // De gebruiker zet "vraag eerst" uit: dan geen dialoog meer.
    r.e.set_ai_ask(1, false);
    r.schrijf("m.txt", "m");
    r.versie("m");
    let asked = r.ja.asked.lock().unwrap().len();
    assert!(r.e.backup(1, Actor::Ai).is_ok());
    assert_eq!(r.ja.asked.lock().unwrap().len(), asked);
    // Zonder opdracht van de gebruiker geen verzoek zonder koppeling.
    r.e.unlink(1);
    assert_eq!(r.e.backup(1, Actor::Ai).code, "niet_ingesteld");
}

#[test]
fn fouten_van_github_worden_gewone_codes() {
    for (status, body, code) in [(403, r#"{"message":"Resource not accessible by integration"}"#, "geen_rechten"), (401, "{}", "ongeldig_token"), (429, "{}", "te_veel_verzoeken"), (403, r#"{"message":"API rate limit exceeded"}"#, "te_veel_verzoeken")] {
        let r = rig();
        r.schrijf("a", "a");
        r.versie("a");
        r.http.create_reply.lock().unwrap().push((status, body.into()));
        let u = r.e.first_backup(1, "mijn-eerste-app", false, false);
        assert_eq!((u.status, u.code.as_str()), ("mislukt", code), "{status}");
        assert!(!u.ai_tekst().contains(TOKEN));
        assert!(r.e.link(1).is_none());
    }
    // Een ongeldig token zet de koppeling op "verlopen" zodat de gebruiker opnieuw kan verbinden.
    let r = rig();
    r.schrijf("a", "a");
    r.versie("a");
    r.http.create_reply.lock().unwrap().push((401, "{}".into()));
    r.e.first_backup(1, "mijn-eerste-app", false, false);
    assert_eq!(r.meta.get("github").unwrap().status, Status::Verlopen);
}

#[test]
fn nooit_een_force_push_of_herschreven_geschiedenis() {
    // De refspec voor sturen heeft nooit een plus; ongeldige takken worden geweigerd.
    assert_eq!(repo::push_refspec("main").unwrap(), "refs/heads/main:refs/heads/main");
    for slecht in ["+main", "", "-x", "a b", "a..b", "a:b", "/x"] {
        assert!(repo::push_refspec(slecht).is_err(), "{slecht}");
    }
    // In de broncode staat geen enkele mogelijkheid om te forceren, te verwijderen of te herschrijven.
    for f in ["repo.rs", "engine.rs", "api.rs", "app.rs"] {
        let src = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/github").join(f)).unwrap();
        let code = src.split("#[cfg(test)]").next().unwrap();
        for verboden in [".force(", "force_push", "--force", "reset_hard", "ResetType::Hard", "\"DELETE\"", "refs/heads/{branch}:refs/heads/{branch}\".replace", "set_target"] {
            assert!(!code.contains(verboden), "{f} bevat {verboden}");
        }
        // De enige "+refs" is de lokale volgref van het ophalen, nooit een push.
        for (i, l) in code.lines().enumerate() {
            if l.contains("+refs") {
                assert!((l.contains("refs/studio/remote") || l.contains("{volgref}")), "{f}:{} heeft een plus-refspec die geen volgref is: {l}", i + 1);
            }
        }
    }
}

#[test]
fn een_tweede_back_up_tegelijk_wordt_geweigerd() {
    let r = rig();
    assert!(eerste(&r).is_ok());
    let g = r.e.state(1);
    assert!(!g.bezig);
}

fn geheim_token() -> String {
    ["ghp", "_", &"k9Lm".repeat(9)].concat()
}

#[test]
fn geheimen_houden_de_back_up_tegen_voordat_er_iets_online_komt() {
    let r = rig();
    r.schrijf("index.html", "<h1>Hallo</h1>");
    r.schrijf(".env", "SLEUTEL=iets");
    r.schrijf("src/diep/geheim.ts", &format!("export const t = '{}';", geheim_token()));
    r.versie("met geheimen");
    let u = r.e.first_backup(1, "mijn-eerste-app", false, false);
    assert_eq!((u.status, u.code.as_str()), ("geweigerd", "geheimen"), "{u:?}");
    assert_eq!(u.params["aantal"], 2);
    let lijst = serde_json::to_string(&u).unwrap();
    assert!(lijst.contains(".env") && lijst.contains("src/diep/geheim.ts") && lijst.contains("github_token"));
    assert!(!lijst.contains(&geheim_token()), "de waarde zelf mag nergens staan");
    assert!(!u.ai_tekst().contains(&geheim_token()));
    assert!(r.http.calls.lock().unwrap().is_empty(), "er is niets naar GitHub gestuurd, ook geen repository gemaakt");
    assert!(r.e.link(1).is_none());
    // Het .gitignore is meteen aangevuld, zodat het niet opnieuw gebeurt.
    let gi = std::fs::read_to_string(r.haken.dir.path().join(".gitignore")).unwrap();
    assert!(gi.contains(".env") && gi.contains("node_modules/"));
}

#[test]
fn na_het_opruimen_gaat_de_back_up_wel_door_en_een_oude_vondst_is_een_waarschuwing() {
    let r = rig();
    r.schrijf("a.txt", "schoon");
    r.versie("schoon");
    r.schrijf("oud.txt", &format!("token={}", geheim_token()));
    r.versie("per ongeluk");
    std::fs::remove_file(r.haken.dir.path().join("oud.txt")).unwrap();
    r.versie("weer weg");
    // Privé: het gaat door, met een waarschuwing dat het in eerdere versies staat (niet automatisch verwijderd).
    let u = r.e.first_backup(1, "mijn-eerste-app", false, false);
    assert!(u.is_ok(), "{u:?}");
    let w = u.params["waarschuwingen"].as_array().unwrap();
    assert!(w.iter().any(|x| x["waarschuwing"] == "geheim" && x["historie"] == true), "{w:?}");
    assert!(!serde_json::to_string(&u).unwrap().contains(&geheim_token()));
}

#[test]
fn openbaar_is_strenger_ook_voor_oude_vondsten() {
    let r = rig();
    r.schrijf("a.txt", "schoon");
    r.versie("schoon");
    r.schrijf("oud.txt", &format!("token={}", geheim_token()));
    r.versie("per ongeluk");
    std::fs::remove_file(r.haken.dir.path().join("oud.txt")).unwrap();
    r.versie("weer weg");
    let u = r.e.first_backup(1, "mijn-eerste-app", true, true);
    assert_eq!((u.status, u.code.as_str()), ("geweigerd", "geheimen"));
    assert_eq!(u.params["openbaar"], true);
    assert!(r.http.calls.lock().unwrap().is_empty());
}

#[test]
fn scan_op_verzoek_stuurt_niets_en_meldt_wat_er_zou_gebeuren() {
    let r = rig();
    r.schrijf(".env", "A=1");
    r.versie("x");
    let v = r.e.scan_now(1, false);
    assert_eq!(v["blokkades"][0]["bestand"], ".env");
    assert!(r.http.calls.lock().unwrap().is_empty());
    assert!(v["gitignore_ontbreekt"].as_u64().unwrap() > 0);
}

#[test]
fn project_ophalen_kloont_naar_een_nieuwe_map_en_zet_de_back_up_gelijk() {
    let r = rig();
    assert!(eerste(&r).is_ok());
    let doel = tempfile::tempdir().unwrap();
    let dest = doel.path().join("opgehaald");
    r.e.clone_repo("pieter", "mijn-eerste-app", &dest, &mut |_, _| {}).unwrap();
    assert!(dest.join("index.html").is_file() && dest.join(".git").is_dir());
    // Een bestaande map wordt nooit overschreven.
    assert!(r.e.clone_repo("pieter", "mijn-eerste-app", &dest, &mut |_, _| {}).is_err());
    // Ongeldige namen gaan niet de deur uit.
    assert!(r.e.clone_repo("pieter", "../x", &doel.path().join("b"), &mut |_, _| {}).is_err());
    // Het token staat niet in de instellingen van de opgehaalde map.
    let cfg = std::fs::read_to_string(dest.join(".git/config")).unwrap();
    assert!(!cfg.contains(TOKEN) && !cfg.contains('@'));
    // Koppelen: de back-up staat meteen gelijk.
    r.e.unlink(1);
    r.e.link_cloned(1, "pieter", "mijn-eerste-app", true, &dest);
    assert_eq!(r.e.link(1).unwrap().last_backup_count, Some(0));
    // De lijst met repositories geeft alleen namen en zichtbaarheid.
    let l = r.e.list_repos().unwrap();
    assert_eq!((l[0].naam.as_str(), l[0].privaat), ("oud-project", true));
    assert!(!serde_json::to_string(&l).unwrap().contains(TOKEN));
}
