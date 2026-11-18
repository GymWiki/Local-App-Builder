//! De schrijf-pijplijn: één plek waar elke SQL-wijziging langs moet (AI, gebruiker en "ongedaan maken").
use super::*;
use crate::supa::classify::Ernst;
use crate::supa::policy::Decision;

/// Een uitleg voor de AI als een veiligheidsregel de actie weigert.
fn refuse_text(code: &str) -> &'static str {
    match code {
        "rls_uit" => "RLS (de beveiliging per rij) uitzetten is niet toegestaan, behalve bij Volledige controle.",
        "beleid_alles_schrijfbaar" => "een beleid dat iedereen laat schrijven is niet toegestaan, behalve bij Volledige controle. Schrijf een beleid per rol met een voorwaarde, bijvoorbeeld (select auth.uid()) = user_id.",
        _ => "dit mag niet op het huidige niveau.",
    }
}

fn first_number(v: &Value) -> Option<u64> {
    let row = v.get(0)?;
    let obj = row.as_object()?;
    obj.values().next().and_then(|x| x.as_u64().or_else(|| x.as_str().and_then(|s| s.parse().ok())))
}

impl Engine {
    /// Telt hoeveel rijen een instructie raakt (alleen-lezen vragen) en hoeveel een INSERT toevoegt.
    fn measure(&self, link: &Link, a: &Analysis) -> (RowCount, Option<u64>) {
        let mut rows = RowCount::Geen;
        let mut max = 0u64;
        let secrets = self.secrets_for(link);
        for i in a.statements.iter().flat_map(|s| s.impact.iter()) {
            match i.telsql.as_deref().map(|q| self.api(&secrets, |c| c.query(&link.reference, q, true))) {
                Some(Ok(v)) => match first_number(&v) {
                    Some(n) => max = max.max(n),
                    None => rows = RowCount::Onbekend,
                },
                _ => rows = RowCount::Onbekend,
            }
        }
        if rows != RowCount::Onbekend && a.statements.iter().any(|s| !s.impact.is_empty()) {
            rows = RowCount::Exact(max);
        }
        let mut ins: Option<u64> = None;
        for c in a.statements.iter().flat_map(|s| s.changes.iter()).filter(|c| c.code == "rijen_toevoegen") {
            let n = c.params.get("aantal").and_then(|x| x.parse::<u64>().ok()).unwrap_or(u64::MAX / 4);
            ins = Some(ins.unwrap_or(0).saturating_add(n));
        }
        (rows, ins)
    }

    /// Een lokale back-up (JSON) van de rijen die een gevaarlijke actie raakt. Alleen op deze computer, nooit in het project.
    fn backup(&self, project: i64, link: &Link, a: &Analysis) -> (Backup, Vec<(String, PathBuf, &'static str)>) {
        let mut files = vec![];
        let mut failed = false;
        let secrets = self.secrets_for(link);
        for s in &a.statements {
            if s.reden == "drop_column" || s.reden == "alter_onbekend" || s.reden == "onbekend" || s.reden == "onleesbaar" {
                failed = true; // wat er verdwijnt is niet te bewaren
            }
            for i in &s.impact {
                let Some(tel) = &i.telsql else {
                    failed = true;
                    continue;
                };
                let sql = format!("{} LIMIT {}", tel.replacen("SELECT count(*) FROM", "SELECT * FROM", 1), BACKUP_MAX_ROWS + 1);
                match self.api(&secrets, |c| c.query(&link.reference, &sql, true)) {
                    Ok(v) => {
                        let n = v.as_array().map(|a| a.len()).unwrap_or(0);
                        let text = v.to_string();
                        if n > BACKUP_MAX_ROWS || text.len() > BACKUP_MAX_BYTES {
                            failed = true;
                            continue;
                        }
                        if n == 0 {
                            continue;
                        }
                        let dir = self.backup_dir.join(project.to_string());
                        let name = format!("{}-{}.json", self.now(), sanitize_slug(&i.tabel));
                        if std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(dir.join(&name), &text)).is_err() {
                            failed = true;
                            continue;
                        }
                        files.push((i.tabel.clone(), dir.join(name), i.soort));
                    }
                    Err(_) => failed = true,
                }
            }
        }
        (if failed { Backup::Mislukt } else if files.is_empty() { Backup::NietNodig } else { Backup::Gemaakt }, files)
    }

    fn drop_backups(files: &[(String, PathBuf, &'static str)]) {
        for (_, p, _) in files {
            let _ = std::fs::remove_file(p);
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn log(&self, project: i64, tool: &str, a: &Analysis, level: Level, status: &str, sql: Option<&str>, detail: Value, undo: Option<(&str, &str)>) -> Option<i64> {
        let changes: Vec<&Change> = a.statements.iter().flat_map(|s| s.changes.iter()).collect();
        let summary = serde_json::to_value(&changes).unwrap_or(Value::Null);
        let secrets: Vec<String> = vec![];
        let sql = sql.map(|s| scrub(s, &secrets.iter().map(String::as_str).collect::<Vec<_>>()));
        let id = self.with_db(|c| store::action_add(c, &NewAction { project_id: project, at: self.now(), tool, class: a.class as u8, level: level.as_str(), status, summary: &summary, sql: sql.as_deref(), detail: &detail, undo }).ok()).flatten();
        self.hooks.changed(project);
        id
    }

    /// Houdt gelijke fouten achter elkaar bij; bij de drempel stopt Studio de AI (bug-lus bewaker).
    fn note_failure(&self, project: i64, code: &str) -> bool {
        let mut m = self.failures.lock().unwrap();
        let e = m.entry(project).or_insert((String::new(), 0));
        if e.0 == code {
            e.1 += 1;
        } else {
            *e = (code.to_string(), 1);
        }
        let hit = e.1 >= self.hooks.loop_threshold();
        if hit {
            e.1 = 0;
        }
        hit
    }

    fn note_success(&self, project: i64) {
        self.failures.lock().unwrap().remove(&project);
    }

    /// De pijplijn. `tool` is de naam van de MCP-tool (of "gegevens_scherm" / "ongedaan_maken").
    pub fn run_sql(&self, project: i64, tool: &str, sql: &str, actor: Actor) -> Reply {
        self.run_sql_with(project, tool, sql, actor, "")
    }

    pub fn run_sql_with(&self, project: i64, tool: &str, sql: &str, actor: Actor, uitleg: &str) -> Reply {
        let link = match self.need_link(project) {
            Ok(l) => l,
            Err(r) => return r,
        };
        let a = analyze(sql);
        let level = self.level(project);
        if a.read_only && actor == Actor::Ai {
            // Klasse 1: vrij, zonder bevestiging, en via het alleen-lezen-eindpunt (zodat een verborgen schrijfactie toch faalt).
            return match self.api(&self.secrets_for(&link), |c| c.query(&link.reference, sql, true)) {
                Ok(v) => {
                    let (d, cut) = limit_value(&v, 200);
                    Reply::ok(if cut { "Resultaat (afgekapt)." } else { "Resultaat." }, Some(d))
                }
                Err(e) => self.err_reply(&link, &e),
            };
        }
        let gen = self.generation.load(Ordering::SeqCst);
        // 1. grenzen
        {
            let now = self.now();
            let mut l = self.limiters.lock().unwrap();
            if let Err(e) = l.entry(project).or_default().check(now) {
                drop(l);
                self.log(project, tool, &a, level, "geweigerd", Some(sql), json!({ "code": match e { LimitError::PerMinuut => "limiet_minuut", LimitError::PerSessie => "limiet_sessie" } }), None);
                return Reply::nee(match e {
                    LimitError::PerMinuut => "Geweigerd door veiligheidsregel: te veel wijzigingen per minuut. Wacht een minuut.",
                    LimitError::PerSessie => "Geweigerd door veiligheidsregel: de limiet aan wijzigingen in deze sessie is bereikt. Laat de gebruiker de limiet vernieuwen door Studio opnieuw te openen.",
                });
            }
        }
        // 2. meten en back-up
        let (rows, inserted) = self.measure(&link, &a);
        let (backup, files) = if a.class == Class::Gevaarlijk { self.backup(project, &link, &a) } else { (Backup::NietNodig, vec![]) };
        let facts = Facts { rows, inserted, backup };
        // 3. besluit
        let mut decision = decide(level, &a, &facts);
        if actor == Actor::Gebruiker && !matches!(decision, Decision::Refuse { .. }) {
            // Wat de gebruiker zelf in het scherm doet, vraagt altijd een bevestiging.
            decision = Decision::Confirm { redenen: vec!["gebruiker"] };
        }
        match &decision {
            Decision::Refuse { code } => {
                Self::drop_backups(&files);
                self.log(project, tool, &a, level, "geweigerd", Some(sql), json!({ "code": code }), None);
                return Reply::nee(format!("Geweigerd door veiligheidsregel: {}", refuse_text(code)));
            }
            Decision::Confirm { redenen } => {
                let req = ConfirmRequest {
                    id: format!("{}-{}", self.now(), rand_id()),
                    project_id: project,
                    tool: tool.to_string(),
                    actor,
                    class: a.class as u8,
                    level,
                    redenen: redenen.clone(),
                    changes: a.statements.iter().flat_map(|s| s.changes.clone()).collect(),
                    rijen: match rows {
                        RowCount::Exact(n) => Some(n),
                        _ => None,
                    },
                    verlies: a.class == Class::Gevaarlijk && verlies(&a.statements.iter().flat_map(|s| s.changes.clone()).collect::<Vec<_>>()),
                    backup: match backup {
                        Backup::Gemaakt => "gemaakt",
                        Backup::Mislukt => "mislukt",
                        Backup::NietNodig => "niet_nodig",
                    },
                    kosten: None,
                    waarschuwingen: a.findings.clone(),
                    sql: clip(&a.final_sql, SQL_PREVIEW),
                    uitleg: clip(uitleg, 500),
                };
                if !self.confirm.ask(&req) {
                    Self::drop_backups(&files);
                    self.log(project, tool, &a, level, "geweigerd", Some(sql), json!({ "code": "niet_toegestaan" }), None);
                    return Reply::nee("De gebruiker heeft dit niet toegestaan (of niet op tijd gereageerd). Er is niets uitgevoerd. Doe niet alsof het gelukt is.");
                }
            }
            Decision::Allow => {}
        }
        // Een noodknop tijdens het wachten betekent: niet meer uitvoeren.
        if self.generation.load(Ordering::SeqCst) != gen {
            Self::drop_backups(&files);
            self.log(project, tool, &a, level, "afgebroken", Some(sql), json!({ "code": "noodknop" }), None);
            return Reply::nee("Afgebroken: de gebruiker drukte op de noodknop. Er is niets uitgevoerd.");
        }
        let waarschuwing_log = a.findings.iter().any(|f| f.ernst == Ernst::Weiger) && level == Level::Volledig;
        // 4. vangnet
        let checkpoint = self.hooks.checkpoint(project, &format!("Voor een wijziging in de database ({tool})"));
        let snapshot = self.api(&self.secrets_for(&link), |c| c.query(&link.reference, Self::LIST_TABLES_SQL, true)).ok().map(|v| trim_value(&Self::first_data(&v)));
        // 5. uitvoeren
        let res = self.api(&self.secrets_for(&link), |c| c.query(&link.reference, &a.final_sql, false));
        match res {
            Ok(v) => {
                self.limiters.lock().unwrap().entry(project).or_default().record(self.now());
                self.note_success(project);
                let restore: Vec<Value> = files.iter().filter(|f| matches!(f.2, "rijen_verwijderen" | "tabel_leegmaken")).map(|f| json!({ "tabel": f.0, "bestand": f.1.to_string_lossy() })).collect();
                let undo_pair: Option<(String, String)> = if let Some(inv) = undo::inverse_sql(sql) {
                    Some(("sql".into(), inv))
                } else if !restore.is_empty() {
                    Some(("restore".into(), json!({ "tabellen": restore }).to_string()))
                } else {
                    None
                };
                let detail = json!({ "checkpoint": checkpoint, "schema_voor": snapshot, "back_up": files.iter().map(|f| json!({ "tabel": f.0, "bestand": f.1.to_string_lossy() })).collect::<Vec<_>>(), "backup": match backup { Backup::Gemaakt => "gemaakt", Backup::Mislukt => "mislukt", Backup::NietNodig => "niet_nodig" }, "rijen": match rows { RowCount::Exact(n) => json!(n), _ => Value::Null }, "waarschuwing": waarschuwing_log, "waarschuwingen": a.findings.iter().map(|f| f.code).collect::<Vec<_>>() });
                let id = self.log(project, tool, &a, level, "uitgevoerd", Some(sql), detail, undo_pair.as_ref().map(|(k, d)| (k.as_str(), d.as_str())));
                let (data, _) = limit_value(&v, 50);
                let mut txt = String::from("Uitgevoerd.");
                if a.findings.iter().any(|f| f.code == "rls_automatisch_aan") {
                    txt.push_str(" Studio heeft RLS (beveiliging per rij) voor de nieuwe tabel aangezet. Zonder beleid is de tabel via de app nog niet bereikbaar: voeg beleid per rol toe.");
                }
                if undo_pair.is_none() && a.class >= Class::Veilig {
                    txt.push_str(" Dit kan niet automatisch ongedaan worden gemaakt.");
                }
                Reply::ok(txt, Some(json!({ "resultaat": data, "actie": id })))
            }
            Err(e) => {
                let code = e.code();
                self.log(project, tool, &a, level, "mislukt", Some(sql), json!({ "code": code, "detail": e.detail() }), None);
                Self::drop_backups(&files);
                let mut r = self.err_reply(&link, &e);
                if self.note_failure(project, &code) {
                    self.hooks.stop_ai(project);
                    r.tekst.push_str(" Dit is nu meerdere keren dezelfde fout. Studio heeft de AI gestopt zodat jullie samen kunnen kiezen wat nu.");
                }
                r
            }
        }
    }

    /// De noodknop: breekt wachtende en lopende acties af, zet het niveau terug naar Voorzichtig en stopt de AI.
    pub fn emergency_stop(&self, project: i64) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.with_db(|c| store::level_set(c, project, Level::Voorzichtig, None));
        self.hooks.stop_ai(project);
        self.hooks.changed(project);
    }

    /// "Maak ongedaan" voor een eerdere actie. Altijd met een bevestiging van de gebruiker.
    pub fn undo(&self, project: i64, action_id: i64) -> Reply {
        let Some((kind, data, done)) = self.with_db(|c| store::undo_get(c, project, action_id)).flatten() else { return Reply::nee("Dit kan niet ongedaan worden gemaakt.") };
        if done {
            return Reply::nee("Dit is al ongedaan gemaakt.");
        }
        let sql = match kind.as_str() {
            "sql" => data,
            "restore" => {
                let v: Value = serde_json::from_str(&data).unwrap_or(Value::Null);
                let mut stmts = vec![];
                for (i, t) in v["tabellen"].as_array().cloned().unwrap_or_default().iter().enumerate() {
                    let (Some(tabel), Some(pad)) = (t["tabel"].as_str(), t["bestand"].as_str()) else { return Reply::nee("De back-up is niet meer te vinden.") };
                    let Ok(rows) = std::fs::read_to_string(pad) else { return Reply::nee("De back-up is niet meer te vinden.") };
                    let Some(s) = undo::restore_rows_sql(tabel, &rows, 1 + i as u64) else { return Reply::nee("De back-up kan niet worden teruggezet.") };
                    stmts.push(s);
                }
                stmts.join("\n")
            }
            _ => return Reply::nee("Dit kan niet ongedaan worden gemaakt."),
        };
        let r = self.run_sql(project, "ongedaan_maken", &sql, Actor::Gebruiker);
        if r.status == "uitgevoerd" {
            self.with_db(|c| store::undo_done(c, action_id));
            self.hooks.changed(project);
        }
        r
    }
}

pub(super) fn rand_id() -> u64 {
    let mut b = [0u8; 8];
    let _ = getrandom::fill(&mut b);
    u64::from_le_bytes(b)
}
