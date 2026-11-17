//! Keurt onze `studio`-server voor Claude goed (anders toont Claude `Pending approval` en ziet hij de tools niet).
//!
//! Dit gebeurt met de gebruiker zijn uitdrukkelijke toestemming, op de door Claude gedocumenteerde plek:
//! `enabledMcpjsonServers` in `.claude/settings.local.json` (persoonlijk, niet voor git bedoeld). We voegen alleen
//! onze eigen servernaam toe, respecteren een eerdere afwijzing (`disabledMcpjsonServers`) en raken niets anders aan.
use crate::error::{AppError, Result};
use crate::mcp_config::SERVER_NAME;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub const SETTINGS_REL: &str = ".claude/settings.local.json";

#[derive(Debug, PartialEq)]
pub enum Outcome {
    Approved,
    AlreadyApproved,
    /// De gebruiker heeft de server in Claude afgewezen: we keuren niets goed.
    Rejected,
}

pub fn settings_path(dir: &Path) -> PathBuf {
    dir.join(".claude").join("settings.local.json")
}

fn refuse(file: &Path, why: &str) -> AppError {
    AppError::Invalid(format!(
        "{} {why} Ik heb het bestand ongemoeid gelaten; keur de ‘studio’-server zelf goed in Claude.",
        file.display()
    ))
}

fn contains(v: Option<&Value>, name: &str) -> bool {
    v.and_then(Value::as_array)
        .is_some_and(|a| a.iter().any(|x| x == name))
}

/// Zet het bestand uit git (via `.git/info/exclude`, dus zonder `.gitignore` van de gebruiker te wijzigen).
fn exclude_from_git(dir: &Path) -> Result<()> {
    let git = dir.join(".git");
    if !git.is_dir() {
        return Ok(());
    }
    let file = git.join("info").join("exclude");
    let current = fs::read_to_string(&file).unwrap_or_default();
    if current.lines().any(|l| l.trim() == SETTINGS_REL) {
        return Ok(());
    }
    fs::create_dir_all(git.join("info"))?;
    let sep = if current.is_empty() || current.ends_with('\n') {
        ""
    } else {
        "\n"
    };
    fs::write(&file, format!("{current}{sep}{SETTINGS_REL}\n"))?;
    Ok(())
}

pub fn ensure(dir: &Path) -> Result<Outcome> {
    let file = settings_path(dir);
    let existing = match fs::read_to_string(&file) {
        Ok(s) => Some(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    let mut root = match &existing {
        None => Value::Object(Map::new()),
        Some(s) if s.trim().is_empty() => Value::Object(Map::new()),
        Some(s) => {
            serde_json::from_str::<Value>(s).map_err(|_| refuse(&file, "is geen geldige JSON."))?
        }
    };
    let obj = root
        .as_object_mut()
        .ok_or_else(|| refuse(&file, "heeft geen JSON-object als hoofdstructuur."))?;

    if contains(obj.get("disabledMcpjsonServers"), SERVER_NAME) {
        return Ok(Outcome::Rejected);
    }
    if contains(obj.get("enabledMcpjsonServers"), SERVER_NAME) {
        exclude_from_git(dir)?;
        return Ok(Outcome::AlreadyApproved);
    }
    let list = obj
        .entry("enabledMcpjsonServers")
        .or_insert_with(|| Value::Array(vec![]));
    list.as_array_mut()
        .ok_or_else(|| {
            refuse(
                &file,
                "heeft een `enabledMcpjsonServers` die geen lijst is.",
            )
        })?
        .push(Value::String(SERVER_NAME.into()));

    fs::create_dir_all(file.parent().unwrap())?;
    let mut out =
        serde_json::to_string_pretty(&root).map_err(|e| AppError::Invalid(e.to_string()))?;
    out.push('\n');
    let tmp = file.with_extension("studio-tmp");
    fs::write(&tmp, out)?;
    fs::rename(&tmp, &file)?;
    exclude_from_git(dir)?;
    Ok(Outcome::Approved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn read(d: &Path) -> Value {
        serde_json::from_str(&fs::read_to_string(settings_path(d)).unwrap()).unwrap()
    }

    #[test]
    fn maakt_bestand_en_zet_het_uit_git_zonder_gitignore_aan_te_raken() {
        let d = tempfile::tempdir().unwrap();
        std::process::Command::new("git")
            .arg("init")
            .arg("-q")
            .current_dir(d.path())
            .status()
            .unwrap();
        fs::write(d.path().join(".gitignore"), "node_modules\n").unwrap();
        assert_eq!(ensure(d.path()).unwrap(), Outcome::Approved);
        assert_eq!(
            read(d.path()),
            json!({ "enabledMcpjsonServers": ["studio"] })
        );
        let ex = fs::read_to_string(d.path().join(".git/info/exclude")).unwrap();
        assert!(ex.lines().any(|l| l == SETTINGS_REL));
        assert_eq!(
            fs::read_to_string(d.path().join(".gitignore")).unwrap(),
            "node_modules\n"
        );
        // `git status` ziet het bestand niet meer
        let st = std::process::Command::new("git")
            .args(["status", "--porcelain", "-uall"])
            .current_dir(d.path())
            .output()
            .unwrap();
        assert!(!String::from_utf8_lossy(&st.stdout).contains("settings.local.json"));
    }

    #[test]
    fn behoudt_alle_bestaande_instellingen_en_andere_goedgekeurde_servers() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join(".claude")).unwrap();
        fs::write(
            settings_path(d.path()),
            r#"{"permissions":{"allow":["Bash(npm test)"]},"enabledMcpjsonServers":["github"],"model":"x"}"#,
        )
        .unwrap();
        assert_eq!(ensure(d.path()).unwrap(), Outcome::Approved);
        let v = read(d.path());
        assert_eq!(v["permissions"]["allow"][0], "Bash(npm test)");
        assert_eq!(v["enabledMcpjsonServers"], json!(["github", "studio"]));
        assert_eq!(v["model"], "x");
        let keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, vec!["permissions", "enabledMcpjsonServers", "model"]);
    }

    #[test]
    fn is_idempotent_en_schrijft_niet_opnieuw() {
        let d = tempfile::tempdir().unwrap();
        ensure(d.path()).unwrap();
        let before = fs::read(settings_path(d.path())).unwrap();
        assert_eq!(ensure(d.path()).unwrap(), Outcome::AlreadyApproved);
        assert_eq!(fs::read(settings_path(d.path())).unwrap(), before);
    }

    #[test]
    fn een_afwijzing_door_de_gebruiker_wordt_gerespecteerd() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join(".claude")).unwrap();
        let raw = r#"{"disabledMcpjsonServers":["studio"]}"#;
        fs::write(settings_path(d.path()), raw).unwrap();
        assert_eq!(ensure(d.path()).unwrap(), Outcome::Rejected);
        assert_eq!(fs::read_to_string(settings_path(d.path())).unwrap(), raw);
    }

    #[test]
    fn ongeldige_of_onverwachte_inhoud_blijft_onaangeroerd() {
        for kapot in [
            "{ // opmerking\n}",
            "[1]",
            r#"{"enabledMcpjsonServers":"studio"}"#,
        ] {
            let d = tempfile::tempdir().unwrap();
            fs::create_dir(d.path().join(".claude")).unwrap();
            fs::write(settings_path(d.path()), kapot).unwrap();
            assert!(ensure(d.path()).is_err(), "{kapot}");
            assert_eq!(fs::read_to_string(settings_path(d.path())).unwrap(), kapot);
        }
    }

    #[test]
    fn zonder_git_repository_wordt_er_niets_geexcludeerd_en_geen_fout() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(ensure(d.path()).unwrap(), Outcome::Approved);
        assert!(!d.path().join(".git").exists());
    }
}
