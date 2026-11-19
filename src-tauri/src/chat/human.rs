use super::events::ErrorCode;

/// Vertaalt een foutcategorie van de CLI (`authentication_failed`, `rate_limit`, …) naar onze code.
pub fn from_category(cat: &str) -> ErrorCode {
    match cat {
        "authentication_failed" | "oauth_org_not_allowed" | "cloud_credential_error" => {
            ErrorCode::NotLoggedIn
        }
        "rate_limit" => ErrorCode::RateLimit,
        "overloaded" | "server_error" => ErrorCode::Overloaded,
        "billing_error" | "account_on_hold" => ErrorCode::Billing,
        "model_not_found" => ErrorCode::ModelNotFound,
        _ => ErrorCode::Unknown,
    }
}

/// Raadt een foutcode uit vrije tekst (stderr, `result`-tekst).
pub fn classify_text(text: &str) -> ErrorCode {
    let t = text.to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| t.contains(n));
    if has(&[
        "not logged in",
        "please run /login",
        "invalid api key",
        "authentication",
        "unauthorized",
        "401",
        "log in",
    ]) {
        ErrorCode::NotLoggedIn
    } else if has(&[
        "rate limit",
        "rate_limit",
        "429",
        "usage limit",
        "too many requests",
    ]) {
        ErrorCode::RateLimit
    } else if has(&[
        "overloaded",
        "529",
        "503",
        "temporarily unavailable",
        "server error",
    ]) {
        ErrorCode::Overloaded
    } else if has(&["billing", "credit balance", "payment", "account on hold"]) {
        ErrorCode::Billing
    } else if has(&[
        "enotfound",
        "econnrefused",
        "econnreset",
        "etimedout",
        "network",
        "fetch failed",
        "getaddrinfo",
        "offline",
    ]) {
        ErrorCode::Network
    } else if has(&["model not found", "model_not_found"]) {
        ErrorCode::ModelNotFound
    } else {
        ErrorCode::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categorieen_en_vrije_tekst() {
        assert_eq!(
            from_category("authentication_failed"),
            ErrorCode::NotLoggedIn
        );
        assert_eq!(from_category("rate_limit"), ErrorCode::RateLimit);
        assert_eq!(from_category("overloaded"), ErrorCode::Overloaded);
        assert_eq!(from_category("iets nieuws"), ErrorCode::Unknown);
        assert_eq!(
            classify_text("Invalid API key · Please run /login"),
            ErrorCode::NotLoggedIn
        );
        assert_eq!(
            classify_text("Error: 429 Too Many Requests"),
            ErrorCode::RateLimit
        );
        assert_eq!(
            classify_text("getaddrinfo ENOTFOUND api.anthropic.com"),
            ErrorCode::Network
        );
        assert_eq!(classify_text("rare fout"), ErrorCode::Unknown);
    }
}
