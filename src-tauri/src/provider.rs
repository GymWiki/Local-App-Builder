use crate::error::{AppError, Result};
use serde::Serialize;

/// Codex staat bewust niet in deze lijst: de documentatie kon niet worden geverifieerd (zie docs/cli-notes.md).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Claude,
    Gemini,
}

impl Provider {
    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "claude" => Ok(Self::Claude),
            "gemini" => Ok(Self::Gemini),
            "codex" => Err(AppError::Invalid(
                "Codex wordt nog niet ondersteund (niet geverifieerd).".into(),
            )),
            other => Err(AppError::Invalid(format!("Onbekende provider: {other}"))),
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Gemini => "gemini",
        }
    }
    pub fn binary(self) -> &'static str {
        self.as_str()
    }
    /// Omgevingsvariabele die de CLI naar een aparte profielmap wijst (bron: docs/cli-notes.md).
    pub fn profile_env(self) -> &'static str {
        match self {
            Self::Claude => "CLAUDE_CONFIG_DIR",
            Self::Gemini => "GEMINI_CLI_HOME",
        }
    }
}
