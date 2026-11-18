//! Bevestigingen in de Studio-UI voor acties van de AI die iets buiten de computer doen (naar GitHub sturen, online zetten, naar een winkel).
//! De backend stuurt alleen een soort en gegevens; de tekst staat in `nl.json` (`bevestig.*`). Zonder antwoord telt het als "nee".
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Serialize)]
pub struct ActionConfirm {
    pub id: String,
    pub project_id: i64,
    /// Bijvoorbeeld `github_backup`; de tekst hoort bij `bevestig.<soort>` in nl.json.
    pub soort: String,
    pub params: Value,
    /// Extra zware vraag (bijvoorbeeld "echt online zetten"): de dialoog laat dat zien.
    pub zwaar: bool,
}

pub trait ActionConfirmer: Send + Sync {
    /// Wacht op het antwoord van de gebruiker. Zonder antwoord of bij een fout: `false`.
    fn ask(&self, req: &ActionConfirm) -> bool;
}

pub struct UiActionConfirmer {
    app: AppHandle,
    pending: Mutex<HashMap<String, Sender<bool>>>,
}

impl UiActionConfirmer {
    pub fn new(app: AppHandle) -> Arc<Self> {
        Arc::new(Self { app, pending: Mutex::new(HashMap::new()) })
    }
    pub fn answer(&self, id: &str, allow: bool) -> bool {
        match self.pending.lock().unwrap().remove(id) {
            Some(tx) => tx.send(allow).is_ok(),
            None => false,
        }
    }
}

impl ActionConfirmer for UiActionConfirmer {
    fn ask(&self, req: &ActionConfirm) -> bool {
        let (tx, rx) = channel();
        self.pending.lock().unwrap().insert(req.id.clone(), tx);
        if self.app.emit("actie-confirm", req).is_err() {
            self.pending.lock().unwrap().remove(&req.id);
            return false;
        }
        let ok = rx.recv_timeout(TIMEOUT).unwrap_or(false);
        self.pending.lock().unwrap().remove(&req.id);
        ok
    }
}

#[tauri::command]
pub fn actie_confirm_answer(confirmer: State<Arc<UiActionConfirmer>>, id: String, toestaan: bool) -> bool {
    confirmer.answer(&id, toestaan)
}

/// Een nieuw, uniek vraag-id.
pub fn new_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(1);
    format!("a{}-{}", N.fetch_add(1, Ordering::SeqCst), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0))
}

#[cfg(test)]
pub struct Scripted {
    pub answers: Mutex<Vec<bool>>,
    pub asked: Mutex<Vec<ActionConfirm>>,
}

#[cfg(test)]
impl Scripted {
    pub fn new() -> Arc<Self> {
        Arc::new(Self { answers: Mutex::new(vec![]), asked: Mutex::new(vec![]) })
    }
    pub fn answer_with(&self, a: bool) {
        self.answers.lock().unwrap().push(a);
    }
}

#[cfg(test)]
impl ActionConfirmer for Scripted {
    fn ask(&self, req: &ActionConfirm) -> bool {
        self.asked.lock().unwrap().push(req.clone());
        let mut a = self.answers.lock().unwrap();
        if a.is_empty() { false } else { a.remove(0) }
    }
}
