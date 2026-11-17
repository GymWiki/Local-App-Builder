//! Betrouwbaar Node.js vinden, ook voor een GUI-app die een kaal PATH meekrijgt (vooral Windows/macOS).
use crate::cli;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

/// Minimale hoofdversie van Node.js (de gebundelde MCP-server is op Node 20 gebouwd).
pub const MIN_MAJOR: u32 = 20;

#[derive(Debug, Clone, PartialEq)]
pub struct NodeInfo {
    pub path: PathBuf,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum NodeProblem {
    Missing { searched: Vec<PathBuf> },
    TooOld { path: PathBuf, version: String },
    Broken { path: PathBuf, reason: String },
}

impl NodeProblem {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Missing { .. } => "node_missing",
            Self::TooOld { .. } => "node_old",
            Self::Broken { .. } => "node_broken",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::Missing { searched } => {
                let list: Vec<String> = searched
                    .iter()
                    .take(12)
                    .map(|p| p.display().to_string())
                    .collect();
                format!(
                    "Node.js niet gevonden. Gezocht in o.a.: {}. Installeer Node.js {MIN_MAJOR} of nieuwer (https://nodejs.org) en start Studio opnieuw, of zet STUDIO_NODE_PATH naar node.exe.",
                    list.join("; ")
                )
            }
            Self::TooOld { path, version } => format!(
                "Node.js {version} gevonden op {}, maar versie {MIN_MAJOR} of nieuwer is nodig.",
                path.display()
            ),
            Self::Broken { path, reason } => {
                format!(
                    "Node.js op {} kon niet worden gestart: {reason}",
                    path.display()
                )
            }
        }
    }
}

pub fn parse_major(version: &str) -> Option<u32> {
    version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .next()?
        .parse()
        .ok()
}

/// Draait `<node> --version` met een time-out van 5 s.
pub fn probe(path: &Path) -> std::result::Result<String, String> {
    let mut cmd = Command::new(path);
    cmd.arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cli::output_with_timeout(cmd, Duration::from_secs(5))?;
    if out.status != Some(0) {
        let msg = out
            .text
            .lines()
            .last()
            .unwrap_or("onbekende fout")
            .to_string();
        return Err(format!("afgesloten met code {:?}: {msg}", out.status));
    }
    Ok(out.text.trim().to_string())
}

fn exe_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["node.exe"]
    } else {
        &["node"]
    }
}

/// Onderliggende mappen van `base`, nieuwste (alfabetisch laatste) eerst.
fn subdirs(base: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(base)
        .map(|r| {
            r.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v.reverse();
    v
}

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// PATH eerst, daarna bekende installatieplekken (installers, nvm, fnm, volta, scoop, Homebrew).
pub fn candidate_dirs() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    let mut add = |p: PathBuf| {
        if !v.contains(&p) {
            v.push(p);
        }
    };
    let home = env_path("USERPROFILE").or_else(|| env_path("HOME"));
    if cfg!(windows) {
        for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
            if let Some(p) = env_path(var) {
                add(p.join("nodejs"));
            }
        }
        if let Some(p) = env_path("LOCALAPPDATA") {
            add(p.join("Programs").join("nodejs"));
            add(p.join("Volta").join("bin"));
        }
        for var in ["NVM_SYMLINK", "FNM_MULTISHELL_PATH"] {
            if let Some(p) = env_path(var) {
                add(p);
            }
        }
        if let Some(p) = env_path("VOLTA_HOME") {
            add(p.join("bin"));
        }
        if let Some(p) = env_path("NVM_HOME") {
            subdirs(&p).into_iter().for_each(&mut add);
        }
        if let Some(h) = &home {
            add(h.join("scoop").join("apps").join("nodejs").join("current"));
            add(h.join("scoop").join("shims"));
        }
        if let Some(p) = env_path("ChocolateyInstall") {
            add(p.join("bin"));
        }
    } else {
        for p in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
            add(PathBuf::from(p));
        }
        if let Some(h) = &home {
            add(h.join(".volta").join("bin"));
            add(h.join(".asdf").join("shims"));
            add(h.join(".local").join("bin"));
            for d in subdirs(&h.join(".nvm").join("versions").join("node")) {
                add(d.join("bin"));
            }
            for d in subdirs(
                &h.join(".local")
                    .join("share")
                    .join("fnm")
                    .join("node-versions"),
            ) {
                add(d.join("installation").join("bin"));
            }
        }
    }
    v
}

/// Zoekt een bruikbare Node in `dirs` (en eerst in `override_path`). Probeert elke kandidaat echt uit.
pub fn find_in(
    dirs: &[PathBuf],
    override_path: Option<PathBuf>,
) -> std::result::Result<NodeInfo, NodeProblem> {
    let mut candidates: Vec<PathBuf> = override_path.into_iter().collect();
    for d in dirs {
        for n in exe_names() {
            let p = d.join(n);
            if p.is_file() && !candidates.contains(&p) {
                candidates.push(p);
            }
        }
    }
    let mut problem: Option<NodeProblem> = None;
    for path in candidates {
        match probe(&path) {
            Ok(version) => match parse_major(&version) {
                Some(m) if m >= MIN_MAJOR => return Ok(NodeInfo { path, version }),
                _ => {
                    // een te oude Node wint van "kapot" en "ontbreekt" als melding
                    if !matches!(problem, Some(NodeProblem::TooOld { .. })) {
                        problem = Some(NodeProblem::TooOld { path, version });
                    }
                }
            },
            Err(reason) => {
                if problem.is_none() {
                    problem = Some(NodeProblem::Broken { path, reason });
                }
            }
        }
    }
    Err(problem.unwrap_or(NodeProblem::Missing {
        searched: dirs.to_vec(),
    }))
}

pub fn find() -> std::result::Result<NodeInfo, NodeProblem> {
    find_in(&candidate_dirs(), env_path("STUDIO_NODE_PATH"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versies_worden_geparsed() {
        assert_eq!(parse_major("v22.3.1\n"), Some(22));
        assert_eq!(parse_major("20.0.0"), Some(20));
        assert_eq!(parse_major("rommel"), None);
    }

    #[test]
    fn niets_gevonden_geeft_missing_met_gezochte_mappen_en_hint() {
        let d = tempfile::tempdir().unwrap();
        let e = find_in(&[d.path().to_path_buf()], None).unwrap_err();
        assert_eq!(e.kind(), "node_missing");
        let m = e.message();
        assert!(
            m.contains(&d.path().display().to_string())
                && m.contains("STUDIO_NODE_PATH")
                && m.contains("20")
        );
    }

    #[cfg(unix)]
    fn fake_node(dir: &Path, version_output: &str, exit: i32) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let p = dir.join("node");
        std::fs::write(
            &p,
            format!("#!/bin/sh\necho {version_output}\nexit {exit}\n"),
        )
        .unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    #[cfg(unix)]
    #[test]
    fn vindt_werkende_node_en_leest_versie() {
        let d = tempfile::tempdir().unwrap();
        let p = fake_node(d.path(), "v22.1.0", 0);
        let n = find_in(&[d.path().to_path_buf()], None).unwrap();
        assert_eq!((n.path, n.version.as_str()), (p, "v22.1.0"));
    }

    #[cfg(unix)]
    #[test]
    fn te_oude_en_kapotte_node_geven_duidelijke_problemen() {
        let old = tempfile::tempdir().unwrap();
        fake_node(old.path(), "v16.20.0", 0);
        let e = find_in(&[old.path().to_path_buf()], None).unwrap_err();
        assert_eq!(e.kind(), "node_old");
        assert!(e.message().contains("v16.20.0"));

        let broken = tempfile::tempdir().unwrap();
        fake_node(broken.path(), "boem", 3);
        let e = find_in(&[broken.path().to_path_buf()], None).unwrap_err();
        assert_eq!(e.kind(), "node_broken");
    }

    #[cfg(unix)]
    #[test]
    fn override_en_latere_map_met_werkende_node_wint_van_kapotte() {
        let broken = tempfile::tempdir().unwrap();
        fake_node(broken.path(), "x", 1);
        let good = tempfile::tempdir().unwrap();
        let g = fake_node(good.path(), "v20.0.0", 0);
        let n = find_in(
            &[broken.path().to_path_buf(), good.path().to_path_buf()],
            None,
        )
        .unwrap();
        assert_eq!(n.path, g);
        let n = find_in(&[], Some(g.clone())).unwrap();
        assert_eq!(n.path, g);
    }

    #[test]
    fn echte_node_wordt_gevonden_als_die_er_is() {
        // Geen harde eis aan de omgeving: als Node 20+ aanwezig is, moet find() hem vinden.
        if let Ok(n) = find() {
            assert!(parse_major(&n.version).unwrap() >= MIN_MAJOR);
        }
    }
}
