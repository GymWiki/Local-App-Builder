//! GitHub-back-up: het project als privé-kopie op het eigen account van de gebruiker. Alleen vooruit sturen (nooit force-push of
//! geschiedenis herschrijven); het token bestaat alleen in het geheugen binnen `Manager::authorized`. Zie `docs/github.md`.
pub mod api;
pub mod app;
pub mod engine;
pub mod gitignore;
pub mod importer;
pub mod name;
pub mod repo;
pub mod scan;
pub mod store;

use crate::connect::error::ConnectError;
use serde::Serialize;
use serde_json::{json, Value};

/// Fouten met een vaste code. De tekst staat in `nl.json` (`github.fout.<code>`); nooit een ruwe foutmelding naar de UI of de AI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GhError {
    NietGekoppeld,
    OngeldigToken,
    GeenRechten,
    TeVeelVerzoeken,
    GeenInternet,
    TimeOut,
    NaamBezet,
    NietGevonden,
    GeenVersies,
    Geannuleerd,
    Afgewezen,
    Onverwacht,
}

impl GhError {
    pub fn code(&self) -> &'static str {
        match self {
            GhError::NietGekoppeld => "niet_gekoppeld",
            GhError::OngeldigToken => "ongeldig_token",
            GhError::GeenRechten => "geen_rechten",
            GhError::TeVeelVerzoeken => "te_veel_verzoeken",
            GhError::GeenInternet => "geen_internet",
            GhError::TimeOut => "time_out",
            GhError::NaamBezet => "naam_bezet",
            GhError::NietGevonden => "niet_gevonden",
            GhError::GeenVersies => "geen_versies",
            GhError::Geannuleerd => "geannuleerd",
            GhError::Afgewezen => "afgewezen",
            GhError::Onverwacht => "onverwacht",
        }
    }
}

impl From<ConnectError> for GhError {
    fn from(e: ConnectError) -> Self {
        match e {
            ConnectError::NotConnected => GhError::NietGekoppeld,
            ConnectError::Unauthorized | ConnectError::Expired => GhError::OngeldigToken,
            ConnectError::Forbidden => GhError::GeenRechten,
            ConnectError::RateLimited => GhError::TeVeelVerzoeken,
            ConnectError::Offline => GhError::GeenInternet,
            ConnectError::Timeout => GhError::TimeOut,
            ConnectError::Cancelled => GhError::Geannuleerd,
            _ => GhError::Onverwacht,
        }
    }
}

/// Het resultaat van een actie. `status` is wat de AI te zien krijgt: `uitgevoerd`, `wacht`, `geweigerd` of `mislukt`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Uitkomst {
    pub status: &'static str,
    pub code: String,
    pub params: Value,
}

impl Uitkomst {
    pub fn ok(code: &str, params: Value) -> Self {
        Self { status: "uitgevoerd", code: code.into(), params }
    }
    pub fn nee(code: &str, params: Value) -> Self {
        Self { status: "geweigerd", code: code.into(), params }
    }
    pub fn fout(e: &GhError) -> Self {
        Self { status: "mislukt", code: e.code().into(), params: json!({}) }
    }
    pub fn is_ok(&self) -> bool {
        self.status == "uitgevoerd"
    }

    /// De tekst voor de AI (gewoon Nederlands, kort en eerlijk). De gebruiker ziet in de app zijn eigen tekst uit `nl.json`.
    pub fn ai_tekst(&self) -> String {
        let n = |k: &str| self.params[k].as_u64().unwrap_or(0);
        let s = |k: &str| self.params[k].as_str().unwrap_or("").to_string();
        match self.code.as_str() {
            "back_up_klaar" => format!("Uitgevoerd: back-up bijgewerkt, {} nieuwe versie(s) naar GitHub gestuurd.", n("aantal")),
            "al_bijgewerkt" => "Uitgevoerd: de back-up was al bijgewerkt; er was niets nieuws.".into(),
            "niet_ingesteld" => "Geweigerd: de back-up op GitHub is nog niet ingesteld. Vraag de gebruiker om dat te doen bij ‘Eerdere versies’; jij kunt dat niet.".into(),
            "niet_bevestigd" => "Geweigerd: de gebruiker heeft de back-up niet toegestaan. Doe niet alsof het gelukt is.".into(),
            "uiteengelopen" => "Geweigerd: de versies op GitHub en op deze computer zijn uiteengelopen. Er is niets gewijzigd; de gebruiker kiest hoe verder. Probeer niets te forceren.".into(),
            "online_nieuwer" => "Geweigerd: op GitHub staan nieuwere versies dan hier. Er is niets gewijzigd; de gebruiker kiest hoe verder.".into(),
            "geheimen" => format!("Geweigerd: er zijn {} bestand(en) met mogelijke geheimen (sleutels of wachtwoorden). Niets is verstuurd. Haal de geheimen uit de bestanden en bewaar ze in de kluis van Studio; vraag daarna opnieuw.", n("aantal")),
            "te_groot" => format!("Geweigerd: {} bestand(en) zijn te groot voor GitHub. Verplaats of verwijder ze en probeer opnieuw.", n("aantal")),
            "geen_versies" => "Geweigerd: er zijn nog geen opgeslagen versies. Sla eerst een versie op.".into(),
            "plan_modus" => "Geweigerd: de AI werkt nu in ‘Eerst overleggen’. Er wordt niets verstuurd.".into(),
            "bezig" => "Geweigerd: er loopt al een back-up.".into(),
            "naam_bezet" => "Mislukt: de naam is al in gebruik op GitHub.".into(),
            "geen_rechten" => "Mislukt: GitHub geeft Studio daar geen rechten voor. De gebruiker kan de koppeling opnieuw maken.".into(),
            "ongeldig_token" => "Mislukt: de koppeling met GitHub werkt niet meer. De gebruiker moet opnieuw verbinden.".into(),
            "geen_internet" => "Mislukt: geen verbinding met GitHub.".into(),
            "time_out" => "Mislukt: GitHub reageerde niet op tijd. Probeer het later opnieuw.".into(),
            "te_veel_verzoeken" => "Mislukt: GitHub vraagt om even te wachten. Probeer het later opnieuw.".into(),
            c => format!("Mislukt: {c}{}", if s("detail").is_empty() { String::new() } else { format!(" ({})", s("detail")) }),
        }
    }
}

#[cfg(test)]
mod tests;
