use super::check;
use crate::connect::error::ConnectError;
use crate::connect::http::{Http, Request};
use crate::connect::provider::{Account, Links, OauthKind, Provider};

pub struct GitHub;

impl Provider for GitHub {
    fn id(&self) -> &'static str {
        "github"
    }
    fn rights(&self) -> &'static [&'static str] {
        &["repo"]
    }
    fn functions(&self) -> &'static [&'static str] {
        &["backup"]
    }
    fn hosts(&self) -> &'static [&'static str] {
        &["github.com", "api.github.com"]
    }
    fn links(&self) -> Links {
        Links { signup: "https://github.com/signup", token_page: "https://github.com/settings/tokens/new", manage: "https://github.com/settings/applications" }
    }
    fn oauth(&self) -> Option<OauthKind> {
        // Device flow: geen client-geheim nodig. "repo" is nodig voor een privé-kopie van het project.
        Some(OauthKind::Device { device_url: "https://github.com/login/device/code", token_url: "https://github.com/login/oauth/access_token", scope: "repo" })
    }
    fn verify(&self, http: &dyn Http, token: &str) -> Result<Account, ConnectError> {
        let resp = http.send(
            Request::get("https://api.github.com/user")
                .bearer(token)
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .header("User-Agent", "Studio"),
        )?;
        check(&resp)?;
        let name = resp.json().and_then(|v| v["login"].as_str().map(String::from)).ok_or(ConnectError::Unexpected)?;
        Ok(Account { name })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connect::http::MockHttp;

    #[test]
    fn haalt_de_accountnaam_op_en_vertaalt_fouten() {
        assert_eq!(GitHub.verify(&MockHttp::new(vec![MockHttp::ok(200, r#"{"login":"pieter"}"#)]), "t").unwrap().name, "pieter");
        assert_eq!(GitHub.verify(&MockHttp::new(vec![MockHttp::ok(401, "{}")]), "t").err(), Some(ConnectError::Unauthorized));
        assert_eq!(GitHub.verify(&MockHttp::new(vec![MockHttp::ok(403, "{}")]), "t").err(), Some(ConnectError::Forbidden));
        assert_eq!(GitHub.verify(&MockHttp::new(vec![MockHttp::ok(429, "{}")]), "t").err(), Some(ConnectError::RateLimited));
        assert_eq!(GitHub.verify(&MockHttp::new(vec![Err(ConnectError::Timeout)]), "t").err(), Some(ConnectError::Timeout));
    }
}
