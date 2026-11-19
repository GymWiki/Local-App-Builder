//! Hulp bij de formulieren die je in de winkels zelf moet invullen (gegevensveiligheid, privacy, leeftijd, advertenties, export).
//! Studio kijkt in het project (pakketten, rechten, Supabase) en geeft per vraag een voorgesteld antwoord met de reden. Dit is
//! een hulpmiddel, geen juridisch advies: de ontwikkelaar blijft verantwoordelijk voor de antwoorden.
use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct Signalen {
    /// Android-rechten (zonder `android.permission.`).
    pub permissies: Vec<String>,
    /// Pakketten uit pubspec.yaml en package.json.
    pub pakketten: Vec<String>,
    /// Gevonden onderwerpen: `advertenties`, `analyse`, `inloggen`, `betalen`, `locatie`, `camera`, `foto`, `contacten`, `microfoon`, `meldingen`, `online_opslag`.
    pub onderwerpen: BTreeSet<&'static str>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Kaart {
    /// nl.json: `winkels.invul.<id>.{titel,vraag,uitleg}`.
    pub id: &'static str,
    /// Voor welke winkel(s): `play`, `appstore`.
    pub winkels: Vec<&'static str>,
    /// `ja`, `nee` of `controleer` (Studio weet het niet zeker).
    pub antwoord: &'static str,
    /// Waarom (codes: nl.json `winkels.invul.reden.<code>`).
    pub redenen: Vec<String>,
}

const REGELS: &[(&str, &[&str])] = &[
    ("advertenties", &["google_mobile_ads", "admob", "applovin", "unity_ads", "facebook_audience_network", "adcolony", "startapp", "ironsource"]),
    ("analyse", &["firebase_analytics", "firebase_crashlytics", "mixpanel", "amplitude", "sentry", "posthog", "appsflyer", "adjust_sdk", "segment_analytics", "@vercel/analytics", "plausible"]),
    ("inloggen", &["firebase_auth", "supabase_flutter", "google_sign_in", "sign_in_with_apple", "flutter_appauth", "auth0", "@supabase/supabase-js", "next-auth", "firebase"]),
    ("betalen", &["in_app_purchase", "purchases_flutter", "flutter_stripe", "stripe", "pay", "@stripe/stripe-js", "razorpay_flutter"]),
    ("locatie", &["geolocator", "location", "google_maps_flutter", "flutter_map", "geocoding", "background_locator"]),
    ("camera", &["camera", "image_picker", "mobile_scanner", "qr_code_scanner"]),
    ("foto", &["image_picker", "photo_manager", "file_picker", "gallery_saver"]),
    ("contacten", &["contacts_service", "flutter_contacts", "fast_contacts"]),
    ("microfoon", &["record", "flutter_sound", "speech_to_text", "permission_handler_microphone"]),
    ("meldingen", &["firebase_messaging", "flutter_local_notifications", "onesignal_flutter", "awesome_notifications"]),
    ("online_opslag", &["supabase_flutter", "@supabase/supabase-js", "cloud_firestore", "firebase_database", "firebase_storage", "appwrite", "dio", "http"]),
];

const PERMISSIE_ONDERWERP: &[(&str, &str)] = &[
    ("ACCESS_FINE_LOCATION", "locatie"),
    ("ACCESS_COARSE_LOCATION", "locatie"),
    ("CAMERA", "camera"),
    ("RECORD_AUDIO", "microfoon"),
    ("READ_CONTACTS", "contacten"),
    ("READ_MEDIA_IMAGES", "foto"),
    ("POST_NOTIFICATIONS", "meldingen"),
    ("com.google.android.gms.permission.AD_ID", "advertenties"),
];

fn pakketten_uit_pubspec(t: &str) -> Vec<String> {
    let mut uit = vec![];
    let mut in_deps = false;
    for l in t.lines() {
        if !l.starts_with(' ') && !l.starts_with('\t') && !l.trim().is_empty() {
            in_deps = l.starts_with("dependencies:");
            continue;
        }
        if in_deps {
            let r = l.trim();
            if let Some((naam, _)) = r.split_once(':') {
                let n = naam.trim();
                if !n.is_empty() && !n.starts_with('#') && l.starts_with("  ") && !l.starts_with("   ") {
                    uit.push(n.to_string());
                }
            }
        }
    }
    uit
}

fn pakketten_uit_package_json(t: &str) -> Vec<String> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(t) else { return vec![] };
    ["dependencies", "devDependencies"].iter().filter_map(|k| v[*k].as_object()).flat_map(|m| m.keys().cloned()).collect()
}

fn permissies_uit_manifest(t: &str) -> Vec<String> {
    let mut uit = vec![];
    for stuk in t.split("<uses-permission").skip(1) {
        if let Some(i) = stuk.find("android:name=\"") {
            let rest = &stuk[i + 14..];
            if let Some(e) = rest.find('"') {
                let n = &rest[..e];
                uit.push(n.strip_prefix("android.permission.").unwrap_or(n).to_string());
            }
        }
    }
    uit
}

/// Kijkt in het project. Alleen lezen; er wordt niets uitgevoerd.
pub fn signalen(dir: &Path, supabase_gekoppeld: bool) -> Signalen {
    let mut s = Signalen::default();
    let lees = |p: &str| fs::read_to_string(dir.join(p)).unwrap_or_default();
    s.pakketten.extend(pakketten_uit_pubspec(&lees("pubspec.yaml")));
    s.pakketten.extend(pakketten_uit_package_json(&lees("package.json")));
    for p in ["android/app/src/main/AndroidManifest.xml", "android/app/src/debug/AndroidManifest.xml"] {
        s.permissies.extend(permissies_uit_manifest(&lees(p)));
    }
    s.permissies.sort();
    s.permissies.dedup();
    s.pakketten.sort();
    s.pakketten.dedup();
    for (onderwerp, lijst) in REGELS {
        if s.pakketten.iter().any(|p| lijst.contains(&p.as_str())) {
            s.onderwerpen.insert(*onderwerp);
        }
    }
    for p in &s.permissies {
        if let Some((_, o)) = PERMISSIE_ONDERWERP.iter().find(|(k, _)| p == k) {
            s.onderwerpen.insert(*o);
        }
    }
    // Hulp van `http`/`dio` alleen is geen reden voor "online opslag"; samen met inloggen of een gekoppelde database wel.
    if !(s.onderwerpen.contains("inloggen") || supabase_gekoppeld || s.pakketten.iter().any(|p| ["supabase_flutter", "@supabase/supabase-js", "cloud_firestore", "firebase_database", "firebase_storage", "appwrite"].contains(&p.as_str()))) {
        s.onderwerpen.remove("online_opslag");
    }
    if supabase_gekoppeld {
        s.onderwerpen.insert("online_opslag");
    }
    s
}

fn reden(s: &Signalen, onderwerp: &'static str, label: &str) -> Vec<String> {
    if s.onderwerpen.contains(onderwerp) {
        vec![format!("{label}:{onderwerp}")]
    } else {
        vec![]
    }
}

/// De kaarten met een voorgesteld antwoord per formulier.
pub fn kaarten(s: &Signalen) -> Vec<Kaart> {
    let o = &s.onderwerpen;
    let heeft = |k: &str| o.contains(k);
    let gevoelig: Vec<&'static str> = ["locatie", "camera", "microfoon", "contacten", "foto"].into_iter().filter(|k| heeft(k)).collect();
    let mut kaarten = vec![];

    // Verzamelt de app gegevens? (Google: Data safety; Apple: privacy-voedingswaarde-label)
    let mut verzamelt: Vec<String> = vec![];
    for k in ["inloggen", "online_opslag", "analyse", "advertenties", "betalen"].into_iter().chain(gevoelig.iter().copied()) {
        verzamelt.extend(reden(s, k, "pakket"));
    }
    kaarten.push(Kaart { id: "gegevens_verzamelen", winkels: vec!["play", "appstore"], antwoord: if verzamelt.is_empty() { "controleer" } else { "ja" }, redenen: if verzamelt.is_empty() { vec!["geen_signalen".into()] } else { verzamelt } });
    kaarten.push(Kaart { id: "gegevens_delen", winkels: vec!["play", "appstore"], antwoord: if heeft("advertenties") || heeft("analyse") { "ja" } else { "controleer" }, redenen: [reden(s, "advertenties", "pakket"), reden(s, "analyse", "pakket")].concat() });
    kaarten.push(Kaart { id: "versleuteld_onderweg", winkels: vec!["play"], antwoord: "controleer", redenen: vec!["https_gebruiken".into()] });
    kaarten.push(Kaart { id: "account_verwijderen", winkels: vec!["play", "appstore"], antwoord: if heeft("inloggen") { "ja" } else { "nee" }, redenen: if heeft("inloggen") { reden(s, "inloggen", "pakket") } else { vec!["geen_inlog".into()] } });
    kaarten.push(Kaart { id: "advertenties", winkels: vec!["play"], antwoord: if heeft("advertenties") { "ja" } else { "nee" }, redenen: if heeft("advertenties") { reden(s, "advertenties", "pakket") } else { vec!["geen_advertentiepakket".into()] } });
    kaarten.push(Kaart { id: "betalingen", winkels: vec!["play", "appstore"], antwoord: if heeft("betalen") { "ja" } else { "nee" }, redenen: if heeft("betalen") { reden(s, "betalen", "pakket") } else { vec!["geen_betaalpakket".into()] } });
    kaarten.push(Kaart { id: "doelgroep_kinderen", winkels: vec!["play", "appstore"], antwoord: "controleer", redenen: vec!["jij_beslist".into()] });
    // Exportregels (Apple): alleen standaardversleuteling van het besturingssysteem (https) is het gewone geval voor een app als deze.
    kaarten.push(Kaart { id: "export_versleuteling", winkels: vec!["appstore"], antwoord: "controleer", redenen: vec!["alleen_https".into()] });
    kaarten.push(Kaart { id: "leeftijd", winkels: vec!["play", "appstore"], antwoord: "controleer", redenen: [vec!["jij_beslist".into()], if heeft("inloggen") { vec!["gebruikers_kunnen_inloggen".into()] } else { vec![] }].concat() });
    kaarten
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(d: &Path, p: &str, c: &str) {
        let f = d.join(p);
        fs::create_dir_all(f.parent().unwrap()).unwrap();
        fs::write(f, c).unwrap();
    }

    #[test]
    fn leest_pakketten_en_rechten() {
        let d = tempfile::tempdir().unwrap();
        w(d.path(), "pubspec.yaml", "name: x\ndependencies:\n  flutter:\n    sdk: flutter\n  google_mobile_ads: ^5.0.0\n  geolocator: ^11.0.0\n  # opmerking\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n  mockito: ^5.0.0\n");
        w(d.path(), "android/app/src/main/AndroidManifest.xml", "<manifest><uses-permission android:name=\"android.permission.INTERNET\"/><uses-permission android:name=\"android.permission.CAMERA\" /></manifest>");
        let s = signalen(d.path(), false);
        assert_eq!(s.pakketten, vec!["flutter", "geolocator", "google_mobile_ads"]);
        assert_eq!(s.permissies, vec!["CAMERA", "INTERNET"]);
        assert_eq!(s.onderwerpen.iter().copied().collect::<Vec<_>>(), vec!["advertenties", "camera", "locatie"]);
    }

    #[test]
    fn supabase_en_inloggen_geven_online_opslag_en_account_verwijderen() {
        let d = tempfile::tempdir().unwrap();
        w(d.path(), "package.json", r#"{"dependencies":{"react":"1","@supabase/supabase-js":"2"}}"#);
        let s = signalen(d.path(), true);
        assert!(s.onderwerpen.contains("online_opslag") && s.onderwerpen.contains("inloggen"));
        let k = kaarten(&s);
        let kaart = |id: &str| k.iter().find(|x| x.id == id).unwrap().clone();
        assert_eq!(kaart("gegevens_verzamelen").antwoord, "ja");
        assert_eq!(kaart("account_verwijderen").antwoord, "ja");
        assert_eq!(kaart("advertenties").antwoord, "nee");
    }

    #[test]
    fn zonder_signalen_zegt_studio_controleer_en_nooit_zomaar_nee_op_gegevens() {
        let d = tempfile::tempdir().unwrap();
        let k = kaarten(&signalen(d.path(), false));
        let g = k.iter().find(|x| x.id == "gegevens_verzamelen").unwrap();
        assert_eq!((g.antwoord, g.redenen.clone()), ("controleer", vec!["geen_signalen".to_string()]));
        // Wat alleen de ontwikkelaar kan beslissen, blijft "controleer".
        for id in ["doelgroep_kinderen", "leeftijd", "export_versleuteling"] {
            assert_eq!(k.iter().find(|x| x.id == id).unwrap().antwoord, "controleer", "{id}");
        }
        assert_eq!(k.iter().find(|x| x.id == "advertenties").unwrap().antwoord, "nee");
    }

    #[test]
    fn http_of_dio_alleen_is_geen_online_opslag() {
        let d = tempfile::tempdir().unwrap();
        w(d.path(), "pubspec.yaml", "dependencies:\n  http: ^1.0.0\n");
        assert!(!signalen(d.path(), false).onderwerpen.contains("online_opslag"));
    }
}
