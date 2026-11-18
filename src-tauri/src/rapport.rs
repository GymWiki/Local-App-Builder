//! Het probleemrapport: een tekst die de gebruiker kan kopiëren en meesturen als iets niet werkt. Bevat nooit geheimen, tokens,
//! accountnamen, inhoud van projecten of gesprekken; paden met een gebruikersnaam worden vervangen door `~`.
use crate::systeemcheck::Rapport as Systeem;
use rusqlite::Connection;
use std::path::Path;

/// Vervangt de thuismap in een tekst door `~`.
pub fn anoniem(tekst: &str, home: Option<&Path>) -> String {
    let mut t = tekst.to_string();
    if let Some(h) = home {
        let h = h.to_string_lossy();
        if h.len() > 3 {
            t = t.replace(h.as_ref(), "~");
            t = t.replace(&h.replace('\\', "/"), "~");
        }
    }
    t
}

fn instellingen(c: &Connection) -> Vec<String> {
    // Alleen schakelaars en keuzes, nooit een map of een tekst van de gebruiker.
    const OK: &[&str] = &["communication_mode", "permission_mode", "plan_default", "loop_threshold", "theme", "text_scale", "preview_auto_switch", "menu_collapsed", "update_check", "eerste_start_klaar"];
    OK.iter().filter_map(|k| crate::db::get_setting(c, &format!("ui:{k}")).ok().flatten().map(|v| format!("  {k} = {v}"))).collect()
}

fn koppelingen(c: &Connection) -> Vec<String> {
    let Ok(mut st) = c.prepare("SELECT provider, status FROM connections ORDER BY provider") else { return vec![] };
    st.query_map([], |r| Ok(format!("  {}: {}", r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map(|r| r.flatten().collect()).unwrap_or_default()
}

fn fouten_in_gesprek(c: &Connection, project: i64) -> Vec<String> {
    let Ok(mut st) = c.prepare("SELECT payload FROM chat_messages WHERE project_id=?1 AND kind='error' ORDER BY id DESC LIMIT 10") else { return vec![] };
    st.query_map([project], |r| r.get::<_, String>(0))
        .map(|rows| {
            rows.flatten()
                .filter_map(|p| serde_json::from_str::<serde_json::Value>(&p).ok())
                // Alleen de vaste foutcode, nooit de technische tekst (die kan iets van de gebruiker bevatten).
                .filter_map(|v| v["code"].as_str().map(|c| format!("  {c}")))
                .collect()
        })
        .unwrap_or_default()
}

fn aanroepen(c: &Connection, project: i64) -> Vec<String> {
    let Ok(mut st) = c.prepare("SELECT tool, SUM(ok), COUNT(*) FROM mcp_calls WHERE project_id=?1 GROUP BY tool ORDER BY tool") else { return vec![] };
    st.query_map([project], |r| Ok(format!("  {}: {} gelukt van {}", r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))).map(|r| r.flatten().collect()).unwrap_or_default()
}

pub fn bouw(c: &Connection, versie: &str, systeem: &Systeem, project: Option<(i64, &str)>, route: Option<String>, home: Option<&Path>) -> String {
    let mut r: Vec<String> = vec![
        "PROBLEEMRAPPORT STUDIO".into(),
        format!("Versie: {versie}"),
        format!("Systeem: {} {}", std::env::consts::OS, std::env::consts::ARCH),
        String::new(),
        "Systeemcheck:".into(),
    ];
    r.extend(systeem.punten.iter().map(|p| format!("  {}: {}{}", p.id, p.status, p.detail.as_ref().map(|d| format!(" ({d})")).unwrap_or_default())));
    r.push(String::new());
    r.push("Instellingen:".into());
    r.extend(instellingen(c));
    r.push(String::new());
    r.push("Koppelingen (alleen status):".into());
    r.extend(koppelingen(c));
    if let Some((id, template)) = project {
        r.push(String::new());
        r.push(format!("Project: soort {template}"));
        if let Some(route) = route {
            r.push(format!("Route: {route}"));
        }
        r.push("Laatste fouten in het gesprek (alleen codes):".into());
        r.extend(fouten_in_gesprek(c, id));
        r.push("Aanroepen van hulpmiddelen:".into());
        r.extend(aanroepen(c, id));
    }
    r.push(String::new());
    r.push("Dit rapport bevat geen wachtwoorden, sleutels, namen of inhoud van je project.".into());
    // Voor het geval er toch iets in is gekomen: sleutels maskeren en paden anonimiseren.
    crate::github::scan::redact(&anoniem(&r.join("\n"), home))
}

#[tauri::command(async)]
pub fn maak_probleemrapport(app: tauri::AppHandle, db: tauri::State<crate::commands::Db>, project_id: Option<i64>) -> Result<String, String> {
    use tauri::Manager;
    let data = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir());
    let systeem = crate::systeemcheck::check(&data, &data.join("projecten"));
    let c = db.conn().map_err(|e| e.to_string())?;
    let project = project_id.and_then(|id| crate::projects::get(&c, id).ok().map(|p| (id, p.template.clone(), p.pad)));
    let route = project.as_ref().and_then(|(id, _, pad)| serde_json::to_string(&crate::route::feiten(&c, Path::new(pad), *id)).ok());
    let home = app.path().home_dir().ok();
    Ok(bouw(&c, &app.package_info().version.to_string(), &systeem, project.as_ref().map(|(i, t, _)| (*i, t.as_str())), route, home.as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::systeemcheck::Punt;

    #[test]
    fn het_rapport_bevat_geen_geheimen_namen_paden_of_inhoud() {
        let mut c = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut c).unwrap();
        c.execute("INSERT INTO projects (id, naam, pad, template) VALUES (1, 'Geheime Winkel van Jan', '/home/jan/geheim', 'start-webshop')", []).unwrap();
        crate::db::set_setting(&c, "ui:default_project_dir", "/home/jan/projecten").unwrap();
        crate::db::set_setting(&c, "ui:permission_mode", "important").unwrap();
        let token = ["ghp", "_", &"q1Wx".repeat(9)].concat();
        c.execute("INSERT INTO connections (provider, status, account) VALUES ('github', 'werkt', 'jan-de-vries')", []).unwrap();
        c.execute("INSERT INTO chat_messages (project_id, kind, payload) VALUES (1, 'error', ?1)", [format!("{{\"code\":\"rate_limit\",\"technical\":\"/home/jan/x {token}\"}}")]).unwrap();
        c.execute("INSERT INTO mcp_calls (project_id, tool, ok, duration_ms, summary) VALUES (1, 'run_checks', 1, 10, 'inhoud van het project jan-de-vries')", []).unwrap();
        let sys = Systeem { klaar: true, punten: vec![Punt { id: "node", status: "ok", detail: Some("v22 /home/jan/.nvm".into()) }] };
        let r = bouw(&c, "0.1.0", &sys, Some((1, "start-webshop")), Some("{}".into()), Some(Path::new("/home/jan")));
        for verboden in ["jan-de-vries", "Geheime Winkel", "/home/jan", &token, "inhoud van het project", "technical"] {
            assert!(!r.contains(verboden), "{verboden} staat in het rapport:\n{r}");
        }
        for verwacht in ["Versie: 0.1.0", "node: ok", "permission_mode = important", "github: werkt", "soort start-webshop", "rate_limit", "run_checks: 1 gelukt van 1", "bevat geen wachtwoorden"] {
            assert!(r.contains(verwacht), "{verwacht} ontbreekt:\n{r}");
        }
        assert!(!r.contains("default_project_dir"), "een map van de gebruiker hoort niet in het rapport");
    }
}
