//! De publieke configuratie in het project zetten: project-URL en publiceerbare sleutel in `.env.local`, `.env*` in `.gitignore`,
//! en (voor een Vite-project) de client-code. De service-sleutel en het databasewachtwoord komen hier nooit in.
use super::*;
use std::fs;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Stack {
    Vite,
    Next,
    Overig,
}

fn detect(dir: &std::path::Path) -> Stack {
    let pkg = fs::read_to_string(dir.join("package.json")).unwrap_or_default();
    if pkg.contains("\"next\"") {
        Stack::Next
    } else if pkg.contains("\"vite\"") {
        Stack::Vite
    } else {
        Stack::Overig
    }
}

fn names(s: Stack) -> (&'static str, &'static str) {
    match s {
        Stack::Vite => ("VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"),
        Stack::Next => ("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
        Stack::Overig => ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"),
    }
}

/// Zet of vervangt alleen onze eigen regels; alle andere regels in het bestand blijven staan.
fn merge_env(existing: &str, pairs: &[(&str, &str)]) -> String {
    let mut lines: Vec<String> = existing.lines().map(String::from).collect();
    for (k, v) in pairs {
        let nieuw = format!("{k}={v}");
        match lines.iter().position(|l| l.trim_start().starts_with(&format!("{k}="))) {
            Some(i) => lines[i] = nieuw,
            None => lines.push(nieuw),
        }
    }
    let mut out = lines.join("\n");
    out.push('\n');
    out
}

fn ensure_gitignore(dir: &std::path::Path) -> std::io::Result<()> {
    let p = dir.join(".gitignore");
    let cur = fs::read_to_string(&p).unwrap_or_default();
    let al = cur.lines().any(|l| matches!(l.trim(), ".env*" | ".env.*" | ".env.local" | "*.local"));
    if al {
        return Ok(());
    }
    let mut out = cur;
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str("# Geheimen en sleutels van je omgeving horen niet in git\n.env*\n!.env.example\n");
    fs::write(p, out)
}

const VITE_CLIENT: &str = "import { createClient } from \"@supabase/supabase-js\";\n\n// Alleen de PUBLIEKE gegevens van je project (de URL en de publiceerbare sleutel). Zet hier nooit een geheime sleutel.\n// Voorwaarde: de beveiliging per rij (RLS) staat aan op al je tabellen. Installeer eerst: npm install @supabase/supabase-js\nconst url = import.meta.env.VITE_SUPABASE_URL;\nconst key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;\n\nexport const supabase = createClient(url, key);\n";

impl Engine {
    /// Schrijft de publieke configuratie in het project. Veilig om vaker te doen.
    pub fn write_project_config(&self, project: i64) -> Reply {
        let link = match self.need_link(project) {
            Ok(l) => l,
            Err(r) => return r,
        };
        let Some(dir) = self.hooks.project_dir(project) else { return Reply::fout("Het project is niet gevonden.") };
        let key = match self.api(&[], |c| c.public_key(&link.reference)) {
            Ok(k) => k,
            Err(e) => return self.err_reply(&link, &e),
        };
        let stack = detect(&dir);
        let (n_url, n_key) = names(stack);
        let url = format!("https://{}.supabase.co", link.reference);
        let env_path = dir.join(".env.local");
        let bestaand = fs::read_to_string(&env_path).unwrap_or_default();
        let merged = merge_env(&bestaand, &[(n_url, &url), (n_key, &key.publishable)]);
        if fs::write(&env_path, merged).is_err() {
            return Reply::fout("Het bestand .env.local kon niet worden geschreven.");
        }
        let _ = ensure_gitignore(&dir);
        // Een voorbeeldbestand zonder echte waarden, zodat het project zonder geheimen te delen is.
        let voorbeeld = dir.join(".env.example");
        if !voorbeeld.exists() {
            let _ = fs::write(&voorbeeld, format!("{n_url}=https://JOUW-PROJECT.supabase.co\n{n_key}=jouw-publiceerbare-sleutel\n"));
        }
        let mut gemaakt = vec![".env.local"];
        if stack == Stack::Vite {
            let client = dir.join("src").join("lib").join("supabase.ts");
            if !client.exists() && fs::create_dir_all(dir.join("src").join("lib")).is_ok() && fs::write(&client, VITE_CLIENT).is_ok() {
                gemaakt.push("src/lib/supabase.ts");
            }
        }
        Reply::ok("De publieke gegevens van je project staan in .env.local. De geheime sleutel en het wachtwoord staan daar nooit in.", Some(json!({ "bestanden": gemaakt, "variabelen": [n_url, n_key] })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eigen_regels_worden_bijgewerkt_en_de_rest_blijft() {
        let m = merge_env("A=1\nVITE_SUPABASE_URL=oud\nB=2", &[("VITE_SUPABASE_URL", "nieuw"), ("VITE_SUPABASE_PUBLISHABLE_KEY", "k")]);
        assert_eq!(m, "A=1\nVITE_SUPABASE_URL=nieuw\nB=2\nVITE_SUPABASE_PUBLISHABLE_KEY=k\n");
        assert_eq!(merge_env("", &[("X", "1")]), "X=1\n");
    }

    #[test]
    fn gitignore_krijgt_env_precies_een_keer() {
        let d = tempfile::tempdir().unwrap();
        ensure_gitignore(d.path()).unwrap();
        ensure_gitignore(d.path()).unwrap();
        let t = fs::read_to_string(d.path().join(".gitignore")).unwrap();
        assert_eq!(t.matches(".env*").count(), 1);
        assert!(t.contains("!.env.example"));
        // Staat het er al in een andere vorm, dan blijft het ongemoeid.
        fs::write(d.path().join(".gitignore"), "node_modules\n.env.local\n").unwrap();
        ensure_gitignore(d.path()).unwrap();
        assert_eq!(fs::read_to_string(d.path().join(".gitignore")).unwrap(), "node_modules\n.env.local\n");
    }

    #[test]
    fn de_naam_van_de_variabelen_hangt_van_het_soort_project_af() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(detect(d.path()), Stack::Overig);
        fs::write(d.path().join("package.json"), r#"{"devDependencies":{"vite":"7"}}"#).unwrap();
        assert_eq!(detect(d.path()), Stack::Vite);
        fs::write(d.path().join("package.json"), r#"{"dependencies":{"next":"15"}}"#).unwrap();
        assert_eq!(detect(d.path()), Stack::Next);
        assert_eq!(names(Stack::Next).0, "NEXT_PUBLIC_SUPABASE_URL");
    }

    #[test]
    fn de_clientcode_bevat_geen_geheimen_en_noemt_de_publieke_sleutel() {
        assert!(VITE_CLIENT.contains("VITE_SUPABASE_PUBLISHABLE_KEY"));
        assert!(!VITE_CLIENT.to_lowercase().contains("service_role") && !VITE_CLIENT.contains("sb_secret"));
    }
}
