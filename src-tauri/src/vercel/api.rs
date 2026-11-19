//! De stukjes van de Vercel-API die Studio gebruikt. Alleen `https://api.vercel.com`. Het token komt van `Manager::authorized`.
//! Alles is defensief gelezen: ontbrekende velden worden een nette fout, nooit een crash (zie docs/vercel.md §2 voor wat niet te controleren was).
use super::VError;
use crate::connect::http::{Body, Http, Request, Response};
use serde::Serialize;
use serde_json::{json, Value};

const API: &str = "https://api.vercel.com";

fn req(method: &'static str, path: &str, body: Body, token: &str) -> Request {
    Request::with(method, format!("{API}{path}"), body).bearer(token).header("User-Agent", "Studio")
}

fn send(http: &dyn Http, r: Request) -> Result<Response, VError> {
    http.send(r).map_err(VError::from)
}

fn status_error(r: &Response) -> Option<VError> {
    match r.status {
        200..=299 => None,
        401 => Some(VError::OngeldigToken),
        403 => Some(VError::GeenRechten),
        404 => Some(VError::NietGevonden),
        429 => Some(VError::TeVeelVerzoeken),
        _ => Some(VError::Onverwacht),
    }
}

/// Een Vercel-projectnaam: kleine letters, cijfers en streepjes (we maken hem strenger dan nodig).
pub fn valid_project_name(n: &str) -> bool {
    !n.is_empty() && n.len() <= 52 && n.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') && !n.starts_with('-') && !n.ends_with('-')
}

fn path_id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

#[derive(Debug, Clone, PartialEq)]
pub struct Project {
    pub id: String,
    pub name: String,
}

pub fn create_project(http: &dyn Http, token: &str, name: &str, framework: Option<&str>) -> Result<Project, VError> {
    if !valid_project_name(name) {
        return Err(VError::Onverwacht);
    }
    let mut body = json!({ "name": name });
    if let Some(f) = framework {
        body["framework"] = json!(f);
    }
    let r = send(http, req("POST", "/v11/projects", Body::Json(body.to_string()), token))?;
    match r.status {
        200..=299 => {
            let v = r.json().ok_or(VError::Onverwacht)?;
            Ok(Project { id: v["id"].as_str().ok_or(VError::Onverwacht)?.to_string(), name: v["name"].as_str().unwrap_or(name).to_string() })
        }
        409 => Err(VError::NaamBezet),
        400 if r.body.to_lowercase().contains("already") || r.body.contains("name_taken") => Err(VError::NaamBezet),
        _ => Err(status_error(&r).unwrap_or(VError::Onverwacht)),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Deployment {
    pub id: String,
    pub url: String,
    /// `QUEUED`, `INITIALIZING`, `BUILDING`, `READY`, `ERROR` of `CANCELED` (zoals Vercel het meldt; onbekend = leeg).
    pub state: String,
    pub alias: Vec<String>,
}

fn parse_deployment(v: &Value) -> Result<Deployment, VError> {
    let id = v["id"].as_str().or_else(|| v["uid"].as_str()).ok_or(VError::Onverwacht)?.to_string();
    Ok(Deployment {
        id,
        url: v["url"].as_str().unwrap_or("").to_string(),
        state: v["readyState"].as_str().or_else(|| v["status"].as_str()).unwrap_or("").to_uppercase(),
        alias: v["alias"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default(),
    })
}

/// Eén bestand uploaden. De SHA-1 (hex) is de naam waaronder Vercel het bewaart.
pub fn upload_file(http: &dyn Http, token: &str, sha: &str, data: Vec<u8>) -> Result<(), VError> {
    let r = send(http, req("POST", "/v2/files", Body::Bytes { content_type: "application/octet-stream".into(), data }, token).header("x-vercel-digest", sha))?;
    match status_error(&r) {
        None => Ok(()),
        Some(e) => Err(e),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct FileRef {
    pub file: String,
    pub sha: String,
    pub size: u64,
}

pub fn create_deployment(http: &dyn Http, token: &str, name: &str, project_id: &str, files: &[FileRef], framework: Option<&str>, production: bool) -> Result<Deployment, VError> {
    let mut body = json!({ "name": name, "project": project_id, "files": files, "projectSettings": { "framework": framework } });
    if production {
        body["target"] = json!("production");
    }
    let r = send(http, req("POST", "/v13/deployments?skipAutoDetectionConfirmation=1", Body::Json(body.to_string()), token))?;
    if let Some(e) = status_error(&r) {
        return Err(e);
    }
    parse_deployment(&r.json().ok_or(VError::Onverwacht)?)
}

pub fn get_deployment(http: &dyn Http, token: &str, id: &str) -> Result<Deployment, VError> {
    if !path_id_ok(id) {
        return Err(VError::Onverwacht);
    }
    let r = send(http, req("GET", &format!("/v13/deployments/{id}"), Body::None, token))?;
    if let Some(e) = status_error(&r) {
        return Err(e);
    }
    parse_deployment(&r.json().ok_or(VError::Onverwacht)?)
}

pub fn cancel_deployment(http: &dyn Http, token: &str, id: &str) -> Result<(), VError> {
    if !path_id_ok(id) {
        return Err(VError::Onverwacht);
    }
    let r = send(http, req("PATCH", &format!("/v12/deployments/{id}/cancel"), Body::None, token))?;
    status_error(&r).map_or(Ok(()), Err)
}

/// De regels van het bouwlogboek (laatste `limit`), als tekst. Nog zonder het geheimen te maskeren: dat doet de aanroeper.
pub fn build_log(http: &dyn Http, token: &str, id: &str, limit: usize) -> Result<Vec<String>, VError> {
    if !path_id_ok(id) {
        return Err(VError::Onverwacht);
    }
    let r = send(http, req("GET", &format!("/v3/deployments/{id}/events?direction=backward&limit={limit}"), Body::None, token))?;
    if let Some(e) = status_error(&r) {
        return Err(e);
    }
    let v = r.json().ok_or(VError::Onverwacht)?;
    let items = v.as_array().ok_or(VError::Onverwacht)?;
    let mut lines: Vec<String> = items.iter().filter_map(|e| e["text"].as_str().or_else(|| e["payload"]["text"].as_str()).map(String::from)).collect();
    lines.reverse(); // "backward" geeft de nieuwste eerst
    Ok(lines)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DeployItem {
    pub id: String,
    pub url: String,
    pub doel: String,
    pub status: String,
    pub gemaakt: i64,
}

pub fn list_deployments(http: &dyn Http, token: &str, project_id: &str, limit: usize) -> Result<Vec<DeployItem>, VError> {
    if !path_id_ok(project_id) {
        return Err(VError::Onverwacht);
    }
    let r = send(http, req("GET", &format!("/v6/deployments?projectId={project_id}&limit={}", limit.min(50)), Body::None, token))?;
    if let Some(e) = status_error(&r) {
        return Err(e);
    }
    let v = r.json().ok_or(VError::Onverwacht)?;
    let arr = v["deployments"].as_array().ok_or(VError::Onverwacht)?;
    Ok(arr
        .iter()
        .filter_map(|d| {
            let id = d["uid"].as_str().or_else(|| d["id"].as_str())?;
            Some(DeployItem {
                id: id.to_string(),
                url: d["url"].as_str().unwrap_or("").to_string(),
                doel: d["target"].as_str().unwrap_or("preview").to_string(),
                status: d["state"].as_str().or_else(|| d["readyState"].as_str()).unwrap_or("").to_uppercase(),
                gemaakt: d["created"].as_i64().or_else(|| d["createdAt"].as_i64()).unwrap_or(0) / 1000,
            })
        })
        .collect())
}

/// Productie naar een eerdere deployment laten wijzen (zonder opnieuw te bouwen). Op het gratis plan alleen de vorige.
pub fn promote(http: &dyn Http, token: &str, project_id: &str, deployment_id: &str) -> Result<(), VError> {
    if !path_id_ok(project_id) || !path_id_ok(deployment_id) {
        return Err(VError::Onverwacht);
    }
    let r = send(http, req("POST", &format!("/v10/projects/{project_id}/promote/{deployment_id}"), Body::None, token))?;
    if r.status == 403 && r.body.to_lowercase().contains("upgrade to pro") {
        return Err(VError::RollbackPro);
    }
    status_error(&r).map_or(Ok(()), Err)
}

/// Een omgevingsvariabele instellen (bestaande wordt bijgewerkt). De waarde gaat alleen in de body van dit verzoek.
pub fn env_upsert(http: &dyn Http, token: &str, project_id: &str, key: &str, value: &str, kind: &str, targets: &[String]) -> Result<(), VError> {
    if !path_id_ok(project_id) {
        return Err(VError::Onverwacht);
    }
    let body = json!({ "key": key, "value": value, "type": kind, "target": targets });
    let r = send(http, req("POST", &format!("/v10/projects/{project_id}/env?upsert=true"), Body::Json(body.to_string()), token))?;
    status_error(&r).map_or(Ok(()), Err)
}

/// Een bestaand domein aan het project koppelen. Geeft terug wat Vercel nog wil zien (verificatie) en of het al klaar is.
pub fn domain_add(http: &dyn Http, token: &str, project_id: &str, domain: &str) -> Result<Value, VError> {
    if !path_id_ok(project_id) || !valid_domain(domain) {
        return Err(VError::Onverwacht);
    }
    let r = send(http, req("POST", &format!("/v10/projects/{project_id}/domains"), Body::Json(json!({ "name": domain }).to_string()), token))?;
    match r.status {
        200..=299 => Ok(domain_view(&r.json().unwrap_or(Value::Null))),
        409 => Err(VError::NaamBezet),
        _ => Err(status_error(&r).unwrap_or(VError::Onverwacht)),
    }
}

pub fn domain_verify(http: &dyn Http, token: &str, project_id: &str, domain: &str) -> Result<Value, VError> {
    if !path_id_ok(project_id) || !valid_domain(domain) {
        return Err(VError::Onverwacht);
    }
    let r = send(http, req("POST", &format!("/v9/projects/{project_id}/domains/{domain}/verify"), Body::None, token))?;
    if let Some(e) = status_error(&r) {
        return Err(e);
    }
    Ok(domain_view(&r.json().unwrap_or(Value::Null)))
}

/// Alleen wat de gebruiker nodig heeft: of het geverifieerd is en welke DNS-regels Vercel nog vraagt (zoals Vercel ze noemt).
fn domain_view(v: &Value) -> Value {
    let records: Vec<Value> = v["verification"].as_array().map(|a| a.iter().map(|x| json!({ "type": x["type"].as_str().unwrap_or(""), "naam": x["domain"].as_str().unwrap_or(""), "waarde": x["value"].as_str().unwrap_or("") })).collect()).unwrap_or_default();
    json!({ "naam": v["name"].as_str().unwrap_or(""), "geverifieerd": v["verified"].as_bool().unwrap_or(false), "regels": records })
}

pub fn valid_domain(d: &str) -> bool {
    d.len() <= 253 && d.contains('.') && d.split('.').all(|p| !p.is_empty() && p.len() <= 63 && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && !p.starts_with('-') && !p.ends_with('-'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connect::error::ConnectError;
    use crate::connect::http::MockHttp;

    fn m(r: Vec<Result<Response, ConnectError>>) -> MockHttp {
        MockHttp::new(r)
    }

    #[test]
    fn project_maken_en_namen_controleren() {
        let h = m(vec![MockHttp::ok(200, r#"{"id":"prj_1","name":"winkel"}"#)]);
        assert_eq!(create_project(&h, "t", "winkel", Some("vite")).unwrap(), Project { id: "prj_1".into(), name: "winkel".into() });
        assert_eq!(create_project(&m(vec![MockHttp::ok(409, "{}")]), "t", "winkel", None).err(), Some(VError::NaamBezet));
        assert_eq!(create_project(&m(vec![MockHttp::ok(401, "{}")]), "t", "winkel", None).err(), Some(VError::OngeldigToken));
        assert_eq!(create_project(&m(vec![MockHttp::ok(403, "{}")]), "t", "winkel", None).err(), Some(VError::GeenRechten));
        assert_eq!(create_project(&m(vec![MockHttp::ok(429, "{}")]), "t", "winkel", None).err(), Some(VError::TeVeelVerzoeken));
        assert_eq!(create_project(&m(vec![Err(ConnectError::Timeout)]), "t", "winkel", None).err(), Some(VError::TimeOut));
        assert!(create_project(&m(vec![]), "t", "Slechte Naam", None).is_err());
    }

    #[test]
    fn deployment_lezen_is_defensief() {
        let h = m(vec![MockHttp::ok(200, r#"{"id":"dpl_1","url":"app-abc.vercel.app","readyState":"building","alias":["app.vercel.app"]}"#)]);
        let d = get_deployment(&h, "t", "dpl_1").unwrap();
        assert_eq!((d.state.as_str(), d.alias.len()), ("BUILDING", 1));
        // Een antwoord zonder id of zonder JSON wordt een nette fout.
        assert_eq!(get_deployment(&m(vec![MockHttp::ok(200, "{}")]), "t", "dpl_1").err(), Some(VError::Onverwacht));
        assert_eq!(get_deployment(&m(vec![MockHttp::ok(200, "geen json")]), "t", "dpl_1").err(), Some(VError::Onverwacht));
        // Een id met een pad of vraagteken gaat nooit de deur uit.
        let leeg = m(vec![]);
        assert!(get_deployment(&leeg, "t", "../x").is_err() && leeg.seen.lock().unwrap().is_empty());
    }

    #[test]
    fn terugdraaien_op_het_gratis_plan_geeft_een_eigen_fout() {
        assert_eq!(promote(&m(vec![MockHttp::ok(403, r#"{"error":{"message":"To rollback further than the previous production deployment, upgrade to pro."}}"#)]), "t", "prj_1", "dpl_1").err(), Some(VError::RollbackPro));
        assert_eq!(promote(&m(vec![MockHttp::ok(200, "{}")]), "t", "prj_1", "dpl_1"), Ok(()));
        assert_eq!(promote(&m(vec![MockHttp::ok(403, "{}")]), "t", "prj_1", "dpl_1").err(), Some(VError::GeenRechten));
    }

    #[test]
    fn logboek_lijst_en_domeinen() {
        let h = m(vec![MockHttp::ok(200, r#"[{"text":"laatste"},{"payload":{"text":"eerste"}},{"type":"x"}]"#)]);
        assert_eq!(build_log(&h, "t", "dpl_1", 50).unwrap(), vec!["eerste", "laatste"]);
        let l = list_deployments(&m(vec![MockHttp::ok(200, r#"{"deployments":[{"uid":"dpl_2","url":"a.vercel.app","target":"production","state":"READY","created":1700000000000},{"nieuw":1}]}"#)]), "t", "prj_1", 20).unwrap();
        assert_eq!((l.len(), l[0].doel.as_str(), l[0].gemaakt), (1, "production", 1_700_000_000));
        let d = domain_add(&m(vec![MockHttp::ok(200, r#"{"name":"mijn.nl","verified":false,"verification":[{"type":"TXT","domain":"_vercel.mijn.nl","value":"vc-domain-verify=abc"}]}"#)]), "t", "prj_1", "mijn.nl").unwrap();
        assert_eq!((d["geverifieerd"].as_bool(), d["regels"][0]["type"].as_str()), (Some(false), Some("TXT")));
        assert!(domain_add(&m(vec![]), "t", "prj_1", "geen domein").is_err());
        assert!(valid_domain("shop.voorbeeld.nl") && !valid_domain("a..b") && !valid_domain("a/b.nl") && !valid_domain("-x.nl"));
    }

    #[test]
    fn env_gaat_alleen_in_de_body_en_nooit_in_de_url() {
        let h = m(vec![MockHttp::ok(201, "{}")]);
        env_upsert(&h, "t", "prj_1", "KLEUR", "geheimewaarde", "encrypted", &["production".into()]).unwrap();
        let seen = h.seen.lock().unwrap();
        assert!(!seen[0].1.contains("geheimewaarde") && seen[0].1.contains("upsert=true"));
    }
}
