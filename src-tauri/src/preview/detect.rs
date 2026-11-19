//! Zero-config detectie: wat voor project is dit en hoe tonen we het? Zuivere functie over de bestanden in de map.
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::Path;

/// Mappen die we nooit meenemen bij het volgen van wijzigingen (afhankelijkheden, buildoutput, tooling).
pub const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".claude",
    ".gemini",
    ".idea",
    ".vscode",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".cache",
    "target",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
    ".dart_tool",
];

/// Bestanden die Studio zelf schrijft of beheert; die mogen geen herlaadactie veroorzaken.
pub const STUDIO_FILES: &[&str] = &[
    "CLAUDE.md",
    "GEMINI.md",
    "AGENTS.md",
    "PROJECT.md",
    ".mcp.json",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// Nog niets previewbaars.
    Empty,
    /// index.html zonder dev-server: de ingebouwde statische server.
    Static,
    /// package.json met een dev- of start-script.
    Node,
    /// studio.json met een eigen dev-commando (leidend).
    Config,
    Flutter,
    /// Herkenbaar, maar niet automatisch te tonen (Python, Go, package.json zonder script, …).
    Unsupported,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Scripts {
    pub dev: Option<String>,
    pub start: Option<String>,
    pub lint: Option<String>,
    pub build: Option<String>,
    pub test: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Plan {
    pub kind: Kind,
    /// Submap waaruit de statische server serveert ("" = projectroot).
    pub static_root: Option<String>,
    pub entry: Option<String>,
    /// "dev" of "start" (dev wint).
    pub dev_script: Option<String>,
    pub scripts: Scripts,
    /// package.json heeft afhankelijkheden die (nog) niet in node_modules staan.
    pub needs_install: bool,
    /// Het dev-framework herlaadt zelf (HMR); dan forceren wij geen iframe-reload.
    pub hmr: bool,
    /// Uitleg voor kinds zonder preview (Empty/Flutter/Unsupported).
    pub reason: Option<String>,
    /// studio.json bestaat maar is onleesbaar.
    pub config_error: Option<String>,
}

impl Plan {
    fn new(kind: Kind) -> Self {
        Self {
            kind,
            static_root: None,
            entry: None,
            dev_script: None,
            scripts: Scripts::default(),
            needs_install: false,
            hmr: false,
            reason: None,
            config_error: None,
        }
    }

    pub fn previewable(&self) -> bool {
        matches!(self.kind, Kind::Static | Kind::Node | Kind::Config)
    }

    /// Vingerafdruk van de scripts die Studio zou uitvoeren; wijzigt die, dan vervalt het vertrouwen.
    pub fn scripts_fingerprint(&self) -> String {
        let s = &self.scripts;
        let f = |o: &Option<String>| o.clone().unwrap_or_default();
        format!(
            "dev={};start={};lint={};build={};test={}",
            f(&s.dev),
            f(&s.start),
            f(&s.lint),
            f(&s.build),
            f(&s.test)
        )
    }
}

/// Frameworks met eigen hot reload: daarvoor hoeven wij de pagina niet te herladen.
pub fn is_hmr(script: &str) -> bool {
    const HMR: &[&str] = &[
        "vite",
        "next",
        "nuxt",
        "astro",
        "svelte-kit",
        "remix",
        "webpack",
        "react-scripts",
        "parcel",
        "rspack",
        "storybook",
        "ng serve",
        "gatsby",
        "expo",
        "rsbuild",
        "solid-start",
        "qwik",
    ];
    let s = script.to_lowercase();
    HMR.iter().any(|h| s.contains(h))
}

fn read_json(path: &Path) -> Option<std::result::Result<Value, String>> {
    let raw = fs::read_to_string(path).ok()?;
    Some(serde_json::from_str::<Value>(&raw).map_err(|e| e.to_string()))
}

fn static_entry(dir: &Path) -> Option<(String, String)> {
    if dir.join("index.html").is_file() {
        Some((String::new(), "index.html".into()))
    } else if dir.join("public").join("index.html").is_file() {
        Some(("public".into(), "index.html".into()))
    } else {
        None
    }
}

fn dep_names(pkg: &Value) -> Vec<String> {
    ["dependencies", "devDependencies"]
        .iter()
        .filter_map(|k| pkg.get(*k).and_then(Value::as_object))
        .flat_map(|o| o.keys().cloned())
        .collect()
}

fn deps_missing(dir: &Path, pkg: &Value) -> bool {
    let names = dep_names(pkg);
    if names.is_empty() {
        return false;
    }
    let nm = dir.join("node_modules");
    !nm.is_dir() || !nm.join(".bin").is_dir() || names.iter().any(|n| !nm.join(n).exists())
}

pub fn detect(dir: &Path) -> Plan {
    // 1. studio.json met eigen dev-commando is leidend.
    let mut cfg_scripts: Option<Plan> = None;
    if let Some(parsed) = read_json(&dir.join("studio.json")) {
        match parsed {
            Err(e) => {
                let mut p = Plan::new(Kind::Config);
                p.config_error = Some(format!("studio.json is geen geldige JSON: {e}"));
                return p;
            }
            Ok(v) => {
                if let Some(dev) = v.get("dev").and_then(Value::as_str) {
                    let mut p = Plan::new(Kind::Config);
                    p.hmr = is_hmr(dev);
                    p.scripts.dev = Some(dev.to_string());
                    cfg_scripts = Some(p);
                }
            }
        }
    }
    let pkg = read_json(&dir.join("package.json"));
    if let Some(mut p) = cfg_scripts {
        if let Some(Ok(pkg)) = &pkg {
            p.needs_install = deps_missing(dir, pkg);
        }
        return p;
    }

    // 2. package.json
    if let Some(parsed) = pkg {
        let pkg = match parsed {
            Ok(v) => v,
            Err(e) => {
                let mut p = Plan::new(Kind::Unsupported);
                p.reason = Some(format!("package.json is geen geldige JSON: {e}"));
                return p;
            }
        };
        let script = |k: &str| {
            pkg["scripts"]
                .get(k)
                .and_then(Value::as_str)
                .map(str::to_string)
        };
        let scripts = Scripts {
            dev: script("dev"),
            start: script("start"),
            lint: script("lint"),
            build: script("build"),
            test: script("test"),
        };
        let dev_script = if scripts.dev.is_some() {
            Some("dev")
        } else if scripts.start.is_some() {
            Some("start")
        } else {
            None
        };
        if let Some(ds) = dev_script {
            let mut p = Plan::new(Kind::Node);
            p.hmr = is_hmr(if ds == "dev" {
                scripts.dev.as_deref().unwrap_or("")
            } else {
                scripts.start.as_deref().unwrap_or("")
            });
            p.dev_script = Some(ds.into());
            p.scripts = scripts;
            p.needs_install = deps_missing(dir, &pkg);
            return p;
        }
        if let Some((root, entry)) = static_entry(dir) {
            let mut p = Plan::new(Kind::Static);
            p.static_root = Some(root);
            p.entry = Some(entry);
            p.scripts = scripts;
            return p;
        }
        let mut p = Plan::new(Kind::Unsupported);
        p.reason = Some("package.json heeft geen ‘dev’- of ‘start’-script en er is geen index.html. Voeg een dev-script toe, bijvoorbeeld \"dev\": \"vite\".".into());
        return p;
    }

    // 3. Flutter
    if dir.join("pubspec.yaml").is_file() {
        let mut p = Plan::new(Kind::Flutter);
        p.reason = Some("Dit is een Flutter-project. Installeer de Flutter SDK (https://docs.flutter.dev/get-started/install), start `flutter run -d web-server --web-port 5000` in de terminal en zet in studio.json \"previewUrl\": \"http://localhost:5000\" met \"dev\": \"flutter run -d web-server --web-port 5000\".".into());
        return p;
    }

    // 4. Statisch
    if let Some((root, entry)) = static_entry(dir) {
        let mut p = Plan::new(Kind::Static);
        p.static_root = Some(root);
        p.entry = Some(entry);
        return p;
    }

    // 5. Herkenbaar maar niet automatisch te tonen
    for (file, what) in [
        ("requirements.txt", "Python"),
        ("pyproject.toml", "Python"),
        ("app.py", "Python"),
        ("go.mod", "Go"),
        ("Cargo.toml", "Rust"),
        ("pom.xml", "Java"),
        ("Gemfile", "Ruby"),
        ("composer.json", "PHP"),
    ] {
        if dir.join(file).is_file() {
            let mut p = Plan::new(Kind::Unsupported);
            p.reason = Some(format!("Dit lijkt een {what}-project. Studio kan dat nog niet automatisch tonen: zet het startcommando en de URL in studio.json (\"dev\" en \"previewUrl\")."));
            return p;
        }
    }

    // 6. Leeg
    let mut p = Plan::new(Kind::Empty);
    p.reason = Some("Er zijn nog geen previewbare bestanden. Zodra de AI een index.html of een project met een dev-script maakt, verschijnt de preview vanzelf.".into());
    p
}

/// Moet een wijziging op dit (relatieve) pad worden genegeerd? Alles in genegeerde mappen en dotfiles, behalve studio.json/package.json-achtige planbestanden.
pub fn is_ignored(rel: &Path) -> bool {
    let comps: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    if comps.len() > 1
        && comps[..comps.len() - 1]
            .iter()
            .any(|c| IGNORED_DIRS.contains(&c.as_str()))
    {
        return true;
    }
    match comps.last() {
        Some(last) => {
            // De map zelf (bijv. net aangemaakte node_modules) telt wel mee voor het plan.
            (last.starts_with('.')
                && !IGNORED_DIRS.contains(&last.as_str())
                && last != ".gitignore")
                || last.ends_with(".studio-tmp")
        }
        None => true,
    }
}

/// Wijzigingen in deze bestanden kunnen het plan veranderen (opnieuw detecteren).
pub fn affects_plan(rel: &Path) -> bool {
    let top = rel
        .components()
        .next()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .unwrap_or_default();
    let name = rel
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    rel.components().count() == 1
        && ([
            "package.json",
            "studio.json",
            "pubspec.yaml",
            "index.html",
            "node_modules",
            "public",
            "requirements.txt",
            "pyproject.toml",
            "go.mod",
            "Cargo.toml",
        ]
        .contains(&name.as_str())
            || top == "public")
        || rel == Path::new("public/index.html")
        || name == "package-lock.json"
}

/// Moet deze wijziging de preview herladen? Niet voor bestanden die Studio zelf beheert.
pub fn triggers_reload(rel: &Path) -> bool {
    if is_ignored(rel) {
        return false;
    }
    let name = rel
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    !STUDIO_FILES.contains(&name.as_str()) && name != "studio.json"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(d: &Path, rel: &str, body: &str) {
        let p = d.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, body).unwrap();
    }

    #[test]
    fn leeg_project_en_alleen_studio_bestanden() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(detect(d.path()).kind, Kind::Empty);
        write(d.path(), "PROJECT.md", "# x");
        write(d.path(), "CLAUDE.md", "x");
        let p = detect(d.path());
        assert_eq!(p.kind, Kind::Empty);
        assert!(!p.previewable());
        assert!(p.reason.unwrap().contains("index.html"));
    }

    #[test]
    fn statisch_met_root_of_public() {
        let d = tempfile::tempdir().unwrap();
        write(d.path(), "index.html", "<h1>hoi</h1>");
        let p = detect(d.path());
        assert_eq!(
            (p.kind, p.static_root.as_deref(), p.entry.as_deref()),
            (Kind::Static, Some(""), Some("index.html"))
        );

        let d = tempfile::tempdir().unwrap();
        write(d.path(), "public/index.html", "x");
        assert_eq!(detect(d.path()).static_root.as_deref(), Some("public"));
    }

    #[test]
    fn package_json_met_dev_of_start_script() {
        let d = tempfile::tempdir().unwrap();
        write(
            d.path(),
            "package.json",
            r#"{"scripts":{"dev":"vite","build":"vite build","lint":"eslint .","test":"vitest","start":"node x"},"devDependencies":{"vite":"^5"}}"#,
        );
        let p = detect(d.path());
        assert_eq!((p.kind, p.dev_script.as_deref()), (Kind::Node, Some("dev")));
        assert!(p.hmr && p.needs_install, "{p:?}");
        assert_eq!(p.scripts.build.as_deref(), Some("vite build"));

        let d = tempfile::tempdir().unwrap();
        write(
            d.path(),
            "package.json",
            r#"{"scripts":{"start":"node server.js"}}"#,
        );
        let p = detect(d.path());
        assert_eq!(
            (p.kind, p.dev_script.as_deref(), p.hmr, p.needs_install),
            (Kind::Node, Some("start"), false, false)
        );
    }

    #[test]
    fn afhankelijkheden_klaar_als_node_modules_compleet_is() {
        let d = tempfile::tempdir().unwrap();
        write(
            d.path(),
            "package.json",
            r#"{"scripts":{"dev":"vite"},"dependencies":{"@scope/pkg":"1"},"devDependencies":{"vite":"5"}}"#,
        );
        assert!(detect(d.path()).needs_install);
        write(d.path(), "node_modules/.bin/vite", "");
        write(d.path(), "node_modules/vite/package.json", "{}");
        assert!(detect(d.path()).needs_install, "@scope/pkg ontbreekt nog");
        write(d.path(), "node_modules/@scope/pkg/package.json", "{}");
        assert!(!detect(d.path()).needs_install);
    }

    #[test]
    fn package_json_zonder_script_valt_terug_op_statisch_of_unsupported() {
        let d = tempfile::tempdir().unwrap();
        write(d.path(), "package.json", r#"{"name":"x"}"#);
        let p = detect(d.path());
        assert_eq!(p.kind, Kind::Unsupported);
        assert!(p.reason.unwrap().contains("dev"));
        write(d.path(), "index.html", "x");
        assert_eq!(detect(d.path()).kind, Kind::Static);

        let d = tempfile::tempdir().unwrap();
        write(d.path(), "package.json", "{kapot");
        assert!(detect(d.path())
            .reason
            .unwrap()
            .contains("geen geldige JSON"));
    }

    #[test]
    fn flutter_en_overige_talen_geven_een_duidelijke_melding() {
        let d = tempfile::tempdir().unwrap();
        write(d.path(), "pubspec.yaml", "name: app");
        let p = detect(d.path());
        assert_eq!(p.kind, Kind::Flutter);
        assert!(p.reason.unwrap().contains("Flutter SDK"));

        let d = tempfile::tempdir().unwrap();
        write(d.path(), "requirements.txt", "flask");
        let p = detect(d.path());
        assert_eq!(p.kind, Kind::Unsupported);
        assert!(p.reason.unwrap().contains("Python"));
    }

    #[test]
    fn studio_json_met_dev_is_leidend_zonder_dev_niet() {
        let d = tempfile::tempdir().unwrap();
        write(d.path(), "index.html", "x");
        write(
            d.path(),
            "studio.json",
            r#"{"dev":"npm run serve","previewUrl":"http://localhost:8080"}"#,
        );
        let p = detect(d.path());
        assert_eq!(
            (p.kind, p.scripts.dev.as_deref()),
            (Kind::Config, Some("npm run serve"))
        );

        write(d.path(), "studio.json", r#"{"lint":"npm run lint"}"#);
        assert_eq!(
            detect(d.path()).kind,
            Kind::Static,
            "zonder dev blijft auto-detectie gelden"
        );

        write(d.path(), "studio.json", "{kapot");
        let p = detect(d.path());
        assert_eq!(p.kind, Kind::Config);
        assert!(p.config_error.unwrap().contains("geen geldige JSON"));
    }

    #[test]
    fn hmr_herkenning_en_vingerafdruk() {
        assert!(is_hmr("vite --port 3000") && is_hmr("next dev") && !is_hmr("node server.js"));
        let d = tempfile::tempdir().unwrap();
        write(d.path(), "package.json", r#"{"scripts":{"dev":"vite"}}"#);
        let a = detect(d.path()).scripts_fingerprint();
        write(
            d.path(),
            "package.json",
            r#"{"scripts":{"dev":"vite && curl evil"}}"#,
        );
        assert_ne!(a, detect(d.path()).scripts_fingerprint());
    }

    #[test]
    fn welke_wijzigingen_tellen_mee() {
        for p in [
            "node_modules/x/y.js",
            ".git/index",
            "dist/a.js",
            "src/.hidden",
            "a.studio-tmp",
            ".env",
        ] {
            assert!(is_ignored(Path::new(p)), "{p}");
        }
        for p in [
            "index.html",
            "css/app.css",
            "node_modules",
            "src/main.js",
            "package.json",
        ] {
            assert!(!is_ignored(Path::new(p)), "{p}");
        }
        assert!(
            triggers_reload(Path::new("css/app.css"))
                && !triggers_reload(Path::new("CLAUDE.md"))
                && !triggers_reload(Path::new("studio.json"))
        );
        assert!(
            affects_plan(Path::new("package.json"))
                && affects_plan(Path::new("index.html"))
                && affects_plan(Path::new("node_modules"))
        );
        assert!(!affects_plan(Path::new("src/main.js")));
    }
}
