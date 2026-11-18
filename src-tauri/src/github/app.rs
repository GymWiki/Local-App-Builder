//! Verbinding tussen de GitHub-motor en de app: Tauri-commando's en (later) de opdrachten van de MCP-tools.
use super::api::RepoItem;
use super::engine::{Actor, Engine, State};
use super::Uitkomst;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

fn engine(app: &AppHandle) -> Arc<Engine> {
    app.state::<Arc<Engine>>().inner().clone()
}

async fn blocking<T: Send + 'static>(app: &AppHandle, f: impl FnOnce(Arc<Engine>) -> T + Send + 'static) -> Result<T, String> {
    let e = engine(app);
    tauri::async_runtime::spawn_blocking(move || f(e)).await.map_err(|_| "onverwacht".to_string())
}

#[tauri::command]
pub async fn github_state(app: AppHandle, project_id: i64) -> Result<State, String> {
    blocking(&app, move |e| e.state(project_id)).await
}

#[tauri::command]
pub async fn github_suggest_name(app: AppHandle, project_id: i64, naam: Option<String>) -> Result<Value, String> {
    blocking(&app, move |e| match e.suggest_name(project_id, naam.as_deref()) {
        Ok(v) => v,
        Err(err) => json!({ "fout": err.code() }),
    })
    .await
}

#[tauri::command]
pub async fn github_first_backup(app: AppHandle, project_id: i64, naam: String, openbaar: bool, openbaar_bevestigd: bool) -> Result<Uitkomst, String> {
    blocking(&app, move |e| e.first_backup(project_id, &naam, openbaar, openbaar_bevestigd)).await
}

#[tauri::command]
pub async fn github_backup(app: AppHandle, project_id: i64) -> Result<Uitkomst, String> {
    blocking(&app, move |e| e.backup(project_id, Actor::Gebruiker)).await
}

#[tauri::command]
pub async fn github_unlink(app: AppHandle, project_id: i64) -> Result<(), String> {
    blocking(&app, move |e| e.unlink(project_id)).await
}

#[tauri::command]
pub async fn github_set_auto(app: AppHandle, project_id: i64, aan: bool) -> Result<(), String> {
    blocking(&app, move |e| e.set_auto(project_id, aan)).await
}

#[tauri::command]
pub async fn github_set_ai_ask(app: AppHandle, project_id: i64, vraagt: bool) -> Result<(), String> {
    blocking(&app, move |e| e.set_ai_ask(project_id, vraagt)).await
}

#[tauri::command]
pub async fn github_list_repos(app: AppHandle) -> Result<Value, String> {
    blocking(&app, |e| match e.list_repos() {
        Ok(l) => json!({ "repos": l as Vec<RepoItem> }),
        Err(err) => json!({ "fout": err.code() }),
    })
    .await
}

#[tauri::command]
pub async fn github_scan(app: AppHandle, project_id: i64, openbaar: bool) -> Result<Value, String> {
    blocking(&app, move |e| e.scan_now(project_id, openbaar)).await
}

/// Een project van GitHub ophalen: klonen in een nieuwe map, als project opnemen, koppelen en vertellen wat we herkennen.
#[tauri::command]
pub async fn github_import(app: AppHandle, eigenaar: String, repo: String, privaat: bool, bovenliggend_pad: String) -> Result<Value, String> {
    let app2 = app.clone();
    blocking(&app, move |e| {
        let app = app2;
        let Some(map) = super::importer::folder_for(&repo) else { return json!({ "fout": "naam_ongeldig" }) };
        let parent = std::path::PathBuf::from(&bovenliggend_pad);
        if !parent.is_dir() {
            return json!({ "fout": "locatie_bestaat_niet" });
        }
        let dest = parent.join(&map);
        if dest.exists() {
            return json!({ "fout": "map_bestaat" });
        }
        let emit = app.clone();
        let res = e.clone_repo(&eigenaar, &repo, &dest, &mut |klaar, totaal| {
            let _ = emit.emit("github-import-voortgang", json!({ "klaar": klaar, "totaal": totaal }));
        });
        if let Err(err) = res {
            let _ = std::fs::remove_dir_all(&dest); // alleen de map die we net zelf maakten
            return json!({ "fout": err.code() });
        }
        let info = super::importer::inspect(&dest);
        let project = {
            let db = app.state::<crate::commands::Db>();
            let Ok(c) = db.conn() else { return json!({ "fout": "onverwacht" }) };
            crate::projects::register_existing(&c, &repo, &dest, info.template)
        };
        match project {
            Ok(p) => {
                e.link_cloned(p.id, &eigenaar, &repo, privaat, &dest);
                json!({ "project": p, "herkend": super::importer::inspect(&dest) })
            }
            Err(_) => json!({ "fout": "onverwacht" }),
        }
    })
    .await
}

/// Opdrachten van de MCP-tools (Node → app). De AI krijgt alleen gewone gegevens; nooit een token.
pub fn host(app: &AppHandle, project: i64, cmd: &str, _args: &Value) -> Result<Value, String> {
    let e = engine(app);
    let reply = |status: &'static str, tekst: String, data: Option<Value>| serde_json::to_value(crate::supa::engine::Reply { status, tekst, data }).map_err(|x| x.to_string());
    match cmd {
        "github.status" => reply("uitgevoerd", "GitHub-status van dit project.".into(), Some(e.ai_status(project))),
        "github.list_repos" => match e.list_repos() {
            Ok(l) => {
                let namen: Vec<Value> = l.iter().take(200).map(|r| json!({ "repository": format!("{}/{}", r.eigenaar, r.naam), "privaat": r.privaat })).collect();
                reply("uitgevoerd", format!("{} repositories.", namen.len()), Some(Value::Array(namen)))
            }
            Err(err) => {
                let u = Uitkomst::fout(&err);
                reply("mislukt", u.ai_tekst(), None)
            }
        },
        "github.backup" => {
            // "Eerst overleggen": de AI mag dan niets versturen.
            if app.state::<crate::chat::ChatManager>().mode(project) == "plan" {
                let u = Uitkomst::nee("plan_modus", json!({}));
                return reply("geweigerd", u.ai_tekst(), None);
            }
            let u = e.backup(project, Actor::Ai);
            reply(u.status, u.ai_tekst(), None)
        }
        _ => Err("Onbekende opdracht aan Studio.".into()),
    }
}

/// Na een opgeslagen versie: is "automatisch een back-up maken" aan voor dit project? Dan een korte wachttijd (meer versies kort na
/// elkaar worden samen verstuurd) en daarna een gewone back-up. Zonder koppeling of bij een probleem gebeurt er niets bijzonders:
/// een uiteengelopen of mislukte back-up wordt alleen in de status getoond.
pub fn auto_backup(app: &AppHandle, project: i64) {
    let e = engine(app);
    if !e.link(project).map(|l| l.auto_backup).unwrap_or(false) {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(AUTO_WAIT_SECS));
        let _ = e.backup(project, Actor::Auto);
    });
}

const AUTO_WAIT_SECS: u64 = 5;
