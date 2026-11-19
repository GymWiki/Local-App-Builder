//! Controle op inhoud die de beoordeling van een winkel kan laten mislukken: ontbrekend of onecht privacybeleid, onnodige of
//! gevoelige rechten, testgegevens in de app, onwaarschijnlijke links en sleutels in het project. Alles offline: of een link echt
//! werkt, kan Studio niet zien; dat staat ook zo in het scherm.
use super::data::AppData;
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Bevinding {
    /// nl.json: `winkels.veilig.<code>`.
    pub code: &'static str,
    /// `fout` houdt de winkel waarschijnlijk tegen, `let_op` is een waarschuwing.
    pub ernst: &'static str,
    pub detail: Option<String>,
}

fn b(code: &'static str, ernst: &'static str, detail: impl Into<Option<String>>) -> Bevinding {
    Bevinding { code, ernst, detail: detail.into() }
}

/// Is dit een link die er echt uitziet? (https, een echte domeinnaam, geen plaatshouder of lokaal adres.)
pub fn link_ziet_er_echt_uit(u: &str) -> Result<(), &'static str> {
    let u = u.trim();
    let Some(rest) = u.strip_prefix("https://") else { return Err("geen_https") };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("").split(':').next().unwrap_or("").to_lowercase();
    if host == "localhost" || host.starts_with("127.") || host.starts_with("192.168.") || host.starts_with("10.") || host.ends_with(".local") {
        return Err("lokaal");
    }
    if host.is_empty() || !host.contains('.') {
        return Err("geen_domein");
    }
    if host == "example.com" || host.ends_with(".example.com") || host.contains("jouwsite") || host.contains("jouwdomein") || host.contains("yourdomain") || host.contains("voorbeeld.") {
        return Err("plaatshouder");
    }
    Ok(())
}

const GEVOELIGE_RECHTEN: &[&str] = &["READ_SMS", "SEND_SMS", "RECEIVE_SMS", "READ_CALL_LOG", "WRITE_CALL_LOG", "PROCESS_OUTGOING_CALLS", "SYSTEM_ALERT_WINDOW", "MANAGE_EXTERNAL_STORAGE", "ACCESS_BACKGROUND_LOCATION", "REQUEST_INSTALL_PACKAGES", "QUERY_ALL_PACKAGES", "BIND_ACCESSIBILITY_SERVICE", "READ_PHONE_NUMBERS"];
const TESTTEKST: &[&str] = &["lorem ipsum", "dolor sit amet", "test@test", "foo@bar", "asdf", "qwerty", "flutter demo home page", "you have pushed the button", "hello world", "todo: schrijf", "placeholder tekst"];
const SKIP: &[&str] = &["node_modules", ".git", "build", ".dart_tool", ".gradle", "Pods", "dist", ".studio"];

fn tekstbestanden(dir: &Path, rel: &str, uit: &mut Vec<(String, String)>, diepte: usize) {
    if diepte > 6 || uit.len() > 400 {
        return;
    }
    let Ok(rd) = fs::read_dir(dir.join(rel)) else { return };
    for e in rd.flatten() {
        let naam = e.file_name().to_string_lossy().to_string();
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_symlink() || SKIP.contains(&naam.as_str()) {
            continue;
        }
        let rel2 = if rel.is_empty() { naam.clone() } else { format!("{rel}/{naam}") };
        if ft.is_dir() {
            tekstbestanden(dir, &rel2, uit, diepte + 1);
        } else if ft.is_file() && matches!(naam.rsplit('.').next(), Some("dart" | "tsx" | "ts" | "jsx" | "js" | "json" | "xml" | "md" | "html" | "arb" | "strings")) && e.metadata().map(|m| m.len() < 200_000).unwrap_or(false) {
            if let Ok(t) = fs::read_to_string(e.path()) {
                uit.push((rel2, t));
            }
        }
    }
}

/// Alle bevindingen voor dit project en deze gegevens.
pub fn scan(dir: &Path, data: &AppData, permissies: &[String], teksten: &[String]) -> Vec<Bevinding> {
    let mut uit = vec![];
    // Privacybeleid: verplicht bij beide winkels.
    if data.privacy_url.trim().is_empty() {
        uit.push(b("privacy_ontbreekt", "fout", None));
    } else if let Err(c) = link_ziet_er_echt_uit(&data.privacy_url) {
        uit.push(b("privacy_link", "fout", c.to_string()));
    }
    for (naam, u) in [("website", &data.website), ("support", &data.support_url)] {
        if !u.trim().is_empty() {
            if let Err(c) = link_ziet_er_echt_uit(u) {
                uit.push(b("link", "let_op", format!("{naam}:{c}")));
            }
        }
    }
    if !data.contact_email.trim().is_empty() && !(data.contact_email.contains('@') && data.contact_email.split('@').nth(1).is_some_and(|d| d.contains('.') && !d.contains("example"))) {
        uit.push(b("contact_email", "let_op", None));
    }
    for p in permissies.iter().filter(|p| GEVOELIGE_RECHTEN.contains(&p.as_str())) {
        uit.push(b("gevoelig_recht", "let_op", p.clone()));
    }
    // Testgegevens in de teksten voor de winkel en in de app zelf.
    let mut bestanden: Vec<(String, String)> = vec![];
    for sub in ["lib", "src", "assets", "web", "android/app/src/main/res/values", "ios/Runner"] {
        tekstbestanden(dir, sub, &mut bestanden, 0);
    }
    for (naam, t) in teksten.iter().map(|t| ("winkeltekst".to_string(), t)).chain(bestanden.iter().map(|(n, t)| (n.clone(), t))) {
        let l = t.to_lowercase();
        if let Some(w) = TESTTEKST.iter().find(|w| l.contains(**w)) {
            // Een woord in een bronbestand is alleen een waarschuwing; in je winkeltekst houdt het de beoordeling tegen.
            uit.push(b("testtekst", if naam == "winkeltekst" { "fout" } else { "let_op" }, format!("{naam}:{w}")));
        }
    }
    uit.sort_by(|a, b| (a.code, &a.detail).cmp(&(b.code, &b.detail)));
    uit.dedup_by(|a, b| a.code == b.code && a.detail == b.detail);
    // Sleutelbestanden horen in de kluis, niet in het project (de volledige beveiliging komt bij het bouwen).
    for f in ["key.properties", "upload-keystore.jks", "android/key.properties", "android/app/upload-keystore.jks"] {
        if dir.join(f).is_file() {
            uit.push(b("sleutel_in_project", "let_op", f.to_string()));
        }
    }
    uit
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_die_er_niet_echt_uitzien() {
        assert_eq!(link_ziet_er_echt_uit("https://mijnwinkel.nl/privacy"), Ok(()));
        for (u, c) in [("http://mijnwinkel.nl", "geen_https"), ("mijnwinkel.nl", "geen_https"), ("https://localhost:3000", "lokaal"), ("https://192.168.1.5/x", "lokaal"), ("https://example.com/privacy", "plaatshouder"), ("https://jouwsite.nl/p", "plaatshouder"), ("https://winkel/p", "geen_domein"), ("https://", "geen_domein")] {
            assert_eq!(link_ziet_er_echt_uit(u), Err(c), "{u}");
        }
    }

    #[test]
    fn privacy_is_verplicht_en_moet_echt_lijken() {
        let d = tempfile::tempdir().unwrap();
        let mut data = AppData::default();
        assert_eq!(scan(d.path(), &data, &[], &[]).iter().map(|x| x.code).collect::<Vec<_>>(), vec!["privacy_ontbreekt"]);
        data.privacy_url = "http://localhost/privacy".into();
        assert_eq!(scan(d.path(), &data, &[], &[])[0], b("privacy_link", "fout", "geen_https".to_string()));
        data.privacy_url = "https://mijnwinkel.nl/privacy".into();
        assert!(scan(d.path(), &data, &[], &[]).is_empty());
    }

    #[test]
    fn gevoelige_rechten_en_testtekst_en_sleutels() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join("lib")).unwrap();
        fs::write(d.path().join("lib/main.dart"), "Text('Flutter Demo Home Page')").unwrap();
        fs::write(d.path().join("key.properties"), "storePassword=x").unwrap();
        let data = AppData { privacy_url: "https://mijnwinkel.nl/privacy".into(), ..Default::default() };
        let r = scan(d.path(), &data, &["INTERNET".into(), "READ_SMS".into(), "CAMERA".into()], &["Lorem ipsum dolor".into()]);
        let codes: Vec<(&str, &str)> = r.iter().map(|x| (x.code, x.ernst)).collect();
        assert!(codes.contains(&("gevoelig_recht", "let_op")), "{codes:?}");
        assert!(codes.contains(&("testtekst", "fout")), "winkeltekst met lorem ipsum houdt de beoordeling tegen: {codes:?}");
        assert!(codes.contains(&("testtekst", "let_op")), "{codes:?}");
        assert!(codes.contains(&("sleutel_in_project", "let_op")));
        assert!(!r.iter().any(|x| x.detail.as_deref() == Some("INTERNET") || x.detail.as_deref() == Some("CAMERA")));
    }

    #[test]
    fn slaat_afhankelijkheden_over() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join("src/node_modules/x")).unwrap();
        fs::write(d.path().join("src/node_modules/x/i.js"), "lorem ipsum").unwrap();
        let data = AppData { privacy_url: "https://mijnwinkel.nl/privacy".into(), ..Default::default() };
        assert!(scan(d.path(), &data, &[], &[]).is_empty());
    }
}
