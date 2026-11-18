//! De Management API van Supabase (https://api.supabase.com). Alles gaat met het token uit de kluis (via `Manager::authorized`);
//! sleutels en wachtwoorden worden nooit teruggegeven en uit foutmeldingen geschrapt.
use crate::connect::error::ConnectError;
use crate::connect::http::{Body, Http, Request};
use serde_json::{json, Value};

const BASE: &str = "https://api.supabase.com";
/// Antwoorden worden afgekapt, zodat een enorme uitvoer de AI of het venster niet overspoelt.
pub const MAX_REPLY_CHARS: usize = 20_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SupaError {
    Connect(ConnectError),
    /// Het project is gepauzeerd (gratis plan, te weinig activiteit).
    Paused,
    /// Een limiet van het plan (bijvoorbeeld het aantal gratis projecten).
    PlanLimit,
    NotFound,
    /// Een fout in de SQL zelf (al schoongemaakt).
    Sql(String),
    Unexpected,
}

impl SupaError {
    pub fn code(&self) -> String {
        match self {
            SupaError::Connect(c) => c.code(),
            SupaError::Paused => "gepauzeerd".into(),
            SupaError::PlanLimit => "plan_limiet".into(),
            SupaError::NotFound => "niet_gevonden".into(),
            SupaError::Sql(_) => "sql_fout".into(),
            SupaError::Unexpected => "onverwacht".into(),
        }
    }
    /// Een korte, schone toelichting voor de gebruiker of de AI (alleen bij SQL-fouten).
    pub fn detail(&self) -> Option<&str> {
        match self {
            SupaError::Sql(m) => Some(m),
            _ => None,
        }
    }
}

impl From<ConnectError> for SupaError {
    fn from(c: ConnectError) -> Self {
        SupaError::Connect(c)
    }
}

impl serde::Serialize for SupaError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.code())
    }
}

/// Schrapt geheimen uit tekst: bekende waarden (wachtwoord, token), Supabase-sleutels (`sbp_…`, `sb_secret_…`) en JWT's.
pub fn scrub(text: &str, secrets: &[&str]) -> String {
    let mut out = text.to_string();
    for s in secrets.iter().filter(|s| s.len() >= 6) {
        out = out.replace(s, "***");
    }
    let mut res = String::with_capacity(out.len());
    let mut word = String::new();
    let flush = |w: &mut String, res: &mut String| {
        let l = w.to_lowercase();
        let jwt = w.starts_with("eyJ") && w.matches('.').count() >= 2;
        if l.starts_with("sbp_") || l.starts_with("sb_secret_") || l.starts_with("sbp-") || jwt {
            res.push_str("***");
        } else {
            res.push_str(w);
        }
        w.clear();
    };
    for c in out.chars() {
        if c.is_alphanumeric() || matches!(c, '_' | '-' | '.') {
            word.push(c);
        } else {
            flush(&mut word, &mut res);
            res.push(c);
        }
    }
    flush(&mut word, &mut res);
    res
}

fn clip(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let mut t: String = s.chars().take(n).collect();
        t.push('…');
        t
    }
}

pub struct Client<'a> {
    pub http: &'a dyn Http,
    pub token: &'a str,
    /// Extra geheimen die nooit in een antwoord of fout mogen staan (bijvoorbeeld het databasewachtwoord).
    pub secrets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Org {
    pub slug: String,
    pub name: String,
    pub plan: Option<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Proj {
    pub reference: String,
    pub name: String,
    pub region: String,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PublicKeys {
    pub publishable: String,
}

fn text_of(v: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| v[*k].as_str().filter(|s| !s.is_empty()).map(String::from))
}

impl<'a> Client<'a> {
    pub fn new(http: &'a dyn Http, token: &'a str) -> Self {
        Self { http, token, secrets: vec![] }
    }

    fn all_secrets(&self) -> Vec<&str> {
        let mut v: Vec<&str> = self.secrets.iter().map(String::as_str).collect();
        v.push(self.token);
        v
    }

    /// Eén aanroep. Foutcodes: 401/403/429 → koppelingsfouten, 402 → plan-limiet, 404 → niet gevonden, 400 → SQL-fout met schone tekst.
    fn call(&self, method: &'static str, path: &str, body: Body) -> Result<Value, SupaError> {
        let req = Request::with(method, format!("{BASE}{path}"), body).bearer(self.token).header("Accept", "application/json").header("User-Agent", "Studio");
        let resp = self.http.send(req)?;
        let parsed: Value = serde_json::from_str(&resp.body).unwrap_or(Value::Null);
        match resp.status {
            200..=299 => Ok(parsed),
            401 => Err(ConnectError::Unauthorized.into()),
            403 => Err(ConnectError::Forbidden.into()),
            429 => Err(ConnectError::RateLimited.into()),
            402 => Err(SupaError::PlanLimit),
            404 => Err(SupaError::NotFound),
            400 | 422 => {
                let m = text_of(&parsed, &["message", "error", "msg"]).unwrap_or_else(|| "De opdracht werd niet geaccepteerd.".into());
                Err(SupaError::Sql(clip(&scrub(&m, &self.all_secrets()), 500)))
            }
            _ => Err(SupaError::Unexpected),
        }
    }

    pub fn organizations(&self) -> Result<Vec<Org>, SupaError> {
        let v = self.call("GET", "/v1/organizations", Body::None)?;
        Ok(v.as_array().map(|a| a.iter().filter_map(|o| Some(Org { slug: text_of(o, &["slug", "id"])?, name: text_of(o, &["name"]).unwrap_or_default(), plan: text_of(o, &["plan", "billing_plan"]) })).collect()).unwrap_or_default())
    }

    fn proj(p: &Value) -> Option<Proj> {
        Some(Proj { reference: text_of(p, &["id", "ref"])?, name: text_of(p, &["name"]).unwrap_or_default(), region: text_of(p, &["region"]).unwrap_or_default(), status: text_of(p, &["status"]).unwrap_or_default() })
    }

    pub fn projects(&self) -> Result<Vec<Proj>, SupaError> {
        let v = self.call("GET", "/v1/projects", Body::None)?;
        Ok(v.as_array().map(|a| a.iter().filter_map(Self::proj).collect()).unwrap_or_default())
    }

    pub fn project(&self, reference: &str) -> Result<Proj, SupaError> {
        check_ref(reference)?;
        Self::proj(&self.call("GET", &format!("/v1/projects/{reference}"), Body::None)?).ok_or(SupaError::Unexpected)
    }

    /// Maakt een project. De Europese regio is de standaard (`emea`). Zonder `size` wordt het de kleinste (gratis) variant.
    pub fn create_project(&self, name: &str, org_slug: &str, db_pass: &str, region_group: &str, size: Option<&str>) -> Result<Proj, SupaError> {
        let mut body = json!({ "name": name, "organization_slug": org_slug, "db_pass": db_pass, "region_selection": { "type": "smartGroup", "code": region_group } });
        if let Some(s) = size {
            body["desired_instance_size"] = json!(s);
        }
        Self::proj(&self.call("POST", "/v1/projects", Body::Json(body.to_string()))?).ok_or(SupaError::Unexpected)
    }

    pub fn pause(&self, reference: &str) -> Result<(), SupaError> {
        check_ref(reference)?;
        self.call("POST", &format!("/v1/projects/{reference}/pause"), Body::None).map(|_| ())
    }

    pub fn restore(&self, reference: &str) -> Result<(), SupaError> {
        check_ref(reference)?;
        self.call("POST", &format!("/v1/projects/{reference}/restore"), Body::None).map(|_| ())
    }

    /// Alleen de PUBLIEKE sleutel (publishable, of de verouderde `anon`). Een geheime sleutel wordt nooit gelezen of teruggegeven.
    pub fn public_key(&self, reference: &str) -> Result<PublicKeys, SupaError> {
        check_ref(reference)?;
        let v = self.call("GET", &format!("/v1/projects/{reference}/api-keys?reveal=true"), Body::None)?;
        let items = v.as_array().cloned().unwrap_or_default();
        let kies = |f: &dyn Fn(&Value) -> bool| items.iter().find(|i| f(i)).and_then(|i| text_of(i, &["api_key"]));
        let key = kies(&|i| i["type"].as_str() == Some("publishable")).or_else(|| kies(&|i| i["name"].as_str() == Some("anon")));
        key.map(|publishable| PublicKeys { publishable }).ok_or(SupaError::NotFound)
    }

    /// Voert SQL uit. `read_only` gebruikt het alleen-lezen-eindpunt (als de database-gebruiker `supabase_read_only_user`).
    pub fn query(&self, reference: &str, sql: &str, read_only: bool) -> Result<Value, SupaError> {
        check_ref(reference)?;
        let path = if read_only { format!("/v1/projects/{reference}/database/query/read-only") } else { format!("/v1/projects/{reference}/database/query") };
        self.call("POST", &path, Body::Json(json!({ "query": sql }).to_string()))
    }

    pub fn types(&self, reference: &str) -> Result<String, SupaError> {
        check_ref(reference)?;
        let v = self.call("GET", &format!("/v1/projects/{reference}/types/typescript?included_schemas=public"), Body::None)?;
        Ok(clip(v["types"].as_str().unwrap_or_default(), MAX_REPLY_CHARS * 2))
    }

    pub fn advisors(&self, reference: &str, soort: &str) -> Result<Value, SupaError> {
        check_ref(reference)?;
        if !matches!(soort, "security" | "performance") {
            return Err(SupaError::Unexpected);
        }
        self.call("GET", &format!("/v1/projects/{reference}/advisors/{soort}"), Body::None)
    }

    pub fn logs(&self, reference: &str, sql: &str) -> Result<Value, SupaError> {
        check_ref(reference)?;
        let q: String = sql.bytes().flat_map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { vec![b as char] } else { format!("%{b:02X}").chars().collect() }).collect();
        self.call("GET", &format!("/v1/projects/{reference}/analytics/endpoints/logs?sql={q}"), Body::None)
    }

    pub fn buckets(&self, reference: &str) -> Result<Value, SupaError> {
        check_ref(reference)?;
        self.call("GET", &format!("/v1/projects/{reference}/storage/buckets"), Body::None)
    }

    pub fn secret_names(&self, reference: &str) -> Result<Vec<String>, SupaError> {
        check_ref(reference)?;
        let v = self.call("GET", &format!("/v1/projects/{reference}/secrets"), Body::None)?;
        // Alleen de namen; waarden (als de API die geeft) worden hier meteen weggegooid.
        Ok(v.as_array().map(|a| a.iter().filter_map(|s| text_of(s, &["name"])).collect()).unwrap_or_default())
    }

    pub fn set_secret(&self, reference: &str, name: &str, value: &str) -> Result<(), SupaError> {
        check_ref(reference)?;
        self.call("POST", &format!("/v1/projects/{reference}/secrets"), Body::Json(json!([{ "name": name, "value": value }]).to_string())).map(|_| ())
    }

    pub fn auth_config(&self, reference: &str) -> Result<Value, SupaError> {
        check_ref(reference)?;
        self.call("GET", &format!("/v1/projects/{reference}/config/auth"), Body::None)
    }

    pub fn set_auth_config(&self, reference: &str, patch: &Value) -> Result<(), SupaError> {
        check_ref(reference)?;
        self.call("PATCH", &format!("/v1/projects/{reference}/config/auth"), Body::Json(patch.to_string())).map(|_| ())
    }

    pub fn deploy_function(&self, reference: &str, slug: &str, zip: Vec<u8>) -> Result<(), SupaError> {
        check_ref(reference)?;
        let boundary = "----StudioBoundary7f3a9c";
        let meta = json!({ "name": slug, "entrypoint_path": "index.ts", "verify_jwt": true }).to_string();
        let mut data: Vec<u8> = vec![];
        data.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n{meta}\r\n").into_bytes());
        data.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{slug}.zip\"\r\nContent-Type: application/zip\r\n\r\n").into_bytes());
        data.extend(zip);
        data.extend(format!("\r\n--{boundary}--\r\n").into_bytes());
        self.call("POST", &format!("/v1/projects/{reference}/functions/deploy?slug={slug}"), Body::Bytes { content_type: format!("multipart/form-data; boundary={boundary}"), data }).map(|_| ())
    }
}

/// Een project-referentie is kort en bestaat uit letters en cijfers; zo kan een vreemde waarde nooit een ander pad worden.
pub fn check_ref(r: &str) -> Result<(), SupaError> {
    if !r.is_empty() && r.len() <= 40 && r.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()) {
        Ok(())
    } else {
        Err(SupaError::NotFound)
    }
}

/// Een naam voor een opslagmap, functie of geheim: alleen veilige tekens.
pub fn check_name(n: &str, extra: &[u8]) -> bool {
    !n.is_empty() && n.len() <= 63 && n.bytes().all(|b| b.is_ascii_alphanumeric() || extra.contains(&b))
}

#[cfg(test)]
mod tests;
