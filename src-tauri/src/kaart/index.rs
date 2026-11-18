//! De projectindex in SQLite (`<project>/.studio/kaart.db`): per bestand doel, exports, imports, routes, symbolen en tabellen.
//! Incrementeel bijwerken met een inhoudshash; alleen gewijzigde bestanden worden opnieuw verwerkt. Geheimbestanden en alles uit de
//! gedeelde ignorelijst (`config/kaart-ignore.json`) komen er nooit in.
use super::parse::{self, Info};
use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

const IGNORE: &str = include_str!("../../../config/kaart-ignore.json");
/// Grenzen zodat een enorm project de app niet vertraagt.
pub const MAX_BESTANDEN: usize = 6000;
pub const MAX_GROOTTE: u64 = 400_000;
const MAX_DIEPTE: usize = 14;

#[derive(Debug, Default, Clone, Serialize, PartialEq)]
pub struct Stand {
    pub nieuw: usize,
    pub gewijzigd: usize,
    pub verwijderd: usize,
    pub ongewijzigd: usize,
    /// Bestanden die niet gelezen of verwerkt konden worden (alleen de naam staat in de kaart).
    pub terugval: Vec<String>,
    pub afgebroken: bool,
    pub afgekapt: bool,
}

struct Ignore {
    mappen: HashSet<String>,
    bestanden: HashSet<String>,
    einde: Vec<String>,
}

fn ignore() -> Ignore {
    let v: serde_json::Value = serde_json::from_str(IGNORE).unwrap_or_default();
    let lijst = |k: &str| v[k].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect::<Vec<_>>()).unwrap_or_default();
    Ignore { mappen: lijst("mappen").into_iter().collect(), bestanden: lijst("bestanden").into_iter().collect(), einde: lijst("patronen_einde") }
}

/// Mag dit pad (relatief, met `/`) nooit in de index of aan de AI getoond worden?
pub fn uitgesloten(rel: &str) -> bool {
    let ig = ignore();
    let naam = rel.rsplit('/').next().unwrap_or(rel);
    rel.split('/').any(|c| ig.mappen.contains(c))
        || ig.bestanden.contains(naam)
        || ig.einde.iter().any(|e| naam.ends_with(e.as_str()))
        || crate::github::scan::by_name(rel).is_some_and(|(_, ernst)| ernst != "laag")
}

pub fn open(dir: &Path) -> rusqlite::Result<Connection> {
    let map = dir.join(".studio");
    let _ = std::fs::create_dir_all(&map);
    let c = Connection::open(map.join("kaart.db"))?;
    schema(&c)?;
    Ok(c)
}

pub fn schema(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS bestand (pad TEXT PRIMARY KEY, hash TEXT NOT NULL, grootte INTEGER NOT NULL, taal TEXT NOT NULL, doel TEXT NOT NULL,
            exports TEXT NOT NULL, imports TEXT NOT NULL, routes TEXT NOT NULL, kit TEXT NOT NULL, terugval INTEGER NOT NULL DEFAULT 0);
         CREATE TABLE IF NOT EXISTS symbool (pad TEXT NOT NULL, naam TEXT NOT NULL, soort TEXT NOT NULL, sig TEXT NOT NULL, regel INTEGER NOT NULL);
         CREATE INDEX IF NOT EXISTS symbool_naam ON symbool(naam COLLATE NOCASE);
         CREATE INDEX IF NOT EXISTS symbool_pad ON symbool(pad);
         CREATE TABLE IF NOT EXISTS tabel (pad TEXT NOT NULL, naam TEXT NOT NULL, kolommen TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS meta (sleutel TEXT PRIMARY KEY, waarde TEXT NOT NULL);",
    )
}

fn json(v: &[String]) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "[]".into())
}

pub fn lijst(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}

fn hash(b: &[u8]) -> String {
    format!("{:x}", Sha256::digest(b))
}

fn schrijf(c: &Connection, pad: &str, h: &str, grootte: u64, i: &Info, terugval: bool) -> rusqlite::Result<()> {
    c.execute("DELETE FROM symbool WHERE pad=?1", [pad])?;
    c.execute("DELETE FROM tabel WHERE pad=?1", [pad])?;
    c.execute(
        "INSERT OR REPLACE INTO bestand(pad,hash,grootte,taal,doel,exports,imports,routes,kit,terugval) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![pad, h, grootte as i64, i.taal, i.doel, json(&i.exports), json(&i.imports), json(&i.routes), json(&i.kit), terugval as i32],
    )?;
    for s in i.symbolen.iter().take(200) {
        c.execute("INSERT INTO symbool(pad,naam,soort,sig,regel) VALUES(?1,?2,?3,?4,?5)", params![pad, s.naam, s.soort, s.sig, s.regel as i64])?;
    }
    for (n, k) in &i.tabellen {
        c.execute("INSERT INTO tabel(pad,naam,kolommen) VALUES(?1,?2,?3)", params![pad, n, json(k)])?;
    }
    Ok(())
}

/// Werkt de index bij. Leest alleen bestanden waarvan grootte of hash veranderde. `annuleer` wordt tussen bestanden gecontroleerd.
pub fn bijwerken(dir: &Path, annuleer: &AtomicBool, voortgang: &dyn Fn(usize, usize)) -> Result<Stand, String> {
    let mut c = open(dir).map_err(|e| e.to_string())?;
    let mut stand = Stand::default();
    let ig = ignore();
    let mut gezien: HashSet<String> = HashSet::new();
    let bestaand: std::collections::HashMap<String, (String, i64)> = {
        let mut st = c.prepare("SELECT pad,hash,grootte FROM bestand").map_err(|e| e.to_string())?;
        let rijen = st.query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get::<_, String>(1)?, r.get::<_, i64>(2)?)))).map_err(|e| e.to_string())?;
        rijen.flatten().collect()
    };
    let mut kandidaten: Vec<(String, std::path::PathBuf, u64)> = Vec::new();
    let walker = ignore::WalkBuilder::new(dir)
        .hidden(true)
        .git_ignore(true)
        .git_global(false)
        .max_depth(Some(MAX_DIEPTE))
        .follow_links(false)
        .filter_entry(move |e| {
            let n = e.file_name().to_string_lossy();
            !(e.file_type().is_some_and(|t| t.is_dir()) && ig.mappen.contains(n.as_ref()))
        })
        .build();
    for e in walker.flatten() {
        if !e.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let Ok(rel) = e.path().strip_prefix(dir) else { continue };
        let rel = rel.to_string_lossy().replace('\\', "/");
        if uitgesloten(&rel) || parse::taal(&rel).is_none() {
            continue;
        }
        let Ok(meta) = e.metadata() else { continue };
        if kandidaten.len() >= MAX_BESTANDEN {
            stand.afgekapt = true;
            break;
        }
        kandidaten.push((rel, e.path().to_path_buf(), meta.len()));
    }
    let totaal = kandidaten.len();
    let tx = c.transaction().map_err(|e| e.to_string())?;
    for (n, (rel, pad, grootte)) in kandidaten.into_iter().enumerate() {
        if annuleer.load(Ordering::Relaxed) {
            stand.afgebroken = true;
            break;
        }
        if n % 50 == 0 {
            voortgang(n, totaal);
        }
        gezien.insert(rel.clone());
        let oud = bestaand.get(&rel);
        if grootte > MAX_GROOTTE {
            // Te groot om te lezen: alleen de naam, en dat melden we.
            let i = Info { taal: parse::taal(&rel).unwrap_or("overig"), doel: "Groot bestand (niet gelezen)".into(), ..Default::default() };
            if oud.map(|o| o.0.as_str()) != Some("groot") {
                schrijf(&tx, &rel, "groot", grootte, &i, true).map_err(|e| e.to_string())?;
                stand.terugval.push(rel);
            }
            continue;
        }
        let Ok(bytes) = std::fs::read(&pad) else {
            stand.terugval.push(rel);
            continue;
        };
        let h = hash(&bytes);
        if oud.is_some_and(|o| o.0 == h) {
            stand.ongewijzigd += 1;
            continue;
        }
        let Ok(tekst) = String::from_utf8(bytes) else {
            let i = Info { taal: "overig", doel: "Geen leesbare tekst".into(), ..Default::default() };
            schrijf(&tx, &rel, &h, grootte, &i, true).map_err(|e| e.to_string())?;
            stand.terugval.push(rel);
            continue;
        };
        let info = parse::parse(&rel, &tekst);
        schrijf(&tx, &rel, &h, grootte, &info, false).map_err(|e| e.to_string())?;
        if oud.is_some() {
            stand.gewijzigd += 1;
        } else {
            stand.nieuw += 1;
        }
    }
    if !stand.afgebroken {
        for oud in bestaand.keys().filter(|p| !gezien.contains(*p)) {
            tx.execute("DELETE FROM bestand WHERE pad=?1", [oud]).map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM symbool WHERE pad=?1", [oud]).map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM tabel WHERE pad=?1", [oud]).map_err(|e| e.to_string())?;
            stand.verwijderd += 1;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    voortgang(totaal, totaal);
    Ok(stand)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn zonder_voortgang(_: usize, _: usize) {}
    fn nee() -> AtomicBool {
        AtomicBool::new(false)
    }

    fn project() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        fs::create_dir_all(p.join("src/pages")).unwrap();
        fs::create_dir_all(p.join("node_modules/x")).unwrap();
        fs::create_dir_all(p.join("migrations")).unwrap();
        fs::write(p.join("src/pages/Home.tsx"), "// De startpagina.\nimport { Button } from \"@/components/ui/button\";\nexport default function Home() { return null }\n").unwrap();
        fs::write(p.join("src/api.ts"), "export const haal = async (id: string) => id;\n").unwrap();
        fs::write(p.join("node_modules/x/index.js"), "export const zwaar = 1;").unwrap();
        fs::write(p.join(".env"), "SLEUTEL=abc").unwrap();
        fs::write(p.join("sleutel.pem"), "-----BEGIN PRIVATE KEY-----").unwrap();
        fs::write(p.join("migrations/0001.sql"), "create table taken (id int, titel text);").unwrap();
        d
    }

    #[test]
    fn indexeert_alleen_toegestane_bestanden() {
        let d = project();
        let s = bijwerken(d.path(), &nee(), &zonder_voortgang).unwrap();
        assert_eq!(s.nieuw, 3);
        let c = open(d.path()).unwrap();
        let paden: Vec<String> = c.prepare("SELECT pad FROM bestand ORDER BY pad").unwrap().query_map([], |r| r.get(0)).unwrap().flatten().collect();
        assert_eq!(paden, vec!["migrations/0001.sql", "src/api.ts", "src/pages/Home.tsx"]);
    }

    #[test]
    fn incrementeel_alleen_gewijzigde_bestanden() {
        let d = project();
        bijwerken(d.path(), &nee(), &zonder_voortgang).unwrap();
        let s = bijwerken(d.path(), &nee(), &zonder_voortgang).unwrap();
        assert_eq!((s.nieuw, s.gewijzigd, s.ongewijzigd), (0, 0, 3));
        fs::write(d.path().join("src/api.ts"), "export const haal = 2;\nexport const nieuw = 3;\n").unwrap();
        fs::write(d.path().join("src/extra.ts"), "export const x = 1;").unwrap();
        fs::remove_file(d.path().join("src/pages/Home.tsx")).unwrap();
        let s = bijwerken(d.path(), &nee(), &zonder_voortgang).unwrap();
        assert_eq!((s.nieuw, s.gewijzigd, s.verwijderd, s.ongewijzigd), (1, 1, 1, 1));
        let c = open(d.path()).unwrap();
        let n: i64 = c.query_row("SELECT COUNT(*) FROM symbool WHERE pad='src/pages/Home.tsx'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn geheimen_en_ignorelijst_komen_er_nooit_in() {
        for p in [".env", ".env.local", "sleutel.pem", "a/id_rsa", "node_modules/x/y.js", "dist/app.js", "app.min.js", "package-lock.json", ".studio/kaart.db"] {
            assert!(uitgesloten(p), "{p}");
        }
        for p in ["src/app.ts", ".env.example", "lib/main.dart"] {
            assert!(!uitgesloten(p), "{p}");
        }
        let d = project();
        bijwerken(d.path(), &nee(), &zonder_voortgang).unwrap();
        let c = open(d.path()).unwrap();
        let n: i64 = c.query_row("SELECT COUNT(*) FROM bestand WHERE pad LIKE '%env%' OR pad LIKE '%pem%'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn te_groot_geen_tekst_en_annuleren() {
        let d = project();
        fs::write(d.path().join("src/groot.js"), "x".repeat(450_000)).unwrap();
        fs::write(d.path().join("src/binair.ts"), [0xff, 0xfe, 0x00, 0x80]).unwrap();
        let s = bijwerken(d.path(), &nee(), &zonder_voortgang).unwrap();
        assert!(s.terugval.contains(&"src/groot.js".to_string()) && s.terugval.contains(&"src/binair.ts".to_string()));
        let stop = AtomicBool::new(true);
        let d2 = project();
        let s = bijwerken(d2.path(), &stop, &zonder_voortgang).unwrap();
        assert!(s.afgebroken && s.nieuw == 0);
    }

    #[test]
    fn paden_met_spaties_en_unicode() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("Mijn project ë");
        fs::create_dir_all(p.join("src map")).unwrap();
        fs::write(p.join("src map/één bestand.ts"), "export const a = 1;").unwrap();
        let s = bijwerken(&p, &nee(), &zonder_voortgang).unwrap();
        assert_eq!(s.nieuw, 1);
    }
}
