//! Controle van de unieke app-naam (applicationId voor Android, bundle-ID voor iPhone). Regels staan in `config/store-spec.json`
//! (`app_id`) met bron; hier alleen de controle zelf. Een gekozen ID kun je na de eerste upload nooit meer wijzigen: daarom streng.
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Oordeel {
    pub geldig: bool,
    /// Vaste code (nl.json: `winkels.appid.<code>`), leeg als alles klopt.
    pub code: &'static str,
    /// Geldig maar niet verstandig (bijvoorbeeld `com.example`).
    pub let_op: Option<&'static str>,
}

const JAVA_WOORDEN: &[&str] = &["abstract", "assert", "boolean", "break", "byte", "case", "catch", "char", "class", "const", "continue", "default", "do", "double", "else", "enum", "extends", "final", "finally", "float", "for", "goto", "if", "implements", "import", "instanceof", "int", "interface", "long", "native", "new", "package", "private", "protected", "public", "return", "short", "static", "strictfp", "super", "switch", "synchronized", "this", "throw", "throws", "transient", "try", "void", "volatile", "while", "true", "false", "null"];

fn ok(let_op: Option<&'static str>) -> Oordeel {
    Oordeel { geldig: true, code: "", let_op }
}
fn fout(code: &'static str) -> Oordeel {
    Oordeel { geldig: false, code, let_op: None }
}

fn voorbeeld_of_eigen(id: &str) -> Option<&'static str> {
    let l = id.to_lowercase();
    if l.starts_with("com.example.") || l == "com.example" || l.starts_with("org.example.") {
        Some("voorbeeld")
    } else if l.contains("flutter.app") || l.starts_with("com.android.") || l.starts_with("com.google.android.") || l.starts_with("com.apple.") {
        Some("gereserveerd")
    } else {
        None
    }
}

/// Android applicationId: minstens twee delen gescheiden door punten; elk deel begint met een letter en bevat alleen letters, cijfers en
/// liggende streepjes (underscores); geen gereserveerd Java-woord als deel.
pub fn android(id: &str) -> Oordeel {
    let id = id.trim();
    if id.is_empty() {
        return fout("leeg");
    }
    if id.len() > 155 {
        return fout("te_lang");
    }
    let delen: Vec<&str> = id.split('.').collect();
    if delen.len() < 2 {
        return fout("een_deel");
    }
    for d in &delen {
        if d.is_empty() {
            return fout("leeg_deel");
        }
        if !d.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) {
            return fout("begint_niet_met_letter");
        }
        if !d.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return fout("tekens");
        }
        if JAVA_WOORDEN.contains(&d.to_lowercase().as_str()) {
            return fout("gereserveerd_woord");
        }
    }
    if id.chars().any(|c| c.is_ascii_uppercase()) {
        return ok(Some("hoofdletters")); // kan, maar kleine letters zijn gebruikelijk en voorkomen verwarring
    }
    ok(voorbeeld_of_eigen(id))
}

/// Apple bundle-ID: letters, cijfers, streepjes en punten; omgekeerde domeinnaam met minstens twee delen.
pub fn ios(id: &str) -> Oordeel {
    let id = id.trim();
    if id.is_empty() {
        return fout("leeg");
    }
    if id.len() > 155 {
        return fout("te_lang");
    }
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.') {
        return fout("tekens");
    }
    let delen: Vec<&str> = id.split('.').collect();
    if delen.len() < 2 {
        return fout("een_deel");
    }
    if delen.iter().any(|d| d.is_empty()) {
        return fout("leeg_deel");
    }
    if delen.iter().any(|d| d.starts_with('-') || d.ends_with('-')) {
        return fout("streepje_rand");
    }
    ok(voorbeeld_of_eigen(id))
}

/// Een voorstel voor een ID uit een domeinnaam en een appnaam (`mijnwinkel.nl` + "Mijn App" → `nl.mijnwinkel.mijnapp`).
pub fn voorstel(domein: &str, naam: &str) -> String {
    let mut delen: Vec<String> = domein.trim().trim_start_matches("www.").split('.').filter(|d| !d.is_empty()).map(|d| d.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase()).filter(|d| !d.is_empty()).collect();
    delen.reverse();
    let app: String = naam.to_lowercase().chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let mut s = delen.join(".");
    if !s.is_empty() && !app.is_empty() {
        s.push('.');
    }
    s.push_str(&if app.is_empty() { "app".to_string() } else { app });
    // Een deel dat met een cijfer begint, krijgt een letter ervoor.
    s.split('.').map(|d| if d.chars().next().is_some_and(|c| c.is_ascii_digit()) { format!("a{d}") } else { d.to_string() }).collect::<Vec<_>>().join(".")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn android_geldig_en_ongeldig() {
        assert!(android("nl.mijnwinkel.app").geldig);
        assert!(android("com.bedrijf.mijn_app2").geldig);
        for (id, code) in [("", "leeg"), ("app", "een_deel"), ("nl..app", "leeg_deel"), ("nl.1winkel.app", "begint_niet_met_letter"), ("nl.mijn-winkel.app", "tekens"), ("nl.winkel.app!", "tekens"), ("nl.class.app", "gereserveerd_woord"), ("nl.ééé.app", "begint_niet_met_letter")] {
            let o = android(id);
            assert_eq!((o.geldig, o.code), (false, code), "{id}");
        }
        assert!(!android(&format!("nl.{}", "a".repeat(200))).geldig);
    }

    #[test]
    fn waarschuwt_voor_voorbeeld_gereserveerd_en_hoofdletters() {
        assert_eq!(android("com.example.app").let_op, Some("voorbeeld"));
        assert_eq!(android("com.android.iets").let_op, Some("gereserveerd"));
        assert_eq!(android("nl.Winkel.app").let_op, Some("hoofdletters"));
        assert_eq!(android("nl.winkel.app").let_op, None);
    }

    #[test]
    fn ios_regels() {
        assert!(ios("nl.mijnwinkel.app").geldig);
        assert!(ios("nl.mijn-winkel.App").geldig);
        for (id, code) in [("", "leeg"), ("app", "een_deel"), ("nl..app", "leeg_deel"), ("nl.winkel_app", "tekens"), ("nl.-winkel.app", "streepje_rand")] {
            assert_eq!((ios(id).geldig, ios(id).code), (false, code), "{id}");
        }
        assert_eq!(ios("com.example.app").let_op, Some("voorbeeld"));
    }

    #[test]
    fn maakt_een_voorstel_dat_geldig_is() {
        assert_eq!(voorstel("mijnwinkel.nl", "Mijn App!"), "nl.mijnwinkel.mijnapp");
        assert_eq!(voorstel("www.joke.nl", "2Go"), "nl.joke.a2go");
        assert_eq!(voorstel("", "Winkel"), "winkel");
        for (d, n) in [("mijnwinkel.nl", "Mijn App"), ("", "Een Ding"), ("a.b", "1x")] {
            let v = voorstel(d, n);
            if v.contains('.') {
                assert!(android(&v).geldig, "{v}");
            }
        }
    }
}
