//! Vertaalt tool-aanroepen van de AI naar een `ActionKind` (mensentaal in de UI) en beoordeelt hoe zwaar ze zijn.
use super::events::ActionKind;
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub struct Classified {
    pub kind: ActionKind,
    /// Parameters voor de tekst in de UI (bijv. `{"file": "index.html"}`).
    pub params: Value,
    /// Ruwe, technische details voor het uitklapbare gedeelte.
    pub detail: String,
    /// Verwijderen/publiceren/…: vraagt altijd bevestiging, ongeacht de instelling.
    pub danger: bool,
    /// Verandert niets en stuurt niets weg.
    pub read_only: bool,
    /// Raakt een bestand buiten de projectmap.
    pub outside_project: bool,
    /// De AI vraagt om het plan goed te keuren (ExitPlanMode); `detail` bevat dan het plan.
    pub plan_exit: bool,
}

fn str_of<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| v.get(*k).and_then(Value::as_str))
}

fn clip(s: &str, n: usize) -> String {
    if s.chars().count() > n {
        format!("{}…", s.chars().take(n).collect::<String>())
    } else {
        s.to_string()
    }
}

fn file_name(path: &str) -> String {
    path.rsplit(['/', '\\'])
        .find(|s| !s.is_empty())
        .unwrap_or(path)
        .to_string()
}

/// Lexicaal opschonen (`.`/`..`), zonder het bestandssysteem aan te raken.
fn lexical(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

pub fn is_outside(project_dir: &Path, path: &str) -> bool {
    let p = Path::new(path);
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        project_dir.join(p)
    };
    !lexical(&abs).starts_with(lexical(project_dir))
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BashInfo {
    pub kind: ActionKind,
    pub danger: bool,
    pub read_only: bool,
}

/// Beoordeelt een shell-opdracht. Elk deel van een samengestelde opdracht (`&&`, `;`, `|`) telt mee: het gevaarlijkste wint.
pub fn bash_info(command: &str) -> BashInfo {
    let lower = command.to_lowercase();
    let segments: Vec<String> = lower
        .split([';', '|', '&', '\n'])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let starts = |seg: &str, words: &[&str]| {
        words
            .iter()
            .any(|w| seg == *w || seg.starts_with(&format!("{w} ")))
    };
    let contains = |seg: &str, words: &[&str]| words.iter().any(|w| seg.contains(w));

    let mut best = BashInfo {
        kind: ActionKind::RunCommand,
        danger: false,
        read_only: false,
    };
    let mut rank = 0u8;
    let mut consider = |info: BashInfo, r: u8| {
        if r > rank {
            best = info;
            rank = r;
        }
    };
    let mut all_read_only = !segments.is_empty();

    for seg in &segments {
        let seg = seg.trim_start_matches("sudo ").trim();
        if starts(
            seg,
            &[
                "git push",
                "npm publish",
                "pnpm publish",
                "yarn publish",
                "vercel",
                "netlify",
                "firebase deploy",
                "wrangler",
                "surge",
                "docker push",
                "gh release",
                "scp",
                "rsync",
                "ftp",
                "sftp",
            ],
        ) || contains(seg, &["curl -x post", "--upload-file"])
        {
            consider(
                BashInfo {
                    kind: ActionKind::Publish,
                    danger: true,
                    read_only: false,
                },
                9,
            );
            all_read_only = false;
        } else if starts(
            seg,
            &[
                "rm",
                "rmdir",
                "del",
                "erase",
                "rd",
                "remove-item",
                "shred",
                "unlink",
            ],
        ) || contains(
            seg,
            &[
                "git clean",
                "git reset --hard",
                "git checkout -- .",
                "drop table",
                "drop database",
                "mkfs",
                "format c:",
            ],
        ) {
            consider(
                BashInfo {
                    kind: ActionKind::DeleteFiles,
                    danger: true,
                    read_only: false,
                },
                8,
            );
            all_read_only = false;
        } else if starts(seg, &["git commit", "git add", "git stash"]) {
            consider(
                BashInfo {
                    kind: ActionKind::SaveVersion,
                    danger: false,
                    read_only: false,
                },
                4,
            );
            all_read_only = false;
        } else if starts(
            seg,
            &[
                "npm install",
                "npm i",
                "npm ci",
                "pnpm install",
                "pnpm add",
                "yarn",
                "yarn install",
                "yarn add",
                "pip install",
                "pip3 install",
                "cargo add",
                "bun install",
                "bun add",
            ],
        ) {
            consider(
                BashInfo {
                    kind: ActionKind::InstallPackages,
                    danger: false,
                    read_only: false,
                },
                5,
            );
            all_read_only = false;
        } else if starts(
            seg,
            &[
                "npm test",
                "npm run test",
                "npm run lint",
                "npm run build",
                "npm run check",
                "npm run typecheck",
                "vitest",
                "jest",
                "eslint",
                "tsc",
                "pytest",
                "cargo test",
                "cargo build",
                "cargo clippy",
                "go test",
                "go build",
                "vite build",
                "npx vitest",
                "npx jest",
                "npx eslint",
                "npx tsc",
                "pnpm test",
                "pnpm run test",
                "pnpm build",
                "pnpm lint",
                "yarn test",
                "yarn build",
                "yarn lint",
            ],
        ) {
            consider(
                BashInfo {
                    kind: ActionKind::RunChecks,
                    danger: false,
                    read_only: false,
                },
                6,
            );
            all_read_only = false;
        } else if starts(
            seg,
            &[
                "npm run dev",
                "npm start",
                "npm run start",
                "vite",
                "next dev",
                "npx vite",
                "npx serve",
                "python -m http.server",
                "python3 -m http.server",
                "pnpm dev",
                "pnpm start",
                "yarn dev",
                "yarn start",
                "bun dev",
            ],
        ) {
            consider(
                BashInfo {
                    kind: ActionKind::StartServer,
                    danger: false,
                    read_only: false,
                },
                3,
            );
            all_read_only = false;
        } else if starts(
            seg,
            &[
                "ls",
                "dir",
                "cat",
                "head",
                "tail",
                "pwd",
                "find",
                "grep",
                "rg",
                "tree",
                "wc",
                "echo",
                "type",
                "git status",
                "git diff",
                "git log",
                "git show",
                "git branch",
                "which",
                "where",
                "node --version",
                "npm --version",
                "cd",
            ],
        ) {
            consider(
                BashInfo {
                    kind: ActionKind::Search,
                    danger: false,
                    read_only: true,
                },
                1,
            );
        } else {
            consider(
                BashInfo {
                    kind: ActionKind::RunCommand,
                    danger: false,
                    read_only: false,
                },
                2,
            );
            all_read_only = false;
        }
    }
    if rank <= 1 && all_read_only {
        best.read_only = true;
    }
    best
}

fn compact_json(v: &Value) -> String {
    clip(&serde_json::to_string(v).unwrap_or_default(), 400)
}

/// Classificeert een tool-aanroep (naam + invoer). `project_dir` is nodig om "buiten het project" te herkennen.
pub fn classify(tool: &str, input: &Value, project_dir: &Path) -> Classified {
    let mut c = Classified {
        kind: ActionKind::Other,
        params: json!({ "tool": tool }),
        detail: format!("{tool} {}", compact_json(input)),
        danger: false,
        read_only: false,
        outside_project: false,
        plan_exit: false,
    };
    let path = str_of(input, &["file_path", "path", "notebook_path"]);
    let with_file = |c: &mut Classified, kind: ActionKind| {
        c.kind = kind;
        if let Some(p) = path {
            c.params = json!({ "file": file_name(p), "path": p, "page": p.to_lowercase().ends_with(".html") || p.to_lowercase().ends_with(".htm") });
            c.detail = p.to_string();
            c.outside_project = is_outside(project_dir, p);
        }
    };
    match tool {
        "Write" => with_file(&mut c, ActionKind::FileCreated),
        "Edit" | "MultiEdit" | "NotebookEdit" => with_file(&mut c, ActionKind::FileEdited),
        "Read" => {
            with_file(&mut c, ActionKind::FileRead);
            c.read_only = true;
        }
        "Glob" | "Grep" | "LS" => {
            c.kind = ActionKind::Search;
            c.read_only = true;
            c.params = json!({ "query": str_of(input, &["pattern", "path"]).unwrap_or("") });
        }
        "Bash" | "BashOutput" | "KillShell" => {
            let cmd = str_of(input, &["command"]).unwrap_or("");
            let b = bash_info(cmd);
            c.kind = b.kind;
            c.danger = b.danger;
            c.read_only = b.read_only;
            c.params = json!({ "command": clip(cmd, 200) });
            c.detail = cmd.to_string();
        }
        "TodoWrite" => {
            c.kind = ActionKind::Plan;
            c.read_only = true;
        }
        "ExitPlanMode" => {
            c.kind = ActionKind::Plan;
            c.plan_exit = true;
            c.detail = str_of(input, &["plan"]).unwrap_or("").to_string();
        }
        "WebSearch" | "WebFetch" => {
            c.kind = ActionKind::WebLookup;
            c.params = json!({ "query": str_of(input, &["query", "url"]).unwrap_or("") });
        }
        "Task" | "Agent" => c.kind = ActionKind::Helper,
        t if t.starts_with("mcp__studio__") => {
            let name = &t["mcp__studio__".len()..];
            c.read_only = matches!(
                name,
                "read_project_notes"
                    | "project_status"
                    | "get_dev_logs"
                    | "git_list_checkpoints"
                    | "get_console_errors"
                    | "get_preview_screenshot"
            );
            c.kind = match name {
                "run_checks" => ActionKind::RunChecks,
                "get_preview_screenshot" => ActionKind::ViewPreview,
                "get_console_errors" => ActionKind::FindPageErrors,
                "get_dev_logs" => ActionKind::ReadLogs,
                "git_checkpoint" => ActionKind::SaveVersion,
                "git_list_checkpoints" => ActionKind::ListVersions,
                "read_project_notes" | "project_status" => ActionKind::ReadNotes,
                "update_project_notes" => ActionKind::UpdateNotes,
                _ => ActionKind::Other,
            };
            if name == "git_checkpoint" {
                c.params = json!({ "message": clip(str_of(input, &["bericht", "message"]).unwrap_or(""), 120) });
            }
        }
        _ => {}
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> PathBuf {
        PathBuf::from("/home/u/Mijn Project")
    }

    #[test]
    fn bestanden_krijgen_paginanaam_en_buiten_project_vlag() {
        let c = classify(
            "Write",
            &json!({"file_path": "/home/u/Mijn Project/index.html", "content": "x"}),
            &dir(),
        );
        assert_eq!(
            (
                c.kind,
                c.params["file"].as_str(),
                c.params["page"].as_bool()
            ),
            (ActionKind::FileCreated, Some("index.html"), Some(true))
        );
        assert!(!c.outside_project && !c.danger);
        let c = classify("Edit", &json!({"file_path": "css/app.css"}), &dir());
        assert_eq!(
            (c.kind, c.params["page"].as_bool()),
            (ActionKind::FileEdited, Some(false))
        );
        assert!(!c.outside_project, "relatief pad = in het project");
        assert!(classify("Write", &json!({"file_path": "/etc/hosts"}), &dir()).outside_project);
        assert!(classify("Write", &json!({"file_path": "../geheim.txt"}), &dir()).outside_project);
        assert!(
            !classify("Write", &json!({"file_path": "src/../index.html"}), &dir()).outside_project
        );
    }

    #[test]
    fn windows_paden_worden_herkend_als_buiten() {
        let d = PathBuf::from("C:\\Users\\piete\\Mijn Project");
        let inside = is_outside(&d, "src/main.js");
        assert!(!inside);
    }

    #[test]
    fn bash_gevaarlijk_wint_van_onschuldig() {
        assert_eq!(bash_info("rm -rf dist").kind, ActionKind::DeleteFiles);
        assert!(bash_info("rm -rf dist").danger);
        assert!(bash_info("npm run build && rm -rf node_modules").danger);
        assert_eq!(bash_info("git push origin main").kind, ActionKind::Publish);
        assert!(bash_info("npm publish").danger && bash_info("vercel --prod").danger);
        assert!(!bash_info("npm install").danger);
        assert!(bash_info("git reset --hard HEAD~1").danger);
        assert!(bash_info("cd x; sudo rm file").danger);
    }

    #[test]
    fn bash_herkent_gewone_soorten() {
        assert_eq!(
            bash_info("npm install vite").kind,
            ActionKind::InstallPackages
        );
        assert_eq!(bash_info("npm run build").kind, ActionKind::RunChecks);
        assert_eq!(bash_info("npx vitest run").kind, ActionKind::RunChecks);
        assert_eq!(bash_info("npm run dev").kind, ActionKind::StartServer);
        assert_eq!(bash_info("git commit -m 'x'").kind, ActionKind::SaveVersion);
        let ls = bash_info("ls -la && git status");
        assert_eq!((ls.kind, ls.read_only), (ActionKind::Search, true));
        let x = bash_info("node scripts/maak-iets.js");
        assert_eq!(
            (x.kind, x.read_only, x.danger),
            (ActionKind::RunCommand, false, false)
        );
        assert_eq!(bash_info("").kind, ActionKind::RunCommand);
    }

    #[test]
    fn plan_goedkeuren_is_herkenbaar_en_bevat_het_plan() {
        let c = classify(
            "ExitPlanMode",
            &json!({"plan": "# Plan\n1. Maak index.html"}),
            &dir(),
        );
        assert!(c.plan_exit && !c.read_only && !c.danger);
        assert_eq!(c.kind, ActionKind::Plan);
        assert!(c.detail.contains("Maak index.html"));
        assert!(!classify("Write", &json!({}), &dir()).plan_exit);
    }

    #[test]
    fn studio_mcp_tools_worden_vertaald() {
        let c = classify("mcp__studio__run_checks", &json!({}), &dir());
        assert_eq!(c.kind, ActionKind::RunChecks);
        assert_eq!(
            classify("mcp__studio__get_preview_screenshot", &json!({}), &dir()).kind,
            ActionKind::ViewPreview
        );
        let c = classify(
            "mcp__studio__git_checkpoint",
            &json!({"bericht": "Inlog toegevoegd"}),
            &dir(),
        );
        assert_eq!(
            (c.kind, c.params["message"].as_str()),
            (ActionKind::SaveVersion, Some("Inlog toegevoegd"))
        );
        assert_eq!(
            classify("mcp__github__list_issues", &json!({}), &dir()).kind,
            ActionKind::Other
        );
        assert_eq!(
            classify("TodoWrite", &json!({}), &dir()).kind,
            ActionKind::Plan
        );
        assert_eq!(
            classify("WebSearch", &json!({"query": "kleuren"}), &dir()).kind,
            ActionKind::WebLookup
        );
        assert_eq!(
            classify("Onbekend", &json!({"a": 1}), &dir()).kind,
            ActionKind::Other
        );
    }
}
