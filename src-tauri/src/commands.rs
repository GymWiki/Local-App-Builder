use crate::accounts::{self, Account};
use crate::assets;
use crate::chat::events::ErrorCode;
use crate::chat::store::StoredMessage;
use crate::chat::{self, ChatLaunch, ChatManager};
use crate::claude_approval;
use crate::cli::{self, CliStatus};
use crate::error::{AppError, Result};
use crate::instructions;
use crate::mcp::{self, McpInfo, McpManager};
use crate::mcp_config;
use crate::preview::{PreviewInfo, PreviewManager};
use crate::projects::{self, Project};
use crate::provider::Provider;
use crate::templates;
use crate::terminal::{Snapshot, SpawnSpec, TerminalManager};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::{Emitter, Manager, State};

pub struct Db(pub Mutex<Connection>);
pub struct Profiles(pub PathBuf);

impl Db {
    pub fn conn(&self) -> Result<MutexGuard<'_, Connection>> {
        self.0
            .lock()
            .map_err(|_| AppError::Invalid("Databaseslot is vergiftigd.".into()))
    }
}

// ---------- projecten ----------

#[tauri::command]
pub fn list_projects(db: State<Db>) -> Result<Vec<Project>> {
    projects::list(&*db.conn()?)
}

#[tauri::command]
pub fn create_project(
    app: tauri::AppHandle,
    db: State<Db>,
    naam: String,
    bovenliggend_pad: String,
    template: Option<String>,
) -> Result<Project> {
    let template = template.unwrap_or_else(|| "leeg".into());
    let project = projects::create(
        &*db.conn()?,
        &naam,
        &PathBuf::from(bovenliggend_pad),
        &template,
    )?;
    if template != "leeg" {
        // Een echt template: bestanden erin zetten. Lukt dat niet, dan verdwijnt het project weer uit de lijst (de map blijft staan).
        let copied = templates::bundled(&app, "templates")
            .and_then(|t| templates::copy_template(&t, &template, Path::new(&project.pad)));
        if let Err(e) = copied {
            let _ = projects::delete(&*db.conn()?, project.id);
            return Err(e);
        }
    }
    Ok(project)
}

/// Verwijdert alleen uit de lijst; bestanden op schijf blijven staan.
#[tauri::command(async)]
pub fn delete_project(
    db: State<Db>,
    mcp: State<McpManager>,
    previews: State<PreviewManager>,
    chat: State<ChatManager>,
    id: i64,
) -> Result<()> {
    // Terminals sluit de frontend per tab; hier de chat, preview (watcher, statische server) en de MCP-runtime.
    chat.stop(id);
    previews.close(id);
    mcp.stop(id);
    projects::delete(&*db.conn()?, id)
}

#[tauri::command]
pub fn set_default_account(db: State<Db>, project_id: i64, account_id: Option<i64>) -> Result<()> {
    projects::set_default_account(&*db.conn()?, project_id, account_id)
}

// ---------- accounts ----------

#[tauri::command]
pub fn list_accounts(db: State<Db>) -> Result<Vec<Account>> {
    accounts::list(&*db.conn()?)
}

#[tauri::command]
pub fn create_account(
    db: State<Db>,
    profiles: State<Profiles>,
    provider: String,
    label: String,
) -> Result<Account> {
    accounts::create(&*db.conn()?, &profiles.0, &provider, &label)
}

#[tauri::command]
pub fn delete_account(db: State<Db>, id: i64) -> Result<()> {
    accounts::delete(&*db.conn()?, id)
}

// ---------- CLI-check ----------

#[tauri::command]
pub fn cli_status(provider: String) -> Result<CliStatus> {
    Ok(cli::status(Provider::parse(&provider)?))
}

// ---------- MCP ----------

fn trust_key(project_id: i64) -> String {
    format!("studio_trust:{project_id}")
}

/// Start de MCP-server van een project op een achtergrondthread. Blokkeert niets: terminal, preview en git werken
/// gewoon door, ook als de server faalt. De uitkomst (draait of de echte foutreden) komt als `mcp-status`-gebeurtenis.
fn begin_mcp(app: &tauri::AppHandle, p: &Project) -> McpInfo {
    let mcp = app.state::<McpManager>();
    if mcp.mark_starting(p.id) {
        let (app, id, name, pad) = (app.clone(), p.id, p.naam.clone(), p.pad.clone());
        std::thread::spawn(move || {
            let mcp = app.state::<McpManager>();
            let info = mcp.start(id, &name, Path::new(&pad));
            if !mcp.finish_starting(id) {
                mcp.stop(id); // project werd ondertussen gesloten
                return;
            }
            if info.is_up() {
                let trusted = app
                    .state::<Db>()
                    .conn()
                    .ok()
                    .and_then(|c| crate::db::get_setting(&c, &trust_key(id)).ok().flatten());
                let _ = mcp.call(
                    id,
                    "trust.set",
                    json!({ "hash": trusted }),
                    Duration::from_secs(5),
                );
            }
            let _ = app.emit("mcp-status", json!({ "project_id": id, "info": info }));
            // De runtime is er (of juist niet): preview opnieuw beoordelen (plan doorgeven, dev-server starten, melding tonen).
            app.state::<PreviewManager>().open(id, PathBuf::from(&pad));
        });
    }
    mcp.info(p.id).unwrap_or_else(|| McpInfo {
        state: "starting".into(),
        port: None,
        error: None,
        kind: None,
        log: vec![],
    })
}

#[tauri::command(async)]
pub fn open_project(
    app: tauri::AppHandle,
    db: State<Db>,
    previews: State<PreviewManager>,
    id: i64,
) -> Result<McpInfo> {
    let p = projects::get(&*db.conn()?, id)?;
    // Vaste werkwijze (CLAUDE.md / GEMINI.md / AGENTS.md) bijwerken; mislukken mag het openen niet blokkeren.
    let simple = crate::db::communication_simple(&*db.conn()?);
    let _ = instructions::ensure(Path::new(&p.pad), simple);
    // Zero-config preview werkt direct (statisch zonder Node); de runtime volgt op de achtergrond.
    previews.open(p.id, PathBuf::from(&p.pad));
    Ok(begin_mcp(&app, &p))
}

// ---------- preview ----------

#[tauri::command]
pub fn preview_info(previews: State<PreviewManager>, id: i64) -> Option<PreviewInfo> {
    previews.info(id)
}

#[tauri::command(async)]
pub fn preview_start(previews: State<PreviewManager>, id: i64) -> Result<PreviewInfo> {
    previews.start(id)
}

#[tauri::command(async)]
pub fn preview_stop(previews: State<PreviewManager>, id: i64) -> Result<PreviewInfo> {
    previews.stop(id)
}

#[tauri::command(async)]
pub fn preview_restart(previews: State<PreviewManager>, id: i64) -> Result<PreviewInfo> {
    previews.restart(id)
}

#[tauri::command(async)]
pub fn preview_trust_scripts(previews: State<PreviewManager>, id: i64) -> Result<PreviewInfo> {
    previews.trust_scripts(id)
}

#[tauri::command(async)]
pub fn preview_install(previews: State<PreviewManager>, id: i64) -> Result<PreviewInfo> {
    previews.install(id)
}

const UI_SETTINGS: &[&str] = &[
    "preview_auto_switch",
    "communication_mode",
    "permission_mode",
    "loop_threshold",
    "theme",
];

fn valid_setting(key: &str, value: &str) -> bool {
    match key {
        "communication_mode" => matches!(value, "simple" | "technical"),
        "permission_mode" => matches!(value, "always" | "important"),
        "theme" => matches!(value, "system" | "light" | "dark"),
        "loop_threshold" => value
            .parse::<usize>()
            .is_ok_and(|n| (chat::guard::MIN_THRESHOLD..=chat::guard::MAX_THRESHOLD).contains(&n)),
        _ => value.len() <= 20,
    }
}

#[tauri::command]
pub fn get_ui_setting(db: State<Db>, key: String) -> Result<Option<String>> {
    if !UI_SETTINGS.contains(&key.as_str()) {
        return Err(AppError::Invalid("Onbekende instelling.".into()));
    }
    crate::db::get_setting(&*db.conn()?, &format!("ui:{key}"))
}

#[tauri::command(async)]
pub fn set_ui_setting(db: State<Db>, key: String, value: String) -> Result<()> {
    if !UI_SETTINGS.contains(&key.as_str()) || !valid_setting(&key, &value) {
        return Err(AppError::Invalid("Onbekende instelling.".into()));
    }
    let all = {
        let c = db.conn()?;
        crate::db::set_setting(&c, &format!("ui:{key}"), &value)?;
        projects::list(&c)?
    };
    // "Eenvoudige taal" aan/uit: instructiebestanden van alle projecten meteen bijwerken (alleen onze blokken).
    if key == "communication_mode" {
        for p in all {
            if Path::new(&p.pad).is_dir() {
                let _ = instructions::ensure(Path::new(&p.pad), value == "simple");
            }
        }
    }
    Ok(())
}

#[tauri::command(async)]
pub fn close_project(
    mcp: State<McpManager>,
    previews: State<PreviewManager>,
    chat: State<ChatManager>,
    id: i64,
) {
    chat.stop(id);
    previews.close(id);
    mcp.stop(id);
}

#[tauri::command]
pub fn mcp_status(mcp: State<McpManager>, id: i64) -> Option<McpInfo> {
    mcp.info(id)
}

fn timeout_for(cmd: &str) -> Duration {
    match cmd {
        "checks.run" => Duration::from_secs(60 * 60),
        "dev.start" | "dev.restart" | "dev.stop" => Duration::from_secs(30),
        "kit.apply" | "kit.scripts" => Duration::from_secs(20 * 60),
        _ => Duration::from_secs(60),
    }
}

/// Brug naar de runtime van het project (dev-server, checks, git). Alleen commando's die de runtime zelf kent worden uitgevoerd.
#[tauri::command(async)]
pub fn runtime_call(
    mcp: State<McpManager>,
    project_id: i64,
    cmd: String,
    args: Option<Value>,
) -> Result<Value> {
    if cmd == "trust.set" || cmd.starts_with("kit.") {
        return Err(AppError::Invalid(
            "Dit commando heeft een eigen route (trust_studio_config of de kit_*-commando's)."
                .into(),
        ));
    }
    mcp.call(
        project_id,
        &cmd,
        args.unwrap_or_else(|| json!({})),
        timeout_for(&cmd),
    )
}

/// De gebruiker keurt de huidige inhoud van studio.json goed. Verandert het bestand daarna, dan vervalt dit.
#[tauri::command(async)]
pub fn trust_studio_config(db: State<Db>, mcp: State<McpManager>, project_id: i64) -> Result<()> {
    let cfg = mcp.call(project_id, "config.get", json!({}), Duration::from_secs(10))?;
    let hash = cfg["hash"]
        .as_str()
        .ok_or_else(|| AppError::Invalid("studio.json ontbreekt of is niet leesbaar.".into()))?;
    if cfg["config"].is_null() {
        return Err(AppError::Invalid(
            "studio.json is ongeldig; herstel het eerst.".into(),
        ));
    }
    crate::db::set_setting(&*db.conn()?, &trust_key(project_id), hash)?;
    mcp.call(
        project_id,
        "trust.set",
        json!({ "hash": hash }),
        Duration::from_secs(5),
    )?;
    Ok(())
}

#[tauri::command]
pub fn last_checks(
    db: State<Db>,
    project_id: i64,
    limit: Option<i64>,
) -> Result<Vec<mcp::CheckRun>> {
    mcp::last_checks(&*db.conn()?, project_id, limit.unwrap_or(5))
}

// ---------- controle: ziet Claude onze server? ----------

#[derive(Debug, Serialize)]
pub struct McpCheck {
    /// connected | pending_approval | failed | not_found | timeout | unknown
    pub verdict: String,
    pub output: String,
}

/// Vertaalt de uitvoer van `claude mcp get studio` naar een korte uitkomst (statussen uit de Claude-docs).
pub fn mcp_verdict(status: Option<i32>, text: &str) -> &'static str {
    let t = text.to_lowercase();
    if status.is_none() {
        "timeout"
    } else if t.contains("failed to connect") {
        "failed"
    } else if t.contains("pending approval") {
        "pending_approval"
    } else if t.contains("no mcp server found") {
        "not_found"
    } else if t.contains("connected") && !t.contains("disconnected") {
        "connected"
    } else {
        "unknown"
    }
}

/// Draait `claude mcp get studio` in de projectmap, met precies de omgeving die ook de ingebouwde terminal krijgt.
#[tauri::command(async)]
pub fn verify_claude_mcp(
    db: State<Db>,
    mcp: State<McpManager>,
    project_id: i64,
    account_id: Option<i64>,
) -> Result<McpCheck> {
    let (project, account) = {
        let c = db.conn()?;
        let acc = account_id.map(|id| accounts::get(&c, id)).transpose()?;
        (projects::get(&c, project_id)?, acc)
    };
    let info = mcp.info(project_id).filter(|i| i.is_up()).ok_or_else(|| {
        AppError::Invalid("De MCP-server van dit project draait niet; los dat eerst op (zie de melding) en probeer opnieuw.".into())
    })?;
    let binary = cli::resolve("claude")
        .ok_or_else(|| AppError::Invalid("claude is niet geïnstalleerd.".into()))?;
    let dir = project_dir(&project)?;
    mcp_config::ensure(Provider::Claude, &dir)?;
    let mut approval_warnings = Vec::new();
    approve_for_claude(&dir, &mut approval_warnings);

    let mut env = base_env();
    env.extend(cli::mcp_env(
        &mcp::url_for(info.port.unwrap_or(0)),
        mcp.token(),
    ));
    if let Some(a) = account.filter(|a| a.provider == "claude") {
        env.extend(cli::profile_env(
            Provider::Claude,
            Some(Path::new(&a.profile_dir)),
        ));
    }
    let (program, args) = cli::launch(
        &binary,
        vec!["mcp".into(), "get".into(), mcp_config::SERVER_NAME.into()],
    );
    let mut cmd = std::process::Command::new(program);
    cmd.args(args)
        .current_dir(&dir)
        .stdin(std::process::Stdio::null());
    for (k, v) in env {
        cmd.env(k, v);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cli::output_with_timeout(cmd, Duration::from_secs(45)).map_err(AppError::Invalid)?;
    let mut output = out.text.trim().to_string();
    if !approval_warnings.is_empty() {
        output = format!("{}\n\n{output}", approval_warnings.join("\n"));
    }
    Ok(McpCheck {
        verdict: mcp_verdict(out.status, &out.text).into(),
        output,
    })
}

#[cfg(test)]
mod tests {
    use super::mcp_verdict;

    #[test]
    fn claude_status_wordt_vertaald() {
        assert_eq!(
            mcp_verdict(Some(0), "studio:\n  Status: ✔ Connected\n"),
            "connected"
        );
        assert_eq!(
            mcp_verdict(
                Some(0),
                "Status: ⏸ Pending approval (run `claude` to approve)"
            ),
            "pending_approval"
        );
        assert_eq!(
            mcp_verdict(Some(0), "Status: ✘ Failed to connect"),
            "failed"
        );
        assert_eq!(
            mcp_verdict(Some(1), "No MCP server found with name: studio"),
            "not_found"
        );
        assert_eq!(mcp_verdict(None, ""), "timeout");
        assert_eq!(mcp_verdict(Some(0), "iets anders"), "unknown");
    }
}

// ---------- chat ----------

#[derive(Debug, Serialize)]
pub struct ChatTarget {
    pub provider: String,
    pub account_id: Option<i64>,
    pub account_label: Option<String>,
    /// Heeft deze AI een chatweergave? Zo niet: terugval op de terminal.
    pub structured: bool,
    /// "plan" (eerst overleggen) of "build" (bouwen).
    pub mode: String,
}

/// Welke AI praat in de chat? Eerst de keuze in de chat zelf (sessie), dan het standaardaccount, anders Claude.
fn resolve_target(
    conn: &Connection,
    project: &Project,
) -> Result<(Provider, Option<accounts::Account>)> {
    if let Some(s) = chat::store::session(conn, project.id)? {
        let acc = s.account_id.and_then(|id| accounts::get(conn, id).ok());
        return Ok((Provider::parse(&s.provider)?, acc));
    }
    if let Some(id) = project.default_account_id {
        if let Ok(a) = accounts::get(conn, id) {
            return Ok((Provider::parse(&a.provider)?, Some(a)));
        }
    }
    Ok((Provider::Claude, None))
}

fn target_of(provider: Provider, acc: &Option<accounts::Account>, mode: String) -> ChatTarget {
    ChatTarget {
        provider: provider.as_str().into(),
        account_id: acc.as_ref().map(|a| a.id),
        account_label: acc.as_ref().map(|a| a.label.clone()),
        structured: chat::supports_structured(provider),
        mode,
    }
}

#[tauri::command]
pub fn chat_target(db: State<Db>, chat: State<ChatManager>, project_id: i64) -> Result<ChatTarget> {
    let c = db.conn()?;
    let p = projects::get(&c, project_id)?;
    let (provider, acc) = resolve_target(&c, &p)?;
    Ok(target_of(provider, &acc, chat.mode(project_id)))
}

#[tauri::command]
pub fn chat_history(
    db: State<Db>,
    project_id: i64,
    limit: Option<i64>,
) -> Result<Vec<StoredMessage>> {
    chat::store::history(
        &*db.conn()?,
        project_id,
        limit.unwrap_or(200).clamp(1, 1000),
    )
}

/// Bouwt alles wat nodig is om de chat-CLI te starten (binary, omgeving, MCP-config). Wacht hooguit kort op de MCP-server.
fn prepare_chat(
    app: &tauri::AppHandle,
    db: &Db,
    mcp: &McpManager,
    chat: &ChatManager,
    profiles: &Profiles,
    project_id: i64,
) -> Result<ChatLaunch> {
    let (project, provider, account) = {
        let c = db.conn()?;
        let p = projects::get(&c, project_id)?;
        let (prov, acc) = resolve_target(&c, &p)?;
        (p, prov, acc)
    };
    if !chat::supports_structured(provider) {
        return Err(AppError::Invalid(
            "Deze AI heeft nog geen chatweergave; gebruik de technische weergave.".into(),
        ));
    }
    let binary = cli::resolve(provider.binary()).ok_or_else(|| {
        AppError::Invalid(format!("{} is niet geïnstalleerd.", provider.binary()))
    })?;
    let dir = project_dir(&project)?;

    begin_mcp(app, &project);
    let info = mcp.wait_ready(project.id, Duration::from_secs(4));
    let Some((true, Some(port))) = info.as_ref().map(|i| (i.is_up(), i.port)) else {
        let why = info
            .and_then(|i| i.error)
            .unwrap_or_else(|| "De MCP-server is nog niet klaar.".into());
        chat.report_error(project_id, ErrorCode::McpUnavailable, &why);
        return Err(AppError::Invalid(format!(
            "De koppeling met Studio is er nog niet: {why}"
        )));
    };

    // `--mcp-config`-bestand met alleen verwijzingen (${STUDIO_MCP_URL}); het token gaat via de omgeving.
    let app_data = profiles
        .0
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| profiles.0.clone());
    let cfg_dir = app_data.join("chat").join(project_id.to_string());
    std::fs::create_dir_all(&cfg_dir)?;
    let cfg = cfg_dir.join("mcp.json");
    let body =
        json!({ "mcpServers": { mcp_config::SERVER_NAME: mcp_config::entry(Provider::Claude) } });
    std::fs::write(
        &cfg,
        serde_json::to_string_pretty(&body).unwrap_or_default(),
    )?;

    let mut env = base_env();
    env.extend(cli::mcp_env(&mcp::url_for(port), mcp.token()));
    let profile = account.as_ref().map(|a| PathBuf::from(&a.profile_dir));
    if let Some(p) = &profile {
        std::fs::create_dir_all(p)?;
    }
    env.extend(cli::profile_env(provider, profile.as_deref()));
    Ok(ChatLaunch {
        provider,
        account_id: account.map(|a| a.id),
        binary,
        cwd: dir,
        env,
        mcp_config: Some(cfg),
        permission_tool: Some("mcp__studio__permission_prompt".into()),
    })
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn chat_send(
    app: tauri::AppHandle,
    db: State<Db>,
    mcp: State<McpManager>,
    chat: State<ChatManager>,
    profiles: State<Profiles>,
    project_id: i64,
    text: String,
    visible: Option<bool>,
    attachments: Option<Vec<String>>,
) -> Result<()> {
    let dir = project_dir(&projects::get(&*db.conn()?, project_id)?)?;
    let attachments = attachments_from_paths(&dir, attachments.unwrap_or_default())?;
    let launch = prepare_chat(&app, &db, &mcp, &chat, &profiles, project_id)?;
    chat.send_with(
        project_id,
        &text,
        visible.unwrap_or(true),
        &launch,
        &attachments,
    )
}

/// Maximaal aantal bijlagen per bericht.
const MAX_ATTACHMENTS: usize = 6;

/// Controleert elk pad (alleen `assets/`, gewoon bestand) en maakt er bijlagen van.
fn attachments_from_paths(dir: &Path, paths: Vec<String>) -> Result<Vec<chat::Attachment>> {
    if paths.len() > MAX_ATTACHMENTS {
        return Err(AppError::Invalid(format!(
            "Je kunt maximaal {MAX_ATTACHMENTS} bestanden tegelijk meesturen."
        )));
    }
    paths
        .into_iter()
        .map(|p| {
            let full = assets::resolve_asset(dir, &p)?;
            let name = full
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let ext = full
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            Ok(chat::Attachment {
                path: p.replace('\\', "/"),
                name,
                kind: assets::kind_of(&ext).into(),
            })
        })
        .collect()
}

/// Slaat een gesleept of geplakt bestand op in `assets/` van het project.
#[tauri::command(async)]
pub fn chat_attach(
    db: State<Db>,
    project_id: i64,
    name: String,
    data: String,
) -> Result<assets::Saved> {
    let dir = project_dir(&projects::get(&*db.conn()?, project_id)?)?;
    assets::save_base64(&dir, &name, &data)
}

/// Miniatuur (data-URL) van een bijlage, of `None` als het geen kleine afbeelding is.
#[tauri::command(async)]
pub fn chat_asset_data(db: State<Db>, project_id: i64, path: String) -> Result<Option<String>> {
    let dir = project_dir(&projects::get(&*db.conn()?, project_id)?)?;
    assets::thumbnail(&dir, &path)
}

/// "Probeer opnieuw": stuurt het laatste bericht van de gebruiker nog eens (zonder een nieuwe ballon).
#[tauri::command(async)]
pub fn chat_retry(
    app: tauri::AppHandle,
    db: State<Db>,
    mcp: State<McpManager>,
    chat: State<ChatManager>,
    profiles: State<Profiles>,
    project_id: i64,
) -> Result<()> {
    let text = chat::store::last_user_text(&*db.conn()?, project_id)?
        .ok_or_else(|| AppError::Invalid("Er is nog niets om opnieuw te proberen.".into()))?;
    let atts = chat::store::last_user_attachments(&*db.conn()?, project_id)?;
    let launch = prepare_chat(&app, &db, &mcp, &chat, &profiles, project_id)?;
    chat.send_with(project_id, &text, false, &launch, &atts)
}

#[tauri::command]
pub fn chat_mode_set(chat: State<ChatManager>, project_id: i64, mode: String) -> Result<()> {
    chat.set_mode(project_id, &mode)
}

#[tauri::command]
pub fn chat_busy(chat: State<ChatManager>, project_id: i64) -> bool {
    chat.busy(project_id)
}

#[tauri::command]
pub fn chat_stop(chat: State<ChatManager>, project_id: i64) {
    chat.stop(project_id);
}

/// "Wissel van AI": nieuwe sessie met een scheiding in de chat. Heeft de nieuwe AI een chatweergave, dan krijgt hij PROJECT.md als overdracht.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn chat_switch(
    app: tauri::AppHandle,
    db: State<Db>,
    mcp: State<McpManager>,
    chat: State<ChatManager>,
    profiles: State<Profiles>,
    project_id: i64,
    provider: String,
    account_id: Option<i64>,
) -> Result<ChatTarget> {
    let provider = Provider::parse(&provider)?;
    let account = {
        let c = db.conn()?;
        let acc = account_id.map(|id| accounts::get(&c, id)).transpose()?;
        if let Some(a) = &acc {
            if a.provider != provider.as_str() {
                return Err(AppError::Invalid(
                    "Dit account hoort bij een andere AI.".into(),
                ));
            }
        }
        projects::set_default_account(&c, project_id, account_id)?;
        acc
    };
    let divider = json!({ "kind": "switched", "provider": provider.as_str(), "label": account.as_ref().map(|a| a.label.clone()) });
    chat.new_session(project_id, provider, account_id, divider);
    let target = target_of(provider, &account, chat.mode(project_id));
    if target.structured {
        let launch = prepare_chat(&app, &db, &mcp, &chat, &profiles, project_id)?;
        chat.send(project_id, cli::HANDOVER_PROMPT, false, &launch)?;
    }
    Ok(target)
}

#[tauri::command(async)]
pub fn permission_answer(
    chat: State<ChatManager>,
    project_id: i64,
    req_id: String,
    allow: bool,
) -> Result<()> {
    chat.answer_permission(project_id, &req_id, allow)
}

// ---------- terminal ----------

#[derive(Debug, Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub kind: String,
    pub provider: Option<String>,
    pub account_id: Option<i64>,
    pub account_label: Option<String>,
    pub project_id: Option<i64>,
    pub warnings: Vec<String>,
}

/// Keurt onze server in Claude goed (zie claude_approval.rs). Geeft eventuele waarschuwingen terug.
fn approve_for_claude(dir: &Path, warnings: &mut Vec<String>) {
    match claude_approval::ensure(dir) {
        Ok(claude_approval::Outcome::Rejected) => warnings.push(
            "Je hebt de ‘studio’-server eerder afgewezen in Claude; Studio keurt hem niet opnieuw goed. Verwijder ‘studio’ uit disabledMcpjsonServers in .claude/settings.local.json als je dat wilt.".into(),
        ),
        Ok(_) => {}
        Err(e) => warnings.push(e.to_string()),
    }
}

fn base_env() -> Vec<(String, String)> {
    cli::child_path()
        .map(|p| vec![("PATH".to_string(), p)])
        .unwrap_or_default()
}

fn project_dir(p: &Project) -> Result<PathBuf> {
    let d = PathBuf::from(&p.pad);
    if d.is_dir() {
        Ok(d)
    } else {
        Err(AppError::Invalid(format!(
            "De projectmap bestaat niet meer: {}",
            p.pad
        )))
    }
}

#[tauri::command]
pub fn start_shell(
    db: State<Db>,
    term: State<TerminalManager>,
    project_id: i64,
    rows: u16,
    cols: u16,
) -> Result<SessionInfo> {
    let p = projects::get(&*db.conn()?, project_id)?;
    let program = if cfg!(windows) {
        "powershell.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
    };
    let id = term.spawn(SpawnSpec {
        program,
        args: vec![],
        cwd: project_dir(&p)?,
        env: base_env(),
        rows,
        cols,
    })?;
    Ok(SessionInfo {
        id,
        kind: "shell".into(),
        provider: None,
        account_id: None,
        account_label: None,
        project_id: Some(project_id),
        warnings: vec![],
    })
}

/// Start een AI-CLI in het project. `handover`: geef PROJECT.md als overdracht mee. `resume`: hervat de laatste sessie van dit account.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn start_ai(
    app: tauri::AppHandle,
    db: State<Db>,
    term: State<TerminalManager>,
    mcp: State<McpManager>,
    project_id: i64,
    provider: String,
    account_id: Option<i64>,
    handover: bool,
    resume: bool,
    rows: u16,
    cols: u16,
) -> Result<SessionInfo> {
    let provider = Provider::parse(&provider)?;
    let (project, account) = {
        let c = db.conn()?;
        let acc = account_id.map(|id| accounts::get(&c, id)).transpose()?;
        (projects::get(&c, project_id)?, acc)
    };
    if let Some(a) = &account {
        if a.provider != provider.as_str() {
            return Err(AppError::Invalid(
                "Dit account hoort bij een andere provider.".into(),
            ));
        }
    }
    let binary = cli::resolve(provider.binary()).ok_or_else(|| {
        AppError::Invalid(format!("{} is niet geïnstalleerd.", provider.binary()))
    })?;
    let dir = project_dir(&project)?;

    let mut warnings = Vec::new();
    let mut env = base_env();
    // De CLI mag nooit op de MCP-server blokkeren: hooguit 4 s wachten, daarna starten we zonder MCP (met uitleg).
    begin_mcp(&app, &project);
    let info = mcp
        .wait_ready(project.id, Duration::from_secs(4))
        .unwrap_or_else(|| McpInfo {
            state: "starting".into(),
            port: None,
            error: None,
            kind: None,
            log: vec![],
        });
    if let (true, Some(port)) = (info.is_up(), info.port) {
        match mcp_config::ensure(provider, &dir) {
            Ok(_) => {
                env.extend(cli::mcp_env(&mcp::url_for(port), mcp.token()));
                if provider == Provider::Claude {
                    approve_for_claude(&dir, &mut warnings);
                }
            }
            Err(e) => warnings.push(e.to_string()),
        }
    } else if let Some(e) = info.error {
        warnings.push(format!("MCP niet beschikbaar: {e}"));
    } else if info.state == "starting" {
        warnings.push("De MCP-server is nog niet klaar; de AI start zonder Studio-tools. Start de AI opnieuw zodra ‘MCP: gereed’ in de balk staat.".into());
    }

    let profile = account.as_ref().map(|a| PathBuf::from(&a.profile_dir));
    if let Some(p) = &profile {
        std::fs::create_dir_all(p)?;
    }
    env.extend(cli::profile_env(provider, profile.as_deref()));

    let args = cli::ai_args(provider, handover.then_some(cli::HANDOVER_PROMPT), resume);
    let (program, args) = cli::launch(&binary, args);
    let id = term.spawn(SpawnSpec {
        program,
        args,
        cwd: dir,
        env,
        rows,
        cols,
    })?;
    Ok(SessionInfo {
        id,
        kind: "ai".into(),
        provider: Some(provider.as_str().into()),
        account_id: account.as_ref().map(|a| a.id),
        account_label: account.map(|a| a.label),
        project_id: Some(project_id),
        warnings,
    })
}

/// Inlogsessie: draait de CLI met de profielvariabele; de gebruiker logt zelf in. Wij zien en bewaren niets.
#[tauri::command]
pub fn start_login(
    db: State<Db>,
    term: State<TerminalManager>,
    account_id: i64,
    rows: u16,
    cols: u16,
) -> Result<SessionInfo> {
    let account = accounts::get(&*db.conn()?, account_id)?;
    let provider = Provider::parse(&account.provider)?;
    let binary = cli::resolve(provider.binary()).ok_or_else(|| {
        AppError::Invalid(format!("{} is niet geïnstalleerd.", provider.binary()))
    })?;
    let dir = PathBuf::from(&account.profile_dir);
    std::fs::create_dir_all(&dir)?;
    let mut env = base_env();
    env.extend(cli::profile_env(provider, Some(&dir)));
    let (program, args) = cli::launch(&binary, cli::login_args(provider));
    let id = term.spawn(SpawnSpec {
        program,
        args,
        cwd: dir,
        env,
        rows,
        cols,
    })?;
    Ok(SessionInfo {
        id,
        kind: "login".into(),
        provider: Some(provider.as_str().into()),
        account_id: Some(account.id),
        account_label: Some(account.label),
        project_id: None,
        warnings: vec![],
    })
}

/// Invoer van xterm.js (tekst, UTF-8).
#[tauri::command]
pub fn pty_write(term: State<TerminalManager>, id: String, data: String) -> Result<()> {
    term.write(&id, data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(term: State<TerminalManager>, id: String, rows: u16, cols: u16) -> Result<()> {
    term.resize(&id, rows, cols)
}

#[tauri::command]
pub fn pty_snapshot(term: State<TerminalManager>, id: String) -> Result<Snapshot> {
    term.snapshot(&id)
}

#[tauri::command]
pub fn pty_close(term: State<TerminalManager>, id: String) -> Result<()> {
    term.close(&id)
}

#[cfg(test)]
mod attachment_tests {
    use super::*;

    #[test]
    fn bijlagepaden_worden_gecontroleerd_en_beperkt() {
        let d = tempfile::tempdir().unwrap();
        let png = [0x89u8, b'P', b'N', b'G', 0, 0, 0, 0];
        let s = assets::save(d.path(), "foto.png", &png).unwrap();
        let ok = attachments_from_paths(d.path(), vec![s.path.clone()]).unwrap();
        assert_eq!(
            (ok[0].path.as_str(), ok[0].kind.as_str()),
            ("assets/foto.png", "image")
        );
        assert!(attachments_from_paths(d.path(), vec!["../buiten.png".into()]).is_err());
        assert!(attachments_from_paths(d.path(), vec!["index.html".into()]).is_err());
        assert!(
            attachments_from_paths(d.path(), vec![s.path.clone(); MAX_ATTACHMENTS + 1])
                .unwrap_err()
                .to_string()
                .contains("maximaal")
        );
    }
}

/// Roept een kit-commando van de runtime aan. De map met kits komt van Studio zelf (nooit van de UI).
fn kit_call(
    app: &tauri::AppHandle,
    db: &Db,
    mcp: &McpManager,
    project_id: i64,
    cmd: &str,
    mut args: Value,
) -> Result<Value> {
    let project = projects::get(&*db.conn()?, project_id)?;
    project_dir(&project)?;
    begin_mcp(app, &project);
    let ready = mcp.wait_ready(project_id, Duration::from_secs(15));
    if !ready.map(|i| i.is_up()).unwrap_or(false) {
        return Err(AppError::Invalid(
            "De koppeling met Studio is er nog niet. Probeer het over een paar seconden opnieuw."
                .into(),
        ));
    }
    let packs = templates::bundled(app, "design-packs")?;
    args["packs"] = json!(packs.to_string_lossy());
    let timeout = timeout_for(cmd);
    mcp.call(project_id, cmd, args, timeout)
}

#[tauri::command(async)]
pub fn kit_list(
    app: tauri::AppHandle,
    db: State<Db>,
    mcp: State<McpManager>,
    project_id: i64,
) -> Result<Value> {
    kit_call(&app, &db, &mcp, project_id, "kit.list", json!({}))
}

#[tauri::command(async)]
pub fn kit_current(
    app: tauri::AppHandle,
    db: State<Db>,
    mcp: State<McpManager>,
    project_id: i64,
) -> Result<Value> {
    kit_call(&app, &db, &mcp, project_id, "kit.current", json!({}))
}

/// Past een kit toe (met checkpoint vooraf en automatisch terugdraaien bij een fout). Ververst daarna de preview.
#[tauri::command(async)]
pub fn kit_apply(
    app: tauri::AppHandle,
    db: State<Db>,
    mcp: State<McpManager>,
    previews: State<PreviewManager>,
    project_id: i64,
    kit: String,
    tailor: Option<Value>,
) -> Result<Value> {
    let dir = project_dir(&projects::get(&*db.conn()?, project_id)?)?;
    previews.open(project_id, dir.clone()); // plan opnieuw bepalen (bijv. net een template erin gezet)
    let out = kit_call(
        &app,
        &db,
        &mcp,
        project_id,
        "kit.apply",
        json!({ "kit": kit, "tailor": tailor }),
    );
    previews.open(project_id, dir);
    out
}

#[tauri::command(async)]
pub fn kit_scripts(
    app: tauri::AppHandle,
    db: State<Db>,
    mcp: State<McpManager>,
    project_id: i64,
    packages: Vec<String>,
) -> Result<Value> {
    kit_call(
        &app,
        &db,
        &mcp,
        project_id,
        "kit.scripts",
        json!({ "packages": packages }),
    )
}

/// Past hoofdkleur, afronding, ruimte of lettertype aan (meteen zichtbaar in de preview).
#[tauri::command(async)]
pub fn kit_tailor(
    app: tauri::AppHandle,
    db: State<Db>,
    mcp: State<McpManager>,
    project_id: i64,
    tailor: Value,
) -> Result<Value> {
    kit_call(
        &app,
        &db,
        &mcp,
        project_id,
        "kit.tailor",
        json!({ "tailor": tailor }),
    )
}

/// Scant de broncode op afwijkingen van het gekozen uiterlijk (losse kleuren, gewone knoppen, andere bibliotheken, …).
#[tauri::command(async)]
pub fn kit_check(
    app: tauri::AppHandle,
    db: State<Db>,
    mcp: State<McpManager>,
    project_id: i64,
) -> Result<Value> {
    kit_call(&app, &db, &mcp, project_id, "kit.check", json!({}))
}

/// Stelt in of de kit-check alleen waarschuwt of ook blokkeert ("waarschuwen" of "blokkeren").
#[tauri::command(async)]
pub fn kit_strictness(
    app: tauri::AppHandle,
    db: State<Db>,
    mcp: State<McpManager>,
    project_id: i64,
    level: String,
) -> Result<Value> {
    kit_call(
        &app,
        &db,
        &mcp,
        project_id,
        "kit.strictness",
        json!({ "level": level }),
    )
}

#[cfg(test)]
mod setting_tests {
    use super::*;

    #[test]
    fn alle_instellingen_van_de_ui_zijn_toegestaan_en_waarden_worden_gecontroleerd() {
        for key in [
            "preview_auto_switch",
            "communication_mode",
            "permission_mode",
            "loop_threshold",
            "theme",
        ] {
            assert!(UI_SETTINGS.contains(&key), "{key} ontbreekt in UI_SETTINGS");
        }
        assert!(
            valid_setting("theme", "system")
                && valid_setting("theme", "light")
                && valid_setting("theme", "dark")
        );
        assert!(!valid_setting("theme", "paars"));
        assert!(
            valid_setting("loop_threshold", "3")
                && !valid_setting("loop_threshold", "1")
                && !valid_setting("loop_threshold", "abc")
        );
    }
}

/// "Download je project": maakt een zip (zonder node_modules, bouwuitvoer en geheimen) op de gekozen plek.
#[tauri::command(async)]
pub fn export_project(
    db: State<Db>,
    project_id: i64,
    dest: String,
) -> Result<crate::export::ExportResult> {
    let dir = project_dir(&projects::get(&*db.conn()?, project_id)?)?;
    crate::export::export_zip(&dir, Path::new(&dest))
}

/// Opdracht-verbeteraar: de AI schrijft een duidelijker voorstel. Er wordt niets verstuurd of opgeslagen.
#[tauri::command(async)]
pub fn improve_prompt(db: State<Db>, project_id: i64, text: String) -> Result<String> {
    let (_project, provider, account) = {
        let c = db.conn()?;
        let p = projects::get(&c, project_id)?;
        let (prov, acc) = resolve_target(&c, &p)?;
        (p, prov, acc)
    };
    if provider != Provider::Claude {
        return Err(AppError::Invalid(
            "De opdracht-verbeteraar werkt nu alleen met Claude. Kies Claude voor dit project."
                .into(),
        ));
    }
    let binary = cli::resolve(provider.binary()).ok_or_else(|| {
        AppError::Invalid(format!("{} is niet geïnstalleerd.", provider.binary()))
    })?;
    let mut env = base_env();
    let profile = account.as_ref().map(|a| PathBuf::from(&a.profile_dir));
    if let Some(p) = &profile {
        std::fs::create_dir_all(p)?;
    }
    env.extend(cli::profile_env(provider, profile.as_deref()));
    crate::improve::run(
        &binary,
        &env,
        &std::env::temp_dir(),
        &text,
        Duration::from_secs(120),
    )
}
