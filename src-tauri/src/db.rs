use crate::error::Result;
use rusqlite::Connection;
use std::path::Path;

/// Migraties in volgorde. De index + 1 is de schemaversie (PRAGMA user_version).
/// Nooit een bestaande migratie wijzigen; voeg een nieuwe toe.
const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/0001_init.sql"),
    include_str!("../migrations/0002_fase2.sql"),
];

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    init(conn)
}

#[cfg(test)]
pub fn open_in_memory() -> Result<Connection> {
    init(Connection::open_in_memory()?)
}

fn init(mut conn: Connection) -> Result<Connection> {
    conn.pragma_update(None, "foreign_keys", true)?;
    migrate(&mut conn)?;
    Ok(conn)
}

pub fn migrate(conn: &mut Connection) -> Result<()> {
    let current: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

#[cfg(test)]
pub fn schema_version(conn: &Connection) -> Result<usize> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tables(conn: &Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .unwrap();
        stmt.query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    }

    #[test]
    fn migraties_maken_alle_tabellen() {
        let conn = open_in_memory().unwrap();
        assert_eq!(
            tables(&conn),
            vec!["ai_accounts", "mcp_calls", "projects", "settings"]
        );
        assert_eq!(schema_version(&conn).unwrap(), MIGRATIONS.len());
    }

    #[test]
    fn migraties_zijn_idempotent() {
        let mut conn = open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        migrate(&mut conn).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), MIGRATIONS.len());
    }

    #[test]
    fn bestand_database_blijft_bestaan_na_heropenen() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("studio.db");
        {
            let conn = open(&p).unwrap();
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('taal', 'nl')",
                [],
            )
            .unwrap();
        }
        let conn = open(&p).unwrap();
        let v: String = conn
            .query_row("SELECT value FROM settings WHERE key='taal'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(v, "nl");
    }
}
