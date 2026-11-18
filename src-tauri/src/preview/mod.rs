//! Zero-config preview: detecteert wat het project is, toont het (statische server of dev-server van de runtime),
//! volgt bestandswijzigingen en laat de preview ververst blijven.
pub mod detect;
pub mod static_server;
pub mod watcher;

use crate::error::{AppError, Result};
use crate::mcp::McpInfo;
use detect::{Kind, Plan};
use serde::Serialize;
use serde_json::{json, Value};
use static_server::StaticServer;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use watcher::{Trigger, Watch};

/// Alles wat de preview van buiten nodig heeft: de Node-runtime (dev-server, checks), instellingen en de status van de runtime.
pub trait Bridge: Send + Sync {
    fn call(&self, project_id: i64, cmd: &str, args: Value, timeout: Duration) -> Result<Value>;
    fn runtime_info(&self, project_id: i64) -> Option<McpInfo>;
    fn get_setting(&self, key: &str) -> Option<String>;
    fn set_setting(&self, key: &str, value: &str);
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Problem {
    /// empty | flutter | unsupported | config_invalid | node_missing | node_old | node_broken | runtime_unavailable |
    /// deps_missing | untrusted_scripts | untrusted_config | dev_crashed | static_failed | watch_failed
    pub kind: String,
    pub message: String,
    pub log: Vec<String>,
}

fn problem(kind: &str, message: impl Into<String>) -> Problem {
    Problem {
        kind: kind.into(),
        message: message.into(),
        log: vec![],
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PreviewInfo {
    pub mode: Kind,
    /// idle | starting | running | stopping | error
    pub status: String,
    pub url: Option<String>,
    pub hmr: bool,
    pub problem: Option<Problem>,
    pub plan: Plan,
}

#[derive(Debug, Clone)]
#[allow(clippy::large_enum_variant)]
pub enum PreviewEvent {
    State {
        project_id: i64,
        info: PreviewInfo,
    },
    /// Voor het eerst iets previewbaars (draait) in deze sessie.
    Available {
        project_id: i64,
    },
    /// Pagina(’s) moeten herladen worden (alleen voor dev-servers zonder eigen HMR).
    Reload {
        project_id: i64,
    },
}

pub type PreviewSink = Arc<dyn Fn(PreviewEvent) + Send + Sync>;

#[derive(Default)]
struct NodeState {
    status: String,
    url: Option<String>,
    error: Option<String>,
    log: Vec<String>,
}

struct Session {
    dir: PathBuf,
    plan: Plan,
    server: Option<StaticServer>,
    server_root: Option<PathBuf>,
    /// Wordt alleen vastgehouden: Drop stopt de bestandsvolger-thread.
    _watch: Option<Watch>,
    watch_error: Option<String>,
    node: NodeState,
    node_problem: Option<Problem>,
    static_problem: Option<Problem>,
    announced: bool,
    user_stopped: bool,
    last_info: Option<PreviewInfo>,
}

struct Inner {
    sessions: Mutex<HashMap<i64, Session>>,
    bridge: Arc<dyn Bridge>,
    sink: PreviewSink,
}

#[derive(Clone)]
pub struct PreviewManager {
    inner: Arc<Inner>,
}

fn settings_key(id: i64) -> String {
    format!("preview_scripts:{id}")
}

impl Inner {
    fn info_for(&self, id: i64, s: &Session) -> PreviewInfo {
        let plan = s.plan.clone();
        let hmr = plan.hmr;
        let mut info = PreviewInfo {
            mode: plan.kind,
            status: "idle".into(),
            url: None,
            hmr,
            problem: None,
            plan: plan.clone(),
        };
        if let Some(e) = &plan.config_error {
            info.problem = Some(problem("config_invalid", e.clone()));
            return info;
        }
        match plan.kind {
            Kind::Empty => {
                info.problem = Some(problem("empty", plan.reason.clone().unwrap_or_default()))
            }
            Kind::Flutter => {
                info.problem = Some(problem("flutter", plan.reason.clone().unwrap_or_default()))
            }
            Kind::Unsupported => {
                info.problem = Some(problem(
                    "unsupported",
                    plan.reason.clone().unwrap_or_default(),
                ))
            }
            Kind::Static => {
                if let Some(srv) = &s.server {
                    info.status = "running".into();
                    info.url = Some(srv.url());
                } else {
                    info.problem = s.static_problem.clone();
                }
            }
            Kind::Node | Kind::Config => {
                if let Some(p) = &s.node_problem {
                    info.problem = Some(p.clone());
                } else {
                    info.status = if s.node.status.is_empty() {
                        "idle".into()
                    } else {
                        s.node.status.clone()
                    };
                    info.url = s.node.url.clone();
                    if info.status == "error" {
                        let mut p = problem(
                            "dev_crashed",
                            s.node
                                .error
                                .clone()
                                .unwrap_or_else(|| "De dev-server is gestopt.".into()),
                        );
                        p.log = s.node.log.clone();
                        info.problem = Some(p);
                    }
                }
            }
        }
        if info.problem.is_none() {
            if let Some(e) = &s.watch_error {
                info.problem = Some(problem("watch_failed", e.clone()));
            }
        }
        let _ = id;
        info
    }

    fn emit_if_changed(&self, id: i64) {
        let (info, announce) = {
            let mut map = self.sessions.lock().unwrap();
            let Some(s) = map.get_mut(&id) else { return };
            let info = self.info_for(id, s);
            if s.last_info.as_ref() == Some(&info) {
                return;
            }
            s.last_info = Some(info.clone());
            let announce = info.status == "running" && !s.announced;
            if announce {
                s.announced = true;
            }
            (info, announce)
        };
        (self.sink)(PreviewEvent::State {
            project_id: id,
            info,
        });
        if announce {
            (self.sink)(PreviewEvent::Available { project_id: id });
        }
    }

    fn runtime_problem(&self, id: i64) -> Option<Problem> {
        match self.bridge.runtime_info(id) {
            Some(i) if i.is_up() => None,
            Some(i) if i.state == "starting" => Some(problem(
                "runtime_starting",
                "De projectruntime wordt gestart…",
            )),
            Some(i) => {
                let kind = i
                    .kind
                    .as_deref()
                    .filter(|k| matches!(*k, "node_missing" | "node_old" | "node_broken"))
                    .unwrap_or("runtime_unavailable");
                let mut p = problem(
                    kind,
                    i.error
                        .clone()
                        .unwrap_or_else(|| "De projectruntime draait niet.".into()),
                );
                p.log = i.log.clone();
                Some(p)
            }
            None => Some(problem(
                "runtime_unavailable",
                "De projectruntime is nog niet gestart.",
            )),
        }
    }

    fn plan_payload(
        &self,
        id: i64,
        plan: &Plan,
        trusted: bool,
        static_url: Option<String>,
    ) -> Value {
        let _ = id;
        json!({
            "kind": plan.kind,
            "entry": plan.entry,
            "staticRoot": plan.static_root,
            "devScript": plan.dev_script,
            "scripts": plan.scripts,
            "trusted": trusted,
            "staticUrl": static_url,
            "needsInstall": plan.needs_install,
        })
    }

    /// Detecteer opnieuw, pas de statische server aan, duw het plan naar de runtime en start zo nodig de dev-server.
    fn refresh(&self, id: i64) {
        // 1. plan + statische server (onder het slot, snel)
        let (plan, trusted, static_url, want_autostart) = {
            let mut map = self.sessions.lock().unwrap();
            let Some(s) = map.get_mut(&id) else { return };
            let plan = detect::detect(&s.dir);
            s.plan = plan.clone();

            // Statische server volgt het plan.
            let want_root = if plan.kind == Kind::Static {
                Some(s.dir.join(plan.static_root.clone().unwrap_or_default()))
            } else {
                None
            };
            match (&want_root, &s.server_root) {
                (Some(w), Some(cur)) if w == cur && s.server.is_some() => {}
                (Some(w), _) => {
                    s.server = None; // stopt een eventuele oude server
                    s.server_root = None;
                    if !s.user_stopped {
                        match StaticServer::start(w, 0) {
                            Ok(srv) => {
                                s.server = Some(srv);
                                s.server_root = Some(w.clone());
                                s.static_problem = None;
                            }
                            Err(e) => {
                                s.static_problem = Some(problem("static_failed", e.to_string()))
                            }
                        }
                    }
                }
                (None, _) => {
                    s.server = None;
                    s.server_root = None;
                    s.static_problem = None;
                }
            }

            // Vertrouwen voor scripts uit package.json: eerste keer vertrouwen we (eigen project), daarna alleen dezelfde scripts.
            let trusted = if plan.kind == Kind::Node {
                let fp = plan.scripts_fingerprint();
                match self.bridge.get_setting(&settings_key(id)) {
                    None => {
                        self.bridge.set_setting(&settings_key(id), &fp);
                        true
                    }
                    Some(stored) => stored == fp,
                }
            } else {
                true
            };
            let static_url = s.server.as_ref().map(|x| x.url());
            let uses_node = matches!(plan.kind, Kind::Node | Kind::Config);
            let mut want_autostart = false;
            s.node_problem = None;
            if uses_node && plan.config_error.is_none() {
                if let Some(p) = self.runtime_problem(id) {
                    s.node_problem = Some(p);
                } else if plan.kind == Kind::Node && !trusted {
                    let mut p = problem(
                        "untrusted_scripts",
                        "De scripts in package.json zijn gewijzigd sinds je ze goedkeurde.",
                    );
                    p.log = plan
                        .scripts_fingerprint()
                        .split(';')
                        .map(str::to_string)
                        .collect();
                    s.node_problem = Some(p);
                } else if plan.needs_install {
                    s.node_problem = Some(problem("deps_missing", "De afhankelijkheden zijn nog niet geïnstalleerd (node_modules ontbreekt of is onvolledig)."));
                } else {
                    want_autostart = !s.user_stopped;
                }
            }
            if !uses_node {
                s.node = NodeState::default();
            }
            (plan, trusted, static_url, want_autostart)
        };

        // 2. runtime informeren en dev-server starten (buiten het slot: dit kan even duren)
        if self
            .bridge
            .runtime_info(id)
            .map(|i| i.is_up())
            .unwrap_or(false)
        {
            let _ = self.bridge.call(
                id,
                "plan.set",
                self.plan_payload(id, &plan, trusted, static_url),
                Duration::from_secs(10),
            );
            if want_autostart {
                match self
                    .bridge
                    .call(id, "dev.autostart", json!({}), Duration::from_secs(30))
                {
                    Ok(r) => {
                        let reason = r["reason"].as_str().unwrap_or("");
                        let mut map = self.sessions.lock().unwrap();
                        if let Some(s) = map.get_mut(&id) {
                            match reason {
                                "untrusted" => {
                                    s.node_problem = Some(problem(
                                        if plan.kind == Kind::Config { "untrusted_config" } else { "untrusted_scripts" },
                                        "Studio mag deze commando's nog niet uitvoeren: goedkeuring nodig.",
                                    ))
                                }
                                "no_dev" => s.node_problem = Some(problem("unsupported", "Er is geen dev-commando om te starten.")),
                                _ => {}
                            }
                        }
                    }
                    Err(e) => {
                        let mut map = self.sessions.lock().unwrap();
                        if let Some(s) = map.get_mut(&id) {
                            s.node_problem = Some(problem("runtime_unavailable", e.to_string()));
                        }
                    }
                }
            }
        }
        self.emit_if_changed(id);
    }

    fn on_trigger(&self, id: i64, t: Trigger) {
        match t {
            Trigger::Changes { plan, reload } => {
                if plan {
                    self.refresh(id);
                }
                if reload {
                    let kind_hmr = {
                        let map = self.sessions.lock().unwrap();
                        let Some(s) = map.get(&id) else { return };
                        if let Some(srv) = &s.server {
                            srv.reload();
                        }
                        (s.plan.kind, s.plan.hmr)
                    };
                    if matches!(kind_hmr.0, Kind::Node | Kind::Config) && !kind_hmr.1 {
                        (self.sink)(PreviewEvent::Reload { project_id: id });
                    }
                }
                // Een bestand dat nét is verwijderd of teruggezet verandert soms niets aan het plan maar wel aan de inhoud.
                if !plan {
                    self.emit_if_changed(id);
                }
            }
            Trigger::Tick => {
                let needs = {
                    let map = self.sessions.lock().unwrap();
                    map.get(&id)
                        .map(|s| {
                            matches!(
                                s.node_problem.as_ref().map(|p| p.kind.as_str()),
                                Some("deps_missing")
                                    | Some("runtime_unavailable")
                                    | Some("runtime_starting")
                            )
                        })
                        .unwrap_or(false)
                };
                if needs {
                    self.refresh(id);
                }
            }
        }
    }
}

impl PreviewManager {
    pub fn new(bridge: Arc<dyn Bridge>, sink: PreviewSink) -> Self {
        Self {
            inner: Arc::new(Inner {
                sessions: Mutex::new(HashMap::new()),
                bridge,
                sink,
            }),
        }
    }

    /// Opent (of ververst) de preview van een project: detecteert, start zo nodig de statische server en gaat bestanden volgen.
    pub fn open(&self, id: i64, dir: PathBuf) -> PreviewInfo {
        let exists = self.inner.sessions.lock().unwrap().contains_key(&id);
        if !exists {
            let plan = detect::detect(&dir);
            let inner = self.inner.clone();
            let kaart_dir = dir.clone();
            // Na rustige wijzigingen de projectkaart bijwerken (op een eigen thread, nooit tijdens het typen).
            crate::kaart::vernieuw_achtergrond(dir.clone(), true);
            let watch = watcher::start(
                &dir,
                Arc::new(move |t| {
                    if matches!(t, watcher::Trigger::Changes { .. }) {
                        crate::kaart::vernieuw_achtergrond(kaart_dir.clone(), true);
                    }
                    inner.on_trigger(id, t)
                }),
            );
            let watch_error = watch.error.clone();
            self.inner.sessions.lock().unwrap().insert(
                id,
                Session {
                    dir,
                    announced: plan.previewable(),
                    plan,
                    server: None,
                    server_root: None,
                    _watch: Some(watch),
                    watch_error,
                    node: NodeState::default(),
                    node_problem: None,
                    static_problem: None,
                    user_stopped: false,
                    last_info: None,
                },
            );
        }
        self.inner.refresh(id);
        self.info(id).unwrap()
    }

    pub fn info(&self, id: i64) -> Option<PreviewInfo> {
        let map = self.inner.sessions.lock().unwrap();
        map.get(&id).map(|s| self.inner.info_for(id, s))
    }

    /// Verwerkt een `dev`-gebeurtenis van de runtime (status van de dev-server).
    pub fn on_dev_event(&self, id: i64, payload: &Value) {
        let state = payload["state"].as_str().unwrap_or("stopped");
        let log = if state == "error" {
            self.inner
                .bridge
                .call(
                    id,
                    "dev.logs",
                    json!({ "lines": 30 }),
                    Duration::from_secs(5),
                )
                .ok()
                .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok())
                .unwrap_or_default()
        } else {
            vec![]
        };
        {
            let mut map = self.inner.sessions.lock().unwrap();
            let Some(s) = map.get_mut(&id) else { return };
            s.node.status = match state {
                "stopped" => "idle",
                other => other,
            }
            .to_string();
            s.node.url = payload["url"].as_str().map(str::to_string);
            s.node.error = payload["error"].as_str().map(str::to_string);
            s.node.log = log;
            if state == "starting" || state == "running" {
                s.node_problem = None;
            }
        }
        self.inner.emit_if_changed(id);
    }

    pub fn start(&self, id: i64) -> Result<PreviewInfo> {
        self.set_user_stopped(id, false)?;
        self.inner.refresh(id);
        self.info(id).ok_or(AppError::NotFound)
    }

    fn set_user_stopped(&self, id: i64, v: bool) -> Result<()> {
        let mut map = self.inner.sessions.lock().unwrap();
        map.get_mut(&id).ok_or(AppError::NotFound)?.user_stopped = v;
        Ok(())
    }

    pub fn stop(&self, id: i64) -> Result<PreviewInfo> {
        let uses_node = {
            let mut map = self.inner.sessions.lock().unwrap();
            let s = map.get_mut(&id).ok_or(AppError::NotFound)?;
            s.user_stopped = true;
            s.server = None;
            s.server_root = None;
            matches!(s.plan.kind, Kind::Node | Kind::Config)
        };
        if uses_node {
            let _ = self
                .inner
                .bridge
                .call(id, "dev.stop", json!({}), Duration::from_secs(30));
        }
        self.inner.emit_if_changed(id);
        self.info(id).ok_or(AppError::NotFound)
    }

    pub fn restart(&self, id: i64) -> Result<PreviewInfo> {
        let uses_node = {
            let mut map = self.inner.sessions.lock().unwrap();
            let s = map.get_mut(&id).ok_or(AppError::NotFound)?;
            s.user_stopped = false;
            s.server = None;
            s.server_root = None;
            s.node_problem = None;
            matches!(s.plan.kind, Kind::Node | Kind::Config)
        };
        if uses_node {
            self.inner
                .bridge
                .call(id, "dev.restart", json!({}), Duration::from_secs(30))
                .map(|_| ())?;
        }
        self.inner.refresh(id);
        self.info(id).ok_or(AppError::NotFound)
    }

    /// De gebruiker keurt de huidige scripts uit package.json goed.
    pub fn trust_scripts(&self, id: i64) -> Result<PreviewInfo> {
        let fp = {
            let map = self.inner.sessions.lock().unwrap();
            let s = map.get(&id).ok_or(AppError::NotFound)?;
            detect::detect(&s.dir).scripts_fingerprint()
        };
        self.inner.bridge.set_setting(&settings_key(id), &fp);
        self.set_user_stopped(id, false)?;
        self.inner.refresh(id);
        self.info(id).ok_or(AppError::NotFound)
    }

    /// Installeert afhankelijkheden via de runtime (npm/pnpm/yarn), daarna wordt de preview ververst.
    pub fn install(&self, id: i64) -> Result<PreviewInfo> {
        self.inner
            .bridge
            .call(id, "deps.install", json!({}), Duration::from_secs(15 * 60))?;
        self.inner.refresh(id);
        self.info(id).ok_or(AppError::NotFound)
    }

    /// Sluit alles van dit project: bestandsvolger en statische server. (De dev-server stopt met de runtime.)
    pub fn close(&self, id: i64) {
        let removed = self.inner.sessions.lock().unwrap().remove(&id);
        drop(removed); // Drop stopt watcher-thread en server
    }

    pub fn close_all(&self) {
        let all: Vec<Session> = self
            .inner
            .sessions
            .lock()
            .unwrap()
            .drain()
            .map(|(_, s)| s)
            .collect();
        drop(all);
    }

    #[cfg(test)]
    pub fn session_ids(&self) -> Vec<i64> {
        self.inner
            .sessions
            .lock()
            .unwrap()
            .keys()
            .copied()
            .collect()
    }
}

#[cfg(test)]
mod tests;
