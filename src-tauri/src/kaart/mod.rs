//! Projectkaart: een deterministische index van de broncode (zonder AI-tokens) en een compacte kaart voor de AI.
//! Zie docs/tokens.md. De kaart is een hulpmiddel: bij twijfel leest de AI het echte bestand.
pub mod app;
pub mod index;
pub mod parse;
pub mod render;
pub mod zoek;

use index::Stand;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, OnceLock};

fn sloten() -> &'static Mutex<HashMap<PathBuf, Arc<Mutex<()>>>> {
    static S: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
    S.get_or_init(Default::default)
}

/// Per project één bijwerking tegelijk (de index is één SQLite-bestand).
fn slot(dir: &Path) -> Arc<Mutex<()>> {
    sloten().lock().unwrap().entry(dir.to_path_buf()).or_default().clone()
}

/// Werkt de index bij en schrijft `.studio/kaart.md` als de inhoud veranderde. Doet niets met de bestanden van de gebruiker.
pub fn vernieuw(dir: &Path, annuleer: &AtomicBool, voortgang: &dyn Fn(usize, usize)) -> Result<Stand, String> {
    let s = slot(dir);
    let _g = s.lock().unwrap_or_else(|e| e.into_inner());
    let stand = index::bijwerken(dir, annuleer, voortgang)?;
    if !stand.afgebroken {
        let c = index::open(dir).map_err(|e| e.to_string())?;
        let tekst = render::kort(&c);
        let pad = dir.join(".studio").join("kaart.md");
        if std::fs::read_to_string(&pad).ok().as_deref() != Some(tekst.as_str()) {
            let tmp = dir.join(".studio").join(".kaart.md.studio-tmp");
            if std::fs::write(&tmp, &tekst).is_ok() {
                let _ = std::fs::rename(&tmp, &pad);
            }
        }
    }
    Ok(stand)
}

/// Op de achtergrond bijwerken (bij openen en na wijzigingen). Nooit blokkerend voor de rest van de app.
pub fn vernieuw_achtergrond(dir: PathBuf, aan: bool) {
    if !aan {
        return;
    }
    std::thread::spawn(move || {
        let _ = vernieuw(&dir, &AtomicBool::new(false), &|_, _| {});
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn vernieuw_schrijft_kaart_md_en_raakt_gebruikersbestanden_niet_aan() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("app.js"), "// Hoofdbestand.\nexport const a = 1;\n").unwrap();
        fs::write(d.path().join("notitie.txt"), "van de gebruiker").unwrap();
        vernieuw(d.path(), &AtomicBool::new(false), &|_, _| {}).unwrap();
        let k = fs::read_to_string(d.path().join(".studio/kaart.md")).unwrap();
        assert!(k.contains("app.js") && k.contains("Hoofdbestand"));
        assert_eq!(fs::read_to_string(d.path().join("notitie.txt")).unwrap(), "van de gebruiker");
        // tweede keer: geen herschrijven nodig, zelfde inhoud
        vernieuw(d.path(), &AtomicBool::new(false), &|_, _| {}).unwrap();
        assert_eq!(fs::read_to_string(d.path().join(".studio/kaart.md")).unwrap(), k);
    }

    #[test]
    fn kaart_bevat_nooit_een_geheim() {
        let d = tempfile::tempdir().unwrap();
        let sleutel = ["sk", "live", "abcdefghijklmnop1234567890"].join("_");
        fs::write(d.path().join(".env"), format!("STRIPE={sleutel}")).unwrap();
        fs::write(d.path().join("app.js"), format!("// Betalingen.\nexport const betaal = (k = \"{sleutel}\") => k;\n")).unwrap();
        vernieuw(d.path(), &AtomicBool::new(false), &|_, _| {}).unwrap();
        let k = fs::read_to_string(d.path().join(".studio/kaart.md")).unwrap();
        assert!(!k.contains(&sleutel) && !k.contains("STRIPE"), "{k}");
        let db = fs::read(d.path().join(".studio/kaart.db")).unwrap();
        assert!(!String::from_utf8_lossy(&db).contains(&sleutel));
    }

    /// Handmatige meting op een echt, groot project (Studio zelf): `cargo test --lib groot_project -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn groot_project() {
        let bron = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let d = tempfile::tempdir().unwrap();
        for map in ["src", "mcp-server/src", "templates"] {
            let van = bron.join(map);
            let naar = d.path().join(map);
            for e in ignore::WalkBuilder::new(&van).build().flatten().filter(|e| e.file_type().is_some_and(|t| t.is_file())) {
                let rel = e.path().strip_prefix(&van).unwrap();
                let doel = naar.join(rel);
                fs::create_dir_all(doel.parent().unwrap()).unwrap();
                let _ = fs::copy(e.path(), doel);
            }
        }
        let t = std::time::Instant::now();
        let s = vernieuw(d.path(), &AtomicBool::new(false), &|_, _| {}).unwrap();
        let eerste = t.elapsed();
        let t = std::time::Instant::now();
        let s2 = vernieuw(d.path(), &AtomicBool::new(false), &|_, _| {}).unwrap();
        let tweede = t.elapsed();
        let c = index::open(d.path()).unwrap();
        let kort = render::kort(&c);
        println!("bestanden: {} nieuw, tweede keer {} ongewijzigd, terugval {}", s.nieuw, s2.ongewijzigd, s.terugval.len());
        println!("eerste keer {eerste:?}, tweede keer {tweede:?}; korte kaart ≈ {} tokens", render::schat_tokens(&kort));
        for taak in ["Maak de knop op het homescherm groter", "voeg een pagina toe voor de appwinkel teksten", "los een fout op bij het inloggen met Supabase", "de projectkaart in de instellingen tonen"] {
            println!("--- {taak}\n{}", zoek::bestanden_voor_taak(&c, taak, None));
        }
    }
}
