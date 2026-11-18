//! De actie-motor: voert alles wat de AI (of de gebruiker) met de database wil doen uit, namens hen, volgens het bedieningsniveau.
//! Volgorde bij elke schrijfactie: lezen en indelen → tellen → back-up → besluit (toestaan, bevestigen, weigeren) → vangnet (checkpoint,
//! momentopname) → uitvoeren → log. Sleutels en wachtwoorden verlaten deze module nooit.
use super::api::{check_name, check_ref, scrub, Client, SupaError, MAX_REPLY_CHARS};
use super::classify::{analyze, Analysis, Change, Class, Finding};
use super::policy::{create_project_cost, decide, Backup, Cost, Facts, Level, LimitError, RowCount, WriteLimiter, FULL_DEFAULT_SECS};
use super::store::{self, Link, NewAction};
use super::undo;
use crate::connect::error::ConnectError;
use crate::connect::manager::Manager;
use crate::connect::store::ConnSource;
use crate::connect::vault::ProviderVault;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

pub const PROVIDER: &str = "supabase";
/// Back-up van een tabel: niet meer dan zoveel rijen en bytes.
pub const BACKUP_MAX_ROWS: usize = 5_000;
pub const BACKUP_MAX_BYTES: usize = 5_000_000;
const SQL_PREVIEW: usize = 3_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Actor {
    Ai,
    /// De gebruiker zelf (via het scherm Gegevens): altijd met een bevestiging, in elk niveau.
    Gebruiker,
}

/// Alles wat de gebruiker in de dialoog te zien krijgt. De tekst komt uit nl.json (`gegevens.vraag.*`), niet uit Rust.
#[derive(Debug, Clone, Serialize)]
pub struct ConfirmRequest {
    pub id: String,
    pub project_id: i64,
    pub tool: String,
    pub actor: Actor,
    pub class: u8,
    pub level: Level,
    pub redenen: Vec<&'static str>,
    pub changes: Vec<Change>,
    pub rijen: Option<u64>,
    pub verlies: bool,
    pub backup: &'static str,
    pub kosten: Option<Cost>,
    pub waarschuwingen: Vec<Finding>,
    pub sql: String,
    /// De uitleg van de AI in zijn eigen woorden (ongecontroleerde tekst; de app toont hem als gewone tekst).
    pub uitleg: String,
}

pub trait Confirmer: Send + Sync {
    /// Wacht op het antwoord van de gebruiker (in de app). Zonder antwoord of bij een fout: `false`.
    fn ask(&self, req: &ConfirmRequest) -> bool;
}

pub trait Hooks: Send + Sync {
    /// Git-checkpoint van het project voor een schrijfactie. `None` = niet gelukt of niets te bewaren.
    fn checkpoint(&self, project: i64, message: &str) -> Option<String>;
    /// Stopt de AI (bij herhaalde fouten en bij de noodknop).
    fn stop_ai(&self, project: i64);
    fn project_dir(&self, project: i64) -> Option<PathBuf>;
    fn loop_threshold(&self) -> usize;
    /// De database of het log is veranderd (de app ververst het scherm).
    fn changed(&self, project: i64);
}

/// Het antwoord aan de AI: kort en eerlijk.
#[derive(Debug, Clone, Serialize)]
pub struct Reply {
    /// `uitgevoerd`, `geweigerd` of `mislukt`.
    pub status: &'static str,
    pub tekst: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl Reply {
    fn ok(tekst: impl Into<String>, data: Option<Value>) -> Self {
        Reply { status: "uitgevoerd", tekst: tekst.into(), data }
    }
    fn nee(tekst: impl Into<String>) -> Self {
        Reply { status: "geweigerd", tekst: tekst.into(), data: None }
    }
    fn fout(tekst: impl Into<String>) -> Self {
        Reply { status: "mislukt", tekst: tekst.into(), data: None }
    }
}

pub struct Engine {
    pub mgr: Arc<Manager>,
    db: Box<dyn ConnSource>,
    vault: ProviderVault,
    confirm: Arc<dyn Confirmer>,
    hooks: Arc<dyn Hooks>,
    backup_dir: PathBuf,
    now: Arc<dyn Fn() -> i64 + Send + Sync>,
    limiters: Mutex<HashMap<i64, WriteLimiter>>,
    /// Wordt door de noodknop verhoogd: acties die vóór de noodknop begonnen, worden niet meer uitgevoerd.
    generation: AtomicU64,
    failures: Mutex<HashMap<i64, (String, usize)>>,
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

fn sanitize_slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('_') && !out.is_empty() {
            out.push('_');
        }
    }
    let t = out.trim_matches('_').to_string();
    clip(&t, 50).trim_end_matches('…').to_string()
}

fn q_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn verlies(changes: &[Change]) -> bool {
    changes.iter().any(|c| matches!(c.code, "rijen_verwijderen" | "tabel_verwijderen" | "tabel_leegmaken" | "kolom_verwijderen" | "object_verwijderen" | "rijen_wijzigen"))
}

impl Engine {
    #[allow(clippy::too_many_arguments)]
    pub fn new(mgr: Arc<Manager>, store: Arc<dyn crate::connect::vault::SecretStore>, db: Box<dyn ConnSource>, confirm: Arc<dyn Confirmer>, hooks: Arc<dyn Hooks>, backup_dir: PathBuf, now: Arc<dyn Fn() -> i64 + Send + Sync>) -> Arc<Self> {
        Arc::new(Self { mgr, db, vault: ProviderVault::new(store, PROVIDER), confirm, hooks, backup_dir, now, limiters: Mutex::new(HashMap::new()), generation: AtomicU64::new(0), failures: Mutex::new(HashMap::new()) })
    }

    fn now(&self) -> i64 {
        (self.now)()
    }
    fn with_db<T>(&self, mut f: impl FnMut(&rusqlite::Connection) -> T) -> Option<T> {
        let mut out = None;
        self.db.with(&mut |c| out = Some(f(c)));
        out
    }

    pub fn link(&self, project: i64) -> Option<Link> {
        self.with_db(|c| store::link_get(c, project)).flatten()
    }

    fn dbpass_key(reference: &str) -> String {
        format!("dbpass:{reference}")
    }

    /// Het niveau dat nu geldt (een verlopen "Volledige controle" valt vanzelf terug op "Zelfstandig" en dat wordt ook bewaard).
    pub fn level(&self, project: i64) -> Level {
        let Some(l) = self.link(project) else { return Level::Voorzichtig };
        let eff = l.state().effective(self.now());
        if eff != l.level {
            self.with_db(|c| store::level_set(c, project, eff, None));
        }
        eff
    }

    /// Voert iets uit met de Management API en het token uit de kluis. Het token blijft in deze closure.
    fn api<T>(&self, secrets: &[String], f: impl FnOnce(&Client) -> Result<T, SupaError>) -> Result<T, SupaError> {
        let secrets = secrets.to_vec();
        let res = self.mgr.authorized(PROVIDER, move |http, token| {
            let mut c = Client::new(http, token);
            c.secrets = secrets;
            match f(&c) {
                Err(SupaError::Connect(e)) => Err(e),
                other => Ok(other),
            }
        });
        match res {
            Ok(inner) => inner,
            Err(e) => Err(SupaError::Connect(e)),
        }
    }

    fn secrets_for(&self, link: &Link) -> Vec<String> {
        self.vault.get(&Self::dbpass_key(&link.reference)).ok().flatten().into_iter().collect()
    }

    fn need_link(&self, project: i64) -> Result<Link, Reply> {
        self.link(project).ok_or_else(|| Reply::nee("Dit project is nog niet gekoppeld aan Supabase. Vraag de gebruiker in Studio bij ‘Wat je app onthoudt’ een project te kiezen."))
    }

    fn err_reply(&self, link: &Link, e: &SupaError) -> Reply {
        match e {
            SupaError::Paused => Reply::fout("Het Supabase-project is gepauzeerd. De gebruiker kan het in Studio weer wakker maken."),
            SupaError::Connect(ConnectError::Unauthorized | ConnectError::Expired) => Reply::fout("De Supabase-koppeling werkt niet meer (verlopen of ingetrokken). De gebruiker moet opnieuw verbinden in Studio."),
            SupaError::Connect(ConnectError::NotConnected) => Reply::fout("Supabase is niet gekoppeld. De gebruiker kan dat doen met de knop Verbinden bij ‘Wat je app onthoudt’."),
            SupaError::Connect(ConnectError::Forbidden) => Reply::fout("Het Supabase-token heeft hier te weinig rechten voor."),
            SupaError::Connect(ConnectError::RateLimited) => Reply::fout("Supabase vraagt om even te wachten (te veel verzoeken). Probeer het over een minuut opnieuw."),
            SupaError::Connect(ConnectError::Offline | ConnectError::Timeout) => Reply::fout("Er is geen verbinding met Supabase (internet of time-out)."),
            SupaError::PlanLimit => Reply::fout("Een limiet van het Supabase-plan is bereikt."),
            SupaError::NotFound => Reply::fout(format!("Het Supabase-project ‘{}’ is niet gevonden (is het verwijderd?).", link.name)),
            SupaError::Sql(m) => Reply::fout(format!("De database gaf een fout: {m}")),
            _ => Reply::fout("Er ging iets mis bij Supabase."),
        }
    }

    // ---------- lezen (altijd toegestaan, zonder bevestiging) ----------

    pub fn status(&self, project: i64) -> Reply {
        let Some(link) = self.link(project) else { return Reply::ok("Dit project is niet gekoppeld aan Supabase.", Some(json!({ "gekoppeld": false }))) };
        let level = self.level(project);
        match self.api(&[], |c| c.project(&link.reference)) {
            Ok(p) => {
                let gepauzeerd = matches!(p.status.as_str(), "INACTIVE" | "PAUSED" | "PAUSING");
                Reply::ok(
                    if gepauzeerd { "Gekoppeld, maar het project is gepauzeerd." } else { "Gekoppeld." },
                    Some(json!({ "gekoppeld": true, "naam": link.name, "regio": if p.region.is_empty() { link.region.clone() } else { p.region }, "status": p.status, "gepauzeerd": gepauzeerd, "niveau": level.as_str() })),
                )
            }
            Err(e) => self.err_reply(&link, &e),
        }
    }

    /// Alleen de project-URL en de PUBLIEKE sleutel. Nooit de service-sleutel of het databasewachtwoord.
    pub fn public_config(&self, project: i64) -> Reply {
        let link = match self.need_link(project) {
            Ok(l) => l,
            Err(r) => return r,
        };
        match self.api(&[], |c| c.public_key(&link.reference)) {
            Ok(k) => Reply::ok("Publieke configuratie (veilig voor in de app).", Some(json!({ "url": format!("https://{}.supabase.co", link.reference), "publiceerbare_sleutel": k.publishable }))),
            Err(e) => self.err_reply(&link, &e),
        }
    }

    const LIST_TABLES_SQL: &'static str = "select coalesce(json_agg(x order by x.tabel), '[]'::json) as data from (select t.tablename as tabel, t.rowsecurity as rls, (select json_agg(json_build_object('kolom', c.column_name, 'type', c.data_type, 'verplicht', c.is_nullable = 'NO') order by c.ordinal_position) from information_schema.columns c where c.table_schema = 'public' and c.table_name = t.tablename) as kolommen, (select json_agg(json_build_object('naam', p.policyname, 'commando', p.cmd, 'rollen', p.roles, 'voorwaarde', p.qual, 'controle', p.with_check)) from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename) as beleid from pg_tables t where t.schemaname = 'public') x";

    fn first_data(v: &Value) -> Value {
        // Het antwoord is een lijst met rijen; onze eigen query geeft één rij met `data`.
        let d = v.get(0).and_then(|r| r.get("data")).cloned().unwrap_or(Value::Null);
        match d {
            Value::String(s) => serde_json::from_str(&s).unwrap_or(Value::String(s)),
            x => x,
        }
    }

    pub fn list_tables(&self, project: i64) -> Reply {
        let link = match self.need_link(project) {
            Ok(l) => l,
            Err(r) => return r,
        };
        match self.api(&self.secrets_for(&link), |c| c.query(&link.reference, Self::LIST_TABLES_SQL, true)) {
            Ok(v) => Reply::ok("Tabellen in het publieke schema.", Some(Self::first_data(&v))),
            Err(e) => self.err_reply(&link, &e),
        }
    }

    /// Alleen lezen: de SQL moet een gewone SELECT zijn (klasse 1) en gaat via het alleen-lezen-eindpunt. Het resultaat is begrensd.
    pub fn readonly_query(&self, project: i64, sql: &str, limit_rows: usize) -> Reply {
        let link = match self.need_link(project) {
            Ok(l) => l,
            Err(r) => return r,
        };
        let a = analyze(sql);
        if !a.read_only || a.statements.len() != 1 {
            return Reply::nee("Geweigerd door veiligheidsregel: deze tool voert alleen één gewone SELECT uit. Gebruik voor wijzigingen db_run_sql of db_propose_migration.");
        }
        match self.api(&self.secrets_for(&link), |c| c.query(&link.reference, sql, true)) {
            Ok(v) => {
                let (data, afgekapt) = limit_value(&v, limit_rows.clamp(1, 200));
                Reply::ok(if afgekapt { "Resultaat (afgekapt)." } else { "Resultaat." }, Some(data))
            }
            Err(e) => self.err_reply(&link, &e),
        }
    }

    pub fn logs(&self, project: i64, bron: &str, minuten: u32) -> Reply {
        let link = match self.need_link(project) {
            Ok(l) => l,
            Err(r) => return r,
        };
        let tabel = match bron {
            "api" => "edge_logs",
            "database" | "postgres" => "postgres_logs",
            "auth" => "auth_logs",
            "functies" => "function_logs",
            "opslag" => "storage_logs",
            _ => return Reply::nee("Onbekende logbron. Kies api, database, auth, functies of opslag."),
        };
        let _ = minuten; // de standaardperiode van de API is kort genoeg; de limiet staat in de query
        let sql = format!("select timestamp, event_message from {tabel} order by timestamp desc limit 50");
        match self.api(&self.secrets_for(&link), |c| c.logs(&link.reference, &sql)) {
            Ok(v) => Reply::ok("Laatste logregels.", Some(trim_value(&v))),
            Err(e) => self.err_reply(&link, &e),
        }
    }

    pub fn advisors(&self, project: i64) -> Reply {
        let link = match self.need_link(project) {
            Ok(l) => l,
            Err(r) => return r,
        };
        let sec = self.api(&[], |c| c.advisors(&link.reference, "security"));
        let perf = self.api(&[], |c| c.advisors(&link.reference, "performance"));
        match (sec, perf) {
            (Err(e), Err(_)) | (Err(e), Ok(_)) => self.err_reply(&link, &e),
            (Ok(s), p) => Reply::ok("Adviezen van Supabase.", Some(json!({ "veiligheid": trim_value(&s), "snelheid": p.ok().map(|x| trim_value(&x)) }))),
        }
    }

    pub fn types(&self, project: i64) -> Reply {
        let link = match self.need_link(project) {
            Ok(l) => l,
            Err(r) => return r,
        };
        match self.api(&[], |c| c.types(&link.reference)) {
            Ok(t) => Reply::ok("TypeScript-typen van het publieke schema.", Some(json!({ "types": t }))),
            Err(e) => self.err_reply(&link, &e),
        }
    }
}

/// Maakt een resultaat kleiner: maximaal `n` rijen en een maximale tekstlengte.
fn limit_value(v: &Value, n: usize) -> (Value, bool) {
    match v.as_array() {
        Some(a) if a.len() > n => (Value::Array(a[..n].to_vec()), true),
        _ => {
            let t = trim_value(v);
            let cut = t != *v;
            (t, cut)
        }
    }
}

fn trim_value(v: &Value) -> Value {
    let s = v.to_string();
    if s.chars().count() <= MAX_REPLY_CHARS {
        v.clone()
    } else {
        json!({ "afgekapt": true, "tekst": clip(&s, MAX_REPLY_CHARS) })
    }
}

mod admin;
mod config;
mod data;
mod write;

#[cfg(test)]
mod tests;
