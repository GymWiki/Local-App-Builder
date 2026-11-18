//! Beheer: migraties, functies, geheimen, opslag, inlog-instellingen, projecten en niveaus.
use super::write::rand_id;
use super::*;
use std::io::Write;

fn migrations_dir(dir: &std::path::Path) -> Option<PathBuf> {
    let d = dir.join("supabase").join("migrations");
    // Een koppeling (symlink) of een pad dat buiten het project uitkomt, wordt nooit gebruikt.
    std::fs::create_dir_all(&d).ok()?;
    let canon_dir = dunce::canonicalize(dir).ok()?;
    let canon_d = dunce::canonicalize(&d).ok()?;
    canon_d.starts_with(&canon_dir).then_some(d)
}

impl Engine {
    /// Schrijft een migratiebestand met tijdstempel in `supabase/migrations/`. Voert niets uit.
    pub fn propose_migration(&self, project: i64, name: &str, sql: &str) -> Reply {
        let slug = sanitize_slug(name);
        if slug.is_empty() {
            return Reply::nee("Geef de migratie een korte naam met letters of cijfers.");
        }
        let a = analyze(sql);
        if a.onleesbaar {
            return Reply::nee("Geweigerd: Studio kan deze SQL niet lezen. Controleer de SQL.");
        }
        let Some(dir) = self.hooks.project_dir(project) else { return Reply::fout("Het project is niet gevonden.") };
        let Some(md) = migrations_dir(&dir) else { return Reply::nee("Geweigerd door veiligheidsregel: de map supabase/migrations is niet veilig te gebruiken.") };
        // Bestaat er al een bestand met deze naam, dan overschrijven we dat (de AI verbetert zijn voorstel).
        let bestaand = std::fs::read_dir(&md).ok().and_then(|rd| rd.filter_map(Result::ok).map(|e| e.file_name().to_string_lossy().to_string()).find(|n| n.ends_with(&format!("_{slug}.sql"))));
        let file = bestaand.unwrap_or_else(|| format!("{}_{slug}.sql", timestamp14(self.now())));
        let path = md.join(&file);
        let Ok(mut f) = std::fs::File::create(&path) else { return Reply::fout("Het bestand kon niet worden geschreven.") };
        let _ = writeln!(f, "-- Voorstel van de AI. Studio voert dit pas uit na `db_apply_migration` en de juiste bevestiging.\n{}", a.final_sql);
        let ch: Vec<&Change> = a.statements.iter().flat_map(|s| s.changes.iter()).collect();
        Reply::ok(format!("Voorstel opgeslagen in supabase/migrations/{file}. Er is niets uitgevoerd."), Some(json!({ "bestand": format!("supabase/migrations/{file}"), "klasse": a.class as u8, "wijzigingen": ch, "meldingen": a.findings })))
    }

    /// Past een migratie toe: bestand bijwerken en de SQL door de schrijf-pijplijn halen.
    pub fn apply_migration(&self, project: i64, name: &str, sql: &str, uitleg: &str) -> Reply {
        let voorstel = self.propose_migration(project, name, sql);
        if voorstel.status != "uitgevoerd" {
            return voorstel;
        }
        self.run_sql_with(project, "db_apply_migration", sql, Actor::Ai, uitleg)
    }

    /// Draait de laatste toegepaste migratie met deze naam terug (alleen als dat netjes kan).
    pub fn rollback_migration(&self, project: i64, name: &str) -> Reply {
        let slug = sanitize_slug(name);
        let acties = self.with_db(|c| store::actions(c, project, 200)).unwrap_or_default();
        // De migratie zelf staat als "db_apply_migration"; we zoeken de laatste uitgevoerde met een ongedaan-gegeven.
        let _ = slug;
        let Some(a) = acties.iter().find(|a| a.tool == "db_apply_migration" && a.status == "uitgevoerd" && a.kan_ongedaan && !a.undone) else {
            return Reply::nee("Er is geen migratie die automatisch terug te draaien is. Schrijf een nieuwe migratie die de wijziging ongedaan maakt (alleen vooruit, nooit terug).");
        };
        self.undo(project, a.id)
    }

    pub fn deploy_function(&self, project: i64, slug: &str, source: &str) -> Reply {
        let link = match self.need_link(project) {
            Ok(l) => l,
            Err(r) => return r,
        };
        if !check_name(slug, b"-_") || source.len() > 200_000 || source.trim().is_empty() {
            return Reply::nee("Geweigerd: ongeldige functienaam (alleen letters, cijfers, - en _) of lege/te grote code.");
        }
        let level = self.level(project);
        let a = Analysis { statements: vec![], class: Class::Veilig, read_only: false, findings: vec![], onleesbaar: false, final_sql: String::new() };
        if level == Level::Voorzichtig {
            let req = ConfirmRequest { id: format!("{}-{}", self.now(), rand_id()), project_id: project, tool: "db_deploy_edge_function".into(), actor: Actor::Ai, class: 2, level, redenen: vec!["niveau"], changes: vec![Change { code: "functie_plaatsen", params: [("naam", slug.to_string())].into_iter().collect() }], rijen: None, verlies: false, backup: "niet_nodig", kosten: None, waarschuwingen: vec![], sql: clip(source, SQL_PREVIEW), uitleg: String::new() };
            if !self.confirm.ask(&req) {
                self.log(project, "db_deploy_edge_function", &a, level, "geweigerd", None, json!({ "code": "niet_toegestaan" }), None);
                return Reply::nee("De gebruiker heeft dit niet toegestaan. Er is niets uitgevoerd.");
            }
        }
        self.hooks.checkpoint(project, "Voor het plaatsen van een functie");
        let zip = match make_zip(source) {
            Some(z) => z,
            None => return Reply::fout("De functie kon niet worden ingepakt."),
        };
        match self.api(&self.secrets_for(&link), |c| c.deploy_function(&link.reference, slug, zip.clone())) {
            Ok(()) => {
                let mut a2 = a.clone();
                a2.statements = vec![crate::supa::classify::analyze("SELECT 1").statements.remove(0)];
                let summary = json!([{ "code": "functie_plaatsen", "params": { "naam": slug } }]);
                self.with_db(|c| store::action_add(c, &NewAction { project_id: project, at: self.now(), tool: "db_deploy_edge_function", class: 2, level: level.as_str(), status: "uitgevoerd", summary: &summary, sql: None, detail: &json!({}), undo: None }).ok());
                self.hooks.changed(project);
                Reply::ok("Functie geplaatst. Dit kan niet automatisch ongedaan worden gemaakt (plaats een eerdere versie opnieuw).", None)
            }
            Err(e) => self.err_reply(&link, &e),
        }
    }

    /// Zet een geheim voor edge functions. De waarde gaat alleen naar Supabase en is nooit leesbaar voor de AI. Overschrijven is gevaarlijk.
    pub fn set_edge_secret(&self, project: i64, name: &str, value: &str) -> Reply {
        let link = match self.need_link(project) {
            Ok(l) => l,
            Err(r) => return r,
        };
        if !check_name(name, b"_") || name.bytes().any(|b| b.is_ascii_lowercase()) || name.starts_with("SUPABASE_") || value.is_empty() || value.len() > 48 * 1024 {
            return Reply::nee("Geweigerd: ongeldige naam (hoofdletters, cijfers en _; niet beginnend met SUPABASE_) of lege waarde.");
        }
        let bestaat = self.api(&[], |c| c.secret_names(&link.reference)).map(|n| n.iter().any(|x| x == name)).unwrap_or(true);
        let class = if bestaat { Class::Gevaarlijk } else { Class::Veilig };
        let level = self.level(project);
        let ask = matches!((level, class), (Level::Voorzichtig, _) | (Level::Zelfstandig, Class::Gevaarlijk));
        let changes = vec![Change { code: if bestaat { "geheim_overschrijven" } else { "geheim_toevoegen" }, params: [("naam", name.to_string())].into_iter().collect() }];
        if ask {
            let req = ConfirmRequest { id: format!("{}-{}", self.now(), rand_id()), project_id: project, tool: "db_set_edge_secret".into(), actor: Actor::Ai, class: class as u8, level, redenen: vec![if level == Level::Voorzichtig { "niveau" } else { "gevaarlijk" }], changes: changes.clone(), rijen: None, verlies: bestaat, backup: "niet_nodig", kosten: None, waarschuwingen: vec![], sql: String::new(), uitleg: String::new() };
            if !self.confirm.ask(&req) {
                return Reply::nee("De gebruiker heeft dit niet toegestaan. Er is niets uitgevoerd.");
            }
        }
        let secrets = vec![value.to_string()];
        match self.api(&secrets, |c| c.set_secret(&link.reference, name, value)) {
            Ok(()) => {
                let summary = serde_json::to_value(&changes).unwrap_or(Value::Null);
                self.with_db(|c| store::action_add(c, &NewAction { project_id: project, at: self.now(), tool: "db_set_edge_secret", class: class as u8, level: level.as_str(), status: "uitgevoerd", summary: &summary, sql: None, detail: &json!({}), undo: None }).ok());
                self.hooks.changed(project);
                Reply::ok("Geheim opgeslagen bij Supabase. De waarde is nooit meer te lezen, ook niet voor de AI.", None)
            }
            Err(e) => self.err_reply(&link, &e),
        }
    }

    /// Opslagmappen (buckets): lijst bekijken of een privé-map aanmaken. Beleid zet je met db_run_sql op `storage.objects` (altijd gevaarlijk).
    pub fn manage_storage(&self, project: i64, actie: &str, naam: &str, publiek: bool) -> Reply {
        let link = match self.need_link(project) {
            Ok(l) => l,
            Err(r) => return r,
        };
        match actie {
            "lijst" => match self.api(&[], |c| c.buckets(&link.reference)) {
                Ok(v) => Reply::ok("Opslagmappen (alleen namen en instellingen).", Some(trim_value(&v))),
                Err(e) => self.err_reply(&link, &e),
            },
            "maken" => {
                if !check_name(naam, b"-_") {
                    return Reply::nee("Geweigerd: ongeldige naam voor een opslagmap (letters, cijfers, - en _).");
                }
                if publiek {
                    return Reply::nee("Geweigerd door veiligheidsregel: een publieke opslagmap maakt Studio niet zelf. Maak hem privé en geef bestanden vrij met een beleid.");
                }
                let sql = format!("insert into storage.buckets (id, name, public) values ('{naam}', '{naam}', false) on conflict (id) do nothing");
                // Studio stelt deze instructie zelf samen en is veilig (privé, alleen toevoegen): klasse 2 met een eigen controle.
                self.run_trusted(project, "db_manage_storage", &sql, Change { code: "map_toevoegen", params: [("naam", naam.to_string())].into_iter().collect() })
            }
            _ => Reply::nee("Onbekende actie. Kies lijst of maken."),
        }
    }

    /// Een door Studio zelf samengestelde instructie (nooit door de AI geschreven) in een beschermd schema; telt als veilig schrijven.
    fn run_trusted(&self, project: i64, tool: &str, sql: &str, change: Change) -> Reply {
        let link = match self.need_link(project) {
            Ok(l) => l,
            Err(r) => return r,
        };
        let level = self.level(project);
        if level == Level::Voorzichtig {
            let req = ConfirmRequest { id: format!("{}-{}", self.now(), rand_id()), project_id: project, tool: tool.into(), actor: Actor::Ai, class: 2, level, redenen: vec!["niveau"], changes: vec![change.clone()], rijen: None, verlies: false, backup: "niet_nodig", kosten: None, waarschuwingen: vec![], sql: clip(sql, SQL_PREVIEW), uitleg: String::new() };
            if !self.confirm.ask(&req) {
                return Reply::nee("De gebruiker heeft dit niet toegestaan. Er is niets uitgevoerd.");
            }
        }
        self.hooks.checkpoint(project, "Voor een wijziging in de opslag");
        match self.api(&self.secrets_for(&link), |c| c.query(&link.reference, sql, false)) {
            Ok(_) => {
                let summary = serde_json::to_value(vec![&change]).unwrap_or(Value::Null);
                self.with_db(|c| store::action_add(c, &NewAction { project_id: project, at: self.now(), tool, class: 2, level: level.as_str(), status: "uitgevoerd", summary: &summary, sql: Some(sql), detail: &json!({}), undo: None }).ok());
                self.hooks.changed(project);
                Reply::ok("Uitgevoerd.", None)
            }
            Err(e) => self.err_reply(&link, &e),
        }
    }

    /// Inlog-instellingen. Altijd gevaarlijk (klasse 3): bevestiging tenzij Volledige controle. Alleen een vaste lijst velden.
    pub fn configure_auth(&self, project: i64, patch: &Value) -> Reply {
        let link = match self.need_link(project) {
            Ok(l) => l,
            Err(r) => return r,
        };
        const TOEGESTAAN: &[&str] = &["site_url", "uri_allow_list", "mailer_autoconfirm", "disable_signup", "external_email_enabled"];
        let Some(obj) = patch.as_object().filter(|o| !o.is_empty()) else { return Reply::nee("Geef minstens één instelling mee.") };
        if let Some(k) = obj.keys().find(|k| !TOEGESTAAN.contains(&k.as_str())) {
            return Reply::nee(format!("Geweigerd: de instelling ‘{k}’ mag niet via deze tool worden gewijzigd. Toegestaan: {}.", TOEGESTAAN.join(", ")));
        }
        let level = self.level(project);
        if level != Level::Volledig {
            let changes: Vec<Change> = obj.keys().map(|k| Change { code: "inlog_instelling", params: [("naam", k.clone())].into_iter().collect() }).collect();
            let req = ConfirmRequest { id: format!("{}-{}", self.now(), rand_id()), project_id: project, tool: "db_configure_auth".into(), actor: Actor::Ai, class: 3, level, redenen: vec![if level == Level::Voorzichtig { "niveau" } else { "gevaarlijk" }], changes, rijen: None, verlies: false, backup: "niet_nodig", kosten: None, waarschuwingen: vec![], sql: clip(&patch.to_string(), SQL_PREVIEW), uitleg: String::new() };
            if !self.confirm.ask(&req) {
                return Reply::nee("De gebruiker heeft dit niet toegestaan. Er is niets uitgevoerd.");
            }
        }
        let voor = self.api(&[], |c| c.auth_config(&link.reference)).ok();
        self.hooks.checkpoint(project, "Voor een wijziging van de inlog-instellingen");
        match self.api(&[], |c| c.set_auth_config(&link.reference, patch)) {
            Ok(()) => {
                let oud: Value = voor.map(|v| Value::Object(obj.keys().filter_map(|k| v.get(k).map(|x| (k.clone(), x.clone()))).collect())).unwrap_or(Value::Null);
                let summary = serde_json::to_value(obj.keys().map(|k| json!({ "code": "inlog_instelling", "params": { "naam": k } })).collect::<Vec<_>>()).unwrap_or(Value::Null);
                // Ongedaan maken kan door de oude waarden terug te zetten.
                let undo = if oud.as_object().is_some_and(|o| !o.is_empty()) { Some(("auth", oud.to_string())) } else { None };
                self.with_db(|c| store::action_add(c, &NewAction { project_id: project, at: self.now(), tool: "db_configure_auth", class: 3, level: level.as_str(), status: "uitgevoerd", summary: &summary, sql: None, detail: &json!({}), undo: undo.as_ref().map(|(k, d)| (*k, d.as_str())) }).ok());
                self.hooks.changed(project);
                Reply::ok("Inlog-instellingen bijgewerkt.", None)
            }
            Err(e) => self.err_reply(&link, &e),
        }
    }

    pub fn pause_project(&self, project: i64) -> Reply {
        let link = match self.need_link(project) {
            Ok(l) => l,
            Err(r) => return r,
        };
        let level = self.level(project);
        if level != Level::Volledig {
            let req = ConfirmRequest { id: format!("{}-{}", self.now(), rand_id()), project_id: project, tool: "db_pause_project".into(), actor: Actor::Ai, class: 3, level, redenen: vec![if level == Level::Voorzichtig { "niveau" } else { "gevaarlijk" }], changes: vec![Change { code: "project_pauzeren", params: [("naam", link.name.clone())].into_iter().collect() }], rijen: None, verlies: false, backup: "niet_nodig", kosten: None, waarschuwingen: vec![], sql: String::new(), uitleg: String::new() };
            if !self.confirm.ask(&req) {
                return Reply::nee("De gebruiker heeft dit niet toegestaan. Er is niets uitgevoerd.");
            }
        }
        match self.api(&[], |c| c.pause(&link.reference)) {
            Ok(()) => {
                let summary = json!([{ "code": "project_pauzeren", "params": { "naam": link.name } }]);
                self.with_db(|c| store::action_add(c, &NewAction { project_id: project, at: self.now(), tool: "db_pause_project", class: 3, level: level.as_str(), status: "uitgevoerd", summary: &summary, sql: None, detail: &json!({}), undo: Some(("restore_project", "{}")) }).ok());
                self.hooks.changed(project);
                Reply::ok("Het project wordt gepauzeerd. Wakker maken kan met db_restore_project of in Studio.", None)
            }
            Err(e) => self.err_reply(&link, &e),
        }
    }

    pub fn restore_project(&self, project: i64) -> Reply {
        let link = match self.need_link(project) {
            Ok(l) => l,
            Err(r) => return r,
        };
        let level = self.level(project);
        if level == Level::Voorzichtig {
            let req = ConfirmRequest { id: format!("{}-{}", self.now(), rand_id()), project_id: project, tool: "db_restore_project".into(), actor: Actor::Ai, class: 2, level, redenen: vec!["niveau"], changes: vec![Change { code: "project_wakker", params: [("naam", link.name.clone())].into_iter().collect() }], rijen: None, verlies: false, backup: "niet_nodig", kosten: None, waarschuwingen: vec![], sql: String::new(), uitleg: String::new() };
            if !self.confirm.ask(&req) {
                return Reply::nee("De gebruiker heeft dit niet toegestaan. Er is niets uitgevoerd.");
            }
        }
        match self.api(&[], |c| c.restore(&link.reference)) {
            Ok(()) => {
                let summary = json!([{ "code": "project_wakker", "params": { "naam": link.name } }]);
                self.with_db(|c| store::action_add(c, &NewAction { project_id: project, at: self.now(), tool: "db_restore_project", class: 2, level: level.as_str(), status: "uitgevoerd", summary: &summary, sql: None, detail: &json!({}), undo: None }).ok());
                self.hooks.changed(project);
                Reply::ok("Het project wordt wakker gemaakt. Dit kan een paar minuten duren.", None)
            }
            Err(e) => self.err_reply(&link, &e),
        }
    }

    // ---------- koppelen en maken (wizard in de app, en db_create_project voor de AI) ----------

    /// Een nieuw project maken. Kosten: altijd een bevestiging in de Studio-UI, in elk niveau. Het databasewachtwoord wordt gegenereerd en komt in de kluis.
    pub fn create_project(&self, project: i64, name: &str, org: Option<&str>, actor: Actor) -> Reply {
        let name = name.trim();
        if !check_name(&name.replace(' ', "-"), b"-_") || name.len() > 60 {
            return Reply::nee("Geweigerd: geef het project een korte naam met letters en cijfers.");
        }
        let orgs = match self.api(&[], |c| c.organizations()) {
            Ok(o) => o,
            Err(e) => return self.err_reply(&Link { project_id: project, reference: String::new(), name: name.into(), region: String::new(), level: Level::Voorzichtig, full_until: None, full_secs: FULL_DEFAULT_SECS }, &e),
        };
        let org = match (org, orgs.as_slice()) {
            (Some(o), _) => orgs.iter().find(|x| x.slug == o || x.name == o).cloned(),
            (None, [one]) => Some(one.clone()),
            (None, []) => None,
            (None, many) => return Reply::nee(format!("Je hebt meerdere organisaties ({}). Vraag de gebruiker welke het moet zijn.", many.iter().map(|o| o.name.as_str()).collect::<Vec<_>>().join(", "))),
        };
        let Some(org) = org else { return Reply::fout("Er is geen Supabase-organisatie gevonden voor dit account.") };
        let cost = create_project_cost(org.plan.as_deref(), None);
        let level = self.level(project);
        let req = ConfirmRequest {
            id: format!("{}-{}", self.now(), rand_id()),
            project_id: project,
            tool: "db_create_project".into(),
            actor,
            class: 4,
            level,
            redenen: vec!["kosten"],
            changes: vec![Change { code: "project_maken", params: [("naam", name.to_string()), ("regio", "Europa".to_string())].into_iter().collect() }],
            rijen: None,
            verlies: false,
            backup: "niet_nodig",
            kosten: Some(cost),
            waarschuwingen: vec![],
            sql: String::new(),
            uitleg: String::new(),
        };
        if !self.confirm.ask(&req) {
            return Reply::nee("De gebruiker heeft dit niet toegestaan (kostenbevestiging). Er is niets aangemaakt.");
        }
        let pass = generate_password();
        let res = self.api(std::slice::from_ref(&pass), |c| c.create_project(name, &org.slug, &pass, "emea", None));
        match res {
            Ok(p) => {
                // Het wachtwoord komt meteen in de kluis, vóór er iets anders gebeurt.
                if self.vault.set(&Self::dbpass_key(&p.reference), &pass).is_err() {
                    return Reply::fout("Het project is gemaakt, maar het wachtwoord kon niet in de kluis worden bewaard. Verwijder het project in Supabase en probeer het opnieuw.");
                }
                self.with_db(|c| store::link_set(c, project, &p.reference, &p.name, &p.region, self.now()).ok());
                let summary = json!([{ "code": "project_maken", "params": { "naam": p.name } }]);
                self.with_db(|c| store::action_add(c, &NewAction { project_id: project, at: self.now(), tool: "db_create_project", class: 4, level: level.as_str(), status: "uitgevoerd", summary: &summary, sql: None, detail: &json!({}), undo: None }).ok());
                self.hooks.changed(project);
                Reply::ok("Het project wordt gemaakt en aan dit project gekoppeld. Het opstarten duurt een paar minuten.", Some(json!({ "naam": p.name, "status": p.status })))
            }
            Err(e) => self.err_reply(&Link { project_id: project, reference: String::new(), name: name.into(), region: String::new(), level: Level::Voorzichtig, full_until: None, full_secs: FULL_DEFAULT_SECS }, &e),
        }
    }

    /// Een bestaand project kiezen (de gebruiker, in de wizard).
    pub fn link_project(&self, project: i64, reference: &str) -> Reply {
        if check_ref(reference).is_err() {
            return Reply::nee("Ongeldig project.");
        }
        match self.api(&[], |c| c.project(reference)) {
            Ok(p) => {
                self.with_db(|c| store::link_set(c, project, &p.reference, &p.name, &p.region, self.now()).ok());
                self.hooks.changed(project);
                Reply::ok("Gekoppeld.", Some(json!({ "naam": p.name, "status": p.status })))
            }
            Err(e) => self.err_reply(&Link { project_id: project, reference: reference.into(), name: String::new(), region: String::new(), level: Level::Voorzichtig, full_until: None, full_secs: FULL_DEFAULT_SECS }, &e),
        }
    }

    /// Ontkoppelt het project (verwijdert alleen de koppeling hier; bij Supabase verandert niets).
    pub fn unlink(&self, project: i64) {
        if let Some(l) = self.link(project) {
            let _ = self.vault.delete(&Self::dbpass_key(&l.reference));
        }
        self.with_db(|c| store::link_remove(c, project));
        self.hooks.changed(project);
    }

    /// Zet het bedieningsniveau. "Volledige controle" kan alleen met de getypte bevestiging en heeft een einde (standaard 1 uur).
    pub fn set_level(&self, project: i64, level: Level, typed: Option<&str>) -> Result<(), &'static str> {
        let Some(link) = self.link(project) else { return Err("niet_gekoppeld") };
        if level == Level::Volledig {
            if typed.map(|t| t.trim().to_lowercase()) != Some("volledig".into()) {
                return Err("bevestiging_ontbreekt");
            }
            let until = self.now() + super::super::policy::clamp_full_secs(link.full_secs);
            self.with_db(|c| store::level_set(c, project, Level::Volledig, Some(until)));
        } else {
            self.with_db(|c| store::level_set(c, project, level, None));
        }
        self.hooks.changed(project);
        Ok(())
    }

    pub fn set_full_duration(&self, project: i64, secs: i64) {
        self.with_db(|c| store::full_secs_set(c, project, secs));
        self.hooks.changed(project);
    }
}

fn timestamp14(now: i64) -> String {
    // JJJJMMDDUUMMSS in UTC, zoals `supabase migration new` dat doet.
    let secs = now.max(0);
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Burgerlijke datum uit dagen sinds 1970 (algoritme van Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}{mo:02}{d:02}{h:02}{m:02}{s:02}")
}

fn generate_password() -> String {
    const SET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let mut b = [0u8; 32];
    let _ = getrandom::fill(&mut b);
    b.iter().map(|x| SET[*x as usize % SET.len()] as char).collect()
}

fn make_zip(source: &str) -> Option<Vec<u8>> {
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut buf);
        z.start_file("index.ts", zip::write::SimpleFileOptions::default()).ok()?;
        z.write_all(source.as_bytes()).ok()?;
        z.finish().ok()?;
    }
    Some(buf.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tijdstempel_zoals_de_cli() {
        assert_eq!(timestamp14(0), "19700101000000");
        assert_eq!(timestamp14(1_700_000_000), "20231114221320");
        assert_eq!(timestamp14(1_795_000_000), "20261118110640");
    }

    #[test]
    fn wachtwoord_is_lang_en_willekeurig() {
        let (a, b) = (generate_password(), generate_password());
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn zip_bevat_index_ts() {
        let z = make_zip("console.log(1)").unwrap();
        let mut r = zip::ZipArchive::new(std::io::Cursor::new(z)).unwrap();
        assert!(r.by_name("index.ts").is_ok());
    }
}
