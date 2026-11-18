//! PKCE (RFC 7636, alleen S256) en de `state`-parameter. Willekeur komt van het besturingssysteem (`getrandom`).
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};

fn random_b64(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("willekeur van het besturingssysteem");
    URL_SAFE_NO_PAD.encode(buf)
}

#[derive(Debug, Clone)]
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

pub fn challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn new_pkce() -> Pkce {
    // 32 bytes → 43 tekens: de minimale lengte volgens de standaard.
    let verifier = random_b64(32);
    let challenge = challenge_for(&verifier);
    Pkce { verifier, challenge }
}

pub fn new_state() -> String {
    random_b64(24)
}

/// Vergelijkt in vaste tijd (voorkomt dat een lokale aanvaller de state letter voor letter raadt).
pub fn same(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voorbeeld_uit_rfc7636() {
        // RFC 7636, bijlage B.
        assert_eq!(challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn verifier_en_state_zijn_lang_genoeg_en_verschillend() {
        let (a, b) = (new_pkce(), new_pkce());
        assert!(a.verifier.len() >= 43 && a.verifier.len() <= 128);
        assert_ne!(a.verifier, b.verifier);
        assert_eq!(a.challenge, challenge_for(&a.verifier));
        assert_ne!(new_state(), new_state());
        assert!(same("abc", "abc") && !same("abc", "abd") && !same("abc", "ab"));
    }
}
