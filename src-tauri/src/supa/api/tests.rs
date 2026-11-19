use super::*;
use crate::connect::http::MockHttp;

fn ok(status: u16, body: &str) -> Result<crate::connect::http::Response, ConnectError> {
    MockHttp::ok(status, body)
}

#[test]
fn projecten_lijsten_en_aanmaken() {
    let http = MockHttp::new(vec![ok(200, r#"[{"id":"abcdefghij","name":"Winkel","region":"eu-west-1","status":"ACTIVE_HEALTHY"},{"name":"zonder id"}]"#), ok(201, r#"{"id":"newref123","name":"Nieuw","region":"eu-central-1","status":"COMING_UP"}"#)]);
    let c = Client::new(&http, "tok");
    let p = c.projects().unwrap();
    assert_eq!(p.len(), 1);
    assert_eq!((p[0].reference.as_str(), p[0].status.as_str()), ("abcdefghij", "ACTIVE_HEALTHY"));
    let n = c.create_project("Nieuw", "mijn-org", "wachtwoord-123", "emea", None).unwrap();
    assert_eq!((n.reference.as_str(), n.status.as_str()), ("newref123", "COMING_UP"));
    let seen = http.seen.lock().unwrap();
    assert_eq!(seen[1], ("POST".into(), "https://api.supabase.com/v1/projects".into()));
}

#[test]
fn aanmaken_stuurt_europese_regio_en_geen_instance_size_voor_de_gratis_variant() {
    // De body wordt in het verzoek gebouwd; we testen de JSON-vorm via een eigen Http.
    struct Spy(std::sync::Mutex<String>);
    impl Http for Spy {
        fn send(&self, req: Request) -> Result<crate::connect::http::Response, ConnectError> {
            if let Body::Json(j) = req.body {
                *self.0.lock().unwrap() = j;
            }
            Ok(crate::connect::http::Response { status: 201, body: r#"{"id":"abc","name":"x"}"#.into() })
        }
    }
    let spy = Spy(Default::default());
    let c = Client::new(&spy, "tok");
    c.create_project("x", "org", "pw", "emea", None).unwrap();
    let body: Value = serde_json::from_str(&spy.0.lock().unwrap()).unwrap();
    assert_eq!(body["region_selection"], json!({ "type": "smartGroup", "code": "emea" }));
    assert!(body.get("desired_instance_size").is_none());
    c.create_project("x", "org", "pw", "emea", Some("micro")).unwrap();
    let body: Value = serde_json::from_str(&spy.0.lock().unwrap()).unwrap();
    assert_eq!(body["desired_instance_size"], "micro");
}

#[test]
fn fouten_401_403_429_time_out_geen_internet_plan_en_niet_gevonden() {
    let cases: Vec<(Result<crate::connect::http::Response, ConnectError>, SupaError)> = vec![
        (ok(401, "{}"), SupaError::Connect(ConnectError::Unauthorized)),
        (ok(403, "{}"), SupaError::Connect(ConnectError::Forbidden)),
        (ok(429, "{}"), SupaError::Connect(ConnectError::RateLimited)),
        (Err(ConnectError::Timeout), SupaError::Connect(ConnectError::Timeout)),
        (Err(ConnectError::Offline), SupaError::Connect(ConnectError::Offline)),
        (ok(402, r#"{"message":"Maximum number of free projects"}"#), SupaError::PlanLimit),
        (ok(404, "{}"), SupaError::NotFound),
        (ok(500, "{}"), SupaError::Unexpected),
    ];
    for (reply, want) in cases {
        let http = MockHttp::new(vec![reply]);
        assert_eq!(Client::new(&http, "tok").projects().unwrap_err(), want);
    }
    assert_eq!(SupaError::PlanLimit.code(), "plan_limiet");
    assert_eq!(SupaError::Paused.code(), "gepauzeerd");
}

#[test]
fn sql_fouten_komen_schoon_terug_zonder_geheimen() {
    let http = MockHttp::new(vec![ok(400, r#"{"message":"syntax error at or near \"x\" met sbp_abcdef1234567890 en wachtwoord hunter2hunter2"}"#)]);
    let mut c = Client::new(&http, "sbp_tokentokentoken");
    c.secrets = vec!["hunter2hunter2".into()];
    let e = c.query("abc", "select x", true).unwrap_err();
    let SupaError::Sql(m) = e else { panic!() };
    assert!(m.contains("syntax error"));
    assert!(!m.contains("sbp_abcdef") && !m.contains("hunter2hunter2"), "{m}");
    assert!(m.contains("***"));
}

#[test]
fn schrappen_van_geheimen() {
    assert_eq!(scrub("token sbp_123abc is fout", &[]), "token *** is fout");
    assert_eq!(scrub("sleutel sb_secret_ABCdef12 hier", &[]), "sleutel *** hier");
    assert_eq!(scrub("jwt eyJhbGciOi.eyJyb2xlIjoic2Vy.abc123 klaar", &[]), "jwt *** klaar");
    assert_eq!(scrub("mijn wachtwoord hunter2hunter2 hier", &["hunter2hunter2"]), "mijn wachtwoord *** hier");
    assert_eq!(scrub("gewone tekst blijft", &["kort"]), "gewone tekst blijft"); // te korte geheimen worden niet vervangen
    assert_eq!(scrub("sb_publishable_abc is publiek", &[]), "sb_publishable_abc is publiek");
}

#[test]
fn alleen_de_publieke_sleutel_wordt_teruggegeven() {
    let lijst = r#"[{"name":"service_role","type":"legacy","api_key":"GEHEIME-SERVICE-SLEUTEL"},{"name":"default","type":"secret","api_key":"sb_secret_GEHEIM"},{"name":"default","type":"publishable","api_key":"sb_publishable_OPENBAAR"}]"#;
    let http = MockHttp::new(vec![ok(200, lijst)]);
    let k = Client::new(&http, "tok").public_key("abc").unwrap();
    assert_eq!(k.publishable, "sb_publishable_OPENBAAR");
    // Verouderde anon-sleutel als terugval.
    let http = MockHttp::new(vec![ok(200, r#"[{"name":"service_role","api_key":"GEHEIM"},{"name":"anon","api_key":"eyJanon.x.y"}]"#)]);
    assert_eq!(Client::new(&http, "tok").public_key("abc").unwrap().publishable, "eyJanon.x.y");
    // Alleen geheime sleutels aanwezig: niets teruggeven.
    let http = MockHttp::new(vec![ok(200, r#"[{"name":"service_role","api_key":"GEHEIM"},{"type":"secret","api_key":"sb_secret_X"}]"#)]);
    assert_eq!(Client::new(&http, "tok").public_key("abc").unwrap_err(), SupaError::NotFound);
}

#[test]
fn geheimen_van_edge_functions_geven_alleen_namen() {
    let http = MockHttp::new(vec![ok(200, r#"[{"name":"STRIPE_KEY","value":"stripe-geheim"},{"name":"ANDERE"}]"#)]);
    let n = Client::new(&http, "tok").secret_names("abc").unwrap();
    assert_eq!(n, vec!["STRIPE_KEY".to_string(), "ANDERE".to_string()]);
}

#[test]
fn onveilige_referenties_en_namen_worden_geweigerd_voordat_er_iets_wordt_verstuurd() {
    let http = MockHttp::new(vec![]);
    let c = Client::new(&http, "tok");
    for r in ["", "../etc", "abc/def", "ABC", "a b", &"a".repeat(41), "abc?x=1"] {
        assert_eq!(c.project(r).unwrap_err(), SupaError::NotFound, "{r}");
        assert!(c.query(r, "select 1", true).is_err());
    }
    assert!(http.seen.lock().unwrap().is_empty());
    assert!(check_name("mijn-map_1", b"-_") && !check_name("../x", b"-_") && !check_name("", b"-_") && !check_name("a b", b"-_"));
}

#[test]
fn query_gebruikt_het_juiste_eindpunt() {
    let http = MockHttp::new(vec![ok(201, "[]"), ok(201, "[]")]);
    let c = Client::new(&http, "tok");
    c.query("abc", "select 1", true).unwrap();
    c.query("abc", "create table a (id int)", false).unwrap();
    let seen = http.seen.lock().unwrap();
    assert!(seen[0].1.ends_with("/v1/projects/abc/database/query/read-only"));
    assert!(seen[1].1.ends_with("/v1/projects/abc/database/query"));
}

#[test]
fn logs_url_wordt_veilig_gecodeerd() {
    let http = MockHttp::new(vec![ok(200, "{}")]);
    Client::new(&http, "tok").logs("abc", "select * from edge_logs limit 5 -- & x=1").unwrap();
    let u = http.seen.lock().unwrap()[0].1.clone();
    assert!(u.contains("sql=select%20%2A%20from%20edge_logs%20limit%205%20--%20%26%20x%3D1"), "{u}");
}
