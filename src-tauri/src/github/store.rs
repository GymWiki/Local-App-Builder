//! Opslag in SQLite: welke repository bij een project hoort en wat er de laatste keer is gebeurd. Nooit een token.
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Link {
    pub project_id: i64,
    pub owner: String,
    pub repo: String,
    pub private: bool,
    pub branch: String,
    pub last_backup_at: Option<i64>,
    pub last_backup_commit: Option<String>,
    pub last_backup_count: Option<i64>,
    pub auto_backup: bool,
    /// De AI moet voor een back-up eerst de gebruiker vragen (bij "Voorzichtig"). Standaard aan.
    pub ai_ask: bool,
    /// `uiteengelopen` of `online_nieuwer` zolang dat zo is.
    pub diverged: Option<String>,
    pub problem: Option<String>,
}

pub fn get(conn: &Connection, project_id: i64) -> Option<Link> {
    conn.query_row(
        "SELECT owner, repo, private, branch, last_backup_at, last_backup_commit, last_backup_count, auto_backup, ai_ask, diverged, problem FROM github_links WHERE project_id = ?1",
        params![project_id],
        |r| {
            Ok(Link {
                project_id,
                owner: r.get(0)?,
                repo: r.get(1)?,
                private: r.get::<_, i64>(2)? != 0,
                branch: r.get(3)?,
                last_backup_at: r.get(4)?,
                last_backup_commit: r.get(5)?,
                last_backup_count: r.get(6)?,
                auto_backup: r.get::<_, i64>(7)? != 0,
                ai_ask: r.get::<_, i64>(8)? != 0,
                diverged: r.get(9)?,
                problem: r.get(10)?,
            })
        },
    )
    .optional()
    .ok()
    .flatten()
}

/// Koppelt het project aan een repository. Instellingen (automatisch, AI vraagt) beginnen veilig: automatisch uit, AI vraagt aan.
pub fn set(conn: &Connection, project_id: i64, owner: &str, repo: &str, private: bool, branch: &str, now: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO github_links (project_id, owner, repo, private, branch, linked_at) VALUES (?1,?2,?3,?4,?5,?6)
         ON CONFLICT(project_id) DO UPDATE SET owner=?2, repo=?3, private=?4, branch=?5, linked_at=?6, last_backup_at=NULL, last_backup_commit=NULL, last_backup_count=NULL, diverged=NULL, problem=NULL",
        params![project_id, owner, repo, private as i64, branch, now],
    )?;
    Ok(())
}

pub fn remove(conn: &Connection, project_id: i64) {
    let _ = conn.execute("DELETE FROM github_links WHERE project_id = ?1", params![project_id]);
}

pub fn backup_done(conn: &Connection, project_id: i64, now: i64, commit: &str, count: i64) {
    let _ = conn.execute(
        "UPDATE github_links SET last_backup_at=?2, last_backup_commit=?3, last_backup_count=?4, diverged=NULL, problem=NULL WHERE project_id=?1",
        params![project_id, now, commit, count],
    );
}

pub fn set_diverged(conn: &Connection, project_id: i64, kind: Option<&str>) {
    let _ = conn.execute("UPDATE github_links SET diverged=?2 WHERE project_id=?1", params![project_id, kind]);
}

pub fn set_problem(conn: &Connection, project_id: i64, code: Option<&str>) {
    let _ = conn.execute("UPDATE github_links SET problem=?2 WHERE project_id=?1", params![project_id, code]);
}

pub fn set_auto(conn: &Connection, project_id: i64, aan: bool) {
    let _ = conn.execute("UPDATE github_links SET auto_backup=?2 WHERE project_id=?1", params![project_id, aan as i64]);
}

pub fn set_ai_ask(conn: &Connection, project_id: i64, vraagt: bool) {
    let _ = conn.execute("UPDATE github_links SET ai_ask=?2 WHERE project_id=?1", params![project_id, vraagt as i64]);
}
