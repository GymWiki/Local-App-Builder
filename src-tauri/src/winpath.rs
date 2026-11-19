//! Paden die naar Node gaan: geen `\\?\`-voorvoegsel, geen gemengde scheidingstekens, geen string-gepruts met ":".
//!
//! Node's module-loader loopt elk padonderdeel af met `lstat`. Een "extended-length" pad (`\\?\C:\…`, dat o.a.
//! `canonicalize` en sommige Tauri-paden op Windows opleveren) wordt daar als UNC-pad gelezen en faalt met
//! `EISDIR … lstat 'C:'`. Daarom gaat er altijd een gewoon pad (`C:\…`) naar `node`.
use std::path::{Path, PathBuf};

/// Lijkt dit op een Windows-pad (schijfletter of UNC)? Dan bewerken we het; Unix-paden blijven onaangeroerd.
fn looks_windows(s: &str) -> bool {
    let b = s.as_bytes();
    s.starts_with("\\\\")
        || (b.len() >= 2
            && b[0].is_ascii_alphabetic()
            && b[1] == b':'
            && (b.len() == 2 || b[2] == b'\\' || b[2] == b'/'))
}

/// `\\?\C:\x` → `C:\x`, `\\?\UNC\srv\share\x` → `\\srv\share\x`, `\\.\C:\x` → `C:\x`.
pub fn strip_verbatim(s: &str) -> String {
    if let Some(rest) = s
        .strip_prefix("\\\\?\\UNC\\")
        .or_else(|| s.strip_prefix("\\\\.\\UNC\\"))
    {
        return format!("\\\\{rest}");
    }
    if let Some(rest) = s
        .strip_prefix("\\\\?\\")
        .or_else(|| s.strip_prefix("\\\\.\\"))
    {
        let b = rest.as_bytes();
        if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
            return rest.to_string();
        }
    }
    s.to_string()
}

/// Maakt van een Windows-padstring een schoon, absoluut pad: zonder `\\?\`, met `\` als scheiding en zonder `.`/`..`.
/// Strings die niet op een Windows-pad lijken, komen ongewijzigd terug.
pub fn clean_windows_str(s: &str) -> String {
    let s = strip_verbatim(s);
    if !looks_windows(&s) {
        return s;
    }
    let unc = s.starts_with("\\\\");
    let norm = s.replace('/', "\\");
    let (prefix, rest) = if unc {
        // \\server\share\rest
        let body = norm.trim_start_matches('\\');
        let mut it = body.splitn(3, '\\');
        let (server, share, rest) = (
            it.next().unwrap_or(""),
            it.next().unwrap_or(""),
            it.next().unwrap_or(""),
        );
        (format!("\\\\{server}\\{share}"), rest.to_string())
    } else {
        let drive = norm[..2].to_string();
        (drive, norm[2..].trim_start_matches('\\').to_string())
    };
    let mut parts: Vec<&str> = Vec::new();
    for seg in rest.split('\\') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    if parts.is_empty() {
        format!("{prefix}\\")
    } else {
        format!("{prefix}\\{}", parts.join("\\"))
    }
}

/// Schoon pad zonder het bestandssysteem aan te raken (voor projectmappen e.d.).
pub fn clean_path(p: &Path) -> PathBuf {
    PathBuf::from(clean_windows_str(&p.to_string_lossy()))
}

/// Pad voor een script dat aan `node` wordt gegeven: canoniek (via `dunce`, dus zonder `\\?\`) en daarna nogmaals opgeschoond.
pub fn for_node(p: &Path) -> PathBuf {
    let c = dunce::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    clean_path(&c)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verbatim_voorvoegsel_wordt_verwijderd() {
        assert_eq!(
            strip_verbatim(r"\\?\C:\Users\piete\app\index.mjs"),
            r"C:\Users\piete\app\index.mjs"
        );
        assert_eq!(
            strip_verbatim(r"\\?\UNC\server\share\map\x.js"),
            r"\\server\share\map\x.js"
        );
        assert_eq!(strip_verbatim(r"\\.\D:\x"), r"D:\x");
        assert_eq!(strip_verbatim(r"C:\gewoon\pad"), r"C:\gewoon\pad");
        assert_eq!(
            strip_verbatim(r"\\?\GLOBALROOT\x"),
            r"\\?\GLOBALROOT\x",
            "onbekende apparaatpaden niet aanraken"
        );
    }

    #[test]
    fn windows_pad_met_schijfletter_en_spaties_blijft_volledig_en_juist() {
        let p = r"C:\Users\piete\Desktop\Mijn Map\Studio App\mcp-server\index.mjs";
        assert_eq!(
            clean_windows_str(p),
            p,
            "spaties en schijfletter blijven intact"
        );
        // het resultaat is nooit alleen "C:" of "C:\"
        for input in [
            p,
            r"\\?\C:\Users\piete\Mijn Map\a.mjs",
            "C:/Users/piete/Mijn Map/a.mjs",
        ] {
            let out = clean_windows_str(input);
            assert!(out.len() > 3 && out.starts_with("C:\\"), "{input} → {out}");
        }
    }

    #[test]
    fn verbatim_gemengde_scheidingstekens_en_dubbele_punten_worden_een_schoon_pad() {
        // precies wat `CARGO_MANIFEST_DIR` + "../mcp-server/dist/index.mjs" oplevert
        assert_eq!(
            clean_windows_str(
                r"C:\Users\piete\Desktop\Local App Builder\src-tauri/../mcp-server/dist/index.mjs"
            ),
            r"C:\Users\piete\Desktop\Local App Builder\mcp-server\dist\index.mjs"
        );
        assert_eq!(
            clean_windows_str(r"\\?\C:\Users\piete\target\debug\.\mcp-server\index.mjs"),
            r"C:\Users\piete\target\debug\mcp-server\index.mjs"
        );
        assert_eq!(
            clean_windows_str(r"\\?\UNC\nas\data\a\..\b\x.mjs"),
            r"\\nas\data\b\x.mjs"
        );
    }

    #[test]
    fn wortels_en_te_veel_dubbele_punten() {
        assert_eq!(clean_windows_str(r"C:\"), r"C:\");
        assert_eq!(clean_windows_str(r"C:\..\..\x"), r"C:\x");
        assert_eq!(clean_windows_str(r"d:/a/b/"), r"d:\a\b");
    }

    #[test]
    fn unix_en_relatieve_paden_blijven_ongewijzigd() {
        for p in [
            "/home/user/Mijn Map/app.mjs",
            "relatief/pad.mjs",
            "",
            "/tmp/a:b/c",
            "src-tauri/../x",
        ] {
            assert_eq!(clean_windows_str(p), p);
        }
    }

    #[test]
    fn for_node_geeft_een_bestaand_bestand_met_spaties_als_gewoon_pad_terug() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("Map met spaties").join("mcp server");
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("index.mjs");
        std::fs::write(&f, "x").unwrap();
        let out = for_node(&dir.join("..").join("mcp server").join("index.mjs"));
        assert!(out.is_file());
        assert!(!out.to_string_lossy().contains(".."), "{out:?}");
        assert!(!out.to_string_lossy().starts_with(r"\\?\"));
    }
}
