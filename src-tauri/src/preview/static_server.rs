//! Ingebouwde statische server met live reload. Luistert alleen op 127.0.0.1, zonder Node.js.
//!
//! - Serveert alleen binnen de projectmap (geen `..`, geen symlinks naar buiten, geen dotfiles zoals `.env`/`.git`).
//! - Plakt in HTML een klein script dat via Server-Sent Events luistert en de pagina herlaadt.
use crate::error::{AppError, Result};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const MAX_CONNECTIONS: usize = 64;
const MAX_SSE_CLIENTS: usize = 32;
const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_HEAD_BYTES: usize = 16 * 1024;
pub const RELOAD_SCRIPT_PATH: &str = "/__studio/reload.js";
pub const EVENTS_PATH: &str = "/__studio/events";

const RELOAD_JS: &str = "(function(){try{var es=new EventSource('/__studio/events');es.addEventListener('reload',function(){location.reload()});}catch(e){}})();";
const INJECT: &str = "<script src=\"/__studio/reload.js\"></script>";

struct Shared {
    root: PathBuf,
    port: u16,
    stop: AtomicBool,
    active: AtomicUsize,
    clients: Mutex<Vec<TcpStream>>,
}

pub struct StaticServer {
    shared: Arc<Shared>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl StaticServer {
    /// `port` 0 = willekeurige vrije poort. Een bezette poort geeft een duidelijke fout.
    pub fn start(root: &Path, port: u16) -> Result<Self> {
        let root = root
            .canonicalize()
            .map_err(|e| AppError::Invalid(format!("Map niet gevonden: {e}")))?;
        let listener =
            TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))).map_err(|e| {
                if e.kind() == std::io::ErrorKind::AddrInUse {
                    AppError::Invalid(format!(
                        "Poort {port} is al in gebruik door een ander programma."
                    ))
                } else {
                    AppError::Invalid(format!("Kon de statische server niet starten: {e}"))
                }
            })?;
        let port = listener.local_addr()?.port();
        let shared = Arc::new(Shared {
            root,
            port,
            stop: AtomicBool::new(false),
            active: AtomicUsize::new(0),
            clients: Mutex::new(Vec::new()),
        });
        let s2 = shared.clone();
        let thread = std::thread::spawn(move || {
            for stream in listener.incoming() {
                if s2.stop.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(stream) = stream else { continue };
                if s2.active.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
                    let _ = respond(
                        &stream,
                        503,
                        "Service Unavailable",
                        "text/plain",
                        b"te druk",
                        false,
                    );
                    continue;
                }
                s2.active.fetch_add(1, Ordering::SeqCst);
                let s3 = s2.clone();
                std::thread::spawn(move || {
                    let _ = handle(stream, &s3);
                    s3.active.fetch_sub(1, Ordering::SeqCst);
                });
            }
        });
        Ok(Self {
            shared,
            thread: Some(thread),
        })
    }

    #[cfg(test)]
    pub fn port(&self) -> u16 {
        self.shared.port
    }

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/", self.shared.port)
    }

    /// Laat alle open pagina's herladen.
    pub fn reload(&self) {
        let mut clients = self.shared.clients.lock().unwrap();
        clients.retain_mut(|c| {
            c.write_all(b"event: reload\ndata: 1\n\n")
                .and_then(|_| c.flush())
                .is_ok()
        });
    }

    #[cfg(test)]
    pub fn client_count(&self) -> usize {
        self.shared.clients.lock().unwrap().len()
    }

    /// Stopt de server en sluit alle verbindingen. Daarna is de poort weer vrij.
    pub fn stop(&mut self) {
        self.shared.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect_timeout(
            &SocketAddr::from(([127, 0, 0, 1], self.shared.port)),
            Duration::from_millis(500),
        );
        for c in self.shared.clients.lock().unwrap().drain(..) {
            let _ = c.shutdown(Shutdown::Both);
        }
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for StaticServer {
    fn drop(&mut self) {
        self.stop();
    }
}

fn respond(
    mut s: &TcpStream,
    code: u16,
    reason: &str,
    mime: &str,
    body: &[u8],
    head_only: bool,
) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        body.len()
    );
    s.write_all(head.as_bytes())?;
    if !head_only {
        s.write_all(body)?;
    }
    s.flush()
}

fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .as_deref()
    {
        Some("html") | Some("htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
        Some("json") | Some("map") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("txt") | Some("md") => "text/plain; charset=utf-8",
        Some("xml") => "application/xml; charset=utf-8",
        Some("wasm") => "application/wasm",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    }
}

/// Vertaalt een URL-pad naar een bestand binnen `root`. `None` = niet toegestaan of niet gevonden.
pub fn resolve(root: &Path, url_path: &str) -> Option<PathBuf> {
    let path = url_path.split(['?', '#']).next().unwrap_or("");
    let decoded = percent_decode(path)?;
    if decoded.contains('\0') || decoded.contains('\\') || !decoded.starts_with('/') {
        return None;
    }
    let mut full = root.to_path_buf();
    for seg in decoded.split('/') {
        match seg {
            "" | "." => {}
            ".." => return None,
            s if s.starts_with('.') => return None, // .env, .git, .claude, …
            s => full.push(s),
        }
    }
    if full.is_dir() {
        full.push("index.html");
    }
    let real = full.canonicalize().ok()?;
    (real.starts_with(root) && real.is_file()).then_some(real)
}

fn handle(stream: TcpStream, sh: &Shared) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(10)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut head = Vec::new();
    let mut host = String::new();
    let mut request_line = String::new();
    loop {
        let mut line = String::new();
        let n = reader
            .by_ref()
            .take((MAX_HEAD_BYTES - head.len().min(MAX_HEAD_BYTES - 1)) as u64)
            .read_line(&mut line)?;
        if n == 0 {
            return Ok(());
        }
        head.extend_from_slice(line.as_bytes());
        if head.len() >= MAX_HEAD_BYTES {
            return respond(
                &stream,
                431,
                "Request Header Fields Too Large",
                "text/plain",
                b"te groot",
                false,
            );
        }
        if request_line.is_empty() {
            request_line = line.trim_end().to_string();
        } else if line.trim().is_empty() {
            break;
        } else if let Some(v) = line.to_lowercase().strip_prefix("host:") {
            host = v.trim().to_string();
        }
    }
    let mut parts = request_line.split_whitespace();
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or("/"));
    let head_only = method == "HEAD";
    if method != "GET" && !head_only {
        return respond(
            &stream,
            405,
            "Method Not Allowed",
            "text/plain",
            b"alleen GET",
            false,
        );
    }
    // Bescherming tegen DNS-rebinding: alleen onze eigen loopback-hostnamen.
    let ok_host =
        host == format!("127.0.0.1:{}", sh.port) || host == format!("localhost:{}", sh.port);
    if !ok_host {
        return respond(
            &stream,
            403,
            "Forbidden",
            "text/plain",
            b"ongeldige host",
            false,
        );
    }
    let route = target.split(['?', '#']).next().unwrap_or("");
    if route == RELOAD_SCRIPT_PATH {
        return respond(
            &stream,
            200,
            "OK",
            "text/javascript; charset=utf-8",
            RELOAD_JS.as_bytes(),
            head_only,
        );
    }
    if route == EVENTS_PATH {
        let mut clients = sh.clients.lock().unwrap();
        if clients.len() >= MAX_SSE_CLIENTS {
            drop(clients);
            return respond(
                &stream,
                503,
                "Service Unavailable",
                "text/plain",
                b"te veel luisteraars",
                false,
            );
        }
        let mut s = stream.try_clone()?;
        s.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n: ok\n\n")?;
        s.flush()?;
        s.set_read_timeout(None)?;
        clients.push(s);
        return Ok(());
    }
    match resolve(&sh.root, target) {
        None => respond(&stream, 404, "Not Found", "text/html; charset=utf-8", "<!doctype html><meta charset=utf-8><title>404</title><body style=\"font-family:system-ui;padding:2rem\"><h1>404</h1><p>Bestand niet gevonden in de preview.</p>".as_bytes(), head_only),
        Some(file) => {
            if file.metadata().map(|m| m.len()).unwrap_or(0) > MAX_FILE_BYTES {
                return respond(&stream, 413, "Payload Too Large", "text/plain", b"te groot", false);
            }
            let mut body = std::fs::read(&file)?;
            let mime = mime_for(&file);
            if mime.starts_with("text/html") {
                body = inject(&body);
            }
            respond(&stream, 200, "OK", mime, &body, head_only)
        }
    }
}

/// Zet het reload-script vlak vóór de laatste `</body>` (of anders achteraan).
pub fn inject(html: &[u8]) -> Vec<u8> {
    let lower: Vec<u8> = html.iter().map(u8::to_ascii_lowercase).collect();
    let pos = lower
        .windows(7)
        .rposition(|w| w == b"</body>")
        .unwrap_or(html.len());
    let mut out = Vec::with_capacity(html.len() + INJECT.len());
    out.extend_from_slice(&html[..pos]);
    out.extend_from_slice(INJECT.as_bytes());
    out.extend_from_slice(&html[pos..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn get(port: u16, path: &str) -> String {
        get_with_host(port, path, &format!("127.0.0.1:{port}"))
    }

    fn get_with_host(port: u16, path: &str, host: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        write!(
            s,
            "GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"
        )
        .unwrap();
        let mut out = Vec::new();
        let _ = s.read_to_end(&mut out);
        String::from_utf8_lossy(&out).to_string()
    }

    fn project() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        fs::write(
            d.path().join("index.html"),
            "<html><body><h1>Hallo Studio</h1></body></html>",
        )
        .unwrap();
        fs::write(d.path().join("app.css"), "h1{color:red}").unwrap();
        fs::write(d.path().join(".env"), "SECRET=1").unwrap();
        fs::create_dir(d.path().join("sub")).unwrap();
        fs::write(d.path().join("sub/index.html"), "<p>sub</p>").unwrap();
        d
    }

    #[test]
    fn serveert_bestanden_met_juiste_mime_en_injecteert_reload_script_in_html() {
        let d = project();
        let srv = StaticServer::start(d.path(), 0).unwrap();
        let r = get(srv.port(), "/");
        assert!(r.starts_with("HTTP/1.1 200"), "{r}");
        assert!(
            r.contains("Hallo Studio") && r.contains("/__studio/reload.js"),
            "{r}"
        );
        assert!(r.contains("text/html"));
        let body_pos = r.find("<script src").unwrap();
        assert!(
            body_pos < r.find("</body>").unwrap(),
            "script hoort vóór </body>"
        );

        let css = get(srv.port(), "/app.css");
        assert!(css.contains("text/css") && css.contains("color:red") && !css.contains("__studio"));
        assert!(get(srv.port(), "/sub/").contains("<p>sub</p>"));
        assert!(get(srv.port(), "/__studio/reload.js").contains("EventSource"));
        assert!(get(srv.port(), "/nope.html").starts_with("HTTP/1.1 404"));
    }

    #[test]
    fn luistert_alleen_op_loopback_en_poort_komt_vrij_na_stop() {
        let d = project();
        let mut srv = StaticServer::start(d.path(), 0).unwrap();
        let port = srv.port();
        assert!(srv.url().starts_with("http://127.0.0.1:"));
        assert!(TcpStream::connect(("127.0.0.1", port)).is_ok());
        srv.stop();
        assert!(TcpStream::connect_timeout(
            &SocketAddr::from(([127, 0, 0, 1], port)),
            Duration::from_millis(300)
        )
        .is_err());
        // opnieuw te binden = poort is echt vrij
        assert!(TcpListener::bind(("127.0.0.1", port)).is_ok());
    }

    #[test]
    fn blokkeert_traversal_dotfiles_symlinks_en_vreemde_hosts() {
        let d = project();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("geheim.txt"), "buiten").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), d.path().join("link")).unwrap();
        let srv = StaticServer::start(d.path(), 0).unwrap();
        for p in [
            "/../x",
            "/%2e%2e/x",
            "/sub/../../x",
            "/.env",
            "/%2eenv",
            "/.git/config",
            "/a%00b",
            "/sub%5c..%5c..",
            "/link/geheim.txt",
        ] {
            let r = get(srv.port(), p);
            assert!(r.starts_with("HTTP/1.1 404"), "{p}: {r}");
            assert!(!r.contains("SECRET") && !r.contains("buiten"), "{p}");
        }
        assert!(get_with_host(srv.port(), "/", "evil.example").starts_with("HTTP/1.1 403"));
        let mut s = TcpStream::connect(("127.0.0.1", srv.port())).unwrap();
        write!(
            s,
            "POST / HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Length: 0\r\n\r\n",
            srv.port()
        )
        .unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        assert!(out.starts_with("HTTP/1.1 405"));
    }

    #[test]
    fn bezette_poort_geeft_duidelijke_fout() {
        let d = project();
        let busy = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = busy.local_addr().unwrap().port();
        let e = StaticServer::start(d.path(), port)
            .err()
            .unwrap()
            .to_string();
        assert!(
            e.contains(&port.to_string()) && e.contains("al in gebruik"),
            "{e}"
        );
    }

    #[test]
    fn live_reload_stuurt_een_event_naar_verbonden_pagina_s() {
        let d = project();
        let srv = StaticServer::start(d.path(), 0).unwrap();
        let mut c = TcpStream::connect(("127.0.0.1", srv.port())).unwrap();
        c.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        write!(
            c,
            "GET {EVENTS_PATH} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n\r\n",
            srv.port()
        )
        .unwrap();
        let t = std::time::Instant::now();
        while srv.client_count() == 0 && t.elapsed() < Duration::from_secs(3) {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(srv.client_count(), 1);
        srv.reload();
        let mut buf = vec![0u8; 512];
        let mut got = String::new();
        while !got.contains("event: reload") {
            let n = c.read(&mut buf).unwrap();
            assert!(n > 0, "verbinding gesloten: {got}");
            got.push_str(&String::from_utf8_lossy(&buf[..n]));
        }
        assert!(got.contains("text/event-stream"));
        drop(c);
        // een weggevallen client wordt bij de volgende reload opgeruimd
        srv.reload();
        srv.reload();
        assert_eq!(srv.client_count(), 0);
    }

    #[test]
    fn injectie_werkt_zonder_body_tag_en_is_hoofdletterongevoelig() {
        assert!(String::from_utf8(inject(b"<P>x</P>"))
            .unwrap()
            .ends_with("</script>"));
        let s = String::from_utf8(inject(b"<BODY>a</BODY>")).unwrap();
        assert!(s.ends_with("</BODY>") && s.contains("<script"));
    }

    #[test]
    fn head_request_geeft_headers_zonder_body() {
        let d = project();
        let srv = StaticServer::start(d.path(), 0).unwrap();
        let mut s = TcpStream::connect(("127.0.0.1", srv.port())).unwrap();
        write!(
            s,
            "HEAD / HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
            srv.port()
        )
        .unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        assert!(out.starts_with("HTTP/1.1 200") && !out.contains("Hallo Studio"));
    }
}
