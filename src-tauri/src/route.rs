//! De route "van idee tot app": de feiten over een project waaruit de schermen bepalen op welke stap iemand staat. Hier alleen feiten
//! (lezen, geen oordeel); de stappen zelf staan in `src/lib/route.ts`, zodat de balk bovenin en de projectkaart op het homescherm
//! altijd hetzelfde zeggen.
use crate::commands::Db;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::Path;
use tauri::State;

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct Feiten {
    /// De gebruiker heeft een eerste opdracht gegeven of PROJECT.md is ingevuld.
    pub heeft_idee: bool,
    /// De gebruiker heeft het plan goedgekeurd (vlag `route_plan`).
    pub plan_klaar: bool,
    pub kit_gekozen: bool,
    /// Aantal opgeslagen versies (checkpoints).
    pub versies: usize,
    pub gegevens_nodig: bool,
    pub gegevens_klaar: bool,
    /// De laatste automatische controle: `Some(true)` geslaagd, `Some(false)` mislukt, `None` nog niet gedraaid.
    pub tests_ok: Option<bool>,
    pub back_up: bool,
    pub online: bool,
    pub winkel: bool,
    /// Stappen die de gebruiker heeft overgeslagen.
    pub overgeslagen: Vec<String>,
}

pub const STAPPEN: [&str; 8] = ["idee", "plan", "uiterlijk", "bouwen", "aanpassen", "gegevens", "testen", "delen"];

fn vlag(c: &Connection, project: i64, sleutel: &str) -> Option<String> {
    crate::db::get_setting(c, &format!("project:{project}:{sleutel}")).ok().flatten()
}

/// Verzamelt de feiten. Alleen lezen; elke ontbrekende bron telt als "nog niet".
pub fn feiten(c: &Connection, dir: &Path, project: i64) -> Feiten {
    let signalen = crate::projectinfo::signals(dir);
    let gebruiker_bericht: i64 = c.query_row("SELECT COUNT(*) FROM chat_messages WHERE project_id=?1 AND kind='user'", params![project], |r| r.get(0)).unwrap_or(0);
    let versies = crate::github::repo::open(dir).ok().and_then(|r| crate::github::repo::head_oid(&r).map(|h| crate::github::repo::count_new(&r, h, None))).unwrap_or(0);
    let supabase: bool = c.query_row("SELECT COUNT(*) FROM supabase_links WHERE project_id=?1", params![project], |r| r.get::<_, i64>(0)).map(|n| n > 0).unwrap_or(false);
    let back_up: bool = c.query_row("SELECT COUNT(*) FROM github_links WHERE project_id=?1 AND last_backup_at IS NOT NULL", params![project], |r| r.get::<_, i64>(0)).map(|n| n > 0).unwrap_or(false);
    let vercel_live: bool = c.query_row("SELECT COUNT(*) FROM vercel_deployments WHERE project_id=?1 AND target='production' AND state='READY'", params![project], |r| r.get::<_, i64>(0)).map(|n| n > 0).unwrap_or(false);
    let winkel: bool = c.query_row("SELECT COUNT(*) FROM store_apps WHERE project_id=?1", params![project], |r| r.get::<_, i64>(0)).map(|n| n > 0).unwrap_or(false);
    let tests_ok = crate::mcp::last_checks(c, project, 1).ok().and_then(|v| v.first().map(|r| r.ok));
    Feiten {
        heeft_idee: gebruiker_bericht > 0 || signalen.project_md_ingevuld,
        plan_klaar: vlag(c, project, "route_plan").as_deref() == Some("1"),
        kit_gekozen: dir.join("design/kit.json").is_file(),
        versies,
        gegevens_nodig: signalen.needs_data || signalen.heeft_database,
        gegevens_klaar: signalen.heeft_database || supabase,
        tests_ok,
        back_up,
        online: vercel_live || vlag(c, project, "online_gezet").as_deref() == Some("1"),
        winkel,
        overgeslagen: STAPPEN.iter().filter(|s| vlag(c, project, &format!("over_{s}")).as_deref() == Some("1")).map(|s| s.to_string()).collect(),
    }
}

#[tauri::command]
pub fn route_feiten(db: State<Db>, project_id: i64) -> Result<Feiten, String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    let p = crate::projects::get(&c, project_id).map_err(|e| e.to_string())?;
    Ok(feiten(&c, Path::new(&p.pad), project_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut c).unwrap();
        c.execute("INSERT INTO projects (id, naam, pad, template) VALUES (1, 'P', '/p', 'leeg')", []).unwrap();
        c
    }

    #[test]
    fn een_nieuw_project_staat_nergens() {
        let c = db();
        let d = tempfile::tempdir().unwrap();
        let f = feiten(&c, d.path(), 1);
        assert_eq!(f, Feiten::default());
    }

    #[test]
    fn leest_idee_plan_uiterlijk_versies_en_overslaan() {
        let c = db();
        let d = tempfile::tempdir().unwrap();
        c.execute("INSERT INTO chat_messages (project_id, kind, payload) VALUES (1, 'user', '{}')", []).unwrap();
        crate::db::set_setting(&c, "project:1:route_plan", "1").unwrap();
        crate::db::set_setting(&c, "project:1:over_uiterlijk", "1").unwrap();
        std::fs::create_dir_all(d.path().join("design")).unwrap();
        std::fs::write(d.path().join("design/kit.json"), "{}").unwrap();
        let r = git2::Repository::init(d.path()).unwrap();
        let sig = git2::Signature::now("t", "t@t").unwrap();
        let tree = r.find_tree(r.treebuilder(None).unwrap().write().unwrap()).unwrap();
        let c1 = r.commit(Some("HEAD"), &sig, &sig, "een", &tree, &[]).unwrap();
        let p1 = r.find_commit(c1).unwrap();
        r.commit(Some("HEAD"), &sig, &sig, "twee", &tree, &[&p1]).unwrap();
        let f = feiten(&c, d.path(), 1);
        assert_eq!((f.heeft_idee, f.plan_klaar, f.kit_gekozen, f.versies), (true, true, true, 2));
        assert_eq!(f.overgeslagen, vec!["uiterlijk"]);
        assert_eq!(f.tests_ok, None);
    }

    #[test]
    fn leest_controles_back_up_online_en_winkel() {
        let c = db();
        let d = tempfile::tempdir().unwrap();
        c.execute("INSERT INTO check_runs (project_id, ok, steps_json) VALUES (1, 1, '[]')", []).unwrap();
        c.execute("INSERT INTO github_links (project_id, owner, repo, linked_at, last_backup_at) VALUES (1, 'a', 'b', 1, 5)", []).unwrap();
        c.execute("INSERT INTO vercel_deployments (project_id, at, target, state) VALUES (1, 1, 'production', 'READY')", []).unwrap();
        c.execute("INSERT INTO store_apps (project_id, data) VALUES (1, '{}')", []).unwrap();
        let f = feiten(&c, d.path(), 1);
        assert_eq!((f.tests_ok, f.back_up, f.online, f.winkel), (Some(true), true, true, true));
    }
}
