use crate::provider::Provider;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Mappen waar CLI's vaak staan maar die een GUI-app (vooral op macOS/Windows) niet in zijn PATH heeft.
pub fn extra_dirs() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(home) = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
    {
        v.push(home.join(".local/bin"));
        v.push(home.join(".claude/local"));
        v.push(home.join(".npm-global/bin"));
        v.push(home.join(".bun/bin"));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        v.push(PathBuf::from(appdata).join("npm"));
    }
    #[cfg(unix)]
    {
        v.push("/opt/homebrew/bin".into());
        v.push("/usr/local/bin".into());
    }
    v
}

pub fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    for d in extra_dirs() {
        if !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    dirs
}

/// PATH voor kindprocessen: het gewone PATH met onze extra mappen erachter (verandert dus niets aan voorrang).
pub fn child_path() -> Option<String> {
    std::env::join_paths(search_dirs())
        .ok()
        .map(|p| p.to_string_lossy().to_string())
}

pub fn resolve_in(binary: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    let exts: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or(".COM;.EXE;.BAT;.CMD".into())
            .split(';')
            .map(|s| s.to_lowercase())
            .collect()
    } else {
        vec![String::new()]
    };
    for dir in dirs {
        for ext in &exts {
            let candidate = dir.join(format!("{binary}{ext}"));
            if is_executable(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(unix)]
fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    p.metadata()
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}
#[cfg(not(unix))]
fn is_executable(p: &Path) -> bool {
    p.is_file()
}

pub fn resolve(binary: &str) -> Option<PathBuf> {
    resolve_in(binary, &search_dirs())
}

#[derive(Debug)]
pub struct Output {
    /// Exitcode, of `None` als het proces door een signaal/time-out eindigde.
    pub status: Option<i32>,
    /// stdout en stderr samen.
    pub text: String,
}

/// Draait een (voorbereid) commando met een harde time-out; bij overschrijding wordt het proces gedood.
pub fn output_with_timeout(
    mut cmd: std::process::Command,
    timeout: std::time::Duration,
) -> std::result::Result<Output, String> {
    use std::io::Read;
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let (mut so, mut se) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());
    let t1 = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = so.read_to_string(&mut s);
        s
    });
    let t2 = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = se.read_to_string(&mut s);
        s
    });
    let deadline = std::time::Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st.code(),
            Ok(None) if std::time::Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(20)),
            Err(e) => return Err(e.to_string()),
        }
    };
    let (a, b) = (t1.join().unwrap_or_default(), t2.join().unwrap_or_default());
    Ok(Output {
        status,
        text: format!("{a}{b}"),
    })
}

/// Windows: npm-CLI's zijn `.cmd`/`.bat`-shims en moeten via cmd.exe starten.
pub fn launch(path: &Path, args: Vec<String>) -> (String, Vec<String>) {
    let is_shim = cfg!(windows)
        && path
            .extension()
            .map(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
            .unwrap_or(false);
    if is_shim {
        let mut a = vec![
            "/D".to_string(),
            "/C".to_string(),
            path.to_string_lossy().to_string(),
        ];
        a.extend(args);
        ("cmd.exe".to_string(), a)
    } else {
        (path.to_string_lossy().to_string(), args)
    }
}

pub const HANDOVER_PROMPT: &str = "Je neemt het werk over van een andere AI-assistent. Lees eerst PROJECT.md in deze map (of gebruik de MCP-tool read_project_notes), vat kort samen waar het project nu staat en ga daarna verder. Werk PROJECT.md bij met update_project_notes wanneer je beslissingen neemt of de status verandert.";

/// Argumenten voor een interactieve sessie. `resume` wint van `prompt`. Bron: docs/cli-notes.md.
pub fn ai_args(provider: Provider, prompt: Option<&str>, resume: bool) -> Vec<String> {
    match (provider, resume, prompt) {
        (Provider::Claude, true, _) => vec!["-c".into()],
        (Provider::Gemini, true, _) => vec!["--resume".into()],
        (Provider::Claude, false, Some(p)) => vec![p.into()],
        (Provider::Gemini, false, Some(p)) => vec!["-i".into(), p.into()],
        (_, false, None) => vec![],
    }
}

/// Inloggen: Claude heeft een eigen subcommando; Gemini toont zijn auth-dialoog bij de gewone start.
pub fn login_args(provider: Provider) -> Vec<String> {
    match provider {
        Provider::Claude => vec!["auth".into(), "login".into()],
        Provider::Gemini => vec![],
    }
}

pub fn mcp_env(url: &str, token: &str) -> Vec<(String, String)> {
    vec![
        ("STUDIO_MCP_URL".into(), url.into()),
        ("STUDIO_MCP_TOKEN".into(), token.into()),
    ]
}

pub fn profile_env(provider: Provider, profile_dir: Option<&Path>) -> Vec<(String, String)> {
    profile_dir
        .map(|d| {
            vec![(
                provider.profile_env().to_string(),
                d.to_string_lossy().to_string(),
            )]
        })
        .unwrap_or_default()
}

#[derive(Debug, Clone, Serialize)]
pub struct InstallStep {
    pub label: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CliStatus {
    pub provider: String,
    pub installed: bool,
    pub path: Option<String>,
    pub install_steps: Vec<InstallStep>,
    pub docs_url: String,
}

fn step(label: &str, command: &str) -> InstallStep {
    InstallStep {
        label: label.into(),
        command: command.into(),
    }
}

pub fn install_steps(provider: Provider) -> (Vec<InstallStep>, &'static str) {
    match provider {
        Provider::Claude => (
            vec![
                step(
                    "macOS / Linux",
                    "curl -fsSL https://claude.ai/install.sh | bash",
                ),
                step(
                    "Windows (PowerShell)",
                    "irm https://claude.ai/install.ps1 | iex",
                ),
                step("Homebrew", "brew install --cask claude-code"),
                step("WinGet", "winget install Anthropic.ClaudeCode"),
            ],
            "https://code.claude.com/docs/en/setup",
        ),
        Provider::Gemini => (
            vec![
                step("npm (vereist Node.js)", "npm install -g @google/gemini-cli"),
                step("Homebrew", "brew install gemini-cli"),
            ],
            "https://github.com/google-gemini/gemini-cli#installation",
        ),
    }
}

pub fn status(provider: Provider) -> CliStatus {
    let path = resolve(provider.binary());
    let (install_steps, docs) = install_steps(provider);
    CliStatus {
        provider: provider.as_str().into(),
        installed: path.is_some(),
        path: path.map(|p| p.to_string_lossy().to_string()),
        install_steps,
        docs_url: docs.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vindt_alleen_uitvoerbare_bestanden_in_de_opgegeven_mappen() {
        let tmp = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) {
            "mijncli.exe"
        } else {
            "mijncli"
        };
        let file = tmp.path().join(name);
        std::fs::write(&file, "x").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert!(
                resolve_in("mijncli", &[tmp.path().to_path_buf()]).is_none(),
                "niet-uitvoerbaar telt niet"
            );
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert_eq!(
            resolve_in("mijncli", &[tmp.path().to_path_buf()]),
            Some(file)
        );
        assert!(resolve_in("bestaat-niet", &[tmp.path().to_path_buf()]).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn commando_met_timeout_levert_uitvoer_en_wordt_gedood() {
        let mut ok = std::process::Command::new("sh");
        ok.args(["-c", "echo uit; echo fout 1>&2; exit 2"]);
        let o = output_with_timeout(ok, std::time::Duration::from_secs(5)).unwrap();
        assert_eq!(o.status, Some(2));
        assert!(o.text.contains("uit") && o.text.contains("fout"));

        let mut slow = std::process::Command::new("sleep");
        slow.arg("30");
        let t = std::time::Instant::now();
        let o = output_with_timeout(slow, std::time::Duration::from_millis(300)).unwrap();
        assert_eq!(o.status, None);
        assert!(t.elapsed() < std::time::Duration::from_secs(5));
    }

    #[test]
    fn argumenten_per_provider() {
        assert_eq!(ai_args(Provider::Claude, None, false), Vec::<String>::new());
        assert_eq!(ai_args(Provider::Claude, Some("hoi"), false), vec!["hoi"]);
        assert_eq!(
            ai_args(Provider::Gemini, Some("hoi"), false),
            vec!["-i", "hoi"]
        );
        assert_eq!(ai_args(Provider::Claude, Some("hoi"), true), vec!["-c"]);
        assert_eq!(ai_args(Provider::Gemini, None, true), vec!["--resume"]);
        assert_eq!(login_args(Provider::Claude), vec!["auth", "login"]);
        assert!(login_args(Provider::Gemini).is_empty());
    }

    #[test]
    fn profielvariabele_per_provider_en_geen_variabele_zonder_account() {
        let d = Path::new("/p/map");
        assert_eq!(
            profile_env(Provider::Claude, Some(d)),
            vec![("CLAUDE_CONFIG_DIR".to_string(), "/p/map".to_string())]
        );
        assert_eq!(
            profile_env(Provider::Gemini, Some(d))[0].0,
            "GEMINI_CLI_HOME"
        );
        assert!(profile_env(Provider::Claude, None).is_empty());
    }

    #[test]
    fn overdrachtsprompt_verwijst_naar_project_md_en_bevat_geen_aanhalingstekens() {
        assert!(HANDOVER_PROMPT.contains("PROJECT.md"));
        assert!(
            !HANDOVER_PROMPT.contains('"')
                && !HANDOVER_PROMPT.contains('&')
                && !HANDOVER_PROMPT.contains('|')
        );
    }

    #[test]
    fn installatie_uitleg_bestaat_voor_elke_provider() {
        for p in [Provider::Claude, Provider::Gemini] {
            assert!(!install_steps(p).0.is_empty());
        }
    }
}
