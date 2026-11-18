//! De publieke client-ID's van door Studio geregistreerde apps (`config/koppelingen.json`). Geen geheimen.
//! Leeg of ongeldig = die dienst valt terug op "token plakken". Voor tests en ontwikkeling: `STUDIO_<DIENST>_CLIENT_ID`.
use std::collections::HashMap;

#[derive(Debug, Default, Clone)]
pub struct Config {
    ids: HashMap<String, String>,
}

fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 100 && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

impl Config {
    pub fn load(json: &str, env: &dyn Fn(&str) -> Option<String>) -> Self {
        let v: serde_json::Value = serde_json::from_str(json).unwrap_or(serde_json::Value::Null);
        let mut ids = HashMap::new();
        for p in ["github", "vercel", "supabase", "googleplay", "apple"] {
            let from_env = env(&format!("STUDIO_{}_CLIENT_ID", p.to_ascii_uppercase()));
            let id = from_env.or_else(|| v[p]["client_id"].as_str().map(String::from)).unwrap_or_default();
            let id = id.trim().to_string();
            if valid_id(&id) {
                ids.insert(p.to_string(), id);
            }
        }
        Self { ids }
    }

    pub fn embedded() -> Self {
        Self::load(include_str!("../../../config/koppelingen.json"), &|k| std::env::var(k).ok())
    }

    pub fn client_id(&self, provider: &str) -> Option<&str> {
        self.ids.get(provider).map(String::as_str)
    }

    #[cfg(test)]
    pub fn with(provider: &str, id: &str) -> Self {
        Self { ids: HashMap::from([(provider.to_string(), id.to_string())]) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leeg_of_ongeldig_telt_als_niet_ingevuld() {
        let c = Config::load(r#"{"github":{"client_id":""},"vercel":{"client_id":"has space"},"supabase":{}}"#, &|_| None);
        assert!(c.client_id("github").is_none() && c.client_id("vercel").is_none() && c.client_id("supabase").is_none());
        assert!(Config::load("kapot", &|_| None).client_id("github").is_none());
    }

    #[test]
    fn ingevuld_en_omgevingsvariabele() {
        let c = Config::load(r#"{"github":{"client_id":"Iv1.abc123"}}"#, &|_| None);
        assert_eq!(c.client_id("github"), Some("Iv1.abc123"));
        let c = Config::load(r#"{"github":{"client_id":"uit-bestand"}}"#, &|k| (k == "STUDIO_GITHUB_CLIENT_ID").then(|| "uit-env".into()));
        assert_eq!(c.client_id("github"), Some("uit-env"));
    }

    #[test]
    fn het_meegeleverde_bestand_is_geldig_en_bevat_geen_geheimen() {
        let tekst = include_str!("../../../config/koppelingen.json");
        assert!(serde_json::from_str::<serde_json::Value>(tekst).is_ok());
        assert!(!tekst.to_lowercase().contains("secret"));
    }
}
