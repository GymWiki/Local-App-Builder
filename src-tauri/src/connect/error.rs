//! Fouten van koppelingen. De app toont de teksten (nl.json: `koppelingen.fout.<code>`); hier staan alleen codes.
use serde::{Serialize, Serializer};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ConnectError {
    #[error("geannuleerd")]
    Cancelled,
    #[error("geweigerd")]
    Denied,
    #[error("verlopen")]
    Expired,
    #[error("geen_internet")]
    Offline,
    #[error("time_out")]
    Timeout,
    #[error("poort_bezet")]
    PortBusy,
    #[error("te_weinig_rechten")]
    Forbidden,
    #[error("ongeldig_token")]
    Unauthorized,
    #[error("te_veel_verzoeken")]
    RateLimited,
    #[error("geblokkeerd")]
    Blocked,
    #[error("niet_gekoppeld")]
    NotConnected,
    #[error("kluis")]
    Vault,
    #[error("onbekende_dienst")]
    UnknownProvider,
    #[error("onverwacht")]
    Unexpected,
}

impl ConnectError {
    /// De vaste code voor de frontend (zelfde tekst als `Display`).
    pub fn code(&self) -> String {
        self.to_string()
    }

    /// Alleen deze fouten betekenen dat de opgeslagen toegang niet meer werkt (dan is de status "verlopen").
    pub fn is_auth(&self) -> bool {
        matches!(self, ConnectError::Unauthorized | ConnectError::Expired)
    }
}

impl Serialize for ConnectError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.code())
    }
}

/// Zet een HTTP-status om in een fout (of `None` bij een succesvolle status).
pub fn from_status(status: u16) -> Option<ConnectError> {
    match status {
        200..=299 => None,
        401 => Some(ConnectError::Unauthorized),
        403 => Some(ConnectError::Forbidden),
        429 => Some(ConnectError::RateLimited),
        _ => Some(ConnectError::Unexpected),
    }
}
