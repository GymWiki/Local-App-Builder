use crate::error::{AppError, Result};
use crate::projects::{self, Project};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use tauri::State;

pub struct Db(pub Mutex<Connection>);

impl Db {
    fn conn(&self) -> Result<MutexGuard<'_, Connection>> {
        self.0
            .lock()
            .map_err(|_| AppError::Invalid("Databaseslot is vergiftigd.".into()))
    }
}

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
#[tauri::command]
pub fn delete_project(db: State<Db>, id: i64) -> Result<()> {
    projects::delete(&*db.conn()?, id)
}
