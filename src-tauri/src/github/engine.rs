//! De back-up-motor: maakt de repository, stuurt nieuwe versies vooruit en vertelt eerlijk wat er gebeurde.
//! Volgorde: koppeling en versies controleren → (AI: bevestiging volgens de instelling) → vergelijken met GitHub → alleen vooruit sturen.
//! Er bestaat bewust geen pad voor force-push, geschiedenis herschrijven, repositories verwijderen of instellingen wijzigen.
use super::api::{self, RepoItem};
use super::gitignore;
use super::repo::{self, Creds, Net};
use super::scan::{self, Finding};
use super::store::{self, Link};
use super::{name, GhError, Uitkomst};
use crate::confirm::{self, ActionConfirm, ActionConfirmer};
use crate::connect::http::Http;
use crate::connect::manager::Manager;
use crate::connect::store::{ConnSource, Status};
use crate::supa::engine::Hooks;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const PROVIDER: &str = "github";
pub const BASE: &str = "https://github.com";
/// Zo lang mag een netwerkactie duren.
pub const NET_SECS: u64 = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Actor {
    Gebruiker,
    Ai,
    /// Automatisch na een opgeslagen versie (instelling van de gebruiker).
    #[allow(dead_code)] // deel 5
    Auto,
}

pub type Progress = Arc<dyn Fn(i64, &str, u32, u32) + Send + Sync>;

pub struct Engine {
    pub mgr: Arc<Manager>,
    db: Box<dyn ConnSource>,
    confirm: Arc<dyn ActionConfirmer>,
    pub(super) hooks: Arc<dyn Hooks>,
    base: String,
    now: Arc<dyn Fn() -> i64 + Send + Sync>,
    progress: Progress,
    busy: Mutex<HashSet<i64>>,
    cancel: AtomicBool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinkView {
    pub eigenaar: String,
    pub repo: String,
    pub privaat: bool,
    pub url: String,
    pub tak: String,
    pub laatste: Option<i64>,
    pub laatste_aantal: Option<i64>,
    pub auto: bool,
    pub ai_vraagt: bool,
    pub uiteengelopen: Option<String>,
    pub probleem: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct State {
    /// GitHub is gekoppeld en werkt.
    pub werkt: bool,
    pub account: Option<String>,
    pub link: Option<LinkView>,
    /// Aantal opgeslagen versies op deze computer.
    pub versies: usize,
    /// Versies sinds de laatste back-up (alleen lokaal geteld; zonder internet).
    pub nieuw: usize,
    pub bezig: bool,
}

struct BusyGuard<'a>(&'a Engine, i64);
impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.busy.lock().unwrap().remove(&self.1);
    }
}

impl Engine {
    pub fn new(mgr: Arc<Manager>, db: Box<dyn ConnSource>, confirm: Arc<dyn ActionConfirmer>, hooks: Arc<dyn Hooks>, now: Arc<dyn Fn() -> i64 + Send + Sync>, progress: Progress) -> Arc<Self> {
        Arc::new(Self { mgr, db, confirm, hooks, base: BASE.to_string(), now, progress, busy: Mutex::new(HashSet::new()), cancel: AtomicBool::new(false) })
    }

    /// Alleen voor tests: een andere "GitHub" (een lokale map met kale repositories).
    #[cfg(test)]
    pub fn with_base(mut self: Arc<Self>, base: &str) -> Arc<Self> {
        Arc::get_mut(&mut self).expect("nog niet gedeeld").base = base.to_string();
        self
    }

    fn q<T>(&self, mut f: impl FnMut(&Connection) -> T) -> Option<T> {
        let mut out = None;
        self.db.with(&mut |c| out = Some(f(c)));
        out
    }

    pub fn link(&self, project: i64) -> Option<Link> {
        self.q(|c| store::get(c, project)).flatten()
    }

    fn project_name(&self, project: i64) -> String {
        self.q(|c| crate::projects::get(c, project).map(|p| p.naam).unwrap_or_default()).unwrap_or_default()
    }

    fn dir(&self, project: i64) -> Option<PathBuf> {
        self.hooks.project_dir(project)
    }

    fn account(&self) -> Option<String> {
        self.mgr.info(PROVIDER).ok().and_then(|i| i.account)
    }

    fn werkt(&self) -> bool {
        self.mgr.info(PROVIDER).map(|i| i.status == Status::Werkt).unwrap_or(false)
    }

    fn url_for(&self, owner: &str, repo: &str) -> Result<String, GhError> {
        name::remote_url(&self.base, owner, repo).ok_or(GhError::Onverwacht)
    }

    fn busy(&self, project: i64) -> Option<BusyGuard<'_>> {
        self.busy.lock().unwrap().insert(project).then_some(BusyGuard(self, project))
    }

    /// Het token wordt alleen binnen deze aanroep gebruikt. Alles wat naar buiten gaat is een `GhError`-code.
    fn with_token<T>(&self, f: impl FnOnce(&dyn Http, &str) -> Result<T, GhError>) -> Result<T, GhError> {
        let mut inner: Option<Result<T, GhError>> = None;
        let r = self.mgr.authorized(PROVIDER, |h, t| match f(h, t) {
            Err(GhError::OngeldigToken) => Err(crate::connect::error::ConnectError::Unauthorized),
            other => {
                inner = Some(other);
                Ok(())
            }
        });
        match r {
            Err(e) => Err(e.into()),
            Ok(()) => inner.unwrap_or(Err(GhError::Onverwacht)),
        }
    }

    pub fn state(&self, project: i64) -> State {
        let link = self.link(project);
        let (versies, nieuw) = match self.dir(project).and_then(|d| repo::open(&d).ok()) {
            Some(r) => match repo::head_oid(&r) {
                Some(h) => {
                    let totaal = repo::count_new(&r, h, None);
                    let sinds = link.as_ref().and_then(|l| l.last_backup_commit.as_deref()).and_then(|c| git2::Oid::from_str(c).ok());
                    (totaal, repo::count_new(&r, h, sinds))
                }
                None => (0, 0),
            },
            None => (0, 0),
        };
        State {
            werkt: self.werkt(),
            account: self.account(),
            link: link.map(|l| LinkView {
                url: format!("https://github.com/{}/{}", l.owner, l.repo),
                eigenaar: l.owner,
                repo: l.repo,
                privaat: l.private,
                tak: l.branch,
                laatste: l.last_backup_at,
                laatste_aantal: l.last_backup_count,
                auto: l.auto_backup,
                ai_vraagt: l.ai_ask,
                uiteengelopen: l.diverged,
                probleem: l.problem,
            }),
            versies,
            nieuw,
            bezig: self.busy.lock().unwrap().contains(&project),
        }
    }

    /// Het voorstel voor de naam, en of die nog vrij is (met een verzoek aan GitHub).
    pub fn suggest_name(&self, project: i64, gekozen: Option<&str>) -> Result<Value, GhError> {
        let naam = gekozen.map(String::from).unwrap_or_else(|| name::from_project(&self.project_name(project)));
        if !name::is_valid(&naam) {
            return Ok(json!({ "naam": naam, "geldig": false, "vrij": null }));
        }
        let owner = self.account().ok_or(GhError::NietGekoppeld)?;
        let vrij = self.with_token(|h, t| api::repo_exists(h, t, &owner, &naam)).map(|b| !b)?;
        Ok(json!({ "naam": naam, "geldig": true, "vrij": vrij }))
    }

    /// Eerste back-up: repository maken (privé tenzij uitdrukkelijk anders), koppelen en alle versies sturen.
    pub fn first_backup(&self, project: i64, naam: &str, openbaar: bool, openbaar_bevestigd: bool) -> Uitkomst {
        let Some(_g) = self.busy(project) else { return Uitkomst::nee("bezig", json!({})) };
        if self.link(project).is_some() {
            return Uitkomst::nee("al_gekoppeld", json!({}));
        }
        if openbaar && !openbaar_bevestigd {
            return Uitkomst::nee("openbaar_bevestig", json!({}));
        }
        if !name::is_valid(naam) {
            return Uitkomst::nee("naam_ongeldig", json!({}));
        }
        let Some(dir) = self.dir(project) else { return Uitkomst::fout(&GhError::Onverwacht) };
        if let Err(u) = self.ensure_versions(project, &dir, Actor::Gebruiker) {
            return u;
        }
        let waarschuwingen = match self.pre_checks(project, &dir, openbaar, None) {
            Ok(w) => w,
            Err(u) => return u,
        };
        let beschrijving = format!("Back-up van {} (gemaakt met Studio)", self.project_name(project));
        let created = match self.with_token(|h, t| api::create_repo(h, t, naam, !openbaar, &beschrijving)) {
            Ok(c) => c,
            Err(e) => return Uitkomst::fout(&e),
        };
        let branch = repo::open(&dir).ok().as_ref().and_then(repo::head_branch).unwrap_or_else(|| created.default_branch.clone());
        let now = (self.now)();
        self.q(|c| store::set(c, project, &created.owner, &created.name, created.private, &branch, now).ok());
        (self.progress)(project, "gewijzigd", 0, 0);
        self.push_now(project, &dir, waarschuwingen)
    }

    /// Een back-up bijwerken: alleen nieuwe versies, alleen vooruit.
    pub fn backup(&self, project: i64, actor: Actor) -> Uitkomst {
        let Some(_g) = self.busy(project) else { return Uitkomst::nee("bezig", json!({})) };
        let Some(link) = self.link(project) else { return Uitkomst::nee("niet_ingesteld", json!({})) };
        let Some(dir) = self.dir(project) else { return Uitkomst::fout(&GhError::Onverwacht) };
        if actor == Actor::Ai && link.ai_ask {
            let req = ActionConfirm { id: confirm::new_id(), project_id: project, soort: "github_backup".into(), params: json!({ "repo": format!("{}/{}", link.owner, link.repo), "privaat": link.private }), zwaar: false };
            if !self.confirm.ask(&req) {
                return Uitkomst::nee("niet_bevestigd", json!({}));
            }
        }
        if let Err(u) = self.ensure_versions(project, &dir, actor) {
            return u;
        }
        let zonder = link.last_backup_commit.as_deref().and_then(|c| git2::Oid::from_str(c).ok());
        let waarschuwingen = match self.pre_checks(project, &dir, !link.private, zonder) {
            Ok(w) => w,
            Err(u) => return u,
        };
        self.push_now(project, &dir, waarschuwingen)
    }

    /// Zorgt dat er minstens één versie is. De gebruiker mag er een laten maken; de AI en de automaat niet (die vragen erom).
    fn ensure_versions(&self, project: i64, dir: &Path, actor: Actor) -> Result<(), Uitkomst> {
        if repo::open(dir).ok().and_then(|r| repo::head_oid(&r)).is_some() {
            return Ok(());
        }
        if actor == Actor::Gebruiker {
            self.hooks.checkpoint(project, "Eerste versie");
            if repo::open(dir).ok().and_then(|r| repo::head_oid(&r)).is_some() {
                return Ok(());
            }
        }
        Err(Uitkomst::nee("geen_versies", json!({})))
    }

    /// Controles voor er iets wordt verstuurd: `.gitignore` aanvullen, dan scannen op geheimen en te grote bestanden.
    /// `Err` = tegengehouden (met uitleg); `Ok` = verder, met waarschuwingen om na afloop te tonen.
    fn pre_checks(&self, _project: i64, dir: &Path, openbaar: bool, zonder: Option<git2::Oid>) -> Result<Vec<Value>, Uitkomst> {
        let hersteld = gitignore::herstel(dir).map(|v| v.len()).unwrap_or(0);
        let r = repo::open(dir).map_err(|e| Uitkomst::fout(&e))?;
        let head = repo::head_oid(&r).ok_or_else(|| Uitkomst::nee("geen_versies", json!({})))?;
        let rep = scan::scan(&r, head, zonder);
        let lijst = |v: &[&Finding]| -> Vec<Value> { v.iter().take(20).map(|f| json!({ "bestand": f.bestand, "regel": f.regel, "soort": f.soort, "historie": f.historie })).collect() };
        let blok = rep.blokkades(openbaar);
        if !blok.is_empty() {
            return Err(Uitkomst::nee("geheimen", json!({ "aantal": blok.len(), "bestanden": lijst(&blok), "openbaar": openbaar, "gitignore_hersteld": hersteld })));
        }
        if !rep.te_groot.is_empty() {
            let b: Vec<Value> = rep.te_groot.iter().take(20).map(|(f, n)| json!({ "bestand": f, "grootte": n })).collect();
            return Err(Uitkomst::nee("te_groot", json!({ "aantal": rep.te_groot.len(), "bestanden": b, "gitignore_hersteld": hersteld })));
        }
        let mut w: Vec<Value> = lijst(&rep.waarschuwingen(openbaar)).into_iter().map(|mut v| {
            v["waarschuwing"] = json!("geheim");
            v
        }).collect();
        w.extend(rep.groot.iter().take(20).map(|(f, n)| json!({ "waarschuwing": "groot", "bestand": f, "grootte": n })));
        if hersteld > 0 {
            w.push(json!({ "waarschuwing": "gitignore", "aantal": hersteld }));
        }
        Ok(w)
    }

    /// Controle op verzoek ("Controleer nu"): wat zou er tegengehouden worden en wat is een waarschuwing? Stuurt niets.
    pub fn scan_now(&self, project: i64, openbaar: bool) -> Value {
        let Some(dir) = self.dir(project) else { return json!({ "fout": "onverwacht" }) };
        let Ok(r) = repo::open(&dir) else { return json!({ "fout": "geen_versies" }) };
        let Some(head) = repo::head_oid(&r) else { return json!({ "fout": "geen_versies" }) };
        let openbaar = openbaar || self.link(project).map(|l| !l.private).unwrap_or(false);
        let zonder = self.link(project).and_then(|l| l.last_backup_commit).and_then(|c| git2::Oid::from_str(&c).ok());
        let rep = scan::scan(&r, head, zonder);
        let f = |v: Vec<&Finding>| -> Vec<Value> { v.iter().map(|f| json!({ "bestand": f.bestand, "regel": f.regel, "soort": f.soort, "historie": f.historie })).collect() };
        json!({
            "gescand": rep.gescand,
            "blokkades": f(rep.blokkades(openbaar)),
            "waarschuwingen": f(rep.waarschuwingen(openbaar)),
            "te_groot": rep.te_groot,
            "groot": rep.groot,
            "gitignore_ontbreekt": gitignore::ontbrekend(&dir).len(),
        })
    }

    fn push_now(&self, project: i64, dir: &Path, waarschuwingen: Vec<Value>) -> Uitkomst {
        let Some(link) = self.link(project) else { return Uitkomst::nee("niet_ingesteld", json!({})) };
        let result = self.push_inner(project, dir, &link);
        match &result {
            Ok(u) if u.is_ok() => {
                self.q(|c| store::set_problem(c, project, None));
            }
            Err(e) => {
                self.q(|c| store::set_problem(c, project, Some(e.code())));
            }
            _ => {}
        }
        (self.progress)(project, "gewijzigd", 0, 0);
        match result {
            Ok(mut u) => {
                if u.is_ok() && !waarschuwingen.is_empty() {
                    u.params["waarschuwingen"] = Value::Array(waarschuwingen);
                }
                u
            }
            Err(e) => Uitkomst::fout(&e),
        }
    }

    fn push_inner(&self, project: i64, dir: &Path, link: &Link) -> Result<Uitkomst, GhError> {
        let url = self.url_for(&link.owner, &link.repo)?;
        let r = repo::open(dir)?;
        let local = repo::head_oid(&r).ok_or(GhError::GeenVersies)?;
        let branch = repo::head_branch(&r).ok_or(GhError::GeenVersies)?;
        if branch != link.branch {
            // Dezelfde repository blijft bij dezelfde tak; een andere tak sturen we niet zonder dat de gebruiker het weet.
            return Ok(Uitkomst::nee("andere_tak", json!({ "tak": branch, "verwacht": link.branch })));
        }
        let gebruiker = self.account().unwrap_or_else(|| link.owner.clone());
        let uitkomst = self.with_token(|_h, token| {
            let creds = Creds::new(&gebruiker, token);
            let net = Net { creds: self.is_https(&url).then_some(&creds), cancel: &self.cancel, max: Duration::from_secs(NET_SECS) };
            (self.progress)(project, "vergelijken", 0, 0);
            let remote = repo::fetch_tip(&r, &url, &branch, &net)?;
            let (voor, achter) = match remote {
                Some(rt) => repo::ahead_behind(&r, local, rt),
                None => (repo::count_new(&r, local, None), 0),
            };
            if achter > 0 {
                let kind = if voor > 0 { "uiteengelopen" } else { "online_nieuwer" };
                self.q(|c| store::set_diverged(c, project, Some(kind)));
                return Ok(Uitkomst::nee(kind, json!({ "voor": voor, "achter": achter })));
            }
            if voor == 0 {
                self.q(|c| store::backup_done(c, project, (self.now)(), &local.to_string(), 0));
                return Ok(Uitkomst::ok("al_bijgewerkt", json!({})));
            }
            (self.progress)(project, "versturen", 0, voor as u32);
            repo::push(&r, &url, &branch, &net, &mut |a, b| (self.progress)(project, "versturen", a, b))?;
            self.q(|c| store::backup_done(c, project, (self.now)(), &local.to_string(), voor as i64));
            Ok(Uitkomst::ok("back_up_klaar", json!({ "aantal": voor })))
        })?;
        (self.progress)(project, "klaar", 0, 0);
        Ok(uitkomst)
    }

    fn is_https(&self, url: &str) -> bool {
        url.starts_with("https://")
    }

    /// Haalt de koppeling los. De repository op GitHub en de bestanden blijven staan.
    pub fn unlink(&self, project: i64) {
        self.q(|c| store::remove(c, project));
        (self.progress)(project, "gewijzigd", 0, 0);
    }

    pub fn set_auto(&self, project: i64, aan: bool) {
        self.q(|c| store::set_auto(c, project, aan));
        (self.progress)(project, "gewijzigd", 0, 0);
    }

    pub fn set_ai_ask(&self, project: i64, vraagt: bool) {
        self.q(|c| store::set_ai_ask(c, project, vraagt));
        (self.progress)(project, "gewijzigd", 0, 0);
    }

    /// Namen en zichtbaarheid van de eigen repositories.
    pub fn list_repos(&self) -> Result<Vec<RepoItem>, GhError> {
        self.with_token(|h, t| api::list_repos(h, t))
    }

    /// Koppelt een opgehaald project aan zijn repository: de back-up staat meteen gelijk met GitHub.
    pub fn link_cloned(&self, project: i64, owner: &str, repo_name: &str, privaat: bool, dir: &Path) {
        let r = repo::open(dir).ok();
        let branch = r.as_ref().and_then(repo::head_branch).unwrap_or_else(|| "main".into());
        let head = r.as_ref().and_then(repo::head_oid).map(|o| o.to_string());
        let now = (self.now)();
        self.q(|c| {
            store::set(c, project, owner, repo_name, privaat, &branch, now).ok();
            if let Some(h) = &head {
                store::backup_done(c, project, now, h, 0);
            }
        });
    }

    /// Haalt een repository binnen in `dest` (een nieuwe, nog niet bestaande map).
    pub fn clone_repo(&self, owner: &str, repo_name: &str, dest: &Path, progress: &mut dyn FnMut(u32, u32)) -> Result<(), GhError> {
        let url = self.url_for(owner, repo_name)?;
        if dest.exists() {
            return Err(GhError::Onverwacht);
        }
        let gebruiker = self.account().unwrap_or_else(|| owner.to_string());
        self.with_token(|_h, token| {
            let creds = Creds::new(&gebruiker, token);
            let net = Net { creds: self.is_https(&url).then_some(&creds), cancel: &self.cancel, max: Duration::from_secs(NET_SECS * 5) };
            repo::clone_into(&url, dest, &net, progress)
        })
    }

    #[allow(dead_code)] // deel 4
    /// De status voor de AI: gekoppeld, accountnaam, repository, laatste back-up, uiteengelopen ja/nee. Nooit een token.
    pub fn ai_status(&self, project: i64) -> Value {
        let s = self.state(project);
        json!({
            "gekoppeld": s.werkt,
            "account": s.account,
            "repository": s.link.as_ref().map(|l| format!("{}/{}", l.eigenaar, l.repo)),
            "privaat": s.link.as_ref().map(|l| l.privaat),
            "laatste_back_up": s.link.as_ref().and_then(|l| l.laatste),
            "nieuwe_versies_sinds_back_up": s.nieuw,
            "uiteengelopen": s.link.as_ref().map(|l| l.uiteengelopen.is_some()).unwrap_or(false),
            "probleem": s.link.as_ref().and_then(|l| l.probleem.clone()),
        })
    }
}
