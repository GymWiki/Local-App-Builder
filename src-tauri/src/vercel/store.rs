//! Opslag in SQLite: koppeling met het Vercel-project, het logboek van deployments en de NAMEN van omgevingsvariabelen. Nooit een waarde of token.
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Link {
    pub vproject_id: String,
    pub name: String,
    pub framework: Option<String>,
}

pub fn link_get(c: &Connection, project: i64) -> Option<Link> {
    c.query_row("SELECT vproject_id, name, framework FROM vercel_links WHERE project_id=?1", params![project], |r| Ok(Link { vproject_id: r.get(0)?, name: r.get(1)?, framework: r.get(2)? })).optional().ok().flatten()
}

pub fn link_set(c: &Connection, project: i64, vid: &str, name: &str, framework: Option<&str>, now: i64) {
    let _ = c.execute(
        "INSERT INTO vercel_links (project_id, vproject_id, name, framework, linked_at) VALUES (?1,?2,?3,?4,?5)
         ON CONFLICT(project_id) DO UPDATE SET vproject_id=?2, name=?3, framework=?4, linked_at=?5",
        params![project, vid, name, framework, now],
    );
}

pub fn link_remove(c: &Connection, project: i64) {
    let _ = c.execute("DELETE FROM vercel_links WHERE project_id=?1", params![project]);
}

#[derive(Debug, Clone, Serialize)]
pub struct Logged {
    pub id: i64,
    pub at: i64,
    pub target: String,
    pub deployment_id: Option<String>,
    pub url: Option<String>,
    pub state: String,
    pub checkpoint: Option<String>,
    pub code: String,
}

#[allow(clippy::too_many_arguments)]
pub fn log_add(c: &Connection, project: i64, at: i64, target: &str, deployment_id: Option<&str>, url: Option<&str>, state: &str, checkpoint: Option<&str>, code: &str) {
    let _ = c.execute(
        "INSERT INTO vercel_deployments (project_id, at, target, deployment_id, url, state, checkpoint, code) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![project, at, target, deployment_id, url, state, checkpoint, code],
    );
}

pub fn log_list(c: &Connection, project: i64, limit: i64) -> Vec<Logged> {
    let Ok(mut st) = c.prepare("SELECT id, at, target, deployment_id, url, state, checkpoint, code FROM vercel_deployments WHERE project_id=?1 ORDER BY id DESC LIMIT ?2") else { return vec![] };
    st.query_map(params![project, limit], |r| Ok(Logged { id: r.get(0)?, at: r.get(1)?, target: r.get(2)?, deployment_id: r.get(3)?, url: r.get(4)?, state: r.get(5)?, checkpoint: r.get(6)?, code: r.get(7)? }))
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct EnvRow {
    pub naam: String,
    /// `openbaar` (de browser mag het zien) of `server` (geheim).
    pub soort: String,
    pub bron: String,
    pub omgevingen: Vec<String>,
    pub gezet: i64,
    pub doorgestuurd: Option<i64>,
}

pub fn env_list(c: &Connection, project: i64) -> Vec<EnvRow> {
    let Ok(mut st) = c.prepare("SELECT name, kind, source, envs, set_at, pushed_at FROM vercel_env WHERE project_id=?1 ORDER BY name") else { return vec![] };
    st.query_map(params![project], |r| {
        Ok(EnvRow { naam: r.get(0)?, soort: r.get(1)?, bron: r.get(2)?, omgevingen: r.get::<_, String>(3)?.split(',').filter(|s| !s.is_empty()).map(String::from).collect(), gezet: r.get(4)?, doorgestuurd: r.get(5)? })
    })
    .map(|rows| rows.flatten().collect())
    .unwrap_or_default()
}

pub fn env_get(c: &Connection, project: i64, name: &str) -> Option<EnvRow> {
    env_list(c, project).into_iter().find(|e| e.naam == name)
}

pub fn env_set(c: &Connection, project: i64, name: &str, kind: &str, source: &str, envs: &[String], now: i64) {
    let _ = c.execute(
        "INSERT INTO vercel_env (project_id, name, kind, source, envs, set_at) VALUES (?1,?2,?3,?4,?5,?6)
         ON CONFLICT(project_id, name) DO UPDATE SET kind=?3, source=?4, envs=?5, set_at=?6, pushed_at=NULL",
        params![project, name, kind, source, envs.join(","), now],
    );
}

pub fn env_pushed(c: &Connection, project: i64, name: &str, now: i64) {
    let _ = c.execute("UPDATE vercel_env SET pushed_at=?3 WHERE project_id=?1 AND name=?2", params![project, name, now]);
}

pub fn env_remove(c: &Connection, project: i64, name: &str) {
    let _ = c.execute("DELETE FROM vercel_env WHERE project_id=?1 AND name=?2", params![project, name]);
}
