//! Bedieningsniveaus en beslissingen: wat mag de AI zelf doen, wat vraagt een bevestiging en wat wordt geweigerd.
//! Standaard per project: Voorzichtig. Klasse 4 (kosten) vraagt altijd een bevestiging, in elk niveau, zonder uitzondering.
use super::classify::{Analysis, Class, Ernst, Finding};
use serde::Serialize;
use std::collections::VecDeque;

/// Een actie zonder bevestiging mag nooit meer dan zoveel rijen raken (bij meer, of als dat niet te tellen is, vraagt Studio het toch).
pub const ROW_LIMIT: u64 = 100;
/// Hoeveel rijen een `INSERT` zonder bevestiging mag toevoegen.
pub const INSERT_LIMIT: u64 = 500;
/// Hoe lang "Volledige controle" standaard aan blijft (seconden), en de grenzen van de instelling.
pub const FULL_DEFAULT_SECS: i64 = 3600;
pub const FULL_MIN_SECS: i64 = 300;
pub const FULL_MAX_SECS: i64 = 8 * 3600;
pub const WRITES_PER_MINUTE: usize = 10;
pub const WRITES_PER_SESSION: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    Voorzichtig,
    Zelfstandig,
    Volledig,
}

impl Level {
    pub fn parse(s: &str) -> Level {
        match s {
            "zelfstandig" => Level::Zelfstandig,
            "volledig" => Level::Volledig,
            _ => Level::Voorzichtig, // alles onbekends is het veiligste niveau
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Level::Voorzichtig => "voorzichtig",
            Level::Zelfstandig => "zelfstandig",
            Level::Volledig => "volledig",
        }
    }
}

/// Het ingestelde niveau van een project. "Volledig" heeft een einde; daarna geldt automatisch "Zelfstandig".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LevelState {
    pub level: Level,
    pub full_until: Option<i64>,
}

impl LevelState {
    pub fn effective(&self, now: i64) -> Level {
        match (self.level, self.full_until) {
            (Level::Volledig, Some(t)) if now < t => Level::Volledig,
            (Level::Volledig, _) => Level::Zelfstandig, // verlopen of zonder einde
            (l, _) => l,
        }
    }
    /// Resterende seconden "Volledige controle"; `None` als het niet (meer) aan staat.
    pub fn full_left(&self, now: i64) -> Option<i64> {
        (self.effective(now) == Level::Volledig).then(|| self.full_until.unwrap_or(0) - now)
    }
}

/// Een veilige duur voor "Volledige controle".
pub fn clamp_full_secs(secs: i64) -> i64 {
    secs.clamp(FULL_MIN_SECS, FULL_MAX_SECS)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowCount {
    /// Geen rijen (of niet van toepassing).
    Geen,
    Exact(u64),
    /// Niet te bepalen: telt als "veel".
    Onbekend,
}

/// Wat er over de actie bekend is, naast de SQL zelf.
#[derive(Debug, Clone)]
pub struct Facts {
    /// Het grootste aantal rijen dat een `UPDATE`/`DELETE`/`TRUNCATE` raakt.
    pub rows: RowCount,
    /// Het aantal rijen dat een `INSERT` toevoegt.
    pub inserted: Option<u64>,
    /// Is er een back-up van de betrokken tabellen gemaakt (of niet nodig)? Zo niet, dan vraagt Studio altijd bevestiging.
    pub backup: Backup,
}

impl Default for Facts {
    fn default() -> Self {
        Facts { rows: RowCount::Geen, inserted: None, backup: Backup::NietNodig }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backup {
    NietNodig,
    Gemaakt,
    /// Kon niet (te groot, geen toegang): de gebruiker wordt hierover geïnformeerd.
    Mislukt,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "besluit", rename_all = "snake_case")]
pub enum Decision {
    Allow,
    /// De gebruiker moet bevestigen; `redenen` zijn codes voor de uitleg (`gegevens.vraag.reden.<code>`).
    Confirm { redenen: Vec<&'static str> },
    /// Niet toegestaan in dit niveau.
    Refuse { code: &'static str },
}

fn refuse_finding(findings: &[Finding]) -> Option<&'static str> {
    findings.iter().find(|f| f.ernst == Ernst::Weiger).map(|f| f.code)
}

/// De kern: combineert niveau, klasse, meldingen en feiten tot één besluit.
pub fn decide(level: Level, a: &Analysis, f: &Facts) -> Decision {
    // Veiligheidsregels voor de database zelf: alleen in "Volledige controle" toegestaan.
    if level != Level::Volledig {
        if let Some(code) = refuse_finding(&a.findings) {
            return Decision::Refuse { code };
        }
    }
    let mut redenen: Vec<&'static str> = vec![];
    match (level, a.class) {
        (_, Class::Lezen) => {}
        (Level::Voorzichtig, _) => redenen.push("niveau"),
        (Level::Zelfstandig, Class::Veilig) => {}
        (Level::Zelfstandig, _) => redenen.push("gevaarlijk"),
        (Level::Volledig, Class::Veilig | Class::Gevaarlijk) => {}
        (_, Class::Kosten) => redenen.push("kosten"),
    }
    if a.class == Class::Kosten && !redenen.contains(&"kosten") {
        redenen.push("kosten");
    }
    // Strengere regels die in elk niveau gelden, zelfs bij "Volledige controle":
    if a.onleesbaar && a.class != Class::Lezen {
        redenen.push("onleesbaar");
    }
    if a.class == Class::Gevaarlijk {
        match f.rows {
            RowCount::Exact(n) if n > ROW_LIMIT => redenen.push("veel_rijen"),
            RowCount::Onbekend => redenen.push("veel_rijen"),
            _ => {}
        }
        if f.backup == Backup::Mislukt {
            redenen.push("geen_backup");
        }
    }
    if a.class >= Class::Veilig && f.inserted.is_some_and(|n| n > INSERT_LIMIT) {
        redenen.push("veel_rijen");
    }
    redenen.dedup();
    if redenen.is_empty() {
        Decision::Allow
    } else {
        Decision::Confirm { redenen }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LimitError {
    PerMinuut,
    PerSessie,
}

/// Houdt bij hoeveel schrijfacties er zijn gedaan: maximaal per minuut en per sessie.
#[derive(Debug, Default)]
pub struct WriteLimiter {
    recent: VecDeque<i64>,
    total: usize,
}

impl WriteLimiter {
    pub fn check(&mut self, now: i64) -> Result<(), LimitError> {
        while self.recent.front().is_some_and(|t| now - t >= 60) {
            self.recent.pop_front();
        }
        if self.total >= WRITES_PER_SESSION {
            return Err(LimitError::PerSessie);
        }
        if self.recent.len() >= WRITES_PER_MINUTE {
            return Err(LimitError::PerMinuut);
        }
        Ok(())
    }
    pub fn record(&mut self, now: i64) {
        self.recent.push_back(now);
        self.total += 1;
    }
    pub fn reset_session(&mut self) {
        self.recent.clear();
        self.total = 0;
    }
}

/// Kosten van een actie (klasse 4). Bedragen zijn de gepubliceerde prijzen (docs/supabase.md); bij twijfel toont Studio beide mogelijkheden.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Cost {
    /// `gratis_plan`, `betaald_plan` of `onbekend_plan`.
    pub plan: &'static str,
    /// Ongeveer, in dollars per maand; `None` als het op het gratis plan niets kost.
    pub per_maand: Option<f64>,
}

/// Prijs per maand (ongeveer) per rekenkracht, naar de tabel in de Supabase-documentatie.
pub fn instance_per_month(size: &str) -> Option<f64> {
    Some(match size {
        "nano" => 0.0,
        "micro" => 10.0,
        "small" => 15.0,
        "medium" => 60.0,
        "large" => 110.0,
        "xlarge" => 210.0,
        "2xlarge" => 410.0,
        _ => return None,
    })
}

/// Wat een nieuw project kost. Zonder `size` is het Nano: gratis op het gratis plan, op een betaald plan afgerekend als Micro.
pub fn create_project_cost(plan: Option<&str>, size: Option<&str>) -> Cost {
    let size = size.unwrap_or("nano");
    let betaald = instance_per_month(if size == "nano" { "micro" } else { size }).unwrap_or(10.0);
    match plan.map(|p| p.to_lowercase()).as_deref() {
        Some("free") => Cost { plan: "gratis_plan", per_maand: if size == "nano" { None } else { Some(betaald) } },
        Some(_) => Cost { plan: "betaald_plan", per_maand: Some(betaald) },
        None => Cost { plan: "onbekend_plan", per_maand: Some(betaald) },
    }
}

#[cfg(test)]
mod tests;
