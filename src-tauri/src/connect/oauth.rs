//! OAuth met PKCE en een terugkeeradres op de eigen computer (`oauth_loopback_pkce`), plus het verversen van tokens.
//! Zonder client-geheim: alleen de publieke client-ID en de PKCE-verifier.
use super::error::{from_status, ConnectError};
use super::http::{Body, Http, Request};
use super::tokens::{parse_token_reply, TokenReply, TokenSet};

#[derive(Debug, Clone)]
pub struct LoopbackSpec {
    pub authorize_url: String,
    pub token_url: String,
    pub client_id: String,
    pub scope: String,
    /// 0 = een willekeurige vrije poort; anders een vaste (voor diensten die een exact terugkeeradres eisen).
    pub port: u16,
}

pub fn enc(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

pub fn authorize_url(spec: &LoopbackSpec, redirect_uri: &str, state: &str, challenge: &str) -> String {
    format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
        spec.authorize_url,
        enc(&spec.client_id),
        enc(redirect_uri),
        enc(&spec.scope),
        enc(state),
        enc(challenge)
    )
}

fn token_call(http: &dyn Http, url: &str, form: Vec<(String, String)>, now: i64) -> Result<TokenSet, ConnectError> {
    let resp = http.send(Request::post(url, Body::Form(form)).header("Accept", "application/json"))?;
    if resp.status == 429 || resp.status >= 500 {
        return Err(from_status(resp.status).unwrap_or(ConnectError::Unexpected));
    }
    match parse_token_reply(&resp.body, now)? {
        TokenReply::Token(t) => Ok(t),
        TokenReply::Error(e) => Err(match e.as_str() {
            "access_denied" => ConnectError::Denied,
            "invalid_grant" | "bad_refresh_token" | "bad_verification_code" | "expired_token" => ConnectError::Expired,
            "invalid_client" | "incorrect_client_credentials" => ConnectError::Unexpected,
            _ => ConnectError::Unexpected,
        }),
    }
}

pub fn exchange_code(http: &dyn Http, spec: &LoopbackSpec, code: &str, redirect_uri: &str, verifier: &str, now: i64) -> Result<TokenSet, ConnectError> {
    token_call(
        http,
        &spec.token_url,
        vec![
            ("grant_type".into(), "authorization_code".into()),
            ("code".into(), code.into()),
            ("redirect_uri".into(), redirect_uri.into()),
            ("client_id".into(), spec.client_id.clone()),
            ("code_verifier".into(), verifier.into()),
        ],
        now,
    )
}

/// Ververst met het refresh-token. Een refresh-token is vaak eenmalig: het nieuwe wordt bewaard (of het oude, als er geen nieuw komt).
pub fn refresh_token(http: &dyn Http, token_url: &str, client_id: &str, refresh: &str, now: i64) -> Result<TokenSet, ConnectError> {
    let mut t = token_call(
        http,
        token_url,
        vec![("grant_type".into(), "refresh_token".into()), ("refresh_token".into(), refresh.into()), ("client_id".into(), client_id.into())],
        now,
    )?;
    if t.refresh.is_none() {
        t.refresh = Some(refresh.to_string());
    }
    Ok(t)
}

#[cfg(test)]
mod tests {
    use super::super::http::MockHttp;
    use super::*;

    fn spec() -> LoopbackSpec {
        LoopbackSpec { authorize_url: "https://dienst.example/authorize".into(), token_url: "https://dienst.example/token".into(), client_id: "cid".into(), scope: "a b".into(), port: 0 }
    }

    #[test]
    fn de_inlog_url_heeft_pkce_state_en_een_correct_terugkeeradres() {
        let u = authorize_url(&spec(), "http://127.0.0.1:5000/callback", "st&te", "CH");
        assert!(u.starts_with("https://dienst.example/authorize?response_type=code&client_id=cid"));
        assert!(u.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A5000%2Fcallback"));
        assert!(u.contains("scope=a%20b") && u.contains("state=st%26te"));
        assert!(u.ends_with("code_challenge=CH&code_challenge_method=S256"));
    }

    #[test]
    fn code_inwisselen_slaagt_en_faalt_netjes() {
        let ok = MockHttp::new(vec![MockHttp::ok(200, r#"{"access_token":"a","refresh_token":"r","expires_in":3600}"#)]);
        let t = exchange_code(&ok, &spec(), "c", "http://127.0.0.1:1/callback", "v", 100).unwrap();
        assert_eq!((t.access.as_str(), t.refresh.as_deref(), t.expires_at), ("a", Some("r"), Some(3700)));
        assert_eq!(exchange_code(&MockHttp::new(vec![MockHttp::ok(200, r#"{"error":"access_denied"}"#)]), &spec(), "c", "u", "v", 0).unwrap_err(), ConnectError::Denied);
        assert_eq!(exchange_code(&MockHttp::new(vec![MockHttp::ok(429, "")]), &spec(), "c", "u", "v", 0).unwrap_err(), ConnectError::RateLimited);
        assert_eq!(exchange_code(&MockHttp::new(vec![Err(ConnectError::Timeout)]), &spec(), "c", "u", "v", 0).unwrap_err(), ConnectError::Timeout);
    }

    #[test]
    fn verversen_slaagt_en_houdt_het_oude_refresh_token_als_er_geen_nieuw_komt() {
        let ok = MockHttp::new(vec![MockHttp::ok(200, r#"{"access_token":"nieuw","expires_in":60}"#)]);
        let t = refresh_token(&ok, "https://dienst.example/token", "cid", "oud", 10).unwrap();
        assert_eq!((t.access.as_str(), t.refresh.as_deref(), t.expires_at), ("nieuw", Some("oud"), Some(70)));
    }

    #[test]
    fn verversen_faalt_met_een_verlopen_refresh_token() {
        let bad = MockHttp::new(vec![MockHttp::ok(200, r#"{"error":"bad_refresh_token"}"#)]);
        assert_eq!(refresh_token(&bad, "https://dienst.example/token", "cid", "x", 0).unwrap_err(), ConnectError::Expired);
        let off = MockHttp::new(vec![Err(ConnectError::Offline)]);
        assert_eq!(refresh_token(&off, "https://dienst.example/token", "cid", "x", 0).unwrap_err(), ConnectError::Offline);
    }
}
