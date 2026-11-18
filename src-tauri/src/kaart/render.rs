//! De projectkaart als tekst: een korte (`.studio/kaart.md`, richtlijn < 2.000 tokens) en een uitgebreide die op aanvraag wordt geladen.
use super::index::lijst;
use super::zoek::{alle, los_op, Rij};
use rusqlite::Connection;
use std::collections::{BTreeMap, HashSet};

/// Richtlijn voor de korte kaart: ± 2.000 tokens (tekens/4, een schatting).
pub const KORT_MAX_TEKENS: usize = 8000;
const PER_PAGINA: usize = 40;

pub fn schat_tokens(t: &str) -> usize {
    t.chars().count().div_ceil(4)
}

fn groep(pad: &str) -> String {
    let delen: Vec<&str> = pad.split('/').collect();
    match delen.len() {
        1 => "(hoofdmap)".into(),
        2 => delen[0].to_string(),
        _ => format!("{}/{}", delen[0], delen[1]),
    }
}

fn namen(v: &[String], n: usize) -> String {
    let mut t: Vec<String> = v.iter().take(n).cloned().collect();
    if v.len() > n {
        t.push(format!("+{}", v.len() - n));
    }
    t.join(", ")
}

fn regel(f: &Rij, bekend: &HashSet<String>, uitgebreid: bool) -> String {
    let naam = f.pad.rsplit('/').next().unwrap_or(&f.pad);
    let mut s = format!("- {naam} — {}", f.doel);
    if !f.exports.is_empty() {
        s.push_str(&format!(" · levert: {}", namen(&f.exports, if uitgebreid { 12 } else { 3 })));
    }
    let intern: Vec<String> = f.imports.iter().filter_map(|i| los_op(&f.pad, i, bekend)).map(|p| p.rsplit('/').next().unwrap_or(&p).to_string()).collect();
    if !intern.is_empty() {
        s.push_str(&format!(" · gebruikt: {}", namen(&intern, if uitgebreid { 12 } else { 4 })));
    }
    if uitgebreid && !f.kit.is_empty() {
        s.push_str(&format!(" · kit: {}", namen(&f.kit, 8)));
    }
    s
}

fn schema_regels(c: &Connection) -> Vec<String> {
    let Ok(mut st) = c.prepare("SELECT naam,kolommen FROM tabel ORDER BY pad, rowid") else { return vec![] };
    let rijen: Vec<(String, String)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map(|i| i.flatten().collect()).unwrap_or_default();
    let mut volgorde: Vec<String> = Vec::new();
    let mut kol: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (n, k) in rijen {
        if !kol.contains_key(&n) {
            volgorde.push(n.clone());
        }
        let e = kol.entry(n).or_default();
        for k in lijst(&k) {
            let k = k.trim_start_matches('+').to_string();
            if !e.contains(&k) {
                e.push(k);
            }
        }
    }
    volgorde.into_iter().map(|n| format!("- {n}({})", kol[&n].join(", "))).collect()
}

const KOP: &str = "<!-- Door Studio gemaakt; niet zelf bewerken. Is iets onduidelijk of lijkt het niet te kloppen? Lees dan het echte bestand. -->\n";

/// De korte kaart. Past altijd binnen `KORT_MAX_TEKENS`: bij te veel bestanden worden regels per groep ingekort.
pub fn kort(c: &Connection) -> String {
    let files = alle(c);
    if files.is_empty() {
        return format!("{KOP}# Projectkaart\n\nNog geen bestanden gevonden.\n");
    }
    let bekend: HashSet<String> = files.iter().map(|f| f.pad.clone()).collect();
    let routes: Vec<String> = files.iter().flat_map(|f| f.routes.iter().map(move |r| format!("- {r} → {}", f.pad))).collect();
    let mut uit = format!("{KOP}# Projectkaart\n\n");
    if !routes.is_empty() {
        uit.push_str("## Schermen en routes\n");
        for r in routes.iter().take(25) {
            uit.push_str(r);
            uit.push('\n');
        }
        if routes.len() > 25 {
            uit.push_str(&format!("- … nog {} (vraag project_kaart met uitgebreid=ja)\n", routes.len() - 25));
        }
        uit.push('\n');
    }
    let mut per_groep: BTreeMap<String, Vec<&Rij>> = BTreeMap::new();
    for f in &files {
        per_groep.entry(groep(&f.pad)).or_default().push(f);
    }
    let schema = schema_regels(c);
    let ruimte = KORT_MAX_TEKENS.saturating_sub(uit.len() + schema.iter().map(|s| s.len() + 1).sum::<usize>() + 120);
    let per = (ruimte / files.len().max(1)).clamp(24, 400);
    uit.push_str("## Bestanden per onderdeel\n");
    let mut nog = 0usize;
    for (g, lijst) in &per_groep {
        uit.push_str(&format!("### {g}\n"));
        for f in lijst {
            let mut r = regel(f, &bekend, false);
            if r.chars().count() > per {
                r = r.chars().take(per.saturating_sub(1)).collect::<String>() + "…";
            }
            if uit.len() + r.len() + 1 > KORT_MAX_TEKENS.saturating_sub(schema.iter().map(|s| s.len() + 1).sum::<usize>() + 160) {
                nog += 1;
                continue;
            }
            uit.push_str(&r);
            uit.push('\n');
        }
    }
    if nog > 0 {
        uit.push_str(&format!("- … nog {nog} bestanden: gebruik project_kaart (uitgebreid) of bestanden_voor_taak.\n"));
    }
    if !schema.is_empty() {
        uit.push_str("\n## Database (uit de migraties)\n");
        for s in schema {
            uit.push_str(&s);
            uit.push('\n');
        }
    }
    uit
}

/// De uitgebreide kaart, per pagina van `PER_PAGINA` bestanden (op aanvraag).
pub fn uitgebreid(c: &Connection, pagina: usize) -> String {
    let files = alle(c);
    let bekend: HashSet<String> = files.iter().map(|f| f.pad.clone()).collect();
    let paginas = files.len().div_ceil(PER_PAGINA).max(1);
    let p = pagina.clamp(1, paginas);
    let mut uit = format!("Projectkaart, uitgebreid — pagina {p} van {paginas} ({} bestanden)\n", files.len());
    for f in files.iter().skip((p - 1) * PER_PAGINA).take(PER_PAGINA) {
        uit.push_str(&format!("{}\n  {}\n", f.pad, regel(f, &bekend, true).trim_start_matches("- ")));
        for s in symbolen_van(c, &f.pad).iter().take(8) {
            uit.push_str(&format!("    · {s}\n"));
        }
    }
    if p < paginas {
        uit.push_str(&format!("… volgende: pagina={}\n", p + 1));
    }
    uit
}

fn symbolen_van(c: &Connection, pad: &str) -> Vec<String> {
    let Ok(mut st) = c.prepare("SELECT soort,sig,regel FROM symbool WHERE pad=?1 ORDER BY regel") else { return vec![] };
    st.query_map([pad], |r| Ok(format!("{}:{} {} {}", pad.rsplit('/').next().unwrap_or(pad), r.get::<_, i64>(2)?, r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map(|i| i.flatten().collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::super::index::{bijwerken, open};
    use super::*;
    use std::fs;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn kleine_kaart_is_kort_en_heeft_routes_en_database() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        fs::create_dir_all(p.join("src")).unwrap();
        fs::create_dir_all(p.join("migrations")).unwrap();
        fs::write(p.join("src/main.tsx"), "// Startpunt.\nimport A from './A';\nexport const r = <Route path=\"/a\" />;\n").unwrap();
        fs::write(p.join("src/A.tsx"), "export default function A() { return null }\n").unwrap();
        fs::write(p.join("migrations/1.sql"), "create table t (id int);").unwrap();
        bijwerken(p, &AtomicBool::new(false), &|_, _| {}).unwrap();
        let c = open(p).unwrap();
        let k = kort(&c);
        assert!(k.contains("/a → src/main.tsx") && k.contains("A.tsx") && k.contains("t(id)"), "{k}");
        assert!(schat_tokens(&k) < 600, "{}", schat_tokens(&k));
    }

    #[test]
    fn grote_kaart_blijft_binnen_het_budget() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        for g in 0..12 {
            fs::create_dir_all(p.join(format!("src/map{g}"))).unwrap();
            for i in 0..30 {
                fs::write(p.join(format!("src/map{g}/bestand{i}.ts")), format!("// Doet iets nuttigs nummer {i} in groep {g}.\nexport function f{g}x{i}() {{}}\n")).unwrap();
            }
        }
        let s = bijwerken(p, &AtomicBool::new(false), &|_, _| {}).unwrap();
        assert_eq!(s.nieuw, 360);
        let c = open(p).unwrap();
        let k = kort(&c);
        assert!(k.chars().count() <= KORT_MAX_TEKENS + 400, "{}", k.chars().count());
        assert!(k.contains("nog "), "ingekort met verwijzing");
        let u = uitgebreid(&c, 2);
        assert!(u.contains("pagina 2 van 9") && u.contains("volgende: pagina=3"), "{}", &u[..120]);
    }
}
