//! De klaar-check per winkel: wat is er, wat ontbreekt en wat moet je zelf bij de winkel doen. Eén plek bepaalt de bolletjes;
//! de schermen tonen alleen wat hier uitkomt. Alle limieten komen uit `config/store-spec.json`.
use super::appid;
use super::data::AppData;
use super::spec::{spec, WINKELS};
use super::veilig::Bevinding;
use super::versie;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Punt {
    /// nl.json: `winkels.punt.<id>.{titel,uitleg}`.
    pub id: &'static str,
    /// `klaar`, `let_op`, `ontbreekt` of `handmatig` (dat doe je zelf bij de winkel en bevestig je hier).
    pub status: &'static str,
    pub detail: Option<Value>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct WinkelStand {
    pub winkel: &'static str,
    pub punten: Vec<Punt>,
    pub klaar: usize,
    pub totaal: usize,
}

/// Welke teksten er zijn: (winkel, taal, veld) → goedgekeurd of alleen een concept.
#[derive(Default)]
pub struct Teksten {
    pub goedgekeurd: HashSet<(String, String, String)>,
    pub concept: HashSet<(String, String, String)>,
}

fn p(id: &'static str, status: &'static str) -> Punt {
    Punt { id, status, detail: None }
}
fn pd(id: &'static str, status: &'static str, detail: Value) -> Punt {
    Punt { id, status, detail: Some(detail) }
}
fn gevuld(s: &str) -> bool {
    !s.trim().is_empty()
}
fn bevestigd(d: &AppData, k: &str) -> &'static str {
    if d.bevestigd.get(k).copied().unwrap_or(false) { "klaar" } else { "handmatig" }
}

/// Het aantal afbeeldingen in `store/screenshots/<winkel>/<taal>/` (png of jpg), laagste aantal over alle talen.
fn aantal_screenshots(dir: &Path, winkel: &str, talen: &[String]) -> usize {
    talen
        .iter()
        .map(|t| {
            fs::read_dir(dir.join("store/screenshots").join(winkel).join(t))
                .map(|rd| rd.flatten().filter(|e| e.path().extension().and_then(|x| x.to_str()).is_some_and(|x| matches!(x.to_lowercase().as_str(), "png" | "jpg" | "jpeg"))).count())
                .unwrap_or(0)
        })
        .min()
        .unwrap_or(0)
}

fn teksten_punt(winkel: &str, talen: &[String], t: &Teksten) -> Punt {
    let velden = spec().velden(winkel);
    let mut klaar = 0;
    let mut totaal = 0;
    let mut mist: Vec<String> = vec![];
    let mut concept_only = false;
    for (naam, v) in &velden {
        for taal in talen {
            // Een veld met minimum 0 (zoals de promotietekst) mag leeg blijven.
            if v.min == 0 {
                continue;
            }
            totaal += 1;
            let sleutel = (winkel.to_string(), taal.clone(), naam.clone());
            if t.goedgekeurd.contains(&sleutel) {
                klaar += 1;
            } else {
                mist.push(format!("{naam}:{taal}"));
                concept_only |= t.concept.contains(&sleutel);
            }
        }
    }
    let status = if klaar == totaal { "klaar" } else if klaar > 0 || concept_only { "let_op" } else { "ontbreekt" };
    pd("teksten", status, json!({ "klaar": klaar, "totaal": totaal, "mist": mist }))
}

fn bestand(dir: &Path, rel: &str) -> bool {
    dir.join(rel).is_file()
}

/// De stand voor alle winkels.
pub fn bereken(dir: &Path, data: &AppData, t: &Teksten, bevindingen: &[Bevinding]) -> Vec<WinkelStand> {
    let talen = &data.talen;
    let v = versie::lees(dir);
    let versie_punt = match &v {
        Some(v) => pd("versie", "klaar", json!({ "versie": v.tekst() })),
        None => p("versie", "let_op"), // alleen Flutter heeft een versie die Studio kan lezen en verhogen
    };
    let privacy = match bevindingen.iter().find(|b| b.code == "privacy_ontbreekt" || b.code == "privacy_link") {
        Some(b) => pd("privacy", "ontbreekt", json!({ "code": b.code, "detail": b.detail })),
        None => p("privacy", "klaar"),
    };
    let tekstfout = bevindingen.iter().any(|b| b.code == "testtekst" && b.ernst == "fout");
    let inhoud = if tekstfout { pd("inhoud", "ontbreekt", json!({ "code": "testtekst" })) } else if bevindingen.iter().any(|b| b.ernst == "let_op") { p("inhoud", "let_op") } else { p("inhoud", "klaar") };
    let mut uit = vec![];
    for winkel in WINKELS {
        let mut punten = vec![];
        let (id, oordeel) = if winkel == "play" { (&data.android_id, appid::android(&data.android_id)) } else { (&data.ios_id, appid::ios(&data.ios_id)) };
        punten.push(p("account", bevestigd(data, if winkel == "play" { "play_account" } else { "apple_account" })));
        punten.push(if !gevuld(id) {
            p("app_id", "ontbreekt")
        } else if !oordeel.geldig {
            pd("app_id", "ontbreekt", json!({ "code": oordeel.code }))
        } else if let Some(l) = oordeel.let_op {
            pd("app_id", "let_op", json!({ "code": l }))
        } else {
            p("app_id", "klaar")
        });
        punten.push(versie_punt.clone());
        punten.push(teksten_punt(winkel, talen, t));
        // Eén bronafbeelding voor alle winkels; de maten per winkel worden eruit gemaakt (Winkelpakket).
        punten.push(p("icoon", if bestand(dir, "store/icoon.png") { "klaar" } else { "ontbreekt" }));
        if winkel == "play" {
            punten.push(p("feature_graphic", if bestand(dir, "store/play/feature-graphic.png") { "klaar" } else { "ontbreekt" }));
        }
        let pad = if winkel == "play" { "afbeeldingen.telefoon_screenshots.min_aantal" } else { "afbeeldingen.iphone_screenshots.min_aantal" };
        let min = spec().waarde(winkel, pad).and_then(|m| m.as_u64()).unwrap_or(1) as usize;
        let n = aantal_screenshots(dir, winkel, talen);
        punten.push(pd("screenshots", if n >= min { "klaar" } else { "ontbreekt" }, json!({ "aantal": n, "minimaal": min })));
        punten.push(privacy.clone());
        punten.push(p("contact", if gevuld(&data.contact_email) { "klaar" } else { "ontbreekt" }));
        if winkel == "appstore" {
            punten.push(p("support", if gevuld(&data.support_url) { "klaar" } else { "ontbreekt" }));
        }
        punten.push(p("categorie", if gevuld(if winkel == "play" { &data.categorie_play } else { &data.categorie_apple }) { "klaar" } else { "ontbreekt" }));
        punten.push(p("leeftijd", if data.leeftijd_ingevuld { "klaar" } else { "handmatig" }));
        if winkel == "play" {
            punten.push(p("data_safety", bevestigd(data, "data_safety")));
            punten.push(p("doelgroep", bevestigd(data, "doelgroep")));
            punten.push(p("advertenties", bevestigd(data, "advertenties")));
        } else {
            punten.push(p("apple_privacy", bevestigd(data, "apple_privacy")));
            punten.push(p("export_regels", bevestigd(data, "export_regels")));
            if data.heeft_login {
                punten.push(p("demo_account", if data.demo_account_gezet { "klaar" } else { "ontbreekt" }));
            }
        }
        punten.push(inhoud.clone());
        let klaar = punten.iter().filter(|x| x.status == "klaar").count();
        let totaal = punten.len();
        uit.push(WinkelStand { winkel, punten, klaar, totaal });
    }
    uit
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(w: &[WinkelStand], winkel: &str, id: &str) -> &'static str {
        w.iter().find(|x| x.winkel == winkel).unwrap().punten.iter().find(|x| x.id == id).unwrap().status
    }

    #[test]
    fn een_leeg_project_mist_alles_en_wat_je_zelf_doet_is_handmatig() {
        let d = tempfile::tempdir().unwrap();
        let data = AppData { talen: vec!["nl".into()], ..Default::default() };
        let w = bereken(d.path(), &data, &Teksten::default(), &[]);
        assert_eq!(w.len(), 2);
        for (winkel, id, verwacht) in [("play", "app_id", "ontbreekt"), ("play", "teksten", "ontbreekt"), ("play", "icoon", "ontbreekt"), ("play", "screenshots", "ontbreekt"), ("play", "account", "handmatig"), ("play", "data_safety", "handmatig"), ("appstore", "apple_privacy", "handmatig"), ("appstore", "support", "ontbreekt"), ("appstore", "export_regels", "handmatig")] {
            assert_eq!(status(&w, winkel, id), verwacht, "{winkel}.{id}");
        }
        assert!(w.iter().all(|x| x.klaar < x.totaal));
        // De demo-account-regel verschijnt alleen als de app een login heeft.
        assert!(w[1].punten.iter().all(|x| x.id != "demo_account"));
        let mut met_login = data.clone();
        met_login.heeft_login = true;
        assert_eq!(status(&bereken(d.path(), &met_login, &Teksten::default(), &[]), "appstore", "demo_account"), "ontbreekt");
    }

    #[test]
    fn app_id_en_versie_en_privacy_volgen_de_regels() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("pubspec.yaml"), "name: x\nversion: 1.0.0+3\n").unwrap();
        let mut data = AppData { talen: vec!["nl".into()], android_id: "com.example.winkel".into(), ios_id: "nl.winkel".into(), privacy_url: "https://winkel.nl/privacy".into(), ..Default::default() };
        let w = bereken(d.path(), &data, &Teksten::default(), &[]);
        assert_eq!(status(&w, "play", "app_id"), "let_op"); // com.example kan, maar Google weigert dat meestal
        assert_eq!(status(&w, "appstore", "app_id"), "klaar");
        assert_eq!(status(&w, "play", "versie"), "klaar");
        data.android_id = "nl.1winkel".into();
        assert_eq!(status(&bereken(d.path(), &data, &Teksten::default(), &[]), "play", "app_id"), "ontbreekt");
        let b = vec![Bevinding { code: "privacy_ontbreekt", ernst: "fout", detail: None }];
        assert_eq!(status(&bereken(d.path(), &data, &Teksten::default(), &b), "play", "privacy"), "ontbreekt");
        let t = vec![Bevinding { code: "testtekst", ernst: "fout", detail: Some("winkeltekst:lorem ipsum".into()) }];
        assert_eq!(status(&bereken(d.path(), &data, &Teksten::default(), &t), "appstore", "inhoud"), "ontbreekt");
    }

    #[test]
    fn teksten_tellen_goedgekeurd_per_taal_en_veld_en_promotietekst_mag_leeg() {
        let d = tempfile::tempdir().unwrap();
        let data = AppData { talen: vec!["nl".into(), "en".into()], ..Default::default() };
        let mut t = Teksten::default();
        let velden: Vec<String> = spec().velden("appstore").into_iter().filter(|(_, v)| v.min > 0).map(|(n, _)| n).collect();
        assert_eq!(velden.len(), 5); // promotietekst (min 0) telt niet mee
        for taal in ["nl", "en"] {
            for v in &velden {
                t.goedgekeurd.insert(("appstore".into(), taal.into(), v.clone()));
            }
        }
        assert_eq!(status(&bereken(d.path(), &data, &t, &[]), "appstore", "teksten"), "klaar");
        t.goedgekeurd.remove(&("appstore".into(), "en".into(), "subtitel".into()));
        let w = bereken(d.path(), &data, &t, &[]);
        assert_eq!(status(&w, "appstore", "teksten"), "let_op");
        let detail = w[1].punten.iter().find(|x| x.id == "teksten").unwrap().detail.clone().unwrap();
        assert_eq!((detail["klaar"].as_u64(), detail["totaal"].as_u64(), detail["mist"][0].as_str()), (Some(9), Some(10), Some("subtitel:en")));
    }

    #[test]
    fn screenshots_tellen_per_taal_en_het_minimum_komt_uit_het_bestand() {
        let d = tempfile::tempdir().unwrap();
        let data = AppData { talen: vec!["nl".into(), "en".into()], ..Default::default() };
        for taal in ["nl", "en"] {
            std::fs::create_dir_all(d.path().join(format!("store/screenshots/play/{taal}"))).unwrap();
        }
        let min = spec().waarde("play", "afbeeldingen.telefoon_screenshots.min_aantal").unwrap().as_u64().unwrap();
        for i in 0..min {
            std::fs::write(d.path().join(format!("store/screenshots/play/nl/{i}.png")), "x").unwrap();
        }
        // Engels heeft er nog geen: het laagste aantal telt.
        assert_eq!(status(&bereken(d.path(), &data, &Teksten::default(), &[]), "play", "screenshots"), "ontbreekt");
        for i in 0..min {
            std::fs::write(d.path().join(format!("store/screenshots/play/en/{i}.jpg")), "x").unwrap();
        }
        assert_eq!(status(&bereken(d.path(), &data, &Teksten::default(), &[]), "play", "screenshots"), "klaar");
    }
}
