//! Vragen van de MCP-server (Node) aan de app. Studio voert alles zelf uit en bewaart alle sleutels; de AI krijgt alleen een antwoord.
use crate::chat::ChatManager;
use crate::connect::manager::Manager;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Manager as _};

const DIENSTEN: [&str; 3] = ["github", "vercel", "supabase"];

pub fn handle(app: &AppHandle, project_id: i64, cmd: &str, args: &Value) -> Result<Value, String> {
    match cmd {
        "connect.status" => {
            let m = app.state::<Arc<Manager>>();
            Ok(serde_json::to_value(m.ai_status()).unwrap_or(json!([])))
        }
        "connect.propose" => {
            let dienst = args["dienst"].as_str().unwrap_or("");
            if !DIENSTEN.contains(&dienst) {
                return Err("Onbekende dienst.".into());
            }
            let reden: String = args["reden"].as_str().unwrap_or("").chars().take(200).collect();
            app.state::<ChatManager>().post_message(project_id, "connect_offer", json!({ "provider": dienst, "reason": reden }));
            Ok(json!({ "ok": true }))
        }
        c if c.starts_with("winkel.") => crate::winkels::app::host(app, project_id, c, args),
        c if c.starts_with("vercel.") => crate::vercel::app::host(app, project_id, c, args),
        c if c.starts_with("github.") => crate::github::app::host(app, project_id, c, args),
        c if c.starts_with("db.") => crate::supa::app::host(app, project_id, c, args),
        _ => Err("Onbekende opdracht aan Studio.".into()),
    }
}
