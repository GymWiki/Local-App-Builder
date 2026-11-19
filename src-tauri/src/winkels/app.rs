//! Verbinding tussen de appwinkel-onderdelen en de app: Tauri-commando's en de opdrachten van de MCP-tools.
use super::data::{self, AppData, Wie};
use super::spec::{beoordeel, spec};
use super::{appid, overzicht, versie, Overzicht};
use crate::chat::ChatManager;
use crate::commands::Db;
use crate::confirm::{self, ActionConfirm, ActionConfirmer, UiActionConfirmer};
use crate::supa::engine::Engine as SupaEngine;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

fn nu() -> i64 {
    crate::connect::manager::real_now()
}

fn dir_van(db: &Db, project: i64) -> Option<PathBuf> {
    let c = db.conn().ok()?;
    crate::projects::get(&c, project).ok().map(|p| PathBuf::from(p.pad))
}

fn supa_gekoppeld(app: &AppHandle, project: i64) -> bool {
    app.state::<Arc<SupaEngine>>().link(project).is_some()
}

#[tauri::command]
pub fn winkels_overzicht(app: AppHandle, db: State<Db>, project_id: i64) -> Result<Overzicht, String> {
    let dir = dir_van(&db, project_id).ok_or("onbekend_project")?;
    let koppeling = supa_gekoppeld(&app, project_id);
    let c = db.conn().map_err(|e| e.to_string())?;
    Ok(overzicht(&c, &dir, project_id, koppeling))
}

/// Bewaart de gegevens van de app. Controleert de app-ID's en de talen; een ongeldige waarde wordt niet bewaard.
#[tauri::command]
pub fn winkels_bewaar(db: State<Db>, project_id: i64, mut data: AppData) -> Result<Value, String> {
    for t in &data.talen {
        if !spec().talen.contains(t) {
            return Ok(json!({ "fout": "onbekende_taal" }));
        }
    }
    data.talen.dedup();
    if data.talen.is_empty() {
        data.talen = vec!["nl".into()];
    }
    for (naam, w) in [("android_id", &data.android_id), ("ios_id", &data.ios_id)] {
        if w.trim().is_empty() {
            continue;
        }
        let o = if naam == "android_id" { appid::android(w) } else { appid::ios(w) };
        if !o.geldig {
            return Ok(json!({ "fout": "app_id", "veld": naam, "code": o.code }));
        }
    }
    for s in [&data.app_naam, &data.contact_email, &data.website, &data.privacy_url, &data.support_url, &data.categorie_play, &data.categorie_apple] {
        if s.len() > 500 {
            return Ok(json!({ "fout": "te_lang" }));
        }
    }
    let c = db.conn().map_err(|e| e.to_string())?;
    data::bewaar(&c, project_id, &data).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn winkels_app_id_voorstel(domein: String, naam: String) -> Value {
    let v = appid::voorstel(&domein, &naam);
    json!({ "voorstel": v, "android": appid::android(&v), "ios": appid::ios(&v) })
}

/// Versie ophogen (alleen Flutter: pubspec.yaml). `hoe`: build, patch, minor of major.
#[tauri::command]
pub fn winkels_versie_ophogen(db: State<Db>, project_id: i64, hoe: String) -> Result<Value, String> {
    let dir = dir_van(&db, project_id).ok_or("onbekend_project")?;
    let h = match hoe.as_str() {
        "build" => versie::Ophogen::Build,
        "patch" => versie::Ophogen::Patch,
        "minor" => versie::Ophogen::Minor,
        "major" => versie::Ophogen::Major,
        _ => return Ok(json!({ "fout": "onbekend" })),
    };
    let Some(oud) = versie::lees(&dir) else { return Ok(json!({ "fout": "geen_versie" })) };
    let nieuw = versie::hoger(&oud, h);
    match versie::schrijf(&dir, &nieuw) {
        Ok(()) => Ok(json!({ "oud": oud.tekst(), "nieuw": nieuw.tekst() })),
        Err(c) => Ok(json!({ "fout": c })),
    }
}

#[tauri::command]
pub fn winkels_teksten(db: State<Db>, project_id: i64, winkel: String, taal: String) -> Result<Vec<data::VeldStand>, String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    Ok(spec().velden(&winkel).into_iter().filter_map(|(v, _)| data::stand(&c, project_id, &winkel, &taal, &v)).collect())
}

#[tauri::command]
pub fn winkels_tekst_concept(db: State<Db>, project_id: i64, winkel: String, taal: String, veld: String, tekst: String) -> Result<Value, String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    match data::concept(&c, project_id, &winkel, &taal, &veld, &tekst, Wie::Gebruiker, nu()) {
        Ok(id) => Ok(json!({ "id": id })),
        Err(code) => Ok(json!({ "fout": code })),
    }
}

#[tauri::command]
pub fn winkels_tekst_goedkeuren(db: State<Db>, project_id: i64, id: i64) -> Result<Value, String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    Ok(match data::keur_goed(&c, project_id, id) {
        Ok(()) => json!({ "ok": true }),
        Err(code) => json!({ "fout": code }),
    })
}

#[tauri::command]
pub fn winkels_tekst_ontgrendel(db: State<Db>, project_id: i64, winkel: String, taal: String, veld: String) -> Result<Value, String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    Ok(match data::ontgrendel(&c, project_id, &winkel, &taal, &veld, nu()) {
        Ok(()) => json!({ "ok": true }),
        Err(code) => json!({ "fout": code }),
    })
}

#[tauri::command]
pub fn winkels_tekst_geschiedenis(db: State<Db>, project_id: i64, winkel: String, taal: String, veld: String) -> Result<Vec<data::Versie>, String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    Ok(data::versies(&c, project_id, &winkel, &taal, &veld))
}

/// Opdrachten van de MCP-tools (Node → app). De AI krijgt alleen gewone gegevens; nooit een sleutel of wachtwoord.
pub fn host(app: &AppHandle, project: i64, cmd: &str, args: &Value) -> Result<Value, String> {
    let reply = |status: &'static str, tekst: String, data: Option<Value>| serde_json::to_value(crate::supa::engine::Reply { status, tekst, data }).map_err(|x| x.to_string());
    let db = app.state::<Db>();
    let dir = dir_van(&db, project).ok_or("Het project is niet gevonden.")?;
    match cmd {
        "winkel.status" | "winkel.klaarcheck" => {
            let koppeling = supa_gekoppeld(app, project);
            let c = db.conn().map_err(|e| e.to_string())?;
            let o = overzicht(&c, &dir, project, koppeling);
            let winkels: Vec<Value> = o
                .winkels
                .iter()
                .map(|w| {
                    json!({
                        "winkel": w.winkel,
                        "klaar": w.klaar,
                        "totaal": w.totaal,
                        "punten": w.punten.iter().map(|p| json!({ "id": p.id, "status": p.status, "detail": p.detail })).collect::<Vec<_>>(),
                    })
                })
                .collect();
            let data = if cmd == "winkel.status" {
                json!({ "app_naam": o.data.app_naam, "android_id": o.data.android_id, "ios_id": o.data.ios_id, "talen": o.data.talen, "versie": o.versie.map(|v| v.tekst()), "winkels": winkels })
            } else {
                json!({ "winkels": winkels, "bevindingen": o.veilig })
            };
            reply("uitgevoerd", "Stand van de winkelvoorbereiding. De uitleg per onderdeel staat in Studio; wat de gebruiker zelf bij een winkel moet doen heeft status ‘handmatig’.".into(), Some(data))
        }
        "winkel.schrijf_teksten" => {
            // De AI schrijft alleen concepten; de gebruiker keurt goed. Eerst de gebruiker om toestemming vragen.
            if app.state::<ChatManager>().mode(project) == "plan" {
                return reply("geweigerd", "De AI werkt nu in ‘Eerst overleggen’. Er wordt niets opgeslagen.".into(), None);
            }
            let winkel = args["winkel"].as_str().unwrap_or("");
            let taal = args["taal"].as_str().unwrap_or("");
            let Some(map) = args["teksten"].as_object() else { return reply("mislukt", "Geef de teksten als een object met veldnamen.".into(), None) };
            if map.is_empty() || map.len() > 12 {
                return reply("mislukt", "Geef tussen 1 en 12 velden.".into(), None);
            }
            for (v, t) in map {
                if spec().veld(winkel, v).is_none() || t.as_str().is_none() {
                    return reply("mislukt", format!("Onbekend veld ‘{v}’ of geen tekst. Geldige velden voor {winkel}: {}.", spec().velden(winkel).iter().map(|(n, _)| n.clone()).collect::<Vec<_>>().join(", ")), None);
                }
            }
            if !spec().talen.iter().any(|t| t == taal) {
                return reply("mislukt", format!("Onbekende taal. Kies uit: {}.", spec().talen.join(", ")), None);
            }
            let confirmer = app.state::<Arc<UiActionConfirmer>>().inner().clone();
            let req = ActionConfirm { id: confirm::new_id(), project_id: project, soort: "winkel_teksten".into(), params: json!({ "winkel": winkel, "aantal": map.len() }), zwaar: false };
            if !confirmer.ask(&req) {
                return reply("geweigerd", "De gebruiker heeft niet toegestaan dat je teksten voorstelt. Doe niet alsof het gelukt is.".into(), None);
            }
            let c = db.conn().map_err(|e| e.to_string())?;
            let mut uitslag = vec![];
            for (v, t) in map {
                let tekst = t.as_str().unwrap_or("");
                let veld = spec().veld(winkel, v).expect("gecontroleerd");
                match data::concept(&c, project, winkel, taal, v, tekst, Wie::Ai, nu()) {
                    Ok(_) => {
                        let tel = beoordeel(&veld, tekst);
                        uitslag.push(json!({ "veld": v, "aantal": tel.aantal, "maximaal": tel.max, "eenheid": tel.eenheid, "oordeel": tel.oordeel }));
                    }
                    Err(code) => uitslag.push(json!({ "veld": v, "fout": code })),
                }
            }
            reply("uitgevoerd", "De teksten staan als CONCEPT klaar. De gebruiker bekijkt en keurt ze zelf goed; een al goedgekeurde tekst is niet aangeraakt. Houd je aan de limieten (oordeel ‘te_lang’ moet korter).".into(), Some(json!(uitslag)))
        }
        _ => Err("Onbekende opdracht aan Studio.".into()),
    }
}
