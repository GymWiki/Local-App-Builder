//! Vragen aan de index: symbool zoeken, bestanden bij een taak, afhankelijkheden, databaseschema en kit-componenten.
//! Alle antwoorden zijn kort en begrensd; met `vanaf` blader je verder.
use super::index::lijst;
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};

pub const STANDAARD_LIMIET: usize = 12;
pub const MAX_LIMIET: usize = 40;

pub struct Rij {
    pub pad: String,
    pub doel: String,
    pub exports: Vec<String>,
    pub imports: Vec<String>,
    pub routes: Vec<String>,
    pub kit: Vec<String>,
}

pub fn alle(c: &Connection) -> Vec<Rij> {
    let Ok(mut st) = c.prepare("SELECT pad,doel,exports,imports,routes,kit FROM bestand ORDER BY pad") else { return vec![] };
    st.query_map([], |r| Ok(Rij { pad: r.get(0)?, doel: r.get(1)?, exports: lijst(&r.get::<_, String>(2)?), imports: lijst(&r.get::<_, String>(3)?), routes: lijst(&r.get::<_, String>(4)?), kit: lijst(&r.get::<_, String>(5)?) }))
        .map(|i| i.flatten().collect())
        .unwrap_or_default()
}

fn begrens(l: Option<usize>) -> usize {
    l.unwrap_or(STANDAARD_LIMIET).clamp(1, MAX_LIMIET)
}

fn meer(totaal: usize, vanaf: usize, limiet: usize) -> String {
    if vanaf + limiet < totaal {
        format!("\n… nog {} meer. Vraag verder met vanaf={}.", totaal - vanaf - limiet, vanaf + limiet)
    } else {
        String::new()
    }
}

/// Probeert een import (relatief of met `@/`) te herleiden tot een bestand in de index.
pub fn los_op(van: &str, imp: &str, bekend: &HashSet<String>) -> Option<String> {
    let basis = if let Some(r) = imp.strip_prefix("@/") {
        format!("src/{r}")
    } else if imp.starts_with("./") || imp.starts_with("../") {
        let mut delen: Vec<&str> = van.split('/').collect();
        delen.pop();
        for d in imp.split('/') {
            match d {
                "." | "" => {}
                ".." => {
                    delen.pop();
                }
                x => delen.push(x),
            }
        }
        delen.join("/")
    } else if !imp.contains(':') && !imp.starts_with('@') && bekend.contains(imp) {
        imp.to_string()
    } else {
        return None;
    };
    let basis = basis.trim_end_matches('/').to_string();
    let mut opties = vec![basis.clone()];
    for e in ["ts", "tsx", "js", "jsx", "mjs", "dart", "css", "html"] {
        opties.push(format!("{basis}.{e}"));
        opties.push(format!("{basis}/index.{e}"));
    }
    // een import van "./a.js" kan "a.ts" bedoelen
    if let Some((stam, _)) = basis.rsplit_once('.') {
        for e in ["ts", "tsx"] {
            opties.push(format!("{stam}.{e}"));
        }
    }
    opties.into_iter().find(|o| bekend.contains(o))
}

pub fn zoek_symbool(c: &Connection, naam: &str, vanaf: usize, limiet: Option<usize>) -> String {
    let limiet = begrens(limiet);
    let naam = naam.trim();
    if naam.is_empty() {
        return "Geef een naam op.".into();
    }
    let like = format!("%{}%", naam.replace('%', "").replace('_', "\\_"));
    let Ok(mut st) = c.prepare("SELECT pad,naam,soort,sig,regel FROM symbool WHERE naam LIKE ?1 ESCAPE '\\' ORDER BY (lower(naam)=lower(?2)) DESC, length(naam), pad") else { return "De kaart kon niet worden gelezen.".into() };
    let rijen: Vec<(String, String, String, String, i64)> = st.query_map(params![like, naam], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).map(|i| i.flatten().collect()).unwrap_or_default();
    if rijen.is_empty() {
        return format!("‘{naam}’ staat niet in de kaart. Lees zo nodig het echte bestand; de kaart kan achterlopen.");
    }
    let files = alle(c);
    let bekend: HashSet<String> = files.iter().map(|f| f.pad.clone()).collect();
    let mut door: HashMap<String, Vec<String>> = HashMap::new();
    for f in &files {
        for i in &f.imports {
            if let Some(d) = los_op(&f.pad, i, &bekend) {
                door.entry(d).or_default().push(f.pad.clone());
            }
        }
    }
    let totaal = rijen.len();
    let mut uit = format!("{totaal} gevonden voor ‘{naam}’:\n");
    for (pad, n, soort, sig, regel) in rijen.into_iter().skip(vanaf).take(limiet) {
        uit.push_str(&format!("- {n} ({soort}) in {pad}:{regel}"));
        if !sig.is_empty() {
            uit.push_str(&format!(" — {sig}"));
        }
        if let Some(g) = door.get(&pad) {
            let toon: Vec<&str> = g.iter().take(4).map(String::as_str).collect();
            uit.push_str(&format!("\n  bestand wordt gebruikt door: {}{}", toon.join(", "), if g.len() > 4 { format!(" (+{})", g.len() - 4) } else { String::new() }));
        }
        uit.push('\n');
    }
    uit.push_str(&meer(totaal, vanaf, limiet));
    uit
}

pub fn afhankelijkheden(c: &Connection, pad: &str, vanaf: usize, limiet: Option<usize>) -> String {
    let limiet = begrens(limiet);
    let files = alle(c);
    let bekend: HashSet<String> = files.iter().map(|f| f.pad.clone()).collect();
    let pad = pad.trim().replace('\\', "/");
    let Some(f) = files.iter().find(|f| f.pad == pad) else { return format!("{pad} staat niet in de kaart.") };
    let gebruikt: Vec<String> = f.imports.iter().map(|i| los_op(&f.pad, i, &bekend).unwrap_or_else(|| format!("{i} (extern)"))).collect();
    let mut door: Vec<String> = files.iter().filter(|g| g.imports.iter().any(|i| los_op(&g.pad, i, &bekend).as_deref() == Some(&pad))).map(|g| g.pad.clone()).collect();
    door.sort();
    let toon = |v: &[String]| if v.is_empty() { "niets".to_string() } else { v.iter().skip(vanaf).take(limiet).cloned().collect::<Vec<_>>().join(", ") };
    let mut uit = format!("{pad}\nDit bestand gebruikt: {}\nEen wijziging hier raakt: {}", toon(&gebruikt), toon(&door));
    uit.push_str(&meer(gebruikt.len().max(door.len()), vanaf, limiet));
    uit
}

const STOP: [&str; 40] = ["de", "het", "een", "en", "van", "voor", "met", "naar", "op", "in", "aan", "ik", "wil", "maak", "maken", "voeg", "toe", "mijn", "deze", "die", "dat", "te", "is", "bij", "om", "the", "a", "an", "to", "of", "for", "and", "add", "make", "please", "kun", "je", "graag", "nieuwe", "nieuw"];
const SYNONIEM: [(&str, &str); 28] = [
    ("homescherm", "home"), ("startscherm", "home"), ("instellingen", "settings"), ("winkel", "shop"), ("gebruiker", "user"), ("scherm", "screen"),
    ("knop", "button"), ("pagina", "page"), ("scherm", "page"), ("kleur", "color"), ("kleuren", "css"), ("inloggen", "login"), ("inlog", "auth"),
    ("taak", "task"), ("taken", "task"), ("winkelmand", "cart"), ("winkelmandje", "cart"), ("product", "product"), ("producten", "product"),
    ("menu", "nav"), ("formulier", "form"), ("lijst", "list"), ("tabel", "table"), ("stijl", "css"), ("opmaak", "css"), ("database", "sql"),
    ("afbeelding", "image"), ("foto", "image"),
];

/// De woorden uit de omschrijving; `true` = afgeleid via een synoniem (telt minder zwaar mee).
fn woorden(tekst: &str) -> Vec<(String, bool)> {
    let mut w: Vec<(String, bool)> = tekst.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|x| x.chars().count() >= 3 && !STOP.contains(x)).map(|x| (x.to_string(), false)).collect();
    let extra: Vec<(String, bool)> = w.iter().filter_map(|(x, _)| SYNONIEM.iter().find(|(a, _)| a == x).map(|(_, b)| (b.to_string(), true))).collect();
    w.extend(extra);
    let mut gezien = HashSet::new();
    w.retain(|(x, _)| gezien.insert(x.clone()));
    w
}

pub fn bestanden_voor_taak(c: &Connection, omschrijving: &str, limiet: Option<usize>) -> String {
    let limiet = limiet.unwrap_or(6).clamp(1, 8);
    let w = woorden(omschrijving);
    if w.is_empty() {
        return "Geef een korte omschrijving met een paar woorden van de taak.".into();
    }
    let mut syms: HashMap<String, Vec<String>> = HashMap::new();
    if let Ok(mut st) = c.prepare("SELECT pad,naam FROM symbool") {
        for (p, n) in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map(|i| i.flatten().collect::<Vec<_>>()).unwrap_or_default() {
            syms.entry(p).or_default().push(n.to_lowercase());
        }
    }
    let mut tabellen: HashMap<String, Vec<String>> = HashMap::new();
    if let Ok(mut st) = c.prepare("SELECT pad,naam,kolommen FROM tabel") {
        for (p, n, k) in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))).map(|i| i.flatten().collect::<Vec<_>>()).unwrap_or_default() {
            let e = tabellen.entry(p).or_default();
            e.push(n.to_lowercase());
            e.extend(lijst(&k).into_iter().map(|x| x.to_lowercase()));
        }
    }
    let mut scores: Vec<(i32, String, Vec<String>)> = Vec::new();
    for f in alle(c) {
        let pad_l = f.pad.to_lowercase();
        let doel_l = f.doel.to_lowercase();
        let (mut score, mut redenen): (i32, Vec<String>) = (0, Vec::new());
        for (x, afgeleid) in &w {
            let before = score;
            let mut hit = false;
            if pad_l.contains(x.as_str()) {
                score += 4;
                hit = true;
            }
            if f.routes.iter().any(|r| r.to_lowercase().contains(x.as_str())) {
                score += 3;
                hit = true;
            }
            if syms.get(&f.pad).is_some_and(|s| s.iter().any(|n| n.contains(x.as_str()))) || f.exports.iter().any(|e| e.to_lowercase().contains(x.as_str())) {
                score += 3;
                hit = true;
            }
            if doel_l.contains(x.as_str()) {
                score += 2;
                hit = true;
            }
            if tabellen.get(&f.pad).is_some_and(|t| t.iter().any(|n| n.contains(x.as_str()))) {
                score += 3;
                hit = true;
            }
            if *afgeleid {
                score = before + (score - before + 2) / 3;
            }
            if hit {
                redenen.push(x.clone());
            }
        }
        if pad_l.contains(".test.") || pad_l.contains("/test/") {
            score -= (score / 2).min(score);
        }
        if score > 0 {
            scores.push((score, f.pad.clone(), redenen));
        }
    }
    scores.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    if scores.is_empty() {
        return "Niets in de kaart past duidelijk bij deze omschrijving. Kijk in de kaart (project_kaart) of zoek op een naam (zoek_symbool).".into();
    }
    let kaart: HashMap<String, String> = alle(c).into_iter().map(|f| (f.pad, f.doel)).collect();
    let mut uit = String::from("Meest waarschijnlijke bestanden (lees eerst alleen wat nodig is):\n");
    for (_, pad, red) in scores.into_iter().take(limiet) {
        uit.push_str(&format!("- {pad} — {} (past bij: {})\n", kaart.get(&pad).cloned().unwrap_or_default(), red.join(", ")));
    }
    uit
}

pub fn schema_database(c: &Connection) -> String {
    let Ok(mut st) = c.prepare("SELECT pad,naam,kolommen FROM tabel ORDER BY pad, rowid") else { return "De kaart kon niet worden gelezen.".into() };
    let rijen: Vec<(String, String, String)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map(|i| i.flatten().collect()).unwrap_or_default();
    if rijen.is_empty() {
        return "Geen databasetabellen gevonden in de migraties van dit project.".into();
    }
    let mut volgorde: Vec<String> = Vec::new();
    let mut kol: HashMap<String, Vec<String>> = HashMap::new();
    for (_, n, k) in rijen {
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
    let mut uit = String::from("Tabellen (uit de migraties):\n");
    for n in volgorde {
        uit.push_str(&format!("- {n}({})\n", kol[&n].join(", ")));
    }
    uit
}

pub fn kit_componenten(c: &Connection, namen: &[String]) -> String {
    let files = alle(c);
    let mut gebruikt: HashMap<String, Vec<String>> = HashMap::new();
    for f in &files {
        for k in &f.kit {
            gebruikt.entry(k.clone()).or_default().push(f.pad.clone());
        }
    }
    let aanwezig: Vec<&Rij> = files.iter().filter(|f| f.pad.contains("components/ui/")).collect();
    if aanwezig.is_empty() && gebruikt.is_empty() {
        return "Dit project gebruikt geen kit-componenten (geen map components/ui).".into();
    }
    let vraag: Vec<String> = namen.iter().map(|n| n.trim().to_lowercase()).filter(|n| !n.is_empty()).collect();
    let mut uit = String::new();
    let mut n_getoond = 0;
    for f in &aanwezig {
        let stam = f.pad.rsplit('/').next().unwrap_or(&f.pad).split('.').next().unwrap_or("").to_lowercase();
        if !vraag.is_empty() && !vraag.contains(&stam) {
            continue;
        }
        n_getoond += 1;
        if n_getoond > 20 {
            break;
        }
        let door = gebruikt.get(&stam).map(|v| v.len()).unwrap_or(0);
        uit.push_str(&format!("- {stam} ({}): levert {}; gebruikt in {door} bestand(en)\n", f.pad, f.exports.iter().take(8).cloned().collect::<Vec<_>>().join(", ")));
    }
    if uit.is_empty() {
        uit = "Geen van de gevraagde componenten staat in dit project.\n".into();
        if !aanwezig.is_empty() {
            uit.push_str(&format!("Beschikbaar: {}\n", aanwezig.iter().map(|f| f.pad.rsplit('/').next().unwrap_or("").split('.').next().unwrap_or("").to_string()).collect::<Vec<_>>().join(", ")));
        }
    }
    uit
}

#[cfg(test)]
mod tests {
    use super::super::index::{bijwerken, open};
    use super::*;
    use std::fs;
    use std::sync::atomic::AtomicBool;

    fn kaart() -> (tempfile::TempDir, Connection) {
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        for m in ["src/pages", "src/components/ui", "migrations"] {
            fs::create_dir_all(p.join(m)).unwrap();
        }
        fs::write(p.join("src/pages/Winkelmand.tsx"), "// Toont het winkelmandje.\nimport { Button } from \"@/components/ui/button\";\nimport { totaal } from \"../cart\";\nexport default function Winkelmand() { return null }\n").unwrap();
        fs::write(p.join("src/pages/Inloggen.tsx"), "export default function Inloggen() { return null }\n").unwrap();
        fs::write(p.join("src/cart.ts"), "export const totaal = (a: number[]) => a.length;\n").unwrap();
        fs::write(p.join("src/components/ui/button.tsx"), "export function Button() { return null }\nexport const buttonVariants = () => 1;\n").unwrap();
        fs::write(p.join("src/main.tsx"), "import W from './pages/Winkelmand';\nexport const routes = <Route path=\"/winkelmand\" />;\n").unwrap();
        fs::write(p.join("migrations/0001.sql"), "create table producten (id int, naam text);\nalter table producten add column prijs int;").unwrap();
        bijwerken(p, &AtomicBool::new(false), &|_, _| {}).unwrap();
        let c = open(p).unwrap();
        (d, c)
    }

    #[test]
    fn symbool_met_gebruikers_en_blader_optie() {
        let (_d, c) = kaart();
        let u = zoek_symbool(&c, "totaal", 0, None);
        assert!(u.contains("src/cart.ts:1") && u.contains("wordt gebruikt door: src/pages/Winkelmand.tsx"), "{u}");
        assert!(zoek_symbool(&c, "bestaatniet", 0, None).contains("staat niet in de kaart"));
        let u = zoek_symbool(&c, "e", 0, Some(1));
        assert!(u.contains("nog ") && u.contains("vanaf=1"), "{u}");
    }

    #[test]
    fn afhankelijkheden_beide_kanten() {
        let (_d, c) = kaart();
        let u = afhankelijkheden(&c, "src/cart.ts", 0, None);
        assert!(u.contains("raakt: src/pages/Winkelmand.tsx"), "{u}");
        let u = afhankelijkheden(&c, "src/pages/Winkelmand.tsx", 0, None);
        assert!(u.contains("src/components/ui/button.tsx") && u.contains("src/cart.ts") && u.contains("src/main.tsx"), "{u}");
    }

    #[test]
    fn bestanden_voor_taak_vindt_het_juiste_bestand() {
        let (_d, c) = kaart();
        let u = bestanden_voor_taak(&c, "Maak de knop in het winkelmandje groter", None);
        let eerste = u.lines().nth(1).unwrap();
        assert!(eerste.contains("Winkelmand") || eerste.contains("button"), "{u}");
        let u = bestanden_voor_taak(&c, "voeg inloggen toe", None);
        assert!(u.lines().nth(1).unwrap().contains("Inloggen.tsx"), "{u}");
        let u = bestanden_voor_taak(&c, "prijs van producten", None);
        assert!(u.contains("migrations/0001.sql"), "{u}");
        assert!(u.lines().count() <= 9);
    }

    #[test]
    fn schema_voegt_alter_samen_en_kit_is_compact() {
        let (_d, c) = kaart();
        assert!(schema_database(&c).contains("producten(id, naam, prijs)"));
        let k = kit_componenten(&c, &["button".into()]);
        assert!(k.contains("button") && k.contains("Button") && k.contains("gebruikt in 1"), "{k}");
        assert!(kit_componenten(&c, &["card".into()]).contains("Beschikbaar: button"));
    }
}
