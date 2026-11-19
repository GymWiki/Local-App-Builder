//! De gegevens van de app voor de winkels en de versies van de teksten (SQLite). Nooit een sleutel of wachtwoord.
//! Goedgekeurde tekst is vergrendeld: de AI schrijft alleen concepten; alleen de gebruiker keurt goed of vervangt.
use super::spec::{beoordeel, spec, Telling};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct AppData {
    pub app_naam: String,
    pub android_id: String,
    pub ios_id: String,
    pub categorie_play: String,
    pub categorie_apple: String,
    pub contact_email: String,
    pub website: String,
    pub privacy_url: String,
    pub support_url: String,
    /// De vragenlijst voor de leeftijdsindeling is ingevuld (antwoorden zelf staan bij de winkel).
    pub leeftijd_ingevuld: bool,
    /// Werkt de app met een login? Dan is een demo-account voor de beoordelaar nodig (de gegevens staan in de kluis, niet hier).
    pub heeft_login: bool,
    pub demo_account_gezet: bool,
    /// Dingen die de gebruiker zelf heeft gedaan en bevestigd: `play_account`, `apple_account`, `data_safety`, `apple_privacy`, `export_regels`, `doelgroep`, `advertenties`.
    pub bevestigd: BTreeMap<String, bool>,
    pub talen: Vec<String>,
}

pub fn laad(c: &Connection, project: i64) -> AppData {
    let raw: Option<String> = c.query_row("SELECT data FROM store_apps WHERE project_id=?1", params![project], |r| r.get(0)).optional().ok().flatten();
    let mut d: AppData = raw.and_then(|r| serde_json::from_str(&r).ok()).unwrap_or_default();
    if d.talen.is_empty() {
        d.talen = vec!["nl".into()];
    }
    d
}

pub fn bewaar(c: &Connection, project: i64, d: &AppData) -> rusqlite::Result<()> {
    let json = serde_json::to_string(d).unwrap_or_else(|_| "{}".into());
    c.execute("INSERT INTO store_apps (project_id, data) VALUES (?1,?2) ON CONFLICT(project_id) DO UPDATE SET data=?2", params![project, json])?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Versie {
    pub id: i64,
    pub tekst: String,
    pub status: String,
    pub bron: String,
    pub at: i64,
}

/// Wat er bij één veld staat: de goedgekeurde tekst (vergrendeld) en het nieuwste concept, met de telling.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct VeldStand {
    pub veld: String,
    pub officieel: String,
    pub goedgekeurd: Option<Versie>,
    pub concept: Option<Versie>,
    pub telling: Option<Telling>,
    pub min: usize,
    pub max: usize,
    pub eenheid: String,
    pub geverifieerd: bool,
    pub bron: String,
}

fn rij(r: &rusqlite::Row) -> rusqlite::Result<Versie> {
    Ok(Versie { id: r.get(0)?, tekst: r.get(1)?, status: r.get(2)?, bron: r.get(3)?, at: r.get(4)? })
}

pub fn versies(c: &Connection, project: i64, store: &str, taal: &str, veld: &str) -> Vec<Versie> {
    let Ok(mut st) = c.prepare("SELECT id, tekst, status, bron, at FROM store_tekst_versies WHERE project_id=?1 AND store=?2 AND taal=?3 AND veld=?4 ORDER BY id DESC") else { return vec![] };
    st.query_map(params![project, store, taal, veld], rij).map(|r| r.flatten().collect()).unwrap_or_default()
}

pub fn stand(c: &Connection, project: i64, store: &str, taal: &str, veld: &str) -> Option<VeldStand> {
    let v = spec().veld(store, veld)?;
    let alle = versies(c, project, store, taal, veld);
    let goedgekeurd = alle.iter().find(|x| x.status == "goedgekeurd").cloned();
    let concept = alle.iter().find(|x| x.status == "concept").cloned();
    // De telling hoort bij wat er het eerst gebruikt wordt: een concept (in bewerking) of anders de goedgekeurde tekst.
    let telling = concept.as_ref().or(goedgekeurd.as_ref()).map(|x| beoordeel(&v, &x.tekst));
    Some(VeldStand { veld: veld.into(), officieel: v.officieel.clone(), goedgekeurd, concept, telling, min: v.min, max: v.max, eenheid: v.eenheid.clone(), geverifieerd: v.geverifieerd, bron: v.bron })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wie {
    Ai,
    Gebruiker,
}

/// Slaat een concept op. Een concept mag te lang zijn (je ziet dan de teller op "!"); goedkeuren mag alleen binnen de limiet.
/// De AI mag alleen concepten maken en raakt een goedgekeurde tekst nooit aan.
#[allow(clippy::too_many_arguments)]
pub fn concept(c: &Connection, project: i64, store: &str, taal: &str, veld: &str, tekst: &str, wie: Wie, nu: i64) -> Result<i64, &'static str> {
    if spec().veld(store, veld).is_none() {
        return Err("onbekend_veld");
    }
    if !spec().talen.iter().any(|t| t == taal) {
        return Err("onbekende_taal");
    }
    if tekst.len() > 20_000 {
        return Err("te_lang");
    }
    // Een eerder concept van hetzelfde veld wordt vervangen door het nieuwe (de geschiedenis blijft in de status "vervangen").
    c.execute("UPDATE store_tekst_versies SET status='vervangen' WHERE project_id=?1 AND store=?2 AND taal=?3 AND veld=?4 AND status='concept'", params![project, store, taal, veld]).map_err(|_| "opslag")?;
    c.execute(
        "INSERT INTO store_tekst_versies (project_id, store, taal, veld, tekst, status, bron, at) VALUES (?1,?2,?3,?4,?5,'concept',?6,?7)",
        params![project, store, taal, veld, tekst, if wie == Wie::Ai { "ai" } else { "gebruiker" }, nu],
    )
    .map_err(|_| "opslag")?;
    Ok(c.last_insert_rowid())
}

/// De gebruiker keurt een versie goed (alleen binnen de limiet). Die wordt vergrendeld; de vorige goedgekeurde wordt "vervangen".
pub fn keur_goed(c: &Connection, project: i64, id: i64) -> Result<(), &'static str> {
    let r: Option<(String, String, String, String)> = c.query_row("SELECT store, taal, veld, tekst FROM store_tekst_versies WHERE id=?1 AND project_id=?2", params![id, project], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).optional().ok().flatten();
    let Some((store, taal, veld, tekst)) = r else { return Err("niet_gevonden") };
    let v = spec().veld(&store, &veld).ok_or("onbekend_veld")?;
    match beoordeel(&v, &tekst).oordeel {
        "goed" => {}
        "te_lang" => return Err("te_lang"),
        _ => return Err("te_kort"),
    }
    c.execute("UPDATE store_tekst_versies SET status='vervangen' WHERE project_id=?1 AND store=?2 AND taal=?3 AND veld=?4 AND status='goedgekeurd'", params![project, store, taal, veld]).map_err(|_| "opslag")?;
    c.execute("UPDATE store_tekst_versies SET status='goedgekeurd' WHERE id=?1", params![id]).map_err(|_| "opslag")?;
    Ok(())
}

/// Maakt een goedgekeurde tekst weer bewerkbaar: het wordt een concept (de gebruiker beslist, nooit de AI).
pub fn ontgrendel(c: &Connection, project: i64, store: &str, taal: &str, veld: &str, nu: i64) -> Result<(), &'static str> {
    let Some(g) = versies(c, project, store, taal, veld).into_iter().find(|x| x.status == "goedgekeurd") else { return Err("niet_gevonden") };
    concept(c, project, store, taal, veld, &g.tekst, Wie::Gebruiker, nu).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut c).unwrap();
        c.execute("INSERT INTO projects (id, naam, pad, template) VALUES (1, 'P', '/p', 'leeg')", []).unwrap();
        c
    }

    #[test]
    fn app_gegevens_bewaren_met_standaardtaal() {
        let c = db();
        assert_eq!(laad(&c, 1).talen, vec!["nl"]);
        let mut d = laad(&c, 1);
        d.app_naam = "Winkel".into();
        d.bevestigd.insert("play_account".into(), true);
        bewaar(&c, 1, &d).unwrap();
        assert_eq!(laad(&c, 1).app_naam, "Winkel");
        assert_eq!(laad(&c, 1).bevestigd.get("play_account"), Some(&true));
        // Onbekende of kapotte inhoud geeft de standaard, nooit een crash.
        c.execute("UPDATE store_apps SET data='{kapot' WHERE project_id=1", []).unwrap();
        assert_eq!(laad(&c, 1), AppData { talen: vec!["nl".into()], ..AppData::default() });
    }

    #[test]
    fn concept_goedkeuren_vergrendelen_en_geschiedenis() {
        let c = db();
        let a = concept(&c, 1, "appstore", "nl", "subtitel", "Eerste", Wie::Ai, 1).unwrap();
        let s = stand(&c, 1, "appstore", "nl", "subtitel").unwrap();
        assert_eq!((s.goedgekeurd.is_none(), s.concept.as_ref().map(|c| c.tekst.as_str())), (true, Some("Eerste")));
        assert_eq!(s.telling.unwrap().oordeel, "goed");
        keur_goed(&c, 1, a).unwrap();
        // De AI schrijft daarna een nieuw concept: de goedgekeurde tekst blijft staan.
        concept(&c, 1, "appstore", "nl", "subtitel", "AI-voorstel", Wie::Ai, 2).unwrap();
        let s = stand(&c, 1, "appstore", "nl", "subtitel").unwrap();
        assert_eq!(s.goedgekeurd.as_ref().unwrap().tekst, "Eerste");
        assert_eq!(s.concept.as_ref().unwrap().tekst, "AI-voorstel");
        // De gebruiker keurt het nieuwe goed: de oude wordt "vervangen" maar blijft in de geschiedenis.
        keur_goed(&c, 1, s.concept.unwrap().id).unwrap();
        let alle = versies(&c, 1, "appstore", "nl", "subtitel");
        assert_eq!(alle.iter().map(|v| (v.tekst.as_str(), v.status.as_str(), v.bron.as_str())).collect::<Vec<_>>(), vec![("AI-voorstel", "goedgekeurd", "ai"), ("Eerste", "vervangen", "ai")]);
        // Ontgrendelen maakt een concept van de goedgekeurde tekst (van de gebruiker).
        ontgrendel(&c, 1, "appstore", "nl", "subtitel", 3).unwrap();
        let s = stand(&c, 1, "appstore", "nl", "subtitel").unwrap();
        assert_eq!((s.concept.unwrap().bron, s.goedgekeurd.unwrap().tekst), ("gebruiker".into(), "AI-voorstel".into()));
    }

    #[test]
    fn goedkeuren_mag_alleen_binnen_de_limiet_en_een_concept_mag_wel_te_lang_zijn() {
        let c = db();
        let lang = "x".repeat(31);
        let id = concept(&c, 1, "appstore", "nl", "subtitel", &lang, Wie::Gebruiker, 1).unwrap();
        assert_eq!(stand(&c, 1, "appstore", "nl", "subtitel").unwrap().telling.unwrap().oordeel, "te_lang");
        assert_eq!(keur_goed(&c, 1, id), Err("te_lang"));
        let kort = concept(&c, 1, "appstore", "nl", "app_naam", "A", Wie::Gebruiker, 1).unwrap();
        assert_eq!(keur_goed(&c, 1, kort), Err("te_kort")); // Apple: minstens 2 tekens
        // Trefwoorden tellen in bytes: 100 bytes is genoeg voor 50 letters met accent, niet voor 51.
        let ok = concept(&c, 1, "appstore", "nl", "trefwoorden", &"é".repeat(50), Wie::Gebruiker, 1).unwrap();
        assert!(keur_goed(&c, 1, ok).is_ok());
        let teveel = concept(&c, 1, "appstore", "nl", "trefwoorden", &"é".repeat(51), Wie::Gebruiker, 2).unwrap();
        assert_eq!(keur_goed(&c, 1, teveel), Err("te_lang"));
    }

    #[test]
    fn onbekende_velden_talen_en_versies_worden_geweigerd() {
        let c = db();
        assert_eq!(concept(&c, 1, "appstore", "nl", "bestaat_niet", "x", Wie::Ai, 1), Err("onbekend_veld"));
        assert_eq!(concept(&c, 1, "play", "fr", "app_naam", "x", Wie::Ai, 1), Err("onbekende_taal"));
        assert_eq!(concept(&c, 1, "geen_winkel", "nl", "app_naam", "x", Wie::Ai, 1), Err("onbekend_veld"));
        assert_eq!(keur_goed(&c, 1, 999), Err("niet_gevonden"));
        assert_eq!(ontgrendel(&c, 1, "play", "nl", "app_naam", 1), Err("niet_gevonden"));
    }
}
