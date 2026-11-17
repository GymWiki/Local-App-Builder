mod accounts;
mod cli;
mod commands;
mod db;
mod error;
mod instructions;
mod mcp;
mod mcp_config;
mod node;
mod projects;
mod provider;
mod terminal;

use mcp::{McpEvent, McpManager};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use terminal::{PtyEvent, TerminalManager};

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
                app.state::<TerminalManager>().close_all();
                app.state::<McpManager>().stop_all();
            }
        });
}
