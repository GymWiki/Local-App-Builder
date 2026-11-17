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
    /// Overleg-modus: schrijfacties worden zonder vraag geweigerd.
    Deny,
}

pub fn decide(mode: Mode, plan_mode: bool, c: &Classified) -> Decision {
    // Overleg-modus: het plan zelf mag de gebruiker goedkeuren; verder wordt alles geweigerd dat iets verandert of uitvoert.
    if plan_mode {
        if c.plan_exit {
            return Decision::Ask;
        }
        return if c.read_only {
            Decision::Allow
        } else {
            Decision::Deny
        };
    }
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
        decide(mode, false, &classify(tool, &input, Path::new("/p")))
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

    #[test]
    fn overleg_modus_weigert_schrijfacties_en_laat_lezen_en_het_plan_door() {
        let dec = |tool: &str, input: serde_json::Value| {
            decide(
                Mode::Important,
                true,
                &classify(tool, &input, Path::new("/p")),
            )
        };
        assert_eq!(
            dec("Write", json!({"file_path": "/p/a.html"})),
            Decision::Deny
        );
        assert_eq!(
            dec("Edit", json!({"file_path": "/p/a.html"})),
            Decision::Deny
        );
        assert_eq!(
            dec("Bash", json!({"command": "npm install"})),
            Decision::Deny
        );
        assert_eq!(
            dec("Bash", json!({"command": "rm -rf x"})),
            Decision::Deny,
            "ook gevaarlijk: geweigerd, niet gevraagd"
        );
        assert_eq!(
            dec("Read", json!({"file_path": "/p/a.html"})),
            Decision::Allow
        );
        assert_eq!(dec("Grep", json!({"pattern": "x"})), Decision::Allow);
        assert_eq!(
            dec("ExitPlanMode", json!({"plan": "x"})),
            Decision::Ask,
            "de gebruiker keurt het plan goed"
        );
        // ook in "vraag altijd" blijft dit gelden
        assert_eq!(
            decide(
                Mode::Always,
                true,
                &classify("Write", &json!({"file_path": "a"}), Path::new("/p"))
            ),
            Decision::Deny
        );
    }
}
