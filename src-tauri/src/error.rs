use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Databasefout: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Bestandsfout: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Invalid(String),
    #[error("Project niet gevonden.")]
    NotFound,
    #[error("Git is niet gevonden of mislukte: {0}")]
    Git(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
