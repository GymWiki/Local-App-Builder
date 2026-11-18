//! Risicoklassen voor SQL. Studio leest de SQL met een echte parser (PostgreSQL-dialect) en deelt elke instructie in:
//! 1 lezen · 2 veilig schrijven · 3 gevaarlijk. (Klasse 4, kosten, komt niet uit SQL maar uit de actie zelf.)
//! Bij twijfel (onleesbaar, onbekend, meerdere instructies, rare tekens) geldt de hoogste klasse die erin voorkomt: gevaarlijk.
use serde::Serialize;
use sqlparser::ast::{
    visit_expressions, visit_relations, AlterColumnOperation, AlterTableOperation, CreatePolicyCommand, Expr, FromTable, ObjectName, ObjectType, SetExpr, Statement, TableFactor, TableObject, TableWithJoins,
};
use sqlparser::dialect::PostgreSqlDialect;
use sqlparser::parser::Parser;
use std::collections::BTreeMap;
use std::ops::ControlFlow;

/// De grootste SQL die Studio wil lezen (een bescherming tegen onzin en tegen trucs met enorme invoer).
pub const MAX_SQL_BYTES: usize = 200_000;
/// Schema's van Supabase zelf: schrijven daarin is altijd gevaarlijk.
const PROTECTED_SCHEMAS: &[&str] = &["auth", "storage", "vault", "realtime", "extensions", "graphql", "graphql_public", "net", "pgsodium", "supabase_functions", "supabase_migrations", "pg_catalog", "information_schema", "cron", "pgbouncer"];
/// Functies die in een SELECT toch iets veranderen of de database belasten.
const BAD_FUNCTIONS: &[&str] = &[
    "nextval", "setval", "set_config", "pg_terminate_backend", "pg_cancel_backend", "pg_sleep", "pg_sleep_for", "pg_sleep_until", "lo_import", "lo_export", "lo_unlink", "lo_create", "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_reload_conf",
    "pg_rotate_logfile", "pg_advisory_lock", "pg_advisory_xact_lock", "pg_notify", "dblink", "dblink_exec", "query_to_xml", "pg_switch_wal", "pg_create_restore_point", "pg_start_backup", "pg_stop_backup", "pg_drop_replication_slot", "txid_current",
];
/// Gratis, veelgebruikte extensies die veilig aan te zetten zijn.
const SAFE_EXTENSIONS: &[&str] = &["uuid-ossp", "pgcrypto", "pg_trgm", "citext", "vector", "unaccent", "fuzzystrmatch", "btree_gin", "btree_gist", "hstore", "ltree", "postgis", "pg_stat_statements"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(into = "u8")]
pub enum Class {
    Lezen = 1,
    Veilig = 2,
    Gevaarlijk = 3,
    Kosten = 4,
}

impl From<Class> for u8 {
    fn from(c: Class) -> u8 {
        c as u8
    }
}

/// Een verandering in gewone woorden (de tekst staat in nl.json: `gegevens.wijziging.<code>`).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Change {
    pub code: &'static str,
    pub params: BTreeMap<&'static str, String>,
}

fn change(code: &'static str, params: &[(&'static str, &str)]) -> Change {
    Change { code, params: params.iter().map(|(k, v)| (*k, v.to_string())).collect() }
}

/// Een vraag om te tellen hoeveel rijen een instructie raakt (alleen-lezen, uit de instructie zelf opgebouwd).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Impact {
    pub tabel: String,
    /// `rijen_verwijderen`, `rijen_wijzigen`, `tabel_leegmaken` of `tabel_verwijderen`.
    pub soort: &'static str,
    /// `SELECT count(*) …`; `None` als het aantal niet te bepalen is (dan telt het als "veel").
    pub telsql: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StmtInfo {
    pub class: Class,
    pub changes: Vec<Change>,
    pub impact: Vec<Impact>,
    /// Een kleine, duidelijke tekst over waarom deze instructie deze klasse kreeg (voor het log).
    pub reden: &'static str,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Ernst {
    /// Alleen een melding.
    Waarschuw,
    /// Niet toegestaan, behalve in "Volledige controle".
    Weiger,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Finding {
    pub code: &'static str,
    pub tabel: Option<String>,
    pub ernst: Ernst,
}

#[derive(Debug, Clone, Serialize)]
pub struct Analysis {
    pub statements: Vec<StmtInfo>,
    pub class: Class,
    /// Alleen `SELECT`-achtig (klasse 1): mag via het alleen-lezen-eindpunt.
    pub read_only: bool,
    pub findings: Vec<Finding>,
    /// De SQL kon niet (goed) gelezen worden.
    pub onleesbaar: bool,
    /// Voor nieuwe tabellen in het publieke schema voegt Studio zelf "RLS aan" toe; dit is de SQL zoals ze uitgevoerd wordt.
    pub final_sql: String,
}

fn bare(name: &ObjectName) -> (Option<String>, String) {
    let parts: Vec<String> = name.0.iter().map(|p| p.to_string().trim_matches('"').to_lowercase()).collect();
    match parts.as_slice() {
        [t] => (None, t.clone()),
        [.., s, t] => (Some(s.clone()), t.clone()),
        [] => (None, String::new()),
    }
}

/// De naam zoals de gebruiker hem kent: zonder aanhalingstekens en zonder `public.`.
fn nice(name: &ObjectName) -> String {
    let (s, t) = bare(name);
    match s {
        Some(s) if s != "public" => format!("{s}.{t}"),
        _ => t,
    }
}

fn is_protected(name: &ObjectName) -> bool {
    bare(name).0.is_some_and(|s| PROTECTED_SCHEMAS.contains(&s.as_str()) || s.starts_with("supabase_") || s.starts_with("pg_"))
}

fn in_public(name: &ObjectName) -> bool {
    bare(name).0.is_none_or(|s| s == "public")
}

fn table_of(t: &TableWithJoins) -> Option<ObjectName> {
    match &t.relation {
        TableFactor::Table { name, .. } => Some(name.clone()),
        _ => None,
    }
}

fn relations(stmt: &Statement) -> Vec<ObjectName> {
    let mut v = vec![];
    let _ = visit_relations(stmt, |r| {
        v.push(r.clone());
        ControlFlow::<()>::Continue(())
    });
    v
}

fn functions(stmt: &Statement) -> Vec<String> {
    let mut v = vec![];
    let _ = visit_expressions(stmt, |e| {
        if let Expr::Function(f) = e {
            v.push(bare(&f.name).1);
        }
        ControlFlow::<()>::Continue(())
    });
    v
}

fn set_expr_writes(e: &SetExpr) -> bool {
    match e {
        SetExpr::Insert(_) | SetExpr::Update(_) | SetExpr::Delete(_) | SetExpr::Merge(_) => true,
        SetExpr::Select(s) => s.into.is_some(),
        SetExpr::Query(q) => query_writes(q),
        SetExpr::SetOperation { left, right, .. } => set_expr_writes(left) || set_expr_writes(right),
        _ => false,
    }
}

fn query_writes(q: &sqlparser::ast::Query) -> bool {
    !q.locks.is_empty() || set_expr_writes(&q.body) || q.with.as_ref().is_some_and(|w| w.cte_tables.iter().any(|c| query_writes(&c.query)))
}

fn broad(e: &Option<Expr>) -> bool {
    e.as_ref().is_some_and(|x| {
        let s = x.to_string().to_lowercase().replace(' ', "");
        matches!(s.as_str(), "true" | "(true)" | "1=1" | "(1=1)")
    })
}

fn stmt(class: Class, reden: &'static str) -> StmtInfo {
    StmtInfo { class, changes: vec![], impact: vec![], reden }
}

fn count_sql(table: &ObjectName, selection: Option<&Expr>) -> String {
    match selection {
        Some(w) => format!("SELECT count(*) FROM {table} WHERE {w}"),
        None => format!("SELECT count(*) FROM {table}"),
    }
}

/// Aantal rijen in een `INSERT … VALUES`, voor de grens op acties zonder bevestiging.
fn insert_rows(i: &sqlparser::ast::Insert) -> Option<usize> {
    match i.source.as_deref().map(|q| &*q.body) {
        Some(SetExpr::Values(v)) => Some(v.rows.len()),
        _ => None,
    }
}

fn classify_one(s: &Statement, findings: &mut Vec<Finding>, batch: &[Statement]) -> StmtInfo {
    let protected_touch = relations(s).iter().any(is_protected);
    match s {
        Statement::Query(q) => {
            if query_writes(q) {
                return stmt(Class::Gevaarlijk, "select_schrijft");
            }
            if functions(s).iter().any(|f| BAD_FUNCTIONS.contains(&f.as_str())) {
                return stmt(Class::Gevaarlijk, "gevaarlijke_functie");
            }
            stmt(Class::Lezen, "select")
        }
        Statement::ShowVariable { .. } => stmt(Class::Lezen, "show"),
        Statement::StartTransaction { .. } | Statement::Commit { .. } | Statement::Rollback { .. } => stmt(Class::Lezen, "transactie"),
        Statement::Explain { analyze, statement, .. } => {
            if *analyze {
                let mut inner = classify_one(statement, findings, batch);
                inner.reden = "explain_analyze";
                inner
            } else {
                stmt(Class::Lezen, "explain")
            }
        }
        Statement::Insert(i) => {
            let TableObject::TableName(name) = &i.table else { return stmt(Class::Gevaarlijk, "insert_onbekend") };
            let nm = nice(name);
            let mut info = stmt(Class::Veilig, "insert");
            if protected_touch || is_protected(name) {
                info.class = Class::Gevaarlijk;
                info.reden = "beschermd_schema";
            }
            if i.on.as_ref().is_some_and(|o| matches!(o, sqlparser::ast::OnInsert::OnConflict(c) if matches!(c.action, sqlparser::ast::OnConflictAction::DoUpdate(_)))) {
                info.class = Class::Gevaarlijk; // overschrijft bestaande rijen
                info.reden = "insert_overschrijft";
                info.changes.push(change("rijen_wijzigen", &[("tabel", &nm)]));
            }
            if let Some(q) = &i.source {
                if query_writes(q) {
                    info.class = Class::Gevaarlijk;
                    info.reden = "select_schrijft";
                }
            }
            let n = insert_rows(i).map(|n| n.to_string()).unwrap_or_else(|| "?".into());
            info.changes.push(change("rijen_toevoegen", &[("tabel", &nm), ("aantal", &n)]));
            info
        }
        Statement::CreateTable(ct) => {
            let nm = nice(&ct.name);
            let mut info = stmt(Class::Veilig, "create_table");
            if is_protected(&ct.name) {
                info.class = Class::Gevaarlijk;
                info.reden = "beschermd_schema";
            }
            if ct.or_replace {
                info.class = Class::Gevaarlijk; // vervangt een bestaande tabel
                info.reden = "or_replace";
            }
            if let Some(q) = &ct.query {
                if query_writes(q) {
                    info.class = Class::Gevaarlijk;
                    info.reden = "select_schrijft";
                }
            }
            info.changes.push(change("tabel_toevoegen", &[("tabel", &nm)]));
            if in_public(&ct.name) && !ct.temporary {
                let (_, t) = bare(&ct.name);
                let heeft_rls = batch.iter().any(|b| matches!(b, Statement::AlterTable(a) if bare(&a.name).1 == t && a.operations.iter().any(|o| matches!(o, AlterTableOperation::EnableRowLevelSecurity))));
                if !heeft_rls {
                    findings.push(Finding { code: "rls_automatisch_aan", tabel: Some(nm), ernst: Ernst::Waarschuw });
                }
            }
            info
        }
        Statement::AlterTable(at) => {
            let nm = nice(&at.name);
            let mut info = stmt(Class::Veilig, "alter_table");
            if is_protected(&at.name) {
                info.class = Class::Gevaarlijk;
                info.reden = "beschermd_schema";
            }
            for op in &at.operations {
                match op {
                    AlterTableOperation::AddColumn { column_def, .. } => info.changes.push(change("kolom_toevoegen", &[("tabel", &nm), ("kolom", &column_def.name.value)])),
                    AlterTableOperation::AddConstraint { .. } => info.changes.push(change("regel_toevoegen", &[("tabel", &nm)])),
                    AlterTableOperation::EnableRowLevelSecurity | AlterTableOperation::ForceRowLevelSecurity => info.changes.push(change("rls_aan", &[("tabel", &nm)])),
                    AlterTableOperation::AlterColumn { op: AlterColumnOperation::SetNotNull | AlterColumnOperation::SetDefault { .. }, column_name, .. } => info.changes.push(change("kolom_regel", &[("tabel", &nm), ("kolom", &column_name.value)])),
                    AlterTableOperation::DisableRowLevelSecurity => {
                        info.class = Class::Gevaarlijk;
                        info.reden = "rls_uit";
                        info.changes.push(change("rls_uit", &[("tabel", &nm)]));
                        findings.push(Finding { code: "rls_uit", tabel: Some(nm.clone()), ernst: Ernst::Weiger });
                    }
                    AlterTableOperation::DropColumn { .. } => {
                        info.class = Class::Gevaarlijk;
                        info.reden = "drop_column";
                        info.changes.push(change("kolom_verwijderen", &[("tabel", &nm)]));
                    }
                    _ => {
                        info.class = Class::Gevaarlijk;
                        info.reden = "alter_onbekend";
                        info.changes.push(change("tabel_aanpassen", &[("tabel", &nm)]));
                    }
                }
            }
            if at.operations.is_empty() {
                info.class = Class::Gevaarlijk;
                info.reden = "alter_leeg";
            }
            info
        }
        Statement::CreateIndex(ci) => {
            let nm = nice(&ci.table_name);
            let mut info = stmt(if is_protected(&ci.table_name) { Class::Gevaarlijk } else { Class::Veilig }, "create_index");
            info.changes.push(change("index_toevoegen", &[("tabel", &nm)]));
            info
        }
        Statement::CreatePolicy(p) => {
            let nm = nice(&p.table_name);
            let mut info = stmt(if is_protected(&p.table_name) { Class::Gevaarlijk } else { Class::Veilig }, "create_policy");
            info.changes.push(change("beleid_toevoegen", &[("tabel", &nm), ("naam", &p.name.value)]));
            let schrijft = !matches!(p.command, Some(CreatePolicyCommand::Select));
            let alles = broad(&p.using) || broad(&p.with_check);
            if alles && schrijft {
                info.class = Class::Gevaarlijk;
                info.reden = "beleid_alles_schrijfbaar";
                findings.push(Finding { code: "beleid_alles_schrijfbaar", tabel: Some(nm), ernst: Ernst::Weiger });
            } else if alles {
                info.class = Class::Gevaarlijk;
                info.reden = "beleid_alles_leesbaar";
                findings.push(Finding { code: "beleid_alles_leesbaar", tabel: Some(nm), ernst: Ernst::Waarschuw });
            } else if p.using.is_none() && p.with_check.is_none() {
                info.class = Class::Gevaarlijk; // zonder voorwaarde: twijfel
                info.reden = "beleid_zonder_voorwaarde";
            }
            info
        }
        Statement::CreateExtension(e) => {
            let n = e.name.value.to_lowercase();
            let mut info = stmt(if SAFE_EXTENSIONS.contains(&n.as_str()) { Class::Veilig } else { Class::Gevaarlijk }, "extension");
            info.changes.push(change("extensie_aan", &[("naam", &e.name.value)]));
            info
        }
        Statement::CreateSchema { schema_name, .. } => {
            let nm = schema_name.to_string();
            let beschermd = PROTECTED_SCHEMAS.contains(&nm.trim_matches('"').to_lowercase().as_str());
            let mut info = stmt(if beschermd { Class::Gevaarlijk } else { Class::Veilig }, "create_schema");
            info.changes.push(change("schema_toevoegen", &[("naam", &nm)]));
            info
        }
        Statement::CreateSequence { .. } | Statement::CreateType { .. } => {
            let mut info = stmt(if protected_touch { Class::Gevaarlijk } else { Class::Veilig }, "create_object");
            info.changes.push(change("object_toevoegen", &[]));
            info
        }
        Statement::CreateView(v) => {
            let nm = nice(&v.name);
            let uitgebreid = s.to_string().to_lowercase();
            let veilig_zicht = uitgebreid.contains("security_invoker") || !in_public(&v.name);
            let mut info = stmt(if veilig_zicht && !v.or_replace && !is_protected(&v.name) { Class::Veilig } else { Class::Gevaarlijk }, "create_view");
            if !veilig_zicht {
                info.reden = "view_omzeilt_rls";
            }
            info.changes.push(change("weergave_toevoegen", &[("naam", &nm)]));
            info
        }
        Statement::CreateFunction(f) => {
            let nm = nice(&f.name);
            let definer = s.to_string().to_lowercase().contains("security definer");
            let mut info = stmt(if definer || is_protected(&f.name) || f.or_replace { Class::Gevaarlijk } else { Class::Veilig }, "create_function");
            if definer {
                info.reden = "security_definer";
            }
            info.changes.push(change("functie_toevoegen", &[("naam", &nm)]));
            info
        }
        Statement::CreateTrigger(_) => {
            let mut info = stmt(if protected_touch { Class::Gevaarlijk } else { Class::Veilig }, "create_trigger");
            info.changes.push(change("trigger_toevoegen", &[]));
            info
        }
        Statement::Comment { object_name, .. } => {
            let mut info = stmt(if is_protected(object_name) { Class::Gevaarlijk } else { Class::Veilig }, "comment");
            info.changes.push(change("opmerking", &[]));
            info
        }
        Statement::Analyze(_) => stmt(Class::Veilig, "analyze"),
        Statement::Update(u) => {
            let mut info = stmt(Class::Gevaarlijk, "update");
            if let Some(t) = table_of(&u.table) {
                let nm = nice(&t);
                info.changes.push(change("rijen_wijzigen", &[("tabel", &nm)]));
                let telbaar = u.from.is_none() && u.table.joins.is_empty();
                info.impact.push(Impact { tabel: nm, soort: "rijen_wijzigen", telsql: telbaar.then(|| count_sql(&t, u.selection.as_ref())) });
            } else {
                info.changes.push(change("rijen_wijzigen", &[("tabel", "?")]));
            }
            info
        }
        Statement::Delete(d) => {
            let mut info = stmt(Class::Gevaarlijk, "delete");
            let tables = match &d.from {
                FromTable::WithFromKeyword(v) | FromTable::WithoutKeyword(v) => v.clone(),
            };
            match tables.first().and_then(table_of) {
                Some(t) if tables.len() == 1 => {
                    let nm = nice(&t);
                    info.changes.push(change("rijen_verwijderen", &[("tabel", &nm)]));
                    let telbaar = d.using.is_none() && tables[0].joins.is_empty();
                    info.impact.push(Impact { tabel: nm, soort: "rijen_verwijderen", telsql: telbaar.then(|| count_sql(&t, d.selection.as_ref())) });
                }
                _ => info.changes.push(change("rijen_verwijderen", &[("tabel", "?")])),
            }
            info
        }
        Statement::Truncate(t) => {
            let mut info = stmt(Class::Gevaarlijk, "truncate");
            for target in &t.table_names {
                let nm = nice(&target.name);
                info.changes.push(change("tabel_leegmaken", &[("tabel", &nm)]));
                info.impact.push(Impact { tabel: nm, soort: "tabel_leegmaken", telsql: Some(count_sql(&target.name, None)) });
            }
            info
        }
        Statement::Drop { object_type, names, .. } => {
            let mut info = stmt(Class::Gevaarlijk, "drop");
            for n in names {
                let nm = nice(n);
                if *object_type == ObjectType::Table {
                    info.changes.push(change("tabel_verwijderen", &[("tabel", &nm)]));
                    info.impact.push(Impact { tabel: nm, soort: "tabel_verwijderen", telsql: Some(count_sql(n, None)) });
                } else {
                    info.changes.push(change("object_verwijderen", &[("naam", &nm)]));
                }
            }
            info
        }
        Statement::Grant { .. } | Statement::Revoke { .. } | Statement::AlterDefaultPrivileges { .. } => {
            let mut info = stmt(Class::Gevaarlijk, "rechten");
            info.changes.push(change("rechten_wijzigen", &[]));
            info
        }
        _ => {
            let mut info = stmt(Class::Gevaarlijk, "onbekend");
            info.changes.push(change("onbekend", &[]));
            info
        }
    }
}

/// Voor een nieuwe tabel in het publieke schema zonder "RLS aan": voeg zelf `ENABLE ROW LEVEL SECURITY` toe.
fn auto_rls(stmts: &[Statement]) -> Vec<String> {
    let mut extra = vec![];
    for s in stmts {
        if let Statement::CreateTable(ct) = s {
            let (_, t) = bare(&ct.name);
            let al_aan = stmts.iter().any(|b| matches!(b, Statement::AlterTable(a) if bare(&a.name).1 == t && a.operations.iter().any(|o| matches!(o, AlterTableOperation::EnableRowLevelSecurity))));
            if in_public(&ct.name) && !ct.temporary && !is_protected(&ct.name) && !al_aan {
                extra.push(format!("ALTER TABLE {} ENABLE ROW LEVEL SECURITY;", ct.name));
            }
        }
    }
    extra
}

fn suspicious(sql: &str) -> bool {
    sql.chars().any(|c| c == '\0' || (c.is_control() && !matches!(c, '\n' | '\r' | '\t')))
}

/// Deelt SQL in. Dit is de enige plek waar de klasse van SQL wordt bepaald.
pub fn analyze(sql: &str) -> Analysis {
    let onleesbaar = |reden: &'static str| Analysis {
        statements: vec![stmt(Class::Gevaarlijk, reden)],
        class: Class::Gevaarlijk,
        read_only: false,
        findings: vec![],
        onleesbaar: true,
        final_sql: sql.to_string(),
    };
    if sql.trim().is_empty() || sql.len() > MAX_SQL_BYTES || suspicious(sql) {
        return onleesbaar("onleesbaar");
    }
    let Ok(stmts) = Parser::parse_sql(&PostgreSqlDialect {}, sql) else { return onleesbaar("onleesbaar") };
    if stmts.is_empty() {
        return onleesbaar("leeg");
    }
    let mut findings = vec![];
    let mut infos: Vec<StmtInfo> = stmts.iter().map(|s| classify_one(s, &mut findings, &stmts)).collect();
    // Meerdere instructies: elke afzonderlijk, de hoogste telt. Een lege rij of een los `;` is al weggefilterd door de parser.
    let class = infos.iter().map(|i| i.class).max().unwrap_or(Class::Gevaarlijk);
    let extra = auto_rls(&stmts);
    let mut final_sql = sql.trim_end().to_string();
    if !extra.is_empty() {
        if !final_sql.ends_with(';') {
            final_sql.push(';');
        }
        for e in &extra {
            final_sql.push('\n');
            final_sql.push_str(e);
        }
        for i in infos.iter_mut() {
            if i.reden == "create_table" {
                i.changes.push(change("rls_aan_automatisch", &[]));
                break;
            }
        }
    }
    Analysis { read_only: class == Class::Lezen, statements: infos, class, findings, onleesbaar: false, final_sql }
}

#[cfg(test)]
mod tests;
