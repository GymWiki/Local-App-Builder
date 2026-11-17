//! Bestanden die de gebruiker in de chat sleept of plakt: veilig opslaan in `assets/` van het project.
//! Beperkt in grootte en type, met controle op de echte inhoud (niet alleen de extensie) en op padtruc's.
use crate::error::{AppError, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

pub const ASSETS_DIR: &str = "assets";
pub const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_DOC_BYTES: usize = 5 * 1024 * 1024;
/// Grootste afbeelding die als miniatuur (data-URL) naar de UI gaat.
pub const MAX_THUMB_BYTES: u64 = 3 * 1024 * 1024;

const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];
const DOC_EXT: &[&str] = &["pdf", "txt", "md", "csv", "json"];

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Saved {
    /// Relatief pad in het project, met `/`: bijv. "assets/foto.png".
    pub path: String,
    pub name: String,
    /// "image" of "document"
    pub kind: String,
    pub size: usize,
}

fn invalid(msg: &str) -> AppError {
    AppError::Invalid(msg.to_string())
}

/// Veilige bestandsnaam: alleen de laatste padcomponent, geen rare tekens, geen verborgen bestand, niet te lang.
pub fn sanitize_name(name: &str) -> (String, String) {
    let last = name.rsplit(['/', '\\']).next().unwrap_or("");
    let (stem, ext) = match last.rsplit_once('.') {
        Some((s, e)) => (s, e.to_lowercase()),
        None => (last, String::new()),
    };
    let clean: String = stem
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '-' | '_' | ' ') {
                c
            } else {
                '-'
            }
        })
        .collect();
    let mut stem = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    stem = stem.trim_matches(|c| c == '-' || c == ' ').to_string();
    if stem.is_empty() {
        stem = "bestand".into();
    }
    let stem: String = stem.chars().take(60).collect();
    (stem, ext)
}

fn starts(bytes: &[u8], magic: &[u8]) -> bool {
    bytes.len() >= magic.len() && &bytes[..magic.len()] == magic
}

/// Klopt de inhoud met het opgegeven type? Voorkomt dat een programma als "foto.png" binnenkomt.
fn content_matches(ext: &str, b: &[u8]) -> bool {
    match ext {
        "png" => starts(b, &[0x89, b'P', b'N', b'G']),
        "jpg" | "jpeg" => starts(b, &[0xFF, 0xD8, 0xFF]),
        "gif" => starts(b, b"GIF8"),
        "webp" => b.len() > 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP",
        "pdf" => starts(b, b"%PDF"),
        "txt" | "md" | "csv" | "json" => std::str::from_utf8(b).is_ok() && !b.contains(&0),
        _ => false,
    }
}

fn limit_for(ext: &str) -> usize {
    if IMAGE_EXT.contains(&ext) {
        MAX_IMAGE_BYTES
    } else {
        MAX_DOC_BYTES
    }
}

pub fn kind_of(ext: &str) -> &'static str {
    if IMAGE_EXT.contains(&ext) {
        "image"
    } else {
        "document"
    }
}

/// De map `assets/` van het project (aangemaakt als dat nodig is). Weigert een symlink of een map buiten het project.
fn assets_dir(project: &Path) -> Result<PathBuf> {
    let dir = project.join(ASSETS_DIR);
    match fs::symlink_metadata(&dir) {
        Ok(m) if m.file_type().is_symlink() => {
            return Err(invalid(
                "De map ‘assets’ is een snelkoppeling; die gebruik ik niet.",
            ))
        }
        Ok(m) if !m.is_dir() => {
            return Err(invalid(
                "Er staat al een bestand met de naam ‘assets’ in je project.",
            ))
        }
        Ok(_) => {}
        Err(_) => fs::create_dir_all(&dir)?,
    }
    let real = dir.canonicalize()?;
    if !real.starts_with(project.canonicalize()?) {
        return Err(invalid("De map ‘assets’ ligt buiten je project."));
    }
    Ok(real)
}

/// Slaat een bestand op in `assets/`. Geeft het (relatieve) pad terug dat naar de AI gaat.
pub fn save(project: &Path, file_name: &str, bytes: &[u8]) -> Result<Saved> {
    let (stem, ext) = sanitize_name(file_name);
    if !IMAGE_EXT.contains(&ext.as_str()) && !DOC_EXT.contains(&ext.as_str()) {
        return Err(invalid("Dit bestandstype kan ik niet gebruiken. Kies een afbeelding (png, jpg, gif, webp) of een document (pdf, txt, md, csv, json)."));
    }
    if bytes.is_empty() {
        return Err(invalid("Dit bestand is leeg."));
    }
    let max = limit_for(&ext);
    if bytes.len() > max {
        return Err(AppError::Invalid(format!(
            "Dit bestand is te groot (maximaal {} MB).",
            max / 1024 / 1024
        )));
    }
    if !content_matches(&ext, bytes) {
        return Err(invalid(
            "De inhoud van dit bestand past niet bij het type. Ik sla het daarom niet op.",
        ));
    }
    let dir = assets_dir(project)?;
    let mut name = format!("{stem}.{ext}");
    let mut n = 2;
    while dir.join(&name).exists() {
        name = format!("{stem}-{n}.{ext}");
        n += 1;
    }
    let target = dir.join(&name);
    let tmp = dir.join(format!(".{name}.studio-tmp"));
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, &target)?;
    Ok(Saved {
        path: format!("{ASSETS_DIR}/{name}"),
        name,
        kind: kind_of(&ext).into(),
        size: bytes.len(),
    })
}

/// Decodeert base64 van de UI, met een grenscontrole vóór het decoderen.
pub fn save_base64(project: &Path, file_name: &str, data: &str) -> Result<Saved> {
    if data.len() > MAX_IMAGE_BYTES * 4 / 3 + 16 {
        return Err(AppError::Invalid(format!(
            "Dit bestand is te groot (maximaal {} MB).",
            MAX_IMAGE_BYTES / 1024 / 1024
        )));
    }
    let bytes = B64
        .decode(data.trim())
        .map_err(|_| invalid("Dit bestand kon niet worden gelezen."))?;
    save(project, file_name, &bytes)
}

/// Controleert dat `rel` een bestaand, gewoon bestand is binnen `assets/` (of `.studio/picks/`) en geeft het volledige pad terug.
pub fn resolve_asset(project: &Path, rel: &str) -> Result<PathBuf> {
    if rel.contains('\0') || rel.len() > 300 {
        return Err(invalid("Ongeldig pad."));
    }
    let norm = rel.replace('\\', "/");
    let path = Path::new(&norm);
    if path.is_absolute() || norm.starts_with('/') {
        return Err(invalid("Alleen bestanden uit je project zijn toegestaan."));
    }
    let comps: Vec<String> = path
        .components()
        .map(|c| match c {
            Component::Normal(s) => Ok(s.to_string_lossy().to_string()),
            _ => Err(invalid("Ongeldig pad.")),
        })
        .collect::<Result<_>>()?;
    let allowed = matches!(comps.first().map(String::as_str), Some("assets"))
        || (comps.len() > 2 && comps[0] == ".studio" && comps[1] == "picks");
    if !allowed || comps.len() < 2 {
        return Err(invalid(
            "Alleen bestanden uit de map ‘assets’ zijn toegestaan.",
        ));
    }
    let full = project.join(comps.join("/"));
    let meta =
        fs::symlink_metadata(&full).map_err(|_| invalid("Dit bestand bestaat niet (meer)."))?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(invalid("Dit is geen gewoon bestand."));
    }
    let real = full.canonicalize()?;
    if !real.starts_with(project.canonicalize()?) {
        return Err(invalid("Dit bestand ligt buiten je project."));
    }
    Ok(real)
}

/// Miniatuur voor in de chat: een data-URL voor afbeeldingen tot 3 MB, anders `None`.
pub fn thumbnail(project: &Path, rel: &str) -> Result<Option<String>> {
    let full = resolve_asset(project, rel)?;
    let ext = full
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !IMAGE_EXT.contains(&ext.as_str()) || full.metadata()?.len() > MAX_THUMB_BYTES {
        return Ok(None);
    }
    let mime = match ext.as_str() {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/jpeg",
    };
    Ok(Some(format!(
        "data:{mime};base64,{}",
        B64.encode(fs::read(full)?)
    )))
}

/// Tekst die achter de opdracht aan de AI wordt gezet.
pub fn prompt_suffix(paths: &[String]) -> String {
    if paths.is_empty() {
        return String::new();
    }
    let list = paths
        .iter()
        .map(|p| format!("- {p}"))
        .collect::<Vec<_>>()
        .join("\n");
    format!("\n\nBijgevoegde bestanden (staan in de projectmap, lees ze met je leestool):\n{list}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];
    const JPG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10];

    fn project() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn slaat_een_afbeelding_op_in_assets_met_relatief_pad_en_botsingen_worden_nummers() {
        let p = project();
        let a = save(p.path(), "Mijn foto (1).PNG", PNG).unwrap();
        assert_eq!(
            (a.path.as_str(), a.kind.as_str(), a.size),
            ("assets/Mijn foto -1.png", "image", PNG.len())
        );
        assert!(p.path().join(&a.path).is_file());
        let b = save(p.path(), "Mijn foto (1).png", PNG).unwrap();
        assert_eq!(b.path, "assets/Mijn foto -1-2.png");
        assert_ne!(a.path, b.path);
        // geen tijdelijke bestanden achtergebleven
        let rest: Vec<_> = fs::read_dir(p.path().join("assets"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert!(rest.iter().all(|n| !n.ends_with(".studio-tmp")), "{rest:?}");
    }

    #[test]
    fn documenten_en_toegestane_types() {
        let p = project();
        assert_eq!(
            save(p.path(), "notities.txt", "hallo wereld".as_bytes())
                .unwrap()
                .kind,
            "document"
        );
        assert_eq!(
            save(p.path(), "data.csv", b"a,b\n1,2\n").unwrap().path,
            "assets/data.csv"
        );
        assert_eq!(
            save(p.path(), "boek.pdf", b"%PDF-1.7 ...").unwrap().kind,
            "document"
        );
        assert_eq!(save(p.path(), "foto.jpeg", JPG).unwrap().kind, "image");
        assert_eq!(
            save(p.path(), "ï.json", b"{}").unwrap().path,
            "assets/ï.json",
            "unicode in namen mag"
        );
    }

    #[test]
    fn gevaarlijke_types_worden_geweigerd_ook_met_een_dubbele_extensie() {
        let p = project();
        for naam in [
            "virus.exe",
            "script.js",
            "pagina.html",
            "plaatje.svg",
            "run.sh",
            "x.php",
            "geen-extensie",
            "x.png.exe",
            "archief.zip",
        ] {
            let e = save(p.path(), naam, PNG).unwrap_err().to_string();
            assert!(e.contains("bestandstype"), "{naam}: {e}");
        }
        assert!(
            !p.path().join("assets").exists()
                || fs::read_dir(p.path().join("assets")).unwrap().count() == 0
        );
    }

    #[test]
    fn inhoud_moet_bij_het_type_passen() {
        let p = project();
        assert!(
            save(p.path(), "nep.png", b"MZ\x90\x00 dit is een programma")
                .unwrap_err()
                .to_string()
                .contains("past niet bij het type")
        );
        assert!(save(p.path(), "nep.pdf", PNG).is_err());
        assert!(
            save(p.path(), "nep.txt", &[0xFF, 0xFE, 0x00, 0x01]).is_err(),
            "geen geldige tekst"
        );
        assert!(save(p.path(), "leeg.png", b"")
            .unwrap_err()
            .to_string()
            .contains("leeg"));
    }

    #[test]
    fn grootte_wordt_beperkt_per_soort() {
        let p = project();
        let mut big = PNG.to_vec();
        big.resize(MAX_IMAGE_BYTES + 1, 0);
        assert!(save(p.path(), "groot.png", &big)
            .unwrap_err()
            .to_string()
            .contains("te groot (maximaal 10 MB)"));
        let mut ok = PNG.to_vec();
        ok.resize(MAX_IMAGE_BYTES, 0);
        assert!(save(p.path(), "net-goed.png", &ok).is_ok());
        let mut doc = b"%PDF".to_vec();
        doc.resize(MAX_DOC_BYTES + 1, b'a');
        assert!(save(p.path(), "groot.pdf", &doc)
            .unwrap_err()
            .to_string()
            .contains("maximaal 5 MB"));
        // base64 wordt al vóór het decoderen afgewezen
        let huge = "A".repeat(MAX_IMAGE_BYTES * 2);
        assert!(save_base64(p.path(), "x.png", &huge)
            .unwrap_err()
            .to_string()
            .contains("te groot"));
    }

    #[test]
    fn padtrucs_in_bestandsnamen_komen_nooit_buiten_assets() {
        let p = project();
        for naam in [
            "../../etc/passwd.png",
            "..\\..\\evil.png",
            "/etc/hosts.png",
            "C:\\Windows\\x.png",
            "assets/../../x.png",
            ".hidden.png",
            "....png",
            "a/b/c.png",
        ] {
            let s = save(p.path(), naam, PNG).unwrap();
            assert!(
                s.path.starts_with("assets/")
                    && !s.path[7..].contains(['/', '\\'])
                    && !s.path.contains(".."),
                "{naam} → {}",
                s.path
            );
            assert!(!s.name.starts_with('.'), "{naam} → {}", s.name);
            let full = p.path().join(&s.path).canonicalize().unwrap();
            assert!(
                full.starts_with(p.path().join("assets").canonicalize().unwrap()),
                "{naam}"
            );
        }
        assert!(!p.path().parent().unwrap().join("evil.png").exists());
        let (stem, _) = sanitize_name(&"a".repeat(500));
        assert_eq!(stem.chars().count(), 60);
    }

    #[cfg(unix)]
    #[test]
    fn een_assets_map_die_een_snelkoppeling_naar_buiten_is_wordt_geweigerd() {
        let p = project();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), p.path().join("assets")).unwrap();
        assert!(save(p.path(), "x.png", PNG)
            .unwrap_err()
            .to_string()
            .contains("snelkoppeling"));
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
    }

    #[test]
    fn bestaat_er_een_bestand_genaamd_assets_dan_een_duidelijke_fout() {
        let p = project();
        fs::write(p.path().join("assets"), "x").unwrap();
        assert!(save(p.path(), "x.png", PNG)
            .unwrap_err()
            .to_string()
            .contains("al een bestand"));
    }

    #[test]
    fn resolve_asset_valideert_paden_streng() {
        let p = project();
        let s = save(p.path(), "foto.png", PNG).unwrap();
        assert!(resolve_asset(p.path(), &s.path).is_ok());
        assert!(
            resolve_asset(p.path(), "assets\\foto.png").is_ok(),
            "Windows-scheiding wordt genormaliseerd"
        );
        for slecht in [
            "../foto.png",
            "assets/../foto.png",
            "/etc/passwd",
            "assets/nietbestaand.png",
            "assets",
            "assets/",
            "index.html",
            "src/assets/foto.png",
            "C:\\x.png",
            "assets/foto.png\0",
            ".studio/foto.png",
            ".studio/picks",
        ] {
            assert!(resolve_asset(p.path(), slecht).is_err(), "{slecht:?}");
        }
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("geheim.txt"), "x").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                outside.path().join("geheim.txt"),
                p.path().join("assets/link.txt"),
            )
            .unwrap();
            assert!(
                resolve_asset(p.path(), "assets/link.txt").is_err(),
                "symlink naar buiten"
            );
        }
        fs::create_dir_all(p.path().join(".studio/picks")).unwrap();
        fs::write(p.path().join(".studio/picks/p.jpg"), JPG).unwrap();
        assert!(
            resolve_asset(p.path(), ".studio/picks/p.jpg").is_ok(),
            "gekozen onderdelen uit de preview staan hier"
        );
    }

    #[test]
    fn miniatuur_alleen_voor_kleine_afbeeldingen() {
        let p = project();
        let s = save(p.path(), "foto.png", PNG).unwrap();
        let t = thumbnail(p.path(), &s.path).unwrap().unwrap();
        assert!(t.starts_with("data:image/png;base64,"));
        let d = save(p.path(), "n.txt", b"hallo").unwrap();
        assert_eq!(thumbnail(p.path(), &d.path).unwrap(), None);
        let mut big = PNG.to_vec();
        big.resize(MAX_THUMB_BYTES as usize + 1, 0);
        let b = save(p.path(), "groot.png", &big).unwrap();
        assert_eq!(thumbnail(p.path(), &b.path).unwrap(), None);
        assert!(thumbnail(p.path(), "../x.png").is_err());
    }

    #[test]
    fn het_pad_gaat_in_de_opdracht_naar_de_ai() {
        assert_eq!(prompt_suffix(&[]), "");
        let s = prompt_suffix(&["assets/a.png".into(), "assets/b.pdf".into()]);
        assert!(
            s.contains("- assets/a.png")
                && s.contains("- assets/b.pdf")
                && s.contains("projectmap")
        );
    }

    #[test]
    fn base64_wordt_gedecodeerd_en_onzin_geeft_een_nette_fout() {
        let p = project();
        let ok = save_base64(p.path(), "foto.png", &B64.encode(PNG)).unwrap();
        assert!(ok.path.starts_with("assets/"));
        assert!(save_base64(p.path(), "foto.png", "!!!geen base64!!!")
            .unwrap_err()
            .to_string()
            .contains("gelezen"));
    }
}
