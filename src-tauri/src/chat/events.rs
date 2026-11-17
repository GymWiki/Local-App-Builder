//! Adapter-onafhankelijke gebeurtenissen van de chat. De UI vertaalt `kind`/`code` + `params` naar gewone taal (i18n);
//! de technische details (`detail`, `technical`) zijn alleen voor het uitklapbare gedeelte.
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionKind {
    FileCreated,
    FileEdited,
    FileRead,
    Search,
    RunChecks,
    InstallPackages,
    StartServer,
    RunCommand,
    DeleteFiles,
    Publish,
    SaveVersion,
    ListVersions,
    ViewPreview,
    FindPageErrors,
    ReadLogs,
    ReadNotes,
    UpdateNotes,
    Plan,
    WebLookup,
    Helper,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Thinking,
    Editing,
    Working,
    Checking,
    Done,
    Idle,
}

impl ActionKind {
    /// Welke statusregel hoort bij deze actie ("Bestanden aanpassen", "Controleren", …).
    pub fn status(self) -> Status {
        use ActionKind::*;
        match self {
            FileCreated | FileEdited | UpdateNotes | DeleteFiles => Status::Editing,
            RunChecks | ViewPreview | FindPageErrors | ReadLogs => Status::Checking,
            _ => Status::Working,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    NotLoggedIn,
    RateLimit,
    Overloaded,
    Billing,
    Network,
    ModelNotFound,
    CliCrashed,
    CliMissing,
    McpUnavailable,
    Unknown,
}

/// Samenvatting van een controle (lint/build/test/…): voor de bug-lus bewaker.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct CheckInfo {
    pub ok: bool,
    /// Namen van de mislukte stappen (bijv. "build").
    pub steps: Vec<String>,
    /// Genormaliseerde vingerafdruk van de eerste fout (zonder getallen en paden).
    pub signature: String,
    /// Aantal foutregels; groter = slechter.
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatEvent {
    Session {
        session_id: String,
    },
    Text {
        id: String,
        text: String,
    },
    Action {
        id: String,
        kind: ActionKind,
        params: Value,
        detail: String,
    },
    ActionResult {
        id: String,
        ok: bool,
        fixed: bool,
        summary: String,
        /// Alleen bij controles (run_checks, bouwen, testen).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        check: Option<CheckInfo>,
    },
    Status {
        state: Status,
    },
    Error {
        code: ErrorCode,
        technical: String,
    },
    TurnDone {
        ok: bool,
    },
    /// De CLI levert (nog) geen bruikbare gestructureerde uitvoer: val terug op de terminal.
    Fallback {
        reason: String,
    },
}
