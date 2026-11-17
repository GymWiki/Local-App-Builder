use crate::error::{AppError, Result};
use crate::node;
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
    /// Leesbare reden als `state == "unavailable"`.
    pub error: Option<String>,
    /// Korte code voor de UI: node_missing | node_old | node_broken | script_missing | spawn_failed | timeout | crashed | error
    pub kind: Option<String>,
    /// Laatste regels uit stderr/log van de server (voor diagnose).
    pub log: Vec<String>,
}

impl McpInfo {
    fn fail(kind: &str, msg: impl Into<String>, log: Vec<String>) -> Self {
        Self {
            state: "unavailable".into(),
            port: None,
            error: Some(msg.into()),
            kind: Some(kind.into()),
            log,
        }
    }
    fn plain(state: &str, port: Option<u16>) -> Self {
        Self {
            state: state.into(),
            port,
            error: None,
            kind: None,
            log: vec![],
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

type LogTail = Arc<Mutex<std::collections::VecDeque<String>>>;
const LOG_LINES: usize = 40;
const START_TIMEOUT: Duration = Duration::from_secs(20);

enum Ready {
    Port,
    Error(String),
    Exited,
}

fn push_log(log: &LogTail, line: String) {
    let mut l = log.lock().unwrap();
    l.push_back(line.chars().take(500).collect());
    while l.len() > LOG_LINES {
        l.pop_front();
    }
}

fn tail(log: &LogTail) -> Vec<String> {
    log.lock().unwrap().iter().cloned().collect()
}

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
    /// Mogelijke plekken van `index.mjs`; de eerste die bestaat wordt bij elke start gebruikt (dus ook als hij pas later is gebouwd).
    scripts: Vec<PathBuf>,
    servers: Mutex<HashMap<i64, Server>>,
    /// Laatste mislukte start per project, zodat de UI de reden kan blijven tonen.
    failures: Mutex<HashMap<i64, McpInfo>>,
    start_timeout: Duration,
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
    pub fn new(token: String, scripts: Vec<PathBuf>, sink: McpSink) -> Self {
        Self {
            token,
            scripts,
            servers: Mutex::new(HashMap::new()),
            failures: Mutex::new(HashMap::new()),
            start_timeout: START_TIMEOUT,
            sink,
        }
    }

    #[cfg(test)]
    fn with_start_timeout(mut self, d: Duration) -> Self {
        self.start_timeout = d;
        self
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    pub fn info(&self, project_id: i64) -> Option<McpInfo> {
        let running = self
            .servers
            .lock()
            .unwrap()
            .get(&project_id)
            .map(|s| s.info.lock().unwrap().clone());
        running.or_else(|| self.failures.lock().unwrap().get(&project_id).cloned())
    }

    /// Start de server voor een project (idempotent). Faalt nooit hard: bij een probleem krijg je
    /// `unavailable` met de echte reden (`kind`, `error`, `log`) en onthoudt de manager die.
    pub fn start(&self, project_id: i64, name: &str, dir: &Path) -> McpInfo {
        if let Some(i) = self.info(project_id) {
            if i.is_up() {
                return i;
            }
            self.stop(project_id);
        }
        self.failures.lock().unwrap().remove(&project_id);
        match self.try_start(project_id, name, dir) {
            Ok(info) => info,
            Err(info) => {
                self.failures
                    .lock()
                    .unwrap()
                    .insert(project_id, info.clone());
                info
            }
        }
    }

    fn try_start(
        &self,
        project_id: i64,
        name: &str,
        dir: &Path,
    ) -> std::result::Result<McpInfo, McpInfo> {
        let script = self.scripts.iter().find(|s| s.is_file()).cloned().ok_or_else(|| {
            let tried: Vec<String> = self.scripts.iter().map(|p| p.display().to_string()).collect();
            McpInfo::fail(
                "script_missing",
                format!(
                    "Het MCP-serverbestand ontbreekt (gezocht: {}). Draai `npm run mcp:build` in de projectmap van Studio en start de app opnieuw.",
                    if tried.is_empty() { "nergens".to_string() } else { tried.join("; ") }
                ),
                vec![],
            )
        })?;
        let node = node::find().map_err(|p| McpInfo::fail(p.kind(), p.message(), vec![]))?;

        let mut cmd = Command::new(&node.path);
        cmd.arg(&script)
            .env("STUDIO_PROJECT_DIR", dir)
            .env("STUDIO_PROJECT_NAME", name)
            .env("STUDIO_MCP_TOKEN", &self.token)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let mut child = cmd.spawn().map_err(|e| {
            McpInfo::fail(
                "spawn_failed",
                format!("Kon {} niet starten: {e}", node.path.display()),
                vec![],
            )
        })?;
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let info = Arc::new(Mutex::new(McpInfo::plain("starting", None)));
        let log: LogTail = Arc::default();
        let (ready_tx, ready_rx) = mpsc::channel::<Ready>();
        let pending: Pending = Arc::default();

        {
            let log = log.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stderr)
                    .lines()
                    .map_while(std::result::Result::ok)
                {
                    push_log(&log, line);
                }
            });
        }
        {
            let (info, sink, pending, log) = (
                info.clone(),
                self.sink.clone(),
                pending.clone(),
                log.clone(),
            );
            std::thread::spawn(move || {
                let mut ready_tx = Some(ready_tx);
                for line in BufReader::new(stdout)
                    .lines()
                    .map_while(std::result::Result::ok)
                {
                    let Ok(v) = serde_json::from_str::<Value>(&line) else {
                        push_log(&log, format!("[stdout] {line}"));
                        continue;
                    };
                    match v["event"].as_str() {
                        Some("ready") => {
                            let port = v["port"].as_u64().unwrap_or(0) as u16;
                            *info.lock().unwrap() = McpInfo::plain("running", Some(port));
                            if let Some(tx) = ready_tx.take() {
                                let _ = tx.send(Ready::Port);
                            }
                            sink(McpEvent::Status {
                                project_id,
                                info: info.lock().unwrap().clone(),
                            });
                        }
                        Some("error") => {
                            let msg = v["message"]
                                .as_str()
                                .unwrap_or("onbekende fout")
                                .to_string();
                            push_log(&log, format!("[fout] {msg}"));
                            if let Some(tx) = ready_tx.take() {
                                let _ = tx.send(Ready::Error(msg));
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
                // stdout dicht = proces weg.
                if let Some(tx) = ready_tx.take() {
                    let _ = tx.send(Ready::Exited);
                }
                let mut i = info.lock().unwrap();
                if i.state != "stopped" {
                    std::thread::sleep(Duration::from_millis(150)); // laat stderr de laatste regels aanleveren
                    *i = McpInfo::fail(
                        "crashed",
                        "De MCP-server is onverwacht gestopt.",
                        tail(&log),
                    );
                    let snapshot = i.clone();
                    drop(i);
                    sink(McpEvent::Status {
                        project_id,
                        info: snapshot,
                    });
                }
            });
        }

        let died = |child: &mut Child, log: &LogTail, what: &str, kind: &str| {
            std::thread::sleep(Duration::from_millis(200));
            let code = child.try_wait().ok().flatten().and_then(|s| s.code());
            let _ = child.kill();
            let _ = child.wait();
            let reason = match code {
                Some(c) => format!("{what} (exitcode {c})"),
                None => what.to_string(),
            };
            McpInfo::fail(kind, format!("{reason}."), tail(log))
        };

        match ready_rx.recv_timeout(self.start_timeout) {
            Ok(Ready::Port) => {
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
                Ok(i)
            }
            Ok(Ready::Error(msg)) => Err(died(
                &mut child,
                &log,
                &format!("De MCP-server meldde een fout: {msg}"),
                "error",
            )),
            Ok(Ready::Exited) => Err(died(
                &mut child,
                &log,
                "De MCP-server stopte direct na het starten",
                "crashed",
            )),
            Err(_) => Err(died(
                &mut child,
                &log,
                &format!(
                    "De MCP-server werd niet binnen {} s klaar",
                    START_TIMEOUT.as_secs()
                ),
                "timeout",
            )),
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
        let m = McpManager::new(new_token(), vec![], Arc::new(|_| {}));
        let i = m.start(1, "x", Path::new("."));
        assert_eq!(i.state, "unavailable");
    }

    /// End-to-end: echte Node-server via de manager. Slaat zichzelf over als Node of de build ontbreekt.
    #[test]
    fn start_en_stop_van_de_echte_server_met_auth() {
        let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../mcp-server/dist/index.mjs");
        if !script.is_file() || node::find().is_err() {
            eprintln!("overgeslagen: node of mcp-server/dist ontbreekt");
            return;
        }
        let events: Arc<Mutex<Vec<McpEvent>>> = Arc::default();
        let e = events.clone();
        let m = McpManager::new(
            new_token(),
            vec![script],
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
        if !script.is_file() || node::find().is_err() {
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
            vec![script],
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

    // ---------- diagnose: de echte reden tonen ----------

    fn temp_script(body: &str) -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("server.mjs");
        std::fs::write(&p, body).unwrap();
        (d, p)
    }

    fn manager_with(scripts: Vec<PathBuf>, timeout_ms: u64) -> McpManager {
        McpManager::new(new_token(), scripts, Arc::new(|_| {}))
            .with_start_timeout(Duration::from_millis(timeout_ms))
    }

    #[test]
    fn ontbrekend_serverbestand_noemt_de_paden_en_de_oplossing_en_wordt_later_alsnog_gevonden() {
        let d = tempfile::tempdir().unwrap();
        let script = d.path().join("dist").join("index.mjs");
        let m = manager_with(vec![script.clone()], 2000);
        let i = m.start(1, "x", d.path());
        assert_eq!(i.state, "unavailable");
        assert_eq!(i.kind.as_deref(), Some("script_missing"));
        let e = i.error.unwrap();
        assert!(
            e.contains("npm run mcp:build") && e.contains(&script.display().to_string()),
            "{e}"
        );
        assert_eq!(
            m.info(1).unwrap().kind.as_deref(),
            Some("script_missing"),
            "mislukking wordt onthouden"
        );

        // Na het bouwen volstaat "Opnieuw proberen": het pad wordt bij elke start opnieuw gezocht.
        if node::find().is_err() {
            return;
        }
        std::fs::create_dir_all(script.parent().unwrap()).unwrap();
        std::fs::write(
            &script,
            "console.log(JSON.stringify({event:'ready',port:4242}));setInterval(()=>{},1000);",
        )
        .unwrap();
        let i = m.start(1, "x", d.path());
        assert_eq!((i.state.as_str(), i.port), ("running", Some(4242)));
        m.stop(1);
    }

    #[test]
    fn crash_bij_opstarten_toont_exitcode_en_laatste_logregels() {
        if node::find().is_err() {
            return eprintln!("overgeslagen: geen Node.js");
        }
        let (d, script) = temp_script(
            "console.error('regel een'); console.error('Error: kapot!'); process.exit(3);",
        );
        let i = manager_with(vec![script], 10_000).start(1, "x", d.path());
        assert_eq!(i.kind.as_deref(), Some("crashed"), "{i:?}");
        assert!(i.error.as_deref().unwrap().contains("exitcode 3"), "{i:?}");
        assert!(
            i.log.iter().any(|l| l.contains("Error: kapot!")),
            "{:?}",
            i.log
        );
    }

    #[test]
    fn foutmelding_van_de_server_zelf_wordt_doorgegeven() {
        if node::find().is_err() {
            return eprintln!("overgeslagen: geen Node.js");
        }
        let (d, script) = temp_script("console.log(JSON.stringify({event:'error',message:'poort 1234 is bezet (EADDRINUSE)'}));setInterval(()=>{},1000);");
        let i = manager_with(vec![script], 10_000).start(1, "x", d.path());
        assert_eq!(i.kind.as_deref(), Some("error"));
        assert!(i.error.unwrap().contains("EADDRINUSE"));
    }

    #[test]
    fn server_die_nooit_klaar_komt_geeft_timeout_en_wordt_opgeruimd() {
        if node::find().is_err() {
            return eprintln!("overgeslagen: geen Node.js");
        }
        let (d, script) = temp_script("console.error('ik doe niets');setInterval(()=>{},1000);");
        let i = manager_with(vec![script], 1000).start(1, "x", d.path());
        assert_eq!(i.kind.as_deref(), Some("timeout"));
        assert!(i.log.iter().any(|l| l.contains("ik doe niets")));
    }

    // ---------- config + token kloppen met de echte server ----------

    fn http_post(port: u16, headers: &[(&str, String)], body: &str) -> String {
        use std::io::{Read, Write};
        let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        let mut req = format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: {}\r\n", body.len());
        for (k, v) in headers {
            req.push_str(&format!("{k}: {v}\r\n"));
        }
        req.push_str("\r\n");
        req.push_str(body);
        s.write_all(req.as_bytes()).unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        out
    }

    /// Doet wat Claude Code/Gemini doen: `${VAR}` in de configwaarden vervangen door de omgeving van het proces.
    fn expand(value: &str, env: &[(String, String)]) -> String {
        let mut out = value.to_string();
        for (k, v) in env {
            out = out.replace(&format!("${{{k}}}"), v);
        }
        out
    }

    #[test]
    fn geschreven_config_plus_omgeving_geeft_een_werkende_geauthenticeerde_verbinding() {
        use crate::{cli, mcp_config, provider::Provider};
        let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../mcp-server/dist/index.mjs");
        if !script.is_file() || node::find().is_err() {
            return eprintln!("overgeslagen: node of mcp-server/dist ontbreekt");
        }
        let project = tempfile::tempdir().unwrap();
        let m = manager_with(vec![script], 20_000);
        let info = m.start(5, "Demo", project.path());
        assert_eq!(info.state, "running", "{info:?}");
        let port = info.port.unwrap();
        // Dezelfde omgeving die start_ai aan het PTY-proces meegeeft.
        let env = cli::mcp_env(&url_for(port), m.token());

        for (provider, file, url_key) in [
            (Provider::Claude, project.path().join(".mcp.json"), "url"),
            (
                Provider::Gemini,
                project.path().join(".gemini").join("settings.json"),
                "httpUrl",
            ),
        ] {
            mcp_config::ensure(provider, project.path()).unwrap();
            let raw = std::fs::read_to_string(&file).unwrap();
            assert!(
                !raw.contains(m.token()),
                "het token mag niet in {file:?} staan"
            );

            let cfg: Value = serde_json::from_str(&raw).unwrap();
            let entry = &cfg["mcpServers"]["studio"];
            let url = expand(entry[url_key].as_str().unwrap(), &env);
            let auth = expand(entry["headers"]["Authorization"].as_str().unwrap(), &env);
            assert_eq!(
                url,
                format!("http://127.0.0.1:{port}/mcp"),
                "alleen loopback, juiste poort"
            );
            assert!(auth.starts_with("Bearer ") && auth.ends_with(m.token()));

            let init = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}"#;
            let ok = http_post(port, &[("Authorization", auth.clone())], init);
            assert!(ok.starts_with("HTTP/1.1 200"), "{provider:?}: {ok}");
            assert!(
                ok.contains("\"serverInfo\"") && ok.contains("studio"),
                "{ok}"
            );
            assert!(
                http_post(port, &[], init).starts_with("HTTP/1.1 401"),
                "zonder token moet 401 volgen"
            );
            assert!(
                http_post(port, &[("Authorization", "Bearer fout".to_string())], init)
                    .starts_with("HTTP/1.1 401")
            );
        }
        m.stop(5);
    }
}
