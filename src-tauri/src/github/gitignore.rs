//! Controleert en herstelt het `.gitignore`-bestand van het project, zodat dingen die nooit online horen (afhankelijkheden,
//! uitvoer van bouwen, geheimen, lokale databases) niet per ongeluk in een versie belanden. We voegen alleen een afgebakend blok toe;
//! regels van de gebruiker blijven staan. Bestanden die al in eerdere versies zitten, worden niet automatisch verwijderd.
use std::fs;
use std::path::Path;

pub const BEGIN: &str = "# >>> Studio (automatisch, niet bewerken) >>>";
pub const END: &str = "# <<< Studio <<<";

/// De regels die we altijd willen, met een korte uitleg per groep.
pub const REGELS: &[&str] = &[
    "node_modules/",
    "dist/",
    "build/",
    ".dart_tool/",
    ".gradle/",
    "target/",
    "coverage/",
    ".env",
    ".env.*",
    "!.env.example",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "*.jks",
    "*.keystore",
    "key.properties",
    "local.properties",
    "*.sqlite",
    "*.sqlite3",
    "*.db",
    ".studio/",
    ".DS_Store",
];

fn present(inhoud: &str) -> Vec<String> {
    inhoud.lines().map(|l| l.trim().trim_start_matches('/').to_string()).collect()
}

/// De regels die ontbreken (in het bestaande bestand of de eigen blok).
pub fn ontbrekend(dir: &Path) -> Vec<&'static str> {
    let inhoud = fs::read_to_string(dir.join(".gitignore")).unwrap_or_default();
    let al = present(&inhoud);
    REGELS
        .iter()
        .copied()
        .filter(|r| {
            let kaal = r.trim_end_matches('/');
            !al.iter().any(|a| a == r || a.trim_end_matches('/') == kaal)
        })
        .collect()
}

/// Voegt wat ontbreekt toe in het Studio-blok. Geeft de toegevoegde regels terug. Bestaande regels worden nooit gewijzigd.
pub fn herstel(dir: &Path) -> std::io::Result<Vec<&'static str>> {
    let ontbreekt = ontbrekend(dir);
    if ontbreekt.is_empty() {
        return Ok(vec![]);
    }
    let pad = dir.join(".gitignore");
    let oud = fs::read_to_string(&pad).unwrap_or_default();
    let (voor, blok_regels, na) = split_blok(&oud);
    let mut regels: Vec<String> = blok_regels;
    for r in &ontbreekt {
        if !regels.iter().any(|x| x == r) {
            regels.push((*r).to_string());
        }
    }
    let mut nieuw = String::new();
    nieuw.push_str(voor.trim_end_matches('\n'));
    if !nieuw.is_empty() {
        nieuw.push_str("\n\n");
    }
    nieuw.push_str(BEGIN);
    nieuw.push('\n');
    for r in &regels {
        nieuw.push_str(r);
        nieuw.push('\n');
    }
    nieuw.push_str(END);
    nieuw.push('\n');
    if !na.trim().is_empty() {
        nieuw.push('\n');
        nieuw.push_str(na.trim_start_matches('\n'));
    }
    fs::write(pad, nieuw)?;
    Ok(ontbreekt)
}

fn split_blok(s: &str) -> (String, Vec<String>, String) {
    match (s.find(BEGIN), s.find(END)) {
        (Some(b), Some(e)) if e > b => {
            let voor = s[..b].to_string();
            let binnen: Vec<String> = s[b + BEGIN.len()..e].lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
            let na = s[e + END.len()..].to_string();
            (voor, binnen, na)
        }
        _ => (s.to_string(), vec![], String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maakt_een_gitignore_met_alle_veilige_regels() {
        let d = tempfile::tempdir().unwrap();
        let toegevoegd = herstel(d.path()).unwrap();
        assert_eq!(toegevoegd.len(), REGELS.len());
        let t = fs::read_to_string(d.path().join(".gitignore")).unwrap();
        for r in ["node_modules/", ".env", ".env.*", "*.sqlite", ".studio/", "*.keystore"] {
            assert!(t.lines().any(|l| l == r), "{r}");
        }
        assert!(t.starts_with(BEGIN) && t.trim_end().ends_with(END));
        assert!(ontbrekend(d.path()).is_empty());
    }

    #[test]
    fn laat_regels_van_de_gebruiker_staan_en_voegt_alleen_toe_wat_ontbreekt() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join(".gitignore"), "# mijn regels\nnode_modules\n/dist\n.env\nmijn-geheime-map/\n").unwrap();
        let toegevoegd = herstel(d.path()).unwrap();
        assert!(!toegevoegd.contains(&"node_modules/") && !toegevoegd.contains(&"dist/") && !toegevoegd.contains(&".env"));
        assert!(toegevoegd.contains(&"build/") && toegevoegd.contains(&"*.pem"));
        let t = fs::read_to_string(d.path().join(".gitignore")).unwrap();
        assert!(t.starts_with("# mijn regels\nnode_modules\n/dist\n.env\nmijn-geheime-map/\n"), "{t}");
    }

    #[test]
    fn is_herhaalbaar_en_werkt_het_eigen_blok_bij() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join(".gitignore"), "alles\n").unwrap();
        herstel(d.path()).unwrap();
        let eerste = fs::read_to_string(d.path().join(".gitignore")).unwrap();
        assert!(herstel(d.path()).unwrap().is_empty());
        assert_eq!(fs::read_to_string(d.path().join(".gitignore")).unwrap(), eerste);
        // Een oud blok met minder regels wordt aangevuld, nooit verdubbeld.
        fs::write(d.path().join(".gitignore"), format!("alles\n\n{BEGIN}\nnode_modules/\n{END}\n\nna-mijn-blok\n")).unwrap();
        herstel(d.path()).unwrap();
        let t = fs::read_to_string(d.path().join(".gitignore")).unwrap();
        assert_eq!(t.matches(BEGIN).count(), 1);
        assert_eq!(t.matches("node_modules/").count(), 1);
        assert!(t.contains("na-mijn-blok"));
    }
}
