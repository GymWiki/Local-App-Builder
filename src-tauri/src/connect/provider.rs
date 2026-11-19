//! De gemeenschappelijke vorm van een dienst (GitHub, Vercel, Supabase, later Google Play en Apple).
use super::device::DeviceSpec;
use super::error::ConnectError;
use super::http::Http;
use super::oauth::LoopbackSpec;
use super::tokens::TokenSet;
use serde::Serialize;

/// Hoe de gebruiker inlogt. De knop kiest zelf; zie `Manager::strategy`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Strategy {
    OauthLoopbackPkce,
    OauthDevice,
    TokenPlakken,
}

/// De OAuth-mogelijkheid van een dienst (zonder client-ID; die komt uit het configuratiebestand).
#[derive(Debug, Clone)]
pub enum OauthKind {
    Device { device_url: &'static str, token_url: &'static str, scope: &'static str },
    #[allow(dead_code)] // gebouwd en getest, maar geen enkele dienst gebruikt het nu (docs/koppelingen.md)
    Loopback { authorize_url: &'static str, token_url: &'static str, scope: &'static str, port: u16 },
}

pub struct Account {
    pub name: String,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Links {
    pub signup: &'static str,
    /// Pagina waar de gebruiker zelf een toegangstoken maakt (voor "token plakken").
    pub token_page: &'static str,
    /// Pagina waar de gebruiker de toegang van Studio zelf kan bekijken of intrekken.
    pub manage: &'static str,
}

pub enum Revoke {
    #[allow(dead_code)] // nog geen dienst laat intrekken toe zonder geheim
    Done,
    /// De dienst laat intrekken niet toe zonder geheim of zonder het token-ID; de gebruiker doet dat zelf via `Links::manage`.
    NotSupported,
}

pub trait Provider: Send + Sync {
    fn id(&self) -> &'static str;
    /// Codes van de minimale rechten (uitleg in nl.json: `koppelingen.<id>.rechten.<code>`).
    fn rights(&self) -> &'static [&'static str];
    /// Codes van functies die van deze koppeling afhangen (nl.json: `koppelingen.<id>.functies.<code>`).
    fn functions(&self) -> &'static [&'static str];
    /// Hosts waarmee deze dienst mag praten (https).
    fn hosts(&self) -> &'static [&'static str];
    fn links(&self) -> Links;
    fn oauth(&self) -> Option<OauthKind> {
        None
    }
    /// `test()`: haalt de account op. Fouten: 401 = ongeldig token, 403 = te weinig rechten, 429 = te veel verzoeken.
    fn verify(&self, http: &dyn Http, token: &str) -> Result<Account, ConnectError>;
    fn revoke(&self, _http: &dyn Http, _tokens: &TokenSet, _client_id: &str) -> Revoke {
        Revoke::NotSupported
    }
}

pub fn device_spec(kind: &OauthKind, client_id: &str) -> Option<DeviceSpec> {
    match kind {
        OauthKind::Device { device_url, token_url, scope } => Some(DeviceSpec { device_url: device_url.to_string(), token_url: token_url.to_string(), client_id: client_id.to_string(), scope: scope.to_string() }),
        _ => None,
    }
}

pub fn loopback_spec(kind: &OauthKind, client_id: &str) -> Option<LoopbackSpec> {
    match kind {
        OauthKind::Loopback { authorize_url, token_url, scope, port } => Some(LoopbackSpec { authorize_url: authorize_url.to_string(), token_url: token_url.to_string(), client_id: client_id.to_string(), scope: scope.to_string(), port: *port }),
        _ => None,
    }
}
