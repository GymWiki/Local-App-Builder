pub mod github;
pub mod supabase;
pub mod vercel;

use super::http::Response;
use super::provider::Provider;
use super::error::{from_status, ConnectError};
use std::sync::Arc;

pub fn all() -> Vec<Arc<dyn Provider>> {
    vec![Arc::new(github::GitHub), Arc::new(vercel::Vercel), Arc::new(supabase::Supabase)]
}

/// Alle hosts waarmee Studio voor koppelingen mag praten (de enige uitgaande verbindingen van deze functie).
pub fn allowed_hosts() -> Vec<&'static str> {
    let mut v: Vec<&'static str> = all().iter().flat_map(|p| p.hosts().iter().copied()).collect();
    v.sort();
    v.dedup();
    v
}

pub(crate) fn check(resp: &Response) -> Result<(), ConnectError> {
    match from_status(resp.status) {
        None => Ok(()),
        Some(e) => Err(e),
    }
}

/// Hosts waarvan een pagina in de systeembrowser mag worden geopend (aanmelden, token maken, toegang beheren, code invoeren).
pub fn open_hosts() -> Vec<&'static str> {
    let mut v = allowed_hosts();
    for p in all() {
        let l = p.links();
        for u in [l.signup, l.token_page, l.manage] {
            if let Some(h) = u.strip_prefix("https://").and_then(|r| r.split('/').next()) {
                v.push(h);
            }
        }
    }
    // Websites die Studio online heeft gezet (voorbeelden en de echte site) mogen in de browser worden geopend; er wordt niets opgehaald.
    v.push(".vercel.app");
    v.sort();
    v.dedup();
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connect::http::is_allowed;

    #[test]
    fn uitgaande_verbindingen_zijn_beperkt_tot_de_officiele_hosts() {
        assert_eq!(allowed_hosts(), vec!["api.github.com", "api.supabase.com", "api.vercel.com", "github.com"]);
    }

    #[test]
    fn de_browser_opent_alleen_pagina_s_van_de_diensten() {
        let h = open_hosts();
        assert!(is_allowed("https://github.com/login/device", &h));
        assert!(is_allowed("https://supabase.com/dashboard/account/tokens", &h));
        assert!(is_allowed("https://vercel.com/account/tokens", &h));
        assert!(is_allowed("https://mijn-site-abc.vercel.app/", &h));
        assert!(!is_allowed("https://vercel.app.evil.example/", &h));
        assert!(!is_allowed("https://evil.example/", &h));
        assert!(!is_allowed("http://github.com/", &h));
        assert!(!is_allowed("file:///etc/passwd", &h));
        assert!(!is_allowed("https://github.com.evil.example/", &h));
    }
}
