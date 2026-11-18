//! In de appwinkel: gegevens, controles en hulp om je app in Google Play en de App Store te krijgen, met je EIGEN ontwikkelaarsaccounts.
//! De limieten en regels staan in `config/store-spec.json` (met bron en datum); onderzoek en keuzes in `docs/winkels.md`.
//! Wat Studio kan automatiseren en wat je zelf bij de winkel moet doen, staat eerlijk in het scherm.
pub mod app;
pub mod appid;
pub mod data;
pub mod invulhulp;
pub mod klaar;
pub mod spec;
pub mod veilig;
pub mod versie;

use data::AppData;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct Overzicht {
    pub data: AppData,
    pub winkels: Vec<klaar::WinkelStand>,
    pub invulhulp: Invulhulp,
    pub veilig: Vec<veilig::Bevinding>,
    pub versie: Option<versie::Versie>,
    /// Per winkel: wat het kost en waar dat vandaan komt.
    pub nodig: Value,
    pub spec: Value,
}

#[derive(Debug, Serialize)]
pub struct Invulhulp {
    pub signalen: invulhulp::Signalen,
    pub kaarten: Vec<invulhulp::Kaart>,
}

fn teksten(c: &Connection, project: i64, data: &AppData) -> klaar::Teksten {
    let mut t = klaar::Teksten::default();
    for winkel in spec::WINKELS {
        for (veld, _) in spec::spec().velden(winkel) {
            for taal in &data.talen {
                if let Some(s) = data::stand(c, project, winkel, taal, &veld) {
                    if s.goedgekeurd.is_some() {
                        t.goedgekeurd.insert((winkel.into(), taal.clone(), veld.clone()));
                    }
                    if s.concept.is_some() {
                        t.concept.insert((winkel.into(), taal.clone(), veld.clone()));
                    }
                }
            }
        }
    }
    t
}

/// Alles voor het scherm en voor de AI (zonder iets geheims): gegevens, klaar-check, invulhulp en controle op inhoud.
pub fn overzicht(c: &Connection, dir: &Path, project: i64, supabase_gekoppeld: bool) -> Overzicht {
    let d = data::laad(c, project);
    let t = teksten(c, project, &d);
    let signalen = invulhulp::signalen(dir, supabase_gekoppeld);
    // Voor de controle op testtekst: de tekst zoals die nu in de winkel zou komen (goedgekeurd, anders het concept).
    let mut alle: Vec<String> = vec![];
    for winkel in spec::WINKELS {
        for (veld, _) in spec::spec().velden(winkel) {
            for taal in &d.talen {
                if let Some(s) = data::stand(c, project, winkel, taal, &veld) {
                    if let Some(x) = s.goedgekeurd.or(s.concept) {
                        alle.push(x.tekst);
                    }
                }
            }
        }
    }
    let veilig = veilig::scan(dir, &d, &signalen.permissies, &alle);
    let winkels = klaar::bereken(dir, &d, &t, &veilig);
    let kaarten = invulhulp::kaarten(&signalen);
    let s = spec::spec();
    let nodig = json!({
        "play": s.stores["play"]["account"],
        "appstore": s.stores["appstore"]["account"],
    });
    Overzicht { versie: versie::lees(dir), data: d, winkels, invulhulp: Invulhulp { signalen, kaarten }, veilig, nodig, spec: json!({ "versie": s.versie, "datum": s.datum, "talen": s.talen, "app_id": s.app_id }) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn het_overzicht_bevat_geen_geheimen_en_alle_onderdelen() {
        let mut c = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut c).unwrap();
        c.execute("INSERT INTO projects (id, naam, pad, template) VALUES (1, 'P', '/p', 'leeg')", []).unwrap();
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("pubspec.yaml"), "name: x\nversion: 1.0.0+1\ndependencies:\n  flutter:\n    sdk: flutter\n  google_mobile_ads: ^5.0.0\n").unwrap();
        let o = overzicht(&c, d.path(), 1, false);
        assert_eq!(o.winkels.len(), 2);
        assert_eq!(o.versie.unwrap().tekst(), "1.0.0+1");
        assert!(o.invulhulp.kaarten.iter().any(|k| k.id == "advertenties" && k.antwoord == "ja"));
        assert!(o.veilig.iter().any(|b| b.code == "privacy_ontbreekt"));
        assert_eq!(o.nodig["appstore"]["geverifieerd"], true);
        assert_eq!(o.spec["datum"], "2026-11-18");
    }
}
