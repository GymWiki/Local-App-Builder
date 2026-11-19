//! Automatische versies: na elke afgeronde, geslaagde AI-beurt een git-checkpoint met een korte titel in gewone taal.
use super::Inner;
use serde_json::json;
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq)]
pub struct Version {
    pub hash: String,
    pub title: String,
}

/// Git-acties voor een project (in de app: via de Node-runtime).
pub trait Git: Send + Sync {
    /// De nieuwste versie (laatste commit), of `None` zonder versies of zonder runtime.
    fn head(&self, project: i64) -> Option<Version>;
    /// Zijn er wijzigingen die nog niet zijn opgeslagen?
    fn dirty(&self, project: i64) -> bool;
    /// Slaat alles op als nieuwe versie. `None` als er niets te bewaren viel of het mislukte.
    fn checkpoint(&self, project: i64, title: &str) -> Option<Version>;
}

pub const MAX_TITLE_WORDS: usize = 8;
const FALLBACK_TITLE: &str = "Wijzigingen aangebracht";

fn strip_markup(s: &str) -> String {
    s.chars()
        .filter(|c| !matches!(c, '*' | '`' | '#' | '_' | '>'))
        .collect::<String>()
}

fn first_sentences(text: &str) -> Vec<String> {
    // Een punt of uitroepteken telt alleen als zinseinde als er een spatie/regeleinde op volgt (dus niet in "index.html").
    let clean = strip_markup(text);
    let chars: Vec<char> = clean.chars().collect();
    let mut out = Vec::new();
    let mut cur = String::new();
    for (i, c) in chars.iter().enumerate() {
        let boundary = match c {
            '\n' => true,
            '.' | '!' | '?' | ':' => chars.get(i + 1).is_none_or(|n| n.is_whitespace()),
            _ => false,
        };
        if boundary {
            out.push(std::mem::take(&mut cur));
        } else {
            cur.push(*c);
        }
    }
    out.push(cur);
    out.into_iter()
        .map(|s| {
            s.trim()
                .trim_start_matches(['-', '•', ' '])
                .trim()
                .to_string()
        })
        .filter(|s| !s.is_empty())
        .collect()
}

/// Kapt een zin in tot maximaal `MAX_TITLE_WORDS` woorden, met hoofdletter en zonder eindleesteken.
pub fn clip_title(s: &str) -> String {
    let words: Vec<&str> = s.split_whitespace().take(MAX_TITLE_WORDS).collect();
    let joined = words.join(" ");
    let t = joined
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_string();
    let mut chars = t.chars();
    match chars.next() {
        Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

/// Titel voor een versie die de AI zelf niet heeft benoemd: de eerste echte zin van het antwoord (anders van de opdracht).
pub fn title_from(ai_text: Option<&str>, user_text: &str) -> String {
    let pick = |text: &str, min_words: usize| {
        first_sentences(text)
            .into_iter()
            .find(|s| s.split_whitespace().count() >= min_words)
    };
    let candidate = ai_text
        .and_then(|t| pick(t, 3))
        .or_else(|| pick(user_text, 2));
    let title = candidate.map(|c| clip_title(&c)).unwrap_or_default();
    if title.is_empty() {
        FALLBACK_TITLE.to_string()
    } else {
        title
    }
}

pub(super) struct TurnInfo {
    pub head: Option<String>,
    pub user_text: String,
}

/// Na een geslaagde beurt: nieuwe versie opslaan (of de versie van de AI zelf melden) en dat in de chat tonen.
pub(super) fn finish_turn(inner: &Arc<Inner>, project: i64, ai_text: Option<String>) {
    let Some(git) = inner.git.lock().unwrap().clone() else {
        return;
    };
    let info = inner.turns.lock().unwrap().remove(&project);
    let user_text = info
        .as_ref()
        .map(|i| i.user_text.clone())
        .unwrap_or_default();
    let head_before = info.and_then(|i| i.head);

    let version = if git.dirty(project) {
        git.checkpoint(project, &title_from(ai_text.as_deref(), &user_text))
    } else {
        // De AI heeft zelf een versie opgeslagen tijdens deze beurt?
        git.head(project)
            .filter(|h| Some(&h.hash) != head_before.as_ref())
    };
    if let Some(v) = version {
        // "Werkend" = de controles van deze reeks slaagden: dat is de versie waar de bug-lus bewaker naar terug kan.
        let working = inner
            .guards
            .lock()
            .unwrap()
            .get(&project)
            .is_some_and(|g| g.healthy);
        inner.push(
            project,
            "version",
            json!({ "hash": v.hash, "title": v.title, "working": working }),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titel_is_maximaal_acht_woorden_zonder_opmaak_en_met_hoofdletter() {
        assert_eq!(
            clip_title("een twee drie vier vijf zes zeven acht negen tien"),
            "Een twee drie vier vijf zes zeven acht"
        );
        assert_eq!(
            clip_title("  mooie pagina gemaakt!  "),
            "Mooie pagina gemaakt"
        );
        assert_eq!(
            title_from(
                Some("Klaar! Ik heb een bestelknop op de pagina gezet. Wil je meer?"),
                "x"
            ),
            "Ik heb een bestelknop op de pagina gezet"
        );
        assert_eq!(
            title_from(
                Some("**Klaar!**"),
                "Maak een website voor mijn bakkerij met een bestelknop"
            ),
            "Maak een website voor mijn bakkerij met een"
        );
        assert_eq!(title_from(None, ""), "Wijzigingen aangebracht");
        assert_eq!(title_from(Some("Klaar!"), "Ja"), "Wijzigingen aangebracht");
        for t in [
            title_from(
                Some("een twee drie vier vijf zes zeven acht negen tien elf"),
                "",
            ),
            title_from(None, "a b c d e f g h i j k l"),
        ] {
            assert!(t.split_whitespace().count() <= MAX_TITLE_WORDS, "{t}");
        }
    }

    #[test]
    fn punten_in_bestandsnamen_breken_een_zin_niet_af() {
        assert_eq!(
            title_from(
                Some("- `index.html` aangepast voor mobiel\n- iets anders"),
                ""
            ),
            "Index.html aangepast voor mobiel"
        );
    }
}
