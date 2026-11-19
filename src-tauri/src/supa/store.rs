//! Opslag in SQLite: de koppeling per project (alleen de referentie en het niveau) en het actielog.
use super::policy::{Level, LevelState};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Link {
    pub project_id: i64,
    pub reference: String,
    pub name: String,
    pub region: String,
    pub level: Level,
    pub full_until: Option<i64>,
    pub full_secs: i64,
}

impl Link {
    pub fn state(&self) -> LevelState {
        LevelState { level: self.level, full_until: self.full_until }
    }
}

pub fn link_get(conn: &Connection, project_id: i64) -> Option<Link> {
    conn.query_row("SELECT ref, name, region, level, full_until, full_secs FROM supabase_links WHERE project_id = ?1", params![project_id], |r| {
        Ok(Link { project_id, reference: r.get(0)?, name: r.get(1)?, region: r.get(2)?, level: Level::parse(&r.get::<_, String>(3)?), full_until: r.get(4)?, full_secs: r.get(5)? })
    })
    .optional()
    .ok()
    .flatten()
}

/// Koppelt een project aan een Supabase-project. Een nieuwe koppeling begint altijd op "Voorzichtig".
pub fn link_set(conn: &Connection, project_id: i64, reference: &str, name: &str, region: &str, now: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO supabase_links (project_id, ref, name, region, level, full_until, linked_at) VALUES (?1,?2,?3,?4,'voorzichtig',NULL,?5)
         ON CONFLICT(project_id) DO UPDATE SET ref=?2, name=?3, region=?4, level='voorzichtig', full_until=NULL, linked_at=?5",
        params![project_id, reference, name, region, now],
    )?;
    Ok(())
}

pub fn link_remove(conn: &Connection, project_id: i64) {
    let _ = conn.execute("DELETE FROM supabase_links WHERE project_id = ?1", params![project_id]);
}

pub fn level_set(conn: &Connection, project_id: i64, level: Level, full_until: Option<i64>) -> rusqlite::Result<()> {
    conn.execute("UPDATE supabase_links SET level = ?2, full_until = ?3 WHERE project_id = ?1", params![project_id, level.as_str(), if level == Level::Volledig { full_until } else { None }])?;
    Ok(())
}

pub fn full_secs_set(conn: &Connection, project_id: i64, secs: i64) -> rusqlite::Result<()> {
    conn.execute("UPDATE supabase_links SET full_secs = ?2 WHERE project_id = ?1", params![project_id, super::policy::clamp_full_secs(secs)])?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct Action {
    pub id: i64,
    pub at: i64,
    pub tool: String,
    pub class: i64,
    pub level: String,
    pub status: String,
    pub summary: serde_json::Value,
    pub detail: serde_json::Value,
    pub kan_ongedaan: bool,
    pub undone: bool,
}

pub struct NewAction<'a> {
    pub project_id: i64,
    pub at: i64,
    pub tool: &'a str,
    pub class: u8,
    pub level: &'a str,
    pub status: &'a str,
    pub summary: &'a serde_json::Value,
    pub sql: Option<&'a str>,
    pub detail: &'a serde_json::Value,
    pub undo: Option<(&'a str, &'a str)>,
}

const MAX_SQL_LOG: usize = 20_000;

pub fn action_add(conn: &Connection, a: &NewAction) -> rusqlite::Result<i64> {
    let sql: Option<String> = a.sql.map(|s| s.chars().take(MAX_SQL_LOG).collect());
    conn.execute(
        "INSERT INTO db_actions (project_id, at, tool, class, level, status, summary, sql, detail, undo_kind, undo_data) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![a.project_id, a.at, a.tool, a.class, a.level, a.status, a.summary.to_string(), sql, a.detail.to_string(), a.undo.map(|u| u.0), a.undo.map(|u| u.1)],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn actions(conn: &Connection, project_id: i64, limit: i64) -> Vec<Action> {
    let Ok(mut st) = conn.prepare("SELECT id, at, tool, class, level, status, summary, detail, undo_kind IS NOT NULL, undone FROM db_actions WHERE project_id = ?1 ORDER BY id DESC LIMIT ?2") else { return vec![] };
    st.query_map(params![project_id, limit], |r| {
        Ok(Action {
            id: r.get(0)?,
            at: r.get(1)?,
            tool: r.get(2)?,
            class: r.get(3)?,
            level: r.get(4)?,
            status: r.get(5)?,
            summary: serde_json::from_str(&r.get::<_, String>(6)?).unwrap_or(serde_json::Value::Null),
            detail: serde_json::from_str(&r.get::<_, String>(7)?).unwrap_or(serde_json::Value::Null),
            kan_ongedaan: r.get(8)?,
            undone: r.get::<_, i64>(9)? != 0,
        })
    })
    .map(|it| it.filter_map(Result::ok).collect())
    .unwrap_or_default()
}

pub fn undo_get(conn: &Connection, project_id: i64, id: i64) -> Option<(String, String, bool)> {
    conn.query_row("SELECT undo_kind, undo_data, undone FROM db_actions WHERE id = ?1 AND project_id = ?2 AND undo_kind IS NOT NULL", params![id, project_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)? != 0))).optional().ok().flatten()
}

pub fn undo_done(conn: &Connection, id: i64) {
    let _ = conn.execute("UPDATE db_actions SET undone = 1 WHERE id = ?1", params![id]);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut c).unwrap();
        c.execute("INSERT INTO projects (id, naam, pad, template) VALUES (1, 'P', '/p', 'leeg')", []).unwrap();
        c
    }

    #[test]
    fn koppeling_begint_voorzichtig_en_volledig_heeft_een_einde() {
        let c = conn();
        assert!(link_get(&c, 1).is_none());
        link_set(&c, 1, "abcdefghij", "Winkel", "eu-central-1", 100).unwrap();
        let l = link_get(&c, 1).unwrap();
        assert_eq!((l.reference.as_str(), l.level, l.full_until, l.full_secs), ("abcdefghij", Level::Voorzichtig, None, 3600));
        level_set(&c, 1, Level::Volledig, Some(999)).unwrap();
        assert_eq!(link_get(&c, 1).unwrap().state().effective(500), Level::Volledig);
        assert_eq!(link_get(&c, 1).unwrap().state().effective(999), Level::Zelfstandig);
        // Een ander niveau wist het einde.
        level_set(&c, 1, Level::Zelfstandig, Some(999)).unwrap();
        assert_eq!(link_get(&c, 1).unwrap().full_until, None);
        // Opnieuw koppelen zet het niveau weer op voorzichtig.
        level_set(&c, 1, Level::Zelfstandig, None).unwrap();
        link_set(&c, 1, "andere", "X", "", 200).unwrap();
        assert_eq!(link_get(&c, 1).unwrap().level, Level::Voorzichtig);
        full_secs_set(&c, 1, 10).unwrap();
        assert_eq!(link_get(&c, 1).unwrap().full_secs, super::super::policy::FULL_MIN_SECS);
        link_remove(&c, 1);
        assert!(link_get(&c, 1).is_none());
    }

    #[test]
    fn actielog_bewaart_en_toont_nieuwste_eerst_en_kent_ongedaan_maken() {
        let c = conn();
        let sum = serde_json::json!([{"code":"tabel_toevoegen","params":{"tabel":"bestellingen"}}]);
        let id1 = action_add(&c, &NewAction { project_id: 1, at: 10, tool: "db_run_sql", class: 2, level: "zelfstandig", status: "uitgevoerd", summary: &sum, sql: Some("create table x (id int)"), detail: &serde_json::json!({}), undo: Some(("sql", "drop table if exists x")) }).unwrap();
        let id2 = action_add(&c, &NewAction { project_id: 1, at: 20, tool: "db_run_sql", class: 3, level: "voorzichtig", status: "geweigerd", summary: &sum, sql: None, detail: &serde_json::json!({"code":"niveau"}), undo: None }).unwrap();
        let l = actions(&c, 1, 10);
        assert_eq!(l.iter().map(|a| a.id).collect::<Vec<_>>(), vec![id2, id1]);
        assert!(!l[0].kan_ongedaan && l[1].kan_ongedaan);
        assert_eq!(undo_get(&c, 1, id1), Some(("sql".into(), "drop table if exists x".into(), false)));
        assert_eq!(undo_get(&c, 2, id1), None); // van een ander project: nee
        assert_eq!(undo_get(&c, 1, id2), None);
        undo_done(&c, id1);
        assert!(actions(&c, 1, 10)[1].undone);
        // De tabel kent geen kolom voor sleutels.
        let kol: Vec<String> = c.prepare("PRAGMA table_info(supabase_links)").unwrap().query_map([], |r| r.get::<_, String>(1)).unwrap().map(|r| r.unwrap()).collect();
        assert!(kol.iter().all(|k| !k.contains("key") && !k.contains("token") && !k.contains("pass") && !k.contains("secret")), "{kol:?}");
    }

    #[test]
    fn verwijderen_van_een_project_verwijdert_de_koppeling_en_het_log_maar_niets_bij_supabase() {
        let c = conn();
        c.execute("PRAGMA foreign_keys = ON", []).unwrap();
        link_set(&c, 1, "abc", "X", "", 1).unwrap();
        action_add(&c, &NewAction { project_id: 1, at: 1, tool: "t", class: 1, level: "voorzichtig", status: "uitgevoerd", summary: &serde_json::json!([]), sql: None, detail: &serde_json::json!({}), undo: None }).unwrap();
        c.execute("DELETE FROM projects WHERE id = 1", []).unwrap();
        assert!(link_get(&c, 1).is_none() && actions(&c, 1, 5).is_empty());
    }
}
