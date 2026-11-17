//! Meegeleverde templates en kits (`templates/`, `design-packs/`): vinden en een template in een nieuw project zetten.
use crate::error::{AppError, Result};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Zoekt een meegeleverde map. Debug (tauri dev): de map in de repo; release: het resource-bestand.
pub fn bundled(app: &tauri::AppHandle, name: &str) -> Result<PathBuf> {
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(name);
    let res = app.path().resource_dir().ok().map(|d| d.join(name));
    let order: Vec<PathBuf> = if cfg!(debug_assertions) {
        std::iter::once(dev).chain(res).collect()
    } else {
        res.into_iter().chain(std::iter::once(dev)).collect()
    };
    order
        .into_iter()
        .find(|p| p.is_dir())
        .map(|p| crate::winpath::clean_path(&p))
        .ok_or_else(|| AppError::Invalid(format!("De meegeleverde map ‘{name}’ is niet gevonden.")))
}

/// Alleen veilige templatenamen (kleine letters, cijfers, streepjes).
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Kopieert `templates/<naam>` naar `dest`. Bestaande bestanden worden nooit overschreven; `node_modules` en symlinks worden overgeslagen.
pub fn copy_template(templates: &Path, name: &str, dest: &Path) -> Result<Vec<String>> {
    if !valid_name(name) {
        return Err(AppError::Invalid("Ongeldige templatenaam.".into()));
    }
    let from = templates.join(name);
    if !from.is_dir() {
        return Err(AppError::Invalid("Dit template bestaat niet.".into()));
    }
    let mut copied = Vec::new();
    copy_dir(&from, &from, dest, &mut copied)?;
    copied.sort();
    Ok(copied)
}

fn copy_dir(root: &Path, dir: &Path, dest: &Path, out: &mut Vec<String>) -> Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();
        if name == "node_modules" {
            continue;
        }
        let ft = entry.file_type()?;
        if ft.is_symlink() {
            continue;
        }
        let rel = path.strip_prefix(root).unwrap_or(&path);
        let target = dest.join(rel);
        if ft.is_dir() {
            fs::create_dir_all(&target)?;
            copy_dir(root, &path, dest, out)?;
        } else if ft.is_file() && !target.exists() {
            if let Some(p) = target.parent() {
                fs::create_dir_all(p)?;
            }
            fs::copy(&path, &target)?;
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn template(root: &Path) {
        let t = root.join("web-x");
        fs::create_dir_all(t.join("src/kit")).unwrap();
        fs::create_dir_all(t.join("node_modules/x")).unwrap();
        fs::write(t.join("package.json"), "{}").unwrap();
        fs::write(t.join(".gitignore"), "node_modules").unwrap();
        fs::write(t.join("src/kit/index.ts"), "export {};").unwrap();
        fs::write(t.join("node_modules/x/a.js"), "x").unwrap();
    }

    #[test]
    fn kopieert_bestanden_inclusief_verborgene_maar_niet_node_modules() {
        let (t, d) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        template(t.path());
        let copied = copy_template(t.path(), "web-x", d.path()).unwrap();
        assert_eq!(
            copied,
            vec![".gitignore", "package.json", "src/kit/index.ts"]
        );
        assert!(d.path().join("src/kit/index.ts").is_file());
        assert!(!d.path().join("node_modules").exists());
    }

    #[test]
    fn overschrijft_nooit_bestaande_bestanden() {
        let (t, d) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        template(t.path());
        fs::write(d.path().join("package.json"), "mijn eigen").unwrap();
        let copied = copy_template(t.path(), "web-x", d.path()).unwrap();
        assert!(!copied.contains(&"package.json".to_string()));
        assert_eq!(
            fs::read_to_string(d.path().join("package.json")).unwrap(),
            "mijn eigen"
        );
    }

    #[test]
    fn weigert_rare_namen_en_onbekende_templates() {
        let (t, d) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        template(t.path());
        for naam in ["", "../web-x", "web/x", "WEB-X", "web x", ".."] {
            assert!(copy_template(t.path(), naam, d.path()).is_err(), "{naam}");
        }
        assert!(copy_template(t.path(), "bestaat-niet", d.path()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn slaat_snelkoppelingen_over() {
        let (t, d) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        template(t.path());
        std::os::unix::fs::symlink("/etc/hosts", t.path().join("web-x/link")).unwrap();
        let copied = copy_template(t.path(), "web-x", d.path()).unwrap();
        assert!(!copied.contains(&"link".to_string()));
        assert!(!d.path().join("link").exists());
    }
}
