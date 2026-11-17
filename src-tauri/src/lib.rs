mod accounts;
mod assets;
mod chat;
mod claude_approval;
mod cli;
mod commands;
mod db;
mod error;
mod export;
mod improve;
mod instructions;
mod mcp;
mod mcp_config;
mod node;
mod preview;
mod projects;
mod provider;
mod templates;
mod terminal;
mod winpath;

use chat::{ChatManager, ChatOut};
use mcp::{McpEvent, McpManager};
use preview::{Bridge, PreviewEvent, PreviewManager};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use terminal::{PtyEvent, TerminalManager};

/// Git-acties voor automatische versies, via de Node-runtime van het project.
struct AppGit {
    handle: tauri::AppHandle,
}

impl AppGit {
    fn call(&self, project: i64, cmd: &str, args: serde_json::Value) -> Option<serde_json::Value> {
        self.handle
            .state::<McpManager>()
            .call(project, cmd, args, std::time::Duration::from_secs(30))
            .ok()
    }
}

impl chat::Git for AppGit {
    fn head(&self, project: i64) -> Option<chat::Version> {
        let list = self.call(project, "git.list", serde_json::json!({ "limit": 1 }))?;
        let c = list.as_array()?.first()?;
        Some(chat::Version {
            hash: c["hash"].as_str()?.to_string(),
            title: c["message"].as_str()?.to_string(),
        })
    }
    fn dirty(&self, project: i64) -> bool {
        self.call(project, "git.status", serde_json::json!({}))
            .map(|v| v["dirty"] == true)
            .unwrap_or(false)
    }
    fn checkpoint(&self, project: i64, title: &str) -> Option<chat::Version> {
        let r = self.call(
            project,
            "git.checkpoint",
            serde_json::json!({ "message": title }),
        )?;
        (r["created"] == true).then(|| chat::Version {
            hash: r["hash"].as_str().unwrap_or("").to_string(),
            title: title.to_string(),
        })
    }
}

/// Chatgeschiedenis en instellingen in de app-database.
struct AppStore {
    handle: tauri::AppHandle,
}

impl AppStore {
    fn with<T>(
        &self,
        f: impl FnOnce(&rusqlite::Connection) -> error::Result<T>,
    ) -> error::Result<T> {
        let db = self.handle.state::<commands::Db>();
        let guard = db.conn()?;
        f(&guard)
    }
}

impl chat::Store for AppStore {
    fn insert(
        &self,
        project: i64,
        kind: &str,
        payload: serde_json::Value,
    ) -> error::Result<chat::store::StoredMessage> {
        self.with(|c| chat::store::insert(c, project, kind, &payload))
    }
    fn update(
        &self,
        id: i64,
        payload: serde_json::Value,
    ) -> error::Result<chat::store::StoredMessage> {
        self.with(|c| chat::store::update(c, id, &payload))
    }
    fn session(&self, project: i64) -> Option<chat::store::SessionRow> {
        self.with(|c| chat::store::session(c, project))
            .ok()
            .flatten()
    }
    fn set_session(
        &self,
        project: i64,
        provider: &str,
        account: Option<i64>,
        session: Option<&str>,
    ) {
        let _ = self.with(|c| chat::store::set_session(c, project, provider, account, session));
    }
    fn setting(&self, key: &str) -> Option<String> {
        self.with(|c| db::get_setting(c, key)).ok().flatten()
    }
    fn set_setting(&self, key: &str, value: &str) {
        let _ = self.with(|c| db::set_setting(c, key, value));
    }
    fn last_working(&self, project: i64) -> Option<(String, String)> {
        self.with(|c| chat::store::last_working_version(c, project))
            .ok()
            .flatten()
    }
}

/// Verbindt de preview met de rest van de app (runtime, instellingen).
struct AppBridge {
    handle: tauri::AppHandle,
}

impl Bridge for AppBridge {
    fn call(
        &self,
        id: i64,
        cmd: &str,
        args: serde_json::Value,
        timeout: std::time::Duration,
    ) -> error::Result<serde_json::Value> {
        self.handle
            .state::<McpManager>()
            .call(id, cmd, args, timeout)
    }
    fn runtime_info(&self, id: i64) -> Option<mcp::McpInfo> {
        self.handle.state::<McpManager>().info(id)
    }
    fn get_setting(&self, key: &str) -> Option<String> {
        let db = self.handle.state::<commands::Db>();
        let conn = db.conn().ok()?;
        db::get_setting(&conn, key).ok().flatten()
    }
    fn set_setting(&self, key: &str, value: &str) {
        let db = self.handle.state::<commands::Db>();
        let conn = db.conn();
        if let Ok(conn) = conn {
            let _ = db::set_setting(&conn, key, value);
        }
    }
}

/// Mogelijke plekken van het MCP-serverbestand. Debug (tauri dev): de verse build in de repo gaat voor op de
/// kopie in target/debug (die kan verouderd zijn). Release: het meegeleverde resource-bestand.
fn mcp_scripts(app: &tauri::App) -> Vec<PathBuf> {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../mcp-server/dist/index.mjs");
    let bundled = app
        .path()
        .resource_dir()
        .ok()
        .map(|d| d.join("mcp-server").join("index.mjs"));
    if cfg!(debug_assertions) {
        std::iter::once(dev).chain(bundled).collect()
    } else {
        bundled.into_iter().chain(std::iter::once(dev)).collect()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let profiles = dir.join("profiles");
            std::fs::create_dir_all(&profiles)?;
            app.manage(commands::Db(Mutex::new(db::open(&dir.join("studio.db"))?)));
            app.manage(commands::Profiles(profiles));

            let handle = app.handle().clone();
            app.manage(TerminalManager::new(Arc::new(move |ev| match ev {
                PtyEvent::Output(o) => {
                    let _ = handle.emit("pty-output", o);
                }
                PtyEvent::Exit(e) => {
                    let _ = handle.emit("pty-exit", e);
                }
            })));

            let handle = app.handle().clone();
            let sink: mcp::McpSink = Arc::new(move |ev| match ev {
                McpEvent::Status { project_id, info } => {
                    let _ = handle.emit(
                        "mcp-status",
                        serde_json::json!({ "project_id": project_id, "info": info }),
                    );
                }
                McpEvent::Tool {
                    project_id,
                    tool,
                    ok,
                    ms,
                    summary,
                } => {
                    let db = handle.state::<commands::Db>();
                    let conn = db.conn();
                    if let Ok(conn) = conn {
                        let _ = mcp::log_call(&conn, project_id, &tool, ok, ms, &summary);
                    }
                }
                McpEvent::Runtime {
                    project_id,
                    payload,
                } => {
                    match payload["event"].as_str() {
                        Some("permission_request") => {
                            let (h, p) = (handle.clone(), payload.clone());
                            std::thread::spawn(move || {
                                let dir = h
                                    .state::<commands::Db>()
                                    .conn()
                                    .ok()
                                    .and_then(|c| projects::get(&c, project_id).ok())
                                    .map(|p| std::path::PathBuf::from(p.pad));
                                if let Some(dir) = dir {
                                    h.state::<ChatManager>()
                                        .on_permission_request(project_id, &dir, &p);
                                }
                            });
                        }
                        Some("permission_expired") => {
                            if let Some(id) = payload["id"].as_str() {
                                handle
                                    .state::<ChatManager>()
                                    .expire_permission(project_id, id);
                            }
                        }
                        _ => {}
                    }
                    if payload["event"] == "dev" {
                        // Op een eigen thread: de verwerking kan de runtime zelf bevragen, en die antwoorden komen via deze lezer binnen.
                        let (h, p) = (handle.clone(), payload.clone());
                        std::thread::spawn(move || {
                            h.state::<PreviewManager>().on_dev_event(project_id, &p)
                        });
                    }
                    if payload["event"] == "checks" {
                        let db = handle.state::<commands::Db>();
                        let conn = db.conn();
                        if let Ok(conn) = conn {
                            let _ = mcp::record_checks(
                                &conn,
                                project_id,
                                payload["ok"].as_bool().unwrap_or(false),
                                &payload["steps"].to_string(),
                            );
                        }
                    }
                    let _ = handle.emit(
                        "runtime-event",
                        serde_json::json!({ "project_id": project_id, "payload": payload }),
                    );
                }
            });
            app.manage(McpManager::new(mcp::new_token(), mcp_scripts(app), sink));

            let (h_out, h_ans, h_store) = (
                app.handle().clone(),
                app.handle().clone(),
                app.handle().clone(),
            );
            let git_handle = app.handle().clone();
            let chat_mgr = ChatManager::new(
                Arc::new(AppStore { handle: h_store }),
                Arc::new(move |out: ChatOut| {
                    let _ = h_out.emit("chat-out", out);
                }),
                Arc::new(
                    move |project: i64, id: &str, allow: bool, message: Option<&str>| {
                        h_ans
                            .state::<McpManager>()
                            .call(
                                project,
                                "permission.answer",
                                serde_json::json!({ "id": id, "allow": allow, "message": message }),
                                std::time::Duration::from_secs(5),
                            )
                            .map(|_| ())
                    },
                ),
            );
            chat_mgr.set_git(Arc::new(AppGit { handle: git_handle }));
            app.manage(chat_mgr);

            let handle = app.handle().clone();
            let bridge = Arc::new(AppBridge {
                handle: app.handle().clone(),
            });
            app.manage(PreviewManager::new(
                bridge,
                Arc::new(move |ev| match ev {
                    PreviewEvent::State { project_id, info } => {
                        let _ = handle.emit(
                            "preview-state",
                            serde_json::json!({ "project_id": project_id, "info": info }),
                        );
                    }
                    PreviewEvent::Available { project_id } => {
                        let _ = handle.emit(
                            "preview-available",
                            serde_json::json!({ "project_id": project_id }),
                        );
                    }
                    PreviewEvent::Reload { project_id } => {
                        let _ = handle.emit(
                            "preview-reload",
                            serde_json::json!({ "project_id": project_id }),
                        );
                    }
                }),
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::create_project,
            commands::delete_project,
            commands::set_default_account,
            commands::list_accounts,
            commands::create_account,
            commands::delete_account,
            commands::cli_status,
            commands::open_project,
            commands::close_project,
            commands::mcp_status,
            commands::runtime_call,
            commands::trust_studio_config,
            commands::last_checks,
            commands::verify_claude_mcp,
            commands::preview_info,
            commands::preview_start,
            commands::preview_stop,
            commands::preview_restart,
            commands::preview_trust_scripts,
            commands::preview_install,
            commands::chat_target,
            commands::chat_history,
            commands::export_project,
            commands::improve_prompt,
            commands::kit_list,
            commands::kit_current,
            commands::kit_apply,
            commands::kit_scripts,
            commands::kit_tailor,
            commands::kit_check,
            commands::kit_strictness,
            commands::chat_send,
            commands::chat_attach,
            commands::chat_asset_data,
            commands::chat_retry,
            commands::chat_busy,
            commands::chat_mode_set,
            commands::chat_stop,
            commands::chat_switch,
            commands::permission_answer,
            commands::get_ui_setting,
            commands::set_ui_setting,
            commands::start_shell,
            commands::start_ai,
            commands::start_login,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_snapshot,
            commands::pty_close
        ])
        .build(tauri::generate_context!())
        .expect("Studio kon niet starten")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<ChatManager>().close_all();
                app.state::<PreviewManager>().close_all();
                app.state::<TerminalManager>().close_all();
                app.state::<McpManager>().stop_all();
            }
        });
}
