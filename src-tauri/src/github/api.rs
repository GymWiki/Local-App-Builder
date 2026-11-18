//! De kleine stukjes GitHub-API die Studio gebruikt: account, bestaat een repository, aanmaken, lijst van eigen repositories.
//! Alleen `https://api.github.com`. Het token komt van `Manager::authorized` en gaat alleen in de Authorization-header.
use super::name;
use super::GhError;
use crate::connect::http::{Body, Http, Request, Response};
use serde::Serialize;
use serde_json::{json, Value};

const API: &str = "https://api.github.com";
const PER_PAGE: usize = 100;
/// Hoeveel pagina's we hooguit ophalen (500 repositories is ruim genoeg om uit te kiezen).
const MAX_PAGES: usize = 5;

fn req(method: &'static str, path: &str, body: Body, token: &str) -> Request {
    Request::with(method, format!("{API}{path}"), body)
        .bearer(token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "Studio")
}

fn limited(r: &Response) -> bool {
    let b = r.body.to_lowercase();
    b.contains("rate limit") || b.contains("abuse")
}

/// Zet een HTTP-status om in onze fout. 404 telt hier als "geen toegang" (GitHub verbergt privé-dingen met een 404).
fn status_error(r: &Response) -> Option<GhError> {
    match r.status {
        200..=299 => None,
        401 => Some(GhError::OngeldigToken),
        403 if limited(r) => Some(GhError::TeVeelVerzoeken),
        403 => Some(GhError::GeenRechten),
        429 => Some(GhError::TeVeelVerzoeken),
        _ => Some(GhError::Onverwacht),
    }
}

pub fn send(http: &dyn Http, r: Request) -> Result<Response, GhError> {
    http.send(r).map_err(GhError::from)
}

/// Bestaat deze repository (voor dit token zichtbaar)? 404 = vrij.
pub fn repo_exists(http: &dyn Http, token: &str, owner: &str, repo: &str) -> Result<bool, GhError> {
    if !name::is_valid_owner(owner) || !name::is_valid_existing(repo) {
        return Err(GhError::Onverwacht);
    }
    let r = send(http, req("GET", &format!("/repos/{owner}/{repo}"), Body::None, token))?;
    match r.status {
        200 => Ok(true),
        404 => Ok(false),
        _ => Err(status_error(&r).unwrap_or(GhError::Onverwacht)),
    }
}

pub struct Created {
    pub owner: String,
    pub name: String,
    pub private: bool,
    pub default_branch: String,
}

/// Maakt een repository voor de ingelogde gebruiker. Zonder README of andere beginbestanden: wij sturen de geschiedenis zelf.
pub fn create_repo(http: &dyn Http, token: &str, naam: &str, private: bool, beschrijving: &str) -> Result<Created, GhError> {
    if !name::is_valid(naam) {
        return Err(GhError::Onverwacht);
    }
    let body = json!({ "name": naam, "private": private, "auto_init": false, "description": beschrijving.chars().take(200).collect::<String>() });
    let r = send(http, req("POST", "/user/repos", Body::Json(body.to_string()), token))?;
    match r.status {
        201 | 200 => {
            let v = r.json().ok_or(GhError::Onverwacht)?;
            Ok(Created {
                owner: v["owner"]["login"].as_str().ok_or(GhError::Onverwacht)?.to_string(),
                name: v["name"].as_str().unwrap_or(naam).to_string(),
                private: v["private"].as_bool().unwrap_or(private),
                default_branch: v["default_branch"].as_str().unwrap_or("main").to_string(),
            })
        }
        422 => Err(GhError::NaamBezet),
        404 => Err(GhError::GeenRechten),
        _ => Err(status_error(&r).unwrap_or(GhError::Onverwacht)),
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RepoItem {
    pub eigenaar: String,
    pub naam: String,
    pub privaat: bool,
    pub beschrijving: String,
    pub bijgewerkt: String,
}

/// De repositories van de gebruiker (eigen en waar hij bij mag), laatst gewijzigd eerst.
pub fn list_repos(http: &dyn Http, token: &str) -> Result<Vec<RepoItem>, GhError> {
    let mut out = vec![];
    for page in 1..=MAX_PAGES {
        let r = send(http, req("GET", &format!("/user/repos?per_page={PER_PAGE}&page={page}&sort=pushed&affiliation=owner,collaborator,organization_member"), Body::None, token))?;
        if let Some(e) = status_error(&r) {
            return Err(e);
        }
        let v = r.json().ok_or(GhError::Onverwacht)?;
        let items = v.as_array().ok_or(GhError::Onverwacht)?;
        for i in items {
            let (Some(owner), Some(naam)) = (i["owner"]["login"].as_str(), i["name"].as_str()) else { continue };
            if !name::is_valid_owner(owner) || !name::is_valid_existing(naam) {
                continue;
            }
            out.push(RepoItem {
                eigenaar: owner.into(),
                naam: naam.into(),
                privaat: i["private"].as_bool().unwrap_or(true),
                beschrijving: i["description"].as_str().unwrap_or("").chars().take(200).collect(),
                bijgewerkt: i["pushed_at"].as_str().unwrap_or("").into(),
            });
        }
        if items.len() < PER_PAGE {
            break;
        }
    }
    Ok(out)
}

#[allow(dead_code)]
fn _unused(_: Value) {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connect::http::MockHttp;
    use crate::connect::error::ConnectError;

    fn m(r: Vec<Result<Response, ConnectError>>) -> MockHttp {
        MockHttp::new(r)
    }

    #[test]
    fn controleert_of_een_naam_bestaat() {
        assert_eq!(repo_exists(&m(vec![MockHttp::ok(200, "{}")]), "t", "pieter", "app"), Ok(true));
        assert_eq!(repo_exists(&m(vec![MockHttp::ok(404, "{}")]), "t", "pieter", "app"), Ok(false));
        assert_eq!(repo_exists(&m(vec![MockHttp::ok(401, "{}")]), "t", "pieter", "app"), Err(GhError::OngeldigToken));
        // Een ongeldige naam gaat nooit de deur uit.
        let h = m(vec![]);
        assert!(repo_exists(&h, "t", "a/b", "app").is_err());
        assert!(h.seen.lock().unwrap().is_empty());
    }

    #[test]
    fn maakt_een_privé_repository_en_vertaalt_fouten() {
        let h = m(vec![MockHttp::ok(201, r#"{"name":"app","private":true,"default_branch":"main","owner":{"login":"pieter"}}"#)]);
        let c = create_repo(&h, "t", "app", true, "Back-up").unwrap();
        assert_eq!((c.owner.as_str(), c.name.as_str(), c.private), ("pieter", "app", true));
        assert_eq!(h.seen.lock().unwrap()[0], ("POST".into(), "https://api.github.com/user/repos".into()));
        assert_eq!(create_repo(&m(vec![MockHttp::ok(422, r#"{"errors":[{"message":"name already exists on this account"}]}"#)]), "t", "app", true, "").err(), Some(GhError::NaamBezet));
        assert_eq!(create_repo(&m(vec![MockHttp::ok(403, r#"{"message":"Resource not accessible"}"#)]), "t", "app", true, "").err(), Some(GhError::GeenRechten));
        assert_eq!(create_repo(&m(vec![MockHttp::ok(403, r#"{"message":"API rate limit exceeded"}"#)]), "t", "app", true, "").err(), Some(GhError::TeVeelVerzoeken));
        assert_eq!(create_repo(&m(vec![MockHttp::ok(429, "{}")]), "t", "app", true, "").err(), Some(GhError::TeVeelVerzoeken));
        assert_eq!(create_repo(&m(vec![MockHttp::ok(401, "{}")]), "t", "app", true, "").err(), Some(GhError::OngeldigToken));
        assert_eq!(create_repo(&m(vec![Err(ConnectError::Timeout)]), "t", "app", true, "").err(), Some(GhError::TimeOut));
        assert_eq!(create_repo(&m(vec![Err(ConnectError::Offline)]), "t", "app", true, "").err(), Some(GhError::GeenInternet));
        assert!(create_repo(&m(vec![]), "t", "../x", true, "").is_err());
    }

    #[test]
    fn lijst_met_repositories_bladert_en_slaat_rare_namen_over() {
        let pagina = |n: usize| {
            let v: Vec<Value> = (0..n).map(|i| json!({"name": format!("r{i}"), "private": i % 2 == 0, "owner": {"login": "pieter"}, "pushed_at": "2026-01-01T00:00:00Z"})).collect();
            Value::Array(v).to_string()
        };
        let h = m(vec![MockHttp::ok(200, &pagina(100)), MockHttp::ok(200, &json!([{"name":"../boos","owner":{"login":"pieter"}},{"name":"goed","private":false,"owner":{"login":"pieter"}}]).to_string())]);
        let l = list_repos(&h, "t").unwrap();
        assert_eq!(l.len(), 101);
        assert_eq!(h.seen.lock().unwrap().len(), 2);
        assert_eq!(l.last().unwrap().naam, "goed");
        assert_eq!(list_repos(&m(vec![MockHttp::ok(403, "{}")]), "t").err(), Some(GhError::GeenRechten));
    }
}
