//! Versienummer en buildnummer van een Flutter-app (`version: 1.2.3+4` in pubspec.yaml). Elke upload naar een winkel moet een hoger
//! buildnummer hebben dan de vorige; Studio verhoogt het automatisch. We wijzigen alleen die ene regel en laten de rest ongemoeid.
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Versie {
    pub naam: String,
    pub build: u32,
}

impl Versie {
    pub fn tekst(&self) -> String {
        format!("{}+{}", self.naam, self.build)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ophogen {
    Build,
    Patch,
    Minor,
    Major,
}

pub fn parse(s: &str) -> Option<Versie> {
    let s = s.trim().trim_matches(['"', '\'']);
    let (naam, build) = match s.split_once('+') {
        Some((n, b)) => (n, b.parse::<u32>().ok()?),
        None => (s, 1),
    };
    let delen: Vec<&str> = naam.split('.').collect();
    (delen.len() == 3 && delen.iter().all(|d| !d.is_empty() && d.len() <= 9 && d.chars().all(|c| c.is_ascii_digit()))).then(|| Versie { naam: naam.to_string(), build })
}

pub fn lees(dir: &Path) -> Option<Versie> {
    let t = fs::read_to_string(dir.join("pubspec.yaml")).ok()?;
    t.lines().find_map(|l| l.strip_prefix("version:").and_then(|r| parse(r.split('#').next().unwrap_or(""))))
}

pub fn hoger(v: &Versie, hoe: Ophogen) -> Versie {
    let mut d: Vec<u32> = v.naam.split('.').map(|x| x.parse().unwrap_or(0)).collect();
    match hoe {
        Ophogen::Build => return Versie { naam: v.naam.clone(), build: v.build + 1 },
        Ophogen::Patch => d[2] += 1,
        Ophogen::Minor => {
            d[1] += 1;
            d[2] = 0;
        }
        Ophogen::Major => {
            d[0] += 1;
            d[1] = 0;
            d[2] = 0;
        }
    }
    // Een nieuwe versienaam begint niet opnieuw bij build 1: winkels willen altijd een hoger buildnummer.
    Versie { naam: d.iter().map(u32::to_string).collect::<Vec<_>>().join("."), build: v.build + 1 }
}

/// Zet de nieuwe versie in pubspec.yaml (alleen de regel `version:`; commentaar en de rest blijven staan).
pub fn schrijf(dir: &Path, nieuw: &Versie) -> Result<(), &'static str> {
    let pad = dir.join("pubspec.yaml");
    let t = fs::read_to_string(&pad).map_err(|_| "geen_pubspec")?;
    let mut gevonden = false;
    let regels: Vec<String> = t
        .lines()
        .map(|l| {
            if !gevonden && l.starts_with("version:") {
                gevonden = true;
                format!("version: {}", nieuw.tekst())
            } else {
                l.to_string()
            }
        })
        .collect();
    if !gevonden {
        return Err("geen_versieregel");
    }
    let mut uit = regels.join("\n");
    if t.ends_with('\n') {
        uit.push('\n');
    }
    fs::write(pad, uit).map_err(|_| "schrijven_mislukt")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leest_en_controleert_versies() {
        assert_eq!(parse("1.2.3+4"), Some(Versie { naam: "1.2.3".into(), build: 4 }));
        assert_eq!(parse(" 0.1.0 "), Some(Versie { naam: "0.1.0".into(), build: 1 }));
        for slecht in ["1.2", "1.2.3.4", "a.b.c", "1.2.3+x", "", "1..3"] {
            assert_eq!(parse(slecht), None, "{slecht}");
        }
    }

    #[test]
    fn ophogen_geeft_altijd_een_hoger_buildnummer() {
        let v = Versie { naam: "1.2.3".into(), build: 7 };
        assert_eq!(hoger(&v, Ophogen::Build).tekst(), "1.2.3+8");
        assert_eq!(hoger(&v, Ophogen::Patch).tekst(), "1.2.4+8");
        assert_eq!(hoger(&v, Ophogen::Minor).tekst(), "1.3.0+8");
        assert_eq!(hoger(&v, Ophogen::Major).tekst(), "2.0.0+8");
    }

    #[test]
    fn schrijft_alleen_de_versieregel() {
        let d = tempfile::tempdir().unwrap();
        let oud = "name: winkel # naam\nversion: 1.0.0+1 # eerste\ndependencies:\n  flutter:\n    sdk: flutter\nversion_hint: x\n";
        fs::write(d.path().join("pubspec.yaml"), oud).unwrap();
        assert_eq!(lees(d.path()).unwrap().tekst(), "1.0.0+1");
        let n = hoger(&lees(d.path()).unwrap(), Ophogen::Patch);
        schrijf(d.path(), &n).unwrap();
        let nieuw = fs::read_to_string(d.path().join("pubspec.yaml")).unwrap();
        assert_eq!(nieuw, oud.replace("version: 1.0.0+1 # eerste", "version: 1.0.1+2"));
        assert_eq!(lees(d.path()).unwrap().tekst(), "1.0.1+2");
        fs::write(d.path().join("pubspec.yaml"), "name: x\n").unwrap();
        assert_eq!(schrijf(d.path(), &n), Err("geen_versieregel"));
    }
}
