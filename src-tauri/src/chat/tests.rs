use super::*;
use crate::{db, projects};
use std::time::{Duration, Instant};

struct H {
    mgr: ChatManager,
    out: Arc<Mutex<Vec<ChatOut>>>,
    answers: Arc<Mutex<Vec<(i64, String, bool)>>>,
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
    let (o, a) = (out.clone(), answers.clone());
    let mgr = ChatManager::new(
        store.clone(),
        Arc::new(move |e| o.lock().unwrap().push(e)),
        Arc::new(move |p, id, allow| {
            a.lock().unwrap().push((p, id.to_string(), allow));
            Ok(())
        }),
    );
    H {
        mgr,
        out,
        answers,
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
