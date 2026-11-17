//! Bug-lus bewaker: houdt per sessie bij welke controles falen en grijpt in als de AI in cirkels draait.
use super::events::CheckInfo;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    /// Dezelfde fout, meerdere keren na elkaar.
    SameError,
    /// Dezelfde stap (bijv. "build") faalt meerdere keren na elkaar.
    SameStep,
    /// Het resultaat wordt slechter (meer fouten dan de vorige keer).
    Worse,
}

impl Reason {
    pub fn as_str(self) -> &'static str {
        match self {
            Reason::SameError => "same_error",
            Reason::SameStep => "same_step",
            Reason::Worse => "worse",
        }
    }
}

pub const DEFAULT_THRESHOLD: usize = 3;
pub const MIN_THRESHOLD: usize = 2;
pub const MAX_THRESHOLD: usize = 10;

#[derive(Debug, Default)]
pub struct LoopGuard {
    failing: Vec<CheckInfo>,
    /// De laatste controle in deze reeks slaagde (dan is de huidige staat "werkend").
    pub healthy: bool,
}

impl LoopGuard {
    #[cfg(test)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Vanaf een nieuw bericht van de gebruiker begint een nieuwe reeks.
    pub fn reset(&mut self) {
        self.failing.clear();
        self.healthy = false;
    }

    pub fn streak(&self) -> usize {
        self.failing.len()
    }

    /// Verwerkt het resultaat van een controle. Geeft een reden terug als de bewaker moet ingrijpen.
    pub fn record(&mut self, run: &CheckInfo, threshold: usize) -> Option<Reason> {
        let threshold = threshold.clamp(MIN_THRESHOLD, MAX_THRESHOLD);
        if run.ok {
            self.failing.clear();
            self.healthy = true;
            return None;
        }
        self.healthy = false;
        self.failing.push(run.clone());
        if self.failing.len() > MAX_THRESHOLD + 2 {
            self.failing.remove(0);
        }
        let n = self.failing.len();
        let last = &self.failing[n - 1];
        if n >= threshold {
            let tail = &self.failing[n - threshold..];
            if !last.signature.is_empty() && tail.iter().all(|r| r.signature == last.signature) {
                return Some(Reason::SameError);
            }
            if !last.steps.is_empty() && tail.iter().all(|r| r.steps.first() == last.steps.first())
            {
                return Some(Reason::SameStep);
            }
        }
        if n >= MIN_THRESHOLD.max(threshold - 1) && last.count > self.failing[n - 2].count {
            return Some(Reason::Worse);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fail(step: &str, sig: &str, count: usize) -> CheckInfo {
        CheckInfo {
            ok: false,
            steps: vec![step.into()],
            signature: sig.into(),
            count,
        }
    }
    fn pass() -> CheckInfo {
        CheckInfo {
            ok: true,
            steps: vec![],
            signature: String::new(),
            count: 0,
        }
    }

    #[test]
    fn dezelfde_fout_drie_keer_na_elkaar_grijpt_in_maar_twee_keer_niet() {
        let mut g = LoopGuard::new();
        assert_eq!(g.record(&fail("build", "error ts#: x", 1), 3), None);
        assert_eq!(g.record(&fail("build", "error ts#: x", 1), 3), None);
        assert_eq!(
            g.record(&fail("build", "error ts#: x", 1), 3),
            Some(Reason::SameError)
        );
        assert_eq!(g.streak(), 3);
    }

    #[test]
    fn dezelfde_stap_met_steeds_een_andere_fout_telt_ook() {
        let mut g = LoopGuard::new();
        g.record(&fail("test", "a", 2), 3);
        g.record(&fail("test", "b", 2), 3);
        assert_eq!(g.record(&fail("test", "c", 2), 3), Some(Reason::SameStep));
    }

    #[test]
    fn andere_stappen_en_andere_fouten_zijn_geen_lus() {
        let mut g = LoopGuard::new();
        for (s, e) in [("lint", "a"), ("build", "b"), ("test", "c"), ("lint", "d")] {
            assert_eq!(g.record(&fail(s, e, 2), 3), None, "{s} {e}");
        }
    }

    #[test]
    fn verslechtering_grijpt_in_zodra_het_slechter_wordt_na_een_eerdere_mislukking() {
        let mut g = LoopGuard::new();
        assert_eq!(
            g.record(&fail("lint", "a", 1), 3),
            None,
            "eerste keer: nog geen vergelijking"
        );
        assert_eq!(g.record(&fail("build", "b", 4), 3), Some(Reason::Worse));
        let mut g = LoopGuard::new();
        g.record(&fail("lint", "a", 4), 3);
        assert_eq!(
            g.record(&fail("build", "b", 2), 3),
            None,
            "beter worden is prima"
        );
    }

    #[test]
    fn een_geslaagde_controle_begint_de_reeks_opnieuw() {
        let mut g = LoopGuard::new();
        g.record(&fail("build", "x", 1), 3);
        g.record(&fail("build", "x", 1), 3);
        assert_eq!(g.record(&pass(), 3), None);
        assert!(g.healthy);
        assert_eq!(g.streak(), 0);
        assert_eq!(g.record(&fail("build", "x", 1), 3), None);
        assert!(!g.healthy);
        assert_eq!(
            g.record(&fail("build", "x", 1), 3),
            None,
            "pas na drie nieuwe pogingen"
        );
    }

    #[test]
    fn drempel_is_instelbaar_en_wordt_begrensd() {
        let mut g = LoopGuard::new();
        g.record(&fail("build", "x", 1), 2);
        assert_eq!(g.record(&fail("build", "x", 1), 2), Some(Reason::SameError));
        let mut g = LoopGuard::new();
        for _ in 0..4 {
            assert_eq!(g.record(&fail("build", "x", 1), 5), None);
        }
        assert_eq!(g.record(&fail("build", "x", 1), 5), Some(Reason::SameError));
        // onzinnige drempels worden begrensd (0 → 2, 99 → 10)
        let mut g = LoopGuard::new();
        g.record(&fail("build", "x", 1), 0);
        assert_eq!(g.record(&fail("build", "x", 1), 0), Some(Reason::SameError));
    }

    #[test]
    fn reset_vergeet_alles() {
        let mut g = LoopGuard::new();
        g.record(&fail("build", "x", 1), 3);
        g.record(&fail("build", "x", 1), 3);
        g.reset();
        assert_eq!(g.record(&fail("build", "x", 1), 3), None);
        assert!(!g.healthy);
    }
}
