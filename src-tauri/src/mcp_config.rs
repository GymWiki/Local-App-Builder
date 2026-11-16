use crate::error::{AppError, Result};
use crate::provider::Provider;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub const SERVER_NAME: &str = "studio";
const URL_REF: &str = "${STUDIO_MCP_URL}";
const AUTH_REF: &str = "Bearer ${STUDIO_MCP_TOKEN}";
/// run_checks kan minuten duren; zonder dit kapt Claude HTTP-verzoeken na 60 s af en gebruikt Gemini 10 min (bron: docs/cli-notes.md).
const TIMEOUT_MS: u64 = 900_000;

#[derive(Debug, PartialEq)]
pub enum Outcome {
    Created,
    Added,
    Updated,
    Unchanged,
}

/// Het configbestand van de CLI in de projectmap.
pub fn config_path(provider: Provider, project_dir: &Path) -> PathBuf {
    match provider {
        Provider::Claude => project_dir.join(".mcp.json"),
        Provider::Gemini => project_dir.join(".gemini").join("settings.json"),
    }
}

/// URL en token staan hier alleen als `${VAR}`-verwijzing; de echte waarden gaan via de omgeving van het PTY-proces.
pub fn entry(provider: Provider) -> Value {
    match provider {
        Provider::Claude => {
            json!({ "type": "http", "url": URL_REF, "headers": { "Authorization": AUTH_REF }, "timeout": TIMEOUT_MS })
        }
        Provider::Gemini => {
            json!({ "httpUrl": URL_REF, "headers": { "Authorization": AUTH_REF }, "timeout": TIMEOUT_MS })
        }
    }
}

fn is_ours(v: &Value) -> bool {
    ["url", "httpUrl"]
        .iter()
        .any(|k| v.get(k).and_then(Value::as_str) == Some(URL_REF))
}

fn refuse(file: &Path, why: &str) -> AppError {
    AppError::Invalid(format!(
        "{} {why} Ik heb het bestand ongemoeid gelaten; voeg de Studio-server eventueel zelf toe.",
        file.display()
    ))
}

/// Voegt alleen onze `studio`-server toe aan `mcpServers`. Alles wat er al staat blijft gelijk;
/// bij elke twijfel (ongeldige JSON, onverwachte structuur, andermans `studio`-entry) weigeren we en schrijven we niets.
pub fn ensure(provider: Provider, project_dir: &Path) -> Result<Outcome> {
    let file = config_path(provider, project_dir);
    let ours = entry(provider);

    let existing = match fs::read_to_string(&file) {
        Ok(s) => Some(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };

    let (mut root, existed) = match &existing {
        None => (Value::Object(Map::new()), false),
        Some(s) if s.trim().is_empty() => (Value::Object(Map::new()), true),
        Some(s) => (
            serde_json::from_str::<Value>(s)
                .map_err(|_| refuse(&file, "is geen geldige JSON (bevat het opmerkingen?)."))?,
            true,
        ),
    };
    let obj = root
        .as_object_mut()
        .ok_or_else(|| refuse(&file, "heeft geen JSON-object als hoofdstructuur."))?;
    let servers = obj
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(Map::new()));
    let servers = servers
        .as_object_mut()
        .ok_or_else(|| refuse(&file, "heeft een `mcpServers` die geen object is."))?;

    let outcome = match servers.get(SERVER_NAME) {
        Some(v) if *v == ours => return Ok(Outcome::Unchanged),
        Some(v) if is_ours(v) => Outcome::Updated,
        Some(_) => {
            return Err(refuse(
                &file,
                "bevat al een andere server met de naam `studio`.",
            ))
        }
        None if existed => Outcome::Added,
        None => Outcome::Created,
    };
    servers.insert(SERVER_NAME.into(), ours);

    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut out =
        serde_json::to_string_pretty(&root).map_err(|e| AppError::Invalid(e.to_string()))?;
    out.push('\n');
    let tmp = file.with_extension("studio-tmp");
    fs::write(&tmp, out)?;
    fs::rename(&tmp, &file)?;
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(p: &Path) -> Value {
        serde_json::from_str(&fs::read_to_string(p).unwrap()).unwrap()
    }

    #[test]
    fn maakt_nieuw_bestand_zonder_token_of_poort() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(
            ensure(Provider::Claude, d.path()).unwrap(),
            Outcome::Created
        );
        let raw = fs::read_to_string(d.path().join(".mcp.json")).unwrap();
        assert!(raw.contains("${STUDIO_MCP_TOKEN}") && raw.contains("${STUDIO_MCP_URL}"));
        assert!(!raw.contains("127.0.0.1"));
        assert_eq!(
            read(&d.path().join(".mcp.json"))["mcpServers"]["studio"]["type"],
            "http"
        );
    }

    #[test]
    fn gemini_schrijft_naar_gemini_map_met_httpurl() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(
            ensure(Provider::Gemini, d.path()).unwrap(),
            Outcome::Created
        );
        let v = read(&d.path().join(".gemini/settings.json"));
        assert_eq!(v["mcpServers"]["studio"]["httpUrl"], "${STUDIO_MCP_URL}");
    }

    #[test]
    fn bewaart_bestaande_servers_en_overige_instellingen() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join(".gemini");
        fs::create_dir(&p).unwrap();
        let orig = r#"{"theme":"dark","mcpServers":{"eigen":{"command":"x","args":["a"],"trust":true}},"z":[1,2]}"#;
        fs::write(p.join("settings.json"), orig).unwrap();

        assert_eq!(ensure(Provider::Gemini, d.path()).unwrap(), Outcome::Added);
        let v = read(&p.join("settings.json"));
        assert_eq!(v["theme"], "dark");
        assert_eq!(v["z"], json!([1, 2]));
        assert_eq!(
            v["mcpServers"]["eigen"],
            json!({"command":"x","args":["a"],"trust":true})
        );
        assert!(v["mcpServers"]["studio"].is_object());
        let keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        assert_eq!(
            keys,
            vec!["theme", "mcpServers", "z"],
            "volgorde blijft behouden"
        );
    }

    #[test]
    fn is_idempotent_en_schrijft_niets_bij_ongewijzigd() {
        let d = tempfile::tempdir().unwrap();
        ensure(Provider::Claude, d.path()).unwrap();
        let f = d.path().join(".mcp.json");
        let before = fs::read(&f).unwrap();
        assert_eq!(
            ensure(Provider::Claude, d.path()).unwrap(),
            Outcome::Unchanged
        );
        assert_eq!(fs::read(&f).unwrap(), before);
    }

    #[test]
    fn ongeldige_json_blijft_byte_voor_byte_onaangetast() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join(".mcp.json");
        let kapot = "{ // opmerking\n \"mcpServers\": {} }";
        fs::write(&f, kapot).unwrap();
        assert!(ensure(Provider::Claude, d.path()).is_err());
        assert_eq!(fs::read_to_string(&f).unwrap(), kapot);
    }

    #[test]
    fn onverwachte_structuur_wordt_geweigerd_en_niet_aangepast() {
        for kapot in [
            "[1,2]",
            r#"{"mcpServers":[]}"#,
            r#"{"mcpServers":"x"}"#,
            "null",
        ] {
            let d = tempfile::tempdir().unwrap();
            let f = d.path().join(".mcp.json");
            fs::write(&f, kapot).unwrap();
            assert!(ensure(Provider::Claude, d.path()).is_err(), "{kapot}");
            assert_eq!(fs::read_to_string(&f).unwrap(), kapot);
        }
    }

    #[test]
    fn andermans_studio_entry_wordt_nooit_overschreven() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join(".mcp.json");
        let eigen = r#"{"mcpServers":{"studio":{"type":"http","url":"https://mijn.server/mcp"}}}"#;
        fs::write(&f, eigen).unwrap();
        assert!(ensure(Provider::Claude, d.path()).is_err());
        assert_eq!(fs::read_to_string(&f).unwrap(), eigen);
    }

    #[test]
    fn verouderde_eigen_entry_wordt_bijgewerkt() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join(".mcp.json");
        fs::write(&f, r#"{"mcpServers":{"studio":{"type":"http","url":"${STUDIO_MCP_URL}"},"b":{"command":"x"}}}"#).unwrap();
        assert_eq!(
            ensure(Provider::Claude, d.path()).unwrap(),
            Outcome::Updated
        );
        let v = read(&f);
        assert_eq!(v["mcpServers"]["studio"], entry(Provider::Claude));
        assert_eq!(v["mcpServers"]["b"]["command"], "x");
    }

    #[test]
    fn entry_heeft_een_ruime_timeout_voor_lange_checks() {
        for p in [Provider::Claude, Provider::Gemini] {
            assert_eq!(entry(p)["timeout"], 900_000);
        }
    }

    #[test]
    fn leeg_bestand_wordt_gevuld() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join(".mcp.json"), "  \n").unwrap();
        assert_eq!(ensure(Provider::Claude, d.path()).unwrap(), Outcome::Added);
    }
}
