//! Het scherm "Wat je app onthoudt": tabellen, rijen, gebruikers en de veiligheidscheck van de database.
use super::*;

/// Aanhalingstekens rond een waarde in SQL (een tekst; leeg of `null` wordt NULL).
fn lit(v: &Value) -> String {
    match v {
        Value::Null => "NULL".into(),
        Value::Bool(b) => if *b { "true".into() } else { "false".into() },
        Value::Number(n) => format!("'{n}'"),
        Value::String(s) => format!("'{}'", s.replace('\'', "''")),
        other => format!("'{}'", other.to_string().replace('\'', "''")),
    }
}

fn cell(v: &Value) -> String {
    match v {
        Value::Null => "".into(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TableInfo {
    pub tabel: String,
    pub rls: bool,
    pub rijen: Option<u64>,
    pub kolommen: Vec<Value>,
    pub beleid: Vec<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RowPage {
    pub kolommen: Vec<String>,
    pub rijen: Vec<Vec<String>>,
    pub meer: bool,
    pub pagina: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DbFinding {
    pub code: &'static str,
    pub tabel: String,
}

pub const PAGE: usize = 25;

impl Engine {
    pub fn projects(&self) -> Result<(Vec<super::super::api::Proj>, Vec<super::super::api::Org>), SupaError> {
        self.api(&[], |c| Ok((c.projects()?, c.organizations().unwrap_or_default())))
    }

    /// De tabellen van het publieke schema (alleen lezen) met het aantal rijen.
    pub fn overview(&self, project: i64) -> Result<Vec<TableInfo>, Reply> {
        let link = self.need_link(project)?;
        let secrets = self.secrets_for(&link);
        let v = self.api(&secrets, |c| c.query(&link.reference, Self::LIST_TABLES_SQL, true)).map_err(|e| self.err_reply(&link, &e))?;
        let lijst = Self::first_data(&v);
        let mut tabellen: Vec<TableInfo> = lijst
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|t| {
                Some(TableInfo { tabel: t["tabel"].as_str()?.to_string(), rls: t["rls"].as_bool().unwrap_or(false), rijen: None, kolommen: t["kolommen"].as_array().cloned().unwrap_or_default(), beleid: t["beleid"].as_array().cloned().unwrap_or_default() })
            })
            .collect();
        tabellen.truncate(60);
        if !tabellen.is_empty() {
            let q = tabellen.iter().map(|t| format!("select '{}' as t, count(*) as n from public.{}", t.tabel.replace('\'', "''"), q_ident(&t.tabel))).collect::<Vec<_>>().join(" union all ");
            if let Ok(tel) = self.api(&secrets, |c| c.query(&link.reference, &q, true)) {
                for r in tel.as_array().cloned().unwrap_or_default() {
                    let (Some(t), n) = (r["t"].as_str(), &r["n"]) else { continue };
                    if let Some(info) = tabellen.iter_mut().find(|x| x.tabel == t) {
                        info.rijen = n.as_u64().or_else(|| n.as_str().and_then(|s| s.parse().ok()));
                    }
                }
            }
        }
        Ok(tabellen)
    }

    fn known_table(&self, project: i64, tabel: &str) -> Result<(Link, TableInfo), Reply> {
        let link = self.need_link(project)?;
        let info = self.overview(project)?.into_iter().find(|t| t.tabel == tabel).ok_or_else(|| Reply::nee("Deze tabel bestaat niet (meer)."))?;
        Ok((link, info))
    }

    /// Een pagina rijen. De tabelnaam moet een bestaande tabel zijn; er wordt nooit zomaar SQL doorgegeven.
    pub fn rows(&self, project: i64, tabel: &str, pagina: u32) -> Result<RowPage, Reply> {
        let (link, info) = self.known_table(project, tabel)?;
        let sql = format!("select * from public.{} order by 1 limit {} offset {}", q_ident(tabel), PAGE + 1, pagina as usize * PAGE);
        let v = self.api(&self.secrets_for(&link), |c| c.query(&link.reference, &sql, true)).map_err(|e| self.err_reply(&link, &e))?;
        let alle = v.as_array().cloned().unwrap_or_default();
        let kolommen: Vec<String> = if let Some(Value::Object(o)) = alle.first() { o.keys().cloned().collect() } else { info.kolommen.iter().filter_map(|k| k["kolom"].as_str().map(String::from)).collect() };
        let meer = alle.len() > PAGE;
        let rijen = alle.iter().take(PAGE).map(|r| kolommen.iter().map(|k| cell(&r[k])).collect()).collect();
        Ok(RowPage { kolommen, rijen, meer, pagina })
    }

    /// Een rij toevoegen (`key` is `None`) of wijzigen (de sleutel van de rij). Altijd met een bevestiging in de app.
    pub fn row_save(&self, project: i64, tabel: &str, key: Option<&serde_json::Map<String, Value>>, waarden: &serde_json::Map<String, Value>) -> Reply {
        let (link, info) = match self.known_table(project, tabel) {
            Ok(x) => x,
            Err(r) => return r,
        };
        let kolommen: Vec<String> = info.kolommen.iter().filter_map(|k| k["kolom"].as_str().map(String::from)).collect();
        if waarden.is_empty() || waarden.keys().any(|k| !kolommen.contains(k)) {
            return Reply::nee("Geweigerd: onbekende kolom of geen waarden.");
        }
        let sql = match key {
            None => {
                let namen = waarden.keys().map(|k| q_ident(k)).collect::<Vec<_>>().join(", ");
                let vals = waarden.values().map(lit).collect::<Vec<_>>().join(", ");
                format!("insert into public.{} ({namen}) values ({vals})", q_ident(tabel))
            }
            Some(sleutel) => {
                let pk_sql = format!("select a.attname as kolom from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = 'public.{}'::regclass and i.indisprimary", q_ident(tabel).replace('\'', "''"));
                let pk: Vec<String> = self.api(&self.secrets_for(&link), |c| c.query(&link.reference, &pk_sql, true)).ok().and_then(|v| v.as_array().map(|a| a.iter().filter_map(|r| r["kolom"].as_str().map(String::from)).collect())).unwrap_or_default();
                if pk.is_empty() || pk.iter().any(|p| !sleutel.contains_key(p)) {
                    return Reply::nee("Geweigerd: deze rij is niet veilig aan te wijzen (de tabel heeft geen hoofdsleutel). Laat de AI dit aanpassen.");
                }
                let set = waarden.iter().map(|(k, v)| format!("{} = {}", q_ident(k), lit(v))).collect::<Vec<_>>().join(", ");
                // Alleen de hoofdsleutel-kolommen bepalen welke rij het is (de app geeft de hele oude rij mee).
                let waar = pk.iter().map(|k| format!("{} = {}", q_ident(k), lit(&sleutel[k]))).collect::<Vec<_>>().join(" and ");
                format!("update public.{} set {set} where {waar}", q_ident(tabel))
            }
        };
        self.run_sql(project, "gegevens_scherm", &sql, Actor::Gebruiker)
    }

    /// De gebruikers van de app (als inloggen aanstaat). Alleen enkele kolommen; nooit wachtwoord-hashes.
    pub fn users(&self, project: i64) -> Result<Vec<Value>, Reply> {
        let link = self.need_link(project)?;
        let sql = "select id, email, created_at, last_sign_in_at from auth.users order by created_at desc limit 100";
        // Studio stelt deze vraag zelf samen: alleen lezen, vaste kolommen.
        self.api(&self.secrets_for(&link), |c| c.query(&link.reference, sql, false)).map(|v| v.as_array().cloned().unwrap_or_default()).map_err(|e| self.err_reply(&link, &e))
    }

    /// Controle voor "Online zetten": tabellen zonder RLS en beleid dat alles toestaat.
    pub fn security_check(&self, project: i64) -> Result<Vec<DbFinding>, Reply> {
        let mut out = vec![];
        for t in self.overview(project)? {
            if !t.rls {
                out.push(DbFinding { code: "rls_uit", tabel: t.tabel.clone() });
            } else if t.beleid.is_empty() {
                out.push(DbFinding { code: "geen_beleid", tabel: t.tabel.clone() });
            }
            for b in &t.beleid {
                let breed = |k: &str| b[k].as_str().is_some_and(|s| matches!(s.replace(' ', "").to_lowercase().as_str(), "true" | "(true)"));
                let cmd = b["commando"].as_str().unwrap_or("").to_uppercase();
                let rollen = b["rollen"].to_string().to_lowercase();
                let publiek = rollen.contains("anon") || rollen.contains("public");
                if (breed("voorwaarde") || breed("controle")) && cmd != "SELECT" && publiek {
                    out.push(DbFinding { code: "beleid_alles_schrijfbaar", tabel: t.tabel.clone() });
                } else if breed("voorwaarde") && cmd == "SELECT" && publiek {
                    out.push(DbFinding { code: "beleid_alles_leesbaar", tabel: t.tabel.clone() });
                }
            }
        }
        Ok(out)
    }

    /// "Project weer wakker maken": de gebruiker drukt zelf op de knop, dus zonder extra bevestiging.
    pub fn wake(&self, project: i64) -> Reply {
        let link = match self.need_link(project) {
            Ok(l) => l,
            Err(r) => return r,
        };
        match self.api(&[], |c| c.restore(&link.reference)) {
            Ok(()) => {
                self.hooks.changed(project);
                Reply::ok("Het project wordt wakker gemaakt. Dit kan een paar minuten duren.", None)
            }
            Err(e) => self.err_reply(&link, &e),
        }
    }
}
