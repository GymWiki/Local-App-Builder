//! Licentie-haakje: een licentiebestand wordt offline gecontroleerd met een publieke sleutel (minisign, Ed25519).
//! Nu is er geen licentiesysteem: de publieke sleutel in `config/licentie.json` is leeg en Studio is overal gratis.
//! Elke functie werkt ook zonder licentie volledig; een ontbrekende, ongeldige of verlopen licentie beperkt nooit iets
//! wat nu gratis is (de gratis modus is de ondergrens). Er is geen internet en geen account nodig.
use serde::Serialize;
use serde_json::Value;

const CONFIG: &str = include_str!("../../config/licentie.json");

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "modus", rename_all = "snake_case")]
pub enum Stand {
    /// Standaard. Alles werkt.
    Gratis,
    /// Een geldige licentie (voor later, bijvoorbeeld extra opties). De naam komt uit de ondertekende inhoud.
    Betaald { naam: String },
    /// Er staat een licentie, maar die klopt niet of is verlopen: Studio werkt gewoon in de gratis modus.
    GratisMetMelding { reden: String },
}

/// De publieke sleutel uit de configuratie, of `None` als die (nog) niet is ingevuld.
pub fn publieke_sleutel() -> Option<String> {
    let v: Value = serde_json::from_str(CONFIG).ok()?;
    let s = v["publieke_sleutel"].as_str()?.trim().to_string();
    (!s.is_empty()).then_some(s)
}

/// Controleert met minisign (offline) of `handtekening` bij `inhoud` hoort.
pub fn verifieer(inhoud: &[u8], handtekening: &str, publiek: &str) -> bool {
    let (Ok(pk), Ok(sig)) = (minisign_verify::PublicKey::from_base64(publiek), minisign_verify::Signature::decode(handtekening)) else {
        return false;
    };
    pk.verify(inhoud, &sig, true).is_ok()
}

/// Het licentiebestand: de inhoud (JSON), een regel `---` en daarna het minisign-handtekeningblok.
/// `nu` = unixtijd. `verifier` controleert de handtekening (in de app: `verifieer` met de publieke sleutel).
pub fn beoordeel(tekst: &str, nu: i64, verifier: &dyn Fn(&[u8], &str) -> bool) -> Stand {
    let melding = |r: &str| Stand::GratisMetMelding { reden: r.into() };
    let Some((inhoud, sig)) = tekst.split_once("\n---\n") else { return melding("onleesbaar") };
    if !verifier(inhoud.as_bytes(), sig) {
        return melding("handtekening_klopt_niet");
    }
    let Ok(v) = serde_json::from_str::<Value>(inhoud) else { return melding("onleesbaar") };
    if v["v"] != 1 {
        return melding("onbekende_versie");
    }
    if let Some(tot) = v["tot"].as_i64() {
        if tot < nu {
            return melding("verlopen");
        }
    }
    match v["naam"].as_str() {
        Some(n) if !n.is_empty() && n.len() <= 80 => Stand::Betaald { naam: n.to_string() },
        _ => melding("onleesbaar"),
    }
}

/// De huidige stand. Zonder publieke sleutel of zonder bestand: gratis.
pub fn stand(licentiebestand: Option<&str>, nu: i64) -> Stand {
    let (Some(tekst), Some(publiek)) = (licentiebestand, publieke_sleutel()) else { return Stand::Gratis };
    beoordeel(tekst, nu, &|i, s| verifieer(i, s, &publiek))
}

#[tauri::command]
pub fn licentie_status(app: tauri::AppHandle) -> Stand {
    use tauri::Manager;
    let tekst = app.path().app_data_dir().ok().and_then(|d| std::fs::read_to_string(d.join("licentie.txt")).ok());
    stand(tekst.as_deref(), crate::connect::manager::real_now())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Testvector uit de documentatie van de crate minisign-verify (een publieke sleutel en een handtekening over de tekst "test").
    const PUBLIEK: &str = "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
    const HANDTEKENING: &str = "untrusted comment: signature from minisign secret key\nRWQf6LRCGA9i59SLOFxz6NxvASXDJeRtuZykwQepbDEGt87ig1BNpWaVWuNrm73YiIiJbq71Wi+dP9eKL8OC351vwIasSSbXxwA=\ntrusted comment: timestamp:1555779966\tfile:test\nQtKMXWyYcwdpZAlPF7tE2ENJkRd1ujvKjlj1m9RtHTBnZPa5WKU5uWRs5GoP5M/VqE81QFuMKI5k/SfNQUaOAA==";

    #[test]
    fn zonder_sleutel_in_de_configuratie_is_alles_gratis() {
        assert_eq!(publieke_sleutel(), None, "er is nog geen licentiesysteem");
        assert_eq!(stand(None, 0), Stand::Gratis);
        assert_eq!(stand(Some("willekeurige tekst\n---\nonzin"), 0), Stand::Gratis, "zonder sleutel kan niets beperken");
    }

    #[test]
    fn echte_handtekening_wordt_offline_gecontroleerd() {
        assert!(verifieer(b"test", HANDTEKENING, PUBLIEK));
        assert!(!verifieer(b"test2", HANDTEKENING, PUBLIEK), "andere inhoud");
        assert!(!verifieer(b"test", "rommel", PUBLIEK), "kapotte handtekening");
        assert!(!verifieer(b"test", HANDTEKENING, "geen sleutel"), "kapotte sleutel");
    }

    #[test]
    fn beoordeling_van_de_inhoud() {
        let ja = |_: &[u8], _: &str| true;
        let nee = |_: &[u8], _: &str| false;
        let geldig = "{\"v\":1,\"naam\":\"Jan\",\"tot\":2000000000}\n---\nsig";
        assert_eq!(beoordeel(geldig, 1_000_000_000, &ja), Stand::Betaald { naam: "Jan".into() });
        let melding = |r: &str| Stand::GratisMetMelding { reden: r.into() };
        assert_eq!(beoordeel(geldig, 2_100_000_000, &ja), melding("verlopen"));
        assert_eq!(beoordeel(geldig, 0, &nee), melding("handtekening_klopt_niet"));
        assert_eq!(beoordeel("zonder scheiding", 0, &ja), melding("onleesbaar"));
        assert_eq!(beoordeel("{kapot\n---\nsig", 0, &ja), melding("onleesbaar"));
        assert_eq!(beoordeel("{\"v\":2,\"naam\":\"x\"}\n---\nsig", 0, &ja), melding("onbekende_versie"));
        assert_eq!(beoordeel("{\"v\":1,\"naam\":\"\"}\n---\nsig", 0, &ja), melding("onleesbaar"));
        // zonder einddatum: onbeperkt geldig
        assert_eq!(beoordeel("{\"v\":1,\"naam\":\"Jan\"}\n---\nsig", 5, &ja), Stand::Betaald { naam: "Jan".into() });
    }
}
