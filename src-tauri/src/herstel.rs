//! Herstel na een crash of plotseling afsluiten. Projecten en versies staan altijd op schijf; hier onthoudt Studio alleen of de vorige
//! keer netjes is afgesloten, zodat het bij het opstarten kan zeggen: "Je werk is bewaard, wil je verdergaan?".
use crate::projects::Project;
use rusqlite::Connection;
use serde::Serialize;

const SLEUTEL: &str = "sessie:open";

/// Noteert dat Studio nu draait en geeft terug of de vorige sessie niet netjes is afgesloten.
pub fn begin(c: &Connection) -> bool {
    let eerder = crate::db::get_setting(c, SLEUTEL).ok().flatten().as_deref() == Some("1");
    let _ = crate::db::set_setting(c, SLEUTEL, "1");
    eerder
}

/// Noteert dat Studio netjes is afgesloten.
pub fn einde(c: &Connection) {
    let _ = crate::db::set_setting(c, SLEUTEL, "0");
}

pub struct Start {
    pub onderbroken: bool,
}

#[derive(Serialize)]
pub struct StartInfo {
    /// De vorige keer is Studio niet netjes afgesloten (crash, stroomstoring, geforceerd afgesloten).
    pub onderbroken: bool,
    /// Het project waar het laatst aan is gewerkt.
    pub laatste_project: Option<Project>,
}

#[tauri::command]
pub fn start_info(start: tauri::State<Start>, db: tauri::State<crate::commands::Db>) -> StartInfo {
    let laatste = db.conn().ok().and_then(|c| crate::projects::list(&c).ok()).and_then(|l| l.into_iter().filter(|p| p.last_used_at.is_some()).max_by(|a, b| a.last_used_at.cmp(&b.last_used_at)));
    StartInfo { onderbroken: start.onderbroken, laatste_project: laatste }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn een_eerste_start_en_een_nette_afsluiting_geven_geen_melding_maar_een_crash_wel() {
        let c = crate::db::open_in_memory().unwrap();
        assert!(!begin(&c), "eerste keer: niets onderbroken");
        einde(&c);
        assert!(!begin(&c), "netjes afgesloten");
        // Nu "crasht" Studio: geen einde().
        assert!(begin(&c), "de vorige sessie is niet netjes afgesloten");
        assert!(begin(&c), "ook de keer erna blijft het zo tot er netjes is afgesloten");
        einde(&c);
        assert!(!begin(&c));
    }
}
