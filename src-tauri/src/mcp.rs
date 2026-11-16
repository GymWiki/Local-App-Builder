use crate::cli;
use crate::error::{AppError, Result};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::Write;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
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
    /// Gebeurtenissen van de project-runtime: `dev`, `checks`, `git`.
    Runtime {
        project_id: i64,
        payload: Value,
    },
}

pub type McpSink = Arc<dyn Fn(McpEvent) + Send + Sync>;

type Reply = std::result::Result<Value, String>;
type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<Reply>>>>;

struct Server {
    child: Child,
    /// `None` na het sluiten: de server ziet dan stdin dichtgaan en ruimt zijn processen zelf op.
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    pending: Pending,
    next_id: Arc<AtomicU64>,
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
        let pending: Pending = Arc::default();

        {
            let (info, sink, pending) = (info.clone(), self.sink.clone(), pending.clone());
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
                        Some("reply") => {
                            let tx = v["id"]
                                .as_u64()
                                .and_then(|id| pending.lock().unwrap().remove(&id));
                            if let Some(tx) = tx {
                                let _ = tx.send(if v["ok"].as_bool().unwrap_or(false) {
                                    Ok(v["result"].clone())
                                } else {
                                    Err(v["error"].as_str().unwrap_or("onbekende fout").to_string())
                                });
                            }
                        }
                        Some("dev") | Some("checks") | Some("git") => sink(McpEvent::Runtime {
                            project_id,
                            payload: v.clone(),
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
                        stdin: Arc::new(Mutex::new(Some(stdin))),
                        pending,
                        next_id: Arc::new(AtomicU64::new(1)),
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

    /// Stuurt een commando naar de runtime van het project en wacht op het antwoord (met time-out).
    pub fn call(
        &self,
        project_id: i64,
        cmd: &str,
        args: Value,
        timeout: Duration,
    ) -> Result<Value> {
        let (stdin, pending, next_id) = {
            let map = self.servers.lock().unwrap();
            let s = map.get(&project_id).ok_or_else(|| {
                AppError::Invalid("De MCP-runtime van dit project draait niet (project niet geopend of Node.js ontbreekt).".into())
            })?;
            (s.stdin.clone(), s.pending.clone(), s.next_id.clone())
        };
        let id = next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        pending.lock().unwrap().insert(id, tx);
        let line = serde_json::json!({ "id": id, "cmd": cmd, "args": args }).to_string();
        let written = match stdin.lock().unwrap().as_mut() {
            Some(w) => writeln!(w, "{line}").and_then(|_| w.flush()),
            None => Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "gesloten",
            )),
        };
        if let Err(e) = written {
            pending.lock().unwrap().remove(&id);
            return Err(AppError::Invalid(format!(
                "Kon de runtime niet bereiken: {e}"
            )));
        }
        match rx.recv_timeout(timeout) {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(msg)) => Err(AppError::Invalid(msg)),
            Err(_) => {
                pending.lock().unwrap().remove(&id);
                Err(AppError::Invalid(format!(
                    "Time-out na {} s bij '{cmd}'.",
                    timeout.as_secs()
                )))
            }
        }
    }

    /// Sluit stdin zodat de server zijn dev-server, checks en browser netjes stopt; pas als dat niet binnen
    /// `grace` lukt wordt het proces gedood.
    fn shutdown(mut servers: Vec<Server>, grace: Duration) {
        for s in &servers {
            s.info.lock().unwrap().state = "stopped".into();
            *s.stdin.lock().unwrap() = None;
        }
        let deadline = std::time::Instant::now() + grace;
        for s in &mut servers {
            loop {
                match s.child.try_wait() {
                    Ok(Some(_)) => break,
                    _ if std::time::Instant::now() >= deadline => {
                        let _ = s.child.kill();
                        let _ = s.child.wait();
                        break;
                    }
                    _ => std::thread::sleep(Duration::from_millis(25)),
                }
            }
        }
    }

    pub fn stop(&self, project_id: i64) {
        let removed = self.servers.lock().unwrap().remove(&project_id);
        if let Some(s) = removed {
            Self::shutdown(vec![s], Duration::from_secs(8));
        }
    }

    pub fn stop_all(&self) {
        let all: Vec<Server> = self
            .servers
            .lock()
            .unwrap()
            .drain()
            .map(|(_, s)| s)
            .collect();
        Self::shutdown(all, Duration::from_secs(8));
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CheckRun {
    pub id: i64,
    pub ok: bool,
    pub steps: Value,
    pub created_at: String,
}

pub fn record_checks(conn: &Connection, project_id: i64, ok: bool, steps_json: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO check_runs (project_id, ok, steps_json) VALUES (?1, ?2, ?3)",
        params![project_id, ok as i64, steps_json],
    )?;
    // Houd alleen de laatste 20 runs per project.
    conn.execute(
        "DELETE FROM check_runs WHERE project_id = ?1 AND id NOT IN (SELECT id FROM check_runs WHERE project_id = ?1 ORDER BY id DESC LIMIT 20)",
        params![project_id],
    )?;
    Ok(())
}

pub fn last_checks(conn: &Connection, project_id: i64, limit: i64) -> Result<Vec<CheckRun>> {
    let mut stmt = conn.prepare(
        "SELECT id, ok, steps_json, created_at FROM check_runs WHERE project_id = ?1 ORDER BY id DESC LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![project_id, limit], |r| {
            let steps: String = r.get(2)?;
            Ok(CheckRun {
                id: r.get(0)?,
                ok: r.get::<_, i64>(1)? != 0,
                steps: serde_json::from_str(&steps).unwrap_or(Value::Null),
                created_at: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
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

    #[test]
    fn checkresultaten_worden_bewaard_en_beperkt_tot_de_laatste_20() {
        let conn = db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let p = projects::create(&conn, "P", tmp.path(), "leeg").unwrap();
        for i in 0..25 {
            record_checks(
                &conn,
                p.id,
                i % 2 == 0,
                r#"[{"name":"lint","status":"passed"}]"#,
            )
            .unwrap();
        }
        let all = last_checks(&conn, p.id, 100).unwrap();
        assert_eq!(all.len(), 20);
        assert!(all[0].ok && all[0].steps[0]["name"] == "lint");
        assert_eq!(last_checks(&conn, p.id, 1).unwrap().len(), 1);
    }

    fn pid_alive(pid: i64) -> bool {
        #[cfg(unix)]
        {
            std::path::Path::new(&format!("/proc/{pid}")).exists()
                && std::fs::read_to_string(format!("/proc/{pid}/stat"))
                    .map(|s| !s.contains(") Z"))
                    .unwrap_or(false)
        }
        #[cfg(not(unix))]
        {
            let _ = pid;
            false
        }
    }

    /// End-to-end met de echte Node-runtime: control-kanaal, vertrouwen, dev-server starten en daarna
    /// bij stop() controleren dat er geen proces achterblijft.
    #[cfg(unix)]
    #[test]
    fn runtime_bridge_en_geen_zombies_na_stop() {
        let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../mcp-server/dist/index.mjs");
        if !script.is_file() || cli::resolve("node").is_none() {
            eprintln!("overgeslagen: node of mcp-server/dist ontbreekt");
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("studio.json"),
            r#"{"dev":"echo $$ > dev.pid; exec sleep 300","lint":"echo lint-ok"}"#,
        )
        .unwrap();
        let events: Arc<Mutex<Vec<McpEvent>>> = Arc::default();
        let e = events.clone();
        let m = McpManager::new(
            new_token(),
            Some(script),
            Arc::new(move |ev| e.lock().unwrap().push(ev)),
        );
        assert_eq!(m.start(3, "Demo", tmp.path()).state, "running");
        let t = Duration::from_secs(20);

        // zonder vertrouwen: weigeren
        let err = m
            .call(3, "dev.start", serde_json::json!({}), t)
            .unwrap_err()
            .to_string();
        assert!(err.contains("goedgekeurd"), "{err}");
        assert!(m.call(3, "bestaat-niet", serde_json::json!({}), t).is_err());

        let cfg = m.call(3, "config.get", serde_json::json!({}), t).unwrap();
        assert_eq!(cfg["trusted"], false);
        m.call(
            3,
            "trust.set",
            serde_json::json!({ "hash": cfg["hash"] }),
            t,
        )
        .unwrap();

        let checks = m.call(3, "checks.run", serde_json::json!({}), t).unwrap();
        assert_eq!(checks["ok"], true);
        assert!(events.lock().unwrap().iter().any(
            |e| matches!(e, McpEvent::Runtime { payload, .. } if payload["event"] == "checks")
        ));

        m.call(3, "dev.start", serde_json::json!({}), t).unwrap();
        let pid_file = tmp.path().join("dev.pid");
        let t0 = std::time::Instant::now();
        while !pid_file.is_file() && t0.elapsed() < Duration::from_secs(10) {
            std::thread::sleep(Duration::from_millis(50));
        }
        let pid: i64 = std::fs::read_to_string(&pid_file)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert!(pid_alive(pid));

        m.stop(3);
        let t0 = std::time::Instant::now();
        while pid_alive(pid) && t0.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(!pid_alive(pid), "dev-proces draait nog na stop()");
        assert!(m.info(3).is_none());
        assert!(m.call(3, "dev.status", serde_json::json!({}), t).is_err());
    }
}
