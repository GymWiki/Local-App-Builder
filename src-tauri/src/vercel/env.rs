//! Regels voor omgevingsvariabelen. Een geheime sleutel mag nooit in iets terechtkomen wat de browser te zien krijgt, en een
//! serversleutel alleen in een project dat een serverdeel heeft. De waarden zelf staan alleen in de OS-kluis.
use crate::github::scan::looks_secret;
use std::path::Path;

/// Namen waarvan het bouwgereedschap de waarde in de browsercode zet.
pub const PUBLIEKE_VOORVOEGSELS: &[&str] = &["VITE_", "NEXT_PUBLIC_", "PUBLIC_", "REACT_APP_", "NUXT_PUBLIC_", "EXPO_PUBLIC_", "GATSBY_"];
pub const OMGEVINGEN: &[&str] = &["production", "preview", "development"];
const MAX_WAARDE: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Soort {
    Openbaar,
    Server,
}

impl Soort {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "openbaar" => Some(Soort::Openbaar),
            "server" => Some(Soort::Server),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Soort::Openbaar => "openbaar",
            Soort::Server => "server",
        }
    }
}

pub fn valid_name(n: &str) -> bool {
    let mut c = n.chars();
    c.next().is_some_and(|f| f.is_ascii_uppercase()) && n.len() <= 64 && n.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_') && !n.starts_with("VERCEL") && !n.starts_with("NEXT_RUNTIME")
}

pub fn is_public_name(n: &str) -> bool {
    PUBLIEKE_VOORVOEGSELS.iter().any(|p| n.starts_with(p))
}

/// Heeft dit project een deel dat op een server draait (en dus een geheime sleutel mag krijgen)?
pub fn server_capable(dir: &Path) -> bool {
    if dir.join("api").is_dir() || dir.join("app/api").is_dir() || dir.join("src/pages/api").is_dir() || dir.join("pages/api").is_dir() {
        return true;
    }
    let pkg = std::fs::read_to_string(dir.join("package.json")).unwrap_or_default();
    ["\"next\"", "\"nuxt\"", "\"@sveltejs/kit\"", "\"@remix-run/", "\"astro\"", "\"express\"", "\"hono\"", "\"fastify\""].iter().any(|k| pkg.contains(k))
}

/// Controleert een nieuwe variabele. De fout is een vaste code (nl.json: `vercel.env.fout.<code>`).
pub fn check(name: &str, soort: Soort, value: &str, omgevingen: &[String], server_deel: bool) -> Result<(), &'static str> {
    if !valid_name(name) {
        return Err("ongeldige_naam");
    }
    if value.is_empty() {
        return Err("lege_waarde");
    }
    if value.len() > MAX_WAARDE {
        return Err("te_lang");
    }
    if omgevingen.is_empty() || omgevingen.iter().any(|o| !OMGEVINGEN.contains(&o.as_str())) {
        return Err("ongeldige_omgeving");
    }
    match soort {
        Soort::Openbaar => {
            // Wat de browser te zien krijgt, mag nooit een geheim zijn: niet aan de waarde, niet aan de naam te herkennen.
            let upper = name.to_uppercase();
            if looks_secret(value) || ["SECRET", "SERVICE_ROLE", "PRIVATE", "PASSWORD", "WACHTWOORD"].iter().any(|k| upper.contains(k)) {
                return Err("geheim_als_openbaar");
            }
        }
        Soort::Server => {
            if is_public_name(name) {
                return Err("server_met_openbare_naam");
            }
            if !server_deel {
                return Err("geen_servergedeelte");
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn namen_en_waarden_worden_gecontroleerd() {
        let al = e(&["production", "preview"]);
        assert_eq!(check("SITE_NAAM", Soort::Openbaar, "Mijn winkel", &al, false), Ok(()));
        assert_eq!(check("site", Soort::Openbaar, "x", &al, false), Err("ongeldige_naam"));
        assert_eq!(check("VERCEL_URL", Soort::Openbaar, "x", &al, false), Err("ongeldige_naam"));
        assert_eq!(check("A", Soort::Openbaar, "", &al, false), Err("lege_waarde"));
        assert_eq!(check("A", Soort::Openbaar, &"x".repeat(5000), &al, false), Err("te_lang"));
        assert_eq!(check("A", Soort::Openbaar, "x", &e(&["productie"]), false), Err("ongeldige_omgeving"));
        assert_eq!(check("A", Soort::Openbaar, "x", &[], false), Err("ongeldige_omgeving"));
    }

    #[test]
    fn een_geheime_sleutel_komt_nooit_in_een_clientvariabele() {
        let al = e(&["production"]);
        let service_role = {
            use base64::Engine as _;
            let b = base64::engine::general_purpose::URL_SAFE_NO_PAD;
            format!("{}.{}.{}", b.encode("{\"alg\":\"HS256\"}"), b.encode("{\"role\":\"service_role\",\"iss\":\"supabase\"}"), "q".repeat(20))
        };
        let github = ["ghp", "_", &"v5Rt".repeat(9)].concat();
        let geheim_sb = ["sb_secret", "_", "ABCDEFGHIJKLMNOPQRST"].concat();
        for w in [service_role.as_str(), github.as_str(), geheim_sb.as_str()] {
            assert_eq!(check("VITE_SUPABASE_KEY", Soort::Openbaar, w, &al, false), Err("geheim_als_openbaar"), "{w}");
        }
        assert_eq!(check("VITE_SERVICE_ROLE_KEY", Soort::Openbaar, "iets", &al, false), Err("geheim_als_openbaar"));
        // De publieke Supabase-sleutel (anon) mag wel.
        let anon = {
            use base64::Engine as _;
            let b = base64::engine::general_purpose::URL_SAFE_NO_PAD;
            format!("{}.{}.{}", b.encode("{\"alg\":\"HS256\"}"), b.encode("{\"role\":\"anon\",\"iss\":\"supabase\"}"), "q".repeat(20))
        };
        assert_eq!(check("VITE_SUPABASE_PUBLISHABLE_KEY", Soort::Openbaar, &anon, &al, false), Ok(()));
        assert_eq!(check("VITE_SUPABASE_PUBLISHABLE_KEY", Soort::Openbaar, "sb_publishable_ABC", &al, false), Ok(()));
    }

    #[test]
    fn een_serversleutel_alleen_met_een_servernaam_en_een_serverdeel() {
        let al = e(&["production"]);
        assert_eq!(check("STRIPE_SECRET_KEY", Soort::Server, "x", &al, true), Ok(()));
        assert_eq!(check("NEXT_PUBLIC_STRIPE_SECRET", Soort::Server, "x", &al, true), Err("server_met_openbare_naam"));
        assert_eq!(check("VITE_STRIPE_SECRET", Soort::Server, "x", &al, true), Err("server_met_openbare_naam"));
        assert_eq!(check("STRIPE_SECRET_KEY", Soort::Server, "x", &al, false), Err("geen_servergedeelte"));
    }

    #[test]
    fn herkent_een_serverdeel() {
        let d = tempfile::tempdir().unwrap();
        assert!(!server_capable(d.path()));
        std::fs::write(d.path().join("package.json"), r#"{"dependencies":{"react":"1","vite":"1"}}"#).unwrap();
        assert!(!server_capable(d.path()));
        std::fs::write(d.path().join("package.json"), r#"{"dependencies":{"next":"1"}}"#).unwrap();
        assert!(server_capable(d.path()));
        let e = tempfile::tempdir().unwrap();
        std::fs::create_dir(e.path().join("api")).unwrap();
        assert!(server_capable(e.path()));
    }
}
