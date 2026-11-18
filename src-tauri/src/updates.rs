//! Controleren op een nieuwe versie van Studio zelf en die installeren. De controle gebeurt hier in Rust (de frontend doet nooit
//! zelf een netwerkverzoek) en alleen op het adres in `tauri.conf.json` (`plugins.updater.endpoints`: de GitHub-releases van Studio).
//! Elke update is ondertekend; Studio installeert niets waarvan de handtekening niet klopt met de publieke sleutel in de configuratie.
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Zolang dit in de configuratie staat, is het bijwerken nog niet ingesteld (zie docs/updates.md).
pub const PLAATSHOUDER: &str = "NOG-NIET-INGESTELD";

/// De gevonden update, bewaard tot de gebruiker "Nu bijwerken" kiest.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UpdateInfo {
    /// `actueel`, `beschikbaar`, `niet_ingesteld`, `dev` of `fout`.
    pub status: &'static str,
    pub versie_nu: String,
    pub nieuw: Option<String>,
    pub notities: Option<String>,
    pub datum: Option<String>,
}

impl UpdateInfo {
    fn leeg(status: &'static str, nu: &str) -> Self {
        Self { status, versie_nu: nu.into(), nieuw: None, notities: None, datum: None }
    }
}

/// Is de publieke sleutel echt ingesteld (en niet de plaatshouder)?
pub fn ingesteld(pubkey: &str) -> bool {
    let p = pubkey.trim();
    !p.is_empty() && p != PLAATSHOUDER
}

fn pubkey(app: &AppHandle) -> String {
    app.config().plugins.0.get("updater").and_then(|v| v.get("pubkey")).and_then(|v| v.as_str()).unwrap_or("").to_string()
}

/// Zoekt een nieuwe versie. Geeft altijd een gewoon antwoord: een storing wordt `fout`, nooit een crash.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> UpdateInfo {
    let nu = app.package_info().version.to_string();
    // In de ontwikkelversie (npm run tauri dev) bijwerken we niet: dat zou de ontwikkelomgeving vervangen.
    if cfg!(debug_assertions) {
        return UpdateInfo::leeg("dev", &nu);
    }
    if !ingesteld(&pubkey(&app)) {
        return UpdateInfo::leeg("niet_ingesteld", &nu);
    }
    let updater = match app.updater() {
        Ok(u) => u,
        Err(_) => return UpdateInfo::leeg("fout", &nu),
    };
    match updater.check().await {
        Ok(Some(u)) => {
            let info = UpdateInfo { status: "beschikbaar", versie_nu: nu, nieuw: Some(u.version.clone()), notities: u.body.clone().map(|b| b.chars().take(2000).collect()), datum: u.date.map(|d| d.to_string()) };
            *app.state::<Pending>().0.lock().unwrap() = Some(u);
            info
        }
        Ok(None) => {
            *app.state::<Pending>().0.lock().unwrap() = None;
            UpdateInfo::leeg("actueel", &nu)
        }
        Err(_) => UpdateInfo::leeg("fout", &nu),
    }
}

/// Downloadt de gevonden update (met voortgang), sluit alles netjes af en installeert. Daarna start Studio opnieuw.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let Some(update) = app.state::<Pending>().0.lock().unwrap().take() else { return Err("geen_update".into()) };
    let mut totaal_gedaan: u64 = 0;
    let emit = app.clone();
    let bytes = update
        .download(
            move |chunk, totaal| {
                totaal_gedaan += chunk as u64;
                let _ = emit.emit("update-voortgang", serde_json::json!({ "gedaan": totaal_gedaan, "totaal": totaal }));
            },
            || {},
        )
        .await
        .map_err(|_| "download_mislukt".to_string())?;
    // Eerst alles afsluiten (chat, previews, terminals, MCP-servers): op Windows stopt de installer Studio zelf.
    crate::shutdown(&app);
    update.install(bytes).map_err(|_| "installeren_mislukt".to_string())?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plaatshouder_en_leeg_zijn_niet_ingesteld() {
        assert!(!ingesteld(""));
        assert!(!ingesteld("  "));
        assert!(!ingesteld(PLAATSHOUDER));
        assert!(ingesteld("dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFCQ0Q="));
    }

    #[test]
    fn de_configuratie_wijst_alleen_naar_de_releases_van_studio() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let eindpunten = conf["plugins"]["updater"]["endpoints"].as_array().expect("endpoints");
        assert!(!eindpunten.is_empty());
        for e in eindpunten {
            let u = e.as_str().unwrap();
            assert!(u.starts_with("https://github.com/GymWiki/Local-App-Builder/releases/"), "{u}");
        }
        assert!(conf["plugins"]["updater"]["pubkey"].as_str().is_some_and(|p| !p.is_empty()));
    }
}
