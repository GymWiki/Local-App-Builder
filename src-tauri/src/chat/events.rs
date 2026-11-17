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
