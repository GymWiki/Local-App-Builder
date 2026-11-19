//! OAuth device flow (GitHub): de gebruiker typt een code op de pagina van de dienst; Studio wacht tot dat gelukt is.
//! Er is geen client-geheim nodig. De `device_code` blijft in Rust; de app krijgt alleen de `user_code` te zien.
use super::error::{from_status, ConnectError};
use super::http::{Body, Http, Request};
use super::tokens::{parse_token_reply, TokenReply, TokenSet};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct DeviceSpec {
    pub device_url: String,
    pub token_url: String,
    pub client_id: String,
    pub scope: String,
}

/// Wat de app mag laten zien.
#[derive(Debug, Clone, Serialize)]
pub struct DeviceInfo {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
}

pub struct DeviceCode {
    pub device_code: String,
    pub info: DeviceInfo,
    pub interval: u64,
}

pub fn request_code(http: &dyn Http, spec: &DeviceSpec) -> Result<DeviceCode, ConnectError> {
    let req = Request::post(&spec.device_url, Body::Form(vec![("client_id".into(), spec.client_id.clone()), ("scope".into(), spec.scope.clone())])).header("Accept", "application/json");
    let resp = http.send(req)?;
    if let Some(e) = from_status(resp.status) {
        return Err(if resp.status == 404 || resp.status == 400 { ConnectError::Unexpected } else { e });
    }
    let v = resp.json().ok_or(ConnectError::Unexpected)?;
    if v["error"].as_str() == Some("device_flow_disabled") {
        return Err(ConnectError::Unexpected);
    }
    let text = |k: &str| v[k].as_str().filter(|s| !s.is_empty()).map(String::from).ok_or(ConnectError::Unexpected);
    Ok(DeviceCode {
        device_code: text("device_code")?,
        interval: v["interval"].as_u64().unwrap_or(5).clamp(1, 60),
        info: DeviceInfo { user_code: text("user_code")?, verification_uri: text("verification_uri")?, expires_in: v["expires_in"].as_u64().unwrap_or(900) },
    })
}

/// Vraagt telkens of de gebruiker toestemming heeft gegeven. `sleep` is een parameter zodat tests niet hoeven te wachten.
pub fn poll(http: &dyn Http, spec: &DeviceSpec, dc: &DeviceCode, now: &dyn Fn() -> i64, sleep: &dyn Fn(Duration), cancel: &AtomicBool) -> Result<TokenSet, ConnectError> {
    let mut interval = dc.interval;
    let mut waited = 0u64;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(ConnectError::Cancelled);
        }
        if waited >= dc.info.expires_in {
            return Err(ConnectError::Expired);
        }
        sleep(Duration::from_secs(interval));
        waited += interval;
        if cancel.load(Ordering::SeqCst) {
            return Err(ConnectError::Cancelled);
        }
        let req = Request::post(
            &spec.token_url,
            Body::Form(vec![
                ("client_id".into(), spec.client_id.clone()),
                ("device_code".into(), dc.device_code.clone()),
                ("grant_type".into(), "urn:ietf:params:oauth:grant-type:device_code".into()),
            ]),
        )
        .header("Accept", "application/json");
        let resp = match http.send(req) {
            Ok(r) => r,
            Err(ConnectError::Timeout) => continue, // een haperende verbinding is geen reden om op te geven
            Err(e) => return Err(e),
        };
        if resp.status == 429 {
            interval += 5;
            continue;
        }
        match parse_token_reply(&resp.body, now())? {
            TokenReply::Token(t) => return Ok(t),
            TokenReply::Error(e) => match e.as_str() {
                "authorization_pending" => {}
                "slow_down" => interval += 5,
                "expired_token" | "token_expired" => return Err(ConnectError::Expired),
                "access_denied" => return Err(ConnectError::Denied),
                _ => return Err(ConnectError::Unexpected),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::http::MockHttp;
    use super::*;
    use std::cell::RefCell;

    fn spec() -> DeviceSpec {
        DeviceSpec { device_url: "https://github.com/login/device/code".into(), token_url: "https://github.com/login/oauth/access_token".into(), client_id: "cid".into(), scope: "repo".into() }
    }
    fn code(expires: u64) -> DeviceCode {
        DeviceCode { device_code: "DC".into(), interval: 5, info: DeviceInfo { user_code: "ABCD-1234".into(), verification_uri: "https://github.com/login/device".into(), expires_in: expires } }
    }

    #[test]
    fn vraagt_een_code_en_houdt_de_device_code_privé() {
        let http = MockHttp::new(vec![MockHttp::ok(200, r#"{"device_code":"GEHEIM","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}"#)]);
        let dc = request_code(&http, &spec()).unwrap();
        assert_eq!(dc.info.user_code, "ABCD-1234");
        assert!(!serde_json::to_string(&dc.info).unwrap().contains("GEHEIM"));
    }

    #[test]
    fn wacht_tot_toestemming_en_geeft_dan_het_token() {
        let http = MockHttp::new(vec![
            MockHttp::ok(200, r#"{"error":"authorization_pending"}"#),
            MockHttp::ok(200, r#"{"error":"slow_down"}"#),
            MockHttp::ok(200, r#"{"access_token":"token-x","token_type":"bearer"}"#),
        ]);
        let slaap = RefCell::new(vec![]);
        let t = poll(&http, &spec(), &code(900), &|| 0, &|d| slaap.borrow_mut().push(d.as_secs()), &AtomicBool::new(false)).unwrap();
        assert_eq!(t.access, "token-x");
        assert_eq!(*slaap.borrow(), vec![5, 5, 10]); // na slow_down 5 seconden langer
    }

    #[test]
    fn geweigerd_verlopen_en_geannuleerd() {
        let nee = MockHttp::new(vec![MockHttp::ok(200, r#"{"error":"access_denied"}"#)]);
        assert_eq!(poll(&nee, &spec(), &code(900), &|| 0, &|_| {}, &AtomicBool::new(false)).unwrap_err(), ConnectError::Denied);
        let verlopen = MockHttp::new(vec![MockHttp::ok(200, r#"{"error":"expired_token"}"#)]);
        assert_eq!(poll(&verlopen, &spec(), &code(900), &|| 0, &|_| {}, &AtomicBool::new(false)).unwrap_err(), ConnectError::Expired);
        let niets = MockHttp::new(vec![]);
        assert_eq!(poll(&niets, &spec(), &code(900), &|| 0, &|_| {}, &AtomicBool::new(true)).unwrap_err(), ConnectError::Cancelled);
    }

    #[test]
    fn stopt_als_de_tijd_om_is() {
        let http = MockHttp::new((0..20).map(|_| MockHttp::ok(200, r#"{"error":"authorization_pending"}"#)).collect());
        assert_eq!(poll(&http, &spec(), &code(12), &|| 0, &|_| {}, &AtomicBool::new(false)).unwrap_err(), ConnectError::Expired);
    }

    #[test]
    fn time_out_van_een_verzoek_wordt_opnieuw_geprobeerd_maar_geen_internet_stopt() {
        let http = MockHttp::new(vec![Err(ConnectError::Timeout), MockHttp::ok(200, r#"{"access_token":"t"}"#)]);
        assert!(poll(&http, &spec(), &code(900), &|| 0, &|_| {}, &AtomicBool::new(false)).is_ok());
        let off = MockHttp::new(vec![Err(ConnectError::Offline)]);
        assert_eq!(poll(&off, &spec(), &code(900), &|| 0, &|_| {}, &AtomicBool::new(false)).unwrap_err(), ConnectError::Offline);
    }

    #[test]
    fn te_veel_verzoeken_vertraagt() {
        let http = MockHttp::new(vec![MockHttp::ok(429, "{}"), MockHttp::ok(200, r#"{"access_token":"t"}"#)]);
        let slaap = RefCell::new(vec![]);
        poll(&http, &spec(), &code(900), &|| 0, &|d| slaap.borrow_mut().push(d.as_secs()), &AtomicBool::new(false)).unwrap();
        assert_eq!(*slaap.borrow(), vec![5, 10]);
    }

    #[test]
    fn de_code_aanvraag_geeft_fouten_in_gewone_codes() {
        assert_eq!(request_code(&MockHttp::new(vec![MockHttp::ok(429, "{}")]), &spec()).err(), Some(ConnectError::RateLimited));
        assert_eq!(request_code(&MockHttp::new(vec![Err(ConnectError::Offline)]), &spec()).err(), Some(ConnectError::Offline));
        assert_eq!(request_code(&MockHttp::new(vec![MockHttp::ok(200, r#"{"error":"device_flow_disabled"}"#)]), &spec()).err(), Some(ConnectError::Unexpected));
    }
}
