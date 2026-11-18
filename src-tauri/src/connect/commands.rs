//! Tauri-commando's voor koppelingen. Netwerk-aanroepen draaien op een eigen thread zodat het venster nooit wacht.
//! Een token komt alleen via `connect_paste` de app in (van de gebruiker) en gaat nooit terug naar de frontend.
use super::error::ConnectError;
use super::http::is_allowed;
use super::manager::{Disconnected, Info, Manager, StartInfo};
use super::providers;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

type M<'a> = State<'a, Arc<Manager>>;

async fn blocking<T: Send + 'static>(m: &M<'_>, f: impl FnOnce(Arc<Manager>) -> T + Send + 'static) -> Result<T, ConnectError> {
    let m = m.inner().clone();
    tauri::async_runtime::spawn_blocking(move || f(m)).await.map_err(|_| ConnectError::Unexpected)
}

#[tauri::command]
pub async fn connect_list(m: M<'_>) -> Result<Vec<Info>, ConnectError> {
    blocking(&m, |m| m.list()).await
}

#[tauri::command]
pub async fn connect_start(m: M<'_>, id: String) -> Result<StartInfo, ConnectError> {
    blocking(&m, move |m| m.start(&id)).await?
}

#[tauri::command]
pub async fn connect_paste(m: M<'_>, id: String, token: String) -> Result<Info, ConnectError> {
    blocking(&m, move |m| m.paste(&id, &token)).await?
}

#[tauri::command]
pub async fn connect_cancel(m: M<'_>, id: String) -> Result<(), ConnectError> {
    blocking(&m, move |m| m.cancel(&id)).await
}

#[tauri::command]
pub async fn connect_test(m: M<'_>, id: String) -> Result<Info, ConnectError> {
    blocking(&m, move |m| m.test(&id)).await?
}

#[tauri::command]
pub async fn connect_test_all(m: M<'_>) -> Result<Vec<Info>, ConnectError> {
    blocking(&m, |m| m.test_all()).await
}

#[tauri::command]
pub async fn connect_disconnect(m: M<'_>, id: String) -> Result<Disconnected, ConnectError> {
    blocking(&m, move |m| m.disconnect(&id)).await?
}

/// Opent een pagina van een van de diensten in de systeembrowser (niet in een ingebouwd venster). Andere adressen worden geweigerd.
#[tauri::command]
pub fn connect_open(app: AppHandle, url: String) -> Result<(), ConnectError> {
    if !is_allowed(&url, &providers::open_hosts()) {
        return Err(ConnectError::Blocked);
    }
    app.opener().open_url(url, None::<&str>).map_err(|_| ConnectError::Unexpected)
}
