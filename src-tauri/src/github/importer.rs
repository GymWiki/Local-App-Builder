//! Een project van GitHub ophalen: wat herkennen we en wat (nog) niet? Alleen lezen; er wordt hier niets uitgevoerd.
//! Commando's uit `studio.json` blijven geblokkeerd tot de gebruiker ze goedkeurt (bestaande regel van Studio).
use crate::preview::detect;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Inspect {
    /// Soort project volgens de preview-detectie: `static`, `node`, `config`, `flutter`, `unsupported`, `empty`.
    pub soort: String,
    pub template: &'static str,
    pub studio_json: bool,
    /// Wat we niet herkennen of wat nog ontbreekt (codes; nl.json: `github.ophalen.niet.<code>`).
    pub niet_herkend: Vec<&'static str>,
}

pub fn inspect(dir: &Path) -> Inspect {
    let plan = detect::detect(dir);
    let soort = serde_json::to_value(plan.kind).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_else(|| "unsupported".into());
    let studio_json = dir.join("studio.json").is_file();
    let mut niet = vec![];
    if !studio_json {
        niet.push("geen_studio_json");
    } else if plan.config_error.is_some() {
        niet.push("studio_json_onleesbaar");
    }
    if !plan.previewable() {
        niet.push("geen_voorbeeld");
    }
    if !dir.join("PROJECT.md").is_file() {
        niet.push("geen_project_md");
    }
    // Het meegeleverde template herkennen we aan zijn eigen onderdelen; alles anders is een "eigen" project.
    let template = if dir.join("package.json").is_file() && dir.join("src/kit").is_dir() { "web-react-vite" } else { "leeg" };
    Inspect { soort, template, studio_json, niet_herkend: niet }
}

/// Een veilige mapnaam uit de naam van de repository.
pub fn folder_for(repo: &str) -> Option<String> {
    crate::projects::folder_name(repo).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn herkent_een_statische_site_en_zegt_wat_er_ontbreekt() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("index.html"), "<h1>x</h1>").unwrap();
        let i = inspect(d.path());
        assert_eq!((i.soort.as_str(), i.template, i.studio_json), ("static", "leeg", false));
        assert_eq!(i.niet_herkend, vec!["geen_studio_json", "geen_project_md"]);
    }

    #[test]
    fn een_onbekend_project_krijgt_een_eerlijke_lijst() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("main.go"), "package main").unwrap();
        let i = inspect(d.path());
        assert!(i.niet_herkend.contains(&"geen_voorbeeld"), "{i:?}");
    }

    #[test]
    fn herkent_een_studio_json_en_het_eigen_template() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("studio.json"), r#"{"dev":"npm run dev"}"#).unwrap();
        fs::write(d.path().join("package.json"), r#"{"scripts":{"dev":"vite"}}"#).unwrap();
        fs::create_dir_all(d.path().join("src/kit")).unwrap();
        fs::write(d.path().join("PROJECT.md"), "# x").unwrap();
        let i = inspect(d.path());
        assert_eq!((i.template, i.studio_json), ("web-react-vite", true));
        assert!(!i.niet_herkend.contains(&"geen_studio_json") && !i.niet_herkend.contains(&"geen_project_md"));
    }

    #[test]
    fn mapnamen_komen_uit_de_naam_van_de_repository() {
        assert_eq!(folder_for("mijn-app").as_deref(), Some("mijn-app"));
        assert!(folder_for("../boos").map(|f| !f.contains("..") && !f.contains('/')).unwrap_or(true));
    }
}
