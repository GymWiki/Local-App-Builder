use crate::cli;
use crate::error::Result;
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct McpInfo {
    /// "starting" | "running" (server draait) | "connected" (een CLI heeft met token aangeklopt) | "unavailable"
    pub state: String,
    pub port: Option<u16>,
    pub error: Option<String>,
}

impl McpInfo {
    fn unavailable(msg: impl Into<String>) -> Self {
        Self {
            state: "unavailable".into(),
            port: None,
            error: Some(msg.into()),
        }
    }
    pub fn is_up(&self) -> bool {
        self.state == "running" || self.state == "connected"
    }
}

#[derive(Debug, Clone)]
pub enum McpEvent {
    Status {
        project_id: i64,
        info: McpInfo,
    },
    Tool {
        project_id: i64,
        tool: String,
        ok: bool,
        ms: i64,
        summary: String,
    },
}

pub type McpSink = Arc<dyn Fn(McpEvent) + Send + Sync>;

struct Server {
    child: Child,
    _stdin: ChildStdin,
    info: Arc<Mutex<McpInfo>>,
}

pub struct McpManager {
    token: String,
    script: Option<PathBuf>,
    servers: Mutex<HashMap<i64, Server>>,
    sink: McpSink,
}

/// Willekeurig token voor deze app-sessie (256 bit, hex). Wordt nooit opgeslagen of gelogd.
pub fn new_token() -> String {
    let mut b = [0u8; 32];
    getrandom::fill(&mut b).expect("geen willekeurige bytes beschikbaar");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn url_for(port: u16) -> String {
    format!("http://127.0.0.1:{port}/mcp")
}

impl McpManager {
    pub fn new(token: String, script: Option<PathBuf>, sink: McpSink) -> Self {
        Self {
            token,
            script,
            servers: Mutex::new(HashMap::new()),
            sink,
        }
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    pub fn info(&self, project_id: i64) -> Option<McpInfo> {
        self.servers
            .lock()
            .unwrap()
            .get(&project_id)
            .map(|s| s.info.lock().unwrap().clone())
    }

    /// Start de server voor een project (idempotent). Faalt nooit hard: zonder Node.js of script krijg je `unavailable`.
    pub fn start(&self, project_id: i64, name: &str, dir: &Path) -> McpInfo {
        if let Some(i) = self.info(project_id) {
            if i.is_up() {
                return i;
            }
            self.stop(project_id);
        }
        let Some(script) = self.script.clone().filter(|s| s.is_file()) else {
            return McpInfo::unavailable(
                "MCP-serverbestand niet gevonden (bouw mcp-server/ eerst).",
            );
        };
        let Some(node) = cli::resolve("node") else {
            return McpInfo::unavailable(
                "Node.js niet gevonden; installeer Node.js 20 of nieuwer.",
            );
        };

        let mut cmd = Command::new(node);
        cmd.arg(script)
            .env("STUDIO_PROJECT_DIR", dir)
            .env("STUDIO_PROJECT_NAME", name)
            .env("STUDIO_MCP_TOKEN", &self.token)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => return McpInfo::unavailable(format!("Kon de MCP-server niet starten: {e}")),
        };
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let info = Arc::new(Mutex::new(McpInfo {
            state: "starting".into(),
            port: None,
            error: None,
        }));
        let (ready_tx, ready_rx) = mpsc::channel::<std::result::Result<u16, String>>();

        {
            let (info, sink) = (info.clone(), self.sink.clone());
            std::thread::spawn(move || {
                let mut ready_tx = Some(ready_tx);
                for line in BufReader::new(stdout)
                    .lines()
                    .map_while(std::result::Result::ok)
                {
                    let Ok(v) = serde_json::from_str::<Value>(&line) else {
                        continue;
                    };
                    match v["event"].as_str() {
                        Some("ready") => {
                            let port = v["port"].as_u64().unwrap_or(0) as u16;
                            *info.lock().unwrap() = McpInfo {
                                state: "running".into(),
                                port: Some(port),
                                error: None,
                            };
                            if let Some(tx) = ready_tx.take() {
                                let _ = tx.send(Ok(port));
                            }
                            sink(McpEvent::Status {
                                project_id,
                                info: info.lock().unwrap().clone(),
                            });
                        }
                        Some("error") => {
                            if let Some(tx) = ready_tx.take() {
                                let _ = tx.send(Err(v["message"]
                                    .as_str()
                                    .unwrap_or("onbekende fout")
                                    .to_string()));
                            }
                        }
                        Some("client") => {
                            let mut i = info.lock().unwrap();
                            i.state = "connected".into();
                            let snapshot = i.clone();
                            drop(i);
                            sink(McpEvent::Status {
                                project_id,
                                info: snapshot,
                            });
                        }
                        Some("tool") => sink(McpEvent::Tool {
                            project_id,
                            tool: v["tool"].as_str().unwrap_or("?").to_string(),
                            ok: v["ok"].as_bool().unwrap_or(false),
                            ms: v["ms"].as_i64().unwrap_or(0),
                            summary: v["summary"].as_str().unwrap_or("").to_string(),
                        }),
                        _ => {}
                    }
                }
                // stdout dicht = proces weg. Als dat niet door ons stoppen kwam, meld het.
                let mut i = info.lock().unwrap();
                if i.state != "stopped" {
                    *i = McpInfo::unavailable("MCP-server is gestopt.");
                    let snapshot = i.clone();
                    drop(i);
                    sink(McpEvent::Status {
                        project_id,
                        info: snapshot,
                    });
                }
            });
        }

        match ready_rx.recv_timeout(Duration::from_secs(8)) {
            Ok(Ok(_)) => {
                self.servers.lock().unwrap().insert(
                    project_id,
                    Server {
                        child,
                        _stdin: stdin,
                        info: info.clone(),
                    },
                );
                let i = info.lock().unwrap().clone();
                i
            }
            Ok(Err(msg)) => {
                let _ = child.kill();
                let _ = child.wait();
                McpInfo::unavailable(msg)
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                McpInfo::unavailable("MCP-server startte niet op tijd.")
            }
        }
    }

    pub fn stop(&self, project_id: i64) {
        if let Some(mut s) = self.servers.lock().unwrap().remove(&project_id) {
            s.info.lock().unwrap().state = "stopped".into();
            drop(s._stdin); // sluit stdin: de server stopt zichzelf netjes
            let _ = s.child.kill();
            let _ = s.child.wait();
        }
    }

    pub fn stop_all(&self) {
        let ids: Vec<i64> = self.servers.lock().unwrap().keys().copied().collect();
        for id in ids {
            self.stop(id);
        }
    }
}

pub fn log_call(
    conn: &Connection,
    project_id: i64,
    tool: &str,
    ok: bool,
    ms: i64,
    summary: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO mcp_calls (project_id, tool, ok, duration_ms, summary) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![project_id, tool, ok as i64, ms, summary],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{db, projects};

    #[test]
    fn tokens_zijn_lang_hex_en_uniek() {
        let (a, b) = (new_token(), new_token());
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn url_wijst_naar_loopback() {
        assert_eq!(url_for(4242), "http://127.0.0.1:4242/mcp");
    }

    #[test]
    fn toolaanroepen_worden_gelogd_zonder_token_kolommen() {
        let conn = db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let p = projects::create(&conn, "P", tmp.path(), "leeg").unwrap();
        log_call(&conn, p.id, "read_project_notes", true, 12, "").unwrap();
        log_call(
            &conn,
            p.id,
            "update_project_notes",
            false,
            3,
            "mode=append bytes=10",
        )
        .unwrap();
        let rows: Vec<(String, i64)> = conn
            .prepare("SELECT tool, ok FROM mcp_calls ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(
            rows,
            vec![
                ("read_project_notes".to_string(), 1),
                ("update_project_notes".to_string(), 0)
            ]
        );
    }

    #[test]
    fn zonder_script_is_de_server_onbeschikbaar_in_plaats_van_een_crash() {
        let m = McpManager::new(new_token(), None, Arc::new(|_| {}));
        let i = m.start(1, "x", Path::new("."));
        assert_eq!(i.state, "unavailable");
    }

    /// End-to-end: echte Node-server via de manager. Slaat zichzelf over als Node of de build ontbreekt.
    #[test]
    fn start_en_stop_van_de_echte_server_met_auth() {
        let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../mcp-server/dist/index.mjs");
        if !script.is_file() || cli::resolve("node").is_none() {
            eprintln!("overgeslagen: node of mcp-server/dist ontbreekt");
            return;
        }
        let events: Arc<Mutex<Vec<McpEvent>>> = Arc::default();
        let e = events.clone();
        let m = McpManager::new(
            new_token(),
            Some(script),
            Arc::new(move |ev| e.lock().unwrap().push(ev)),
        );
        let tmp = tempfile::tempdir().unwrap();
        let info = m.start(7, "Demo", tmp.path());
        assert_eq!(info.state, "running", "{info:?}");
        let port = info.port.unwrap();
        assert_eq!(
            m.start(7, "Demo", tmp.path()).port,
            Some(port),
            "idempotent"
        );

        // zonder token: 401 (ruwe HTTP, geen extra crates nodig)
        use std::io::{Read, Write};
        let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        let body = "{}";
        write!(s, "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        let mut resp = String::new();
        s.read_to_string(&mut resp).unwrap();
        assert!(resp.starts_with("HTTP/1.1 401"), "{resp}");

        m.stop(7);
        std::thread::sleep(Duration::from_millis(300));
        assert!(
            std::net::TcpStream::connect(("127.0.0.1", port)).is_err(),
            "poort moet dicht zijn na stop"
        );
        assert!(m.info(7).is_none());
    }
}
