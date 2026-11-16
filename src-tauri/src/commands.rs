use crate::accounts::{self, Account};
use crate::cli::{self, CliStatus};
use crate::error::{AppError, Result};
use crate::instructions;
use crate::mcp::{self, McpInfo, McpManager};
use crate::mcp_config;
use crate::projects::{self, Project};
use crate::provider::Provider;
use crate::terminal::{Snapshot, SpawnSpec, TerminalManager};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::State;

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
    db: State<Db>,
    naam: String,
    bovenliggend_pad: String,
    template: Option<String>,
) -> Result<Project> {
    projects::create(
        &*db.conn()?,
        &naam,
        &PathBuf::from(bovenliggend_pad),
        template.as_deref().unwrap_or("leeg"),
    )
}

/// Verwijdert alleen uit de lijst; bestanden op schijf blijven staan.
#[tauri::command(async)]
pub fn delete_project(
    db: State<Db>,
    mcp: State<McpManager>,
    term: State<TerminalManager>,
    id: i64,
) -> Result<()> {
    mcp.stop(id);
    let _ = term; // sessies sluit de frontend per tab; de MCP-server stopt hier
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

#[tauri::command(async)]
pub fn open_project(db: State<Db>, mcp: State<McpManager>, id: i64) -> Result<McpInfo> {
    let (p, trusted) = {
        let c = db.conn()?;
        (
            projects::get(&c, id)?,
            crate::db::get_setting(&c, &trust_key(id))?,
        )
    };
    // Vaste werkwijze (CLAUDE.md / GEMINI.md / AGENTS.md) bijwerken; mislukken mag het openen niet blokkeren.
    let _ = instructions::ensure(Path::new(&p.pad));
    let info = mcp.start(p.id, &p.naam, Path::new(&p.pad));
    if info.is_up() {
        let _ = mcp.call(
            p.id,
            "trust.set",
            json!({ "hash": trusted }),
            Duration::from_secs(5),
        );
    }
    Ok(info)
}

#[tauri::command(async)]
pub fn close_project(mcp: State<McpManager>, id: i64) {
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
    if cmd == "trust.set" {
        return Err(AppError::Invalid(
            "Gebruik trust_studio_config om te vertrouwen.".into(),
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
    let info = mcp.start(project.id, &project.naam, &dir);
    if let (true, Some(port)) = (info.is_up(), info.port) {
        match mcp_config::ensure(provider, &dir) {
            Ok(_) => env.extend(cli::mcp_env(&mcp::url_for(port), mcp.token())),
            Err(e) => warnings.push(e.to_string()),
        }
    } else if let Some(e) = info.error {
        warnings.push(format!("MCP niet beschikbaar: {e}"));
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
