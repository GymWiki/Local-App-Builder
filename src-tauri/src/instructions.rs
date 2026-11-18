use crate::error::Result;
use std::fs;
use std::path::Path;

/// Een door Studio beheerd blok in een instructiebestand (CLAUDE.md / GEMINI.md / AGENTS.md).
pub struct Block {
    pub name: &'static str,
    pub body: &'static str,
}

/// De vaste werkwijze (bron: skills/control-loop/instructions.md). Staat er altijd in.
pub const CONTROL_LOOP: Block = Block {
    name: "control-loop",
    body: include_str!("../../skills/control-loop/instructions.md"),
};
/// "Zo praat je met de gebruiker" (bron: skills/eenvoudig-communiceren/instructions.md). Alleen in de stand "Eenvoudige taal".
pub const SIMPLE_TALK: Block = Block {
    name: "eenvoudig-communiceren",
    body: include_str!("../../skills/eenvoudig-communiceren/instructions.md"),
};

/// De veiligheidsregels voor Supabase (bron: skills/supabase-veilig/instructions.md). Alleen in projecten die aan Supabase gekoppeld zijn.
pub const SUPABASE_VEILIG: Block = Block {
    name: "supabase-veilig",
    body: include_str!("../../skills/supabase-veilig/instructions.md"),
};
const SUPABASE_SKILL: &str = include_str!("../../skills/supabase-veilig/SKILL.md");
const SUPABASE_SKILL_MARKER: &str = "<!-- studio:managed:supabase-veilig";
/// De skill voor e-mail-inloggen: alleen op verzoek van de gebruiker (zie `ensure_auth_skill`).
const AUTH_SKILL: &str = include_str!("../../skills/supabase-inloggen/SKILL.md");
const AUTH_SKILL_MARKER: &str = "<!-- studio:managed:supabase-inloggen";

/// Inhoud van het skill-bestand `.claude/skills/eenvoudig-communiceren/SKILL.md`.
pub const SKILL_FILE: &str = include_str!("../../skills/eenvoudig-communiceren/SKILL.md");
const SKILL_MARKER: &str = "<!-- studio:managed:eenvoudig-communiceren";

/// Bestandsnamen per CLI: Claude, Gemini en Codex lezen elk hun eigen bestand.
pub const FILES: [&str; 3] = ["CLAUDE.md", "GEMINI.md", "AGENTS.md"];

fn start_prefix(b: &Block) -> String {
    format!("<!-- studio:{}:start", b.name)
}
fn start_marker(b: &Block) -> String {
    format!(
        "{} (door Studio beheerd; eigen tekst hierbuiten blijft ongemoeid) -->",
        start_prefix(b)
    )
}
fn end_marker(b: &Block) -> String {
    format!("<!-- studio:{}:end -->", b.name)
}
fn render(b: &Block) -> String {
    format!(
        "{}\n{}\n{}\n",
        start_marker(b),
        b.body.trim_end(),
        end_marker(b)
    )
}

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Change {
    Created,
    Appended,
    Updated,
    Unchanged,
    Removed,
    /// Het bestand heeft een start- maar geen eindmarkering (of andersom): we raken het niet aan.
    Skipped,
}

/// Past één blok toe op de tekst van een bestand. `want == false` haalt ons blok weg (en niets anders).
fn apply(existing: Option<&str>, block: &Block, want: bool) -> (Option<String>, Change) {
    let (sp, em) = (start_prefix(block), end_marker(block));
    let Some(text) = existing else {
        return if want {
            (Some(render(block)), Change::Created)
        } else {
            (None, Change::Unchanged)
        };
    };
    match (text.find(&sp), text.find(&em)) {
        (Some(s), Some(e)) if e > s => {
            let end = e + em.len();
            let tail = text[end..].strip_prefix('\n').unwrap_or(&text[end..]);
            if want {
                let next = format!("{}{}{}", &text[..s], render(block), tail);
                if next == text {
                    (None, Change::Unchanged)
                } else {
                    (Some(next), Change::Updated)
                }
            } else {
                let head = text[..s].trim_end_matches('\n');
                let rest = tail.trim_start_matches('\n');
                let next = match (head.is_empty(), rest.is_empty()) {
                    (true, true) => String::new(),
                    (true, false) => rest.to_string(),
                    (false, true) => format!("{head}\n"),
                    (false, false) => format!("{head}\n\n{rest}"),
                };
                (Some(next), Change::Removed)
            }
        }
        (Some(_), _) | (None, Some(_)) => (None, Change::Skipped),
        (None, None) => {
            if !want {
                return (None, Change::Unchanged);
            }
            let sep = if text.trim().is_empty() { "" } else { "\n\n" };
            (
                Some(format!("{}{}{}", text.trim_end(), sep, render(block))),
                Change::Appended,
            )
        }
    }
}

fn read_opt(path: &Path) -> Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn write_atomic(path: &Path, content: &str) -> Result<()> {
    if let Some(p) = path.parent() {
        fs::create_dir_all(p)?;
    }
    let tmp = path.with_extension("md.studio-tmp");
    fs::write(&tmp, content)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

/// Zorgt dat CLAUDE.md, GEMINI.md en AGENTS.md de werkwijze bevatten, en (alleen in `simple`) ook "Zo praat je met de gebruiker".
/// Eigen inhoud van de gebruiker blijft staan: er wordt alleen een afgebakend blok toegevoegd, ververst of verwijderd.
/// Geeft per bestand terug wat er veranderde (het "sterkste" van de twee blokken).
pub fn ensure(dir: &Path, simple: bool) -> Result<Vec<(&'static str, Change)>> {
    let mut out = Vec::new();
    for name in FILES {
        let path = dir.join(name);
        let existing = read_opt(&path)?;
        let (a, ca) = apply(existing.as_deref(), &CONTROL_LOOP, true);
        let after_a = a.clone().or_else(|| existing.clone());
        let (b, cb) = apply(after_a.as_deref(), &SIMPLE_TALK, simple);
        let final_text = b.or(a);
        if let Some(content) = final_text {
            if content.trim().is_empty() {
                let _ = fs::remove_file(&path); // er stond alleen ons blok in
            } else {
                write_atomic(&path, &content)?;
            }
        }
        let change = if existing.is_none() {
            Change::Created
        } else if matches!(ca, Change::Skipped) || matches!(cb, Change::Skipped) {
            Change::Skipped
        } else if ca == Change::Unchanged && cb == Change::Unchanged {
            Change::Unchanged
        } else if cb == Change::Removed {
            Change::Removed
        } else if ca == Change::Appended || cb == Change::Appended {
            Change::Appended
        } else {
            Change::Updated
        };
        out.push((name, change));
    }
    ensure_skill(dir, simple)?;
    Ok(out)
}

/// Zet (of haalt weg) het blok "supabase-veilig" in CLAUDE.md, GEMINI.md en AGENTS.md plus de skill. Raakt alleen eigen blokken aan.
pub fn ensure_supabase(dir: &Path, want: bool) -> Result<()> {
    for name in FILES {
        let path = dir.join(name);
        let existing = read_opt(&path)?;
        let (next, _) = apply(existing.as_deref(), &SUPABASE_VEILIG, want);
        if let Some(content) = next {
            if content.trim().is_empty() {
                let _ = fs::remove_file(&path);
            } else {
                write_atomic(&path, &content)?;
            }
        }
    }
    managed_skill(dir, "supabase-veilig", SUPABASE_SKILL, SUPABASE_SKILL_MARKER, want)
}

/// De skill voor e-mail-inloggen toevoegen of weghalen (alleen als de gebruiker inloggen kiest).
pub fn ensure_auth_skill(dir: &Path, want: bool) -> Result<()> {
    managed_skill(dir, "supabase-inloggen", AUTH_SKILL, AUTH_SKILL_MARKER, want)
}

/// Een skill-bestand dat Studio beheert. Een bestand zonder onze markering is van de gebruiker en blijft altijd ongemoeid.
fn managed_skill(dir: &Path, naam: &str, inhoud: &str, marker: &str, want: bool) -> Result<()> {
    let path = dir.join(".claude").join("skills").join(naam).join("SKILL.md");
    let existing = read_opt(&path)?;
    match (&existing, want) {
        (None, true) => write_atomic_any(&path, inhoud),
        (Some(t), _) if !t.contains(marker) => Ok(()),
        (Some(t), true) => {
            if t != inhoud {
                write_atomic_any(&path, inhoud)?;
            }
            Ok(())
        }
        (Some(_), false) => {
            let _ = fs::remove_file(&path);
            if let Some(d) = path.parent() {
                let _ = fs::remove_dir(d);
            }
            Ok(())
        }
        (None, false) => Ok(()),
    }
}

/// `.claude/skills/eenvoudig-communiceren/SKILL.md`: alleen in de stand "Eenvoudige taal". Een bestand zonder onze
/// markering is van de gebruiker en blijft altijd ongemoeid.
pub fn ensure_skill(dir: &Path, simple: bool) -> Result<Change> {
    let path = dir
        .join(".claude")
        .join("skills")
        .join("eenvoudig-communiceren")
        .join("SKILL.md");
    let existing = read_opt(&path)?;
    match (&existing, simple) {
        (None, true) => {
            write_atomic_any(&path, SKILL_FILE)?;
            Ok(Change::Created)
        }
        (None, false) => Ok(Change::Unchanged),
        (Some(t), _) if !t.contains(SKILL_MARKER) => Ok(Change::Skipped),
        (Some(t), true) => {
            if t == SKILL_FILE {
                Ok(Change::Unchanged)
            } else {
                write_atomic_any(&path, SKILL_FILE)?;
                Ok(Change::Updated)
            }
        }
        (Some(_), false) => {
            let _ = fs::remove_file(&path);
            // lege mappen opruimen die wij aanmaakten
            if let Some(d) = path.parent() {
                let _ = fs::remove_dir(d);
                if let Some(skills) = d.parent() {
                    let _ = fs::remove_dir(skills);
                    if let Some(claude) = skills.parent() {
                        let _ = fs::remove_dir(claude);
                    }
                }
            }
            Ok(Change::Removed)
        }
    }
}

fn write_atomic_any(path: &Path, content: &str) -> Result<()> {
    if let Some(p) = path.parent() {
        fs::create_dir_all(p)?;
    }
    let tmp = path.with_extension("studio-tmp");
    fs::write(&tmp, content)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(d: &Path, f: &str) -> String {
        fs::read_to_string(d.join(f)).unwrap()
    }

    #[test]
    fn maakt_drie_bestanden_met_gelijke_inhoud_en_beide_blokken_in_eenvoudige_stand() {
        let d = tempfile::tempdir().unwrap();
        let res = ensure(d.path(), true).unwrap();
        assert!(res.iter().all(|(_, c)| *c == Change::Created));
        let a = r(d.path(), "CLAUDE.md");
        assert_eq!(a, r(d.path(), "GEMINI.md"));
        assert_eq!(a, r(d.path(), "AGENTS.md"));
        assert!(
            a.contains("run_checks")
                && a.contains("get_preview_screenshot")
                && a.contains("git_checkpoint")
        );
        assert!(
            a.contains("Zo praat je met de gebruiker")
                && a.contains("studio:eenvoudig-communiceren:start")
        );
    }

    #[test]
    fn technische_stand_laat_de_communicatie_instructie_weg() {
        let d = tempfile::tempdir().unwrap();
        ensure(d.path(), false).unwrap();
        let a = r(d.path(), "CLAUDE.md");
        assert!(a.contains("run_checks") && !a.contains("Zo praat je met de gebruiker"));
        assert!(!d
            .path()
            .join(".claude/skills/eenvoudig-communiceren/SKILL.md")
            .exists());
    }

    #[test]
    fn schakelen_tussen_standen_voegt_toe_en_verwijdert_alleen_ons_blok() {
        let d = tempfile::tempdir().unwrap();
        fs::write(
            d.path().join("CLAUDE.md"),
            "# Mijn regels\n\nGebruik tabs.\n",
        )
        .unwrap();
        ensure(d.path(), true).unwrap();
        let on = r(d.path(), "CLAUDE.md");
        assert!(
            on.starts_with("# Mijn regels\n\nGebruik tabs.")
                && on.contains("Zo praat je met de gebruiker")
        );

        ensure(d.path(), false).unwrap();
        let off = r(d.path(), "CLAUDE.md");
        assert!(
            off.starts_with("# Mijn regels\n\nGebruik tabs."),
            "eigen tekst blijft staan"
        );
        assert!(!off.contains("Zo praat je met de gebruiker") && off.contains("run_checks"));

        ensure(d.path(), true).unwrap();
        assert_eq!(
            r(d.path(), "CLAUDE.md"),
            on,
            "terugschakelen geeft exact hetzelfde resultaat"
        );
    }

    #[test]
    fn is_idempotent() {
        let d = tempfile::tempdir().unwrap();
        ensure(d.path(), true).unwrap();
        let before = r(d.path(), "AGENTS.md");
        let res = ensure(d.path(), true).unwrap();
        assert!(res.iter().all(|(_, c)| *c == Change::Unchanged));
        assert_eq!(r(d.path(), "AGENTS.md"), before);
    }

    #[test]
    fn eigen_tekst_voor_en_na_het_blok_blijft_bij_verversen() {
        let d = tempfile::tempdir().unwrap();
        fs::write(
            d.path().join("CLAUDE.md"),
            "# Mijn regels\n\nGebruik tabs.\n",
        )
        .unwrap();
        ensure(d.path(), true).unwrap();
        let stale =
            r(d.path(), "CLAUDE.md").replace("Wijzig code", "OUD") + "\n## Na het blok\nblijft\n";
        fs::write(d.path().join("CLAUDE.md"), stale).unwrap();
        let res = ensure(d.path(), true).unwrap();
        assert_eq!(res[0].1, Change::Updated);
        let s = r(d.path(), "CLAUDE.md");
        assert!(s.contains("Wijzig code") && !s.contains("OUD"));
        assert!(s.starts_with("# Mijn regels") && s.contains("## Na het blok\nblijft"));
    }

    #[test]
    fn bestand_dat_alleen_ons_blok_had_wordt_opgeruimd_bij_het_weglaten() {
        let d = tempfile::tempdir().unwrap();
        let (text, ch) = apply(None, &SIMPLE_TALK, true);
        assert_eq!(ch, Change::Created);
        let (gone, ch) = apply(text.as_deref(), &SIMPLE_TALK, false);
        assert_eq!((gone.as_deref(), ch), (Some(""), Change::Removed));
        let _ = d;
    }

    #[test]
    fn half_gemarkeerd_bestand_blijft_onaangeroerd() {
        let d = tempfile::tempdir().unwrap();
        let kapot = "intro\n<!-- studio:control-loop:start x -->\nhandwerk zonder einde\n";
        fs::write(d.path().join("AGENTS.md"), kapot).unwrap();
        let res = ensure(d.path(), true).unwrap();
        assert_eq!(res[2].1, Change::Skipped);
        assert!(
            r(d.path(), "AGENTS.md").starts_with(kapot.trim_end_matches('\n')),
            "controle-loop-blok niet aangeraakt"
        );
    }

    #[test]
    fn skill_bestand_wordt_geschreven_ververst_en_verwijderd_maar_eigen_skill_blijft() {
        let d = tempfile::tempdir().unwrap();
        let p = d
            .path()
            .join(".claude/skills/eenvoudig-communiceren/SKILL.md");
        ensure(d.path(), true).unwrap();
        let s = fs::read_to_string(&p).unwrap();
        assert!(
            s.starts_with("---\nname: eenvoudig-communiceren\ndescription:"),
            "frontmatter volgens de Claude-docs"
        );
        assert!(s.contains("Zo praat je met de gebruiker"));
        fs::write(&p, s.replace("Gewoon Nederlands", "OUD")).unwrap();
        assert_eq!(ensure_skill(d.path(), true).unwrap(), Change::Updated);
        assert_eq!(fs::read_to_string(&p).unwrap(), SKILL_FILE);
        assert_eq!(ensure_skill(d.path(), false).unwrap(), Change::Removed);
        assert!(
            !p.exists() && !d.path().join(".claude").exists(),
            "lege mappen opgeruimd"
        );

        // eigen skill met dezelfde naam (zonder onze markering): nooit aanraken
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(
            &p,
            "---\nname: eenvoudig-communiceren\n---\nmijn eigen tekst\n",
        )
        .unwrap();
        assert_eq!(ensure_skill(d.path(), true).unwrap(), Change::Skipped);
        assert_eq!(ensure_skill(d.path(), false).unwrap(), Change::Skipped);
        assert!(fs::read_to_string(&p).unwrap().contains("mijn eigen tekst"));
    }

    #[test]
    fn skill_bestand_in_de_repo_bevat_de_instructie_zodat_ze_niet_uit_elkaar_lopen() {
        assert!(SKILL_FILE.contains(SIMPLE_TALK.body.trim_end()));
        assert!(SKILL_FILE.contains(SKILL_MARKER));
    }
}
