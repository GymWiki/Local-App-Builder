//! Indeling van de werkruimte per project en de miniatuur voor het homescherm.
//! De indeling is een JSON-tekst waarvan alleen de grootte en de geldigheid als JSON hier worden gecontroleerd; de
//! frontend (`src/lib/layout`) bepaalt wat erin staat, migreert oude versies en valt bij twijfel terug op de standaard.

use crate::error::{AppError, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_LAYOUT_BYTES: usize = 200_000;
const MAX_THUMB_BYTES: usize = 600_000;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct StoredLayout {
    pub versie: i64,
    pub json: String,
}

pub fn get(conn: &Connection, project_id: i64) -> Result<Option<StoredLayout>> {
    match conn.query_row(
        "SELECT versie, json FROM project_layouts WHERE project_id = ?1",
        params![project_id],
        |r| {
            Ok(StoredLayout {
                versie: r.get(0)?,
                json: r.get(1)?,
            })
        },
    ) {
        Ok(l) => Ok(Some(l)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn set(conn: &Connection, project_id: i64, versie: i64, json: &str) -> Result<()> {
    if json.len() > MAX_LAYOUT_BYTES {
        return Err(AppError::Invalid(
            "De indeling is te groot om op te slaan.".into(),
        ));
    }
    serde_json::from_str::<serde_json::Value>(json)
        .map_err(|_| AppError::Invalid("De indeling is geen geldige JSON.".into()))?;
    conn.execute(
        "INSERT INTO project_layouts (project_id, versie, json) VALUES (?1, ?2, ?3)
         ON CONFLICT(project_id) DO UPDATE SET versie = excluded.versie, json = excluded.json,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
        params![project_id, versie, json],
    )
    .map_err(|e| match e {
        rusqlite::Error::SqliteFailure(_, _) => AppError::NotFound, // project bestaat niet (meer)
        e => e.into(),
    })?;
    Ok(())
}

pub fn reset(conn: &Connection, project_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM project_layouts WHERE project_id = ?1",
        params![project_id],
    )?;
    Ok(())
}

fn thumb_path(dir: &Path, id: i64) -> PathBuf {
    dir.join(format!("{id}.jpg"))
}

/// Bewaart een JPEG-data-URL als miniatuur. Alleen `data:image/jpeg;base64,…` tot een veilige grootte.
pub fn thumbnail_set(dir: &Path, id: i64, data_url: &str) -> Result<()> {
    let b64 = data_url
        .strip_prefix("data:image/jpeg;base64,")
        .ok_or_else(|| AppError::Invalid("De miniatuur moet een JPEG-afbeelding zijn.".into()))?;
    let bytes = STANDARD
        .decode(b64.trim())
        .map_err(|_| AppError::Invalid("De miniatuur is geen geldige afbeelding.".into()))?;
    if bytes.len() > MAX_THUMB_BYTES || bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return Err(AppError::Invalid(
            "De miniatuur is geen (kleine) JPEG-afbeelding.".into(),
        ));
    }
    fs::create_dir_all(dir)?;
    fs::write(thumb_path(dir, id), bytes)?;
    Ok(())
}

pub fn thumbnail_get(dir: &Path, id: i64) -> Option<String> {
    let bytes = fs::read(thumb_path(dir, id)).ok()?;
    Some(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

pub fn thumbnail_delete(dir: &Path, id: i64) {
    let _ = fs::remove_file(thumb_path(dir, id));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{db, projects};

    fn project(conn: &Connection) -> i64 {
        let tmp = tempfile::tempdir().unwrap();
        let p = projects::create(conn, "App", tmp.path(), "leeg").unwrap();
        std::mem::forget(tmp);
        p.id
    }

    #[test]
    fn indeling_opslaan_lezen_en_resetten() {
        let conn = db::open_in_memory().unwrap();
        let id = project(&conn);
        assert_eq!(get(&conn, id).unwrap(), None);
        set(&conn, id, 1, r#"{"a":1}"#).unwrap();
        set(&conn, id, 2, r#"{"a":2}"#).unwrap();
        let l = get(&conn, id).unwrap().unwrap();
        assert_eq!((l.versie, l.json.as_str()), (2, r#"{"a":2}"#));
        reset(&conn, id).unwrap();
        assert_eq!(get(&conn, id).unwrap(), None);
    }

    #[test]
    fn ongeldige_of_te_grote_indeling_wordt_geweigerd() {
        let conn = db::open_in_memory().unwrap();
        let id = project(&conn);
        assert!(set(&conn, id, 1, "{kapot").is_err());
        assert!(set(
            &conn,
            id,
            1,
            &format!("\"{}\"", "x".repeat(MAX_LAYOUT_BYTES))
        )
        .is_err());
        assert_eq!(get(&conn, id).unwrap(), None);
        assert!(set(&conn, 999, 1, "{}").is_err()); // geen project
    }

    #[test]
    fn indeling_verdwijnt_met_het_project_maar_bestanden_blijven() {
        let conn = db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let p = projects::create(&conn, "Blijft", tmp.path(), "leeg").unwrap();
        set(&conn, p.id, 1, "{}").unwrap();
        projects::delete(&conn, p.id).unwrap();
        assert_eq!(get(&conn, p.id).unwrap(), None);
        assert!(tmp.path().join("Blijft").join("PROJECT.md").exists());
    }

    #[test]
    fn miniatuur_alleen_jpeg_en_klein() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(thumbnail_get(dir.path(), 1), None);
        let jpeg = format!(
            "data:image/jpeg;base64,{}",
            STANDARD.encode([0xFF, 0xD8, 0xFF, 0xE0, 1, 2])
        );
        thumbnail_set(dir.path(), 1, &jpeg).unwrap();
        assert_eq!(thumbnail_get(dir.path(), 1).as_deref(), Some(jpeg.as_str()));
        assert!(thumbnail_set(dir.path(), 1, "data:image/png;base64,AAAA").is_err());
        assert!(thumbnail_set(dir.path(), 1, "data:image/jpeg;base64,@@@").is_err());
        let niet_jpeg = format!("data:image/jpeg;base64,{}", STANDARD.encode(b"GIF89a....."));
        assert!(thumbnail_set(dir.path(), 1, &niet_jpeg).is_err());
        let te_groot = format!(
            "data:image/jpeg;base64,{}",
            STANDARD.encode(vec![0xFFu8; MAX_THUMB_BYTES + 1])
        );
        assert!(thumbnail_set(dir.path(), 1, &te_groot).is_err());
        thumbnail_delete(dir.path(), 1);
        assert_eq!(thumbnail_get(dir.path(), 1), None);
    }
}
