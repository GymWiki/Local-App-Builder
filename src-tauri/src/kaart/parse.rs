//! Eenvoudige, snelle parsers per taal (regels en reguliere expressies). Geen AI en geen netwerk.
//! Waarom geen tree-sitter: dat vraagt per taal een C-bouwstap; voor een kaart op bestandsniveau (wat staat waar) is dit genoeg,
//! en de terugval bij twijfel is hoe dan ook "alleen de bestandsnaam". Letterlijke tekstwaarden komen nooit in de index (geen geheimen).
use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Symbool {
    pub naam: String,
    pub soort: &'static str,
    pub sig: String,
    pub regel: usize,
}

#[derive(Debug, Clone, Default)]
pub struct Info {
    pub taal: &'static str,
    pub doel: String,
    pub exports: Vec<String>,
    pub imports: Vec<String>,
    pub routes: Vec<String>,
    pub symbolen: Vec<Symbool>,
    /// (tabelnaam, kolommen); een kolom met `+` ervoor is later toegevoegd.
    pub tabellen: Vec<(String, Vec<String>)>,
    pub kit: Vec<String>,
}

pub fn taal(pad: &str) -> Option<&'static str> {
    let ext = pad.rsplit('.').next()?.to_lowercase();
    Some(match ext.as_str() {
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" => "js",
        "dart" => "dart",
        "html" | "htm" => "html",
        "css" | "scss" => "css",
        "sql" => "sql",
        _ => return None,
    })
}

macro_rules! re {
    ($naam:ident, $p:expr) => {
        fn $naam() -> &'static Regex {
            static R: OnceLock<Regex> = OnceLock::new();
            R.get_or_init(|| Regex::new($p).unwrap())
        }
    };
}

re!(re_import, r#"^\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]"#);
re!(re_require, r#"require\(\s*['"]([^'"]+)['"]\s*\)"#);
re!(re_dyn, r#"import\(\s*['"]([^'"]+)['"]\s*\)"#);
re!(re_export, r"^export\s+(?:default\s+)?(?:async\s+)?(function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)");
re!(re_export_list, r"^export\s*\{([^}]*)\}");
re!(re_export_default_naam, r"^export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$");
re!(re_sym_fn, r"^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)");
re!(re_sym_const, r"^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>");
re!(re_sym_class, r"^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)");
re!(re_sym_type, r"^(?:export\s+)?(interface|type|enum)\s+([A-Za-z_$][\w$]*)");
re!(re_route_jsx, r#"<Route\b[^>]*\bpath=\s*[{]?\s*['"]([^'"]+)['"]"#);
re!(re_route_obj, r#"\bpath:\s*['"](/[^'"]*)['"]"#);
re!(re_route_srv, r#"\b(?:app|router|server)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]"#);
re!(re_dart_import, r#"^\s*(?:import|export)\s+['"]([^'"]+)['"]"#);
re!(re_dart_class, r"^\s*(?:abstract\s+)?class\s+([A-Za-z_]\w*)(?:\s+extends\s+([A-Za-z_][\w<>]*))?");
re!(re_dart_fn, r"^(?:Future<[^>]*>|Future|void|int|double|bool|String|Widget|List<[^>]*>|Map<[^>]*>|[A-Z]\w*)\s+([a-z_]\w*)\s*\(");
re!(re_dart_route, r#"(?:GoRoute\(\s*path:\s*|^\s*)['"](/[^'"]*)['"]\s*(?::|,)"#);
re!(re_html_title, r"(?is)<title[^>]*>(.*?)</title>");
re!(re_html_h1, r"(?is)<h1[^>]*>(.*?)</h1>");
re!(re_html_src, r#"(?i)(?:src|href)=["']([^"':#?][^"']*)["']"#);
re!(re_html_tag, r"<[^>]+>");
re!(re_css_var, r"(--[A-Za-z][\w-]*)\s*:");
re!(re_css_regel, r"^\s*([.#][A-Za-z_][\w-]*)\s*[{,]");
re!(re_sql_create, r"(?is)create\s+table\s+(?:if\s+not\s+exists\s+)?([A-Za-z_][\w.\x22]*)\s*\((.*?)\)\s*;");
re!(re_sql_alter, r"(?is)alter\s+table\s+(?:if\s+exists\s+)?([A-Za-z_][\w.\x22]*)\s+add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([A-Za-z_]\w*)");

fn kort(s: &str, max: usize) -> String {
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() <= max {
        s
    } else {
        let mut t: String = s.chars().take(max.saturating_sub(1)).collect();
        t.push('…');
        t
    }
}

/// Signatuur: de eerste regel zonder accolade, zonder letterlijke tekstwaarden (die kunnen geheimen zijn).
fn signatuur(regel: &str) -> String {
    static LIT: OnceLock<Regex> = OnceLock::new();
    let lit = LIT.get_or_init(|| Regex::new(r#""[^"]*"|'[^']*'|`[^`]*`"#).unwrap());
    let r = regel.trim().trim_end_matches('{').trim_end_matches("=>").trim();
    kort(&lit.replace_all(r, "…"), 110)
}

fn uniek(v: &mut Vec<String>) {
    let mut gezien = std::collections::HashSet::new();
    v.retain(|x| gezien.insert(x.clone()));
}

/// De eerste zin van een inleidend commentaar bovenaan het bestand.
fn eerste_commentaar(tekst: &str) -> Option<String> {
    let mut stukken: Vec<String> = Vec::new();
    let mut in_blok = false;
    for r in tekst.lines().take(25) {
        let t = r.trim();
        if t.is_empty() && stukken.is_empty() && !in_blok {
            continue;
        }
        if in_blok {
            let b = t.trim_start_matches('*').trim();
            if t.contains("*/") {
                let b = b.trim_end_matches("*/").trim();
                if !b.is_empty() {
                    stukken.push(b.into());
                }
                break;
            }
            if !b.is_empty() && !b.starts_with('@') {
                stukken.push(b.into());
            }
        } else if let Some(rest) = t.strip_prefix("/**").or_else(|| t.strip_prefix("/*")) {
            let b = rest.trim();
            if b.ends_with("*/") {
                stukken.push(b.trim_end_matches("*/").trim().into());
                break;
            }
            in_blok = true;
            if !b.is_empty() {
                stukken.push(b.into());
            }
        } else if let Some(rest) = t.strip_prefix("///").or_else(|| t.strip_prefix("//!")).or_else(|| t.strip_prefix("//")).or_else(|| t.strip_prefix("--")) {
            let b = rest.trim();
            if b.starts_with("eslint") || b.starts_with("@ts-") || b.starts_with("prettier") || b.starts_with("<reference") {
                continue;
            }
            if !b.is_empty() {
                stukken.push(b.into());
            }
        } else if t.starts_with("'use ") || t.starts_with("\"use ") {
            continue;
        } else {
            break;
        }
        if stukken.join(" ").ends_with('.') {
            break;
        }
    }
    let s = stukken.join(" ");
    if s.is_empty() {
        return None;
    }
    let zin = s.split(". ").next().unwrap_or(&s).trim_end_matches('.');
    Some(kort(zin, 110))
}

fn doel_uit_naam(pad: &str) -> String {
    let bestand = pad.rsplit('/').next().unwrap_or(pad);
    let stam = bestand.rsplit_once('.').map(|(a, _)| a).unwrap_or(bestand);
    kort(&stam.replace(['-', '_'], " "), 60)
}

fn parse_js(pad: &str, tekst: &str, i: &mut Info) {
    let mut lijst_exports: Vec<String> = Vec::new();
    for (n, regel) in tekst.lines().enumerate() {
        if regel.len() > 600 {
            continue; // geminimaliseerde of gegenereerde regel
        }
        for r in [re_import(), re_require(), re_dyn()] {
            if let Some(c) = r.captures(regel) {
                i.imports.push(c[1].to_string());
            }
        }
        // Alleen op de eerste kolom: geneste functies zijn geen kaartmateriaal.
        if !regel.starts_with(|c: char| c.is_whitespace()) {
            if let Some(c) = re_export().captures(regel) {
                lijst_exports.push(c[2].to_string());
            } else if let Some(c) = re_export_list().captures(regel) {
                for d in c[1].split(',') {
                    let naam = d.split(" as ").last().unwrap_or("").trim();
                    if !naam.is_empty() {
                        lijst_exports.push(naam.to_string());
                    }
                }
            } else if let Some(c) = re_export_default_naam().captures(regel) {
                lijst_exports.push(c[1].to_string());
            }
            let (naam, soort) = if let Some(c) = re_sym_fn().captures(regel) {
                (Some(c[1].to_string()), "functie")
            } else if let Some(c) = re_sym_const().captures(regel) {
                let n = c[1].to_string();
                let soort = if n.chars().next().is_some_and(|x| x.is_uppercase()) { "component" } else { "functie" };
                (Some(n), soort)
            } else if let Some(c) = re_sym_class().captures(regel) {
                (Some(c[1].to_string()), "klasse")
            } else if let Some(c) = re_sym_type().captures(regel) {
                (Some(c[2].to_string()), "type")
            } else {
                (None, "")
            };
            if let Some(naam) = naam {
                let soort = if soort == "functie" && naam.chars().next().is_some_and(|x| x.is_uppercase()) { "component" } else { soort };
                i.symbolen.push(Symbool { naam, soort, sig: signatuur(regel), regel: n + 1 });
            }
        }
        if let Some(c) = re_route_jsx().captures(regel) {
            i.routes.push(c[1].to_string());
        }
        let bestandsnaam = pad.rsplit('/').next().unwrap_or(pad).to_lowercase();
        if bestandsnaam.contains("rout") || bestandsnaam.starts_with("app.") || bestandsnaam.starts_with("main.") {
            if let Some(c) = re_route_obj().captures(regel) {
                i.routes.push(c[1].to_string());
            }
        }
        if let Some(c) = re_route_srv().captures(regel) {
            i.routes.push(format!("{} {}", c[1].to_uppercase(), &c[2]));
        }
    }
    i.exports = lijst_exports;
    // Bestandsgebonden routes (Next.js app/ en pages/, SvelteKit routes/).
    let comps: Vec<&str> = pad.split('/').collect();
    if let Some(p) = comps.iter().position(|c| *c == "app" || *c == "pages" || *c == "routes") {
        let laatste = comps.last().copied().unwrap_or("");
        let stam = laatste.rsplit_once('.').map(|(a, _)| a).unwrap_or(laatste);
        if (comps[p] == "app" && stam == "page") || comps[p] != "app" && !stam.starts_with('_') {
            let mut r: Vec<&str> = comps[p + 1..comps.len() - 1].to_vec();
            if comps[p] != "app" && stam != "index" && stam != "+page" {
                r.push(stam);
            }
            i.routes.push(format!("/{}", r.join("/")));
        }
    }
    for imp in &i.imports {
        if let Some(rest) = imp.split("components/ui/").nth(1) {
            i.kit.push(rest.split('/').next().unwrap_or(rest).to_string());
        }
    }
}

fn parse_dart(tekst: &str, i: &mut Info) {
    for (n, regel) in tekst.lines().enumerate() {
        if regel.len() > 600 {
            continue;
        }
        if let Some(c) = re_dart_import().captures(regel) {
            i.imports.push(c[1].to_string());
        }
        if let Some(c) = re_dart_class().captures(regel) {
            let naam = c[1].to_string();
            let basis = c.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
            let soort = if basis.starts_with("Stateless") || basis.starts_with("Stateful") { "scherm" } else { "klasse" };
            if !naam.starts_with('_') {
                i.exports.push(naam.clone());
            }
            i.symbolen.push(Symbool { naam, soort, sig: signatuur(regel), regel: n + 1 });
        } else if !regel.starts_with(char::is_whitespace) {
            if let Some(c) = re_dart_fn().captures(regel) {
                let naam = c[1].to_string();
                if !naam.starts_with('_') {
                    i.exports.push(naam.clone());
                }
                i.symbolen.push(Symbool { naam, soort: "functie", sig: signatuur(regel), regel: n + 1 });
            }
        }
        if regel.contains("GoRoute(") || regel.trim_start().starts_with("'/") || regel.trim_start().starts_with("\"/") {
            if let Some(c) = re_dart_route().captures(regel) {
                i.routes.push(c[1].to_string());
            }
        }
    }
}

fn parse_html(pad: &str, tekst: &str, i: &mut Info) {
    let schoon = |s: &str| kort(&re_html_tag().replace_all(s, ""), 90);
    if let Some(c) = re_html_title().captures(tekst) {
        i.doel = schoon(&c[1]);
    } else if let Some(c) = re_html_h1().captures(tekst) {
        i.doel = schoon(&c[1]);
    }
    for c in re_html_src().captures_iter(tekst) {
        let w = &c[1];
        if !w.starts_with("http") && !w.starts_with("//") && !w.starts_with("data:") && !w.starts_with("mailto:") && (w.ends_with(".js") || w.ends_with(".css") || w.ends_with(".html") || w.ends_with(".mjs")) {
            i.imports.push(w.to_string());
        }
    }
    i.routes.push(format!("/{}", pad.trim_end_matches("index.html").trim_end_matches('/')));
}

fn parse_css(tekst: &str, i: &mut Info) {
    for c in re_css_var().captures_iter(tekst) {
        i.exports.push(c[1].to_string());
    }
    for (n, regel) in tekst.lines().enumerate() {
        if regel.len() > 400 {
            continue;
        }
        if let Some(c) = re_css_regel().captures(regel) {
            i.symbolen.push(Symbool { naam: c[1].to_string(), soort: "stijl", sig: String::new(), regel: n + 1 });
        }
    }
    i.symbolen.truncate(60);
    i.exports.truncate(40);
    for c in tekst.lines().filter_map(|r| r.trim().strip_prefix("@import")) {
        if let Some(u) = c.split(['\'', '"']).nth(1) {
            i.imports.push(u.to_string());
        }
    }
}

fn parse_sql(tekst: &str, i: &mut Info) {
    for c in re_sql_create().captures_iter(tekst) {
        let naam = c[1].replace('"', "");
        let mut kolommen = Vec::new();
        let (mut diepte, mut stuk) = (0i32, String::new());
        let mut delen = Vec::new();
        for ch in c[2].chars() {
            match ch {
                '(' => diepte += 1,
                ')' => diepte -= 1,
                _ => {}
            }
            if ch == ',' && diepte == 0 {
                delen.push(std::mem::take(&mut stuk));
            } else {
                stuk.push(ch);
            }
        }
        delen.push(stuk);
        for d in delen {
            let eerste = d.split_whitespace().next().unwrap_or("").trim_matches('"').to_string();
            let l = eerste.to_lowercase();
            if eerste.is_empty() || ["primary", "foreign", "unique", "constraint", "check", "like"].contains(&l.as_str()) {
                continue;
            }
            kolommen.push(eerste);
        }
        i.tabellen.push((naam, kolommen));
    }
    for c in re_sql_alter().captures_iter(tekst) {
        i.tabellen.push((c[1].replace('"', ""), vec![format!("+{}", &c[2])]));
    }
}

/// Parseert één bestand. `None` voor de taal = alleen de bestandsnaam (de terugval).
pub fn parse(pad: &str, tekst: &str) -> Info {
    let mut i = Info { taal: taal(pad).unwrap_or("overig"), ..Default::default() };
    match i.taal {
        "js" => parse_js(pad, tekst, &mut i),
        "dart" => parse_dart(tekst, &mut i),
        "html" => parse_html(pad, tekst, &mut i),
        "css" => parse_css(tekst, &mut i),
        "sql" => parse_sql(tekst, &mut i),
        _ => {}
    }
    uniek(&mut i.imports);
    uniek(&mut i.exports);
    uniek(&mut i.routes);
    uniek(&mut i.kit);
    if i.doel.is_empty() {
        i.doel = eerste_commentaar(tekst).unwrap_or_default();
    }
    if i.doel.is_empty() {
        i.doel = match (i.taal, i.symbolen.iter().find(|s| s.soort == "component" || s.soort == "scherm")) {
            (_, Some(s)) => format!("{} {}", if s.soort == "scherm" { "Scherm" } else { "Component" }, s.naam),
            ("sql", _) if !i.tabellen.is_empty() => format!("Tabellen: {}", i.tabellen.iter().map(|t| t.0.clone()).collect::<Vec<_>>().join(", ")),
            ("css", _) => "Stijlen".into(),
            _ if !i.exports.is_empty() => format!("Levert {}", i.exports.iter().take(4).cloned().collect::<Vec<_>>().join(", ")),
            _ => doel_uit_naam(pad),
        };
    }
    i
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typescript_exports_imports_routes_en_kit() {
        let t = r#"/** Het inlogscherm. Meer uitleg volgt. */
import { Button } from "@/components/ui/button";
import { Card } from '@/components/ui/card';
import api from "./api";
export default function Inloggen({ naam }: Props) {
  return <Route path="/inloggen" />;
}
export const SLEUTEL = "sk_live_geheim";
const Kaart = (p: P) => <div/>;
export interface Props { naam: string }
export { Kaart as Kaartje };
"#;
        let i = parse("src/Inloggen.tsx", t);
        assert_eq!(i.doel, "Het inlogscherm");
        assert_eq!(i.imports, vec!["@/components/ui/button", "@/components/ui/card", "./api"]);
        assert_eq!(i.kit, vec!["button", "card"]);
        assert!(i.exports.contains(&"Inloggen".to_string()) && i.exports.contains(&"Kaartje".to_string()) && i.exports.contains(&"Props".to_string()));
        assert_eq!(i.routes, vec!["/inloggen"]);
        let s = i.symbolen.iter().find(|s| s.naam == "Inloggen").unwrap();
        assert_eq!((s.soort, s.regel), ("component", 5));
        // letterlijke waarden komen niet in de signatuur
        let c = i.symbolen.iter().find(|s| s.naam == "SLEUTEL");
        assert!(c.is_none() || !c.unwrap().sig.contains("sk_live"));
    }

    #[test]
    fn signatuur_verbergt_tekstwaarden() {
        assert_eq!(signatuur("const k = (x = \"sk_live_abc\") =>"), "const k = (x = …)");
    }

    #[test]
    fn dart_schermen_en_routes() {
        let t = "import 'package:flutter/material.dart';\nimport 'home.dart';\nclass Home extends StatelessWidget {\n}\nclass _Prive {}\nfinal r = GoRouter(routes: [GoRoute(path: '/home', builder: (c, s) => Home())]);\nvoid main() {}\n";
        let i = parse("lib/main.dart", t);
        assert!(i.symbolen.iter().any(|s| s.naam == "Home" && s.soort == "scherm"));
        assert!(!i.exports.contains(&"_Prive".to_string()));
        assert_eq!(i.routes, vec!["/home"]);
        assert!(i.exports.contains(&"main".to_string()));
    }

    #[test]
    fn html_titel_en_koppelingen() {
        let i = parse("index.html", "<html><title>Mijn <b>winkel</b></title><link href=\"stijl.css\"><script src=\"app.js\"></script><a href=\"https://x.nl/a.js\">");
        assert_eq!(i.doel, "Mijn winkel");
        assert_eq!(i.imports, vec!["stijl.css", "app.js"]);
        assert_eq!(i.routes, vec!["/"]);
    }

    #[test]
    fn sql_tabellen_en_kolommen() {
        let i = parse("migrations/0001.sql", "create table if not exists public.taken (\n id uuid primary key,\n titel text not null,\n klaar boolean default false,\n constraint x check (titel <> ''),\n owner uuid references auth.users(id)\n);\nalter table public.taken add column notitie text;");
        assert_eq!(i.tabellen[0].0, "public.taken");
        assert_eq!(i.tabellen[0].1, vec!["id", "titel", "klaar", "owner"]);
        assert_eq!(i.tabellen[1].1, vec!["+notitie"]);
    }

    #[test]
    fn css_variabelen_en_terugval_op_bestandsnaam() {
        let i = parse("stijl.css", ":root { --kleur-hoofd: #123; }\n.knop { }\n");
        assert_eq!(i.exports, vec!["--kleur-hoofd"]);
        assert!(i.symbolen.iter().any(|s| s.naam == ".knop"));
        assert_eq!(parse("notities.txt", "x").doel, "notities");
        assert_eq!(parse("src/mijn-pagina.tsx", "").doel, "mijn pagina");
    }

    #[test]
    fn bestandsgebonden_routes() {
        assert_eq!(parse("app/winkel/page.tsx", "export default function P(){}").routes, vec!["/winkel"]);
        assert_eq!(parse("pages/over.tsx", "export default function P(){}").routes, vec!["/over"]);
    }
}
