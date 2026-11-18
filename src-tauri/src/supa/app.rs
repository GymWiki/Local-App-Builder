//! Verbinding tussen de Supabase-motor en de app: bevestigingsdialoog, checkpoint, noodknop, Tauri-commando's en de opdrachten van de MCP-tools.
use super::engine::{Actor, ConfirmRequest, Confirmer, Engine, Hooks, Reply};
use super::policy::{Level, FULL_DEFAULT_SECS};
use super::store;
use crate::chat::ChatManager;
use crate::commands::Db;
use crate::mcp::McpManager;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// Hoe lang een bevestiging mag wachten voordat het "nee" wordt.
const CONFIRM_TIMEOUT: Duration = Duration::from_secs(600);

pub struct UiConfirmer {
    app: AppHandle,
    pending: Mutex<HashMap<String, Sender<bool>>>,
}

impl UiConfirmer {
    pub fn new(app: AppHandle) -> Arc<Self> {
        Arc::new(Self { app, pending: Mutex::new(HashMap::new()) })
    }
    /// Het antwoord van de gebruiker in de dialoog.
    pub fn answer(&self, id: &str, allow: bool) -> bool {
        match self.pending.lock().unwrap().remove(id) {
            Some(tx) => tx.send(allow).is_ok(),
            None => false,
        }
    }
}

impl Confirmer for UiConfirmer {
    fn ask(&self, req: &ConfirmRequest) -> bool {
        let (tx, rx) = channel();
        self.pending.lock().unwrap().insert(req.id.clone(), tx);
        if self.app.emit("db-confirm", req).is_err() {
            self.pending.lock().unwrap().remove(&req.id);
            return false;
        }
        let ok = rx.recv_timeout(CONFIRM_TIMEOUT).unwrap_or(false);
        self.pending.lock().unwrap().remove(&req.id);
        ok
    }
}

pub struct AppHooks {
    pub app: AppHandle,
}

impl Hooks for AppHooks {
    fn checkpoint(&self, project: i64, message: &str) -> Option<String> {
        let v = self.app.state::<McpManager>().call(project, "git.checkpoint", json!({ "message": message }), Duration::from_secs(20)).ok()?;
        v["hash"].as_str().map(String::from)
    }
    fn stop_ai(&self, project: i64) {
        self.app.state::<ChatManager>().stop(project);
    }
    fn project_dir(&self, project: i64) -> Option<PathBuf> {
        let db = self.app.state::<Db>();
        let c = db.conn().ok()?;
        crate::projects::get(&c, project).ok().map(|p| PathBuf::from(p.pad))
    }
    fn loop_threshold(&self) -> usize {
        let db = self.app.state::<Db>();
        let n = db.conn().ok().and_then(|c| c.query_row("SELECT value FROM settings WHERE key = 'ui:loop_threshold'", [], |r| r.get::<_, String>(0)).ok()).and_then(|s| s.parse::<usize>().ok());
        n.filter(|n| (2..=10).contains(n)).unwrap_or(3)
    }
    fn changed(&self, project: i64) {
        let _ = self.app.emit("supa-changed", json!({ "project_id": project }));
    }
}

fn engine(app: &AppHandle) -> Arc<Engine> {
    app.state::<Arc<Engine>>().inner().clone()
}

async fn blocking<T: Send + 'static>(app: &AppHandle, f: impl FnOnce(Arc<Engine>) -> T + Send + 'static) -> Result<T, String> {
    let e = engine(app);
    tauri::async_runtime::spawn_blocking(move || f(e)).await.map_err(|_| "onverwacht".to_string())
}

#[derive(Serialize)]
pub struct SupaState {
    pub gekoppeld: bool,
    pub naam: String,
    pub referentie: String,
    pub regio: String,
    pub niveau: Level,
    pub volledig_resterend: Option<i64>,
    pub volledig_secs: i64,
}

#[tauri::command]
pub async fn supa_state(app: AppHandle, project_id: i64) -> Result<SupaState, String> {
    blocking(&app, move |e| match e.link(project_id) {
        None => SupaState { gekoppeld: false, naam: String::new(), referentie: String::new(), regio: String::new(), niveau: Level::Voorzichtig, volledig_resterend: None, volledig_secs: FULL_DEFAULT_SECS },
        Some(_) => {
            let niveau = e.level(project_id);
            let l = e.link(project_id).expect("koppeling bestaat");
            let now = crate::connect::manager::real_now();
            SupaState { gekoppeld: true, naam: l.name.clone(), referentie: l.reference.clone(), regio: l.region.clone(), niveau, volledig_resterend: l.state().full_left(now), volledig_secs: l.full_secs }
        }
    })
    .await
}

#[tauri::command]
pub async fn supa_projects(app: AppHandle) -> Result<Value, String> {
    blocking(&app, |e| match e.projects() {
        Ok((p, o)) => json!({ "projecten": p, "organisaties": o }),
        Err(err) => json!({ "fout": err.code() }),
    })
    .await
}

#[tauri::command]
pub async fn supa_link(app: AppHandle, project_id: i64, reference: String) -> Result<Reply, String> {
    blocking(&app, move |e| e.link_project(project_id, &reference)).await
}

#[tauri::command]
pub async fn supa_create(app: AppHandle, project_id: i64, naam: String) -> Result<Reply, String> {
    blocking(&app, move |e| e.create_project(project_id, &naam, None, Actor::Gebruiker)).await
}

#[tauri::command]
pub async fn supa_unlink(app: AppHandle, project_id: i64) -> Result<(), String> {
    blocking(&app, move |e| e.unlink(project_id)).await
}

#[tauri::command]
pub async fn supa_wake(app: AppHandle, project_id: i64) -> Result<Reply, String> {
    blocking(&app, move |e| e.wake(project_id)).await
}

#[tauri::command]
pub async fn supa_set_level(app: AppHandle, project_id: i64, niveau: String, bevestiging: Option<String>) -> Result<(), String> {
    blocking(&app, move |e| e.set_level(project_id, Level::parse(&niveau), bevestiging.as_deref()).map_err(String::from)).await?
}

#[tauri::command]
pub async fn supa_set_duration(app: AppHandle, project_id: i64, seconden: i64) -> Result<(), String> {
    blocking(&app, move |e| e.set_full_duration(project_id, seconden)).await
}

#[tauri::command]
pub async fn supa_emergency(app: AppHandle, project_id: i64) -> Result<(), String> {
    blocking(&app, move |e| e.emergency_stop(project_id)).await
}

#[tauri::command]
pub fn supa_actions(db: State<Db>, project_id: i64) -> Vec<store::Action> {
    db.conn().map(|c| store::actions(&c, project_id, 100)).unwrap_or_default()
}

#[tauri::command]
pub async fn supa_undo(app: AppHandle, project_id: i64, actie: i64) -> Result<Reply, String> {
    blocking(&app, move |e| e.undo(project_id, actie)).await
}

#[tauri::command]
pub fn supa_confirm_answer(confirmer: State<Arc<UiConfirmer>>, id: String, toestaan: bool) -> bool {
    confirmer.answer(&id, toestaan)
}

#[tauri::command]
pub async fn supa_tables(app: AppHandle, project_id: i64) -> Result<Value, String> {
    blocking(&app, move |e| match e.overview(project_id) {
        Ok(t) => json!({ "tabellen": t }),
        Err(r) => json!({ "fout": r.tekst }),
    })
    .await
}

#[tauri::command]
pub async fn supa_rows(app: AppHandle, project_id: i64, tabel: String, pagina: u32) -> Result<Value, String> {
    blocking(&app, move |e| match e.rows(project_id, &tabel, pagina) {
        Ok(p) => serde_json::to_value(p).unwrap_or(Value::Null),
        Err(r) => json!({ "fout": r.tekst }),
    })
    .await
}

#[tauri::command]
pub async fn supa_row_save(app: AppHandle, project_id: i64, tabel: String, sleutel: Option<serde_json::Map<String, Value>>, waarden: serde_json::Map<String, Value>) -> Result<Reply, String> {
    blocking(&app, move |e| e.row_save(project_id, &tabel, sleutel.as_ref(), &waarden)).await
}

#[tauri::command]
pub async fn supa_users(app: AppHandle, project_id: i64) -> Result<Value, String> {
    blocking(&app, move |e| match e.users(project_id) {
        Ok(u) => json!({ "gebruikers": u }),
        Err(r) => json!({ "fout": r.tekst }),
    })
    .await
}

#[tauri::command]
pub async fn supa_security_check(app: AppHandle, project_id: i64) -> Result<Value, String> {
    blocking(&app, move |e| match e.security_check(project_id) {
        Ok(f) => json!({ "bevindingen": f }),
        Err(r) => json!({ "fout": r.tekst }),
    })
    .await
}

/// Vrije SQL van de gebruiker zelf (alleen onder "Voor gevorderden"). Lezen is vrij; schrijven vraagt altijd een bevestiging.
#[tauri::command]
pub async fn supa_sql(app: AppHandle, project_id: i64, sql: String) -> Result<Reply, String> {
    blocking(&app, move |e| e.run_sql(project_id, "sql_venster", &sql, Actor::Gebruiker)).await
}

#[tauri::command]
pub async fn supa_write_config(app: AppHandle, project_id: i64) -> Result<Reply, String> {
    blocking(&app, move |e| e.write_project_config(project_id)).await
}

#[tauri::command]
pub async fn supa_status(app: AppHandle, project_id: i64) -> Result<Reply, String> {
    blocking(&app, move |e| e.status(project_id)).await
}

/// Opdrachten van de MCP-tools (Node → app). De AI geeft alleen gewone gegevens mee; alle sleutels blijven hier.
pub fn host(app: &AppHandle, project: i64, cmd: &str, args: &Value) -> Result<Value, String> {
    let e = engine(app);
    let s = |k: &str| args[k].as_str().unwrap_or("").to_string();
    // "Eerst overleggen": de AI mag dan niets wijzigen, ook niet in de database.
    let schrijft = !matches!(cmd, "db.status" | "db.public_config" | "db.list_tables" | "db.readonly" | "db.logs" | "db.advisors" | "db.types");
    if schrijft && app.state::<ChatManager>().mode(project) == "plan" {
        return Ok(serde_json::to_value(Reply { status: "geweigerd", tekst: "De AI werkt nu in ‘Eerst overleggen’. Er wordt niets gewijzigd. Bespreek je plan met de gebruiker; die zet het gesprek op ‘Bouwen’ als het mag.".into(), data: None }).unwrap_or(Value::Null));
    }
    let reply = match cmd {
        "db.status" => e.status(project),
        "db.public_config" => e.public_config(project),
        "db.list_tables" => e.list_tables(project),
        "db.readonly" => e.readonly_query(project, &s("sql"), args["limiet"].as_u64().unwrap_or(100) as usize),
        "db.logs" => e.logs(project, &s("bron"), args["minuten"].as_u64().unwrap_or(60) as u32),
        "db.advisors" => e.advisors(project),
        "db.types" => e.types(project),
        "db.propose" => e.propose_migration(project, &s("naam"), &s("sql")),
        "db.apply" => e.apply_migration(project, &s("naam"), &s("sql"), &s("uitleg")),
        "db.rollback" => e.rollback_migration(project, &s("naam")),
        "db.run_sql" => e.run_sql_with(project, "db_run_sql", &s("sql"), Actor::Ai, &s("uitleg")),
        "db.deploy" => e.deploy_function(project, &s("naam"), &s("code")),
        "db.secret" => e.set_edge_secret(project, &s("naam"), &s("waarde")),
        "db.storage" => e.manage_storage(project, &s("actie"), &s("naam"), args["publiek"].as_bool().unwrap_or(false)),
        "db.auth" => e.configure_auth(project, &args["instellingen"]),
        "db.pause" => e.pause_project(project),
        "db.restore" => e.restore_project(project),
        "db.create" => e.create_project(project, &s("naam"), args["organisatie"].as_str(), Actor::Ai),
        _ => return Err("Onbekende opdracht aan Studio.".into()),
    };
    serde_json::to_value(reply).map_err(|e| e.to_string())
}
