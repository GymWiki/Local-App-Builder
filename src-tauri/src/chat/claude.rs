//! Adapter voor Claude Code (`claude -p --input-format stream-json --output-format stream-json`).
//! Schema: zie docs/cli-notes.md (bronnen: headless.md, agent-sdk/typescript.md).
use super::events::{ActionKind, ChatEvent, CheckInfo, ErrorCode, Status};
use super::human;
use super::tools;
use super::{ChatAdapter, Launch, LaunchCtx};
use crate::cli;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

#[derive(Default)]
pub struct ClaudeAdapter {
    /// tool_use-id → (soort, technische details zoals het commando)
    pending: HashMap<String, (ActionKind, String)>,
    last_check_failed: bool,
    seen_valid: bool,
    junk: u32,
    session: Option<String>,
    turn_error_sent: bool,
    fallback_sent: bool,
}

impl ClaudeAdapter {
    pub fn new() -> Self {
        Self::default()
    }
}

fn clip(s: &str, n: usize) -> String {
    if s.chars().count() > n {
        format!("{}…", s.chars().take(n).collect::<String>())
    } else {
        s.to_string()
    }
}

fn result_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(a) => a
            .iter()
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Maakt een foutregel vergelijkbaar: kleine letters, getallen → #, paden → pad, korte lengte.
pub fn normalize_signature(line: &str) -> String {
    let words: Vec<String> = line
        .split_whitespace()
        .map(|w| {
            if w.contains('/') || w.contains('\\') {
                "pad".to_string()
            } else {
                w.to_lowercase()
            }
        })
        .collect();
    let joined = words.join(" ");
    let mut out = String::new();
    let mut prev_digit = false;
    for c in joined.chars() {
        if c.is_ascii_digit() {
            if !prev_digit {
                out.push('#');
            }
            prev_digit = true;
        } else {
            out.push(c);
            prev_digit = false;
        }
    }
    out.chars().take(160).collect()
}

fn bash_step(cmd: &str) -> &'static str {
    let c = cmd.to_lowercase();
    if c.contains("lint") || c.contains("eslint") || c.contains("clippy") {
        "lint"
    } else if c.contains("test")
        || c.contains("vitest")
        || c.contains("jest")
        || c.contains("pytest")
    {
        "test"
    } else if c.contains("build") || c.contains("tsc") {
        "build"
    } else {
        "check"
    }
}

/// Haalt uit het resultaat van een controle wat de bug-lus bewaker nodig heeft.
/// Studio's `run_checks` geeft "CHECKS MISLUKT" + JSON; een gewoon commando (npm run build, vitest, …) alleen tekst.
pub fn check_info(detail: &str, ok: bool, text: &str) -> Option<CheckInfo> {
    if text.contains("CHECKS MISLUKT") || text.contains("ALLE CHECKS GESLAAGD") {
        if !text.contains("CHECKS MISLUKT") {
            return Some(CheckInfo {
                ok: true,
                ..Default::default()
            });
        }
        let json: Option<Value> = text
            .find('{')
            .and_then(|i| serde_json::from_str(&text[i..]).ok());
        let failed: Vec<&Value> = json
            .as_ref()
            .and_then(|j| j["steps"].as_array())
            .map(|a| {
                a.iter()
                    .filter(|s| matches!(s["status"].as_str(), Some("failed") | Some("timeout")))
                    .collect()
            })
            .unwrap_or_default();
        let steps: Vec<String> = failed
            .iter()
            .filter_map(|s| s["name"].as_str().map(str::to_string))
            .collect();
        let first_line = failed
            .first()
            .and_then(|s| s["output"].as_array())
            .and_then(|o| {
                o.iter()
                    .filter_map(Value::as_str)
                    .find(|l| !l.trim().is_empty() && *l != "…")
            })
            .unwrap_or("");
        let count: usize = failed
            .iter()
            .map(|s| s["output"].as_array().map(|o| o.len()).unwrap_or(1).max(1))
            .sum();
        let signature = format!(
            "{}: {}",
            steps.first().cloned().unwrap_or_default(),
            normalize_signature(first_line)
        );
        return Some(CheckInfo {
            ok: false,
            steps,
            signature,
            count: count.max(1),
        });
    }
    if ok {
        return Some(CheckInfo {
            ok: true,
            ..Default::default()
        });
    }
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let is_err = |l: &str| {
        let low = l.to_lowercase();
        low.contains("error") || low.contains("fail") || low.contains("✖") || low.contains("×")
    };
    let first = lines
        .iter()
        .copied()
        .find(|l| is_err(l))
        .or(lines.first().copied())
        .unwrap_or("");
    let count = lines.iter().filter(|l| is_err(l)).count().max(1);
    let step = bash_step(detail);
    Some(CheckInfo {
        ok: false,
        steps: vec![step.to_string()],
        signature: format!("{step}: {}", normalize_signature(first)),
        count,
    })
}

/// Kent deze versie van de CLI een vlag? Eén keer per programma nagekeken met `--help` (lokaal, geen netwerk, geen AI-gebruik).
fn ondersteunt(binary: &str, vlag: &str) -> bool {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    static HELP: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    let kaart = HELP.get_or_init(Default::default);
    if let Some(h) = kaart.lock().unwrap().get(binary) {
        return h.contains(vlag);
    }
    let (program, args) = cli::launch(Path::new(binary), vec!["--help".to_string()]);
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let uit = std::process::Command::new(program).args(args).stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null()).output();
        let _ = tx.send(uit.map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default());
    });
    let help = rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap_or_default();
    let ok = help.contains(vlag);
    // Alleen onthouden als de help echt gelezen is (anders de volgende keer opnieuw proberen).
    if !help.is_empty() {
        kaart.lock().unwrap().insert(binary.to_string(), help);
    }
    ok
}

impl ChatAdapter for ClaudeAdapter {
    fn launch(&self, ctx: &LaunchCtx) -> Launch {
        let mut args: Vec<String> = [
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
        ]
        .map(String::from)
        .to_vec();
        if ctx.plan {
            // Eerst overleggen: Claude start in zijn planmodus en wijzigt niets (permission-modes.md).
            args.extend(["--permission-mode".into(), "plan".into()]);
        }
        if let Some(tool) = &ctx.permission_tool {
            args.extend(["--permission-prompt-tool".into(), tool.clone()]);
            // Onze eigen Studio-tools (controleren, screenshot, versies) hoeven nooit om toestemming te vragen.
            args.extend(["--allowedTools".into(), "mcp__studio".into()]);
        }
        if let Some(cfg) = &ctx.mcp_config {
            args.extend(["--mcp-config".into(), cfg.to_string_lossy().to_string()]);
        }
        if let Some(id) = &ctx.resume {
            args.extend(["--resume".into(), id.clone()]);
        }
        // Model en inspanning volgens het beleid (alleen als de gebruiker of het beleid er een vraagt).
        if let Some(m) = &ctx.keuze.model {
            args.extend(["--model".into(), m.clone()]);
        }
        if let Some(e) = &ctx.keuze.effort {
            args.extend(["--effort".into(), e.clone()]);
        }
        // Vaste voorkant voor de cache: per-computergegevens (map, git-status) verhuizen van de systeemprompt naar het eerste bericht,
        // zodat een nieuwe sessie dezelfde voorkant heeft. Alleen als deze versie van de CLI de vlag kent (gecontroleerd met --help).
        if ondersteunt(&ctx.binary.to_string_lossy(), "--exclude-dynamic-system-prompt-sections") {
            args.push("--exclude-dynamic-system-prompt-sections".into());
        }
        let (program, args) = cli::launch(Path::new(&ctx.binary), args);
        Launch { program, args }
    }

    fn supports_plan_mode(&self) -> bool {
        true
    }

    fn encode_user(&self, text: &str) -> String {
        let mut line =
            serde_json::json!({ "type": "user", "message": { "role": "user", "content": text } })
                .to_string();
        line.push('\n');
        line
    }

    fn seen_structured(&self) -> bool {
        self.seen_valid
    }

    fn parse_line(&mut self, line: &str) -> Vec<ChatEvent> {
        let line = line.trim();
        if line.is_empty() {
            return vec![];
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            if !self.seen_valid {
                self.junk += 1;
                if self.junk >= 3 && !self.fallback_sent {
                    self.fallback_sent = true;
                    return vec![ChatEvent::Fallback {
                        reason: "unstructured".into(),
                    }];
                }
            }
            return vec![];
        };
        let Some(ty) = v.get("type").and_then(Value::as_str) else {
            return vec![];
        };
        self.seen_valid = true;
        let mut out = Vec::new();
        let note_session = |this: &mut Self, out: &mut Vec<ChatEvent>, id: Option<&str>| {
            if let Some(id) = id {
                if this.session.as_deref() != Some(id) {
                    this.session = Some(id.to_string());
                    out.push(ChatEvent::Session {
                        session_id: id.to_string(),
                    });
                }
            }
        };
        match ty {
            "system" => {
                if v["subtype"] == "init" {
                    note_session(self, &mut out, v["session_id"].as_str());
                    // Zonder de Studio-koppeling kan de AI geen toestemming vragen en niets controleren: meteen melden.
                    let studio_failed = v["mcp_servers"].as_array().is_some_and(|a| {
                        a.iter()
                            .any(|s| s["name"] == "studio" && s["status"] == "failed")
                    });
                    if studio_failed {
                        out.push(ChatEvent::Error {
                            code: ErrorCode::McpUnavailable,
                            technical: "studio: status failed (system/init)".into(),
                        });
                    }
                }
            }
            "assistant" => {
                // Berichten van subagents tonen we niet apart: alleen de hoofdlijn.
                if !v["parent_tool_use_id"].is_null() {
                    return out;
                }
                let msg = &v["message"];
                if let Some(cat) = v["error"].as_str() {
                    let technical = result_text(&msg["content"]);
                    self.turn_error_sent = true;
                    out.push(ChatEvent::Error {
                        code: human::from_category(cat),
                        technical: if technical.is_empty() {
                            cat.to_string()
                        } else {
                            format!("{cat}: {technical}")
                        },
                    });
                    return out;
                }
                let msg_id = msg["id"].as_str().unwrap_or("msg");
                let Some(blocks) = msg["content"].as_array() else {
                    return out;
                };
                for (i, b) in blocks.iter().enumerate() {
                    match b["type"].as_str() {
                        Some("text") => {
                            let t = b["text"].as_str().unwrap_or("").trim();
                            if !t.is_empty() {
                                out.push(ChatEvent::Text {
                                    id: format!("{msg_id}-{i}"),
                                    text: t.to_string(),
                                });
                            }
                        }
                        Some("thinking") => out.push(ChatEvent::Status {
                            state: Status::Thinking,
                        }),
                        Some("tool_use") => {
                            let name = b["name"].as_str().unwrap_or("");
                            let id = b["id"].as_str().unwrap_or("").to_string();
                            let c = tools::classify(name, &b["input"], Path::new(""));
                            self.pending.insert(id.clone(), (c.kind, c.detail.clone()));
                            out.push(ChatEvent::Action {
                                id,
                                kind: c.kind,
                                params: c.params,
                                detail: clip(&c.detail, 2000),
                            });
                        }
                        _ => {}
                    }
                }
            }
            "user" => {
                let Some(blocks) = v["message"]["content"].as_array() else {
                    return out;
                };
                for b in blocks {
                    if b["type"] != "tool_result" {
                        continue;
                    }
                    let Some(id) = b["tool_use_id"].as_str() else {
                        continue;
                    };
                    let Some((kind, detail)) = self.pending.remove(id) else {
                        continue;
                    }; // tool_result van een subagent
                    let text = result_text(&b["content"]);
                    let mut ok = b["is_error"] != true;
                    if kind == ActionKind::RunChecks && text.contains("CHECKS MISLUKT") {
                        ok = false;
                    }
                    let mut fixed = false;
                    if kind == ActionKind::RunChecks {
                        if !ok {
                            self.last_check_failed = true;
                        } else if self.last_check_failed {
                            fixed = true;
                            self.last_check_failed = false;
                        }
                    }
                    out.push(ChatEvent::ActionResult {
                        id: id.to_string(),
                        ok,
                        fixed,
                        summary: clip(&text, 600),
                        check: if kind == ActionKind::RunChecks {
                            check_info(&detail, ok, &text)
                        } else {
                            None
                        },
                    });
                }
            }
            "result" => {
                note_session(self, &mut out, v["session_id"].as_str());
                let sub = v["subtype"].as_str().unwrap_or("");
                let is_error = v["is_error"] == true || sub.starts_with("error");
                if is_error && !self.turn_error_sent {
                    {
                        let text = v["result"].as_str().unwrap_or(sub).to_string();
                        let code = if sub.starts_with("error") {
                            ErrorCode::Unknown
                        } else {
                            human::classify_text(&text)
                        };
                        out.push(ChatEvent::Error {
                            code,
                            technical: if text.is_empty() {
                                sub.to_string()
                            } else {
                                text
                            },
                        });
                    }
                }
                self.turn_error_sent = false;
                if let Some(u) = v["usage"].as_object() {
                    let n = |k: &str| u.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
                    out.push(ChatEvent::Usage {
                        input: n("input_tokens"),
                        output: n("output_tokens"),
                        cache_read: n("cache_read_input_tokens"),
                        cache_write: n("cache_creation_input_tokens"),
                        turns: v["num_turns"].as_u64().unwrap_or(0),
                    });
                }
                out.push(ChatEvent::TurnDone { ok: !is_error });
            }
            _ => {}
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn run(fixture: &str) -> Vec<ChatEvent> {
        let mut a = ClaudeAdapter::new();
        fixture.lines().flat_map(|l| a.parse_line(l)).collect()
    }

    const SIMPLE: &str = include_str!("../../tests/fixtures/claude/simple_turn.jsonl");
    const BUILD: &str = include_str!("../../tests/fixtures/claude/build_page.jsonl");
    const BASH: &str = include_str!("../../tests/fixtures/claude/bash_commands.jsonl");
    const AUTH: &str = include_str!("../../tests/fixtures/claude/auth_error.jsonl");
    const RETRY: &str = include_str!("../../tests/fixtures/claude/retry_and_unknown.jsonl");
    const MAXT: &str = include_str!("../../tests/fixtures/claude/max_turns.jsonl");
    const SUB: &str = include_str!("../../tests/fixtures/claude/subagent.jsonl");
    const GARBAGE: &str = include_str!("../../tests/fixtures/claude/garbage.txt");

    #[test]
    fn eenvoudige_beurt_geeft_sessie_tekst_en_klaar() {
        let ev = run(SIMPLE);
        assert_eq!(
            ev[0],
            ChatEvent::Session {
                session_id: "b6f1c2d4-1111-4a2b-9c3d-0123456789ab".into()
            }
        );
        assert_eq!(
            ev[1],
            ChatEvent::Text {
                id: "msg_01-0".into(),
                text: "Hallo! Wat wil je maken?".into()
            }
        );
        assert_eq!(ev.last().unwrap(), &ChatEvent::TurnDone { ok: true });
        assert_eq!(
            ev.len(),
            3,
            "session-id uit result is al bekend: geen tweede Session-event"
        );
    }

    #[test]
    fn pagina_bouwen_geeft_acties_resultaten_en_hersteld_foutje() {
        let ev = run(BUILD);
        let actions: Vec<(&str, ActionKind)> = ev
            .iter()
            .filter_map(|e| {
                if let ChatEvent::Action { id, kind, .. } = e {
                    Some((id.as_str(), *kind))
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(
            actions,
            vec![
                ("toolu_w1", ActionKind::FileCreated),
                ("toolu_c1", ActionKind::RunChecks),
                ("toolu_w2", ActionKind::FileCreated),
                ("toolu_c2", ActionKind::RunChecks),
                ("toolu_s1", ActionKind::SaveVersion),
            ]
        );
        // eerste Write: pagina index.html
        let ChatEvent::Action { params, .. } = ev
            .iter()
            .find(|e| matches!(e, ChatEvent::Action { id, .. } if id == "toolu_w1"))
            .unwrap()
        else {
            unreachable!()
        };
        assert_eq!(
            (params["file"].as_str(), params["page"].as_bool()),
            (Some("index.html"), Some(true))
        );
        // eerste check mislukt (ook al is is_error niet gezet), tweede geslaagd én als hersteld gemarkeerd
        let res = |id: &str| {
            ev.iter()
                .find_map(|e| match e {
                    ChatEvent::ActionResult {
                        id: i, ok, fixed, ..
                    } if i == id => Some((*ok, *fixed)),
                    _ => None,
                })
                .unwrap()
        };
        assert_eq!(res("toolu_w1"), (true, false));
        assert_eq!(res("toolu_c1"), (false, false));
        assert_eq!(res("toolu_c2"), (true, true));
        // twee tekstballonnen van de AI vóór de acties + eindtekst; thinking wordt een status
        let texts: Vec<&str> = ev
            .iter()
            .filter_map(|e| {
                if let ChatEvent::Text { text, .. } = e {
                    Some(text.as_str())
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(texts.len(), 3);
        assert!(texts[0].starts_with("Ik maak een eenvoudige pagina"));
        assert!(ev.contains(&ChatEvent::Status {
            state: Status::Thinking
        }));
        assert_eq!(ev.last().unwrap(), &ChatEvent::TurnDone { ok: true });
    }

    #[test]
    fn bash_opdrachten_worden_gerangschikt_en_mislukte_build_wordt_later_hersteld() {
        let ev = run(BASH);
        let kinds: Vec<ActionKind> = ev
            .iter()
            .filter_map(|e| {
                if let ChatEvent::Action { kind, .. } = e {
                    Some(*kind)
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(
            kinds,
            vec![
                ActionKind::InstallPackages,
                ActionKind::RunChecks,
                ActionKind::FileEdited,
                ActionKind::RunChecks
            ]
        );
        let res = |id: &str| {
            ev.iter()
                .find_map(|e| match e {
                    ChatEvent::ActionResult {
                        id: i,
                        ok,
                        fixed,
                        summary,
                        ..
                    } if i == id => Some((*ok, *fixed, summary.clone())),
                    _ => None,
                })
                .unwrap()
        };
        let (ok, fixed, summary) = res("t2");
        assert!(!ok && !fixed);
        assert!(
            summary.contains("TS2322"),
            "technische details blijven beschikbaar"
        );
        assert!(res("t4").0);
        assert!(
            res("t4").1,
            "tweede build na een mislukte = foutje hersteld"
        );
    }

    #[test]
    fn inlogfout_geeft_een_foutgebeurtenis_zonder_dubbele_melding() {
        let ev = run(AUTH);
        let errors: Vec<&ChatEvent> = ev
            .iter()
            .filter(|e| matches!(e, ChatEvent::Error { .. }))
            .collect();
        assert_eq!(errors.len(), 1, "{ev:?}");
        assert!(matches!(
            errors[0],
            ChatEvent::Error {
                code: ErrorCode::NotLoggedIn,
                ..
            }
        ));
        assert!(
            !ev.iter().any(|e| matches!(e, ChatEvent::Text { .. })),
            "foutregel is geen tekstballon"
        );
        assert_eq!(ev.last().unwrap(), &ChatEvent::TurnDone { ok: false });
    }

    #[test]
    fn onbekende_en_irrelevante_gebeurtenissen_worden_genegeerd() {
        let ev = run(RETRY);
        assert_eq!(
            ev.iter()
                .filter(|e| matches!(e, ChatEvent::Text { .. }))
                .count(),
            1
        );
        assert_eq!(ev.last().unwrap(), &ChatEvent::TurnDone { ok: true });
        assert!(!ev
            .iter()
            .any(|e| matches!(e, ChatEvent::Error { .. } | ChatEvent::Fallback { .. })));
    }

    #[test]
    fn max_beurten_is_een_fout_met_technische_tekst() {
        let ev = run(MAXT);
        assert!(ev.iter().any(|e| matches!(e, ChatEvent::Error { technical, .. } if technical.contains("error_max_turns"))));
        assert_eq!(ev.last().unwrap(), &ChatEvent::TurnDone { ok: false });
    }

    #[test]
    fn subagent_berichten_blijven_buiten_beeld() {
        let ev = run(SUB);
        let ids: Vec<&str> = ev
            .iter()
            .filter_map(|e| {
                if let ChatEvent::Action { id, .. } = e {
                    Some(id.as_str())
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(ids, vec!["task1"]);
        assert_eq!(
            ev.iter()
                .filter(|e| matches!(e, ChatEvent::ActionResult { .. }))
                .count(),
            1
        );
    }

    #[test]
    fn geen_json_geeft_terugval_naar_de_terminal_na_drie_regels_en_maar_een_keer() {
        let mut a = ClaudeAdapter::new();
        let ev: Vec<ChatEvent> = GARBAGE.lines().flat_map(|l| a.parse_line(l)).collect();
        assert_eq!(
            ev,
            vec![ChatEvent::Fallback {
                reason: "unstructured".into()
            }]
        );
        assert!(a.parse_line("nog een regel").is_empty());
    }

    #[test]
    fn rommelregels_na_geldige_json_zijn_geen_terugval() {
        let mut a = ClaudeAdapter::new();
        a.parse_line(r#"{"type":"system","subtype":"init","session_id":"s"}"#);
        for _ in 0..5 {
            assert!(a.parse_line("zomaar een regel").is_empty());
        }
    }

    const REAL_HELLO: &str =
        include_str!("../../tests/fixtures/claude/real_hello_mcp_failed.jsonl");
    const REAL_WRITE: &str = include_str!("../../tests/fixtures/claude/real_write_page.jsonl");

    /// Opname van een echte `claude -p --input-format stream-json`-run (zie docs/cli-notes.md): extra gebeurtenistypen
    /// zoals active_goal, autocompact_state, stream_event en rate_limit_event worden genegeerd.
    #[test]
    fn echte_opname_hallo_met_mislukte_studio_koppeling() {
        let ev = run(REAL_HELLO);
        assert_eq!(ev.len(), 5, "{ev:?} (sessie, fout, tekst, gebruik, einde)");
        assert!(matches!(&ev[0], ChatEvent::Session { session_id } if session_id.len() == 36));
        assert!(
            matches!(
                &ev[1],
                ChatEvent::Error {
                    code: ErrorCode::McpUnavailable,
                    ..
                }
            ),
            "init meldt studio: failed"
        );
        assert_eq!(
            ev[2],
            ChatEvent::Text {
                id: ev_text_id(&ev[2]),
                text: "Hallo! 👋 Waar kan ik je vandaag mee helpen?".into()
            }
        );
        assert!(matches!(ev[3], ChatEvent::Usage { cache_write: 41259, .. }));
        assert_eq!(ev[4], ChatEvent::TurnDone { ok: true });
    }

    fn ev_text_id(e: &ChatEvent) -> String {
        if let ChatEvent::Text { id, .. } = e {
            id.clone()
        } else {
            String::new()
        }
    }

    #[test]
    fn echte_opname_pagina_schrijven_met_toestemming_via_de_studio_tool() {
        let ev = run(REAL_WRITE);
        let actions: Vec<(&ActionKind, &Value)> = ev
            .iter()
            .filter_map(|e| {
                if let ChatEvent::Action { kind, params, .. } = e {
                    Some((kind, params))
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(actions.len(), 1);
        assert_eq!(*actions[0].0, ActionKind::FileCreated);
        assert_eq!(
            (
                actions[0].1["file"].as_str(),
                actions[0].1["page"].as_bool()
            ),
            (Some("index.html"), Some(true))
        );
        assert!(ev.iter().any(|e| matches!(e, ChatEvent::ActionResult { ok: true, summary, .. } if summary.contains("File created successfully"))));
        assert!(ev
            .iter()
            .any(|e| matches!(e, ChatEvent::Text { text, .. } if text.contains("Hallo wereld"))));
        assert!(
            !ev.iter().any(|e| matches!(e, ChatEvent::Error { .. })),
            "studio was verbonden: geen foutmelding"
        );
        assert_eq!(ev.last().unwrap(), &ChatEvent::TurnDone { ok: true });
    }

    #[test]
    fn invoer_en_opstartargumenten() {
        let a = ClaudeAdapter::new();
        let line = a.encode_user("Maak een site met \"aanhalingstekens\"\nen een nieuwe regel");
        assert!(
            line.ends_with('\n') && line.matches('\n').count() == 1,
            "precies één regel JSON"
        );
        let v: Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(v["type"], "user");
        assert_eq!(
            v["message"]["content"],
            "Maak een site met \"aanhalingstekens\"\nen een nieuwe regel"
        );

        let l = a.launch(&LaunchCtx {
            binary: PathBuf::from("/usr/bin/claude"),
            resume: Some("sess-1".into()),
            mcp_config: Some(PathBuf::from("/data/chat/1/mcp.json")),
            permission_tool: Some("mcp__studio__permission_prompt".into()),
            plan: false,
            keuze: Default::default(),
        });
        let args = l.args.join(" ");
        for must in [
            "-p",
            "--input-format stream-json",
            "--output-format stream-json",
            "--verbose",
            "--permission-prompt-tool mcp__studio__permission_prompt",
            "--mcp-config /data/chat/1/mcp.json",
            "--resume sess-1",
            "--allowedTools mcp__studio",
        ] {
            assert!(args.contains(must), "{must} ontbreekt in {args}");
        }
        assert!(!args.contains("--include-partial-messages"));
        let plan = a.launch(&LaunchCtx {
            binary: PathBuf::from("claude"),
            resume: None,
            mcp_config: None,
            permission_tool: None,
            plan: true,
            keuze: Default::default(),
        });
        assert!(plan.args.join(" ").contains("--permission-mode plan"));
        assert!(a.supports_plan_mode());
        let fresh = a.launch(&LaunchCtx {
            binary: PathBuf::from("claude"),
            resume: None,
            mcp_config: None,
            permission_tool: None,
            plan: false,
            keuze: Default::default(),
        });
        assert!(!fresh.args.join(" ").contains("--resume"));
        assert!(!fresh.args.join(" ").contains("--model"), "zonder keuze geen model-vlag");
        let gekozen = a.launch(&LaunchCtx {
            binary: PathBuf::from("/bestaat/niet/claude"),
            resume: None,
            mcp_config: None,
            permission_tool: None,
            plan: false,
            keuze: crate::chat::beleid::Keuze { model: Some("sonnet".into()), effort: Some("low".into()) },
        });
        let g = gekozen.args.join(" ");
        assert!(g.contains("--model sonnet") && g.contains("--effort low"), "{g}");
        // een onbekend programma kan de cache-vlag niet bevestigen: dan niet meegeven (een onbekende vlag zou de start breken)
        assert!(!g.contains("--exclude-dynamic-system-prompt-sections"));
    }

    #[test]
    fn controle_info_uit_studio_run_checks_en_uit_gewone_commandos() {
        let ev = run(BUILD);
        let infos: Vec<(String, CheckInfo)> = ev
            .iter()
            .filter_map(|e| {
                if let ChatEvent::ActionResult {
                    id, check: Some(c), ..
                } = e
                {
                    Some((id.clone(), c.clone()))
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(infos.len(), 2, "alleen de twee run_checks-aanroepen");
        let (id1, c1) = &infos[0];
        assert_eq!(id1, "toolu_c1");
        assert!(!c1.ok && c1.steps == vec!["links".to_string()] && c1.count == 1);
        assert!(
            c1.signature.starts_with("links: ") && c1.signature.contains("bestaat niet"),
            "{}",
            c1.signature
        );
        assert!(infos[1].1.ok);

        let ev = run(BASH);
        let bash: Vec<&CheckInfo> = ev
            .iter()
            .filter_map(|e| {
                if let ChatEvent::ActionResult { check: Some(c), .. } = e {
                    Some(c)
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(
            bash.len(),
            2,
            "npm run build (mislukt en gelukt); npm install en Edit tellen niet mee"
        );
        assert!(!bash[0].ok && bash[0].steps == vec!["build".to_string()]);
        assert!(
            bash[0].signature.contains("ts#") && bash[0].signature.contains("error"),
            "{}",
            bash[0].signature
        );
        assert!(bash[1].ok);
    }

    #[test]
    fn vingerafdruk_negeert_getallen_en_paden_zodat_dezelfde_fout_gelijk_blijft() {
        let a =
            normalize_signature("src/main.ts(4,7): error TS2322: Type 'string' is not assignable");
        let b = normalize_signature(
            "/home/u/x/src/main.ts(12,3): error TS2322: Type 'string' is not assignable",
        );
        assert_eq!(a, b);
        assert!(!a.chars().any(|c| c.is_ascii_digit()) || a.contains('#'));
        assert!(normalize_signature(&"x ".repeat(500)).chars().count() <= 160);
    }

    #[test]
    fn mislukte_studio_controle_zonder_leesbare_json_geeft_toch_een_mislukking() {
        let c = check_info("", true, "CHECKS MISLUKT\n(kapotte uitvoer)").unwrap();
        assert!(!c.ok && c.count == 1);
    }

    #[test]
    fn echt_gebruik_uit_een_opgenomen_beurt() {
        let ev = run(REAL_WRITE);
        let u = ev.iter().find_map(|e| if let ChatEvent::Usage { input, output, cache_read, cache_write, turns } = e { Some((*input, *output, *cache_read, *cache_write, *turns)) } else { None });
        assert_eq!(u, Some((4, 233, 70245, 12392, 2)));
        // het gebruik komt vóór het einde van de beurt
        let pos = |f: &dyn Fn(&ChatEvent) -> bool| ev.iter().position(f).unwrap();
        assert!(pos(&|e| matches!(e, ChatEvent::Usage { .. })) < pos(&|e| matches!(e, ChatEvent::TurnDone { .. })));
        // een oude opname zonder gebruik geeft geen gebruiksbericht
        assert!(!run(SIMPLE).iter().any(|e| matches!(e, ChatEvent::Usage { .. })));
    }
}
