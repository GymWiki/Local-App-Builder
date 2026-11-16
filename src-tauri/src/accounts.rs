use crate::error::{AppError, Result};
use crate::provider::Provider;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::fs;
use std::path::Path;

/// Bewaart uitsluitend provider, label en pad. Inloggegevens beheert de CLI zelf binnen `profile_dir`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Account {
    pub id: i64,
    pub provider: String,
    pub label: String,
    pub profile_dir: String,
    pub created_at: String,
}

const COLS: &str = "id, provider, label, profile_dir, created_at";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Account> {
    Ok(Account {
        id: r.get(0)?,
        provider: r.get(1)?,
        label: r.get(2)?,
        profile_dir: r.get(3)?,
        created_at: r.get(4)?,
    })
}

pub fn list(conn: &Connection) -> Result<Vec<Account>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM ai_accounts ORDER BY provider, label"
    ))?;
    let rows = stmt
        .query_map([], row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: i64) -> Result<Account> {
    conn.query_row(
        &format!("SELECT {COLS} FROM ai_accounts WHERE id = ?1"),
        params![id],
        row,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound,
        e => e.into(),
    })
}

pub fn create(
    conn: &Connection,
    profiles_root: &Path,
    provider: &str,
    label: &str,
) -> Result<Account> {
    let provider = Provider::parse(provider)?;
    let label = label.trim();
    if label.is_empty() || label.chars().count() > 60 {
        return Err(AppError::Invalid(
            "Geef het account een label van 1 tot 60 tekens.".into(),
        ));
    }
    conn.execute(
        "INSERT INTO ai_accounts (provider, label) VALUES (?1, ?2)",
        params![provider.as_str(), label],
    )?;
    let id = conn.last_insert_rowid();
    let dir = profiles_root.join(format!("{}-{}", provider.as_str(), id));
    if let Err(e) = fs::create_dir_all(&dir) {
        conn.execute("DELETE FROM ai_accounts WHERE id = ?1", params![id])?;
        return Err(e.into());
    }
    conn.execute(
        "UPDATE ai_accounts SET profile_dir = ?1 WHERE id = ?2",
        params![dir.to_string_lossy(), id],
    )?;
    get(conn, id)
}

/// Verwijdert alleen de regel. De profielmap (met de login van de CLI) blijft staan; wij wissen geen gebruikersdata.
pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    if conn.execute("DELETE FROM ai_accounts WHERE id = ?1", params![id])? == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{db, projects};

    #[test]
    fn maakt_account_met_profielmap_in_de_opgegeven_root() {
        let conn = db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let a = create(&conn, tmp.path(), "claude", "  Werk ").unwrap();
        assert_eq!(a.label, "Werk");
        assert_eq!(a.provider, "claude");
        assert!(Path::new(&a.profile_dir).starts_with(tmp.path()));
        assert!(Path::new(&a.profile_dir).is_dir());
        assert_eq!(list(&conn).unwrap(), vec![a]);
    }

    #[test]
    fn weigert_lege_labels_onbekende_providers_en_codex() {
        let conn = db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        assert!(create(&conn, tmp.path(), "claude", "  ").is_err());
        assert!(create(&conn, tmp.path(), "nope", "x").is_err());
        assert!(create(&conn, tmp.path(), "codex", "x").is_err());
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn schema_kent_geen_secretkolommen() {
        let conn = db::open_in_memory().unwrap();
        let cols: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('ai_accounts')")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(
            cols,
            vec!["id", "provider", "label", "created_at", "profile_dir"]
        );
    }

    #[test]
    fn verwijderen_laat_profielmap_staan_en_wist_projectstandaard() {
        let conn = db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let a = create(&conn, tmp.path(), "gemini", "Privé").unwrap();
        let p = projects::create(&conn, "P", tmp.path(), "leeg").unwrap();
        projects::set_default_account(&conn, p.id, Some(a.id)).unwrap();
        assert_eq!(
            projects::get(&conn, p.id).unwrap().default_account_id,
            Some(a.id)
        );

        delete(&conn, a.id).unwrap();
        assert!(Path::new(&a.profile_dir).is_dir());
        assert_eq!(projects::get(&conn, p.id).unwrap().default_account_id, None);
        assert!(matches!(delete(&conn, a.id), Err(AppError::NotFound)));
    }
}
