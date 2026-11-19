//! Veilige namen voor een repository. Bewust strenger dan GitHub vraagt (de exacte regels van GitHub waren niet te controleren, zie docs/github.md).

pub const MAX_LEN: usize = 80;

fn plain(c: char) -> Option<char> {
    Some(match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
        'è' | 'é' | 'ê' | 'ë' => 'e',
        'ì' | 'í' | 'î' | 'ï' => 'i',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' => 'o',
        'ù' | 'ú' | 'û' | 'ü' => 'u',
        'ç' => 'c',
        'ñ' => 'n',
        'ß' => 's',
        c if c.is_ascii_alphanumeric() => c,
        _ => return None,
    })
}

/// Een veilige repository-naam uit de projectnaam: kleine letters, cijfers en streepjes, nooit leeg.
pub fn from_project(naam: &str) -> String {
    let mut out = String::new();
    for c in naam.to_lowercase().chars() {
        match plain(c) {
            Some(p) => out.push(p),
            None if !out.ends_with('-') && !out.is_empty() => out.push('-'),
            None => {}
        }
    }
    let t: String = out.trim_matches('-').chars().take(MAX_LEN).collect();
    let t = t.trim_end_matches('-').to_string();
    if t.is_empty() {
        "studio-project".into()
    } else {
        t
    }
}

/// Is dit een naam die Studio zelf zou kiezen? (Gebruikt voor invoer van de gebruiker en voordat er een URL wordt gebouwd.)
pub fn is_valid(naam: &str) -> bool {
    !naam.is_empty()
        && naam.len() <= MAX_LEN
        && naam.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && !naam.starts_with(['-', '_'])
}

/// Een eigenaarsnaam (accountnaam) zoals in een URL: letters, cijfers en streepjes.
pub fn is_valid_owner(naam: &str) -> bool {
    !naam.is_empty() && naam.len() <= 39 && naam.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && !naam.starts_with('-')
}

/// Naam van een bestaande repository (bij het ophalen): ook punten toegestaan, maar nooit `.` of `..`.
pub fn is_valid_existing(naam: &str) -> bool {
    !naam.is_empty() && naam.len() <= 100 && naam != "." && naam != ".." && naam.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// De remote-URL. Altijd zonder token of gebruikersnaam; `None` bij een ongeldige eigenaar of naam.
pub fn remote_url(base: &str, owner: &str, repo: &str) -> Option<String> {
    (is_valid_owner(owner) && is_valid_existing(repo)).then(|| format!("{}/{owner}/{repo}.git", base.trim_end_matches('/')))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maakt_een_veilige_naam_uit_de_projectnaam() {
        assert_eq!(from_project("Mijn Eerste App!"), "mijn-eerste-app");
        assert_eq!(from_project("  Café Ünïcode & Co. "), "cafe-unicode-co");
        assert_eq!(from_project("---"), "studio-project");
        assert_eq!(from_project(""), "studio-project");
        assert_eq!(from_project("日本語"), "studio-project");
        assert_eq!(from_project(&"a".repeat(300)).len(), MAX_LEN);
        for n in ["../../etc", "a b", ".x", "x/y", "x@y"] {
            assert!(is_valid(&from_project(n)), "{n}");
        }
    }

    #[test]
    fn controleert_namen_voor_een_url_is_opgebouwd() {
        assert!(is_valid("mijn-app_2"));
        assert!(!is_valid("-start") && !is_valid("a/b") && !is_valid("a@b") && !is_valid(""));
        assert!(is_valid_owner("pieter-k") && !is_valid_owner("a/b") && !is_valid_owner("a@b") && !is_valid_owner("a.b"));
        assert!(is_valid_existing("site.nl") && !is_valid_existing("..") && !is_valid_existing("a/b"));
        assert_eq!(remote_url("https://github.com", "pieter", "app").as_deref(), Some("https://github.com/pieter/app.git"));
        assert_eq!(remote_url("https://github.com", "ev@il", "app"), None);
        assert_eq!(remote_url("https://github.com", "pieter", "../x"), None);
        // Nooit een token of gebruikersnaam in de URL.
        assert!(!remote_url("https://github.com/", "a", "b").unwrap().contains('@'));
    }
}
