//! Model- en inspanningsbeleid: een eenvoudige keuze ("Automatisch", "Zuinig", "Gebalanceerd", "Zo goed mogelijk") die per AI naar
//! een model en inspanning wordt vertaald via `config/model-beleid.json`. Alleen wat daar als nagekeken staat, wordt gebruikt.
//! Let op: een ander model midden in een gesprek breekt de cache van de aanbieder. Daarom wordt het niveau gekozen als het AI-proces
//! start, en daarna alleen verhoogd bij vastlopen (escalatie), niet per bericht.
use crate::provider::Provider;
use serde_json::Value;

const CONFIG: &str = include_str!("../../../config/model-beleid.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Beleid {
    Auto,
    Zuinig,
    Gebalanceerd,
    Best,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Niveau {
    Zuinig,
    Gebalanceerd,
    Best,
}

impl Niveau {
    fn sleutel(self) -> &'static str {
        match self {
            Niveau::Zuinig => "zuinig",
            Niveau::Gebalanceerd => "gebalanceerd",
            Niveau::Best => "best",
        }
    }
}

impl Beleid {
    pub fn parse(s: Option<&str>) -> Beleid {
        match s {
            Some("zuinig") => Beleid::Zuinig,
            Some("gebalanceerd") => Beleid::Gebalanceerd,
            Some("best") => Beleid::Best,
            _ => Beleid::Auto,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Keuze {
    pub model: Option<String>,
    pub effort: Option<String>,
}

const ZWAAR: [&str; 19] = [
    "database", "inlog", "inloggen", "login", "betaal", "betalen", "publiceer", "publiceren", "online zetten", "live", "supabase", "beveilig", "veilig", "migratie", "architectuur", "herschrijf", "alles opnieuw", "app store", "play store",
];
const KLEIN: [&str; 20] = [
    "kleur", "tekst", "typfout", "groter", "kleiner", "knop", "lettertype", "spelling", "titel", "afstand", "marge", "uitlijnen", "icoon", "logo", "naam", "opmaak", "dikgedrukt", "donkerder", "lichter", "hernoem",
];

/// Een eerste inschatting van de zwaarte van een verzoek (deterministisch, zonder AI). Bij twijfel: gebalanceerd.
pub fn niveau_voor(tekst: &str, plan: bool) -> Niveau {
    let t = tekst.to_lowercase();
    if plan || t.chars().count() > 600 || ZWAAR.iter().any(|w| t.contains(w)) {
        return Niveau::Best;
    }
    if t.chars().count() <= 160 && KLEIN.iter().any(|w| t.contains(w)) {
        return Niveau::Zuinig;
    }
    Niveau::Gebalanceerd
}

/// Het niveau voor dit proces: de vaste keuze van de gebruiker, of bij "Automatisch" de inschatting. Escalatie gaat altijd naar `Best`.
pub fn kies(beleid: Beleid, tekst: &str, plan: bool, escalatie: bool) -> Niveau {
    if escalatie {
        return Niveau::Best;
    }
    match beleid {
        Beleid::Zuinig => Niveau::Zuinig,
        Beleid::Gebalanceerd => Niveau::Gebalanceerd,
        Beleid::Best => Niveau::Best,
        Beleid::Auto => niveau_voor(tekst, plan),
    }
}

fn geldige_naam(s: &str) -> bool {
    !s.is_empty() && s.len() <= 60 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '[' | ']' | ':'))
}

/// Model en inspanning voor een AI, of niets als dat niet nagekeken is. `eigen_model` (Voor gevorderden) wint van het beleid.
pub fn keuze(provider: Provider, niveau: Niveau, eigen_model: Option<&str>) -> Keuze {
    let cfg: Value = serde_json::from_str(CONFIG).unwrap_or_default();
    let p = &cfg[provider.as_str()];
    if p["geverifieerd"] != true {
        return Keuze::default();
    }
    let n = &p["niveaus"][niveau.sleutel()];
    let eigen = eigen_model.map(str::trim).filter(|m| geldige_naam(m)).map(String::from);
    Keuze {
        model: eigen.or_else(|| n["model"].as_str().filter(|m| geldige_naam(m)).map(String::from)),
        effort: n["effort"].as_str().filter(|m| geldige_naam(m)).map(String::from),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inschatting_zwaarte() {
        assert_eq!(niveau_voor("Maak de knop groter", false), Niveau::Zuinig);
        assert_eq!(niveau_voor("Voeg een database toe voor bestellingen", false), Niveau::Best);
        assert_eq!(niveau_voor("Voeg een pagina toe met mijn adres", false), Niveau::Gebalanceerd);
        assert_eq!(niveau_voor("Maak de knop groter", true), Niveau::Best, "plan-modus = plannen = sterkste");
        assert_eq!(niveau_voor(&"x ".repeat(400), false), Niveau::Best, "lang verzoek");
        assert_eq!(niveau_voor("Zet mijn site online zetten", false), Niveau::Best);
    }

    #[test]
    fn vaste_keuze_en_escalatie() {
        assert_eq!(kies(Beleid::Zuinig, "database", false, false), Niveau::Zuinig);
        assert_eq!(kies(Beleid::Best, "knop", false, false), Niveau::Best);
        assert_eq!(kies(Beleid::Auto, "kleur van de titel", false, false), Niveau::Zuinig);
        assert_eq!(kies(Beleid::Zuinig, "knop", false, true), Niveau::Best, "vastlopen = sterker model");
        assert_eq!(Beleid::parse(None), Beleid::Auto);
        assert_eq!(Beleid::parse(Some("onzin")), Beleid::Auto);
    }

    #[test]
    fn alleen_nagekeken_ais_krijgen_een_model() {
        let k = keuze(Provider::Claude, Niveau::Zuinig, None);
        assert_eq!((k.model.as_deref(), k.effort.as_deref()), (Some("sonnet"), Some("low")));
        assert_eq!(keuze(Provider::Claude, Niveau::Best, None).model.as_deref(), Some("opus"));
        assert_eq!(keuze(Provider::Gemini, Niveau::Best, None), Keuze::default());
        assert_eq!(keuze(Provider::Claude, Niveau::Best, Some("claude-opus-5-5")).model.as_deref(), Some("claude-opus-5-5"));
        // ongeldige eigen naam (bijv. met spaties of opdrachttekens) wordt genegeerd
        assert_eq!(keuze(Provider::Claude, Niveau::Best, Some("opus; rm -rf")).model.as_deref(), Some("opus"));
    }

    #[test]
    fn niveaus_zijn_geordend() {
        assert!(Niveau::Zuinig < Niveau::Gebalanceerd && Niveau::Gebalanceerd < Niveau::Best);
    }
}
