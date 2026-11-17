mod accounts;
mod claude_approval;
mod cli;
mod commands;
mod db;
mod error;
mod instructions;
mod mcp;
mod mcp_config;
mod node;
mod preview;
mod projects;
mod provider;
mod terminal;

use mcp::{McpEvent, McpManager};
use preview::{Bridge, PreviewEvent, PreviewManager};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use terminal::{PtyEvent, TerminalManager};

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

fn mcp_scripts(app: &tauri::App) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Ok(d) = app.path().resource_dir() {
        v.push(d.join("mcp-server").join("index.mjs"));
    }
    v.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../mcp-server/dist/index.mjs"));
    v
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
                app.state::<PreviewManager>().close_all();
                app.state::<TerminalManager>().close_all();
                app.state::<McpManager>().stop_all();
            }
        });
}
