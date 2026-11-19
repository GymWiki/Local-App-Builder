//! Niet-geheime gegevens van een koppeling (status, accountnaam) in SQLite.
use super::provider::Strategy;
use rusqlite::{params, Connection};
use serde::Serialize;
#[cfg(test)]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    NietGekoppeld,
    Bezig,
    Werkt,
    Verlopen,
    Fout,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::NietGekoppeld => "niet_gekoppeld",
            Status::Bezig => "bezig",
            Status::Werkt => "werkt",
            Status::Verlopen => "verlopen",
            Status::Fout => "fout",
        }
    }
    fn parse(s: &str) -> Status {
        match s {
            "werkt" => Status::Werkt,
            "verlopen" => Status::Verlopen,
            "fout" => Status::Fout,
            _ => Status::NietGekoppeld,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Meta {
    pub provider: String,
    pub status: Status,
    pub account: Option<String>,
    pub error: Option<String>,
    pub method: Option<Strategy>,
    pub connected_at: Option<i64>,
    pub expires_at: Option<i64>,
}

pub trait MetaStore: Send + Sync {
    fn get(&self, provider: &str) -> Option<Meta>;
    fn put(&self, meta: &Meta);
    fn remove(&self, provider: &str);
}

fn method_str(m: Option<Strategy>) -> Option<&'static str> {
    m.map(|m| match m {
        Strategy::OauthLoopbackPkce => "oauth_loopback_pkce",
        Strategy::OauthDevice => "oauth_device",
        Strategy::TokenPlakken => "token_plakken",
    })
}
fn method_parse(s: &str) -> Option<Strategy> {
    match s {
        "oauth_loopback_pkce" => Some(Strategy::OauthLoopbackPkce),
        "oauth_device" => Some(Strategy::OauthDevice),
        "token_plakken" => Some(Strategy::TokenPlakken),
        _ => None,
    }
}

pub fn sql_get(conn: &Connection, provider: &str) -> Option<Meta> {
    conn.query_row("SELECT status, account, error, method, connected_at, expires_at FROM connections WHERE provider = ?1", params![provider], |r| {
        Ok(Meta {
            provider: provider.to_string(),
            status: Status::parse(&r.get::<_, String>(0)?),
            account: r.get(1)?,
            error: r.get(2)?,
            method: r.get::<_, Option<String>>(3)?.and_then(|m| method_parse(&m)),
            connected_at: r.get(4)?,
            expires_at: r.get(5)?,
        })
    })
    .ok()
}

pub fn sql_put(conn: &Connection, m: &Meta) {
    let _ = conn.execute(
        "INSERT INTO connections (provider, status, account, error, method, connected_at, expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(provider) DO UPDATE SET status=?2, account=?3, error=?4, method=?5, connected_at=?6, expires_at=?7",
        params![m.provider, m.status.as_str(), m.account, m.error, method_str(m.method), m.connected_at, m.expires_at],
    );
}

pub fn sql_remove(conn: &Connection, provider: &str) {
    let _ = conn.execute("DELETE FROM connections WHERE provider = ?1", params![provider]);
}

/// Geeft toegang tot de database zonder dat deze module weet van Tauri (de app geeft de verbinding mee).
pub trait ConnSource: Send + Sync {
    fn with(&self, f: &mut dyn FnMut(&Connection));
}

pub struct SqliteMeta(pub Box<dyn ConnSource>);

impl MetaStore for SqliteMeta {
    fn get(&self, provider: &str) -> Option<Meta> {
        let mut out = None;
        self.0.with(&mut |c| out = sql_get(c, provider));
        out
    }
    fn put(&self, meta: &Meta) {
        self.0.with(&mut |c| sql_put(c, meta));
    }
    fn remove(&self, provider: &str) {
        self.0.with(&mut |c| sql_remove(c, provider));
    }
}

#[cfg(test)]
#[derive(Default)]
pub struct MemMeta(Mutex<HashMap<String, Meta>>);

#[cfg(test)]
impl MetaStore for MemMeta {
    fn get(&self, provider: &str) -> Option<Meta> {
        self.0.lock().unwrap().get(provider).cloned()
    }
    fn put(&self, meta: &Meta) {
        self.0.lock().unwrap().insert(meta.provider.clone(), meta.clone());
    }
    fn remove(&self, provider: &str) {
        self.0.lock().unwrap().remove(provider);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bewaart_en_leest_in_sqlite() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        assert!(sql_get(&conn, "github").is_none());
        let m = Meta { provider: "github".into(), status: Status::Werkt, account: Some("pieter".into()), error: None, method: Some(Strategy::OauthDevice), connected_at: Some(5), expires_at: Some(9) };
        sql_put(&conn, &m);
        let g = sql_get(&conn, "github").unwrap();
        assert_eq!((g.status, g.account.as_deref(), g.method, g.expires_at), (Status::Werkt, Some("pieter"), Some(Strategy::OauthDevice), Some(9)));
        sql_put(&conn, &Meta { status: Status::Verlopen, ..m });
        assert_eq!(sql_get(&conn, "github").unwrap().status, Status::Verlopen);
        sql_remove(&conn, "github");
        assert!(sql_get(&conn, "github").is_none());
    }

    #[test]
    fn de_tabel_heeft_geen_kolom_voor_geheimen() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut conn).unwrap();
        let kolommen: Vec<String> = conn.prepare("PRAGMA table_info(connections)").unwrap().query_map([], |r| r.get::<_, String>(1)).unwrap().map(|r| r.unwrap()).collect();
        assert!(kolommen.iter().all(|k| !k.contains("token") && !k.contains("secret") && !k.contains("password")), "{kolommen:?}");
    }
}
