//! De systeemcheck: wat heeft Studio nodig om te werken, en wat ontbreekt er? Alle uitkomsten zijn vaste codes; de uitleg in gewone
//! taal staat in `nl.json` (`systeem.*`). Niets hiervan blokkeert het werken: Studio zegt wat er mist en hoe je het oplost.
use crate::provider::Provider;
use serde::Serialize;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::process::Command;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Punt {
    /// `node`, `git`, `ai`, `internet`, `schijf`, `rechten`.
    pub id: &'static str,
    /// `ok`, `let_op` of `fout`.
    pub status: &'static str,
    /// Korte code of waarde voor de uitleg (bijvoorbeeld de versie, of `claude,gemini`).
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Rapport {
    pub punten: Vec<Punt>,
    /// Er is niets wat het werken tegenhoudt (geen `fout`).
    pub klaar: bool,
}

pub const SCHIJF_WAARSCHUWING: u64 = 1024 * 1024 * 1024;
pub const SCHIJF_MIN: u64 = 200 * 1024 * 1024;

fn p(id: &'static str, status: &'static str, detail: impl Into<Option<String>>) -> Punt {
    Punt { id, status, detail: detail.into() }
}

pub fn beoordeel_schijf(vrij: Option<u64>) -> Punt {
    match vrij {
        None => p("schijf", "let_op", Some("onbekend".into())),
        Some(v) if v < SCHIJF_MIN => p("schijf", "fout", Some(format!("{}", v / 1024 / 1024))),
        Some(v) if v < SCHIJF_WAARSCHUWING => p("schijf", "let_op", Some(format!("{}", v / 1024 / 1024))),
        Some(v) => p("schijf", "ok", Some(format!("{}", v / 1024 / 1024 / 1024))),
    }
}

pub fn beoordeel_ai(geinstalleerd: &[&str]) -> Punt {
    if geinstalleerd.is_empty() {
        p("ai", "fout", None)
    } else {
        p("ai", "ok", Some(geinstalleerd.join(",")))
    }
}

pub fn beoordeel_node(r: &Result<crate::node::NodeInfo, crate::node::NodeProblem>) -> Punt {
    match r {
        Ok(i) => p("node", "ok", Some(i.version.trim().to_string())),
        Err(e) => p("node", "fout", Some(e.kind().to_string())),
    }
}

fn git_versie() -> Option<String> {
    let mut c = Command::new("git");
    c.arg("--version");
    if let Some(path) = crate::cli::child_path() {
        c.env("PATH", path);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // geen zwart venster
    }
    let o = c.output().ok()?;
    o.status.success().then(|| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// Kan Studio een bestand maken in deze map? (Een tijdelijk bestand dat meteen weer weg is.)
pub fn kan_schrijven(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let f = dir.join(".studio-schrijftest");
    let ok = std::fs::write(&f, b"x").is_ok();
    let _ = std::fs::remove_file(&f);
    ok
}

/// Is er internet? Alleen een verbinding naar poort 443 van een bekende host, zonder iets te versturen.
fn internet() -> bool {
    ["github.com:443", "api.github.com:443"].iter().any(|a| a.to_socket_addrs().ok().and_then(|mut s| s.next()).is_some_and(|ad| TcpStream::connect_timeout(&ad, Duration::from_secs(3)).is_ok()))
}

/// Draait alle controles. `data` is de map van Studio zelf, `projecten` de map waar nieuwe projecten komen.
pub fn check(data: &Path, projecten: &Path) -> Rapport {
    let node = crate::node::find();
    let ai: Vec<&str> = [Provider::Claude, Provider::Gemini].into_iter().filter(|p| crate::cli::status(*p).installed).map(|p| p.as_str()).collect();
    let git = git_versie();
    let vrij = fs4::available_space(data).ok();
    let mut punten = vec![
        beoordeel_node(&node),
        match git {
            Some(v) => p("git", "ok", Some(v)),
            None => p("git", "fout", None),
        },
        beoordeel_ai(&ai),
        if internet() { p("internet", "ok", None) } else { p("internet", "let_op", None) },
        beoordeel_schijf(vrij),
        if kan_schrijven(data) && kan_schrijven(projecten) { p("rechten", "ok", None) } else { p("rechten", "fout", None) },
    ];
    punten.sort_by_key(|x| ["node", "git", "ai", "internet", "schijf", "rechten"].iter().position(|i| *i == x.id));
    let klaar = punten.iter().all(|x| x.status != "fout");
    Rapport { punten, klaar }
}

#[tauri::command(async)]
pub fn system_check(app: tauri::AppHandle, db: tauri::State<crate::commands::Db>) -> Rapport {
    use tauri::Manager;
    let data = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir());
    let projecten = db
        .conn()
        .ok()
        .and_then(|c| crate::db::get_setting(&c, "ui:default_project_dir").ok().flatten())
        .filter(|s| !s.trim().is_empty())
        .map(std::path::PathBuf::from)
        .or_else(|| app.path().document_dir().ok().map(|d| d.join("Studio")))
        .unwrap_or_else(|| data.join("projecten"));
    check(&data, &projecten)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schijfruimte_wordt_beoordeeld_op_drempels() {
        assert_eq!(beoordeel_schijf(Some(50 * 1024 * 1024)).status, "fout");
        assert_eq!(beoordeel_schijf(Some(500 * 1024 * 1024)).status, "let_op");
        assert_eq!(beoordeel_schijf(Some(5 * 1024 * 1024 * 1024)).status, "ok");
        assert_eq!(beoordeel_schijf(None).status, "let_op"); // onbekend blokkeert nooit
    }

    #[test]
    fn zonder_ai_programma_is_het_een_fout_en_met_een_is_het_goed() {
        assert_eq!(beoordeel_ai(&[]).status, "fout");
        assert_eq!(beoordeel_ai(&["claude"]).detail.as_deref(), Some("claude"));
    }

    #[test]
    fn node_problemen_worden_een_vaste_code() {
        let d = tempfile::tempdir().unwrap();
        let r = crate::node::find_in(&[d.path().to_path_buf()], None);
        let punt = beoordeel_node(&r);
        assert_eq!((punt.status, punt.detail.as_deref()), ("fout", Some("node_missing")));
    }

    #[test]
    fn schrijfrechten_worden_echt_getest_en_laten_niets_achter() {
        let d = tempfile::tempdir().unwrap();
        let sub = d.path().join("nieuw/projecten");
        assert!(kan_schrijven(&sub));
        assert!(std::fs::read_dir(&sub).unwrap().next().is_none());
        // Een bestand waar een map zou moeten staan: niet te schrijven.
        let f = d.path().join("bestand");
        std::fs::write(&f, "x").unwrap();
        assert!(!kan_schrijven(&f.join("onder")));
    }

    #[test]
    fn de_check_geeft_alle_zes_punten_in_vaste_volgorde_en_klaar_volgt_de_fouten() {
        let d = tempfile::tempdir().unwrap();
        let r = check(d.path(), &d.path().join("projecten"));
        assert_eq!(r.punten.iter().map(|x| x.id).collect::<Vec<_>>(), vec!["node", "git", "ai", "internet", "schijf", "rechten"]);
        assert_eq!(r.klaar, r.punten.iter().all(|x| x.status != "fout"));
    }
}
