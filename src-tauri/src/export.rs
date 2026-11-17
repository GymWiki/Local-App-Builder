//! "Download je project": een zip met alleen wat van de gebruiker is. Geen afhankelijkheden, bouwuitvoer of geheimen.
use crate::error::{AppError, Result};
use ignore::WalkBuilder;
use serde::Serialize;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;

/// Mappen die nooit mee gaan (afhankelijkheden, bouwuitvoer, versiebeheer en Studio zelf).
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "dist",
    "build",
    "out",
    "target",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".cache",
    "coverage",
    "__pycache__",
    "venv",
    ".venv",
    ".dart_tool",
    ".gradle",
    ".git",
    ".studio",
    ".idea",
];
/// Bestanden die nooit mee gaan, ook niet als ze niet in .gitignore staan (geheimen).
const MAX_FILE: u64 = 100 * 1024 * 1024;

#[derive(Debug, Serialize, PartialEq)]
pub struct ExportResult {
    pub path: String,
    pub files: usize,
    pub bytes: u64,
    /// Geheimen die bewust niet zijn meegenomen (relatieve paden).
    pub skipped_secrets: Vec<String>,
    /// Te grote bestanden die zijn overgeslagen.
    pub skipped_large: Vec<String>,
}

/// Is dit een bestand met geheimen (sleutels, tokens, .env)? `.env.example` mag wel mee.
pub fn is_secret(rel: &str) -> bool {
    let lower = rel.to_lowercase().replace('\\', "/");
    let name = lower.rsplit('/').next().unwrap_or("");
    if name == ".env.example" || name == ".env.sample" || name == ".env.template" {
        return false;
    }
    name == ".env"
        || name.starts_with(".env.")
        || [".pem", ".key", ".p12", ".pfx", ".keystore", ".jks"]
            .iter()
            .any(|e| name.ends_with(e))
        || name.starts_with("id_rsa")
        || name.starts_with("id_ed25519")
        || name.starts_with("id_ecdsa")
        || name == ".npmrc"
        || name == ".netrc"
        || name == "credentials.json"
        || name == "service-account.json"
        || lower.ends_with(".claude/settings.local.json")
}

const NOTE: &str = "Dit project is van jou.\r\n\r\nDe code in deze zip is gewone code: je kunt hem openen, aanpassen en publiceren waar je maar wilt. Hij zit niet vast aan Studio.\r\n\r\nWat er niet in zit: de map node_modules en andere uitvoer die je opnieuw kunt maken (installeer met ‘npm install’), en geheimen zoals .env-bestanden en sleutels.\r\n";

/// Maakt een zip van `project` op `dest`. `dest` mag niet in het project liggen.
pub fn export_zip(project: &Path, dest: &Path) -> Result<ExportResult> {
    let root = project.canonicalize()?;
    if !root.is_dir() {
        return Err(AppError::Invalid("De projectmap bestaat niet meer.".into()));
    }
    if dest
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("zip"))
        != Some(true)
    {
        return Err(AppError::Invalid(
            "Kies een bestandsnaam die op .zip eindigt.".into(),
        ));
    }
    let dest_parent = dest.parent().unwrap_or(Path::new(".")).canonicalize()?;
    if dest_parent.starts_with(&root) {
        return Err(AppError::Invalid(
            "Sla de zip buiten je projectmap op.".into(),
        ));
    }
    let tmp: PathBuf = dest.with_extension("zip.studio-tmp");
    let file = File::create(&tmp)?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let walker = WalkBuilder::new(&root)
        .hidden(false)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(false)
        .require_git(false)
        .parents(false)
        .follow_links(false)
        .filter_entry(|e| {
            !(e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                && e.depth() > 0
                && SKIP_DIRS.contains(&e.file_name().to_string_lossy().as_ref()))
        })
        .build();

    let mut res = ExportResult {
        path: dest.to_string_lossy().to_string(),
        files: 0,
        bytes: 0,
        skipped_secrets: vec![],
        skipped_large: vec![],
    };
    let mut build = || -> Result<()> {
        for entry in walker {
            let entry = entry
                .map_err(|e| AppError::Invalid(format!("Lezen van de projectmap mislukte: {e}")))?;
            let ft = match entry.file_type() {
                Some(t) => t,
                None => continue,
            };
            if !ft.is_file() {
                continue; // mappen komen vanzelf mee; snelkoppelingen slaan we over
            }
            let rel = entry
                .path()
                .strip_prefix(&root)
                .unwrap_or(entry.path())
                .to_string_lossy()
                .replace('\\', "/");
            if is_secret(&rel) {
                res.skipped_secrets.push(rel);
                continue;
            }
            let len = entry.metadata().map(|m| m.len()).unwrap_or(0);
            if len > MAX_FILE {
                res.skipped_large.push(rel);
                continue;
            }
            zip.start_file(rel.as_str(), opts)
                .map_err(|e| AppError::Invalid(format!("Zip maken mislukte: {e}")))?;
            let mut f = File::open(entry.path())?;
            let mut buf = Vec::with_capacity(len as usize);
            f.read_to_end(&mut buf)?;
            zip.write_all(&buf)?;
            res.files += 1;
            res.bytes += len;
        }
        zip.start_file("VAN-JOU.txt", opts)
            .map_err(|e| AppError::Invalid(format!("Zip maken mislukte: {e}")))?;
        zip.write_all(NOTE.as_bytes())?;
        Ok(())
    };
    let outcome = build();
    if let Err(e) = outcome {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    zip.finish()
        .map_err(|e| AppError::Invalid(format!("Zip afronden mislukte: {e}")))?;
    fs::rename(&tmp, dest)?;
    res.skipped_secrets.sort();
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn names(zip: &Path) -> BTreeSet<String> {
        let mut z = zip::ZipArchive::new(File::open(zip).unwrap()).unwrap();
        (0..z.len())
            .map(|i| z.by_index(i).unwrap().name().to_string())
            .collect()
    }

    fn project() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        for (f, c) in [
            ("index.html", "<h1>hoi</h1>"),
            ("src/app.tsx", "x"),
            ("src/kit/tokens.css", "x"),
            ("package.json", "{}"),
            ("package-lock.json", "{}"),
            ("node_modules/x/index.js", "x"),
            ("dist/index.js", "x"),
            ("build/a.js", "x"),
            ("target/debug/x", "x"),
            (".git/config", "x"),
            (".studio/picks/a.jpg", "x"),
            (".env", "GEHEIM=1"),
            (".env.local", "GEHEIM=2"),
            (".env.example", "GEHEIM="),
            ("sleutel.pem", "KEY"),
            ("deploy/id_rsa", "KEY"),
            (".npmrc", "//registry:_authToken=x"),
            (".claude/settings.local.json", "{}"),
            (".claude/skills/use-kit/SKILL.md", "x"),
            ("eigen-map/geheim.txt", "x"),
            ("README.md", "x"),
            (".gitignore", "eigen-map/\n*.log\n"),
            ("debug.log", "x"),
        ] {
            let full = p.join(f);
            fs::create_dir_all(full.parent().unwrap()).unwrap();
            fs::write(full, c).unwrap();
        }
        d
    }

    #[test]
    fn neemt_alleen_eigen_code_mee_en_volgt_gitignore() {
        let (p, out) = (project(), tempfile::tempdir().unwrap());
        let dest = out.path().join("project.zip");
        let r = export_zip(p.path(), &dest).unwrap();
        let n = names(&dest);
        for ok in [
            "index.html",
            "src/app.tsx",
            "src/kit/tokens.css",
            "package.json",
            "package-lock.json",
            "README.md",
            ".gitignore",
            ".env.example",
            ".claude/skills/use-kit/SKILL.md",
            "VAN-JOU.txt",
        ] {
            assert!(n.contains(ok), "{ok} ontbreekt in {n:?}");
        }
        for weg in [
            "node_modules/x/index.js",
            "dist/index.js",
            "build/a.js",
            "target/debug/x",
            ".git/config",
            ".studio/picks/a.jpg",
            "eigen-map/geheim.txt",
            "debug.log",
        ] {
            assert!(!n.contains(weg), "{weg} hoort er niet in");
        }
        assert_eq!(r.files, n.len() - 1);
    }

    #[test]
    fn geheimen_gaan_nooit_mee_en_worden_gemeld() {
        let (p, out) = (project(), tempfile::tempdir().unwrap());
        let dest = out.path().join("p.zip");
        let r = export_zip(p.path(), &dest).unwrap();
        let n = names(&dest);
        for geheim in [
            ".env",
            ".env.local",
            "sleutel.pem",
            "deploy/id_rsa",
            ".npmrc",
            ".claude/settings.local.json",
        ] {
            assert!(!n.contains(geheim), "{geheim} is meegenomen!");
            assert!(
                r.skipped_secrets.contains(&geheim.to_string()),
                "{geheim} niet gemeld"
            );
        }
        assert!(!r.skipped_secrets.contains(&".env.example".to_string()));
        let mut z = zip::ZipArchive::new(File::open(&dest).unwrap()).unwrap();
        let mut alles = String::new();
        for i in 0..z.len() {
            let mut s = String::new();
            let _ = z.by_index(i).unwrap().read_to_string(&mut s);
            alles.push_str(&s);
        }
        assert!(!alles.contains("GEHEIM=1") && !alles.contains("authToken"));
    }

    #[test]
    fn de_zip_zegt_dat_de_code_van_de_gebruiker_is() {
        let (p, out) = (project(), tempfile::tempdir().unwrap());
        let dest = out.path().join("p.zip");
        export_zip(p.path(), &dest).unwrap();
        let mut z = zip::ZipArchive::new(File::open(&dest).unwrap()).unwrap();
        let mut s = String::new();
        z.by_name("VAN-JOU.txt")
            .unwrap()
            .read_to_string(&mut s)
            .unwrap();
        assert!(s.contains("Dit project is van jou") && s.contains("niet vast aan Studio"));
    }

    #[test]
    fn weigert_een_bestemming_in_het_project_en_een_naam_zonder_zip() {
        let p = project();
        assert!(export_zip(p.path(), &p.path().join("src").join("x.zip"))
            .unwrap_err()
            .to_string()
            .contains("buiten je projectmap"));
        let out = tempfile::tempdir().unwrap();
        assert!(export_zip(p.path(), &out.path().join("x.txt"))
            .unwrap_err()
            .to_string()
            .contains(".zip"));
        assert!(!out.path().join("x.txt").exists());
    }

    #[test]
    fn raakt_het_project_niet_aan_en_laat_geen_tijdelijk_bestand_achter() {
        let (p, out) = (project(), tempfile::tempdir().unwrap());
        let before: BTreeSet<_> = ignore::WalkBuilder::new(p.path())
            .hidden(false)
            .git_ignore(false)
            .build()
            .flatten()
            .map(|e| e.path().to_path_buf())
            .collect();
        export_zip(p.path(), &out.path().join("p.zip")).unwrap();
        let after: BTreeSet<_> = ignore::WalkBuilder::new(p.path())
            .hidden(false)
            .git_ignore(false)
            .build()
            .flatten()
            .map(|e| e.path().to_path_buf())
            .collect();
        assert_eq!(before, after);
        assert_eq!(fs::read_dir(out.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn snelkoppelingen_worden_overgeslagen() {
        let (p, out) = (project(), tempfile::tempdir().unwrap());
        std::os::unix::fs::symlink("/etc/hosts", p.path().join("link.txt")).unwrap();
        export_zip(p.path(), &out.path().join("p.zip")).unwrap();
        assert!(!names(&out.path().join("p.zip")).contains("link.txt"));
    }

    #[test]
    fn herkent_geheimen_op_naam() {
        for s in [
            ".env",
            "a/.env.production",
            "x.pem",
            "k.KEY",
            "id_rsa",
            "id_ed25519.pub",
            ".npmrc",
            "credentials.json",
            ".claude/settings.local.json",
            "a\\.env",
        ] {
            assert!(is_secret(s), "{s}");
        }
        for s in [
            ".env.example",
            "environment.ts",
            "src/key-icon.svg",
            "keyboard.tsx",
            "package.json",
        ] {
            assert!(!is_secret(s), "{s}");
        }
    }
}
