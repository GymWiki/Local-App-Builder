use crate::error::Result;
use std::fs;
use std::path::Path;

/// De vaste werkwijze, ingebakken in de app (bron: skills/control-loop/instructions.md).
pub const CONTROL_LOOP: &str = include_str!("../../skills/control-loop/instructions.md");

/// Bestandsnamen per CLI: Claude, Gemini en Codex lezen elk hun eigen bestand.
pub const FILES: [&str; 3] = ["CLAUDE.md", "GEMINI.md", "AGENTS.md"];

const START: &str = "<!-- studio:control-loop:start (door Studio beheerd; eigen tekst hierbuiten blijft ongemoeid) -->";
const END: &str = "<!-- studio:control-loop:end -->";

fn block() -> String {
    format!("{START}\n{}\n{END}\n", CONTROL_LOOP.trim_end())
}

#[derive(Debug, PartialEq)]
pub enum Change {
    Created,
    Appended,
    Updated,
    Unchanged,
    /// Het bestand heeft een start- maar geen eindmarkering: we raken het niet aan.
    Skipped,
}

fn apply(existing: Option<&str>) -> (Option<String>, Change) {
    let block = block();
    let Some(text) = existing else {
        return (Some(block), Change::Created);
    };
    match (text.find("<!-- studio:control-loop:start"), text.find(END)) {
        (Some(s), Some(e)) if e > s => {
            let end = e + END.len();
            let tail = text[end..].strip_prefix('\n').unwrap_or(&text[end..]);
            let next = format!("{}{}{}", &text[..s], block, tail);
            if next == text {
                (None, Change::Unchanged)
            } else {
                (Some(next), Change::Updated)
            }
        }
        (Some(_), _) | (None, Some(_)) => (None, Change::Skipped),
        (None, None) => {
            let sep = if text.trim().is_empty() { "" } else { "\n\n" };
            (
                Some(format!("{}{}{}", text.trim_end(), sep, block)),
                Change::Appended,
            )
        }
    }
}

/// Zorgt dat CLAUDE.md, GEMINI.md en AGENTS.md de controle-loop bevatten. Eigen inhoud van de gebruiker blijft staan:
/// een bestaand bestand krijgt alleen ons gemarkeerde blok erbij (of ververst), nooit een overschrijving.
pub fn ensure(dir: &Path) -> Result<Vec<(&'static str, Change)>> {
    let mut out = Vec::new();
    for name in FILES {
        let path = dir.join(name);
        let existing = match fs::read_to_string(&path) {
            Ok(s) => Some(s),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.into()),
        };
        let (new, change) = apply(existing.as_deref());
        if let Some(content) = new {
            let tmp = path.with_extension("md.studio-tmp");
            fs::write(&tmp, content)?;
            fs::rename(&tmp, &path)?;
        }
        out.push((name, change));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maakt_drie_bestanden_met_gelijke_inhoud() {
        let d = tempfile::tempdir().unwrap();
        let r = ensure(d.path()).unwrap();
        assert!(r.iter().all(|(_, c)| *c == Change::Created));
        let a = fs::read_to_string(d.path().join("CLAUDE.md")).unwrap();
        assert_eq!(a, fs::read_to_string(d.path().join("GEMINI.md")).unwrap());
        assert_eq!(a, fs::read_to_string(d.path().join("AGENTS.md")).unwrap());
        assert!(
            a.contains("run_checks")
                && a.contains("get_preview_screenshot")
                && a.contains("git_checkpoint")
        );
    }

    #[test]
    fn is_idempotent() {
        let d = tempfile::tempdir().unwrap();
        ensure(d.path()).unwrap();
        let r = ensure(d.path()).unwrap();
        assert!(r.iter().all(|(_, c)| *c == Change::Unchanged));
    }

    #[test]
    fn eigen_tekst_blijft_staan_bij_toevoegen_en_verversen() {
        let d = tempfile::tempdir().unwrap();
        fs::write(
            d.path().join("CLAUDE.md"),
            "# Mijn regels\n\nGebruik tabs.\n",
        )
        .unwrap();
        ensure(d.path()).unwrap();
        let s = fs::read_to_string(d.path().join("CLAUDE.md")).unwrap();
        assert!(s.starts_with("# Mijn regels\n\nGebruik tabs."));
        assert!(s.contains("studio:control-loop:start"));

        // verouderd blok + tekst erna
        let stale = s.replace("Wijzig code", "OUD").to_string() + "\n## Na het blok\nblijft\n";
        fs::write(d.path().join("CLAUDE.md"), stale).unwrap();
        let r = ensure(d.path()).unwrap();
        assert_eq!(r[0].1, Change::Updated);
        let s2 = fs::read_to_string(d.path().join("CLAUDE.md")).unwrap();
        assert!(s2.contains("Wijzig code") && !s2.contains("OUD"));
        assert!(s2.starts_with("# Mijn regels") && s2.contains("## Na het blok\nblijft"));
    }

    #[test]
    fn half_gemarkeerd_bestand_blijft_onaangeroerd() {
        let d = tempfile::tempdir().unwrap();
        let kapot = "intro\n<!-- studio:control-loop:start x -->\nhandwerk zonder einde\n";
        fs::write(d.path().join("AGENTS.md"), kapot).unwrap();
        let r = ensure(d.path()).unwrap();
        assert_eq!(r[2].1, Change::Skipped);
        assert_eq!(
            fs::read_to_string(d.path().join("AGENTS.md")).unwrap(),
            kapot
        );
    }
}
