//! Ongedaan maken: voor wat Studio zelf heeft gemaakt, de tegenovergestelde SQL; voor verwijderde rijen een herstel uit de back-up.
//! Wat niet kan, zegt Studio eerlijk (zie `onomkeerbaar`).
use sqlparser::ast::{AlterTableOperation, Statement};
use sqlparser::dialect::PostgreSqlDialect;
use sqlparser::parser::Parser;

fn quote_name(n: &sqlparser::ast::ObjectName) -> String {
    n.to_string()
}

/// De SQL die een veilige schrijfactie weer terugdraait. `None` als dat niet netjes kan (dan staat er geen "Maak ongedaan").
/// Alleen als de HELE reeks instructies terug te draaien is, wordt er iets teruggegeven; de volgorde wordt omgekeerd.
pub fn inverse_sql(sql: &str) -> Option<String> {
    let stmts = Parser::parse_sql(&PostgreSqlDialect {}, sql).ok()?;
    let mut inv: Vec<String> = vec![];
    for s in &stmts {
        let one = match s {
            Statement::CreateTable(ct) if ct.query.is_none() && !ct.or_replace => format!("DROP TABLE IF EXISTS {};", quote_name(&ct.name)),
            Statement::AlterTable(at) if at.operations.len() == 1 => match &at.operations[0] {
                AlterTableOperation::AddColumn { column_def, .. } => format!("ALTER TABLE {} DROP COLUMN IF EXISTS \"{}\";", quote_name(&at.name), column_def.name.value.replace('"', "\"\"")),
                // De automatisch toegevoegde "RLS aan" hoort bij een nieuwe tabel; die wordt in zijn geheel weggehaald.
                AlterTableOperation::EnableRowLevelSecurity => continue,
                _ => return None,
            },
            Statement::CreateIndex(ci) => format!("DROP INDEX IF EXISTS {};", quote_name(ci.name.as_ref()?)),
            Statement::CreatePolicy(p) => format!("DROP POLICY IF EXISTS \"{}\" ON {};", p.name.value.replace('"', "\"\""), quote_name(&p.table_name)),
            Statement::CreateSchema { .. } | Statement::CreateExtension(_) | Statement::Comment { .. } | Statement::Analyze(_) => return None,
            _ => return None,
        };
        inv.push(one);
    }
    inv.reverse();
    (!inv.is_empty()).then(|| inv.join("\n"))
}

/// Een herstel van verwijderde rijen uit een back-up: voegt ze weer toe (bestaande rijen blijven ongemoeid).
/// De rijen komen als JSON in een dollar-tekst met een willekeurige naam die niet in de gegevens voorkomt.
pub fn restore_rows_sql(table: &str, rows_json: &str, tag_seed: u64) -> Option<String> {
    let table = table.trim();
    if table.is_empty() || table.len() > 200 || !table.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'"' | b'-')) {
        return None;
    }
    let mut n = tag_seed;
    let tag = loop {
        let t = format!("$studio{n}$");
        if !rows_json.contains(&t) {
            break t;
        }
        n += 1;
    };
    Some(format!("INSERT INTO {table} SELECT * FROM jsonb_populate_recordset(null::{table}, {tag}{rows_json}{tag}::jsonb) ON CONFLICT DO NOTHING;"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::supa::classify::{analyze, Class};

    #[test]
    fn terugdraaien_van_wat_studio_maakte_in_omgekeerde_volgorde() {
        assert_eq!(inverse_sql("CREATE TABLE bestellingen (id int)").as_deref(), Some("DROP TABLE IF EXISTS bestellingen;"));
        assert_eq!(inverse_sql("ALTER TABLE klanten ADD COLUMN telefoon text").as_deref(), Some("ALTER TABLE klanten DROP COLUMN IF EXISTS \"telefoon\";"));
        assert_eq!(inverse_sql("CREATE INDEX idx_a ON a (x)").as_deref(), Some("DROP INDEX IF EXISTS idx_a;"));
        assert_eq!(inverse_sql("CREATE POLICY \"eigen rijen\" ON klanten FOR SELECT USING (true)").as_deref(), Some("DROP POLICY IF EXISTS \"eigen rijen\" ON klanten;"));
        assert_eq!(inverse_sql("CREATE TABLE a (id int); CREATE INDEX i ON a (id)").as_deref(), Some("DROP INDEX IF EXISTS i;\nDROP TABLE IF EXISTS a;"));
        // Met de automatische "RLS aan" erbij blijft het terug te draaien.
        assert_eq!(inverse_sql(&analyze("CREATE TABLE t (id int)").final_sql).as_deref(), Some("DROP TABLE IF EXISTS t;"));
    }

    #[test]
    fn wat_niet_terug_te_draaien_is_krijgt_geen_ongedaan() {
        for sql in ["INSERT INTO a (x) VALUES (1)", "CREATE EXTENSION pgcrypto", "DROP TABLE a", "DELETE FROM a", "UPDATE a SET b = 1", "ALTER TABLE a ADD COLUMN x int, ADD COLUMN y int", "SELECT 1", "kapot", "CREATE TABLE a (id int); INSERT INTO a (id) VALUES (1)", "CREATE TABLE t AS SELECT 1", "CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql"] {
            assert_eq!(inverse_sql(sql), None, "{sql}");
        }
    }

    #[test]
    fn de_terugdraai_sql_is_gevaarlijk_dus_vraagt_bevestiging_maar_is_leesbaar() {
        let inv = inverse_sql("CREATE TABLE a (id int)").unwrap();
        let a = analyze(&inv);
        assert_eq!(a.class, Class::Gevaarlijk);
        assert!(!a.onleesbaar);
    }

    #[test]
    fn herstel_van_rijen_gebruikt_een_veilige_tekst_en_een_vrije_naam() {
        let sql = restore_rows_sql("public.klanten", r#"[{"id":1,"naam":"a $studio1$ b"}]"#, 1).unwrap();
        assert!(sql.starts_with("INSERT INTO public.klanten SELECT * FROM jsonb_populate_recordset(null::public.klanten, $studio2$"), "{sql}");
        assert!(sql.ends_with("$studio2$::jsonb) ON CONFLICT DO NOTHING;"));
        assert!(!analyze(&sql).onleesbaar, "herstel-SQL moet leesbaar zijn: {sql}");
        for slecht in ["", "x; drop table y", "a b", "t\u{0}"] {
            assert_eq!(restore_rows_sql(slecht, "[]", 1), None, "{slecht}");
        }
    }
}
