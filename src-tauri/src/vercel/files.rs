//! Welke bestanden gaan naar Vercel: alles in het project behalve wat er nooit hoort te staan (geheimen, afhankelijkheden, tijdelijke
//! mappen). Voor het uploaden scannen we op geheimen (zelfde scan als de GitHub-back-up) en bewaken we de grootte.
use crate::github::scan::{by_name, scan_text, Finding};
use regex::Regex;
use sha1::{Digest, Sha1};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

pub const MAX_FILE: u64 = 50 * 1024 * 1024;
pub const MAX_TOTAL: u64 = 200 * 1024 * 1024;
pub const MAX_FILES: usize = 5_000;
const MAX_TEXT_SCAN: u64 = 600_000;
const SKIP_DIRS: &[&str] = &[".git", "node_modules", ".studio", ".vercel", ".dart_tool", ".gradle", ".idea", "target", "__pycache__", ".venv", "venv"];

#[derive(Debug, Clone)]
pub struct Entry {
    pub rel: String,
    pub path: PathBuf,
    pub size: u64,
    pub sha: String,
}

#[derive(Debug, Default)]
pub struct Collected {
    pub files: Vec<Entry>,
    pub total: u64,
    /// Bestanden die we bewust niet meesturen (geheimen, `.env`).
    pub overgeslagen: Vec<String>,
    pub geheimen: Vec<Finding>,
    pub te_groot: Vec<String>,
    pub te_veel: bool,
}

fn sha1_hex(data: &[u8]) -> String {
    let mut h = Sha1::new();
    h.update(data);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn walk(root: &Path, dir: &Path, out: &mut Collected) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = rd.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let Ok(ft) = e.file_type() else { continue };
        let name = e.file_name().to_string_lossy().to_string();
        if ft.is_symlink() {
            continue; // nooit buiten de projectmap kijken
        }
        let path = e.path();
        if ft.is_dir() {
            if !SKIP_DIRS.contains(&name.as_str()) {
                walk(root, &path, out);
            }
            continue;
        }
        if !ft.is_file() || name == ".DS_Store" || name.ends_with(".log") {
            continue;
        }
        let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
        if by_name(&rel).is_some() {
            out.overgeslagen.push(rel);
            continue;
        }
        let Ok(meta) = e.metadata() else { continue };
        let size = meta.len();
        if size > MAX_FILE {
            out.te_groot.push(rel);
            continue;
        }
        if out.files.len() >= MAX_FILES || out.total + size > MAX_TOTAL {
            out.te_veel = true;
            return;
        }
        let Ok(data) = fs::read(&path) else { continue };
        if size <= MAX_TEXT_SCAN && !data.iter().take(8000).any(|&b| b == 0) {
            scan_text(&rel, &String::from_utf8_lossy(&data), false, out.geheimen_vec());
        }
        out.total += size;
        out.files.push(Entry { rel, path, size, sha: sha1_hex(&data) });
    }
}

impl Collected {
    fn geheimen_vec(&mut self) -> &mut Vec<Finding> {
        &mut self.geheimen
    }
    /// Vondsten die het online zetten tegenhouden (alleen "hoog": een wachtwoord in code is een waarschuwing).
    pub fn blokkades(&self) -> Vec<&Finding> {
        self.geheimen.iter().filter(|f| f.ernst == "hoog").collect()
    }
}

pub fn collect(dir: &Path) -> Collected {
    let mut c = Collected::default();
    walk(dir, dir, &mut c);
    c
}

/// De gegevens van een bestand voor de upload (pas gelezen als het echt nodig is).
pub fn read(e: &Entry) -> Option<Vec<u8>> {
    fs::read(&e.path).ok()
}

/// Namen van omgevingsvariabelen die de code gebruikt (`import.meta.env.X`, `process.env.X`) en die in `.env.example` staan.
pub fn used_env_names(dir: &Path) -> BTreeSet<String> {
    const SKIP: &[&str] = &["MODE", "DEV", "PROD", "SSR", "BASE_URL", "NODE_ENV", "CI", "PORT", "PWD", "HOME", "PATH", "TZ"];
    let re = Regex::new(r"(?:import\.meta\.env|process\.env)\.([A-Z][A-Z0-9_]{1,63})\b").unwrap();
    let mut names = BTreeSet::new();
    let c = collect(dir);
    for f in c.files.iter().filter(|f| f.size < MAX_TEXT_SCAN && matches!(f.rel.rsplit('.').next(), Some("js" | "jsx" | "ts" | "tsx" | "mjs" | "vue" | "svelte" | "astro" | "html"))) {
        if let Some(d) = read(f) {
            for m in re.captures_iter(&String::from_utf8_lossy(&d)) {
                if !SKIP.contains(&&m[1]) && !m[1].starts_with("VERCEL") {
                    names.insert(m[1].to_string());
                }
            }
        }
    }
    if let Ok(t) = fs::read_to_string(dir.join(".env.example")) {
        for l in t.lines() {
            let n = l.split('=').next().unwrap_or("").trim();
            if n.len() > 1 && n.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_') && n.chars().next().is_some_and(|c| c.is_ascii_uppercase()) {
                names.insert(n.to_string());
            }
        }
    }
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(d: &Path, p: &str, c: &str) {
        let f = d.join(p);
        fs::create_dir_all(f.parent().unwrap()).unwrap();
        fs::write(f, c).unwrap();
    }

    #[test]
    fn neemt_projectbestanden_mee_maar_geen_geheimen_of_afhankelijkheden() {
        let d = tempfile::tempdir().unwrap();
        w(d.path(), "index.html", "<h1>x</h1>");
        w(d.path(), "src/app.ts", "export {}");
        w(d.path(), "node_modules/pak/index.js", "x");
        w(d.path(), ".git/config", "x");
        w(d.path(), ".env", "A=1");
        w(d.path(), ".env.production", "A=1");
        w(d.path(), ".env.example", "A=");
        w(d.path(), "sleutel.pem", "x");
        let c = collect(d.path());
        let namen: Vec<&str> = c.files.iter().map(|f| f.rel.as_str()).collect();
        assert_eq!(namen, vec![".env.example", "index.html", "src/app.ts"]);
        assert!(c.overgeslagen.contains(&".env".to_string()) && c.overgeslagen.contains(&"sleutel.pem".to_string()));
        assert_eq!(c.files[1].sha, sha1_hex(b"<h1>x</h1>"));
        assert_eq!(c.files[1].sha.len(), 40);
    }

    #[test]
    fn een_sleutel_in_de_code_blokkeert_maar_een_wachtwoord_waarschuwt() {
        let d = tempfile::tempdir().unwrap();
        let sleutel = ["ghp", "_", &"z8Qw".repeat(9)].concat();
        w(d.path(), "src/a.ts", &format!("const t = '{sleutel}';"));
        w(d.path(), "src/b.ts", "const wachtwoord = \"KoeienOpDeWei2024\";");
        let c = collect(d.path());
        assert_eq!(c.blokkades().len(), 1);
        assert_eq!(c.geheimen.len(), 2);
        assert!(!serde_json::to_string(&c.geheimen).unwrap().contains(&sleutel));
    }

    #[test]
    fn zoekt_gebruikte_variabelen() {
        let d = tempfile::tempdir().unwrap();
        w(d.path(), "src/a.ts", "const u = import.meta.env.VITE_URL; const m = import.meta.env.MODE; const k = process.env.STRIPE_KEY;");
        w(d.path(), ".env.example", "# uitleg\nEXTRA_NAAM=\nkleine=1\n");
        let n = used_env_names(d.path());
        assert_eq!(n.into_iter().collect::<Vec<_>>(), vec!["EXTRA_NAAM", "STRIPE_KEY", "VITE_URL"]);
    }
}
