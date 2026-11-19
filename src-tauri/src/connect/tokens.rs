//! De toegang die een dienst uitgeeft. Dit hele ding staat uitsluitend in de kluis (als JSON onder één sleutel).
use super::error::ConnectError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TokenSet {
    pub access: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh: Option<String>,
    /// Tijdstip (seconden sinds 1970) waarop de toegang verloopt; `None` = verloopt niet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
}

// Per ongeluk loggen met {:?} mag nooit een token laten zien.
impl std::fmt::Debug for TokenSet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TokenSet").field("access", &"***").field("refresh", &self.refresh.as_ref().map(|_| "***")).field("expires_at", &self.expires_at).finish()
    }
}

impl TokenSet {
    pub fn plain(access: &str) -> Self {
        Self { access: access.to_string(), refresh: None, expires_at: None }
    }
    pub fn needs_refresh(&self, now: i64, margin: i64) -> bool {
        self.refresh.is_some() && self.expires_at.is_some_and(|e| e - margin <= now)
    }
    pub fn is_expired(&self, now: i64) -> bool {
        self.expires_at.is_some_and(|e| e <= now)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum TokenReply {
    Token(TokenSet),
    /// De foutcode van de dienst, zoals `authorization_pending` of `access_denied`.
    Error(String),
}

/// Leest een antwoord van een token-eindpunt (JSON). Onleesbaar of zonder token = fout `onverwacht`.
pub fn parse_token_reply(body: &str, now: i64) -> Result<TokenReply, ConnectError> {
    let v: serde_json::Value = serde_json::from_str(body).map_err(|_| ConnectError::Unexpected)?;
    if let Some(e) = v["error"].as_str() {
        return Ok(TokenReply::Error(e.to_string()));
    }
    let access = v["access_token"].as_str().filter(|s| !s.is_empty()).ok_or(ConnectError::Unexpected)?;
    Ok(TokenReply::Token(TokenSet {
        access: access.to_string(),
        refresh: v["refresh_token"].as_str().filter(|s| !s.is_empty()).map(String::from),
        expires_at: v["expires_in"].as_i64().filter(|n| *n > 0).map(|n| now + n),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leest_token_met_en_zonder_verversing() {
        let r = parse_token_reply(r#"{"access_token":"a","refresh_token":"r","expires_in":28800}"#, 1000).unwrap();
        assert_eq!(r, TokenReply::Token(TokenSet { access: "a".into(), refresh: Some("r".into()), expires_at: Some(29800) }));
        assert_eq!(parse_token_reply(r#"{"access_token":"a","token_type":"bearer"}"#, 1).unwrap(), TokenReply::Token(TokenSet::plain("a")));
        assert_eq!(parse_token_reply(r#"{"error":"authorization_pending"}"#, 1).unwrap(), TokenReply::Error("authorization_pending".into()));
        assert!(parse_token_reply("geen json", 1).is_err());
        assert!(parse_token_reply(r#"{"access_token":""}"#, 1).is_err());
    }

    #[test]
    fn debug_toont_geen_geheimen() {
        let t = TokenSet { access: "SUPERGEHEIM".into(), refresh: Some("OOKGEHEIM".into()), expires_at: None };
        let s = format!("{t:?}");
        assert!(!s.contains("SUPERGEHEIM") && !s.contains("OOKGEHEIM"));
    }

    #[test]
    fn verversen_en_verlopen() {
        let t = TokenSet { access: "a".into(), refresh: Some("r".into()), expires_at: Some(1000) };
        assert!(!t.needs_refresh(900, 60));
        assert!(t.needs_refresh(950, 60));
        assert!(!t.is_expired(999) && t.is_expired(1000));
        assert!(!TokenSet::plain("a").needs_refresh(i64::MAX - 100, 60));
    }
}
