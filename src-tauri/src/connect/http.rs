//! Uitgaande verbindingen voor koppelingen. Alleen https naar een vaste lijst officiële hosts; verder niets.
//! De frontend doet zelf nooit verzoeken naar diensten: alles loopt via deze laag, zodat tokens in Rust blijven.
use super::error::ConnectError;
#[cfg(test)]
use std::sync::Mutex;
use std::time::Duration;

pub enum Body {
    None,
    Form(Vec<(String, String)>),
    Json(String),
    /// Ruwe bytes met een eigen type (bijvoorbeeld een multipart-formulier voor een edge function).
    Bytes { content_type: String, data: Vec<u8> },
}

pub struct Request {
    pub method: &'static str,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Body,
}

impl Request {
    pub fn get(url: impl Into<String>) -> Self {
        Self { method: "GET", url: url.into(), headers: vec![], body: Body::None }
    }
    pub fn post(url: impl Into<String>, body: Body) -> Self {
        Self { method: "POST", url: url.into(), headers: vec![], body }
    }
    pub fn with(method: &'static str, url: impl Into<String>, body: Body) -> Self {
        Self { method, url: url.into(), headers: vec![], body }
    }
    pub fn header(mut self, k: &str, v: impl Into<String>) -> Self {
        self.headers.push((k.to_string(), v.into()));
        self
    }
    pub fn bearer(self, token: &str) -> Self {
        self.header("Authorization", format!("Bearer {token}"))
    }
}

#[derive(Debug, Clone)]
pub struct Response {
    pub status: u16,
    pub body: String,
}

impl Response {
    pub fn json(&self) -> Option<serde_json::Value> {
        serde_json::from_str(&self.body).ok()
    }
}

pub trait Http: Send + Sync {
    fn send(&self, req: Request) -> Result<Response, ConnectError>;
}

/// De host uit een URL (`https://api.github.com/user` → `api.github.com`), zonder gebruikersnaam, poort of pad.
pub fn host_of(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    if authority.contains('@') {
        return None; // https://api.github.com@evil.example/ is een truc
    }
    let host = authority.split(':').next()?.to_ascii_lowercase();
    (!host.is_empty()).then_some(host)
}

/// Staat de URL op de lijst? Een vermelding met een punt vooraan (`.supabase.co`) staat ook subdomeinen toe.
pub fn is_allowed(url: &str, allowed: &[&str]) -> bool {
    let Some(host) = host_of(url) else { return false };
    allowed.iter().any(|a| if let Some(suffix) = a.strip_prefix('.') { host.ends_with(&format!(".{suffix}")) } else { host == *a })
}

/// De echte verbinding (ureq met rustls). Time-out van 20 seconden; geen automatische doorverwijzing naar andere hosts.
pub struct UreqHttp {
    allowed: Vec<&'static str>,
    agent: ureq::Agent,
}

impl UreqHttp {
    pub fn new(allowed: Vec<&'static str>) -> Self {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(20)))
            .http_status_as_error(false)
            .max_redirects(0)
            .build()
            .into();
        Self { allowed, agent }
    }
}

fn map_err(e: ureq::Error) -> ConnectError {
    match e {
        ureq::Error::Timeout(_) => ConnectError::Timeout,
        ureq::Error::HostNotFound | ureq::Error::ConnectionFailed | ureq::Error::Io(_) => ConnectError::Offline,
        _ => ConnectError::Unexpected,
    }
}

impl Http for UreqHttp {
    fn send(&self, req: Request) -> Result<Response, ConnectError> {
        if !is_allowed(&req.url, &self.allowed) {
            return Err(ConnectError::Blocked);
        }
        let apply = |mut b: ureq::RequestBuilder<ureq::typestate::WithoutBody>| {
            for (k, v) in &req.headers {
                b = b.header(k.as_str(), v.as_str());
            }
            b
        };
        let apply_body = |mut b: ureq::RequestBuilder<ureq::typestate::WithBody>| {
            for (k, v) in &req.headers {
                b = b.header(k.as_str(), v.as_str());
            }
            b
        };
        let result = match (req.method, &req.body) {
            ("GET", _) => apply(self.agent.get(&req.url)).call(),
            ("DELETE", Body::None) => apply(self.agent.delete(&req.url)).call(),
            ("DELETE", Body::Json(j)) => apply_body(self.agent.delete(&req.url).force_send_body()).content_type("application/json").send(j.as_str()),
            ("PATCH", Body::Json(j)) => apply_body(self.agent.patch(&req.url)).content_type("application/json").send(j.as_str()),
            ("POST", Body::Bytes { content_type, data }) => apply_body(self.agent.post(&req.url)).content_type(content_type.as_str()).send(data.as_slice()),
            ("POST", Body::None) => apply_body(self.agent.post(&req.url)).send_empty(),
            ("POST", Body::Form(f)) => {
                let pairs: Vec<(&str, &str)> = f.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
                apply_body(self.agent.post(&req.url)).send_form(pairs)
            }
            ("POST", Body::Json(j)) => apply_body(self.agent.post(&req.url)).content_type("application/json").send(j.as_str()),
            _ => return Err(ConnectError::Unexpected),
        };
        let mut resp = result.map_err(map_err)?;
        let status = resp.status().as_u16();
        let body = resp.body_mut().read_to_string().map_err(map_err)?;
        Ok(Response { status, body })
    }
}

#[cfg(test)]
/// Een nagebootste verbinding voor tests: antwoorden in volgorde, en een logboek van de verzoeken (zonder tokens te bewaren in de log van de app).
pub struct MockHttp {
    replies: Mutex<std::collections::VecDeque<Result<Response, ConnectError>>>,
    pub seen: Mutex<Vec<(String, String)>>,
}

#[cfg(test)]
impl MockHttp {
    pub fn new(replies: Vec<Result<Response, ConnectError>>) -> Self {
        Self { replies: Mutex::new(replies.into()), seen: Mutex::new(vec![]) }
    }
    pub fn ok(status: u16, body: &str) -> Result<Response, ConnectError> {
        Ok(Response { status, body: body.to_string() })
    }
}

#[cfg(test)]
impl Http for MockHttp {
    fn send(&self, req: Request) -> Result<Response, ConnectError> {
        self.seen.lock().unwrap().push((req.method.to_string(), req.url.clone()));
        self.replies.lock().unwrap().pop_front().unwrap_or(Err(ConnectError::Unexpected))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosts_worden_strikt_gelezen() {
        assert_eq!(host_of("https://api.github.com/user").as_deref(), Some("api.github.com"));
        assert_eq!(host_of("https://API.GitHub.com:443/x?y=1").as_deref(), Some("api.github.com"));
        assert_eq!(host_of("http://api.github.com/"), None); // alleen https
        assert_eq!(host_of("https://api.github.com@evil.example/"), None);
        assert_eq!(host_of("https:///pad"), None);
    }

    #[test]
    fn alleen_toegestane_hosts() {
        let lijst = ["api.github.com", ".supabase.co"];
        assert!(is_allowed("https://api.github.com/user", &lijst));
        assert!(is_allowed("https://abc.supabase.co/rest", &lijst));
        assert!(!is_allowed("https://supabase.co/", &lijst)); // zonder subdomein hoort niet bij ".supabase.co"
        assert!(!is_allowed("https://evil-api.github.com.evil.example/", &lijst));
        assert!(!is_allowed("https://example.com/", &lijst));
        assert!(!is_allowed("https://api.github.com.evil.example/", &lijst));
    }

    #[test]
    fn een_niet_toegestane_host_wordt_geblokkeerd_voordat_er_iets_wordt_verstuurd() {
        let http = UreqHttp::new(vec!["api.github.com"]);
        assert_eq!(http.send(Request::get("https://example.com/")).unwrap_err(), ConnectError::Blocked);
        assert_eq!(http.send(Request::get("http://api.github.com/")).unwrap_err(), ConnectError::Blocked);
    }
}
