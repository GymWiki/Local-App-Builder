//! Wanneer vragen we de gebruiker om toestemming? Gevaarlijke acties altijd; de rest hangt van de gekozen stand af.
use super::events::ActionKind;
use super::tools::Classified;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// "Vraag altijd": alles dat iets verandert of wegstuurt.
    Always,
    /// "Vraag alleen bij belangrijke dingen" (standaard).
    Important,
}

impl Mode {
    pub fn parse(s: Option<&str>) -> Mode {
        match s {
            Some("always") => Mode::Always,
            _ => Mode::Important,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Ask,
}

pub fn decide(mode: Mode, c: &Classified) -> Decision {
    // 1. Onomkeerbaar of naar buiten: altijd vragen, in elke stand.
    if c.danger || c.outside_project {
        return Decision::Ask;
    }
    match mode {
        Mode::Always => {
            if c.read_only {
                Decision::Allow
            } else {
                Decision::Ask
            }
        }
        // Gewoon bouwwerk (bestanden maken, controleren, installeren) mag door; onbekende opdrachten niet.
        Mode::Important => {
            if c.kind == ActionKind::RunCommand {
                Decision::Ask
            } else {
                Decision::Allow
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::tools::classify;
    use serde_json::json;
    use std::path::Path;

    fn d(tool: &str, input: serde_json::Value, mode: Mode) -> Decision {
        decide(mode, &classify(tool, &input, Path::new("/p")))
    }

    #[test]
    fn standaard_stand_is_belangrijke_dingen() {
        assert_eq!(Mode::parse(None), Mode::Important);
        assert_eq!(Mode::parse(Some("rommel")), Mode::Important);
        assert_eq!(Mode::parse(Some("always")), Mode::Always);
    }

    #[test]
    fn gevaarlijke_acties_vragen_altijd_in_beide_standen() {
        for mode in [Mode::Always, Mode::Important] {
            assert_eq!(
                d("Bash", json!({"command": "rm -rf dist"}), mode),
                Decision::Ask
            );
            assert_eq!(
                d("Bash", json!({"command": "git push"}), mode),
                Decision::Ask
            );
            assert_eq!(
                d("Bash", json!({"command": "npm publish"}), mode),
                Decision::Ask
            );
            assert_eq!(
                d("Write", json!({"file_path": "/etc/passwd"}), mode),
                Decision::Ask,
                "buiten het project"
            );
        }
    }

    #[test]
    fn belangrijke_dingen_laat_gewoon_bouwwerk_door() {
        assert_eq!(
            d(
                "Write",
                json!({"file_path": "/p/index.html"}),
                Mode::Important
            ),
            Decision::Allow
        );
        assert_eq!(
            d("Edit", json!({"file_path": "style.css"}), Mode::Important),
            Decision::Allow
        );
        assert_eq!(
            d("Bash", json!({"command": "npm install"}), Mode::Important),
            Decision::Allow
        );
        assert_eq!(
            d("Bash", json!({"command": "npm run build"}), Mode::Important),
            Decision::Allow
        );
        assert_eq!(
            d("Bash", json!({"command": "node maak.js"}), Mode::Important),
            Decision::Ask,
            "onbekende opdracht"
        );
    }

    #[test]
    fn vraag_altijd_vraagt_voor_alles_wat_iets_verandert_maar_niet_voor_lezen() {
        assert_eq!(
            d("Write", json!({"file_path": "/p/a.html"}), Mode::Always),
            Decision::Ask
        );
        assert_eq!(
            d("Bash", json!({"command": "npm install"}), Mode::Always),
            Decision::Ask
        );
        assert_eq!(
            d("Read", json!({"file_path": "/p/a.html"}), Mode::Always),
            Decision::Allow
        );
        assert_eq!(
            d("Grep", json!({"pattern": "x"}), Mode::Always),
            Decision::Allow
        );
        assert_eq!(
            d("Bash", json!({"command": "ls -la"}), Mode::Always),
            Decision::Allow
        );
    }
}
