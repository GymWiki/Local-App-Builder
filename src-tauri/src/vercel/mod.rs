//! Online zetten met Vercel (eigen account van de gebruiker): bestanden uploaden, een voorbeeld of de echte site laten bouwen,
//! omgevingsvariabelen uit de kluis, terugdraaien. Alles via de REST-API van Vercel; geen CLI. Zie `docs/vercel.md`.
pub mod api;
pub mod app;
pub mod engine;
pub mod env;
pub mod files;
pub mod store;

use crate::connect::error::ConnectError;
use serde::Serialize;
use serde_json::{json, Value};

/// Fouten met een vaste code (nl.json: `vercel.fout.<code>`). Nooit een ruwe foutmelding naar de UI of de AI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VError {
    NietGekoppeld,
    OngeldigToken,
    GeenRechten,
    TeVeelVerzoeken,
    GeenInternet,
    TimeOut,
    NaamBezet,
    NietGevonden,
    Geannuleerd,
    RollbackPro,
    Onverwacht,
}

impl VError {
    pub fn code(&self) -> &'static str {
        match self {
            VError::NietGekoppeld => "niet_gekoppeld",
            VError::OngeldigToken => "ongeldig_token",
            VError::GeenRechten => "geen_rechten",
            VError::TeVeelVerzoeken => "te_veel_verzoeken",
            VError::GeenInternet => "geen_internet",
            VError::TimeOut => "time_out",
            VError::NaamBezet => "naam_bezet",
            VError::NietGevonden => "niet_gevonden",
            VError::Geannuleerd => "geannuleerd",
            VError::RollbackPro => "rollback_pro",
            VError::Onverwacht => "onverwacht",
        }
    }
}

impl From<ConnectError> for VError {
    fn from(e: ConnectError) -> Self {
        match e {
            ConnectError::NotConnected => VError::NietGekoppeld,
            ConnectError::Unauthorized | ConnectError::Expired => VError::OngeldigToken,
            ConnectError::Forbidden => VError::GeenRechten,
            ConnectError::RateLimited => VError::TeVeelVerzoeken,
            ConnectError::Offline => VError::GeenInternet,
            ConnectError::Timeout => VError::TimeOut,
            ConnectError::Cancelled => VError::Geannuleerd,
            _ => VError::Onverwacht,
        }
    }
}

/// Het resultaat van een actie. `status`: `uitgevoerd`, `geweigerd` of `mislukt`.
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
    pub fn mislukt(code: &str, params: Value) -> Self {
        Self { status: "mislukt", code: code.into(), params }
    }
    pub fn fout(e: &VError) -> Self {
        Self::mislukt(e.code(), json!({}))
    }
    pub fn is_ok(&self) -> bool {
        self.status == "uitgevoerd"
    }

    /// Tekst voor de AI: kort, eerlijk, zonder tokens of waarden.
    pub fn ai_tekst(&self) -> String {
        let s = |k: &str| self.params[k].as_str().unwrap_or("").to_string();
        match self.code.as_str() {
            "voorbeeld_online" => format!("Uitgevoerd: een voorbeeld staat online op {}. Dit is niet de echte site.", s("url")),
            "live_online" => format!("Uitgevoerd: de echte site staat online op {}.", s("url")),
            "niet_ingesteld" => "Geweigerd: Vercel is nog niet ingesteld voor dit project. Vraag de gebruiker om bij ‘Online zetten’ een eerste keer een voorbeeld te maken; jij kunt dat niet.".into(),
            "niet_bevestigd" => "Geweigerd: de gebruiker heeft het niet toegestaan. Er staat niets nieuws online. Doe niet alsof het gelukt is.".into(),
            "bevestiging_nodig" => "Geweigerd: echt online zetten moet de gebruiker zelf bevestigen in Studio.".into(),
            "controles" => format!("Geweigerd: de controles voor het online zetten zijn niet groen ({}). Herstel dat eerst; er staat niets online.", s("samenvatting")),
            "bouw_mislukt" => format!("Mislukt: Vercel kon het project niet bouwen. Samenvatting: {} Herstel dit en probeer opnieuw. Doe niet alsof het gelukt is.", s("samenvatting")),
            "geannuleerd" => "Mislukt: het online zetten is geannuleerd.".into(),
            "time_out" => "Mislukt: Vercel was niet op tijd klaar. Er is niets live gezet.".into(),
            "lus" => "Geweigerd: dezelfde fout keerde herhaaldelijk terug; Studio heeft de AI gestopt. De gebruiker beslist hoe verder.".into(),
            "plan_modus" => "Geweigerd: de AI werkt nu in ‘Eerst overleggen’. Er wordt niets online gezet.".into(),
            "bezig" => "Geweigerd: er loopt al een actie voor dit project.".into(),
            "env_gezet" => "Uitgevoerd: de omgevingsvariabele is doorgestuurd naar Vercel. De waarde is nergens meer te lezen.".into(),
            "env_onbekend" => "Geweigerd: deze variabele is niet door de gebruiker ingevoerd in Studio. Vraag de gebruiker om de waarde in te voeren bij ‘Online zetten’; geef nooit zelf een waarde door.".into(),
            "teruggezet" => "Uitgevoerd: de echte site is teruggezet naar de gekozen versie.".into(),
            "rollback_pro" => "Mislukt: op het gratis plan van Vercel kan alleen naar de vorige versie worden teruggezet.".into(),
            "geen_internet" => "Mislukt: geen verbinding met Vercel.".into(),
            "ongeldig_token" => "Mislukt: de koppeling met Vercel werkt niet meer. De gebruiker moet opnieuw verbinden.".into(),
            "geen_rechten" => "Mislukt: Vercel geeft Studio hier geen rechten voor.".into(),
            "te_veel_verzoeken" => "Mislukt: Vercel vraagt om even te wachten. Probeer het later opnieuw.".into(),
            c => format!("Mislukt: {c}."),
        }
    }
}

#[cfg(test)]
mod tests;
