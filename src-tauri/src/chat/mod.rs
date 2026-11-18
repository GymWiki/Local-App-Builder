//! Chat-weergave bovenop een AI-CLI: het gestructureerde proces, de geschiedenis en de toestemmingen.
//! Per CLI zit het verschil in een adapter; CLI's zonder (geverifieerde) gestructureerde uitvoer vallen terug op de terminal.
pub mod claude;
pub mod events;
pub mod guard;
pub mod human;
pub mod policy;
pub mod store;
pub mod tools;
pub mod versions;

pub use versions::{Git, Version};

use crate::error::{AppError, Result};
use crate::provider::Provider;
use events::{ChatEvent, ErrorCode, Status};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use store::StoredMessage;

pub struct LaunchCtx {
    pub binary: PathBuf,
    pub resume: Option<String>,
    pub mcp_config: Option<PathBuf>,
    pub permission_tool: Option<String>,
    /// Overleg-modus: de CLI start in zijn planmodus.
    pub plan: bool,
}

pub struct Launch {
    pub program: String,
    pub args: Vec<String>,
}

/// Wat een CLI nodig heeft om als chat te werken. Alleen Claude is ingevuld (zie docs/cli-notes.md).
pub trait ChatAdapter: Send {
    fn launch(&self, ctx: &LaunchCtx) -> Launch;
    /// Eén regel (met newline) voor stdin.
    /// Kent de CLI een eigen planmodus (waarin geen bestanden worden gewijzigd)?
    fn supports_plan_mode(&self) -> bool;
    fn encode_user(&self, text: &str) -> String;
    fn parse_line(&mut self, line: &str) -> Vec<ChatEvent>;
    /// Heeft de CLI al een geldige gestructureerde gebeurtenis geleverd?
    fn seen_structured(&self) -> bool;
}

/// `None` = deze CLI heeft (nog) geen gebouwde of geverifieerde gestructureerde uitvoer: gebruik de terminal.
pub fn adapter_for(p: Provider) -> Option<Box<dyn ChatAdapter>> {
    match p {
        Provider::Claude => Some(Box::new(claude::ClaudeAdapter::new())),
        Provider::Gemini => None,
    }
}

pub fn supports_structured(p: Provider) -> bool {
    adapter_for(p).is_some()
}

pub trait Store: Send + Sync {
    fn insert(&self, project: i64, kind: &str, payload: Value) -> Result<StoredMessage>;
    fn update(&self, id: i64, payload: Value) -> Result<StoredMessage>;
    fn session(&self, project: i64) -> Option<store::SessionRow>;
    fn set_session(
        &self,
        project: i64,
        provider: &str,
        account: Option<i64>,
        session: Option<&str>,
    );
    fn setting(&self, key: &str) -> Option<String>;
    fn set_setting(&self, key: &str, value: &str);
    fn last_working(&self, project: i64) -> Option<(String, String)>;
}

/// Store op een gewone SQLite-verbinding (tests en eenvoudig gebruik).
#[cfg(test)]
pub struct ConnStore(pub Mutex<rusqlite::Connection>);

#[cfg(test)]
impl Store for ConnStore {
    fn insert(&self, project: i64, kind: &str, payload: Value) -> Result<StoredMessage> {
        store::insert(&self.0.lock().unwrap(), project, kind, &payload)
    }
    fn update(&self, id: i64, payload: Value) -> Result<StoredMessage> {
        store::update(&self.0.lock().unwrap(), id, &payload)
    }
    fn session(&self, project: i64) -> Option<store::SessionRow> {
        store::session(&self.0.lock().unwrap(), project)
            .ok()
            .flatten()
    }
    fn set_session(
        &self,
        project: i64,
        provider: &str,
        account: Option<i64>,
        session: Option<&str>,
    ) {
        let _ = store::set_session(&self.0.lock().unwrap(), project, provider, account, session);
    }
    fn setting(&self, key: &str) -> Option<String> {
        crate::db::get_setting(&self.0.lock().unwrap(), key)
            .ok()
            .flatten()
    }
    fn set_setting(&self, key: &str, value: &str) {
        let _ = crate::db::set_setting(&self.0.lock().unwrap(), key, value);
    }
    fn last_working(&self, project: i64) -> Option<(String, String)> {
        store::last_working_version(&self.0.lock().unwrap(), project)
            .ok()
            .flatten()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatOut {
    Message {
        project_id: i64,
        message: StoredMessage,
    },
    Update {
        project_id: i64,
        message: StoredMessage,
    },
    Status {
        project_id: i64,
        state: Status,
        busy: bool,
    },
    Fallback {
        project_id: i64,
        reason: String,
    },
    /// De keuze Overleggen/Bouwen van dit project is veranderd.
    Mode {
        project_id: i64,
        mode: String,
    },
}

/// Instructie voor CLI's zonder eigen planmodus.
pub const PLAN_INSTRUCTION: &str = "[Overleg-modus] Je mag in deze beurt GEEN bestanden maken, aanpassen of verwijderen en geen opdrachten uitvoeren die iets veranderen. Bespreek in gewone woorden wat je zou doen en stel een kort plan voor.";

/// Een bijlage bij een bericht: relatief pad in de projectmap (zie `assets`).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct Attachment {
    pub path: String,
    pub name: String,
    pub kind: String,
}

pub fn plan_text(text: &str, with_instruction: bool) -> String {
    if with_instruction {
        format!("{PLAN_INSTRUCTION}\n\n{text}")
    } else {
        text.to_string()
    }
}

fn mode_key(project: i64) -> String {
    format!("chat_mode:{project}")
}

pub type ChatSink = Arc<dyn Fn(ChatOut) + Send + Sync>;
/// Antwoord op een toestemmingsvraag doorgeven aan de MCP-server (project, aanvraag-id, toegestaan, uitleg bij weigeren).
pub type Answerer = Arc<dyn Fn(i64, &str, bool, Option<&str>) -> Result<()> + Send + Sync>;

#[derive(Clone)]
pub struct ChatLaunch {
    pub provider: Provider,
    pub account_id: Option<i64>,
    pub binary: PathBuf,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
    pub mcp_config: Option<PathBuf>,
    pub permission_tool: Option<String>,
}

struct Live {
    child: Child,
    stdin: ChildStdin,
    provider: Provider,
    account_id: Option<i64>,
    gen: u64,
    pending: Arc<AtomicUsize>,
    plan: bool,
}

struct Inner {
    live: Mutex<HashMap<i64, Live>>,
    store: Arc<dyn Store>,
    sink: ChatSink,
    answerer: Answerer,
    next_gen: AtomicU64,
    /// aanvraag-id → (bericht-id, payload) van openstaande toestemmingsvragen
    perms: Mutex<HashMap<String, (i64, Value)>>,
    /// Git-acties voor automatische versies (ontbreekt in tests zonder git).
    git: Mutex<Option<Arc<dyn Git>>>,
    /// Per project: de situatie aan het begin van de lopende beurt.
    turns: Mutex<HashMap<i64, versions::TurnInfo>>,
    /// Bug-lus bewaker per project.
    guards: Mutex<HashMap<i64, guard::LoopGuard>>,
}

#[derive(Clone)]
pub struct ChatManager {
    inner: Arc<Inner>,
}

const STDERR_LINES: usize = 40;

impl Inner {
    fn push(&self, project: i64, kind: &str, payload: Value) -> Option<StoredMessage> {
        let m = self.store.insert(project, kind, payload).ok()?;
        (self.sink)(ChatOut::Message {
            project_id: project,
            message: m.clone(),
        });
        Some(m)
    }

    fn status(&self, project: i64, state: Status, busy: bool) {
        (self.sink)(ChatOut::Status {
            project_id: project,
            state,
            busy,
        });
    }

    fn error(&self, project: i64, code: ErrorCode, technical: &str) {
        self.push(
            project,
            "error",
            json!({ "code": code, "technical": technical, "retry": true }),
        );
    }
}

/// Tijdelijke toestand van één lopend proces (leeft in de lezer-thread).
struct TurnState {
    rows: HashMap<String, (i64, Value)>,
    last_text: Option<String>,
    /// De bug-lus bewaker heeft ingegrepen: dit proces is gestopt en verdere uitvoer telt niet meer.
    aborted: bool,
}

fn handle_event(
    inner: &Arc<Inner>,
    project: i64,
    provider: Provider,
    account: Option<i64>,
    pending: &AtomicUsize,
    st: &mut TurnState,
    ev: ChatEvent,
) {
    match ev {
        ChatEvent::Session { session_id } => {
            inner
                .store
                .set_session(project, provider.as_str(), account, Some(&session_id))
        }
        ChatEvent::Text { text, .. } => {
            st.last_text = Some(text.clone());
            inner.push(project, "assistant", json!({ "text": text }));
        }
        ChatEvent::Action {
            id,
            kind,
            params,
            detail,
        } => {
            let payload = json!({ "tool_id": id, "kind": kind, "params": params, "detail": detail, "state": "running", "fixed": false, "summary": "" });
            if let Some(m) = inner.push(project, "action", payload.clone()) {
                st.rows.insert(id, (m.id, payload));
            }
            inner.status(project, kind.status(), true);
            if matches!(kind, events::ActionKind::FileCreated | events::ActionKind::FileEdited) {
                let file = params["path"].as_str().or_else(|| params["file"].as_str()).unwrap_or("").to_string();
                let (reden, streak) = {
                    let mut guards = inner.guards.lock().unwrap();
                    let g = guards.entry(project).or_default();
                    (g.record_edit(&file), guard::REWRITE_LIMIT)
                };
                if let Some(reden) = reden {
                    let threshold = inner.store.setting("ui:loop_threshold").and_then(|v| v.parse::<usize>().ok()).unwrap_or(guard::DEFAULT_THRESHOLD);
                    ingrijpen(inner, project, reden, streak, threshold, pending, st);
                }
            }
        }
        ChatEvent::ActionResult {
            id,
            ok,
            fixed,
            summary,
            check,
        } => {
            if let Some((row, mut payload)) = st.rows.remove(&id) {
                payload["state"] = json!(if ok { "done" } else { "error" });
                payload["fixed"] = json!(fixed);
                payload["summary"] = json!(summary);
                if let Ok(m) = inner.store.update(row, payload) {
                    (inner.sink)(ChatOut::Update {
                        project_id: project,
                        message: m,
                    });
                }
            }
            inner.status(project, Status::Thinking, true);
            if let Some(c) = check {
                guard_check(inner, project, &c, pending, st);
            }
        }
        ChatEvent::Status { state } => inner.status(project, state, true),
        ChatEvent::Error { code, technical } => inner.error(project, code, &technical),
        ChatEvent::TurnDone { ok } => {
            let left = pending.load(Ordering::SeqCst).saturating_sub(1);
            pending.store(left, Ordering::SeqCst);
            if left > 0 {
                inner.status(project, Status::Thinking, true);
            } else {
                inner.status(project, Status::Done, false);
            }
            if st.aborted {
                return;
            }
            // Na een geslaagde beurt automatisch een versie bewaren (op een eigen thread: git kan even duren).
            if ok && left == 0 {
                let (inner, text) = (inner.clone(), st.last_text.take());
                std::thread::spawn(move || versions::finish_turn(&inner, project, text));
            } else if ok {
                st.last_text = None;
            }
        }
        ChatEvent::Fallback { reason } => {
            inner.push(
                project,
                "notice",
                json!({ "kind": "fallback", "reason": reason }),
            );
            (inner.sink)(ChatOut::Fallback {
                project_id: project,
                reason,
            });
        }
    }
}

/// Laat de bug-lus bewaker de controle beoordelen en grijpt in (melding + proces stoppen) als de AI in cirkels draait.
fn guard_check(
    inner: &Arc<Inner>,
    project: i64,
    check: &events::CheckInfo,
    pending: &AtomicUsize,
    st: &mut TurnState,
) {
    let threshold = inner
        .store
        .setting("ui:loop_threshold")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(guard::DEFAULT_THRESHOLD);
    let (reason, streak) = {
        let mut guards = inner.guards.lock().unwrap();
        let g = guards.entry(project).or_default();
        (g.record(check, threshold), g.streak())
    };
    let Some(reason) = reason else { return };
    ingrijpen(inner, project, reason, streak, threshold, pending, st);
}

/// Meldt de lus aan de gebruiker en stopt de AI (het gesprek blijft hervatbaar; er komt geen versie van de kapotte staat).
fn ingrijpen(inner: &Arc<Inner>, project: i64, reason: guard::Reason, streak: usize, threshold: usize, pending: &AtomicUsize, st: &mut TurnState) {
    let last_working = inner
        .store
        .last_working(project)
        .map(|(hash, title)| json!({ "hash": hash, "title": title }));
    inner.push(
        project,
        "loop_alert",
        json!({ "reason": reason.as_str(), "streak": streak, "threshold": threshold.clamp(guard::MIN_THRESHOLD, guard::MAX_THRESHOLD), "last_working": last_working }),
    );
    st.aborted = true;
    pending.store(0, Ordering::SeqCst);
    inner.turns.lock().unwrap().remove(&project);
    let live = inner.live.lock().unwrap().remove(&project);
    if let Some(mut l) = live {
        let _ = l.child.kill();
        spawn_waiter(l.child);
    }
    inner.status(project, Status::Idle, false);
}

fn spawn_waiter(mut child: Child) {
    std::thread::spawn(move || {
        let _ = child.wait();
    });
}

impl ChatManager {
    pub fn new(store: Arc<dyn Store>, sink: ChatSink, answerer: Answerer) -> Self {
        Self {
            inner: Arc::new(Inner {
                live: Mutex::new(HashMap::new()),
                store,
                sink,
                answerer,
                next_gen: AtomicU64::new(1),
                perms: Mutex::new(HashMap::new()),
                git: Mutex::new(None),
                turns: Mutex::new(HashMap::new()),
                guards: Mutex::new(HashMap::new()),
            }),
        }
    }

    /// Koppelt de git-acties voor automatische versies.
    pub fn set_git(&self, git: Arc<dyn Git>) {
        *self.inner.git.lock().unwrap() = Some(git);
    }

    pub fn busy(&self, project: i64) -> bool {
        self.inner
            .live
            .lock()
            .unwrap()
            .get(&project)
            .map(|l| l.pending.load(Ordering::SeqCst) > 0)
            .unwrap_or(false)
    }

    fn spawn_live(&self, project: i64, launch: &ChatLaunch, plan: bool) -> Result<()> {
        let mut adapter = adapter_for(launch.provider).ok_or_else(|| {
            AppError::Invalid(
                "Deze AI heeft nog geen chatweergave; gebruik de technische weergave.".into(),
            )
        })?;
        let resume = self
            .inner
            .store
            .session(project)
            .filter(|s| s.provider == launch.provider.as_str() && s.account_id == launch.account_id)
            .and_then(|s| s.session_id);
        let l = adapter.launch(&LaunchCtx {
            binary: launch.binary.clone(),
            resume,
            mcp_config: launch.mcp_config.clone(),
            permission_tool: launch.permission_tool.clone(),
            plan,
        });
        let mut cmd = Command::new(&l.program);
        cmd.args(&l.args)
            .current_dir(&launch.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for (k, v) in &launch.env {
            cmd.env(k, v);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let mut child = cmd.spawn().map_err(|e| {
            AppError::Invalid(format!("Kon {} niet starten: {e}", launch.binary.display()))
        })?;
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let pending = Arc::new(AtomicUsize::new(0));
        let gen = self.inner.next_gen.fetch_add(1, Ordering::SeqCst);
        let tail: Arc<Mutex<VecDeque<String>>> = Arc::default();

        {
            let tail = tail.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stderr)
                    .lines()
                    .map_while(std::result::Result::ok)
                {
                    let mut t = tail.lock().unwrap();
                    t.push_back(line.chars().take(500).collect());
                    while t.len() > STDERR_LINES {
                        t.pop_front();
                    }
                }
            });
        }
        {
            let (inner, pending, tail) = (self.inner.clone(), pending.clone(), tail.clone());
            let (provider, account) = (launch.provider, launch.account_id);
            std::thread::spawn(move || {
                let mut st = TurnState {
                    rows: HashMap::new(),
                    last_text: None,
                    aborted: false,
                };
                for line in BufReader::new(stdout)
                    .lines()
                    .map_while(std::result::Result::ok)
                {
                    for ev in adapter.parse_line(&line) {
                        let fallback = matches!(ev, ChatEvent::Fallback { .. });
                        handle_event(&inner, project, provider, account, &pending, &mut st, ev);
                        if st.aborted {
                            return;
                        }
                        if fallback {
                            // Geen bruikbare structuur: dit proces heeft geen zin meer.
                            if let Some(l) = inner
                                .live
                                .lock()
                                .unwrap()
                                .remove(&project)
                                .filter(|l| l.gen == gen)
                            {
                                let mut l = l;
                                let _ = l.child.kill();
                                spawn_waiter(l.child);
                            }
                            pending.store(0, Ordering::SeqCst);
                            inner.status(project, Status::Idle, false);
                            return;
                        }
                    }
                }
                // Einde van stdout: het proces is weg (afgesloten door ons of onverwacht).
                std::thread::sleep(std::time::Duration::from_millis(150));
                let ours = inner
                    .live
                    .lock()
                    .unwrap()
                    .remove(&project)
                    .filter(|l| l.gen == gen);
                let Some(mut l) = ours else { return }; // gestopt door stop()/close(): geen foutmelding
                let code = l.child.wait().ok().and_then(|s| s.code());
                let tail_text = tail
                    .lock()
                    .unwrap()
                    .iter()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("\n");
                let had_turn = pending.swap(0, Ordering::SeqCst) > 0;
                if !adapter.seen_structured() {
                    inner.push(project, "notice", json!({ "kind": "fallback", "reason": "no_structure", "technical": tail_text }));
                    (inner.sink)(ChatOut::Fallback {
                        project_id: project,
                        reason: "no_structure".into(),
                    });
                } else if had_turn || code.unwrap_or(0) != 0 {
                    let guessed = human::classify_text(&tail_text);
                    let code_kind = if guessed == ErrorCode::Unknown {
                        ErrorCode::CliCrashed
                    } else {
                        guessed
                    };
                    let exit = code.map(|c| c.to_string()).unwrap_or_else(|| "?".into());
                    let technical = format!("{tail_text}\n(exitcode {exit})");
                    inner.error(project, code_kind, technical.trim());
                }
                inner.status(project, Status::Idle, false);
            });
        }

        self.inner.live.lock().unwrap().insert(
            project,
            Live {
                child,
                stdin,
                provider: launch.provider,
                account_id: launch.account_id,
                gen,
                pending,
                plan,
            },
        );
        Ok(())
    }

    fn ensure_live(&self, project: i64, launch: &ChatLaunch, plan: bool) -> Result<()> {
        let stale = {
            let live = self.inner.live.lock().unwrap();
            live.get(&project).map(|l| {
                l.provider != launch.provider || l.account_id != launch.account_id || l.plan != plan
            })
        };
        match stale {
            Some(false) => Ok(()),
            // Andere AI, ander account of andere modus: nieuw proces (de sessie wordt hervat met --resume).
            Some(true) => {
                self.stop(project);
                self.spawn_live(project, launch, plan)
            }
            None => self.spawn_live(project, launch, plan),
        }
    }

    /// "plan" (eerst overleggen) of "build" (bouwen): de keuze van dit project.
    pub fn mode(&self, project: i64) -> String {
        match self.inner.store.setting(&mode_key(project)).as_deref() {
            Some("plan") => "plan".into(),
            Some("build") => "build".into(),
            // Nog geen keuze voor dit project: de algemene instelling "Eerst overleggen is standaard" geldt.
            _ if self.inner.store.setting("ui:plan_default").as_deref() == Some("1") => {
                "plan".into()
            }
            _ => "build".into(),
        }
    }

    /// Onthoudt de keuze en laat het proces bij het volgende bericht opnieuw starten in de juiste modus.
    pub fn set_mode(&self, project: i64, mode: &str) -> Result<()> {
        if !matches!(mode, "plan" | "build") {
            return Err(AppError::Invalid("Onbekende modus.".into()));
        }
        if self.mode(project) != mode {
            self.inner.store.set_setting(&mode_key(project), mode);
            self.stop(project);
            (self.inner.sink)(ChatOut::Mode {
                project_id: project,
                mode: mode.into(),
            });
        }
        Ok(())
    }

    fn write_line(&self, project: i64, line: &str) -> std::io::Result<()> {
        let mut live = self.inner.live.lock().unwrap();
        let l = live
            .get_mut(&project)
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::BrokenPipe, "geen proces"))?;
        l.stdin.write_all(line.as_bytes())?;
        l.stdin.flush()?;
        l.pending.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    /// Legt een foutkaart in de chat vast (bijv. als de MCP-koppeling niet beschikbaar is).
    pub fn report_error(&self, project: i64, code: ErrorCode, technical: &str) {
        self.inner.error(project, code, technical);
        self.inner.status(project, Status::Idle, false);
    }

    /// Stuurt een bericht naar de AI. `visible = false`: onzichtbare opdracht (bijv. overdracht bij wisselen van AI).
    pub fn send(&self, project: i64, text: &str, visible: bool, launch: &ChatLaunch) -> Result<()> {
        self.send_with(project, text, visible, launch, &[])
    }

    /// Zoals `send`, met bijlagen (paden binnen de projectmap, al gecontroleerd door `assets`). Alleen bijlagen zonder tekst mag ook.
    pub fn send_with(
        &self,
        project: i64,
        text: &str,
        visible: bool,
        launch: &ChatLaunch,
        attachments: &[Attachment],
    ) -> Result<()> {
        let text = text.trim();
        if text.is_empty() && attachments.is_empty() {
            return Err(AppError::Invalid("Typ eerst een bericht.".into()));
        }
        let text = if text.is_empty() {
            "Kijk naar de bijgevoegde bestanden."
        } else {
            text
        };
        if !supports_structured(launch.provider) {
            return Err(AppError::Invalid(
                "Deze AI heeft nog geen chatweergave; gebruik de technische weergave.".into(),
            ));
        }
        // Een nieuw bericht van de gebruiker begint een nieuwe reeks voor de bug-lus bewaker.
        self.inner
            .guards
            .lock()
            .unwrap()
            .entry(project)
            .or_default()
            .reset();
        if visible {
            let payload = if attachments.is_empty() {
                json!({ "text": text })
            } else {
                json!({ "text": text, "attachments": attachments })
            };
            self.inner.push(project, "user", payload);
        }
        if !self.busy(project) {
            let head = self
                .inner
                .git
                .lock()
                .unwrap()
                .clone()
                .and_then(|g| g.head(project))
                .map(|v| v.hash);
            self.inner.turns.lock().unwrap().insert(
                project,
                versions::TurnInfo {
                    head,
                    user_text: text.to_string(),
                },
            );
        }
        self.inner.status(project, Status::Thinking, true);
        let adapter = adapter_for(launch.provider).unwrap();
        let plan = self.mode(project) == "plan";
        // Heeft de CLI geen eigen planmodus, dan krijgt de AI in plaats daarvan een instructie om niets te wijzigen.
        let prompt = format!(
            "{text}{}",
            crate::assets::prompt_suffix(
                &attachments
                    .iter()
                    .map(|a| a.path.clone())
                    .collect::<Vec<_>>()
            )
        );
        let line = adapter.encode_user(&plan_text(&prompt, plan && !adapter.supports_plan_mode()));
        let attempt = |this: &Self| -> Result<()> {
            this.ensure_live(project, launch, plan && adapter.supports_plan_mode())?;
            this.write_line(project, &line)
                .map_err(|e| AppError::Invalid(format!("Kon niet naar de AI schrijven: {e}")))
        };
        let result = attempt(self).or_else(|_| {
            // Het proces was ondertussen weg: één nieuwe poging met een vers proces (hervat de sessie).
            self.stop(project);
            attempt(self)
        });
        if let Err(e) = &result {
            self.inner.error(
                project,
                if e.to_string().contains("niet starten") {
                    ErrorCode::CliMissing
                } else {
                    ErrorCode::CliCrashed
                },
                &e.to_string(),
            );
            self.inner.status(project, Status::Idle, false);
        }
        result
    }

    /// Beëindigt het lopende proces (de sessie blijft hervatbaar).
    pub fn stop(&self, project: i64) {
        let l = self.inner.live.lock().unwrap().remove(&project);
        if let Some(mut l) = l {
            let _ = l.child.kill();
            spawn_waiter(l.child);
            self.inner.status(project, Status::Idle, false);
        }
    }

    pub fn close_all(&self) {
        let ids: Vec<i64> = self.inner.live.lock().unwrap().keys().copied().collect();
        for id in ids {
            self.stop(id);
        }
    }

    /// Nieuwe sessie (of wissel van AI): stopt het proces, vergeet het sessie-id en zet een scheiding in de chat.
    pub fn new_session(
        &self,
        project: i64,
        provider: Provider,
        account: Option<i64>,
        divider: Value,
    ) {
        self.stop(project);
        self.inner
            .store
            .set_session(project, provider.as_str(), account, None);
        self.inner.push(project, "divider", divider);
    }

    /// Plaatst een bericht van Studio zelf in het gesprek (bijvoorbeeld een kaartje met een knop ‘Verbinden’).
    pub fn post_message(&self, project: i64, kind: &str, payload: Value) {
        self.inner.push(project, kind, payload);
    }

    // ---------- toestemmingen ----------

    /// Een toestemmingsvraag van de AI (via de MCP-tool). Beslist met de gekozen stand; vraagt anders de gebruiker.
    pub fn on_permission_request(&self, project: i64, project_dir: &Path, req: &Value) {
        let Some(id) = req["id"].as_str() else { return };
        let tool = req["tool_name"].as_str().unwrap_or("");
        let input = if req["input"].is_object() {
            req["input"].clone()
        } else {
            json!({})
        };
        let c = tools::classify(tool, &input, project_dir);
        let mode = policy::Mode::parse(self.inner.store.setting("ui:permission_mode").as_deref());
        let plan_mode = self.mode(project) == "plan";
        match policy::decide(mode, plan_mode, &c) {
            policy::Decision::Allow => {
                let _ = (self.inner.answerer)(project, id, true, None);
            }
            policy::Decision::Deny => {
                let _ = (self.inner.answerer)(
                    project,
                    id,
                    false,
                    Some("Je zit in overleg-modus: er mag nu niets worden aangepast. Bespreek eerst het plan met de gebruiker."),
                );
            }
            policy::Decision::Ask => {
                let payload = json!({
                    "req_id": id, "tool": tool, "kind": c.kind, "params": c.params, "detail": c.detail,
                    "danger": c.danger, "outside_project": c.outside_project, "plan_exit": c.plan_exit, "state": "asked"
                });
                if let Some(m) = self.inner.push(project, "permission", payload.clone()) {
                    self.inner
                        .perms
                        .lock()
                        .unwrap()
                        .insert(id.to_string(), (m.id, payload));
                }
            }
        }
    }

    fn settle(&self, project: i64, req_id: &str, state: &str) -> Result<()> {
        let (row, mut payload) = self
            .inner
            .perms
            .lock()
            .unwrap()
            .remove(req_id)
            .ok_or(AppError::NotFound)?;
        payload["state"] = json!(state);
        let m = self.inner.store.update(row, payload)?;
        (self.inner.sink)(ChatOut::Update {
            project_id: project,
            message: m,
        });
        Ok(())
    }

    /// Het antwoord van de gebruiker (Ja/Nee) op een openstaande vraag.
    pub fn answer_permission(&self, project: i64, req_id: &str, allow: bool) -> Result<()> {
        // Een goedgekeurd plan betekent: vanaf nu bouwen (de CLI verlaat zijn planmodus zelf).
        let approves_plan = allow
            && self
                .inner
                .perms
                .lock()
                .unwrap()
                .get(req_id)
                .is_some_and(|(_, p)| p["plan_exit"] == true);
        self.settle(project, req_id, if allow { "allowed" } else { "denied" })?;
        if approves_plan {
            self.inner.store.set_setting(&mode_key(project), "build");
            (self.inner.sink)(ChatOut::Mode {
                project_id: project,
                mode: "build".into(),
            });
        }
        (self.inner.answerer)(project, req_id, allow, None)
    }

    /// De MCP-server heeft de vraag laten verlopen (geen antwoord binnen de tijd).
    pub fn expire_permission(&self, project: i64, req_id: &str) {
        let _ = self.settle(project, req_id, "expired");
    }
}

#[cfg(test)]
mod tests;
