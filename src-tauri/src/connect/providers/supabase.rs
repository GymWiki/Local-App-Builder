use super::check;
use crate::connect::error::ConnectError;
use crate::connect::http::{Http, Request};
use crate::connect::provider::{Account, Links, Provider};

pub struct Supabase;

impl Provider for Supabase {
    fn id(&self) -> &'static str {
        "supabase"
    }
    fn rights(&self) -> &'static [&'static str] {
        &["account"]
    }
    fn functions(&self) -> &'static [&'static str] {
        &["gegevens"]
    }
    fn hosts(&self) -> &'static [&'static str] {
        &["api.supabase.com"]
    }
    fn links(&self) -> Links {
        Links { signup: "https://supabase.com/dashboard/sign-up", token_page: "https://supabase.com/dashboard/account/tokens", manage: "https://supabase.com/dashboard/account/tokens" }
    }
    // Geen OAuth: de Management API vraagt een client-geheim bij het token-eindpunt (docs/supabase.md).
    fn verify(&self, http: &dyn Http, token: &str) -> Result<Account, ConnectError> {
        let resp = http.send(Request::get("https://api.supabase.com/v1/organizations").bearer(token))?;
        check(&resp)?;
        let name = resp.json().and_then(|v| v.as_array().and_then(|a| a.first().and_then(|o| o["name"].as_str().map(String::from))));
        Ok(Account { name: name.unwrap_or_else(|| "Supabase".into()) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connect::http::MockHttp;

    #[test]
    fn naam_van_de_eerste_organisatie() {
        assert_eq!(Supabase.verify(&MockHttp::new(vec![MockHttp::ok(200, r#"[{"id":"1","name":"Mijn bedrijf","slug":"mijn"}]"#)]), "t").unwrap().name, "Mijn bedrijf");
        assert_eq!(Supabase.verify(&MockHttp::new(vec![MockHttp::ok(200, "[]")]), "t").unwrap().name, "Supabase");
        assert_eq!(Supabase.verify(&MockHttp::new(vec![MockHttp::ok(401, "{}")]), "t").err(), Some(ConnectError::Unauthorized));
        assert_eq!(Supabase.verify(&MockHttp::new(vec![MockHttp::ok(429, "{}")]), "t").err(), Some(ConnectError::RateLimited));
    }
}
