//! De limieten en regels van de winkels, gelezen uit `config/store-spec.json` (met bron en datum). Geen getal staat in de code.
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::OnceLock;
use unicode_segmentation::UnicodeSegmentation;

#[derive(Debug, Clone, Deserialize)]
pub struct Veld {
    pub officieel: String,
    #[serde(default)]
    pub min: usize,
    pub max: usize,
    pub eenheid: String,
    pub bron: String,
    pub geverifieerd: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Spec {
    pub versie: u32,
    pub datum: String,
    pub talen: Vec<String>,
    pub stores: BTreeMap<String, Value>,
    pub app_id: Value,
}

pub const WINKELS: [&str; 2] = ["play", "appstore"];

pub fn spec() -> &'static Spec {
    static S: OnceLock<Spec> = OnceLock::new();
    S.get_or_init(|| serde_json::from_str(include_str!("../../../config/store-spec.json")).expect("config/store-spec.json is geldig"))
}

impl Spec {
    pub fn veld(&self, store: &str, naam: &str) -> Option<Veld> {
        serde_json::from_value(self.stores.get(store)?["velden"].get(naam)?.clone()).ok()
    }

    /// Alle tekstvelden van een winkel, in de volgorde van het bestand.
    pub fn velden(&self, store: &str) -> Vec<(String, Veld)> {
        let Some(m) = self.stores.get(store).and_then(|s| s["velden"].as_object()) else { return vec![] };
        m.iter().filter_map(|(k, v)| serde_json::from_value::<Veld>(v.clone()).ok().map(|f| (k.clone(), f))).collect()
    }

    /// Een waarde uit het bestand (bijvoorbeeld `afbeeldingen.icoon.breedte`).
    pub fn waarde(&self, store: &str, pad: &str) -> Option<Value> {
        let mut v = self.stores.get(store)?;
        for d in pad.split('.') {
            v = v.get(d)?;
        }
        Some(v.clone())
    }
}

/// Telt een tekst zoals de winkel dat doet: in zichtbare tekens (een emoji of een letter met accent is één) of in bytes.
pub fn tel(eenheid: &str, tekst: &str) -> usize {
    if eenheid == "bytes" {
        tekst.len()
    } else {
        tekst.graphemes(true).count()
    }
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct Telling {
    pub aantal: usize,
    pub min: usize,
    pub max: usize,
    pub eenheid: String,
    /// `goed`, `te_kort`, `te_lang` of `leeg`.
    pub oordeel: &'static str,
}

pub fn beoordeel(veld: &Veld, tekst: &str) -> Telling {
    let n = tel(&veld.eenheid, tekst);
    let oordeel = if tekst.trim().is_empty() {
        if veld.min == 0 { "goed" } else { "leeg" }
    } else if n > veld.max {
        "te_lang"
    } else if n < veld.min {
        "te_kort"
    } else {
        "goed"
    };
    Telling { aantal: n, min: veld.min, max: veld.max, eenheid: veld.eenheid.clone(), oordeel }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn het_bestand_is_geldig_en_elk_veld_heeft_een_bron() {
        let s = spec();
        assert_eq!(s.versie, 1);
        assert!(s.datum.starts_with("2026-"));
        for store in WINKELS {
            let velden = s.velden(store);
            assert!(velden.len() >= 4, "{store}");
            for (naam, v) in velden {
                assert!(v.bron.starts_with("https://"), "{store}.{naam}");
                assert!(v.max >= v.min && v.max > 0, "{store}.{naam}");
                assert!(matches!(v.eenheid.as_str(), "tekens" | "bytes"), "{store}.{naam}");
            }
        }
    }

    #[test]
    fn geverifieerde_apple_limieten_komen_uit_de_officiele_tekst() {
        let s = spec();
        let n = |v: &str| s.veld("appstore", v).unwrap();
        assert_eq!((n("app_naam").max, n("subtitel").max, n("trefwoorden").max, n("beschrijving").max, n("promotietekst").max, n("wat_is_nieuw").max), (30, 30, 100, 4000, 170, 4000));
        assert_eq!(n("trefwoorden").eenheid, "bytes");
        assert!(["app_naam", "subtitel", "trefwoorden", "beschrijving", "promotietekst", "wat_is_nieuw"].iter().all(|k| n(k).geverifieerd));
        // Google: niet gelezen, dus eerlijk als niet geverifieerd gemarkeerd.
        assert!(s.velden("play").iter().all(|(_, v)| !v.geverifieerd));
    }

    #[test]
    fn telt_emoji_en_samengestelde_tekens_als_een_en_bytes_als_bytes() {
        assert_eq!(tel("tekens", "é"), 1);
        assert_eq!(tel("tekens", "e\u{301}"), 1); // e + los accent
        assert_eq!(tel("tekens", "👍🏽"), 1); // emoji met huidskleur
        assert_eq!(tel("tekens", "👨‍👩‍👧"), 1); // familie-emoji
        assert_eq!(tel("tekens", "abc"), 3);
        assert_eq!(tel("bytes", "é"), 2);
        assert_eq!(tel("bytes", "👍"), 4);
    }

    #[test]
    fn beoordeelt_grenzen_precies() {
        let v = Veld { officieel: "x".into(), min: 2, max: 5, eenheid: "tekens".into(), bron: "https://x".into(), geverifieerd: true };
        assert_eq!(beoordeel(&v, "").oordeel, "leeg");
        assert_eq!(beoordeel(&v, "a").oordeel, "te_kort");
        assert_eq!(beoordeel(&v, "ab").oordeel, "goed");
        assert_eq!(beoordeel(&v, "abcde").oordeel, "goed");
        assert_eq!(beoordeel(&v, "abcdef").oordeel, "te_lang");
        assert_eq!(beoordeel(&v, "👍🏽👍🏽👍🏽👍🏽👍🏽").oordeel, "goed");
        let promo = spec().veld("appstore", "promotietekst").unwrap();
        assert_eq!(beoordeel(&promo, "").oordeel, "goed"); // min 0: mag leeg
    }
}
