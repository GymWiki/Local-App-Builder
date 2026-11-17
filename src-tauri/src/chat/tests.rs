use super::*;
use crate::{db, projects};
use std::time::{Duration, Instant};

struct H {
    mgr: ChatManager,
    out: Arc<Mutex<Vec<ChatOut>>>,
    answers: Arc<Mutex<Vec<(i64, String, bool)>>>,
    deny_messages: Arc<Mutex<Vec<String>>>,
    store: Arc<ConnStore>,
    project: i64,
    dir: tempfile::TempDir,
}

fn harness() -> H {
    let conn = db::open_in_memory().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let p = projects::create(&conn, "P", dir.path(), "leeg").unwrap();
    let store = Arc::new(ConnStore(Mutex::new(conn)));
    let out: Arc<Mutex<Vec<ChatOut>>> = Arc::default();
    let answers: Arc<Mutex<Vec<(i64, String, bool)>>> = Arc::default();
    let deny_messages: Arc<Mutex<Vec<String>>> = Arc::default();
    let (o, a, dm) = (out.clone(), answers.clone(), deny_messages.clone());
    let mgr = ChatManager::new(
        store.clone(),
        Arc::new(move |e| o.lock().unwrap().push(e)),
        Arc::new(move |p, id, allow, msg: Option<&str>| {
            a.lock().unwrap().push((p, id.to_string(), allow));
            if let Some(m) = msg {
                dm.lock().unwrap().push(m.to_string());
            }
            Ok(())
        }),
    );
    H {
        mgr,
        out,
        answers,
        deny_messages,
        store,
        project: p.id,
        dir,
    }
}

fn wait_for(what: &str, f: impl Fn() -> bool) {
    let t = Instant::now();
    while t.elapsed() < Duration::from_secs(10) {
        if f() {
            return;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    panic!("time-out: {what}");
}

fn kinds(h: &H) -> Vec<String> {
    store::history(&h.store.0.lock().unwrap(), h.project, 100)
        .unwrap()
        .iter()
        .map(|m| m.kind.clone())
        .collect()
}

fn history(h: &H) -> Vec<StoredMessage> {
    store::history(&h.store.0.lock().unwrap(), h.project, 100).unwrap()
}

#[cfg(unix)]
fn fake_claude(dir: &Path) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let p = dir.join("claude");
    std::fs::write(
        &p,
        r#"#!/bin/sh
echo "$@" >> "$FAKE_DIR/args.txt"
echo $$ > "$FAKE_DIR/pid"
case "$FAKE_MODE" in
  nostruct) echo "error: unknown option '--permission-prompt-tool'" 1>&2; exit 2;;
  garbage) echo "Usage: claude"; echo "Try claude --help"; echo "bla"; sleep 3; exit 0;;
esac
echo '{"type":"system","subtype":"init","session_id":"sess-123"}'
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$FAKE_DIR/in.txt"
  if [ "$FAKE_MODE" = crash ]; then echo "Error: Invalid API key" 1>&2; exit 1; fi
  case "$FAKE_MODE" in
    loop_same|loop_diff|pass1)
      n=3; [ "$FAKE_MODE" = pass1 ] && n=1
      i=1
      while [ $i -le $n ]; do
        case $i in 1) N=lint;; 2) N=build;; *) N=test;; esac
        [ "$FAKE_MODE" = loop_same ] && N=build
        MSG="Error: build broke at src/app.ts:12"
        [ "$FAKE_MODE" = loop_diff ] && MSG="Fout nummer $i in $N"
        printf '{"type":"assistant","message":{"id":"m%s","content":[{"type":"tool_use","id":"c%s","name":"mcp__studio__run_checks","input":{}}]}}\n' $i $i
        if [ "$FAKE_MODE" = pass1 ]; then
          printf '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"c%s","content":[{"type":"text","text":"ALLE CHECKS GESLAAGD"}]}]}}\n' $i
        else
          printf '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"c%s","content":[{"type":"text","text":"CHECKS MISLUKT\\n{\\"ok\\":false,\\"steps\\":[{\\"name\\":\\"%s\\",\\"status\\":\\"failed\\",\\"output\\":[\\"%s\\"]}]}"}]}]}}\n' $i "$N" "$MSG"
        fi
        i=$((i+1))
      done
      echo '{"type":"result","subtype":"success","is_error":false,"session_id":"sess-123","result":"klaar"}'
      continue;;
  esac
  echo '{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"Hallo!"},{"type":"tool_use","id":"t1","name":"Write","input":{"file_path":"/x/index.html","content":"x"}}]}}'
  echo '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}'
  echo '{"type":"result","subtype":"success","is_error":false,"session_id":"sess-123","result":"Hallo!"}'
done
"#,
    )
    .unwrap();
    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
    p
}

#[cfg(unix)]
fn launch(h: &H, mode: &str) -> (ChatLaunch, PathBuf) {
    let fake_dir = h.dir.path().join(format!("fake-{mode}"));
    std::fs::create_dir_all(&fake_dir).unwrap();
    let bin = fake_claude(&fake_dir);
    let l = ChatLaunch {
        provider: Provider::Claude,
        account_id: None,
        binary: bin,
        cwd: h.dir.path().to_path_buf(),
        env: vec![
            ("FAKE_DIR".into(), fake_dir.to_string_lossy().to_string()),
            ("FAKE_MODE".into(), mode.into()),
        ],
        mcp_config: Some(PathBuf::from("/data/mcp.json")),
        permission_tool: Some("mcp__studio__permission_prompt".into()),
    };
    (l, fake_dir)
}

#[cfg(unix)]
fn pid_alive(pid: i64) -> bool {
    std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .map(|s| !s.contains(") Z"))
        .unwrap_or(false)
}

#[cfg(unix)]
#[test]
fn bericht_versturen_geeft_geschiedenis_sessie_en_status_klaar() {
    let h = harness();
    let (l, fake) = launch(&h, "ok");
    h.mgr
        .send(h.project, "  Maak een site  ", true, &l)
        .unwrap();
    wait_for("klaar", || {
        h.out.lock().unwrap().iter().any(|o| {
            matches!(
                o,
                ChatOut::Status {
                    state: Status::Done,
                    busy: false,
                    ..
                }
            )
        })
    });

    let hist = history(&h);
    assert_eq!(
        hist.iter().map(|m| m.kind.as_str()).collect::<Vec<_>>(),
        vec!["user", "assistant", "action"]
    );
    assert_eq!(hist[0].payload["text"], "Maak een site", "getrimd");
    assert_eq!(hist[1].payload["text"], "Hallo!");
    assert_eq!(hist[2].payload["kind"], "file_created");
    assert_eq!(
        hist[2].payload["state"], "done",
        "resultaat is in dezelfde kaart verwerkt"
    );
    assert_eq!(hist[2].payload["params"]["file"], "index.html");
    assert_eq!(
        h.store.session(h.project).unwrap().session_id.as_deref(),
        Some("sess-123")
    );
    assert!(!h.mgr.busy(h.project));

    // De CLI kreeg precies één JSON-regel op stdin, en de juiste vlaggen.
    let input = std::fs::read_to_string(fake.join("in.txt")).unwrap();
    assert_eq!(input.lines().count(), 1);
    assert!(input.contains("Maak een site"));
    let args = std::fs::read_to_string(fake.join("args.txt")).unwrap();
    assert!(
        args.contains("--input-format stream-json")
            && args.contains("--permission-prompt-tool mcp__studio__permission_prompt")
    );
    assert!(
        !args.contains("--resume"),
        "eerste keer: geen sessie om te hervatten"
    );
    h.mgr.close_all();
}

#[cfg(unix)]
#[test]
fn heropenen_hervat_de_sessie_en_stoppen_laat_geen_proces_achter() {
    let h = harness();
    let (l, fake) = launch(&h, "ok");
    h.mgr.send(h.project, "een", true, &l).unwrap();
    wait_for("eerste antwoord", || {
        kinds(&h).iter().filter(|k| *k == "assistant").count() == 1
    });
    let pid: i64 = std::fs::read_to_string(fake.join("pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(pid_alive(pid));

    h.mgr.stop(h.project);
    wait_for("proces weg", || !pid_alive(pid));
    assert!(!h.mgr.busy(h.project));

    // "Heropenen van het project": nieuw proces met --resume <sessie-id>
    h.mgr.send(h.project, "twee", true, &l).unwrap();
    wait_for("tweede antwoord", || {
        kinds(&h).iter().filter(|k| *k == "assistant").count() == 2
    });
    let args = std::fs::read_to_string(fake.join("args.txt")).unwrap();
    let last = args.lines().last().unwrap();
    assert!(last.contains("--resume sess-123"), "{last}");
    let pid2: i64 = std::fs::read_to_string(fake.join("pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert_ne!(pid, pid2);

    h.mgr.close_all();
    wait_for("tweede proces weg", || !pid_alive(pid2));
    // De geschiedenis blijft bestaan.
    assert_eq!(kinds(&h).iter().filter(|k| *k == "user").count(), 2);
}

#[cfg(unix)]
#[test]
fn nieuwe_sessie_vergeet_het_sessie_id_en_zet_een_scheiding_neer() {
    let h = harness();
    let (l, fake) = launch(&h, "ok");
    h.mgr.send(h.project, "een", true, &l).unwrap();
    wait_for("antwoord", || kinds(&h).contains(&"assistant".to_string()));
    h.mgr.new_session(
        h.project,
        Provider::Claude,
        None,
        json!({"kind": "switched", "provider": "claude"}),
    );
    assert_eq!(h.store.session(h.project).unwrap().session_id, None);
    assert_eq!(history(&h).last().unwrap().kind, "divider");
    h.mgr.send(h.project, "twee", true, &l).unwrap();
    wait_for("tweede antwoord", || {
        kinds(&h).iter().filter(|k| *k == "assistant").count() == 2
    });
    let args = std::fs::read_to_string(fake.join("args.txt")).unwrap();
    assert!(!args.lines().last().unwrap().contains("--resume"));
    h.mgr.close_all();
}

#[cfg(unix)]
#[test]
fn crash_tijdens_een_beurt_geeft_een_foutkaart_met_technische_details() {
    let h = harness();
    let (l, _f) = launch(&h, "crash");
    h.mgr.send(h.project, "hoi", true, &l).unwrap();
    wait_for("foutkaart", || kinds(&h).contains(&"error".to_string()));
    let e = history(&h).into_iter().find(|m| m.kind == "error").unwrap();
    assert_eq!(e.payload["code"], "not_logged_in");
    assert!(e.payload["technical"]
        .as_str()
        .unwrap()
        .contains("Invalid API key"));
    assert_eq!(e.payload["retry"], true);
    wait_for("niet meer bezig", || !h.mgr.busy(h.project));
}

#[cfg(unix)]
#[test]
fn zonder_gestructureerde_uitvoer_valt_de_chat_terug_op_de_terminal() {
    // 1. CLI die meteen stopt met "unknown option" (te oude versie)
    let h = harness();
    let (l, _f) = launch(&h, "nostruct");
    let _ = h.mgr.send(h.project, "hoi", true, &l);
    wait_for("terugval", || {
        h.out
            .lock()
            .unwrap()
            .iter()
            .any(|o| matches!(o, ChatOut::Fallback { reason, .. } if reason == "no_structure"))
    });
    let n = history(&h)
        .into_iter()
        .find(|m| m.kind == "notice")
        .unwrap();
    assert!(n.payload["technical"]
        .as_str()
        .unwrap()
        .contains("unknown option"));

    // 2. CLI die gewone tekst uitvoert in plaats van JSON
    let h = harness();
    let (l, _f) = launch(&h, "garbage");
    h.mgr.send(h.project, "hoi", true, &l).unwrap();
    wait_for("terugval", || {
        h.out
            .lock()
            .unwrap()
            .iter()
            .any(|o| matches!(o, ChatOut::Fallback { reason, .. } if reason == "unstructured"))
    });
    wait_for("proces opgeruimd", || !h.mgr.busy(h.project));
}

#[test]
fn andere_ais_zonder_adapter_vallen_terug_zonder_proces_te_starten() {
    assert!(supports_structured(Provider::Claude));
    assert!(!supports_structured(Provider::Gemini));
    assert!(adapter_for(Provider::Gemini).is_none());
    let h = harness();
    let l = ChatLaunch {
        provider: Provider::Gemini,
        account_id: None,
        binary: PathBuf::from("/bestaat/niet"),
        cwd: h.dir.path().to_path_buf(),
        env: vec![],
        mcp_config: None,
        permission_tool: None,
    };
    let e = h
        .mgr
        .send(h.project, "hoi", true, &l)
        .unwrap_err()
        .to_string();
    assert!(e.contains("technische weergave"), "{e}");
    assert!(kinds(&h).is_empty(), "niets opgeslagen of gestart");
}

#[test]
fn lege_berichten_en_onvindbare_cli_geven_een_foutkaart() {
    let h = harness();
    let l = ChatLaunch {
        provider: Provider::Claude,
        account_id: None,
        binary: PathBuf::from("/bestaat/echt/niet/claude"),
        cwd: h.dir.path().to_path_buf(),
        env: vec![],
        mcp_config: None,
        permission_tool: None,
    };
    assert!(h.mgr.send(h.project, "   ", true, &l).is_err());
    assert!(h.mgr.send(h.project, "hoi", true, &l).is_err());
    let e = history(&h).into_iter().find(|m| m.kind == "error").unwrap();
    assert_eq!(e.payload["code"], "cli_missing");
    assert!(h.out.lock().unwrap().iter().any(|o| matches!(
        o,
        ChatOut::Status {
            busy: false,
            state: Status::Idle,
            ..
        }
    )));
}

// ---------- toestemmingen ----------

fn ask(h: &H, id: &str, tool: &str, input: Value) {
    h.mgr.on_permission_request(
        h.project,
        h.dir.path(),
        &json!({ "id": id, "tool_name": tool, "input": input }),
    );
}

fn perm_state(h: &H, id: &str) -> Option<String> {
    history(h)
        .into_iter()
        .find(|m| m.kind == "permission" && m.payload["req_id"] == id)
        .map(|m| m.payload["state"].as_str().unwrap().to_string())
}

#[test]
fn standaard_stand_laat_gewoon_bouwwerk_door_zonder_vraag_en_vraagt_bij_verwijderen() {
    let h = harness();
    let file = h
        .dir
        .path()
        .join("index.html")
        .to_string_lossy()
        .to_string();
    ask(&h, "r1", "Write", json!({ "file_path": file }));
    assert_eq!(
        *h.answers.lock().unwrap(),
        vec![(h.project, "r1".to_string(), true)],
        "automatisch toegestaan"
    );
    assert!(perm_state(&h, "r1").is_none(), "geen dialoog");

    ask(
        &h,
        "r2",
        "Bash",
        json!({ "command": "rm -rf node_modules" }),
    );
    assert_eq!(
        h.answers.lock().unwrap().len(),
        1,
        "nog geen antwoord: de gebruiker moet kiezen"
    );
    assert_eq!(perm_state(&h, "r2").as_deref(), Some("asked"));
    let m = history(&h)
        .into_iter()
        .find(|m| m.kind == "permission")
        .unwrap();
    assert_eq!(
        (m.payload["kind"].as_str(), m.payload["danger"].as_bool()),
        (Some("delete_files"), Some(true))
    );
}

#[test]
fn ja_en_nee_worden_vastgelegd_en_doorgegeven_en_vragen_verlopen_netjes() {
    let h = harness();
    ask(&h, "a", "Bash", json!({ "command": "git push" }));
    ask(&h, "b", "Bash", json!({ "command": "npm publish" }));
    ask(&h, "c", "Bash", json!({ "command": "vercel --prod" }));
    h.mgr.answer_permission(h.project, "a", true).unwrap();
    h.mgr.answer_permission(h.project, "b", false).unwrap();
    h.mgr.expire_permission(h.project, "c");
    assert_eq!(perm_state(&h, "a").as_deref(), Some("allowed"));
    assert_eq!(perm_state(&h, "b").as_deref(), Some("denied"));
    assert_eq!(perm_state(&h, "c").as_deref(), Some("expired"));
    let ans = h.answers.lock().unwrap().clone();
    assert_eq!(
        ans,
        vec![
            (h.project, "a".into(), true),
            (h.project, "b".into(), false)
        ]
    );
    assert!(
        h.mgr.answer_permission(h.project, "a", true).is_err(),
        "een vraag kan maar één keer worden beantwoord"
    );
    assert!(h
        .mgr
        .answer_permission(h.project, "onbekend", true)
        .is_err());
}

#[test]
fn vraag_altijd_vraagt_ook_voor_gewone_bestanden_maar_gevaar_vraagt_altijd() {
    let h = harness();
    h.store
        .0
        .lock()
        .unwrap()
        .execute(
            "INSERT INTO settings (key, value) VALUES ('ui:permission_mode', 'always')",
            [],
        )
        .unwrap();
    let file = h.dir.path().join("a.css").to_string_lossy().to_string();
    ask(&h, "w", "Write", json!({ "file_path": file }));
    assert_eq!(perm_state(&h, "w").as_deref(), Some("asked"));
    ask(&h, "r", "Read", json!({ "file_path": file }));
    assert!(
        h.answers
            .lock()
            .unwrap()
            .iter()
            .any(|(_, id, ok)| id == "r" && *ok),
        "lezen mag zonder vraag"
    );

    // omgekeerd: ook in de zachtste stand blijft gevaar bevestigd worden
    let h2 = harness();
    ask(&h2, "x", "Bash", json!({ "command": "rm -rf ." }));
    ask(&h2, "y", "Write", json!({ "file_path": "/etc/hosts" }));
    assert_eq!(perm_state(&h2, "x").as_deref(), Some("asked"));
    assert_eq!(perm_state(&h2, "y").as_deref(), Some("asked"));
    assert!(h2.answers.lock().unwrap().is_empty());
}

#[test]
fn onleesbare_aanvraag_wordt_genegeerd_zonder_te_crashen() {
    let h = harness();
    h.mgr
        .on_permission_request(h.project, h.dir.path(), &json!({ "geen_id": true }));
    h.mgr.on_permission_request(
        h.project,
        h.dir.path(),
        &json!({ "id": "z", "tool_name": 5, "input": "tekst" }),
    );
    assert!(history(&h).iter().all(|m| m.kind != "permission") || perm_state(&h, "z").is_some());
}

// ---------- end-to-end: echte MCP-server (Node) + ChatManager ----------

fn raw_permission_call(
    port: u16,
    token: &str,
    tool: &str,
    input: Value,
) -> std::thread::JoinHandle<String> {
    let token = token.to_string();
    let tool = tool.to_string();
    std::thread::spawn(move || {
        use std::io::{Read, Write};
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": { "name": "permission_prompt", "arguments": { "tool_name": tool, "input": input } } })
        .to_string();
        let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
        write!(s, "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        out
    })
}

#[test]
fn toestemming_end_to_end_via_de_echte_mcp_server() {
    use crate::mcp::{new_token, McpEvent, McpManager};
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../mcp-server/dist/index.mjs");
    if !script.is_file() || crate::node::find().is_err() {
        return eprintln!("overgeslagen: node of mcp-server/dist ontbreekt");
    }
    let conn = db::open_in_memory().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let p = projects::create(&conn, "P", dir.path(), "leeg").unwrap();
    let store = Arc::new(ConnStore(Mutex::new(conn)));

    let chat_cell: Arc<std::sync::OnceLock<ChatManager>> = Arc::default();
    let mcp_cell: Arc<std::sync::OnceLock<Arc<McpManager>>> = Arc::default();
    let (c1, d1) = (chat_cell.clone(), dir.path().to_path_buf());
    let mcp = Arc::new(McpManager::new(
        new_token(),
        vec![script],
        Arc::new(move |ev| {
            if let McpEvent::Runtime {
                project_id,
                payload,
            } = ev
            {
                if payload["event"] == "permission_request" {
                    if let Some(chat) = c1.get().cloned() {
                        let d = d1.clone();
                        std::thread::spawn(move || {
                            chat.on_permission_request(project_id, &d, &payload)
                        });
                    }
                }
            }
        }),
    ));
    mcp_cell.set(mcp.clone()).ok();
    let m2 = mcp_cell.clone();
    let chat = ChatManager::new(
        store.clone(),
        Arc::new(|_| {}),
        Arc::new(move |project, id, allow, msg: Option<&str>| {
            m2.get()
                .unwrap()
                .call(
                    project,
                    "permission.answer",
                    json!({ "id": id, "allow": allow, "message": msg }),
                    Duration::from_secs(5),
                )
                .map(|_| ())
        }),
    );
    chat_cell.set(chat.clone()).ok();

    let info = mcp.start(p.id, "P", dir.path());
    assert!(info.is_up(), "{info:?}");
    let port = info.port.unwrap();
    let state = |req: &str| -> Option<String> {
        store::history(&store.0.lock().unwrap(), p.id, 50)
            .unwrap()
            .into_iter()
            .find(|m| m.kind == "permission" && m.payload["req_id"] == req)
            .map(|m| m.payload["state"].as_str().unwrap().to_string())
    };
    let asked_id = || -> Option<String> {
        store::history(&store.0.lock().unwrap(), p.id, 50)
            .unwrap()
            .into_iter()
            .find(|m| m.kind == "permission" && m.payload["state"] == "asked")
            .map(|m| m.payload["req_id"].as_str().unwrap().to_string())
    };

    // 1. Gewoon bouwwerk binnen het project: automatisch toegestaan, zonder dialoog.
    let file = dir.path().join("index.html").to_string_lossy().to_string();
    let r = raw_permission_call(port, mcp.token(), "Write", json!({ "file_path": file }))
        .join()
        .unwrap();
    assert!(r.contains(r#"\"behavior\":\"allow\""#), "{r}");

    // 2. Gevaarlijk: de dialoog verschijnt; 'Ja' laat de aanroep slagen.
    let call = raw_permission_call(
        port,
        mcp.token(),
        "Bash",
        json!({ "command": "rm -rf dist" }),
    );
    wait_for("vraag aan de gebruiker", || asked_id().is_some());
    let id = asked_id().unwrap();
    chat.answer_permission(p.id, &id, true).unwrap();
    let r = call.join().unwrap();
    assert!(r.contains(r#"\"behavior\":\"allow\""#), "{r}");
    assert_eq!(state(&id).as_deref(), Some("allowed"));

    // 3. 'Nee' geeft deny met uitleg.
    let call = raw_permission_call(
        port,
        mcp.token(),
        "Bash",
        json!({ "command": "git push origin main" }),
    );
    wait_for("tweede vraag", || asked_id().is_some());
    let id = asked_id().unwrap();
    chat.answer_permission(p.id, &id, false).unwrap();
    let r = call.join().unwrap();
    assert!(
        r.contains(r#"\"behavior\":\"deny\""#) && r.contains("niet toegestaan"),
        "{r}"
    );
    assert_eq!(state(&id).as_deref(), Some("denied"));

    mcp.stop(p.id);
}

// ---------- automatische versies ----------

#[derive(Default)]
struct FakeGit {
    head: Mutex<Option<Version>>,
    dirty: Mutex<bool>,
    made: Mutex<Vec<String>>,
}

impl Git for FakeGit {
    fn head(&self, _p: i64) -> Option<Version> {
        self.head.lock().unwrap().clone()
    }
    fn dirty(&self, _p: i64) -> bool {
        *self.dirty.lock().unwrap()
    }
    fn checkpoint(&self, _p: i64, title: &str) -> Option<Version> {
        self.made.lock().unwrap().push(title.to_string());
        let v = Version {
            hash: format!("hash{}", self.made.lock().unwrap().len()),
            title: title.to_string(),
        };
        *self.head.lock().unwrap() = Some(v.clone());
        *self.dirty.lock().unwrap() = false;
        Some(v)
    }
}

fn versions(h: &H) -> Vec<StoredMessage> {
    history(h)
        .into_iter()
        .filter(|m| m.kind == "version")
        .collect()
}

#[cfg(unix)]
#[test]
fn na_een_geslaagde_beurt_met_wijzigingen_komt_er_automatisch_een_versie_met_een_korte_titel() {
    let h = harness();
    let git = Arc::new(FakeGit::default());
    *git.dirty.lock().unwrap() = true;
    h.mgr.set_git(git.clone());
    let (l, _f) = launch(&h, "ok");
    h.mgr
        .send(
            h.project,
            "Maak een bestelknop voor mijn bakkerij op de pagina",
            true,
            &l,
        )
        .unwrap();
    wait_for("versie in de chat", || !versions(&h).is_empty());

    let v = &versions(&h)[0];
    let title = v.payload["title"].as_str().unwrap();
    assert!(title.split_whitespace().count() <= 8, "{title}");
    assert_eq!(*git.made.lock().unwrap(), vec![title.to_string()]);
    assert_eq!(v.payload["hash"], "hash1");
    // De versie staat ná het antwoord van de AI in de chat.
    let kinds = kinds(&h);
    assert!(
        kinds.iter().position(|k| k == "assistant").unwrap()
            < kinds.iter().position(|k| k == "version").unwrap()
    );
    h.mgr.close_all();
}

/// Git waarbij de AI "tijdens de beurt" zelf een versie maakt: de eerste `head()` (begin van de beurt) is de oude, daarna de nieuwe.
struct AiMakesVersion {
    calls: AtomicUsize,
    made: Mutex<Vec<String>>,
}

impl Git for AiMakesVersion {
    fn head(&self, _p: i64) -> Option<Version> {
        let first = self.calls.fetch_add(1, Ordering::SeqCst) == 0;
        Some(if first {
            Version {
                hash: "oud".into(),
                title: "Begin".into(),
            }
        } else {
            Version {
                hash: "nieuw".into(),
                title: "Bestelknop toegevoegd".into(),
            }
        })
    }
    fn dirty(&self, _p: i64) -> bool {
        false
    }
    fn checkpoint(&self, _p: i64, title: &str) -> Option<Version> {
        self.made.lock().unwrap().push(title.to_string());
        None
    }
}

#[cfg(unix)]
#[test]
fn heeft_de_ai_zelf_een_versie_gemaakt_dan_wordt_die_getoond_zonder_dubbele_versie() {
    let h = harness();
    let git = Arc::new(AiMakesVersion {
        calls: AtomicUsize::new(0),
        made: Mutex::default(),
    });
    h.mgr.set_git(git.clone());
    let (l, _f) = launch(&h, "ok");
    h.mgr.send(h.project, "doe iets", true, &l).unwrap();
    wait_for("versie in de chat", || !versions(&h).is_empty());
    assert_eq!(versions(&h)[0].payload["title"], "Bestelknop toegevoegd");
    assert!(git.made.lock().unwrap().is_empty(), "geen extra checkpoint");
    h.mgr.close_all();
}

#[cfg(unix)]
#[test]
fn zonder_wijzigingen_en_zonder_nieuwe_versie_komt_er_niets_bij_en_na_een_mislukte_beurt_ook_niet()
{
    let h = harness();
    let git = Arc::new(FakeGit::default());
    h.mgr.set_git(git.clone());
    let (l, _f) = launch(&h, "ok");
    h.mgr.send(h.project, "alleen een vraag", true, &l).unwrap();
    wait_for("antwoord", || {
        !h.mgr.busy(h.project) && kinds(&h).contains(&"assistant".to_string())
    });
    std::thread::sleep(Duration::from_millis(300));
    assert!(versions(&h).is_empty() && git.made.lock().unwrap().is_empty());
    h.mgr.close_all();

    // mislukte beurt (CLI crasht): ook al zijn er wijzigingen, geen versie
    let h = harness();
    let git = Arc::new(FakeGit::default());
    *git.dirty.lock().unwrap() = true;
    h.mgr.set_git(git.clone());
    let (l, _f) = launch(&h, "crash");
    h.mgr.send(h.project, "hoi", true, &l).unwrap();
    wait_for("foutkaart", || kinds(&h).contains(&"error".to_string()));
    std::thread::sleep(Duration::from_millis(300));
    assert!(git.made.lock().unwrap().is_empty());
}

#[cfg(unix)]
#[test]
fn zonder_git_koppeling_werkt_de_chat_gewoon() {
    let h = harness();
    let (l, _f) = launch(&h, "ok");
    h.mgr.send(h.project, "hoi", true, &l).unwrap();
    wait_for("antwoord", || kinds(&h).contains(&"assistant".to_string()));
    assert!(versions(&h).is_empty());
    h.mgr.close_all();
}

// ---------- plan-modus (eerst overleggen) ----------

fn args_lines(fake: &Path) -> Vec<String> {
    std::fs::read_to_string(fake.join("args.txt"))
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect()
}

#[test]
fn modus_is_standaard_bouwen_wordt_per_project_onthouden_en_meldt_de_wijziging() {
    let h = harness();
    assert_eq!(h.mgr.mode(h.project), "build");
    h.mgr.set_mode(h.project, "plan").unwrap();
    assert_eq!(h.mgr.mode(h.project), "plan");
    assert!(h
        .out
        .lock()
        .unwrap()
        .iter()
        .any(|o| matches!(o, ChatOut::Mode { mode, .. } if mode == "plan")));
    assert!(h.mgr.set_mode(h.project, "rommel").is_err());

    // een ander project heeft zijn eigen keuze
    let other = {
        let c = h.store.0.lock().unwrap();
        let d = tempfile::tempdir().unwrap();
        let p = projects::create(&c, "Tweede", d.path(), "leeg").unwrap();
        std::mem::forget(d);
        p.id
    };
    assert_eq!(h.mgr.mode(other), "build");
    // en de keuze staat in de database (blijft dus bewaard na herstart)
    assert_eq!(
        h.store
            .setting(&format!("chat_mode:{}", h.project))
            .as_deref(),
        Some("plan")
    );
}

#[cfg(unix)]
#[test]
fn in_overleg_modus_start_de_cli_in_planmodus_en_wisselen_herstart_met_hervatten() {
    let h = harness();
    let (l, fake) = launch(&h, "ok");
    h.mgr.send(h.project, "een", true, &l).unwrap();
    wait_for("antwoord", || kinds(&h).contains(&"assistant".to_string()));
    assert!(
        !args_lines(&fake)[0].contains("--permission-mode"),
        "bouwen: geen planmodus"
    );

    h.mgr.set_mode(h.project, "plan").unwrap();
    h.mgr.send(h.project, "twee", true, &l).unwrap();
    wait_for("tweede antwoord", || {
        kinds(&h).iter().filter(|k| *k == "assistant").count() == 2
    });
    let second = args_lines(&fake)[1].clone();
    assert!(second.contains("--permission-mode plan"), "{second}");
    assert!(
        second.contains("--resume sess-123"),
        "zelfde gesprek: {second}"
    );

    h.mgr.set_mode(h.project, "build").unwrap();
    h.mgr.send(h.project, "drie", true, &l).unwrap();
    wait_for("derde antwoord", || {
        kinds(&h).iter().filter(|k| *k == "assistant").count() == 3
    });
    let third = args_lines(&fake)[2].clone();
    assert!(
        !third.contains("--permission-mode") && third.contains("--resume"),
        "{third}"
    );
    h.mgr.close_all();
}

#[test]
fn zonder_eigen_planmodus_krijgt_de_ai_een_instructie_om_niets_te_wijzigen() {
    assert_eq!(plan_text("Maak een site", false), "Maak een site");
    let t = plan_text("Maak een site", true);
    assert!(
        t.starts_with("[Overleg-modus]")
            && t.contains("GEEN bestanden")
            && t.ends_with("Maak een site")
    );
}

#[test]
fn in_overleg_modus_worden_schrijfacties_zonder_vraag_geweigerd_en_lezen_mag() {
    let h = harness();
    h.mgr.set_mode(h.project, "plan").unwrap();
    let file = h
        .dir
        .path()
        .join("index.html")
        .to_string_lossy()
        .to_string();
    ask(&h, "w", "Write", json!({ "file_path": file }));
    ask(&h, "b", "Bash", json!({ "command": "rm -rf x" }));
    ask(&h, "r", "Read", json!({ "file_path": file }));
    let ans = h.answers.lock().unwrap().clone();
    assert!(
        ans.contains(&(h.project, "w".into(), false))
            && ans.contains(&(h.project, "b".into(), false))
    );
    assert!(ans.contains(&(h.project, "r".into(), true)));
    assert!(h
        .deny_messages
        .lock()
        .unwrap()
        .iter()
        .all(|m| m.contains("overleg-modus")));
    assert!(
        history(&h).iter().all(|m| m.kind != "permission"),
        "geen dialoog voor geweigerde acties"
    );
}

#[test]
fn plan_goedkeuren_vraagt_de_gebruiker_en_ja_zet_het_project_op_bouwen() {
    let h = harness();
    h.mgr.set_mode(h.project, "plan").unwrap();
    ask(
        &h,
        "plan1",
        "ExitPlanMode",
        json!({ "plan": "# Plan\n1. Maak index.html" }),
    );
    let m = history(&h)
        .into_iter()
        .find(|m| m.kind == "permission")
        .unwrap();
    assert_eq!(m.payload["plan_exit"], true);
    assert!(m.payload["detail"]
        .as_str()
        .unwrap()
        .contains("Maak index.html"));
    assert_eq!(h.mgr.mode(h.project), "plan", "nog niet goedgekeurd");

    h.mgr.answer_permission(h.project, "plan1", true).unwrap();
    assert_eq!(h.mgr.mode(h.project), "build");
    assert!(h
        .out
        .lock()
        .unwrap()
        .iter()
        .any(|o| matches!(o, ChatOut::Mode { mode, .. } if mode == "build")));
    assert!(h
        .answers
        .lock()
        .unwrap()
        .contains(&(h.project, "plan1".into(), true)));

    // Nee: blijft overleggen
    h.mgr.set_mode(h.project, "plan").unwrap();
    ask(&h, "plan2", "ExitPlanMode", json!({ "plan": "x" }));
    h.mgr.answer_permission(h.project, "plan2", false).unwrap();
    assert_eq!(h.mgr.mode(h.project), "plan");
}

// ---------- bug-lus bewaker ----------

fn alerts(h: &H) -> Vec<StoredMessage> {
    history(h)
        .into_iter()
        .filter(|m| m.kind == "loop_alert")
        .collect()
}

#[cfg(unix)]
#[test]
fn dezelfde_fout_drie_keer_onderbreekt_de_ai_met_een_melding_zonder_versie_van_de_kapotte_staat() {
    let h = harness();
    let git = Arc::new(FakeGit::default());
    *git.dirty.lock().unwrap() = true;
    h.mgr.set_git(git.clone());
    h.store
        .insert(
            h.project,
            "version",
            json!({ "hash": "goed1", "title": "Pagina werkt", "working": true }),
        )
        .unwrap();
    let (l, fake) = launch(&h, "loop_same");
    h.mgr.send(h.project, "maak het", true, &l).unwrap();
    wait_for("melding", || !alerts(&h).is_empty());

    let a = &alerts(&h)[0];
    assert_eq!(
        (
            a.payload["reason"].as_str(),
            a.payload["streak"].as_u64(),
            a.payload["threshold"].as_u64()
        ),
        (Some("same_error"), Some(3), Some(3))
    );
    assert_eq!(
        a.payload["last_working"]["hash"], "goed1",
        "laatste werkende versie wordt meegegeven"
    );
    wait_for("niet meer bezig", || !h.mgr.busy(h.project));
    let pid: i64 = std::fs::read_to_string(fake.join("pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    wait_for("proces gestopt", || !pid_alive(pid));
    std::thread::sleep(Duration::from_millis(400));
    assert_eq!(
        versions(&h).len(),
        1,
        "alleen de al bestaande versie; geen nieuwe na ingrijpen"
    );
    assert!(git.made.lock().unwrap().is_empty());
    assert!(h.out.lock().unwrap().iter().any(|o| matches!(
        o,
        ChatOut::Status {
            busy: false,
            state: Status::Idle,
            ..
        }
    )));
    assert_eq!(
        kinds(&h).iter().filter(|k| *k == "loop_alert").count(),
        1,
        "maar één melding"
    );
}

#[cfg(unix)]
#[test]
fn verschillende_fouten_in_verschillende_stappen_zijn_geen_lus_en_de_beurt_loopt_door() {
    let h = harness();
    let git = Arc::new(FakeGit::default());
    *git.dirty.lock().unwrap() = true;
    h.mgr.set_git(git.clone());
    let (l, _f) = launch(&h, "loop_diff");
    h.mgr.send(h.project, "maak het", true, &l).unwrap();
    wait_for("versie", || !versions(&h).is_empty());
    assert!(alerts(&h).is_empty());
    assert_eq!(
        versions(&h)[0].payload["working"],
        false,
        "de laatste controle faalde: niet 'werkend'"
    );
    h.mgr.close_all();
}

#[cfg(unix)]
#[test]
fn drempel_is_instelbaar() {
    let h = harness();
    h.store
        .0
        .lock()
        .unwrap()
        .execute(
            "INSERT INTO settings (key, value) VALUES ('ui:loop_threshold', '2')",
            [],
        )
        .unwrap();
    let (l, _f) = launch(&h, "loop_same");
    h.mgr.send(h.project, "maak het", true, &l).unwrap();
    wait_for("melding", || !alerts(&h).is_empty());
    assert_eq!(
        (
            alerts(&h)[0].payload["streak"].as_u64(),
            alerts(&h)[0].payload["threshold"].as_u64()
        ),
        (Some(2), Some(2))
    );
}

#[cfg(unix)]
#[test]
fn een_nieuw_bericht_begint_een_nieuwe_reeks_en_een_geslaagde_controle_maakt_de_versie_werkend() {
    let h = harness();
    let (l, _f) = launch(&h, "loop_same");
    h.mgr.send(h.project, "maak het", true, &l).unwrap();
    wait_for("eerste melding", || alerts(&h).len() == 1);
    h.mgr
        .send(h.project, "probeer het nog eens", true, &l)
        .unwrap();
    wait_for("tweede melding", || alerts(&h).len() == 2);
    assert_eq!(
        alerts(&h)[1].payload["streak"],
        3,
        "geteld vanaf het nieuwe bericht, niet 6"
    );

    // slaagt de controle, dan is de versie van die beurt "werkend"
    let h2 = harness();
    let git = Arc::new(FakeGit::default());
    *git.dirty.lock().unwrap() = true;
    h2.mgr.set_git(git);
    let (l2, _f2) = launch(&h2, "pass1");
    h2.mgr.send(h2.project, "maak het", true, &l2).unwrap();
    wait_for("versie", || !versions(&h2).is_empty());
    assert_eq!(versions(&h2)[0].payload["working"], true);
    assert_eq!(
        h2.store.last_working(h2.project).unwrap().0,
        versions(&h2)[0].payload["hash"].as_str().unwrap()
    );
    h2.mgr.close_all();
}

#[cfg(unix)]
#[test]
fn bijlagen_staan_in_het_bericht_en_in_de_opdracht_aan_de_ai() {
    let h = harness();
    let (l, fake) = launch(&h, "ok");
    let att = vec![Attachment {
        path: "assets/foto.png".into(),
        name: "foto.png".into(),
        kind: "image".into(),
    }];
    h.mgr
        .send_with(h.project, "Gebruik dit logo", true, &l, &att)
        .unwrap();
    wait_for("klaar", || {
        h.out.lock().unwrap().iter().any(|o| {
            matches!(
                o,
                ChatOut::Status {
                    state: Status::Done,
                    ..
                }
            )
        })
    });
    let hist = history(&h);
    assert_eq!(hist[0].payload["text"], "Gebruik dit logo");
    assert_eq!(hist[0].payload["attachments"][0]["path"], "assets/foto.png");
    assert_eq!(hist[0].payload["attachments"][0]["kind"], "image");
    let input = std::fs::read_to_string(fake.join("in.txt")).unwrap();
    assert!(
        input.contains("Gebruik dit logo") && input.contains("assets/foto.png"),
        "{input}"
    );
}

#[cfg(unix)]
#[test]
fn alleen_bijlagen_zonder_tekst_mag_maar_helemaal_niets_niet() {
    let h = harness();
    let (l, fake) = launch(&h, "ok");
    assert!(h.mgr.send_with(h.project, "  ", true, &l, &[]).is_err());
    let att = vec![Attachment {
        path: "assets/a.pdf".into(),
        name: "a.pdf".into(),
        kind: "document".into(),
    }];
    h.mgr.send_with(h.project, "", true, &l, &att).unwrap();
    wait_for("invoer", || fake.join("in.txt").exists());
    assert_eq!(
        history(&h)[0].payload["text"],
        "Kijk naar de bijgevoegde bestanden."
    );
}
