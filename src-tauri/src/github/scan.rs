//! De controle voor er iets naar GitHub gaat: staan er geheimen (sleutels, tokens, wachtwoorden, privésleutels, certificaten) of
//! te grote bestanden in wat wordt verstuurd? Gescand wordt de laatste versie (alles wat online komt) én wat er in de te sturen
//! eerdere versies is toegevoegd. In het resultaat staat nooit de geheime waarde zelf: alleen bestand, regel en soort.
//! De patronen komen overeen met die van `mcp-server/src/security.ts` (de beveiligingscheck van de AI); pas ze samen aan.
use git2::{ObjectType, Oid, Repository, TreeWalkMode, TreeWalkResult};
use regex::Regex;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::OnceLock;

/// Vanaf deze grootte waarschuwen we; vanaf de harde grens van GitHub (100 MB) blokkeren we.
pub const WARN_BYTES: u64 = 50 * 1024 * 1024;
pub const BLOCK_BYTES: u64 = 100 * 1024 * 1024;
const MAX_TEXT: usize = 2_000_000;
const MAX_LINE: usize = 50_000;
const MAX_HISTORY_COMMITS: usize = 500;
const MAX_HISTORY_BLOBS: usize = 3_000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Finding {
    pub bestand: String,
    pub regel: Option<u32>,
    /// Vaste code (nl.json: `github.scan.soort.<soort>`).
    pub soort: &'static str,
    /// `hoog` blokkeert altijd; `midden` blokkeert bij een openbare kopie en waarschuwt bij een privé-kopie.
    pub ernst: &'static str,
    /// Het staat niet in de laatste versie maar wel in een eerdere.
    pub historie: bool,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
pub struct Report {
    pub gescand: usize,
    pub geheimen: Vec<Finding>,
    pub te_groot: Vec<(String, u64)>,
    pub groot: Vec<(String, u64)>,
}

impl Report {
    /// Wat het versturen tegenhoudt. Bij een openbare kopie ook de middelzware vondsten en alles in eerdere versies.
    pub fn blokkades(&self, openbaar: bool) -> Vec<&Finding> {
        self.geheimen.iter().filter(|f| if f.historie { openbaar } else { f.ernst == "hoog" || openbaar }).collect()
    }
    /// Wat we wel melden maar niet tegenhoudt.
    pub fn waarschuwingen(&self, openbaar: bool) -> Vec<&Finding> {
        let b: HashSet<*const Finding> = self.blokkades(openbaar).into_iter().map(|f| f as *const Finding).collect();
        self.geheimen.iter().filter(|f| !b.contains(&(*f as *const Finding))).collect()
    }
}

struct Patterns {
    keys: Vec<(Regex, &'static str)>,
    private_key: Regex,
    generic: Regex,
    password: Regex,
    url_cred: Regex,
    placeholder: Regex,
    npm_token: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| {
        let k = |re: &str, label: &'static str| (Regex::new(re).expect("geldig patroon"), label);
        Patterns {
            keys: vec![
                k(r"\bsk-ant-[A-Za-z0-9_-]{20,}", "anthropic_sleutel"),
                k(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}", "api_sleutel"),
                k(r"\bsk_live_[A-Za-z0-9]{16,}", "stripe_sleutel"),
                k(r"\brk_live_[A-Za-z0-9]{16,}", "stripe_sleutel"),
                k(r"\bgh[pousr]_[A-Za-z0-9]{30,}", "github_token"),
                k(r"\bgithub_pat_[A-Za-z0-9_]{40,}", "github_token"),
                k(r"\bAKIA[0-9A-Z]{16}\b", "aws_sleutel"),
                k(r"\bxox[baprs]-[A-Za-z0-9-]{10,}", "slack_token"),
                k(r"\bAIza[0-9A-Za-z_-]{35}\b", "google_sleutel"),
                k(r"\bsb_secret_[A-Za-z0-9_-]{16,}", "supabase_sleutel"),
                k(r"\bsbp_[A-Za-z0-9]{30,}", "supabase_token"),
                k(r"\bvcp_[A-Za-z0-9]{20,}", "vercel_token"),
                k(r"\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}", "jwt_token"),
            ],
            private_key: Regex::new(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----").unwrap(),
            generic: Regex::new(r#"(?i)\b(?:api[_-]?key|apikey|secret|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)\b["']?\s*[:=]\s*["']([A-Za-z0-9_\-+/=]{16,})["']"#).unwrap(),
            password: Regex::new(r#"(?i)\b(?:password|passwd|pwd|wachtwoord)\b["']?\s*[:=]\s*["']([^"'\s]{4,})["']"#).unwrap(),
            url_cred: Regex::new(r"[a-z][a-z0-9+.-]*://[^/\s:@'\x22]+:([^/\s@'\x22]{4,})@[A-Za-z0-9.-]+").unwrap(),
            placeholder: Regex::new(r"(?i)^(?:x{3,}|\*{3,}|your[_-]|<|\$\{|\{\{|process\.env|changeme|change[_-]me|example|voorbeeld|placeholder|test|password|wachtwoord|secret|todo|dummy|\.{3}|pass$|user$)").unwrap(),
            npm_token: Regex::new(r"_authToken\s*=\s*([^\s$]{8,})").unwrap(),
        }
    })
}

fn is_placeholder(v: &str) -> bool {
    let p = patterns();
    if p.placeholder.is_match(v) {
        return true;
    }
    let mut chars = v.chars();
    let first = chars.next();
    // Allemaal hetzelfde teken, of alleen letters en kort: geen echt geheim.
    first.is_some_and(|c| v.chars().all(|d| d == c)) || (v.len() < 20 && v.chars().all(|c| c.is_ascii_alphabetic()))
}

/// De soort bestand op grond van de naam alleen (zonder naar de inhoud te kijken).
fn by_name(path: &str) -> Option<(&'static str, &'static str)> {
    let name = path.rsplit('/').next().unwrap_or(path).to_lowercase();
    if matches!(name.as_str(), ".env.example" | ".env.sample" | ".env.template" | ".env.dist") {
        return None;
    }
    if name == ".env" || name.starts_with(".env.") {
        return Some(("env_bestand", "hoog"));
    }
    let ext = name.rsplit('.').next().unwrap_or("");
    if name.contains('.') && matches!(ext, "pem" | "key" | "ppk") {
        return Some(("sleutelbestand", "hoog"));
    }
    if name.contains('.') && matches!(ext, "p12" | "pfx" | "jks" | "keystore" | "mobileprovision" | "p8") {
        return Some(("certificaat", "hoog"));
    }
    if name.starts_with("id_rsa") || name.starts_with("id_ed25519") || name.starts_with("id_ecdsa") || name.starts_with("id_dsa") {
        return if name.ends_with(".pub") { None } else { Some(("sleutelbestand", "hoog")) };
    }
    if matches!(name.as_str(), ".netrc" | "credentials.json" | "key.properties" | "secrets.json" | "secrets.yaml" | "secrets.yml") || (name.starts_with("service-account") && ext == "json") || name.ends_with("-adminsdk.json") {
        return Some(("inloggegevens", "hoog"));
    }
    if name.contains('.') && matches!(ext, "sqlite" | "sqlite3" | "db" | "mdb") {
        return Some(("database_bestand", "midden"));
    }
    None
}

fn looks_text(data: &[u8]) -> bool {
    !data.iter().take(8000).any(|&b| b == 0)
}

fn scan_text(path: &str, text: &str, historie: bool, out: &mut Vec<Finding>) {
    let p = patterns();
    let is_test = path.split('/').any(|s| matches!(s, "test" | "tests" | "__tests__" | "fixtures" | "mocks")) || path.contains(".test.") || path.contains(".spec.");
    let name = path.rsplit('/').next().unwrap_or(path).to_lowercase();
    let mut add = |regel: usize, soort: &'static str, ernst: &'static str| {
        if !out.iter().any(|f| f.bestand == path && f.regel == Some(regel as u32) && f.soort == soort) {
            out.push(Finding { bestand: path.to_string(), regel: Some(regel as u32), soort, ernst, historie });
        }
    };
    for (i, line) in text.lines().enumerate() {
        let n = i + 1;
        if line.len() > MAX_LINE {
            continue;
        }
        for (re, soort) in &p.keys {
            if re.is_match(line) {
                // Een JWT is pas geheim als het de geheime Supabase-rol bevat; "anon" is openbaar bedoeld.
                if *soort == "jwt_token" && !jwt_is_secret(line) {
                    continue;
                }
                add(n, soort, "hoog");
            }
        }
        if p.private_key.is_match(line) {
            add(n, "privesleutel", "hoog");
        }
        for c in p.generic.captures_iter(line) {
            if !is_placeholder(&c[1]) {
                add(n, "geheim_in_code", "hoog");
            }
        }
        if !is_test {
            for c in p.password.captures_iter(line) {
                if !is_placeholder(&c[1]) {
                    add(n, "wachtwoord_in_code", "midden");
                }
            }
        }
        for c in p.url_cred.captures_iter(line) {
            if !is_placeholder(&c[1]) {
                add(n, "wachtwoord_in_adres", "hoog");
            }
        }
        if name == ".npmrc" {
            for c in p.npm_token.captures_iter(line) {
                if !is_placeholder(&c[1]) {
                    add(n, "npm_token", "hoog");
                }
            }
        }
    }
}

fn jwt_is_secret(line: &str) -> bool {
    use base64::Engine as _;
    let re = Regex::new(r"\beyJ[A-Za-z0-9_-]{15,}\.(eyJ[A-Za-z0-9_-]{15,})\.[A-Za-z0-9_-]{10,}").unwrap();
    let gevonden = re.captures_iter(line).any(|c| {
        base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(&c[1])
            .ok()
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .map(|v| v["role"] == "service_role")
            .unwrap_or(false)
    });
    gevonden
}

fn scan_blob(repo: &Repository, oid: Oid, path: &str, historie: bool, rep: &mut Report) {
    if let Some((soort, ernst)) = by_name(path) {
        rep.geheimen.push(Finding { bestand: path.to_string(), regel: None, soort, ernst, historie });
    }
    let Ok(blob) = repo.find_blob(oid) else { return };
    let size = blob.size() as u64;
    if !historie {
        if size >= BLOCK_BYTES {
            rep.te_groot.push((path.to_string(), size));
        } else if size >= WARN_BYTES {
            rep.groot.push((path.to_string(), size));
        }
    }
    if size as usize > MAX_TEXT || !looks_text(blob.content()) {
        return;
    }
    scan_text(path, &String::from_utf8_lossy(blob.content()), historie, &mut rep.geheimen);
}

/// Scant de laatste versie (`head`) en, voor de versies die nog niet online staan, wat daar is toegevoegd.
/// `zonder` = de tip van GitHub (die zit er al; `None` = alles is nieuw). Doet geen netwerk.
pub fn scan(repo: &Repository, head: Oid, zonder: Option<Oid>) -> Report {
    let mut rep = Report::default();
    let Ok(commit) = repo.find_commit(head) else { return rep };
    let Ok(tree) = commit.tree() else { return rep };
    let mut in_head: HashSet<Oid> = HashSet::new();
    let mut blobs: Vec<(Oid, String)> = vec![];
    let _ = tree.walk(TreeWalkMode::PreOrder, |dir, e| {
        if e.kind() == Some(ObjectType::Blob) {
            if let Some(n) = e.name() {
                blobs.push((e.id(), format!("{dir}{n}")));
            }
        }
        TreeWalkResult::Ok
    });
    for (oid, path) in &blobs {
        rep.gescand += 1;
        in_head.insert(*oid);
        scan_blob(repo, *oid, path, false, &mut rep);
    }
    // Eerdere versies die nog online moeten: alleen wat daar is toegevoegd en nu niet meer in de laatste versie staat.
    let mut seen: HashSet<Oid> = HashSet::new();
    if let Ok(mut w) = repo.revwalk() {
        if w.push(head).is_ok() {
            if let Some(z) = zonder.filter(|z| repo.find_commit(*z).is_ok()) {
                let _ = w.hide(z);
            }
            for (n, id) in w.flatten().enumerate() {
                if n >= MAX_HISTORY_COMMITS || seen.len() >= MAX_HISTORY_BLOBS {
                    break;
                }
                let Ok(c) = repo.find_commit(id) else { continue };
                let Ok(t) = c.tree() else { continue };
                let parent = c.parent(0).ok().and_then(|p| p.tree().ok());
                let Ok(diff) = repo.diff_tree_to_tree(parent.as_ref(), Some(&t), None) else { continue };
                for d in diff.deltas() {
                    let nf = d.new_file();
                    let oid = nf.id();
                    if oid.is_zero() || in_head.contains(&oid) || !seen.insert(oid) {
                        continue;
                    }
                    if let Some(p) = nf.path().and_then(|p| p.to_str()) {
                        scan_blob(repo, oid, p, true, &mut rep);
                    }
                }
            }
        }
    }
    rep.geheimen.sort_by(|a, b| (a.historie, &a.bestand, a.regel).cmp(&(b.historie, &b.bestand, b.regel)));
    rep
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::tests::commit_all;

    /// Testgeheimen worden hier uit stukjes samengesteld: zo staan er geen echte sleutelvormen in de broncode (secret scanning van GitHub).
    fn s(delen: &[&str]) -> String {
        delen.concat()
    }
    fn repo_met(files: &[(&str, String)]) -> (tempfile::TempDir, Repository) {
        let d = tempfile::tempdir().unwrap();
        let r = Repository::init(d.path()).unwrap();
        for (p, c) in files {
            let f = d.path().join(p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, c).unwrap();
        }
        commit_all(d.path(), "v1").unwrap();
        (d, r)
    }
    fn soorten(rep: &Report) -> Vec<(&str, &'static str)> {
        rep.geheimen.iter().map(|f| (f.bestand.as_str(), f.soort)).collect()
    }
    fn head(r: &Repository) -> Oid {
        r.head().unwrap().target().unwrap()
    }

    #[test]
    fn vindt_bestanden_die_nooit_online_horen() {
        let (_d, r) = repo_met(&[(".env", "A=1".into()), ("config/.env.production", "B=2".into()), (".env.example", "A=".into()), ("sleutels/server.pem", "x".into()), ("android/app/upload.jks", "x".into()), ("id_rsa", "x".into()), ("id_rsa.pub", "x".into()), ("data/app.sqlite", "x".into()), ("key.properties", "storePassword=x".into()), ("ios/profiel.mobileprovision", "x".into()), ("README.md", "hallo".into())]);
        let rep = scan(&r, head(&r), None);
        let v = soorten(&rep);
        for verwacht in [(".env", "env_bestand"), ("config/.env.production", "env_bestand"), ("sleutels/server.pem", "sleutelbestand"), ("android/app/upload.jks", "certificaat"), ("id_rsa", "sleutelbestand"), ("data/app.sqlite", "database_bestand"), ("key.properties", "inloggegevens"), ("ios/profiel.mobileprovision", "certificaat")] {
            assert!(v.contains(&verwacht), "{verwacht:?} niet gevonden in {v:?}");
        }
        assert!(!v.iter().any(|(b, _)| matches!(*b, ".env.example" | "id_rsa.pub" | "README.md")), "{v:?}");
    }

    #[test]
    fn vindt_sleutels_in_de_inhoud_ook_als_ze_verstopt_zijn() {
        let gh = s(&["ghp", "_", &"a1B2".repeat(9)]);
        let aws = s(&["AKI", "A", "ABCDEFGHIJKLMNOP"]);
        let stripe = s(&["sk_", "live_", "abcdefgh12345678abcd"]);
        let pem = s(&["-----BEGIN ", "RSA PRIVATE", " KEY-----"]);
        let lang = format!("{}{}{}", "x".repeat(10_000), s(&["var k='", &gh, "';"]), "y".repeat(10_000)); // verstopt in een lange (geminificeerde) regel
        let (_d, r) = repo_met(&[
            ("src/a.ts", format!("const t = \"{gh}\";\n")),
            ("src/diep/ver/weg/b.js", format!("// niets\n// niets\nconst aws = '{aws}'\n")),
            ("dist/bundle.min.js", lang),
            ("lib/pay.py", format!("STRIPE = \"{stripe}\"\n")),
            ("notes/oud.txt", format!("{pem}\nMIIE...\n")),
            ("conf.json", "{\"api_key\": \"Zx9qLmN3pR7sT1vW5yB8dF2hJ4kM6\"}".into()),
            ("db.ts", "const url = 'postgres://beheer:Ge3imWacht@db.example.com:5432/app';".into()),
            (".npmrc", "//registry.npmjs.org/:_authToken=npm_Abcdefghijklmnop1234".into()),
        ]);
        let rep = scan(&r, head(&r), None);
        let v = soorten(&rep);
        for verwacht in [("src/a.ts", "github_token"), ("src/diep/ver/weg/b.js", "aws_sleutel"), ("dist/bundle.min.js", "github_token"), ("lib/pay.py", "stripe_sleutel"), ("notes/oud.txt", "privesleutel"), ("conf.json", "geheim_in_code"), ("db.ts", "wachtwoord_in_adres"), (".npmrc", "npm_token")] {
            assert!(v.contains(&verwacht), "{verwacht:?} niet gevonden in {v:?}");
        }
    }

    #[test]
    fn de_uitkomst_bevat_nooit_de_waarde_zelf_en_geeft_bestand_en_regel() {
        let gh = s(&["ghp", "_", &"q7Zk".repeat(9)]);
        let (_d, r) = repo_met(&[("a.ts", format!("// regel 1\nconst token = '{gh}';\n"))]);
        let rep = scan(&r, head(&r), None);
        let json = serde_json::to_string(&rep).unwrap();
        assert!(!json.contains(&gh) && !json.contains(&"q7Zk".repeat(3)), "de waarde mag nergens staan: {json}");
        assert_eq!((rep.geheimen[0].bestand.as_str(), rep.geheimen[0].regel), ("a.ts", Some(2)));
    }

    #[test]
    fn geen_valse_alarmen_bij_voorbeeldwaarden_en_openbare_sleutels() {
        let anon = {
            use base64::Engine as _;
            let e = base64::engine::general_purpose::URL_SAFE_NO_PAD;
            format!("{}.{}.{}", e.encode("{\"alg\":\"HS256\",\"typ\":\"JWT\"}"), e.encode("{\"role\":\"anon\",\"iss\":\"supabase\"}"), "x".repeat(20))
        };
        let (_d, r) = repo_met(&[
            ("README.md", "Zet API_KEY=\"your-api-key-here\" in je .env en password: \"changeme\"\n".into()),
            ("src/c.ts", format!("const anon = \"{anon}\"; const url = process.env.SECRET_URL; // password = \"{{{{wachtwoord}}}}\"\n")),
            ("src/d.ts", "const x = { password: 'xxxxxxxx' };\nconst u = 'https://gebruiker:pass@localhost';".into()),
            ("tests/e.test.ts", "const wachtwoord = 'GewoonEenTestwaarde1';".into()),
        ]);
        let rep = scan(&r, head(&r), None);
        let v = soorten(&rep);
        assert!(v.is_empty(), "valse alarmen: {v:?}");
    }

    #[test]
    fn een_geheime_supabase_sleutel_telt_wel() {
        use base64::Engine as _;
        let e = base64::engine::general_purpose::URL_SAFE_NO_PAD;
        let sr = format!("{}.{}.{}", e.encode("{\"alg\":\"HS256\",\"typ\":\"JWT\"}"), e.encode("{\"role\":\"service_role\",\"iss\":\"supabase\"}"), "y".repeat(20));
        let (_d, r) = repo_met(&[("src/x.ts", format!("const k = \"{sr}\";"))]);
        let rep = scan(&r, head(&r), None);
        assert_eq!(soorten(&rep), vec![("src/x.ts", "jwt_token")]);
    }

    #[test]
    fn geschiedenis_wordt_gescand_en_gemarkeerd_en_wat_al_online_staat_niet() {
        let gh = s(&["ghp", "_", &"m3Xy".repeat(9)]);
        let d = tempfile::tempdir().unwrap();
        let r = Repository::init(d.path()).unwrap();
        std::fs::write(d.path().join("a.txt"), "schoon").unwrap();
        let v0 = commit_all(d.path(), "schoon").unwrap();
        std::fs::write(d.path().join("oud.txt"), format!("token={gh}")).unwrap();
        commit_all(d.path(), "per ongeluk").unwrap();
        std::fs::remove_file(d.path().join("oud.txt")).unwrap();
        commit_all(d.path(), "weer weg").unwrap();
        let h = head(&r);
        let rep = scan(&r, h, None);
        assert_eq!(rep.geheimen.len(), 1);
        assert!(rep.geheimen[0].historie, "{:?}", rep.geheimen);
        // Privé: waarschuwing, geen blokkade. Openbaar: blokkade.
        assert!(rep.blokkades(false).is_empty());
        assert_eq!(rep.waarschuwingen(false).len(), 1);
        assert_eq!(rep.blokkades(true).len(), 1);
        // Staat al online (vanaf de eerste versie): dan wordt het niet opnieuw gemeld.
        let na_eerste = scan(&r, h, Some(v0));
        assert_eq!(na_eerste.geheimen.len(), 1, "de tweede versie moet nog online");
        let alles_online = scan(&r, h, Some(h));
        assert!(alles_online.geheimen.is_empty());
    }

    #[test]
    fn middelzware_vondsten_blokkeren_alleen_bij_openbaar() {
        let (_d, r) = repo_met(&[("src/login.ts", "const wachtwoord = \"KoeienOpDeWei2024\";".into()), ("data/x.sqlite", "x".into())]);
        let rep = scan(&r, head(&r), None);
        assert_eq!(rep.geheimen.len(), 2);
        assert!(rep.blokkades(false).is_empty() && rep.waarschuwingen(false).len() == 2);
        assert_eq!(rep.blokkades(true).len(), 2);
    }

    #[test]
    fn grote_bestanden_waarschuwen_en_blokkeren_op_grootte() {
        let (_d, r) = repo_met(&[("klein.bin", "x".into())]);
        let rep = scan(&r, head(&r), None);
        assert!(rep.te_groot.is_empty() && rep.groot.is_empty());
        // De drempels staan vast (50 en 100 MB); een echt bestand van die grootte maken we in een test niet.
        assert_eq!((WARN_BYTES, BLOCK_BYTES), (52_428_800, 104_857_600));
    }

    #[test]
    fn de_scan_is_snel_ook_met_veel_bestanden() {
        let files: Vec<(String, String)> = (0..1500).map(|i| (format!("src/m{}/f{i}.ts", i % 30), format!("export const a{i} = {i};\n").repeat(50))).collect();
        let refs: Vec<(&str, String)> = files.iter().map(|(p, c)| (p.as_str(), c.clone())).collect();
        let (_d, r) = repo_met(&refs);
        let t = std::time::Instant::now();
        let rep = scan(&r, head(&r), None);
        assert_eq!(rep.gescand, 1500);
        assert!(t.elapsed().as_secs() < 5, "te traag: {:?}", t.elapsed());
    }
}
