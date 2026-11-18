//! De beheerder van alle koppelingen: kiest de inlogmethode, draait de inlogstromen op de achtergrond, bewaart tokens in de kluis,
//! ververst ze en geeft ze alleen binnen Rust door aan wie een dienst nodig heeft (`authorized`). De AI en de frontend zien nooit een token.
use super::config::Config;
use super::device::{self, DeviceInfo};
use super::error::ConnectError;
use super::http::Http;
use super::loopback::{self, Outcome, Receiver};
use super::oauth;
use super::pkce;
use super::provider::{device_spec, loopback_spec, Links, Provider, Revoke, Strategy};
use super::store::{Meta, MetaStore, Status};
use super::tokens::TokenSet;
use super::vault::{ProviderVault, SecretStore};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const TOKENS: &str = "tokens";
/// Vernieuw een token als het binnen zoveel seconden verloopt.
const REFRESH_MARGIN: i64 = 300;
const MAX_TOKEN_LEN: usize = 4096;

/// Wat de app tijdens een lopende inlog laat zien.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "soort", rename_all = "snake_case")]
pub enum Display {
    Apparaat(DeviceInfo),
    Browser { url: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "soort", rename_all = "snake_case")]
pub enum StartInfo {
    Plakken,
    Apparaat(DeviceInfo),
    Browser { url: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct Info {
    pub id: String,
    pub strategie: Strategy,
    pub status: Status,
    pub account: Option<String>,
    pub fout: Option<String>,
    pub rechten: Vec<&'static str>,
    pub functies: Vec<&'static str>,
    pub links: Links,
    pub bezig: Option<Display>,
    pub verloopt: Option<i64>,
}

/// Wat de AI mag weten: alleen óf een dienst gekoppeld is en werkt. Nooit sleutels, accountnamen of tokens.
#[derive(Debug, Clone, Serialize)]
pub struct AiStatus {
    pub id: String,
    pub gekoppeld: bool,
    pub werkt: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Disconnected {
    /// Is de toegang ook bij de dienst ingetrokken?
    pub ingetrokken: bool,
    pub beheer_url: &'static str,
}

struct Flow {
    cancel: Arc<AtomicBool>,
    display: Display,
}

pub struct Manager {
    providers: Vec<Arc<dyn Provider>>,
    store: Arc<dyn SecretStore>,
    http: Arc<dyn Http>,
    meta: Arc<dyn MetaStore>,
    cfg: Config,
    now: Arc<dyn Fn() -> i64 + Send + Sync>,
    /// Slaap die ook stopt als de inlog wordt geannuleerd (tests geven een lege slaap mee).
    sleep: SleepFn,
    changed: Arc<dyn Fn() + Send + Sync>,
    flows: Mutex<HashMap<String, Flow>>,
    flow_errors: Mutex<HashMap<String, ConnectError>>,
    loopback_timeout: Duration,
}

type SleepFn = Arc<dyn Fn(Duration, &AtomicBool) + Send + Sync>;

pub fn real_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

pub fn real_sleep(d: Duration, cancel: &AtomicBool) {
    let end = std::time::Instant::now() + d;
    while std::time::Instant::now() < end && !cancel.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(200));
    }
}

impl Manager {
    #[allow(clippy::too_many_arguments)]
    pub fn new(providers: Vec<Arc<dyn Provider>>, store: Arc<dyn SecretStore>, http: Arc<dyn Http>, meta: Arc<dyn MetaStore>, cfg: Config, changed: Arc<dyn Fn() + Send + Sync>) -> Arc<Self> {
        Arc::new(Self {
            providers,
            store,
            http,
            meta,
            cfg,
            now: Arc::new(real_now),
            sleep: Arc::new(real_sleep),
            changed,
            flows: Mutex::new(HashMap::new()),
            flow_errors: Mutex::new(HashMap::new()),
            loopback_timeout: loopback::TIMEOUT,
        })
    }

    #[cfg(test)]
    pub fn for_test(mut self: Arc<Self>, now: Arc<dyn Fn() -> i64 + Send + Sync>, sleep: SleepFn, loopback_timeout: Duration) -> Arc<Self> {
        let m = Arc::get_mut(&mut self).expect("nog niet gedeeld");
        m.now = now;
        m.sleep = sleep;
        m.loopback_timeout = loopback_timeout;
        self
    }

    fn provider(&self, id: &str) -> Result<Arc<dyn Provider>, ConnectError> {
        self.providers.iter().find(|p| p.id() == id).cloned().ok_or(ConnectError::UnknownProvider)
    }
    fn vault(&self, id: &str) -> ProviderVault {
        ProviderVault::new(self.store.clone(), id)
    }
    fn now(&self) -> i64 {
        (self.now)()
    }

    /// De inlogmethode die nu geldt: OAuth als de dienst het kent én er een client-ID is ingevuld, anders token plakken.
    pub fn strategy(&self, id: &str) -> Result<Strategy, ConnectError> {
        let p = self.provider(id)?;
        Ok(match (p.oauth(), self.cfg.client_id(id)) {
            (Some(super::provider::OauthKind::Device { .. }), Some(_)) => Strategy::OauthDevice,
            (Some(super::provider::OauthKind::Loopback { .. }), Some(_)) => Strategy::OauthLoopbackPkce,
            _ => Strategy::TokenPlakken,
        })
    }

    pub fn list(&self) -> Vec<Info> {
        self.providers.iter().filter_map(|p| self.info(p.id()).ok()).collect()
    }

    pub fn info(&self, id: &str) -> Result<Info, ConnectError> {
        let p = self.provider(id)?;
        let meta = self.meta.get(id);
        let flows = self.flows.lock().unwrap();
        let bezig = flows.get(id).map(|f| f.display.clone());
        let status = if bezig.is_some() { Status::Bezig } else { meta.as_ref().map(|m| m.status).unwrap_or(Status::NietGekoppeld) };
        let fout = self.flow_errors.lock().unwrap().get(id).map(|e| e.code()).or_else(|| meta.as_ref().and_then(|m| m.error.clone()));
        Ok(Info {
            id: id.to_string(),
            strategie: self.strategy(id)?,
            status,
            account: meta.as_ref().and_then(|m| m.account.clone()),
            fout,
            rechten: p.rights().to_vec(),
            functies: p.functions().to_vec(),
            links: p.links(),
            bezig,
            verloopt: meta.and_then(|m| m.expires_at),
        })
    }

    /// Voor de AI (MCP-tool `koppelingen_status`): alleen gekoppeld ja/nee en werkt ja/nee.
    pub fn ai_status(&self) -> Vec<AiStatus> {
        self.providers
            .iter()
            .map(|p| {
                let s = self.meta.get(p.id()).map(|m| m.status).unwrap_or(Status::NietGekoppeld);
                AiStatus { id: p.id().to_string(), gekoppeld: s != Status::NietGekoppeld, werkt: s == Status::Werkt }
            })
            .collect()
    }

    fn set_flow_error(&self, id: &str, e: Option<ConnectError>) {
        let mut m = self.flow_errors.lock().unwrap();
        match e {
            Some(e) => m.insert(id.to_string(), e),
            None => m.remove(id),
        };
    }

    fn end_flow(&self, id: &str, cancel: &Arc<AtomicBool>) {
        let mut flows = self.flows.lock().unwrap();
        // Alleen weghalen als het nog onze stroom is (een nieuwe start kan eroverheen zijn gegaan).
        if flows.get(id).is_some_and(|f| Arc::ptr_eq(&f.cancel, cancel)) {
            flows.remove(id);
        }
    }

    fn save(&self, id: &str, tokens: &TokenSet, account: &str, method: Strategy) -> Result<(), ConnectError> {
        self.vault(id).set(TOKENS, &serde_json::to_string(tokens).map_err(|_| ConnectError::Unexpected)?)?;
        self.meta.put(&Meta { provider: id.into(), status: Status::Werkt, account: Some(account.into()), error: None, method: Some(method), connected_at: Some(self.now()), expires_at: tokens.expires_at });
        Ok(())
    }

    fn load(&self, id: &str) -> Result<TokenSet, ConnectError> {
        let raw = self.vault(id).get(TOKENS)?.ok_or(ConnectError::NotConnected)?;
        serde_json::from_str(&raw).map_err(|_| ConnectError::NotConnected)
    }

    /// Controleert de toegang bij de dienst en bewaart hem pas daarna. Een ongeldig token komt dus nooit in de kluis.
    fn finish(&self, id: &str, tokens: TokenSet, method: Strategy) -> Result<(), ConnectError> {
        let p = self.provider(id)?;
        let account = p.verify(self.http.as_ref(), &tokens.access)?;
        self.save(id, &tokens, &account.name, method)
    }

    /// Het plakken van een token. Geeft een gewone fout terug bij een ongeldig of onbruikbaar token; het token zelf komt nergens in.
    pub fn paste(&self, id: &str, token: &str) -> Result<Info, ConnectError> {
        self.provider(id)?;
        let t = token.trim();
        if t.is_empty() || t.len() > MAX_TOKEN_LEN || t.chars().any(|c| c.is_whitespace() || c.is_control()) {
            self.set_flow_error(id, Some(ConnectError::Unauthorized));
            return Err(ConnectError::Unauthorized);
        }
        match self.finish(id, TokenSet::plain(t), Strategy::TokenPlakken) {
            Ok(()) => self.set_flow_error(id, None),
            Err(e) => {
                self.set_flow_error(id, Some(e.clone()));
                (self.changed)();
                return Err(e);
            }
        }
        (self.changed)();
        self.info(id)
    }

    pub fn cancel(&self, id: &str) {
        if let Some(f) = self.flows.lock().unwrap().remove(id) {
            f.cancel.store(true, Ordering::SeqCst);
        }
        self.set_flow_error(id, None);
        (self.changed)();
    }

    /// Start de inlog voor een dienst. Voor OAuth draait het wachten op de achtergrond; de app krijgt een melding bij elke verandering.
    pub fn start(self: &Arc<Self>, id: &str) -> Result<StartInfo, ConnectError> {
        let p = self.provider(id)?;
        self.cancel(id);
        match self.strategy(id)? {
            Strategy::TokenPlakken => Ok(StartInfo::Plakken),
            Strategy::OauthDevice => {
                let client = self.cfg.client_id(id).ok_or(ConnectError::Unexpected)?;
                let spec = device_spec(&p.oauth().ok_or(ConnectError::Unexpected)?, client).ok_or(ConnectError::Unexpected)?;
                let dc = device::request_code(self.http.as_ref(), &spec)?;
                let (cancel, info) = (Arc::new(AtomicBool::new(false)), dc.info.clone());
                self.flows.lock().unwrap().insert(id.to_string(), Flow { cancel: cancel.clone(), display: Display::Apparaat(info.clone()) });
                (self.changed)();
                let (me, id) = (self.clone(), id.to_string());
                std::thread::spawn(move || {
                    let c2 = cancel.clone();
                    let result = device::poll(me.http.as_ref(), &spec, &dc, &|| me.now(), &|d| (me.sleep)(d, &c2), &cancel).and_then(|t| me.finish(&id, t, Strategy::OauthDevice));
                    me.done(&id, &cancel, result);
                });
                Ok(StartInfo::Apparaat(info))
            }
            Strategy::OauthLoopbackPkce => {
                let client = self.cfg.client_id(id).ok_or(ConnectError::Unexpected)?;
                let spec = loopback_spec(&p.oauth().ok_or(ConnectError::Unexpected)?, client).ok_or(ConnectError::Unexpected)?;
                let receiver = Receiver::bind(spec.port)?;
                let (pk, state, redirect) = (pkce::new_pkce(), pkce::new_state(), receiver.redirect_uri());
                let url = oauth::authorize_url(&spec, &redirect, &state, &pk.challenge);
                let cancel = Arc::new(AtomicBool::new(false));
                self.flows.lock().unwrap().insert(id.to_string(), Flow { cancel: cancel.clone(), display: Display::Browser { url: url.clone() } });
                (self.changed)();
                let (me, id) = (self.clone(), id.to_string());
                std::thread::spawn(move || {
                    let result = receiver.wait(&state, me.loopback_timeout, &cancel).and_then(|o| match o {
                        Outcome::ServiceError(e) => Err(if e == "access_denied" { ConnectError::Denied } else { ConnectError::Unexpected }),
                        Outcome::Code(c) => oauth::exchange_code(me.http.as_ref(), &spec, &c, &redirect, &pk.verifier, me.now()).and_then(|t| me.finish(&id, t, Strategy::OauthLoopbackPkce)),
                    });
                    me.done(&id, &cancel, result);
                });
                Ok(StartInfo::Browser { url })
            }
        }
    }

    fn done(&self, id: &str, cancel: &Arc<AtomicBool>, result: Result<(), ConnectError>) {
        let cancelled = cancel.load(Ordering::SeqCst);
        self.end_flow(id, cancel);
        if !cancelled {
            self.set_flow_error(id, result.err());
        }
        (self.changed)();
    }

    /// Ververst de toegang van één dienst als dat nodig is. Mislukt dat omdat de toegang niet meer geldt, dan wordt de status "verlopen".
    pub fn refresh(&self, id: &str) -> Result<(), ConnectError> {
        let p = self.provider(id)?;
        let tokens = self.load(id)?;
        let now = self.now();
        if !tokens.needs_refresh(now, REFRESH_MARGIN) {
            return Ok(());
        }
        let (kind, client) = (p.oauth().ok_or(ConnectError::Unexpected)?, self.cfg.client_id(id).ok_or(ConnectError::Unexpected)?);
        let token_url = match &kind {
            super::provider::OauthKind::Device { token_url, .. } | super::provider::OauthKind::Loopback { token_url, .. } => *token_url,
        };
        match oauth::refresh_token(self.http.as_ref(), token_url, client, tokens.refresh.as_deref().unwrap_or(""), now) {
            Ok(new) => {
                self.vault(id).set(TOKENS, &serde_json::to_string(&new).map_err(|_| ConnectError::Unexpected)?)?;
                if let Some(mut m) = self.meta.get(id) {
                    m.status = Status::Werkt;
                    m.error = None;
                    m.expires_at = new.expires_at;
                    self.meta.put(&m);
                }
                (self.changed)();
                Ok(())
            }
            Err(e) => {
                if e.is_auth() {
                    self.mark(id, Status::Verlopen, Some(&e));
                }
                Err(e)
            }
        }
    }

    /// Door de achtergrondtaak elke minuut aangeroepen.
    pub fn refresh_due(&self) {
        for p in &self.providers {
            if self.meta.get(p.id()).is_some_and(|m| m.status == Status::Werkt && m.expires_at.is_some()) {
                let _ = self.refresh(p.id());
            }
        }
    }

    fn mark(&self, id: &str, status: Status, e: Option<&ConnectError>) {
        if let Some(mut m) = self.meta.get(id) {
            m.status = status;
            m.error = e.map(|e| e.code());
            self.meta.put(&m);
            (self.changed)();
        }
    }

    /// De "test"-knop: haalt de account op en werkt de status bij.
    pub fn test(&self, id: &str) -> Result<Info, ConnectError> {
        let p = self.provider(id)?;
        let _ = self.refresh(id);
        let tokens = self.load(id)?;
        match p.verify(self.http.as_ref(), &tokens.access) {
            Ok(acc) => {
                if let Some(mut m) = self.meta.get(id) {
                    m.status = Status::Werkt;
                    m.error = None;
                    m.account = Some(acc.name);
                    self.meta.put(&m);
                }
                (self.changed)();
            }
            Err(e) if e.is_auth() => self.mark(id, Status::Verlopen, Some(&e)),
            Err(e @ ConnectError::Forbidden) => self.mark(id, Status::Fout, Some(&e)),
            Err(e) => {
                // Geen internet, time-out, te veel verzoeken: de status verandert niet, maar de fout is wel te zien.
                self.set_flow_error(id, Some(e));
            }
        }
        self.info(id)
    }

    pub fn test_all(&self) -> Vec<Info> {
        for p in &self.providers {
            if self.meta.get(p.id()).is_some_and(|m| m.status != Status::NietGekoppeld) {
                let _ = self.test(p.id());
            }
        }
        self.list()
    }

    /// Het enige pad waarlangs andere onderdelen van Studio een token mogen gebruiken. Het token blijft binnen de closure.
    #[allow(dead_code)] // het enige pad voor Studio-onderdelen die een token nodig hebben (Supabase, Online zetten)
    pub fn authorized<T>(&self, id: &str, f: impl FnOnce(&dyn Http, &str) -> Result<T, ConnectError>) -> Result<T, ConnectError> {
        let _ = self.refresh(id);
        let tokens = self.load(id)?;
        if tokens.is_expired(self.now()) && tokens.refresh.is_none() {
            self.mark(id, Status::Verlopen, Some(&ConnectError::Expired));
            return Err(ConnectError::Expired);
        }
        match f(self.http.as_ref(), &tokens.access) {
            Err(ConnectError::Unauthorized) => {
                self.mark(id, Status::Verlopen, Some(&ConnectError::Unauthorized));
                Err(ConnectError::Unauthorized)
            }
            other => other,
        }
    }

    pub fn disconnect(&self, id: &str) -> Result<Disconnected, ConnectError> {
        let p = self.provider(id)?;
        self.cancel(id);
        let mut ingetrokken = false;
        if let Ok(tokens) = self.load(id) {
            if let Some(client) = self.cfg.client_id(id) {
                ingetrokken = matches!(p.revoke(self.http.as_ref(), &tokens, client), Revoke::Done);
            }
        }
        self.vault(id).delete(TOKENS)?;
        self.meta.remove(id);
        self.set_flow_error(id, None);
        (self.changed)();
        Ok(Disconnected { ingetrokken, beheer_url: p.links().manage })
    }
}

#[cfg(test)]
mod tests {
    use super::super::http::{MockHttp, Response};
    use super::super::provider::OauthKind;
    use super::super::store::MemMeta;
    use super::super::vault::MemoryStore;
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::atomic::AtomicI64;

    struct Nep {
        oauth: Option<OauthKind>,
    }
    impl Provider for Nep {
        fn id(&self) -> &'static str {
            "nep"
        }
        fn rights(&self) -> &'static [&'static str] {
            &["lezen"]
        }
        fn functions(&self) -> &'static [&'static str] {
            &["iets"]
        }
        fn hosts(&self) -> &'static [&'static str] {
            &["dienst.example"]
        }
        fn links(&self) -> Links {
            Links { signup: "https://dienst.example/signup", token_page: "https://dienst.example/tokens", manage: "https://dienst.example/apps" }
        }
        fn oauth(&self) -> Option<OauthKind> {
            self.oauth.clone()
        }
        fn verify(&self, http: &dyn Http, token: &str) -> Result<super::super::provider::Account, ConnectError> {
            let r = http.send(super::super::http::Request::get("https://dienst.example/me").bearer(token))?;
            match super::super::error::from_status(r.status) {
                Some(e) => Err(e),
                None => Ok(super::super::provider::Account { name: "pieter".into() }),
            }
        }
    }

    const DEVICE: OauthKind = OauthKind::Device { device_url: "https://dienst.example/device", token_url: "https://dienst.example/token", scope: "lezen" };
    const LOOPBACK: OauthKind = OauthKind::Loopback { authorize_url: "https://dienst.example/authorize", token_url: "https://dienst.example/token", scope: "lezen", port: 0 };

    struct Rig {
        m: Arc<Manager>,
        store: Arc<MemoryStore>,
        meta: Arc<MemHandle>,
        http: Arc<MockHttp>,
        wijzigingen: Arc<AtomicI64>,
        tijd: Arc<AtomicI64>,
    }
    struct MemHandle(MemMeta);
    impl MetaStore for MemHandle {
        fn get(&self, p: &str) -> Option<Meta> {
            self.0.get(p)
        }
        fn put(&self, m: &Meta) {
            self.0.put(m)
        }
        fn remove(&self, p: &str) {
            self.0.remove(p)
        }
    }

    fn rig(oauth: Option<OauthKind>, client: Option<&str>, replies: Vec<Result<Response, ConnectError>>) -> Rig {
        let store = Arc::new(MemoryStore::default());
        let meta = Arc::new(MemHandle(MemMeta::default()));
        let http = Arc::new(MockHttp::new(replies));
        let wijzigingen = Arc::new(AtomicI64::new(0));
        let tijd = Arc::new(AtomicI64::new(1_000));
        let w = wijzigingen.clone();
        let cfg = client.map(|c| Config::with("nep", c)).unwrap_or_default();
        let t = tijd.clone();
        let m = Manager::new(vec![Arc::new(Nep { oauth })], store.clone(), http.clone(), meta.clone(), cfg, Arc::new(move || {
            w.fetch_add(1, Ordering::SeqCst);
        }))
        .for_test(Arc::new(move || t.load(Ordering::SeqCst)), Arc::new(|_, _| {}), Duration::from_secs(5));
        Rig { m, store, meta, http, wijzigingen, tijd }
    }

    fn wacht(r: &Rig, mut ok: impl FnMut(&Info) -> bool) -> Info {
        for _ in 0..200 {
            let i = r.m.info("nep").unwrap();
            if ok(&i) {
                return i;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        panic!("time-out in test: {:?}", r.m.info("nep").unwrap());
    }

    fn json(i: &Info) -> String {
        serde_json::to_string(i).unwrap()
    }

    #[test]
    fn terugval_zonder_client_id_of_zonder_oauth() {
        assert_eq!(rig(Some(DEVICE), None, vec![]).m.strategy("nep").unwrap(), Strategy::TokenPlakken);
        assert_eq!(rig(None, Some("cid"), vec![]).m.strategy("nep").unwrap(), Strategy::TokenPlakken);
        assert_eq!(rig(Some(DEVICE), Some("cid"), vec![]).m.strategy("nep").unwrap(), Strategy::OauthDevice);
        assert_eq!(rig(Some(LOOPBACK), Some("cid"), vec![]).m.strategy("nep").unwrap(), Strategy::OauthLoopbackPkce);
        assert!(matches!(rig(Some(DEVICE), None, vec![]).m.start("nep").unwrap(), StartInfo::Plakken));
        assert_eq!(rig(None, None, vec![]).m.strategy("onbekend").err(), Some(ConnectError::UnknownProvider));
    }

    #[test]
    fn plakken_slaagt_bewaart_in_de_kluis_en_toont_nergens_het_token() {
        let r = rig(None, None, vec![MockHttp::ok(200, "{}")]);
        let info = r.m.paste("nep", "  geheim-token-123  ").unwrap();
        assert_eq!((info.status, info.account.as_deref()), (Status::Werkt, Some("pieter")));
        assert!(!json(&info).contains("geheim-token-123"));
        assert!(r.store.get("connect/nep/tokens").unwrap().unwrap().contains("geheim-token-123"));
        assert!(r.meta.get("nep").is_some());
        assert!(!format!("{:?}", r.meta.get("nep")).contains("geheim-token-123"));
        assert!(!format!("{:?}", r.m.ai_status()).contains("pieter"));
        assert!(r.wijzigingen.load(Ordering::SeqCst) > 0);
    }

    #[test]
    fn plakken_met_fouten_bewaart_niets() {
        for (reply, fout) in [
            (MockHttp::ok(401, "{}"), ConnectError::Unauthorized),
            (MockHttp::ok(403, "{}"), ConnectError::Forbidden),
            (MockHttp::ok(429, "{}"), ConnectError::RateLimited),
            (Err(ConnectError::Timeout), ConnectError::Timeout),
            (Err(ConnectError::Offline), ConnectError::Offline),
        ] {
            let r = rig(None, None, vec![reply]);
            assert_eq!(r.m.paste("nep", "token").err(), Some(fout.clone()));
            assert!(r.store.get("connect/nep/tokens").unwrap().is_none(), "{fout:?}");
            assert_eq!(r.m.info("nep").unwrap().status, Status::NietGekoppeld);
            assert_eq!(r.m.info("nep").unwrap().fout, Some(fout.code()));
        }
        let r = rig(None, None, vec![]);
        for slecht in ["", "   ", "met spatie erin", "regel\nonder", &"x".repeat(5000)] {
            assert_eq!(r.m.paste("nep", slecht).err(), Some(ConnectError::Unauthorized));
        }
        assert!(r.http.seen.lock().unwrap().is_empty()); // onzin gaat niet eens het internet op
    }

    #[test]
    fn device_flow_van_begin_tot_eind() {
        let r = rig(
            Some(DEVICE),
            Some("cid"),
            vec![
                MockHttp::ok(200, r#"{"device_code":"DC","user_code":"ABCD-1234","verification_uri":"https://dienst.example/device","expires_in":900,"interval":5}"#),
                MockHttp::ok(200, r#"{"error":"authorization_pending"}"#),
                MockHttp::ok(200, r#"{"access_token":"gho_abc","refresh_token":"ghr_abc","expires_in":28800}"#),
                MockHttp::ok(200, "{}"), // verify
            ],
        );
        let StartInfo::Apparaat(d) = r.m.start("nep").unwrap() else { panic!("apparaat verwacht") };
        assert_eq!(d.user_code, "ABCD-1234");
        let i = wacht(&r, |i| i.status == Status::Werkt);
        assert_eq!(i.account.as_deref(), Some("pieter"));
        assert!(i.bezig.is_none() && i.fout.is_none());
        assert!(!json(&i).contains("gho_abc") && !json(&i).contains("ghr_abc") && !json(&i).contains("\"DC\""));
        assert_eq!(i.verloopt, Some(1_000 + 28_800));
    }

    #[test]
    fn device_flow_geweigerd_en_geannuleerd() {
        let r = rig(Some(DEVICE), Some("cid"), vec![MockHttp::ok(200, r#"{"device_code":"DC","user_code":"X","verification_uri":"https://dienst.example/device","expires_in":900,"interval":5}"#), MockHttp::ok(200, r#"{"error":"access_denied"}"#)]);
        r.m.start("nep").unwrap();
        let i = wacht(&r, |i| i.fout.is_some());
        assert_eq!((i.status, i.fout.as_deref()), (Status::NietGekoppeld, Some("geweigerd")));

        let r = rig(Some(DEVICE), Some("cid"), vec![MockHttp::ok(200, r#"{"device_code":"DC","user_code":"X","verification_uri":"https://dienst.example/device","expires_in":900,"interval":5}"#)]);
        r.m.start("nep").unwrap();
        r.m.cancel("nep");
        std::thread::sleep(Duration::from_millis(100));
        let i = r.m.info("nep").unwrap();
        assert!(i.bezig.is_none() && i.fout.is_none() && i.status == Status::NietGekoppeld);
    }

    fn query_param(url: &str, key: &str) -> String {
        let q = url.split_once('?').unwrap().1;
        let v = q.split('&').find_map(|p| p.strip_prefix(&format!("{key}="))).unwrap();
        let mut out = String::new();
        let b = v.as_bytes();
        let mut i = 0;
        while i < b.len() {
            if b[i] == b'%' {
                out.push(u8::from_str_radix(&v[i + 1..i + 3], 16).unwrap() as char);
                i += 3;
            } else {
                out.push(b[i] as char);
                i += 1;
            }
        }
        out
    }

    fn terugkeer(redirect: &str, query: &str) -> String {
        let port: u16 = redirect.rsplit(':').next().unwrap().split('/').next().unwrap().parse().unwrap();
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET /callback?{query} HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        out
    }

    #[test]
    fn loopback_flow_met_pkce_van_begin_tot_eind() {
        let r = rig(Some(LOOPBACK), Some("cid"), vec![MockHttp::ok(200, r#"{"access_token":"at","refresh_token":"rt","expires_in":3600}"#), MockHttp::ok(200, "{}")]);
        let StartInfo::Browser { url } = r.m.start("nep").unwrap() else { panic!("browser verwacht") };
        assert!(url.contains("code_challenge_method=S256"));
        let (state, redirect) = (query_param(&url, "state"), query_param(&url, "redirect_uri"));
        assert!(redirect.starts_with("http://127.0.0.1:"));
        let pagina = terugkeer(&redirect, &format!("code=CODE&state={state}"));
        assert!(pagina.contains("terug naar Studio"));
        let i = wacht(&r, |i| i.status == Status::Werkt);
        assert_eq!(i.account.as_deref(), Some("pieter"));
        // De challenge ging mee naar de dienst, de verifier alleen bij het inwisselen.
        assert_eq!(r.http.seen.lock().unwrap().len(), 2);
        assert!(!json(&i).contains("\"at\"") && !json(&i).contains("\"rt\""));
    }

    #[test]
    fn loopback_foute_state_tweede_terugkeer_en_geweigerd() {
        let r = rig(Some(LOOPBACK), Some("cid"), vec![MockHttp::ok(200, r#"{"access_token":"at"}"#), MockHttp::ok(200, "{}")]);
        let StartInfo::Browser { url } = r.m.start("nep").unwrap() else { panic!() };
        let (state, redirect) = (query_param(&url, "state"), query_param(&url, "redirect_uri"));
        assert!(terugkeer(&redirect, "code=AANVAL&state=fout").starts_with("HTTP/1.1 400"));
        assert_eq!(r.m.info("nep").unwrap().status, Status::Bezig); // de aanval zet niets in gang
        terugkeer(&redirect, &format!("code=ECHT&state={state}"));
        wacht(&r, |i| i.status == Status::Werkt);
        let port: u16 = redirect.rsplit(':').next().unwrap().split('/').next().unwrap().parse().unwrap();
        assert!(TcpStream::connect(("127.0.0.1", port)).is_err(), "poort moet dicht zijn na gebruik");

        let r = rig(Some(LOOPBACK), Some("cid"), vec![]);
        let StartInfo::Browser { url } = r.m.start("nep").unwrap() else { panic!() };
        terugkeer(&query_param(&url, "redirect_uri"), &format!("error=access_denied&state={}", query_param(&url, "state")));
        let i = wacht(&r, |i| i.fout.is_some());
        assert_eq!(i.fout.as_deref(), Some("geweigerd"));
    }

    #[test]
    fn loopback_time_out() {
        let r = rig(Some(LOOPBACK), Some("cid"), vec![]);
        let r = Rig { m: r.m.clone().for_test_clone(Duration::from_millis(200)), ..r };
        r.m.start("nep").unwrap();
        let i = wacht(&r, |i| i.fout.is_some());
        assert_eq!(i.fout.as_deref(), Some("time_out"));
    }

    impl Manager {
        fn for_test_clone(self: Arc<Self>, timeout: Duration) -> Arc<Self> {
            // Voor de time-out-test: een nieuwe beheerder met dezelfde onderdelen en een korte wachttijd.
            Arc::new(Manager {
                providers: self.providers.clone(),
                store: self.store.clone(),
                http: self.http.clone(),
                meta: self.meta.clone(),
                cfg: self.cfg.clone(),
                now: self.now.clone(),
                sleep: self.sleep.clone(),
                changed: self.changed.clone(),
                flows: Mutex::new(HashMap::new()),
                flow_errors: Mutex::new(HashMap::new()),
                loopback_timeout: timeout,
            })
        }
    }

    fn verbonden(r: &Rig, expires_in: i64) {
        r.store.set("connect/nep/tokens", &serde_json::to_string(&TokenSet { access: "oud".into(), refresh: Some("rt".into()), expires_at: Some(r.tijd.load(Ordering::SeqCst) + expires_in) }).unwrap()).unwrap();
        r.meta.put(&Meta { provider: "nep".into(), status: Status::Werkt, account: Some("pieter".into()), error: None, method: Some(Strategy::OauthDevice), connected_at: Some(1), expires_at: Some(r.tijd.load(Ordering::SeqCst) + expires_in) });
    }

    #[test]
    fn verversen_slaagt_automatisch_als_het_bijna_verloopt() {
        let r = rig(Some(DEVICE), Some("cid"), vec![MockHttp::ok(200, r#"{"access_token":"nieuw","refresh_token":"rt2","expires_in":28800}"#)]);
        verbonden(&r, 100); // minder dan de marge
        r.m.refresh_due();
        let t: TokenSet = serde_json::from_str(&r.store.get("connect/nep/tokens").unwrap().unwrap()).unwrap();
        assert_eq!((t.access.as_str(), t.refresh.as_deref()), ("nieuw", Some("rt2")));
        assert_eq!(r.m.info("nep").unwrap().status, Status::Werkt);
        // Nog ruim geldig: niets doen.
        let r = rig(Some(DEVICE), Some("cid"), vec![]);
        verbonden(&r, 10_000);
        r.m.refresh_due();
        assert!(r.http.seen.lock().unwrap().is_empty());
    }

    #[test]
    fn verversen_faalt_dan_verlopen_met_opnieuw_verbinden_en_offline_blijft_werkend() {
        let r = rig(Some(DEVICE), Some("cid"), vec![MockHttp::ok(200, r#"{"error":"bad_refresh_token"}"#)]);
        verbonden(&r, 10);
        r.m.refresh_due();
        let i = r.m.info("nep").unwrap();
        assert_eq!((i.status, i.fout.as_deref()), (Status::Verlopen, Some("verlopen")));

        let r = rig(Some(DEVICE), Some("cid"), vec![Err(ConnectError::Offline)]);
        verbonden(&r, 10);
        r.m.refresh_due();
        assert_eq!(r.m.info("nep").unwrap().status, Status::Werkt); // geen internet is geen verlopen sleutel
    }

    #[test]
    fn testen_en_gebruik_door_tools_vertalen_401_naar_verlopen_zonder_het_token_te_tonen() {
        let r = rig(None, None, vec![MockHttp::ok(200, "{}"), MockHttp::ok(401, "{}")]);
        r.m.paste("nep", "tok").unwrap();
        let fout = r.m.test("nep").unwrap();
        assert_eq!(fout.status, Status::Verlopen);

        let r = rig(None, None, vec![MockHttp::ok(200, "{}")]);
        r.m.paste("nep", "tok").unwrap();
        let mut gezien = String::new();
        let res = r.m.authorized("nep", |_, t| {
            gezien = t.to_string();
            Err::<(), _>(ConnectError::Unauthorized)
        });
        assert_eq!((res.err(), gezien.as_str()), (Some(ConnectError::Unauthorized), "tok"));
        assert_eq!(r.m.info("nep").unwrap().status, Status::Verlopen);
        // Zonder koppeling: duidelijke fout.
        let r = rig(None, None, vec![]);
        assert_eq!(r.m.authorized("nep", |_, _| Ok(())).err(), Some(ConnectError::NotConnected));
    }

    #[test]
    fn ontkoppelen_leegt_de_kluis_en_zegt_waar_de_gebruiker_zelf_kan_intrekken() {
        let r = rig(None, None, vec![MockHttp::ok(200, "{}")]);
        r.m.paste("nep", "tok").unwrap();
        let d = r.m.disconnect("nep").unwrap();
        assert!(!d.ingetrokken);
        assert_eq!(d.beheer_url, "https://dienst.example/apps");
        assert!(r.store.get("connect/nep/tokens").unwrap().is_none());
        assert_eq!(r.m.info("nep").unwrap().status, Status::NietGekoppeld);
        assert!(r.m.ai_status().iter().all(|s| !s.gekoppeld));
    }

    #[test]
    fn de_ai_ziet_alleen_gekoppeld_en_werkt() {
        let r = rig(None, None, vec![MockHttp::ok(200, "{}")]);
        r.m.paste("nep", "tok").unwrap();
        let s = serde_json::to_string(&r.m.ai_status()).unwrap();
        assert_eq!(s, r#"[{"id":"nep","gekoppeld":true,"werkt":true}]"#);
    }
}
