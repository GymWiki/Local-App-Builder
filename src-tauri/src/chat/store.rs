//! Chatgeschiedenis en sessie-id in SQLite. Bevat nooit tokens: alleen berichten en het sessie-id van de CLI.
use crate::error::Result;
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct StoredMessage {
    pub id: i64,
    pub project_id: i64,
    pub kind: String,
    pub payload: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SessionRow {
    pub provider: String,
    pub account_id: Option<i64>,
    pub session_id: Option<String>,
}

fn row(r: &rusqlite::Row) -> rusqlite::Result<StoredMessage> {
    let payload: String = r.get(3)?;
    Ok(StoredMessage {
        id: r.get(0)?,
        project_id: r.get(1)?,
        kind: r.get(2)?,
        payload: serde_json::from_str(&payload).unwrap_or(Value::Null),
        created_at: r.get(4)?,
    })
}

const COLS: &str = "id, project_id, kind, payload, created_at";

pub fn insert(
    conn: &Connection,
    project_id: i64,
    kind: &str,
    payload: &Value,
) -> Result<StoredMessage> {
    conn.execute(
        "INSERT INTO chat_messages (project_id, kind, payload) VALUES (?1, ?2, ?3)",
        params![project_id, kind, payload.to_string()],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn get(conn: &Connection, id: i64) -> Result<StoredMessage> {
    Ok(conn.query_row(
        &format!("SELECT {COLS} FROM chat_messages WHERE id = ?1"),
        params![id],
        row,
    )?)
}

pub fn update(conn: &Connection, id: i64, payload: &Value) -> Result<StoredMessage> {
    conn.execute(
        "UPDATE chat_messages SET payload = ?1 WHERE id = ?2",
        params![payload.to_string(), id],
    )?;
    get(conn, id)
}

/// De laatste `limit` berichten, oudste eerst.
pub fn history(conn: &Connection, project_id: i64, limit: i64) -> Result<Vec<StoredMessage>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM (SELECT {COLS} FROM chat_messages WHERE project_id = ?1 ORDER BY id DESC LIMIT ?2) ORDER BY id ASC"
    ))?;
    let rows = stmt
        .query_map(params![project_id, limit], row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn last_user_text(conn: &Connection, project_id: i64) -> Result<Option<String>> {
    let msgs = history(conn, project_id, 200)?;
    Ok(msgs
        .iter()
        .rev()
        .find(|m| m.kind == "user")
        .and_then(|m| m.payload["text"].as_str().map(str::to_string)))
}

/// Bijlagen van het laatste bericht van de gebruiker (voor "Probeer opnieuw").
pub fn last_user_attachments(conn: &Connection, project_id: i64) -> Result<Vec<super::Attachment>> {
    let msgs = history(conn, project_id, 200)?;
    Ok(msgs
        .iter()
        .rev()
        .find(|m| m.kind == "user")
        .and_then(|m| serde_json::from_value(m.payload["attachments"].clone()).ok())
        .unwrap_or_default())
}

/// De nieuwste versie die is bewaard terwijl de controles slaagden (`working: true`).
pub fn last_working_version(
    conn: &Connection,
    project_id: i64,
) -> Result<Option<(String, String)>> {
    let mut stmt = conn.prepare("SELECT payload FROM chat_messages WHERE project_id = ?1 AND kind = 'version' ORDER BY id DESC LIMIT 200")?;
    let rows = stmt.query_map(params![project_id], |r| r.get::<_, String>(0))?;
    for payload in rows.flatten() {
        if let Ok(v) = serde_json::from_str::<Value>(&payload) {
            if v["working"] == true {
                if let (Some(h), Some(t)) = (v["hash"].as_str(), v["title"].as_str()) {
                    return Ok(Some((h.to_string(), t.to_string())));
                }
            }
        }
    }
    Ok(None)
}

pub fn session(conn: &Connection, project_id: i64) -> Result<Option<SessionRow>> {
    match conn.query_row(
        "SELECT provider, account_id, session_id FROM chat_sessions WHERE project_id = ?1",
        params![project_id],
        |r| {
            Ok(SessionRow {
                provider: r.get(0)?,
                account_id: r.get(1)?,
                session_id: r.get(2)?,
            })
        },
    ) {
        Ok(s) => Ok(Some(s)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn set_session(
    conn: &Connection,
    project_id: i64,
    provider: &str,
    account_id: Option<i64>,
    session_id: Option<&str>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO chat_sessions (project_id, provider, account_id, session_id) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(project_id) DO UPDATE SET provider = excluded.provider, account_id = excluded.account_id,
         session_id = excluded.session_id, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
        params![project_id, provider, account_id, session_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{db, projects};
    use serde_json::json;

    fn setup() -> (Connection, i64, tempfile::TempDir) {
        let conn = db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let p = projects::create(&conn, "P", tmp.path(), "leeg").unwrap();
        (conn, p.id, tmp)
    }

    #[test]
    fn berichten_blijven_in_volgorde_en_kunnen_worden_bijgewerkt() {
        let (c, id, _t) = setup();
        let a = insert(&c, id, "user", &json!({"text": "Maak een site"})).unwrap();
        let b = insert(&c, id, "action", &json!({"state": "running"})).unwrap();
        insert(&c, id, "assistant", &json!({"text": "Klaar"})).unwrap();
        let b2 = update(&c, b.id, &json!({"state": "done"})).unwrap();
        assert_eq!(b2.payload["state"], "done");
        let h = history(&c, id, 50).unwrap();
        assert_eq!(
            h.iter().map(|m| m.kind.as_str()).collect::<Vec<_>>(),
            vec!["user", "action", "assistant"]
        );
        assert_eq!(h[0].id, a.id);
        assert_eq!(
            history(&c, id, 2).unwrap().len(),
            2,
            "limiet = de laatste berichten"
        );
        assert_eq!(history(&c, id, 2).unwrap()[0].kind, "action");
        assert_eq!(
            last_user_text(&c, id).unwrap().as_deref(),
            Some("Maak een site")
        );
    }

    #[test]
    fn sessie_id_wordt_bewaard_en_overschreven_en_verdwijnt_met_het_project() {
        let (c, id, _t) = setup();
        assert!(session(&c, id).unwrap().is_none());
        set_session(&c, id, "claude", None, Some("s1")).unwrap();
        assert_eq!(
            session(&c, id).unwrap().unwrap().session_id.as_deref(),
            Some("s1")
        );
        set_session(&c, id, "claude", Some(7), Some("s2")).unwrap();
        let s = session(&c, id).unwrap().unwrap();
        assert_eq!(
            (s.account_id, s.session_id.as_deref()),
            (Some(7), Some("s2"))
        );
        set_session(&c, id, "claude", None, None).unwrap();
        assert_eq!(
            session(&c, id).unwrap().unwrap().session_id,
            None,
            "sessie wissen = nieuwe start"
        );

        insert(&c, id, "user", &json!({"text": "x"})).unwrap();
        projects::delete(&c, id).unwrap();
        assert!(session(&c, id).unwrap().is_none());
        assert!(
            history(&c, id, 10).unwrap().is_empty(),
            "geschiedenis verdwijnt met het project uit de lijst"
        );
    }
}
