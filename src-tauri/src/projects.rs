use crate::error::{AppError, Result};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Project {
    pub id: i64,
    pub naam: String,
    pub pad: String,
    pub template: String,
    pub created_at: String,
    pub default_account_id: Option<i64>,
}

const COLS: &str = "id, naam, pad, template, created_at, default_account_id";

fn row_to_project(r: &rusqlite::Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: r.get(0)?,
        naam: r.get(1)?,
        pad: r.get(2)?,
        template: r.get(3)?,
        created_at: r.get(4)?,
        default_account_id: r.get(5)?,
    })
}

pub fn list(conn: &Connection) -> Result<Vec<Project>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM projects ORDER BY id DESC"))?;
    let rows = stmt
        .query_map([], row_to_project)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: i64) -> Result<Project> {
    conn.query_row(
        &format!("SELECT {COLS} FROM projects WHERE id = ?1"),
        params![id],
        row_to_project,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound,
        e => e.into(),
    })
}

pub fn set_default_account(
    conn: &Connection,
    project_id: i64,
    account_id: Option<i64>,
) -> Result<()> {
    if conn.execute(
        "UPDATE projects SET default_account_id = ?1 WHERE id = ?2",
        params![account_id, project_id],
    )? == 0
    {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Verwijdert ALLEEN de regel uit de database. Bestanden op schijf blijven altijd staan.
pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    if conn.execute("DELETE FROM projects WHERE id = ?1", params![id])? == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Maakt van een projectnaam een veilige mapnaam (cross-platform).
pub fn folder_name(naam: &str) -> Result<String> {
    let cleaned: String = naam
        .trim()
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '-'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned
        .trim_matches(|c: char| c == '.' || c.is_whitespace())
        .to_string();
    if cleaned.is_empty() || cleaned.chars().all(|c| c == '-') {
        return Err(AppError::Invalid(
            "Geef het project een geldige naam.".into(),
        ));
    }
    if RESERVED.contains(
        &cleaned
            .split('.')
            .next()
            .unwrap_or("")
            .to_uppercase()
            .as_str(),
    ) {
        return Err(AppError::Invalid(
            "Die naam is gereserveerd door het besturingssysteem.".into(),
        ));
    }
    Ok(cleaned)
}

pub fn project_md(naam: &str) -> String {
    let mut s = format!("# {naam}\n");
    for kop in [
        "Doel",
        "Doelgroep",
        "Schermen",
        "Data",
        "Beslissingen",
        "Status",
    ] {
        s.push_str(&format!("\n## {kop}\n\n"));
    }
    s
}

fn git_init(dir: &Path) -> Result<()> {
    let mut cmd = Command::new("git");
    cmd.arg("init").current_dir(dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().map_err(|e| AppError::Git(e.to_string()))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(AppError::Git(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ))
    }
}

/// Maakt `<bovenliggend>/<naam>` aan, draait `git init`, schrijft PROJECT.md en registreert het project.
/// Een bestaande map wordt nooit overschreven; bij een fout ruimen we alleen op wat we zelf aanmaakten.
pub fn create(
    conn: &Connection,
    naam: &str,
    bovenliggend: &Path,
    template: &str,
) -> Result<Project> {
    let naam = naam.trim();
    let map_naam = folder_name(naam)?;
    if !bovenliggend.is_dir() {
        return Err(AppError::Invalid("De gekozen locatie bestaat niet.".into()));
    }
    let dir: PathBuf = bovenliggend.join(&map_naam);
    if dir.exists() {
        return Err(AppError::Invalid(format!(
            "De map “{map_naam}” bestaat al op die locatie."
        )));
    }
    fs::create_dir(&dir)?;

    let result = (|| {
        git_init(&dir)?;
        fs::write(dir.join("PROJECT.md"), project_md(naam))?;
        crate::instructions::ensure(&dir)?;
        let pad = dir.to_string_lossy().to_string();
        conn.execute(
            "INSERT INTO projects (naam, pad, template) VALUES (?1, ?2, ?3)",
            params![naam, pad, template],
        )?;
        let id = conn.last_insert_rowid();
        get(conn, id)
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&dir); // alleen de map die we net zelf maakten
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn maakt_map_git_en_project_md() {
        let conn = db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let p = create(&conn, "Mijn App", tmp.path(), "leeg").unwrap();

        let dir = tmp.path().join("Mijn App");
        assert_eq!(p.pad, dir.to_string_lossy());
        assert!(dir.join(".git").is_dir());
        let md = fs::read_to_string(dir.join("PROJECT.md")).unwrap();
        for kop in [
            "Doel",
            "Doelgroep",
            "Schermen",
            "Data",
            "Beslissingen",
            "Status",
        ] {
            assert!(md.contains(&format!("## {kop}\n")), "kop {kop} ontbreekt");
        }
        for f in crate::instructions::FILES {
            assert!(
                fs::read_to_string(dir.join(f))
                    .unwrap()
                    .contains("run_checks"),
                "{f}"
            );
        }
        assert_eq!(list(&conn).unwrap(), vec![p]);
    }

    #[test]
    fn weigert_bestaande_map_en_laat_inhoud_ongemoeid() {
        let conn = db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("App");
        fs::create_dir(&dir).unwrap();
        fs::write(dir.join("belangrijk.txt"), "x").unwrap();

        assert!(create(&conn, "App", tmp.path(), "leeg").is_err());
        assert!(dir.join("belangrijk.txt").exists());
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn weigert_ongeldige_namen_en_ontbrekende_locatie() {
        let conn = db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        assert!(create(&conn, "   ", tmp.path(), "leeg").is_err());
        assert!(create(&conn, "..", tmp.path(), "leeg").is_err());
        assert!(create(&conn, "CON", tmp.path(), "leeg").is_err());
        assert!(create(&conn, "x", &tmp.path().join("bestaat-niet"), "leeg").is_err());
    }

    #[test]
    fn mapnaam_kan_niet_uit_de_locatie_ontsnappen() {
        assert_eq!(folder_name("../evil").unwrap(), "-evil");
        assert_eq!(folder_name("a/b\\c").unwrap(), "a-b-c");
    }

    #[test]
    fn verwijderen_wist_geen_bestanden() {
        let conn = db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let p = create(&conn, "Blijft", tmp.path(), "leeg").unwrap();

        delete(&conn, p.id).unwrap();
        assert!(list(&conn).unwrap().is_empty());
        assert!(tmp.path().join("Blijft").join("PROJECT.md").exists());
        assert!(matches!(delete(&conn, p.id), Err(AppError::NotFound)));
    }

    #[test]
    fn mislukte_registratie_ruimt_eigen_map_op() {
        let conn = db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        conn.execute("DROP TABLE projects", []).unwrap();
        assert!(create(&conn, "Kapot", tmp.path(), "leeg").is_err());
        assert!(!tmp.path().join("Kapot").exists());
    }
}
