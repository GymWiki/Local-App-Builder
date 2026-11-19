//! Bestandswijzigingen volgen (notify), met debounce. Houdt `node_modules` en andere zware mappen bewust buiten beeld.
use super::detect::{affects_plan, is_ignored, triggers_reload, IGNORED_DIRS};
use notify::{EventKind, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Trigger {
    /// Na een rustige periode: wat veranderde er?
    Changes { plan: bool, reload: bool },
    /// Elke paar seconden, om o.a. een afgeronde `npm install` op te merken.
    Tick,
}

pub type Callback = Arc<dyn Fn(Trigger) + Send + Sync>;

pub struct Watch {
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
    /// Alleen gevuld als het volgen van bestanden niet lukte (bijv. inotify-limiet).
    pub error: Option<String>,
}

const DEBOUNCE: Duration = Duration::from_millis(250);
const TICK: Duration = Duration::from_secs(3);
const MAX_DEPTH: usize = 10;

fn watch_tree(w: &mut notify::RecommendedWatcher, dir: &Path, depth: usize) {
    if depth > MAX_DEPTH {
        return;
    }
    let _ = w.watch(dir, RecursiveMode::NonRecursive);
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if IGNORED_DIRS.contains(&name.as_str()) || name.starts_with('.') {
            continue;
        }
        watch_tree(w, &p, depth + 1);
    }
}

pub fn start(root: &Path, cb: Callback) -> Watch {
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let root_buf = root.to_path_buf();
    let mut error = None;
    let watcher = notify::recommended_watcher(move |ev| {
        let _ = tx.send(ev);
    });
    let mut watcher = match watcher {
        Ok(mut w) => {
            watch_tree(&mut w, root, 0);
            Some(w)
        }
        Err(e) => {
            error = Some(format!("Kon bestandswijzigingen niet volgen: {e}"));
            None
        }
    };
    let stop2 = stop.clone();
    let thread = std::thread::spawn(move || {
        let mut plan = false;
        let mut reload = false;
        let mut last_event: Option<Instant> = None;
        let mut last_tick = Instant::now();
        while !stop2.load(Ordering::SeqCst) {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(ev)) => {
                    if matches!(ev.kind, EventKind::Access(_)) {
                        continue;
                    }
                    for p in &ev.paths {
                        let Ok(rel) = p.strip_prefix(&root_buf) else {
                            continue;
                        };
                        let rel: PathBuf = rel.to_path_buf();
                        if rel.as_os_str().is_empty() || is_ignored(&rel) {
                            continue;
                        }
                        // Nieuwe map: ook daarin gaan volgen.
                        if matches!(ev.kind, EventKind::Create(_)) && p.is_dir() {
                            if let Some(w) = watcher.as_mut() {
                                watch_tree(w, p, rel.components().count());
                            }
                        }
                        plan |= affects_plan(&rel);
                        reload |= triggers_reload(&rel);
                        last_event = Some(Instant::now());
                    }
                }
                Ok(Err(_)) => {}
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
            if let Some(t) = last_event {
                if t.elapsed() >= DEBOUNCE {
                    if plan || reload {
                        cb(Trigger::Changes { plan, reload });
                    }
                    plan = false;
                    reload = false;
                    last_event = None;
                }
            }
            if last_tick.elapsed() >= TICK {
                last_tick = Instant::now();
                cb(Trigger::Tick);
            }
        }
        drop(watcher);
    });
    Watch {
        stop,
        thread: Some(thread),
        error,
    }
}

impl Watch {
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn collect(root: &Path) -> (Watch, Arc<Mutex<Vec<Trigger>>>) {
        let seen: Arc<Mutex<Vec<Trigger>>> = Arc::default();
        let s = seen.clone();
        (
            start(root, Arc::new(move |t| s.lock().unwrap().push(t))),
            seen,
        )
    }

    fn wait(seen: &Arc<Mutex<Vec<Trigger>>>, f: impl Fn(&Trigger) -> bool) -> bool {
        let t = Instant::now();
        while t.elapsed() < Duration::from_secs(5) {
            if seen.lock().unwrap().iter().any(&f) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    #[test]
    fn merkt_nieuwe_gewijzigde_en_verwijderde_bestanden_op_ook_in_nieuwe_submappen() {
        let d = tempfile::tempdir().unwrap();
        let (_w, seen) = collect(d.path());
        std::fs::write(d.path().join("index.html"), "x").unwrap();
        assert!(wait(&seen, |t| matches!(
            t,
            Trigger::Changes {
                plan: true,
                reload: true
            }
        )));

        seen.lock().unwrap().clear();
        std::fs::create_dir(d.path().join("css")).unwrap();
        std::thread::sleep(Duration::from_millis(400));
        std::fs::write(d.path().join("css/app.css"), "x").unwrap();
        assert!(
            wait(&seen, |t| matches!(
                t,
                Trigger::Changes { reload: true, .. }
            )),
            "wijziging in nieuwe map gemist"
        );

        seen.lock().unwrap().clear();
        std::fs::remove_file(d.path().join("index.html")).unwrap();
        assert!(wait(&seen, |t| matches!(
            t,
            Trigger::Changes { plan: true, .. }
        )));
    }

    #[test]
    fn negeert_node_modules_dotfiles_en_studio_eigen_bestanden() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("node_modules/pkg")).unwrap();
        let (_w, seen) = collect(d.path());
        std::fs::write(d.path().join("node_modules/pkg/index.js"), "x").unwrap();
        std::fs::write(d.path().join(".env"), "x").unwrap();
        std::fs::write(d.path().join("CLAUDE.md"), "x").unwrap();
        std::thread::sleep(Duration::from_millis(900));
        assert!(
            !seen
                .lock()
                .unwrap()
                .iter()
                .any(|t| matches!(t, Trigger::Changes { reload: true, .. })),
            "{:?}",
            seen.lock().unwrap()
        );
    }

    #[test]
    fn stop_beeindigt_de_thread_en_er_komen_geen_events_meer() {
        let d = tempfile::tempdir().unwrap();
        let (mut w, seen) = collect(d.path());
        w.stop();
        seen.lock().unwrap().clear();
        std::fs::write(d.path().join("a.txt"), "x").unwrap();
        std::thread::sleep(Duration::from_millis(600));
        assert!(seen.lock().unwrap().is_empty());
    }
}
