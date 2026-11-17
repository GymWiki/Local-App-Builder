//! Adapter voor Claude Code (`claude -p --input-format stream-json --output-format stream-json`).
//! Schema: zie docs/cli-notes.md (bronnen: headless.md, agent-sdk/typescript.md).
use super::events::{ActionKind, ChatEvent, ErrorCode, Status};
use super::human;
use super::tools;
use super::{ChatAdapter, Launch, LaunchCtx};
use crate::cli;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

#[derive(Default)]
pub struct ClaudeAdapter {
    pending: HashMap<String, ActionKind>,
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
        let (program, args) = cli::launch(Path::new(&ctx.binary), args);
        Launch { program, args }
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
                            self.pending.insert(id.clone(), c.kind);
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
                    let Some(kind) = self.pending.remove(id) else {
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
        let fresh = a.launch(&LaunchCtx {
            binary: PathBuf::from("claude"),
            resume: None,
            mcp_config: None,
            permission_tool: None,
        });
        assert!(!fresh.args.join(" ").contains("--resume"));
    }
}
