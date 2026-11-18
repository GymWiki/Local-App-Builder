//! De lokale ontvanger voor OAuth met een terugkeeradres op de eigen computer.
//! Luistert alleen op 127.0.0.1, accepteert precies één geldige terugkeer (met de juiste `state`), toont een vriendelijke pagina
//! en sluit daarna meteen. Een tweede terugkeer, een foute `state` of een andere pagina wordt geweigerd.
use super::error::ConnectError;
use super::pkce;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub const CALLBACK_PATH: &str = "/callback";
pub const TIMEOUT: Duration = Duration::from_secs(300);

pub struct Receiver {
    listener: TcpListener,
    pub port: u16,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Code(String),
    /// De dienst meldde een fout (bijvoorbeeld `access_denied`).
    ServiceError(String),
}

impl Receiver {
    /// Bindt op 127.0.0.1. `port` 0 = een willekeurige vrije poort; anders een vaste (dan is "poort bezet" een duidelijke fout).
    pub fn bind(port: u16) -> Result<Self, ConnectError> {
        let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, port))).map_err(|_| ConnectError::PortBusy)?;
        listener.set_nonblocking(true).map_err(|_| ConnectError::Unexpected)?;
        let port = listener.local_addr().map_err(|_| ConnectError::Unexpected)?.port();
        Ok(Self { listener, port })
    }

    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}{}", self.port, CALLBACK_PATH)
    }

    /// Wacht op de terugkeer. Stopt bij annuleren of na de time-out. De poort is vrij zodra de ontvanger wordt weggegooid.
    pub fn wait(self, expected_state: &str, timeout: Duration, cancel: &AtomicBool) -> Result<Outcome, ConnectError> {
        let deadline = Instant::now() + timeout;
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err(ConnectError::Cancelled);
            }
            if Instant::now() >= deadline {
                return Err(ConnectError::Timeout);
            }
            match self.listener.accept() {
                Ok((stream, peer)) => {
                    if !peer.ip().is_loopback() {
                        continue; // kan niet gebeuren op 127.0.0.1, maar voor de zekerheid
                    }
                    // Op sommige systemen (macOS, Windows) erft de verbinding "niet-blokkerend" van de luisteraar: expliciet uitzetten.
                    let _ = stream.set_nonblocking(false);
                    if let Some(outcome) = handle(stream, expected_state) {
                        return Ok(outcome);
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(40)),
                Err(_) => return Err(ConnectError::Unexpected),
            }
        }
    }
}

const PAGE_OK: &str = "<!doctype html><html lang=\"nl\"><meta charset=\"utf-8\"><title>Studio</title><body style=\"font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem\"><h1>Gelukt</h1><p>Je kunt dit venster sluiten en terug naar Studio.</p></body></html>";
const PAGE_FOUT: &str = "<!doctype html><html lang=\"nl\"><meta charset=\"utf-8\"><title>Studio</title><body style=\"font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem\"><h1>Dit is niet gelukt</h1><p>Sluit dit venster en probeer het in Studio opnieuw.</p></body></html>";

fn reply(stream: &mut TcpStream, status: &str, body: &str) {
    let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{body}", body.len());
    let _ = stream.flush();
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    out.push(v);
                    i += 3;
                    continue;
                }
                out.push(b'%');
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Verwerkt één verbinding. `Some` = de definitieve terugkeer (de ontvanger sluit); `None` = negeren en doorwachten.
fn handle(mut stream: TcpStream, expected_state: &str) -> Option<Outcome> {
    // Een browser opent soms alvast een lege verbinding: kort wachten, dan doorgaan met de echte.
    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
    let mut buf = [0u8; 4096];
    let mut n = 0;
    while n < buf.len() && !buf[..n].windows(4).any(|w| w == b"\r\n\r\n") {
        match stream.read(&mut buf[n..]) {
            Ok(0) | Err(_) => break,
            Ok(k) => n += k,
        }
    }
    if n == 0 {
        return None;
    }
    let head = String::from_utf8_lossy(&buf[..n]).into_owned();
    let line = head.lines().next().unwrap_or("");
    let mut parts = line.split_whitespace();
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    if method != "GET" {
        reply(&mut stream, "405 Method Not Allowed", PAGE_FOUT);
        return None;
    }
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != CALLBACK_PATH {
        reply(&mut stream, "404 Not Found", PAGE_FOUT);
        return None;
    }
    let mut code = None;
    let mut state = None;
    let mut error = None;
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        match k {
            "code" => code = Some(percent_decode(v)),
            "state" => state = Some(percent_decode(v)),
            "error" => error = Some(percent_decode(v)),
            _ => {}
        }
    }
    // Zonder de juiste state is dit niet onze terugkeer (mogelijk een aanval): negeren, niet afbreken.
    if !state.as_deref().is_some_and(|s| pkce::same(s, expected_state)) {
        reply(&mut stream, "400 Bad Request", PAGE_FOUT);
        return None;
    }
    if let Some(e) = error {
        reply(&mut stream, "200 OK", PAGE_FOUT);
        return Some(Outcome::ServiceError(e));
    }
    match code.filter(|c| !c.is_empty() && c.len() <= 2048) {
        Some(c) => {
            reply(&mut stream, "200 OK", PAGE_OK);
            Some(Outcome::Code(c))
        }
        None => {
            reply(&mut stream, "400 Bad Request", PAGE_FOUT);
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn get(port: u16, target: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        out
    }

    fn start(state: &'static str, timeout: Duration) -> (u16, Arc<AtomicBool>, std::thread::JoinHandle<Result<Outcome, ConnectError>>) {
        let r = Receiver::bind(0).unwrap();
        let (port, cancel) = (r.port, Arc::new(AtomicBool::new(false)));
        let c = cancel.clone();
        (port, cancel, std::thread::spawn(move || r.wait(state, timeout, &c)))
    }

    #[test]
    fn luistert_alleen_op_127_0_0_1() {
        let r = Receiver::bind(0).unwrap();
        assert!(r.listener.local_addr().unwrap().ip().is_loopback());
        assert!(r.redirect_uri().starts_with("http://127.0.0.1:"));
    }

    #[test]
    fn juiste_terugkeer_geeft_de_code_en_een_vriendelijke_pagina() {
        let (port, _c, h) = start("abc", Duration::from_secs(5));
        let pagina = get(port, "/callback?code=XYZ%2B1&state=abc");
        assert!(pagina.contains("Je kunt dit venster sluiten en terug naar Studio"));
        assert_eq!(h.join().unwrap().unwrap(), Outcome::Code("XYZ+1".into()));
    }

    #[test]
    fn foute_state_wordt_genegeerd_en_daarna_kan_de_echte_terugkeer_nog() {
        let (port, _c, h) = start("goed", Duration::from_secs(5));
        let slecht = get(port, "/callback?code=AANVAL&state=fout");
        assert!(slecht.starts_with("HTTP/1.1 400"));
        assert!(get(port, "/callback?code=AANVAL").starts_with("HTTP/1.1 400")); // zonder state ook niet
        assert!(get(port, "/ergens-anders?state=goed&code=x").starts_with("HTTP/1.1 404"));
        get(port, "/callback?code=ECHT&state=goed");
        assert_eq!(h.join().unwrap().unwrap(), Outcome::Code("ECHT".into()));
    }

    #[test]
    fn precies_een_terugkeer_daarna_is_de_poort_dicht() {
        let (port, _c, h) = start("s", Duration::from_secs(5));
        get(port, "/callback?code=EEN&state=s");
        assert_eq!(h.join().unwrap().unwrap(), Outcome::Code("EEN".into()));
        // De ontvanger is weggegooid: een tweede terugkeer kan niet meer verbinden.
        assert!(TcpStream::connect(("127.0.0.1", port)).is_err());
    }

    #[test]
    fn een_lege_voorverbinding_van_de_browser_houdt_de_echte_terugkeer_niet_tegen() {
        let (port, _c, h) = start("s", Duration::from_secs(5));
        let _stil = TcpStream::connect(("127.0.0.1", port)).unwrap(); // stuurt niets
        get(port, "/callback?code=OK&state=s");
        assert_eq!(h.join().unwrap().unwrap(), Outcome::Code("OK".into()));
    }

    #[test]
    fn de_dienst_kan_weigeren() {
        let (port, _c, h) = start("s", Duration::from_secs(5));
        get(port, "/callback?error=access_denied&state=s");
        assert_eq!(h.join().unwrap().unwrap(), Outcome::ServiceError("access_denied".into()));
    }

    #[test]
    fn time_out_en_annuleren_sluiten_de_ontvanger() {
        let (port, _c, h) = start("s", Duration::from_millis(150));
        assert_eq!(h.join().unwrap().unwrap_err(), ConnectError::Timeout);
        assert!(TcpStream::connect(("127.0.0.1", port)).is_err());
        let (_p, cancel, h) = start("s", Duration::from_secs(5));
        cancel.store(true, Ordering::SeqCst);
        assert_eq!(h.join().unwrap().unwrap_err(), ConnectError::Cancelled);
    }

    #[test]
    fn een_bezette_vaste_poort_is_een_duidelijke_fout() {
        let r = Receiver::bind(0).unwrap();
        assert_eq!(Receiver::bind(r.port).err(), Some(ConnectError::PortBusy));
    }

    #[test]
    fn percent_decode_werkt() {
        assert_eq!(percent_decode("a%20b+c%2"), "a b c%2");
        assert_eq!(percent_decode("%zz"), "%zz");
    }
}
