use super::check;
use crate::connect::error::ConnectError;
use crate::connect::http::{Http, Request};
use crate::connect::provider::{Account, Links, Provider};

pub struct Vercel;

impl Provider for Vercel {
    fn id(&self) -> &'static str {
        "vercel"
    }
    fn rights(&self) -> &'static [&'static str] {
        &["projecten"]
    }
    fn functions(&self) -> &'static [&'static str] {
        &["onlinezetten"]
    }
    fn hosts(&self) -> &'static [&'static str] {
        &["api.vercel.com"]
    }
    fn links(&self) -> Links {
        Links { signup: "https://vercel.com/signup", token_page: "https://vercel.com/account/tokens", manage: "https://vercel.com/account/tokens" }
    }
    // Geen OAuth: "Sign in with Vercel" vraagt een client-geheim en geeft alleen identiteitsrechten (docs/koppelingen.md).
    fn verify(&self, http: &dyn Http, token: &str) -> Result<Account, ConnectError> {
        let resp = http.send(Request::get("https://api.vercel.com/v2/user").bearer(token))?;
        if resp.status == 200 {
            if let Some(v) = resp.json() {
                let u = &v["user"];
                if let Some(n) = ["username", "name", "email"].iter().find_map(|k| u[*k].as_str().filter(|s| !s.is_empty())) {
                    return Ok(Account { name: n.to_string() });
                }
            }
        }
        if matches!(resp.status, 401 | 403 | 429) {
            check(&resp)?;
        }
        // Terugval: het token werkt als de lijst met projecten opvraagbaar is (bevestigd in de documentatie).
        let resp = http.send(Request::get("https://api.vercel.com/v10/projects?limit=1").bearer(token))?;
        check(&resp)?;
        Ok(Account { name: "Vercel".into() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connect::http::MockHttp;

    #[test]
    fn naam_uit_de_gebruiker_of_terugval_op_de_projectenlijst() {
        assert_eq!(Vercel.verify(&MockHttp::new(vec![MockHttp::ok(200, r#"{"user":{"username":"joke"}}"#)]), "t").unwrap().name, "joke");
        let terugval = MockHttp::new(vec![MockHttp::ok(404, "{}"), MockHttp::ok(200, r#"{"projects":[]}"#)]);
        assert_eq!(Vercel.verify(&terugval, "t").unwrap().name, "Vercel");
        assert_eq!(Vercel.verify(&MockHttp::new(vec![MockHttp::ok(401, "{}")]), "t").err(), Some(ConnectError::Unauthorized));
        assert_eq!(Vercel.verify(&MockHttp::new(vec![MockHttp::ok(403, "{}")]), "t").err(), Some(ConnectError::Forbidden));
    }

    #[test]
    fn geen_oauth_dus_altijd_token_plakken() {
        assert!(Vercel.oauth().is_none());
    }
}
