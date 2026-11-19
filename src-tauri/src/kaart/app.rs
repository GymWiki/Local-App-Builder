//! Verbinding met de app: opdrachten van de MCP-tools (`kaart.*`) en Tauri-commando's voor de instellingen.
use super::{index, render, vernieuw, zoek};
use crate::commands::Db;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use tauri::{AppHandle, Manager, State};

fn dir_en_aan(app: &AppHandle, project: i64) -> Result<(PathBuf, bool), String> {
    let db = app.state::<Db>();
    let c = db.conn().map_err(|e| e.to_string())?;
    let p = crate::projects::get(&c, project).map_err(|_| "Onbekend project.".to_string())?;
    let aan = crate::db::get_setting(&c, "ui:kaart_aan").ok().flatten().is_none_or(|v| v != "0");
    Ok((PathBuf::from(p.pad), aan))
}

/// Opdrachten van de MCP-server. Vóór elk antwoord wordt de index bijgewerkt (snel: alleen gewijzigde bestanden), dus de kaart loopt nooit achter.
pub fn host(app: &AppHandle, project_id: i64, cmd: &str, args: &Value) -> Result<Value, String> {
    let (dir, aan) = dir_en_aan(app, project_id)?;
    if !aan {
        return Ok(json!({ "tekst": "De projectkaart staat uit in de instellingen. Lees de bestanden zelf." }));
    }
    let stand = vernieuw(&dir, &AtomicBool::new(false), &|_, _| {})?;
    let c = index::open(&dir).map_err(|e| e.to_string())?;
    let getal = |k: &str| args[k].as_u64().map(|x| x as usize);
    let tekst = match cmd {
        "kaart.kaart" => {
            if args["uitgebreid"].as_bool().unwrap_or(false) {
                render::uitgebreid(&c, getal("pagina").unwrap_or(1))
            } else {
                render::kort(&c)
            }
        }
        "kaart.zoek_symbool" => zoek::zoek_symbool(&c, args["naam"].as_str().unwrap_or(""), getal("vanaf").unwrap_or(0), getal("limiet")),
        "kaart.bestanden_voor_taak" => zoek::bestanden_voor_taak(&c, args["omschrijving"].as_str().unwrap_or(""), getal("limiet")),
        "kaart.afhankelijkheden" => zoek::afhankelijkheden(&c, args["pad"].as_str().unwrap_or(""), getal("vanaf").unwrap_or(0), getal("limiet")),
        "kaart.schema" => zoek::schema_database(&c),
        "kaart.kit" => zoek::kit_componenten(&c, &args["namen"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect::<Vec<_>>()).unwrap_or_default()),
        _ => return Err("Onbekende opdracht aan de projectkaart.".into()),
    };
    // Bestanden die niet gelezen konden worden, worden eerlijk gemeld (de AI leest ze dan zelf).
    let extra = if stand.terugval.is_empty() { String::new() } else { format!("\n(Niet gelezen voor de kaart, alleen de naam is bekend: {} bestand(en).)", stand.terugval.len()) };
    Ok(json!({ "tekst": format!("{tekst}{extra}") }))
}

#[derive(Serialize)]
pub struct KaartStatus {
    pub aan: bool,
    pub bestanden: usize,
    pub tokens: usize,
    pub terugval: usize,
}

#[tauri::command]
pub async fn kaart_vernieuw(app: AppHandle, project_id: i64) -> Result<KaartStatus, String> {
    let (dir, aan) = dir_en_aan(&app, project_id)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<KaartStatus, String> {
        if !aan {
            return Ok(KaartStatus { aan, bestanden: 0, tokens: 0, terugval: 0 });
        }
        let stand = vernieuw(&dir, &AtomicBool::new(false), &|_, _| {})?;
        status_van(&dir, aan, stand.terugval.len())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn status_van(dir: &std::path::Path, aan: bool, terugval: usize) -> Result<KaartStatus, String> {
    let c = index::open(dir).map_err(|e| e.to_string())?;
    let n: i64 = c.query_row("SELECT COUNT(*) FROM bestand", [], |r| r.get(0)).unwrap_or(0);
    Ok(KaartStatus { aan, bestanden: n as usize, tokens: render::schat_tokens(&render::kort(&c)), terugval })
}

/// De korte kaart als tekst, om te bekijken in Instellingen.
#[tauri::command]
pub async fn kaart_tekst(app: AppHandle, db: State<'_, Db>, project_id: i64) -> Result<String, String> {
    let _ = &db;
    let (dir, _) = dir_en_aan(&app, project_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let c = index::open(&dir).map_err(|e| e.to_string())?;
        Ok(render::kort(&c))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct ContextItem {
    pub id: &'static str,
    pub tokens: usize,
    /// Te groot voor wat er bij elke taak mee moet: de gebruiker krijgt een vriendelijke waarschuwing.
    pub te_groot: bool,
}

/// "Wat gaat er naar de AI?": de vaste onderdelen met een schatting (tekens/4) van hun grootte.
#[tauri::command]
pub async fn kaart_context(app: AppHandle, project_id: i64) -> Result<Vec<ContextItem>, String> {
    let (dir, _) = dir_en_aan(&app, project_id)?;
    tauri::async_runtime::spawn_blocking(move || Ok(context(&dir))).await.map_err(|e| e.to_string())?
}

/// Budgetten (in tokens, geschat): wat bij élke taak meegaat moet klein blijven. Bron van de richtlijn voor CLAUDE.md: docs/tokens.md §3.
pub const BUDGET_INSTRUCTIES: usize = 2500;
pub const BUDGET_NOTITIES: usize = 1500;

pub fn context(dir: &std::path::Path) -> Vec<ContextItem> {
    let tok = |rel: &str| std::fs::read_to_string(dir.join(rel)).map(|t| render::schat_tokens(&t)).unwrap_or(0);
    let instructies = ["CLAUDE.md", "GEMINI.md", "AGENTS.md"].iter().map(|f| tok(f)).max().unwrap_or(0);
    let notities = tok("PROJECT.md");
    let kaart = tok(".studio/kaart.md");
    vec![
        ContextItem { id: "instructies", tokens: instructies, te_groot: instructies > BUDGET_INSTRUCTIES },
        ContextItem { id: "notities", tokens: notities, te_groot: notities > BUDGET_NOTITIES },
        ContextItem { id: "kaart", tokens: kaart, te_groot: kaart > render::KORT_MAX_TEKENS / 4 + 500 },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_meet_de_vaste_onderdelen_en_waarschuwt_bij_te_groot() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("CLAUDE.md"), "x".repeat(4000)).unwrap();
        std::fs::write(d.path().join("PROJECT.md"), "y".repeat(8000)).unwrap();
        let c = context(d.path());
        assert_eq!(c.iter().find(|i| i.id == "instructies").map(|i| (i.tokens, i.te_groot)), Some((1000, false)));
        assert_eq!(c.iter().find(|i| i.id == "notities").map(|i| (i.tokens, i.te_groot)), Some((2000, true)));
        assert_eq!(c.iter().find(|i| i.id == "kaart").map(|i| i.tokens), Some(0));
    }
}
