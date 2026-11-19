//! De motor voor online zetten: controles → (echt online: altijd bevestiging) → bestanden uploaden → bouwen → uitslag, in gewone woorden.
//! Het token bestaat alleen binnen `Manager::authorized`; de waarden van omgevingsvariabelen komen alleen uit de OS-kluis en worden nooit teruggegeven.
use super::api::{self, FileRef};
use super::env::{self, Soort};
use super::files;
use super::store::{self, Link, Logged};
use super::{VError, Uitkomst};
use crate::confirm::{self, ActionConfirm, ActionConfirmer};
use crate::connect::http::Http;
use crate::connect::manager::Manager;
use crate::connect::store::{ConnSource, Status};
use crate::connect::vault::SecretStore;
use crate::github::name;
use crate::github::scan::redact;
use crate::preview::detect;
use regex::Regex;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const PROVIDER: &str = "vercel";
/// Zo lang mag het bouwen duren voordat we het opgeven.
pub const BUILD_TIMEOUT_SECS: i64 = 15 * 60;
const POLL: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Actor {
    Gebruiker,
    Ai,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Doel {
    Voorbeeld,
    Live,
}

impl Doel {
    fn as_str(self) -> &'static str {
        match self {
            Doel::Voorbeeld => "preview",
            Doel::Live => "production",
        }
    }
}

pub trait Hooks: Send + Sync {
    fn project_dir(&self, project: i64) -> Option<PathBuf>;
    /// Een lokale versie (checkpoint) vóór het online zetten. Geeft de korte code terug.
    fn checkpoint(&self, project: i64, message: &str) -> Option<String>;
    /// Alle controles (lint, bouwen, tests). `None` = niet te draaien.
    fn run_checks(&self, project: i64) -> Option<bool>;
    /// Blokkeert de kit-controle (alleen als hij op "blokkeren" staat en iets vindt)?
    fn kit_blocks(&self, project: i64) -> bool;
    /// Aantal ernstige beveiligingsbevindingen.
    fn security_high(&self, project: i64) -> usize;
    fn stop_ai(&self, project: i64);
    fn loop_threshold(&self) -> usize;
    fn changed(&self, project: i64);
}

pub type Progress = Arc<dyn Fn(i64, &str, u32, u32) + Send + Sync>;

pub struct Engine {
    pub mgr: Arc<Manager>,
    vault: Arc<dyn SecretStore>,
    db: Box<dyn ConnSource>,
    confirm: Arc<dyn ActionConfirmer>,
    hooks: Arc<dyn Hooks>,
    now: Arc<dyn Fn() -> i64 + Send + Sync>,
    sleep: Arc<dyn Fn(Duration) + Send + Sync>,
    progress: Progress,
    busy: Mutex<HashSet<i64>>,
    cancel: Mutex<HashSet<i64>>,
    failures: Mutex<HashMap<i64, (String, usize)>>,
}

struct BusyGuard<'a>(&'a Engine, i64);
impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.busy.lock().unwrap().remove(&self.1);
        self.0.cancel.lock().unwrap().remove(&self.1);
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct State {
    pub werkt: bool,
    pub account: Option<String>,
    pub project: Option<String>,
    pub flutter: bool,
    pub server_deel: bool,
    /// Variabelen die de code gebruikt maar die nog niet zijn ingevoerd.
    pub ontbrekend: Vec<String>,
    pub voorbeeld: Option<Logged>,
    pub live: Option<Logged>,
    pub laatste: Option<Logged>,
    pub bezig: bool,
    pub nu: i64,
}

fn clip(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let mut t: String = s.chars().take(n).collect();
        t.push('…');
        t
    }
}

/// Zet een bouwlogboek om in een soort fout (code, nl.json: `vercel.bouw.<code>`) en de laatste regels, zonder geheimen.
pub fn summarize(lines: &[String]) -> (&'static str, Vec<String>) {
    let all = lines.join("\n").to_lowercase();
    let has = |p: &str| Regex::new(p).map(|r| r.is_match(&all)).unwrap_or(false);
    let soort = if has(r"cannot find module|module not found|failed to resolve import|could not resolve") {
        "module_ontbreekt"
    } else if has(r"type error|error ts\d{4}|ts\d{4}:") {
        "typefout"
    } else if has(r"eresolve|npm err|err_pnpm|yarn error|failed to install|install command") {
        "installatie"
    } else if has(r"out of memory|heap out of memory|javascript heap") {
        "geheugen"
    } else if has(r"no output directory|output directory .* not found|could not find .*index\.html") {
        "geen_uitvoermap"
    } else if has(r"command .* exited with|build failed|error: build|exited with 1") {
        "bouw_script"
    } else {
        "onbekend"
    };
    let tail: Vec<String> = lines.iter().map(|l| l.trim()).filter(|l| !l.is_empty()).rev().take(12).collect::<Vec<_>>().into_iter().rev().map(|l| clip(&redact(l), 200)).collect();
    (soort, tail)
}

fn probleem_tekst(code: &str) -> &'static str {
    match code {
        "controles_falen" => "de controles slagen niet",
        "controles_niet_gedraaid" => "de controles konden niet draaien",
        "kit" => "de uiterlijk-controle blokkeert",
        "beveiliging" => "de beveiligingscontrole vindt ernstige problemen",
        "geheimen" => "er staan geheimen in je bestanden",
        "te_groot" => "er zijn te grote bestanden",
        "variabelen_ontbreken" => "er ontbreken omgevingsvariabelen",
        _ => "er is een probleem",
    }
}

impl Engine {
    #[allow(clippy::too_many_arguments)]
    pub fn new(mgr: Arc<Manager>, vault: Arc<dyn SecretStore>, db: Box<dyn ConnSource>, confirm: Arc<dyn ActionConfirmer>, hooks: Arc<dyn Hooks>, now: Arc<dyn Fn() -> i64 + Send + Sync>, sleep: Arc<dyn Fn(Duration) + Send + Sync>, progress: Progress) -> Arc<Self> {
        Arc::new(Self { mgr, vault, db, confirm, hooks, now, sleep, progress, busy: Mutex::new(HashSet::new()), cancel: Mutex::new(HashSet::new()), failures: Mutex::new(HashMap::new()) })
    }

    fn q<T>(&self, mut f: impl FnMut(&Connection) -> T) -> Option<T> {
        let mut out = None;
        self.db.with(&mut |c| out = Some(f(c)));
        out
    }

    pub fn project_dir_for(&self, project: i64) -> Option<PathBuf> {
        self.hooks.project_dir(project)
    }

    pub fn link(&self, project: i64) -> Option<Link> {
        self.q(|c| store::link_get(c, project)).flatten()
    }

    fn project_name(&self, project: i64) -> String {
        self.q(|c| crate::projects::get(c, project).map(|p| p.naam).unwrap_or_default()).unwrap_or_default()
    }

    fn werkt(&self) -> bool {
        self.mgr.info(PROVIDER).map(|i| i.status == Status::Werkt).unwrap_or(false)
    }

    fn busy(&self, project: i64) -> Option<BusyGuard<'_>> {
        self.busy.lock().unwrap().insert(project).then_some(BusyGuard(self, project))
    }

    fn progress(&self, project: i64, stap: &str, a: u32, b: u32) {
        (self.progress)(project, stap, a, b);
    }

    fn with_token<T>(&self, f: impl FnOnce(&dyn Http, &str) -> Result<T, VError>) -> Result<T, VError> {
        let mut inner: Option<Result<T, VError>> = None;
        let r = self.mgr.authorized(PROVIDER, |h, t| match f(h, t) {
            Err(VError::OngeldigToken) => Err(crate::connect::error::ConnectError::Unauthorized),
            other => {
                inner = Some(other);
                Ok(())
            }
        });
        match r {
            Err(e) => Err(e.into()),
            Ok(()) => inner.unwrap_or(Err(VError::Onverwacht)),
        }
    }

    // ------------------------------------------------------------------ status

    pub fn missing_env(&self, project: i64) -> Vec<String> {
        let Some(dir) = self.hooks.project_dir(project) else { return vec![] };
        let gezet: HashSet<String> = self.q(|c| store::env_list(c, project)).unwrap_or_default().into_iter().map(|e| e.naam).collect();
        files::used_env_names(&dir).into_iter().filter(|n| !gezet.contains(n)).collect()
    }

    pub fn state(&self, project: i64) -> State {
        let dir = self.hooks.project_dir(project);
        let plan = dir.as_deref().map(detect::detect);
        let log = self.q(|c| store::log_list(c, project, 30)).unwrap_or_default();
        let klaar = |t: &str| log.iter().find(|l| l.target == t && l.state == "READY").cloned();
        State {
            werkt: self.werkt(),
            account: self.mgr.info(PROVIDER).ok().and_then(|i| i.account),
            project: self.link(project).map(|l| l.name),
            flutter: plan.as_ref().is_some_and(|p| p.kind == detect::Kind::Flutter),
            server_deel: dir.as_deref().is_some_and(env::server_capable),
            ontbrekend: self.missing_env(project),
            voorbeeld: klaar("preview"),
            live: klaar("production"),
            laatste: log.first().cloned(),
            bezig: self.busy.lock().unwrap().contains(&project),
            nu: (self.now)(),
        }
    }

    pub fn ai_status(&self, project: i64) -> Value {
        let s = self.state(project);
        json!({
            "gekoppeld": s.werkt,
            "account": s.account,
            "vercel_project": s.project,
            "voorbeeld_adres": s.voorbeeld.as_ref().and_then(|l| l.url.clone()),
            "live_adres": s.live.as_ref().and_then(|l| l.url.clone()),
            "laatste_uitkomst": s.laatste.as_ref().map(|l| json!({ "doel": l.target, "status": l.state, "code": l.code })),
            "ontbrekende_variabelen": s.ontbrekend,
            "flutter_niet_ondersteund": s.flutter,
        })
    }

    // ------------------------------------------------------------------ project koppelen

    /// Maakt (als dat nog niet is gebeurd) het Vercel-project aan, met het juiste framework voor dit project.
    pub fn ensure_link(&self, project: i64) -> Result<Link, VError> {
        if let Some(l) = self.link(project) {
            return Ok(l);
        }
        let dir = self.hooks.project_dir(project).ok_or(VError::Onverwacht)?;
        let framework = detect_framework(&dir);
        let basis: String = name::from_project(&self.project_name(project)).chars().take(48).collect();
        let basis = basis.trim_end_matches('-').to_string();
        let mut laatste = VError::Onverwacht;
        for n in 0..4 {
            let kandidaat = if n == 0 { basis.clone() } else { format!("{basis}-{}", n + 1) };
            if !api::valid_project_name(&kandidaat) {
                continue;
            }
            match self.with_token(|h, t| api::create_project(h, t, &kandidaat, framework)) {
                Ok(p) => {
                    let now = (self.now)();
                    self.q(|c| store::link_set(c, project, &p.id, &p.name, framework, now));
                    return self.link(project).ok_or(VError::Onverwacht);
                }
                Err(VError::NaamBezet) => laatste = VError::NaamBezet,
                Err(e) => return Err(e),
            }
        }
        Err(laatste)
    }

    pub fn unlink(&self, project: i64) {
        self.q(|c| store::link_remove(c, project));
        self.hooks.changed(project);
    }

    // ------------------------------------------------------------------ controles

    fn prechecks(&self, project: i64, doel: Doel) -> Result<Vec<Value>, Uitkomst> {
        let dir = self.hooks.project_dir(project).ok_or_else(|| Uitkomst::fout(&VError::Onverwacht))?;
        let plan = detect::detect(&dir);
        if plan.kind == detect::Kind::Flutter {
            return Err(Uitkomst::nee("flutter", json!({})));
        }
        if !dir.join("index.html").is_file() && !dir.join("package.json").is_file() {
            return Err(Uitkomst::nee("niets_om_te_zetten", json!({})));
        }
        let mut problemen: Vec<Value> = vec![];
        let mut waarschuwingen: Vec<Value> = vec![];
        self.progress(project, "controleren", 0, 0);
        match self.hooks.run_checks(project) {
            Some(true) => {}
            Some(false) => problemen.push(json!({ "code": "controles_falen" })),
            None => problemen.push(json!({ "code": "controles_niet_gedraaid" })),
        }
        if self.hooks.kit_blocks(project) {
            problemen.push(json!({ "code": "kit" }));
        }
        if self.hooks.security_high(project) > 0 {
            problemen.push(json!({ "code": "beveiliging" }));
        }
        let c = files::collect(&dir);
        let blok = c.blokkades();
        if !blok.is_empty() {
            problemen.push(json!({ "code": "geheimen", "bestanden": blok.iter().take(20).map(|f| json!({ "bestand": f.bestand, "regel": f.regel, "soort": f.soort })).collect::<Vec<_>>() }));
        }
        if !c.te_groot.is_empty() || c.te_veel {
            problemen.push(json!({ "code": "te_groot", "bestanden": c.te_groot.iter().take(20).collect::<Vec<_>>() }));
        }
        let missend = self.missing_env(project);
        if !missend.is_empty() {
            let p = json!({ "code": "variabelen_ontbreken", "namen": missend });
            if doel == Doel::Live {
                problemen.push(p);
            } else {
                waarschuwingen.push(p);
            }
        }
        if !problemen.is_empty() {
            let samenvatting = problemen.iter().map(|p| probleem_tekst(p["code"].as_str().unwrap_or(""))).collect::<Vec<_>>().join(", ");
            return Err(Uitkomst::nee("controles", json!({ "problemen": problemen, "samenvatting": samenvatting })));
        }
        Ok(waarschuwingen)
    }

    // ------------------------------------------------------------------ online zetten

    /// Zet een voorbeeld of de echte site online. Echt online zetten vraagt ALTIJD een bevestiging in de Studio-UI, op elk niveau.
    pub fn deploy(&self, project: i64, doel: Doel, actor: Actor, bevestigd: bool) -> Uitkomst {
        let Some(_g) = self.busy(project) else { return Uitkomst::nee("bezig", json!({})) };
        if actor == Actor::Ai && self.link(project).is_none() {
            return Uitkomst::nee("niet_ingesteld", json!({}));
        }
        if doel == Doel::Live && actor == Actor::Gebruiker && !bevestigd {
            return Uitkomst::nee("bevestiging_nodig", json!({}));
        }
        let waarschuwingen = match self.prechecks(project, doel) {
            Ok(w) => w,
            Err(u) => return u,
        };
        let link = match self.ensure_link(project) {
            Ok(l) => l,
            Err(e) => return Uitkomst::fout(&e),
        };
        if doel == Doel::Live && actor == Actor::Ai {
            let req = ActionConfirm { id: confirm::new_id(), project_id: project, soort: "vercel_live".into(), params: json!({ "naam": link.name }), zwaar: true };
            if !self.confirm.ask(&req) {
                return Uitkomst::nee("niet_bevestigd", json!({}));
            }
        }
        let checkpoint = self.hooks.checkpoint(project, if doel == Doel::Live { "Voor het echt online zetten" } else { "Voor het online zetten van een voorbeeld" });
        let Some(dir) = self.hooks.project_dir(project) else { return Uitkomst::fout(&VError::Onverwacht) };
        let verzameld = files::collect(&dir);
        let result = self.with_token(|h, t| self.run_deploy(project, h, t, &link, &verzameld, doel));
        let (mut u, dep) = match result {
            Ok(x) => x,
            Err(e) => (Uitkomst::fout(&e), None),
        };
        // Een mislukte bouw: bouwlogboek ophalen en samenvatten, met een bewaking tegen eindeloos herhalen.
        if u.code == "bouw_mislukt" {
            if let Some(d) = &dep {
                let lines = self.with_token(|h, t| api::build_log(h, t, &d.id, 200)).unwrap_or_default();
                let (soort, tail) = summarize(&lines);
                u.params = json!({ "soort": soort, "regels": tail, "samenvatting": format!("{} {}", soort_tekst(soort), tail.last().cloned().unwrap_or_default()) });
                if actor == Actor::Ai && self.repeated(project, soort, tail.last().map(String::as_str).unwrap_or("")) {
                    self.hooks.stop_ai(project);
                    u = Uitkomst::nee("lus", u.params.clone());
                }
            }
        } else if u.is_ok() {
            self.failures.lock().unwrap().remove(&project);
        }
        let adres = u.params["url"].as_str().map(String::from);
        let staat = match (u.is_ok(), u.code.as_str()) {
            (true, _) => "READY",
            (_, "geannuleerd") => "CANCELED",
            _ => "ERROR",
        };
        let now = (self.now)();
        self.q(|c| store::log_add(c, project, now, doel.as_str(), dep.as_ref().map(|d| d.id.as_str()), adres.as_deref(), staat, checkpoint.as_deref(), &u.code));
        if !waarschuwingen.is_empty() && u.is_ok() {
            u.params["waarschuwingen"] = Value::Array(waarschuwingen);
        }
        self.progress(project, "gewijzigd", 0, 0);
        u
    }

    fn repeated(&self, project: i64, soort: &str, laatste: &str) -> bool {
        let sig = format!("{soort}|{}", clip(laatste, 80));
        let mut f = self.failures.lock().unwrap();
        let e = f.entry(project).or_insert((sig.clone(), 0));
        if e.0 == sig {
            e.1 += 1;
        } else {
            *e = (sig, 1);
        }
        e.1 >= self.hooks.loop_threshold()
    }

    fn run_deploy(&self, project: i64, http: &dyn Http, token: &str, link: &Link, c: &files::Collected, doel: Doel) -> Result<(Uitkomst, Option<api::Deployment>), VError> {
        let totaal = c.files.len() as u32;
        let mut refs = Vec::with_capacity(c.files.len());
        for (i, f) in c.files.iter().enumerate() {
            if self.cancel.lock().unwrap().contains(&project) {
                return Ok((Uitkomst::mislukt("geannuleerd", json!({})), None));
            }
            self.progress(project, "uploaden", i as u32, totaal);
            let data = files::read(f).ok_or(VError::Onverwacht)?;
            api::upload_file(http, token, &f.sha, data)?;
            refs.push(FileRef { file: f.rel.clone(), sha: f.sha.clone(), size: f.size });
        }
        self.progress(project, "bouwen", 0, 0);
        let dep = api::create_deployment(http, token, &link.name, &link.vproject_id, &refs, link.framework.as_deref(), doel == Doel::Live)?;
        let deadline = (self.now)() + BUILD_TIMEOUT_SECS;
        let mut huidig = dep.clone();
        loop {
            if self.cancel.lock().unwrap().contains(&project) {
                let _ = api::cancel_deployment(http, token, &dep.id);
                return Ok((Uitkomst::mislukt("geannuleerd", json!({})), Some(dep)));
            }
            match huidig.state.as_str() {
                "READY" => {
                    let adres = pick_url(&huidig, doel);
                    let code = if doel == Doel::Live { "live_online" } else { "voorbeeld_online" };
                    return Ok((Uitkomst::ok(code, json!({ "url": adres, "deployment_id": huidig.id })), Some(huidig)));
                }
                "ERROR" => return Ok((Uitkomst::mislukt("bouw_mislukt", json!({})), Some(huidig))),
                "CANCELED" => return Ok((Uitkomst::mislukt("geannuleerd", json!({})), Some(huidig))),
                _ => {}
            }
            if (self.now)() >= deadline {
                let _ = api::cancel_deployment(http, token, &dep.id);
                return Ok((Uitkomst::mislukt("time_out", json!({})), Some(dep)));
            }
            (self.sleep)(POLL);
            huidig = api::get_deployment(http, token, &dep.id)?;
        }
    }

    /// De gebruiker drukt op "Stoppen" tijdens het online zetten.
    pub fn cancel(&self, project: i64) {
        if self.busy.lock().unwrap().contains(&project) {
            self.cancel.lock().unwrap().insert(project);
        }
    }

    // ------------------------------------------------------------------ eerdere versies en terugdraaien

    pub fn deployments(&self, project: i64) -> Result<Vec<Value>, VError> {
        let link = self.link(project).ok_or(VError::NietGekoppeld)?;
        let remote = self.with_token(|h, t| api::list_deployments(h, t, &link.vproject_id, 20))?;
        let log = self.q(|c| store::log_list(c, project, 50)).unwrap_or_default();
        Ok(remote
            .into_iter()
            .map(|d| {
                let l = log.iter().find(|l| l.deployment_id.as_deref() == Some(d.id.as_str()));
                json!({ "id": d.id, "adres": d.url, "doel": d.doel, "status": d.status, "gemaakt": d.gemaakt, "versie": l.and_then(|l| l.checkpoint.clone()) })
            })
            .collect())
    }

    /// De echte site terugzetten naar een eerdere versie. Altijd bevestigd (gebruiker in de UI, AI via de dialoog).
    pub fn rollback(&self, project: i64, deployment_id: &str, actor: Actor, bevestigd: bool) -> Uitkomst {
        let Some(_g) = self.busy(project) else { return Uitkomst::nee("bezig", json!({})) };
        let Some(link) = self.link(project) else { return Uitkomst::nee("niet_ingesteld", json!({})) };
        if actor == Actor::Gebruiker && !bevestigd {
            return Uitkomst::nee("bevestiging_nodig", json!({}));
        }
        if actor == Actor::Ai {
            let req = ActionConfirm { id: confirm::new_id(), project_id: project, soort: "vercel_terugzetten".into(), params: json!({ "naam": link.name }), zwaar: true };
            if !self.confirm.ask(&req) {
                return Uitkomst::nee("niet_bevestigd", json!({}));
            }
        }
        let r = self.with_token(|h, t| {
            // Alleen een versie van dit project (uit de lijst van Vercel zelf).
            let lijst = api::list_deployments(h, t, &link.vproject_id, 50)?;
            if !lijst.iter().any(|d| d.id == deployment_id) {
                return Err(VError::NietGevonden);
            }
            api::promote(h, t, &link.vproject_id, deployment_id)
        });
        let now = (self.now)();
        let u = match r {
            Ok(()) => Uitkomst::ok("teruggezet", json!({})),
            Err(e) => Uitkomst::fout(&e),
        };
        self.q(|c| store::log_add(c, project, now, "production", Some(deployment_id), None, if u.is_ok() { "READY" } else { "ERROR" }, None, if u.is_ok() { "teruggezet" } else { &u.code }));
        self.progress(project, "gewijzigd", 0, 0);
        u
    }

    /// De samenvatting van het bouwlogboek van de laatste mislukte (of een bepaalde) deployment, zonder geheimen.
    pub fn build_summary(&self, project: i64, deployment_id: Option<&str>) -> Result<Value, VError> {
        let id = match deployment_id {
            Some(i) => i.to_string(),
            None => self.q(|c| store::log_list(c, project, 20)).unwrap_or_default().into_iter().find(|l| l.state == "ERROR" && l.deployment_id.is_some()).and_then(|l| l.deployment_id).ok_or(VError::NietGevonden)?,
        };
        let lines = self.with_token(|h, t| api::build_log(h, t, &id, 200))?;
        let (soort, tail) = summarize(&lines);
        Ok(json!({ "soort": soort, "regels": tail }))
    }

    // ------------------------------------------------------------------ omgevingsvariabelen

    fn vault_key(project: i64, naam: &str) -> String {
        format!("vercel-env/{project}/{naam}")
    }

    pub fn env_list(&self, project: i64) -> Vec<store::EnvRow> {
        self.q(|c| store::env_list(c, project)).unwrap_or_default()
    }

    /// Een variabele invoeren: de waarde gaat in de kluis (nooit in SQLite) en, als Vercel gekoppeld is, ook naar Vercel.
    /// De waarde komt van de gebruiker zelf in het scherm; de AI geeft nooit een waarde door.
    #[allow(clippy::too_many_arguments)]
    pub fn env_set(&self, project: i64, naam: &str, waarde: &str, soort: &str, omgevingen: &[String], bron: &str, bevestigd: bool) -> Uitkomst {
        let Some(s) = Soort::parse(soort) else { return Uitkomst::nee("env_ongeldig", json!({ "reden": "ongeldige_soort" })) };
        let server_deel = self.hooks.project_dir(project).is_some_and(|d| env::server_capable(&d));
        if let Err(reden) = env::check(naam, s, waarde, omgevingen, server_deel) {
            return Uitkomst::nee("env_ongeldig", json!({ "reden": reden }));
        }
        if omgevingen.iter().any(|o| o == "production") && !bevestigd {
            return Uitkomst::nee("bevestiging_nodig", json!({}));
        }
        if self.vault.set(&Self::vault_key(project, naam), waarde).is_err() {
            return Uitkomst::fout(&VError::Onverwacht);
        }
        let now = (self.now)();
        self.q(|c| store::env_set(c, project, naam, s.as_str(), bron, omgevingen, now));
        self.hooks.changed(project);
        self.push_env(project, naam)
    }

    /// Stuurt een al ingevoerde waarde uit de kluis naar Vercel. Zonder koppeling blijft het bewaard voor later.
    fn push_env(&self, project: i64, naam: &str) -> Uitkomst {
        let Some(row) = self.q(|c| store::env_get(c, project, naam)).flatten() else { return Uitkomst::nee("env_onbekend", json!({})) };
        let Ok(Some(waarde)) = self.vault.get(&Self::vault_key(project, naam)) else { return Uitkomst::nee("env_onbekend", json!({})) };
        let Some(link) = self.link(project) else { return Uitkomst::ok("env_bewaard", json!({ "doorgestuurd": false })) };
        // Serversleutels als "gevoelig" (niet terug te lezen, niet voor "development"); openbare waarden als gewone versleutelde variabelen.
        let (kind, targets): (&str, Vec<String>) = if row.soort == "server" { ("sensitive", row.omgevingen.iter().filter(|o| *o != "development").cloned().collect()) } else { ("encrypted", row.omgevingen.clone()) };
        if targets.is_empty() {
            return Uitkomst::ok("env_bewaard", json!({ "doorgestuurd": false }));
        }
        match self.with_token(|h, t| api::env_upsert(h, t, &link.vproject_id, naam, &waarde, kind, &targets)) {
            Ok(()) => {
                let now = (self.now)();
                self.q(|c| store::env_pushed(c, project, naam, now));
                self.hooks.changed(project);
                Uitkomst::ok("env_gezet", json!({ "doorgestuurd": true }))
            }
            // De waarde blijft veilig bewaard; de fout zegt alleen wat er mis ging.
            Err(e) => Uitkomst::mislukt(e.code(), json!({ "bewaard": true })),
        }
    }

    /// Voor de AI: stuurt een door de gebruiker ingevoerde variabele door. Naar productie altijd via de bevestigingsdialoog.
    pub fn env_push_for_ai(&self, project: i64, naam: &str) -> Uitkomst {
        let Some(row) = self.q(|c| store::env_get(c, project, naam)).flatten() else { return Uitkomst::nee("env_onbekend", json!({})) };
        if self.link(project).is_none() {
            return Uitkomst::nee("niet_ingesteld", json!({}));
        }
        if row.omgevingen.iter().any(|o| o == "production") {
            let req = ActionConfirm { id: confirm::new_id(), project_id: project, soort: "vercel_variabele".into(), params: json!({ "naam": naam }), zwaar: true };
            if !self.confirm.ask(&req) {
                return Uitkomst::nee("niet_bevestigd", json!({}));
            }
        }
        self.push_env(project, naam)
    }

    pub fn env_remove(&self, project: i64, naam: &str) {
        let _ = self.vault.delete(&Self::vault_key(project, naam));
        self.q(|c| store::env_remove(c, project, naam));
        self.hooks.changed(project);
    }

    // ------------------------------------------------------------------ domeinen

    pub fn domain_add(&self, project: i64, domein: &str) -> Result<Value, VError> {
        let link = self.link(project).ok_or(VError::NietGekoppeld)?;
        self.with_token(|h, t| api::domain_add(h, t, &link.vproject_id, domein))
    }

    pub fn domain_check(&self, project: i64, domein: &str) -> Result<Value, VError> {
        let link = self.link(project).ok_or(VError::NietGekoppeld)?;
        self.with_token(|h, t| api::domain_verify(h, t, &link.vproject_id, domein))
    }
}

fn soort_tekst(soort: &str) -> &'static str {
    match soort {
        "module_ontbreekt" => "Een onderdeel dat de code nodig heeft ontbreekt.",
        "typefout" => "Er zit een fout in de code (type).",
        "installatie" => "Het installeren van de onderdelen is mislukt.",
        "geheugen" => "Het bouwen had te weinig geheugen.",
        "geen_uitvoermap" => "Na het bouwen vond Vercel geen map met de website.",
        "bouw_script" => "Het bouwcommando gaf een fout.",
        _ => "De bouw is mislukt.",
    }
}

/// Het adres dat de gebruiker te zien krijgt: voor echt online het vaste adres (alias), anders het adres van deze versie.
fn pick_url(d: &api::Deployment, doel: Doel) -> String {
    let host = if doel == Doel::Live { d.alias.iter().find(|a| a.ends_with(".vercel.app")).or_else(|| d.alias.first()).unwrap_or(&d.url) } else { &d.url };
    if host.starts_with("https://") {
        host.clone()
    } else {
        format!("https://{host}")
    }
}

/// Het framework voor het eerste verzoek: Vite voor het meegeleverde template, anders laat Vercel het zelf herkennen.
pub fn detect_framework(dir: &std::path::Path) -> Option<&'static str> {
    let pkg = std::fs::read_to_string(dir.join("package.json")).unwrap_or_default();
    if pkg.contains("\"vite\"") && !pkg.contains("\"next\"") {
        Some("vite")
    } else {
        None
    }
}
