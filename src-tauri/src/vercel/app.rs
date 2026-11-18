//! Verbinding tussen de Vercel-motor en de app: haken naar de runtime, Tauri-commando's en de opdrachten van de MCP-tools.
use super::engine::{Actor, Doel, Engine, Hooks, State};
use super::Uitkomst;
use crate::chat::ChatManager;
use crate::commands::Db;
use crate::mcp::McpManager;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub struct AppHooks {
    pub app: AppHandle,
}

impl AppHooks {
    fn call(&self, project: i64, cmd: &str, args: Value, secs: u64) -> Option<Value> {
        self.app.state::<McpManager>().call(project, cmd, args, Duration::from_secs(secs)).ok()
    }
}

impl Hooks for AppHooks {
    fn project_dir(&self, project: i64) -> Option<PathBuf> {
        let db = self.app.state::<Db>();
        let c = db.conn().ok()?;
        crate::projects::get(&c, project).ok().map(|p| PathBuf::from(p.pad))
    }
    fn checkpoint(&self, project: i64, message: &str) -> Option<String> {
        self.call(project, "git.checkpoint", json!({ "message": message }), 20)?["hash"].as_str().map(String::from)
    }
    fn run_checks(&self, project: i64) -> Option<bool> {
        self.call(project, "checks.run", json!({}), 20 * 60)?["ok"].as_bool()
    }
    fn kit_blocks(&self, project: i64) -> bool {
        self.call(project, "kit.check", json!({}), 60).is_some_and(|v| v["enabled"] == true && v["strengheid"] == "blokkeren" && v["findings"].as_array().is_some_and(|f| !f.is_empty()))
    }
    fn security_high(&self, project: i64) -> usize {
        self.call(project, "security.check", json!({}), 60).and_then(|v| v["findings"].as_array().map(|f| f.iter().filter(|x| x["severity"] == "hoog").count())).unwrap_or(0)
    }
    fn stop_ai(&self, project: i64) {
        self.app.state::<ChatManager>().stop(project);
    }
    fn loop_threshold(&self) -> usize {
        let db = self.app.state::<Db>();
        let n = db.conn().ok().and_then(|c| c.query_row("SELECT value FROM settings WHERE key = 'ui:loop_threshold'", [], |r| r.get::<_, String>(0)).ok()).and_then(|s| s.parse::<usize>().ok());
        n.filter(|n| (2..=10).contains(n)).unwrap_or(3)
    }
    fn changed(&self, project: i64) {
        let _ = self.app.emit("vercel-voortgang", json!({ "project_id": project, "stap": "gewijzigd", "klaar": 0, "totaal": 0 }));
    }
}

fn engine(app: &AppHandle) -> Arc<Engine> {
    app.state::<Arc<Engine>>().inner().clone()
}

async fn blocking<T: Send + 'static>(app: &AppHandle, f: impl FnOnce(Arc<Engine>) -> T + Send + 'static) -> Result<T, String> {
    let e = engine(app);
    tauri::async_runtime::spawn_blocking(move || f(e)).await.map_err(|_| "onverwacht".to_string())
}

fn doel(s: &str) -> Doel {
    if s == "live" {
        Doel::Live
    } else {
        Doel::Voorbeeld
    }
}

#[tauri::command]
pub async fn vercel_state(app: AppHandle, project_id: i64) -> Result<State, String> {
    blocking(&app, move |e| e.state(project_id)).await
}

/// Online zetten door de gebruiker zelf. Voor "live" geeft de frontend `bevestigd` pas na zijn eigen bevestigingsdialoog.
#[tauri::command]
pub async fn vercel_deploy(app: AppHandle, project_id: i64, doel_naam: String, bevestigd: bool) -> Result<Uitkomst, String> {
    blocking(&app, move |e| e.deploy(project_id, doel(&doel_naam), Actor::Gebruiker, bevestigd)).await
}

#[tauri::command]
pub fn vercel_cancel(app: AppHandle, project_id: i64) {
    engine(&app).cancel(project_id);
}

#[tauri::command]
pub async fn vercel_deployments(app: AppHandle, project_id: i64) -> Result<Value, String> {
    blocking(&app, move |e| match e.deployments(project_id) {
        Ok(l) => json!({ "lijst": l }),
        Err(err) => json!({ "fout": err.code() }),
    })
    .await
}

#[tauri::command]
pub async fn vercel_rollback(app: AppHandle, project_id: i64, deployment_id: String, bevestigd: bool) -> Result<Uitkomst, String> {
    blocking(&app, move |e| e.rollback(project_id, &deployment_id, Actor::Gebruiker, bevestigd)).await
}

#[tauri::command]
pub async fn vercel_build_summary(app: AppHandle, project_id: i64) -> Result<Value, String> {
    blocking(&app, move |e| match e.build_summary(project_id, None) {
        Ok(v) => v,
        Err(err) => json!({ "fout": err.code() }),
    })
    .await
}

#[tauri::command]
pub async fn vercel_env_list(app: AppHandle, project_id: i64) -> Result<Vec<super::store::EnvRow>, String> {
    blocking(&app, move |e| e.env_list(project_id)).await
}

/// De waarde komt van de gebruiker zelf in het scherm en gaat rechtstreeks naar de kluis; hij wordt nergens teruggegeven.
#[tauri::command]
pub async fn vercel_env_set(app: AppHandle, project_id: i64, naam: String, waarde: String, soort: String, omgevingen: Vec<String>, bevestigd: bool) -> Result<Uitkomst, String> {
    blocking(&app, move |e| e.env_set(project_id, &naam, &waarde, &soort, &omgevingen, "handmatig", bevestigd)).await
}

#[tauri::command]
pub async fn vercel_env_remove(app: AppHandle, project_id: i64, naam: String) -> Result<(), String> {
    blocking(&app, move |e| e.env_remove(project_id, &naam)).await
}

/// De publieke gegevens van de gekoppelde Supabase (adres en publiceerbare sleutel) overnemen. Nooit een geheime sleutel.
#[tauri::command]
pub async fn vercel_env_supabase(app: AppHandle, project_id: i64, bevestigd: bool) -> Result<Uitkomst, String> {
    let supa = app.state::<Arc<crate::supa::engine::Engine>>().inner().clone();
    blocking(&app, move |e| {
        let r = supa.public_config(project_id);
        let (Some(url), Some(key)) = (r.data.as_ref().and_then(|d| d["url"].as_str()).map(String::from), r.data.as_ref().and_then(|d| d["publiceerbare_sleutel"].as_str()).map(String::from)) else {
            return Uitkomst::nee("supabase_niet_gekoppeld", json!({}));
        };
        let dir = e.project_dir_for(project_id);
        let pkg = dir.and_then(|d| std::fs::read_to_string(d.join("package.json")).ok()).unwrap_or_default();
        let (n_url, n_key) = if pkg.contains("\"next\"") { ("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") } else if pkg.contains("\"vite\"") { ("VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY") } else { ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY") };
        let alle: Vec<String> = ["production", "preview", "development"].iter().map(|s| s.to_string()).collect();
        let a = e.env_set(project_id, n_url, &url, "openbaar", &alle, "supabase", bevestigd);
        if !a.is_ok() && a.code != "env_bewaard" {
            return a;
        }
        e.env_set(project_id, n_key, &key, "openbaar", &alle, "supabase", bevestigd)
    })
    .await
}

#[tauri::command]
pub async fn vercel_domain_add(app: AppHandle, project_id: i64, domein: String) -> Result<Value, String> {
    blocking(&app, move |e| match e.domain_add(project_id, &domein.trim().to_lowercase()) {
        Ok(v) => v,
        Err(err) => json!({ "fout": err.code() }),
    })
    .await
}

#[tauri::command]
pub async fn vercel_domain_check(app: AppHandle, project_id: i64, domein: String) -> Result<Value, String> {
    blocking(&app, move |e| match e.domain_check(project_id, &domein.trim().to_lowercase()) {
        Ok(v) => v,
        Err(err) => json!({ "fout": err.code() }),
    })
    .await
}

#[tauri::command]
pub async fn vercel_unlink(app: AppHandle, project_id: i64) -> Result<(), String> {
    blocking(&app, move |e| e.unlink(project_id)).await
}

/// Opdrachten van de MCP-tools (Node → app). De AI krijgt alleen gewone gegevens: nooit een token of een waarde.
pub fn host(app: &AppHandle, project: i64, cmd: &str, args: &Value) -> Result<Value, String> {
    let e = engine(app);
    let reply = |status: &'static str, tekst: String, data: Option<Value>| serde_json::to_value(crate::supa::engine::Reply { status, tekst, data }).map_err(|x| x.to_string());
    let uit = |u: Uitkomst| reply(u.status, u.ai_tekst(), None);
    let schrijft = !matches!(cmd, "vercel.status" | "vercel.list" | "vercel.build_logs");
    // "Eerst overleggen": de AI mag dan niets online zetten, terugzetten of doorsturen.
    if schrijft && app.state::<ChatManager>().mode(project) == "plan" {
        return uit(Uitkomst::nee("plan_modus", json!({})));
    }
    match cmd {
        "vercel.status" => reply("uitgevoerd", "Vercel-status van dit project.".into(), Some(e.ai_status(project))),
        "vercel.preview" => uit(e.deploy(project, Doel::Voorbeeld, Actor::Ai, false)),
        "vercel.live" => uit(e.deploy(project, Doel::Live, Actor::Ai, false)),
        "vercel.rollback" => uit(e.rollback(project, args["deployment"].as_str().unwrap_or(""), Actor::Ai, false)),
        "vercel.set_env" => uit(e.env_push_for_ai(project, args["naam"].as_str().unwrap_or(""))),
        "vercel.list" => match e.deployments(project) {
            Ok(l) => reply("uitgevoerd", format!("{} versies.", l.len()), Some(Value::Array(l.into_iter().take(20).collect()))),
            Err(err) => uit(Uitkomst::fout(&err)),
        },
        "vercel.build_logs" => match e.build_summary(project, None) {
            Ok(v) => reply("uitgevoerd", "Samenvatting van het bouwlogboek van de laatste mislukte bouw.".into(), Some(v)),
            Err(err) => uit(Uitkomst::fout(&err)),
        },
        _ => Err("Onbekende opdracht aan Studio.".into()),
    }
}
