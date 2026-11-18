//! Wat de werkruimte over een project moet weten: pagina's, bestanden, foto's, signalen voor de voortgang en gegevens.
//! Alles leest alleen binnen de projectmap; verwijderen kan alleen in `assets/` en alleen één bestand tegelijk.

use crate::assets;
use crate::error::{AppError, Result};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "dist",
    "build",
    "target",
    ".git",
    ".next",
    ".svelte-kit",
    "coverage",
    ".dart_tool",
    ".venv",
    "__pycache__",
];
const MAX_ENTRIES: usize = 600;
const MAX_READ: usize = 200_000;

fn invalid(m: &str) -> AppError {
    AppError::Invalid(m.into())
}

/// Bestanden die nooit getoond of gelezen worden: geheimen.
fn is_secret(name: &str) -> bool {
    let n = name.to_lowercase();
    n == ".env"
        || n.starts_with(".env.") && n != ".env.example"
        || n.ends_with(".pem")
        || n.ends_with(".key")
        || n.ends_with(".p12")
        || n.ends_with(".pfx")
        || n == "id_rsa"
        || n == "id_ed25519"
        || n == "studio.json.secret"
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PageInfo {
    pub naam: String,
    /// Adres in de preview, bijvoorbeeld "/" of "/over".
    pub pad: String,
    /// Bestand waar de pagina vandaan komt (relatief), of leeg.
    pub bestand: String,
}

fn mooie_naam(pad: &str) -> String {
    if pad == "/" {
        return "Startpagina".into();
    }
    let seg = pad.trim_matches('/').rsplit('/').next().unwrap_or("");
    let seg = seg.trim_end_matches(".html").replace(['-', '_'], " ");
    let mut c = seg.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => "Pagina".into(),
    }
}

fn walk(dir: &Path, rel: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > 4 || out.len() > 4000 {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            walk(&e.path(), &rel.join(&name), depth + 1, out);
        } else if ft.is_file() {
            out.push(rel.join(&name));
        }
    }
}

fn route_paden(tekst: &str) -> Vec<String> {
    // path="/over", path: '/contact' (React Router, TanStack, eigen routelijsten). Alleen eenvoudige, vaste paden.
    let mut out = vec![];
    let bytes = tekst.as_bytes();
    let mut i = 0;
    while let Some(p) = tekst[i..].find("path") {
        let start = i + p + 4;
        i = start;
        let rest = tekst[start..].trim_start();
        let rest = if let Some(r) = rest.strip_prefix('=').or_else(|| rest.strip_prefix(':')) {
            r.trim_start()
        } else {
            continue;
        };
        let rest = rest.strip_prefix('{').map(str::trim_start).unwrap_or(rest);
        let q = rest.chars().next();
        if !matches!(q, Some('"') | Some('\'')) {
            continue;
        }
        let q = q.unwrap();
        let body = &rest[1..];
        if let Some(end) = body.find(q) {
            let v = &body[..end];
            if v.starts_with('/') && v.len() <= 80 && !v.contains(['*', ':', '{', ' ']) {
                out.push(v.to_string());
            }
        }
        if i >= bytes.len() {
            break;
        }
    }
    out
}

/// De pagina's van de app: HTML-bestanden, of voor een app met routes de vaste routes en de bestanden in `src/pages`.
pub fn pages(dir: &Path) -> Result<Vec<PageInfo>> {
    let mut files = vec![];
    walk(dir, Path::new(""), 0, &mut files);
    let heeft_src = files.iter().any(|f| f.starts_with("src"));
    let mut out: Vec<PageInfo> = vec![];
    let push = |pad: String, bestand: String, out: &mut Vec<PageInfo>| {
        if !out.iter().any(|p| p.pad == pad) {
            out.push(PageInfo {
                naam: mooie_naam(&pad),
                pad,
                bestand,
            });
        }
    };
    // Routes in de code (alleen bij een app met src/).
    if heeft_src {
        for f in files
            .iter()
            .filter(|f| {
                f.starts_with("src")
                    && matches!(
                        f.extension().and_then(|e| e.to_str()),
                        Some("tsx" | "jsx" | "ts" | "js" | "vue" | "svelte")
                    )
            })
            .take(300)
        {
            let Ok(t) = fs::read_to_string(dir.join(f)) else {
                continue;
            };
            if t.len() > 300_000 {
                continue;
            }
            for p in route_paden(&t) {
                push(p, f.to_string_lossy().replace('\\', "/"), &mut out);
            }
        }
        for f in files
            .iter()
            .filter(|f| f.starts_with("src/pages") || f.starts_with("src/routes"))
        {
            let ext = f.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !matches!(ext, "tsx" | "jsx" | "vue" | "svelte") {
                continue;
            }
            let stem = f.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            if stem.starts_with('_') || stem.starts_with('[') || stem.contains('.') {
                continue;
            }
            let pad = if stem.eq_ignore_ascii_case("index") || stem.eq_ignore_ascii_case("home") {
                "/".into()
            } else {
                format!("/{}", stem.to_lowercase())
            };
            push(pad, f.to_string_lossy().replace('\\', "/"), &mut out);
        }
    }
    // HTML-bestanden (bij een app met src/ is het enige index.html alleen de schil).
    for f in files
        .iter()
        .filter(|f| f.extension().and_then(|e| e.to_str()) == Some("html"))
    {
        let s = f.to_string_lossy().replace('\\', "/");
        if heeft_src && s == "index.html" {
            if out.is_empty() {
                push("/".into(), s, &mut out);
            }
            continue;
        }
        let pad = if s == "index.html" {
            "/".to_string()
        } else if let Some(d) = s.strip_suffix("/index.html") {
            format!("/{d}/")
        } else {
            format!("/{s}")
        };
        push(pad, s, &mut out);
    }
    out.sort_by_key(|p| (p.pad != "/", p.pad.clone()));
    out.truncate(50);
    Ok(out)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FileEntry {
    pub pad: String,
    pub grootte: u64,
}

/// Bestanden van het project voor het onderdeel Code/bestanden: geen geheimen, geen node_modules, geen verborgen mappen.
pub fn files(dir: &Path) -> Result<Vec<FileEntry>> {
    let mut v = vec![];
    walk(dir, Path::new(""), 0, &mut v);
    let mut out: Vec<FileEntry> = v
        .into_iter()
        .filter(|f| {
            !is_secret(
                &f.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
            )
        })
        .filter(|f| {
            !f.file_name().is_some_and(|n| {
                n.to_string_lossy().starts_with(".") && n != ".gitignore" && n != ".env.example"
            })
        })
        .map(|f| FileEntry {
            grootte: fs::metadata(dir.join(&f)).map(|m| m.len()).unwrap_or(0),
            pad: f.to_string_lossy().replace('\\', "/"),
        })
        .collect();
    out.sort_by_key(|a| a.pad.to_lowercase());
    out.truncate(MAX_ENTRIES);
    Ok(out)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FileContent {
    pub tekst: String,
    pub ingekort: bool,
}

/// Leest één tekstbestand binnen het project (alleen lezen). Geheimen, snelkoppelingen naar buiten en binaire bestanden worden geweigerd.
pub fn read_file(dir: &Path, rel: &str) -> Result<FileContent> {
    if rel.is_empty()
        || rel.contains('\0')
        || Path::new(rel).is_absolute()
        || rel.split(['/', '\\']).any(|s| s == "..")
    {
        return Err(invalid("Dit pad is niet toegestaan."));
    }
    let name = Path::new(rel)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if is_secret(&name) || rel.split('/').any(|s| s == ".git" || s == "node_modules") {
        return Err(invalid(
            "Dit bestand toon ik niet: het kan geheimen bevatten.",
        ));
    }
    let real_root = dir.canonicalize()?;
    let real = dir
        .join(rel)
        .canonicalize()
        .map_err(|_| invalid("Dit bestand bestaat niet."))?;
    if !real.starts_with(&real_root) || !real.is_file() {
        return Err(invalid("Dit pad is niet toegestaan."));
    }
    let bytes = fs::read(&real)?;
    let ingekort = bytes.len() > MAX_READ;
    let slice = &bytes[..bytes.len().min(MAX_READ)];
    if slice.contains(&0) {
        return Err(invalid("Dit is geen tekstbestand."));
    }
    let tekst = String::from_utf8_lossy(slice).to_string();
    Ok(FileContent { tekst, ingekort })
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AssetInfo {
    pub naam: String,
    pub pad: String,
    pub soort: String,
    pub grootte: u64,
}

/// De foto's en bestanden in `assets/` (nieuwste eerst). Verborgen en tijdelijke bestanden tellen niet mee.
pub fn assets_list(dir: &Path) -> Result<Vec<AssetInfo>> {
    let a = dir.join(assets::ASSETS_DIR);
    let Ok(rd) = fs::read_dir(&a) else {
        return Ok(vec![]);
    };
    let mut out: Vec<(std::time::SystemTime, AssetInfo)> = vec![];
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Ok(md) = e.metadata() else { continue };
        if name.starts_with('.')
            || !md.is_file()
            || e.file_type().map(|t| t.is_symlink()).unwrap_or(true)
        {
            continue;
        }
        let ext = Path::new(&name)
            .extension()
            .and_then(|x| x.to_str())
            .unwrap_or("")
            .to_lowercase();
        out.push((
            md.modified().unwrap_or(std::time::UNIX_EPOCH),
            AssetInfo {
                pad: format!("{}/{name}", assets::ASSETS_DIR),
                soort: assets::kind_of(&ext).into(),
                grootte: md.len(),
                naam: name,
            },
        ));
    }
    out.sort_by_key(|x| std::cmp::Reverse(x.0));
    Ok(out.into_iter().map(|x| x.1).collect())
}

/// Verwijdert precies één bestand uit `assets/`. Mappen, andere plekken en snelkoppelingen worden geweigerd.
pub fn assets_delete(dir: &Path, rel: &str) -> Result<()> {
    let name = rel
        .strip_prefix(&format!("{}/", assets::ASSETS_DIR))
        .ok_or_else(|| invalid("Alleen bestanden uit de map ‘assets’ kunnen worden verwijderd."))?;
    if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') || name.contains('\0')
    {
        return Err(invalid("Dit bestand kan niet worden verwijderd."));
    }
    let real = assets::resolve_asset(dir, rel)?;
    let md = fs::symlink_metadata(&real)?;
    if !md.is_file() {
        return Err(invalid("Dit is geen bestand."));
    }
    fs::remove_file(real)?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct Signals {
    /// PROJECT.md bevat meer dan alleen de lege koppen.
    pub project_md_ingevuld: bool,
    /// De AI heeft gemeld dat de app opslag nodig heeft (`needs_data`).
    pub needs_data: bool,
    pub needs_data_reden: Option<String>,
    /// Er staat een database of migratiemap in het project.
    pub heeft_database: bool,
    pub aantal_assets: usize,
}

const DB_DIRS: &[&str] = &["migrations", "supabase", "prisma", "drizzle", "db"];

pub fn sqlite_files(dir: &Path) -> Vec<String> {
    let mut v = vec![];
    walk(dir, Path::new(""), 0, &mut v);
    v.into_iter()
        .filter(|f| {
            matches!(
                f.extension().and_then(|e| e.to_str()),
                Some("db" | "sqlite" | "sqlite3")
            )
        })
        .map(|f| f.to_string_lossy().replace('\\', "/"))
        .take(10)
        .collect()
}

pub fn signals(dir: &Path) -> Signals {
    let md = fs::read_to_string(dir.join("PROJECT.md")).unwrap_or_default();
    let ingevuld = md.lines().any(|l| {
        let t = l.trim();
        !t.is_empty() && !t.starts_with('#')
    });
    let needs = fs::read_to_string(dir.join(".studio").join("needs-data.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
    let heeft_db = DB_DIRS.iter().any(|d| {
        dir.join(d).is_dir()
            && !fs::symlink_metadata(dir.join(d))
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(true)
    }) || !sqlite_files(dir).is_empty();
    Signals {
        project_md_ingevuld: ingevuld,
        needs_data: needs.is_some(),
        needs_data_reden: needs.and_then(|n| {
            n.get("reden")
                .and_then(|r| r.as_str())
                .map(|s| s.chars().take(300).collect())
        }),
        heeft_database: heeft_db,
        aantal_assets: assets_list(dir).map(|a| a.len()).unwrap_or(0),
    }
}

// ---------- gegevens (alleen lezen) ----------

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TableInfo {
    pub naam: String,
    pub rijen: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DataFile {
    pub bestand: String,
    pub tabellen: Vec<TableInfo>,
}

fn open_ro(dir: &Path, rel: &str) -> Result<rusqlite::Connection> {
    if !sqlite_files(dir).iter().any(|f| f == rel) {
        return Err(invalid("Dit gegevensbestand hoort niet bij het project."));
    }
    let real = dir.join(rel).canonicalize()?;
    if !real.starts_with(dir.canonicalize()?) {
        return Err(invalid("Dit pad is niet toegestaan."));
    }
    Ok(rusqlite::Connection::open_with_flags(
        real,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?)
}

fn quote(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

/// De tabellen van de SQLite-bestanden in het project, alleen lezen.
pub fn data_overview(dir: &Path) -> Result<Vec<DataFile>> {
    let mut out = vec![];
    for f in sqlite_files(dir) {
        let Ok(c) = open_ro(dir, &f) else { continue };
        let Ok(mut st) = c.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name") else { continue };
        let namen: Vec<String> = st
            .query_map([], |r| r.get(0))
            .map(|r| r.flatten().collect())
            .unwrap_or_default();
        let tabellen = namen
            .into_iter()
            .map(|n| TableInfo {
                rijen: c
                    .query_row(&format!("SELECT COUNT(*) FROM {}", quote(&n)), [], |r| {
                        r.get(0)
                    })
                    .unwrap_or(0),
                naam: n,
            })
            .collect();
        out.push(DataFile {
            bestand: f,
            tabellen,
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TableRows {
    pub kolommen: Vec<String>,
    pub rijen: Vec<Vec<String>>,
    pub totaal: i64,
}

/// De eerste rijen van een tabel, alleen lezen. De tabelnaam moet bestaan; geheime of binaire waarden worden niet getoond.
pub fn table_rows(dir: &Path, rel: &str, tabel: &str, limiet: usize) -> Result<TableRows> {
    let c = open_ro(dir, rel)?;
    let bestaat: i64 = c.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1 AND name NOT LIKE 'sqlite_%'", [tabel], |r| r.get(0))?;
    if bestaat == 0 {
        return Err(invalid("Deze tabel bestaat niet."));
    }
    let limiet = limiet.clamp(1, 200);
    let mut st = c.prepare(&format!("SELECT * FROM {} LIMIT {limiet}", quote(tabel)))?;
    let kolommen: Vec<String> = st.column_names().iter().map(|s| s.to_string()).collect();
    let n = kolommen.len();
    let rijen = st
        .query_map([], |r| {
            (0..n)
                .map(|i| {
                    Ok(match r.get_ref(i)? {
                        rusqlite::types::ValueRef::Null => String::new(),
                        rusqlite::types::ValueRef::Integer(v) => v.to_string(),
                        rusqlite::types::ValueRef::Real(v) => v.to_string(),
                        rusqlite::types::ValueRef::Text(t) => {
                            String::from_utf8_lossy(t).chars().take(200).collect()
                        }
                        rusqlite::types::ValueRef::Blob(_) => "[binair]".into(),
                    })
                })
                .collect::<rusqlite::Result<Vec<String>>>()
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let totaal: i64 = c.query_row(&format!("SELECT COUNT(*) FROM {}", quote(tabel)), [], |r| {
        r.get(0)
    })?;
    Ok(TableRows {
        kolommen,
        rijen,
        totaal,
    })
}

// ---------- korte beschrijving (PROJECT.md, kop "Doel") ----------

const DOEL_KOP: &str = "## Doel";

/// De korte beschrijving van het project: de tekst onder de kop "Doel" in PROJECT.md (leeg als die er niet is).
pub fn description_get(dir: &Path) -> String {
    let md = fs::read_to_string(dir.join("PROJECT.md")).unwrap_or_default();
    let mut lines = md.lines().skip_while(|l| l.trim() != DOEL_KOP).skip(1);
    let mut out = vec![];
    for l in lines.by_ref() {
        if l.starts_with("## ") || l.starts_with("# ") {
            break;
        }
        out.push(l);
    }
    out.join("\n").trim().to_string()
}

/// Schrijft de beschrijving onder de kop "Doel" en laat de rest van PROJECT.md ongemoeid. Een ontbrekende kop wordt toegevoegd.
pub fn description_set(dir: &Path, text: &str) -> Result<()> {
    let text = text.trim();
    if text.chars().count() > 600 {
        return Err(invalid("De beschrijving is te lang (maximaal 600 tekens)."));
    }
    if text.lines().any(|l| l.starts_with('#')) {
        return Err(invalid(
            "Begin een regel niet met een #; dat zijn koppen in PROJECT.md.",
        ));
    }
    let path = dir.join("PROJECT.md");
    let md = fs::read_to_string(&path).unwrap_or_default();
    let lines: Vec<&str> = md.lines().collect();
    let new_block = if text.is_empty() {
        String::new()
    } else {
        format!("{text}\n")
    };
    let out = if let Some(start) = lines.iter().position(|l| l.trim() == DOEL_KOP) {
        let end = lines
            .iter()
            .skip(start + 1)
            .position(|l| l.starts_with("## ") || l.starts_with("# "))
            .map(|e| start + 1 + e)
            .unwrap_or(lines.len());
        let mut v: Vec<String> = lines[..=start].iter().map(|l| l.to_string()).collect();
        v.push(String::new());
        if !new_block.is_empty() {
            v.push(text.to_string());
            v.push(String::new());
        }
        v.extend(lines[end..].iter().map(|l| l.to_string()));
        v.join("\n") + "\n"
    } else {
        format!("{}\n{DOEL_KOP}\n\n{new_block}", md.trim_end())
    };
    fs::write(path, out)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }
    fn w(d: &Path, rel: &str, s: &str) {
        let p = d.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, s).unwrap();
    }

    #[test]
    fn paginas_van_een_statische_site() {
        let d = tmp();
        w(d.path(), "index.html", "<h1>x</h1>");
        w(d.path(), "over-ons.html", "x");
        w(d.path(), "diensten/index.html", "x");
        w(d.path(), "node_modules/x/index.html", "x");
        let p = pages(d.path()).unwrap();
        let v: Vec<(&str, &str)> = p
            .iter()
            .map(|x| (x.naam.as_str(), x.pad.as_str()))
            .collect();
        assert_eq!(
            v,
            vec![
                ("Startpagina", "/"),
                ("Diensten", "/diensten/"),
                ("Over ons", "/over-ons.html")
            ]
        );
    }

    #[test]
    fn paginas_van_een_react_app_uit_routes_en_pagina_bestanden() {
        let d = tmp();
        w(d.path(), "index.html", "<div id=root></div>");
        w(
            d.path(),
            "src/App.tsx",
            r#"<Route path="/" element={<Home/>}/><Route path="/contact" element={<C/>}/><Route path="/blog/:id" element={<B/>}/><Route path="*" />"#,
        );
        w(d.path(), "src/pages/Prijzen.tsx", "export default 1");
        w(d.path(), "src/pages/_layout.tsx", "x");
        let p = pages(d.path()).unwrap();
        let pads: Vec<&str> = p.iter().map(|x| x.pad.as_str()).collect();
        assert_eq!(pads, vec!["/", "/contact", "/prijzen"]);
    }

    #[test]
    fn paginas_react_zonder_routes_geeft_alleen_de_startpagina() {
        let d = tmp();
        w(d.path(), "index.html", "x");
        w(d.path(), "src/main.tsx", "x");
        assert_eq!(pages(d.path()).unwrap().len(), 1);
        assert!(pages(tmp().path()).unwrap().is_empty());
    }

    #[test]
    fn bestandenlijst_laat_geheimen_en_rommel_weg() {
        let d = tmp();
        w(d.path(), "index.html", "x");
        w(d.path(), ".env", "GEHEIM=1");
        w(d.path(), ".env.local", "GEHEIM=1");
        w(d.path(), ".env.example", "A=");
        w(d.path(), "sleutel.pem", "x");
        w(d.path(), "node_modules/a.js", "x");
        w(d.path(), ".git/config", "x");
        w(d.path(), "src/a.ts", "x");
        let namen: Vec<String> = files(d.path())
            .unwrap()
            .into_iter()
            .map(|f| f.pad)
            .collect();
        assert_eq!(namen, vec![".env.example", "index.html", "src/a.ts"]);
    }

    #[test]
    fn bestand_lezen_weigert_geheimen_paden_buiten_het_project_en_binair() {
        let d = tmp();
        let buiten = tmp();
        w(d.path(), "a.txt", "hallo");
        w(d.path(), ".env", "S=1");
        w(d.path(), "bin.dat", "a\0b");
        w(buiten.path(), "geheim.txt", "nee");
        assert_eq!(read_file(d.path(), "a.txt").unwrap().tekst, "hallo");
        for slecht in [
            "",
            "../x",
            "/etc/passwd",
            ".env",
            "bin.dat",
            "bestaat-niet",
            "a\0.txt",
        ] {
            assert!(read_file(d.path(), slecht).is_err(), "{slecht}");
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(buiten.path().join("geheim.txt"), d.path().join("link.txt"))
                .unwrap();
            assert!(read_file(d.path(), "link.txt").is_err());
        }
        w(d.path(), "groot.txt", &"x".repeat(MAX_READ + 10));
        let g = read_file(d.path(), "groot.txt").unwrap();
        assert!(g.ingekort && g.tekst.len() == MAX_READ);
    }

    #[test]
    fn assets_tonen_en_verwijderen_alleen_binnen_assets() {
        let d = tmp();
        let png = [0x89u8, b'P', b'N', b'G', 0, 0, 0, 0];
        assets::save(d.path(), "foto.png", &png).unwrap();
        w(d.path(), "index.html", "x");
        let l = assets_list(d.path()).unwrap();
        assert_eq!(
            (l.len(), l[0].naam.as_str(), l[0].soort.as_str()),
            (1, "foto.png", "image")
        );
        for slecht in [
            "index.html",
            "assets/../index.html",
            "assets/",
            "assets/.verborgen",
            "../x",
            "assets/sub/x.png",
        ] {
            assert!(assets_delete(d.path(), slecht).is_err(), "{slecht}");
        }
        assert!(d.path().join("index.html").exists());
        assets_delete(d.path(), "assets/foto.png").unwrap();
        assert!(assets_list(d.path()).unwrap().is_empty());
        assert!(assets_delete(d.path(), "assets/foto.png").is_err());
    }

    #[test]
    fn signalen_uit_het_project() {
        let d = tmp();
        let s = signals(d.path());
        assert_eq!(s, Signals::default());
        w(d.path(), "PROJECT.md", "# App\n\n## Doel\n\n## Status\n");
        assert!(!signals(d.path()).project_md_ingevuld);
        w(
            d.path(),
            "PROJECT.md",
            "# App\n\n## Doel\n\nEen site voor mijn tuinbedrijf.\n",
        );
        assert!(signals(d.path()).project_md_ingevuld);
        w(
            d.path(),
            ".studio/needs-data.json",
            r#"{"reden":"Bestellingen bewaren","op":"x"}"#,
        );
        let s = signals(d.path());
        assert!(s.needs_data);
        assert_eq!(s.needs_data_reden.as_deref(), Some("Bestellingen bewaren"));
        assert!(!s.heeft_database);
        fs::create_dir(d.path().join("migrations")).unwrap();
        assert!(signals(d.path()).heeft_database);
    }

    #[test]
    fn gegevens_alleen_lezen_met_gecontroleerde_tabelnaam() {
        let d = tmp();
        let p = d.path().join("data/app.sqlite");
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        {
            let c = rusqlite::Connection::open(&p).unwrap();
            c.execute_batch("CREATE TABLE klanten(id INTEGER, naam TEXT, foto BLOB); INSERT INTO klanten VALUES (1,'Joke',x'0102'),(2,NULL,NULL); CREATE TABLE \"raar\"\"naam\"(x);").unwrap();
        }
        let o = data_overview(d.path()).unwrap();
        assert_eq!(o.len(), 1);
        assert_eq!(o[0].bestand, "data/app.sqlite");
        assert!(o[0].tabellen.contains(&TableInfo {
            naam: "klanten".into(),
            rijen: 2
        }));
        let r = table_rows(d.path(), "data/app.sqlite", "klanten", 50).unwrap();
        assert_eq!(r.kolommen, vec!["id", "naam", "foto"]);
        assert_eq!(r.rijen[0], vec!["1", "Joke", "[binair]"]);
        assert_eq!((r.totaal, r.rijen[1][1].as_str()), (2, ""));
        assert!(table_rows(
            d.path(),
            "data/app.sqlite",
            "klanten; DROP TABLE klanten",
            5
        )
        .is_err());
        assert!(table_rows(d.path(), "data/app.sqlite", "sqlite_master", 5).is_err());
        assert!(table_rows(d.path(), "../buiten.sqlite", "x", 5).is_err());
        assert!(table_rows(d.path(), "data/app.sqlite", "raar\"naam", 5).is_ok());
        // het bestand is niet gewijzigd en geen schrijfactie is mogelijk
        assert_eq!(
            table_rows(d.path(), "data/app.sqlite", "klanten", 5)
                .unwrap()
                .totaal,
            2
        );
    }

    #[test]
    fn beschrijving_lezen_en_schrijven_zonder_de_rest_te_raken() {
        let d = tmp();
        w(
            d.path(),
            "PROJECT.md",
            "# App\n\n## Doel\n\n## Doelgroep\n\nMensen.\n\n## Status\n",
        );
        assert_eq!(description_get(d.path()), "");
        description_set(d.path(), "  Een site voor mijn tuinbedrijf.  ").unwrap();
        assert_eq!(description_get(d.path()), "Een site voor mijn tuinbedrijf.");
        let md = fs::read_to_string(d.path().join("PROJECT.md")).unwrap();
        assert!(md.contains("## Doelgroep\n\nMensen.") && md.contains("## Status"));
        description_set(d.path(), "").unwrap();
        assert_eq!(description_get(d.path()), "");
        assert!(description_set(d.path(), "# kop").is_err());
        assert!(description_set(d.path(), &"x".repeat(601)).is_err());
        let leeg = tmp();
        description_set(leeg.path(), "Nieuw").unwrap();
        assert_eq!(description_get(leeg.path()), "Nieuw");
    }
}
