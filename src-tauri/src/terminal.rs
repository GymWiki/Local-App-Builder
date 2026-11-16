use crate::error::{AppError, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Maximaal aantal bytes uitvoer dat per sessie bewaard blijft.
pub const BUFFER_CAP: usize = 512 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct OutputEvent {
    pub id: String,
    /// Ruwe bytes, base64 (voorkomt kapotte UTF-8 op chunkgrenzen).
    pub data: String,
    /// Totaal aantal bytes uitvoer ná deze chunk; laat de frontend buffer en live-events zonder gaten of dubbelen samenvoegen.
    pub end_offset: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExitEvent {
    pub id: String,
    pub code: Option<u32>,
}

#[derive(Debug, Clone)]
pub enum PtyEvent {
    Output(OutputEvent),
    Exit(ExitEvent),
}

pub type Sink = Arc<dyn Fn(PtyEvent) + Send + Sync>;

#[derive(Debug, Default)]
struct RingBuffer {
    data: Vec<u8>,
    total: u64,
}

impl RingBuffer {
    fn push(&mut self, chunk: &[u8]) -> u64 {
        self.total += chunk.len() as u64;
        self.data.extend_from_slice(chunk);
        if self.data.len() > BUFFER_CAP {
            let excess = self.data.len() - BUFFER_CAP;
            self.data.drain(..excess);
        }
        self.total
    }
}

#[derive(Debug, Clone)]
pub struct SpawnSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
    pub rows: u16,
    pub cols: u16,
}

#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    pub data: String,
    pub end_offset: u64,
    pub exited: bool,
    pub exit_code: Option<u32>,
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    buffer: Arc<Mutex<RingBuffer>>,
    exit: Arc<Mutex<Option<Option<u32>>>>,
}

pub struct TerminalManager {
    sessions: Mutex<HashMap<String, Session>>,
    next: AtomicU64,
    sink: Sink,
}

fn pty_err(e: impl std::fmt::Display) -> AppError {
    AppError::Invalid(format!("Terminalfout: {e}"))
}

impl TerminalManager {
    pub fn new(sink: Sink) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
            sink,
        }
    }

    pub fn spawn(&self, spec: SpawnSpec) -> Result<String> {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: spec.rows.max(1),
                cols: spec.cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(pty_err)?;
        let mut cmd = CommandBuilder::new(&spec.program);
        cmd.args(&spec.args);
        cmd.cwd(&spec.cwd);
        #[cfg(unix)]
        {
            cmd.env("TERM", "xterm-256color");
            cmd.env("COLORTERM", "truecolor");
        }
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }
        let mut child = pair.slave.spawn_command(cmd).map_err(pty_err)?;
        drop(pair.slave); // nodig om EOF te krijgen als het kindproces stopt
        let killer = child.clone_killer();
        let mut reader = pair.master.try_clone_reader().map_err(pty_err)?;
        let writer = pair.master.take_writer().map_err(pty_err)?;

        let id = format!("pty-{}", self.next.fetch_add(1, Ordering::Relaxed));
        let buffer = Arc::new(Mutex::new(RingBuffer::default()));
        let exit: Arc<Mutex<Option<Option<u32>>>> = Arc::new(Mutex::new(None));

        {
            let (id, buffer, sink) = (id.clone(), buffer.clone(), self.sink.clone());
            std::thread::spawn(move || {
                let mut chunk = [0u8; 8192];
                while let Ok(n) = reader.read(&mut chunk) {
                    if n == 0 {
                        break;
                    }
                    let end_offset = buffer.lock().unwrap().push(&chunk[..n]);
                    sink(PtyEvent::Output(OutputEvent {
                        id: id.clone(),
                        data: B64.encode(&chunk[..n]),
                        end_offset,
                    }));
                }
            });
        }
        {
            let (id, exit, sink) = (id.clone(), exit.clone(), self.sink.clone());
            std::thread::spawn(move || {
                let code = child.wait().ok().map(|s| s.exit_code());
                std::thread::sleep(Duration::from_millis(100)); // laat de lezer de laatste uitvoer afleveren
                *exit.lock().unwrap() = Some(code);
                sink(PtyEvent::Exit(ExitEvent { id, code }));
            });
        }

        self.sessions.lock().unwrap().insert(
            id.clone(),
            Session {
                master: pair.master,
                writer,
                killer,
                buffer,
                exit,
            },
        );
        Ok(id)
    }

    fn with<T>(&self, id: &str, f: impl FnOnce(&mut Session) -> Result<T>) -> Result<T> {
        let mut map = self.sessions.lock().unwrap();
        f(map.get_mut(id).ok_or(AppError::NotFound)?)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<()> {
        self.with(id, |s| {
            s.writer.write_all(data)?;
            s.writer.flush()?;
            Ok(())
        })
    }

    pub fn resize(&self, id: &str, rows: u16, cols: u16) -> Result<()> {
        self.with(id, |s| {
            s.master
                .resize(PtySize {
                    rows: rows.max(1),
                    cols: cols.max(1),
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(pty_err)
        })
    }

    pub fn snapshot(&self, id: &str) -> Result<Snapshot> {
        self.with(id, |s| {
            let b = s.buffer.lock().unwrap();
            let exit = *s.exit.lock().unwrap();
            Ok(Snapshot {
                data: B64.encode(&b.data),
                end_offset: b.total,
                exited: exit.is_some(),
                exit_code: exit.flatten(),
            })
        })
    }

    /// Stopt het proces (als het nog draait) en ruimt de sessie op.
    pub fn close(&self, id: &str) -> Result<()> {
        let mut session = self
            .sessions
            .lock()
            .unwrap()
            .remove(id)
            .ok_or(AppError::NotFound)?;
        if session.exit.lock().unwrap().is_none() {
            let _ = session.killer.kill();
        }
        Ok(())
    }

    pub fn close_all(&self) {
        let ids: Vec<String> = self.sessions.lock().unwrap().keys().cloned().collect();
        for id in ids {
            let _ = self.close(&id);
        }
    }

    #[cfg(test)]
    pub fn is_alive(&self, id: &str) -> bool {
        self.with(id, |s| Ok(s.exit.lock().unwrap().is_none()))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    type Events = Arc<Mutex<Vec<PtyEvent>>>;

    fn manager() -> (TerminalManager, Events) {
        let events: Events = Arc::default();
        let e = events.clone();
        (
            TerminalManager::new(Arc::new(move |ev| e.lock().unwrap().push(ev))),
            events,
        )
    }

    fn spec(program: &str, args: &[&str]) -> SpawnSpec {
        SpawnSpec {
            program: program.into(),
            args: args.iter().map(|s| s.to_string()).collect(),
            cwd: std::env::temp_dir(),
            env: vec![("STUDIO_TEST".into(), "waarde-42".into())],
            rows: 24,
            cols: 80,
        }
    }

    fn sh(script: &str) -> SpawnSpec {
        if cfg!(windows) {
            spec("cmd.exe", &["/C", script])
        } else {
            spec("sh", &["-c", script])
        }
    }

    fn wait_for(what: &str, mut f: impl FnMut() -> bool) {
        let t = Instant::now();
        while t.elapsed() < Duration::from_secs(10) {
            if f() {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        panic!("time-out: {what}");
    }

    fn text(m: &TerminalManager, id: &str) -> String {
        String::from_utf8_lossy(&B64.decode(m.snapshot(id).unwrap().data).unwrap()).to_string()
    }

    #[test]
    fn start_streamt_uitvoer_en_meldt_exitcode() {
        let (m, events) = manager();
        let script = if cfg!(windows) {
            "echo hallo-%STUDIO_TEST% & exit 3"
        } else {
            "echo hallo-$STUDIO_TEST; exit 3"
        };
        let id = m.spawn(sh(script)).unwrap();
        wait_for("exit", || m.snapshot(&id).unwrap().exited);

        let snap = m.snapshot(&id).unwrap();
        assert_eq!(snap.exit_code, Some(3));
        assert!(
            text(&m, &id).contains("hallo-waarde-42"),
            "buffer: {}",
            text(&m, &id)
        );
        let evs = events.lock().unwrap();
        assert!(evs
            .iter()
            .any(|e| matches!(e, PtyEvent::Exit(x) if x.id == id && x.code == Some(3))));
        let last_end = evs
            .iter()
            .filter_map(|e| {
                if let PtyEvent::Output(o) = e {
                    Some(o.end_offset)
                } else {
                    None
                }
            })
            .max();
        assert_eq!(
            last_end,
            Some(snap.end_offset),
            "end_offset van events moet bij de buffer passen"
        );
    }

    #[test]
    fn stop_beeindigt_een_draaiend_proces() {
        let (m, events) = manager();
        let id = m
            .spawn(if cfg!(windows) {
                spec("ping", &["-n", "60", "127.0.0.1"])
            } else {
                spec("sleep", &["60"])
            })
            .unwrap();
        assert!(m.is_alive(&id));
        m.close(&id).unwrap();
        wait_for("exit-event", || {
            events
                .lock()
                .unwrap()
                .iter()
                .any(|e| matches!(e, PtyEvent::Exit(x) if x.id == id))
        });
        assert!(!m.is_alive(&id));
        assert!(matches!(m.write(&id, b"x"), Err(AppError::NotFound)));
        assert!(matches!(m.close(&id), Err(AppError::NotFound)));
    }

    #[cfg(unix)]
    #[test]
    fn schrijven_en_formaat_wijzigen_werken() {
        let (m, _) = manager();
        let id = m.spawn(spec("cat", &[])).unwrap();
        m.write(&id, b"ping\n").unwrap();
        wait_for("echo", || text(&m, &id).contains("ping"));
        m.resize(&id, 40, 120).unwrap();
        m.close(&id).unwrap();
    }

    #[test]
    fn buffer_bewaart_alleen_de_laatste_uitvoer() {
        let mut b = RingBuffer::default();
        b.push(&vec![b'a'; BUFFER_CAP]);
        let total = b.push(b"einde");
        assert_eq!(b.data.len(), BUFFER_CAP);
        assert!(b.data.ends_with(b"einde"));
        assert_eq!(total, BUFFER_CAP as u64 + 5);
    }

    #[test]
    fn onbekende_sessie_geeft_notfound() {
        let (m, _) = manager();
        assert!(matches!(m.snapshot("nee"), Err(AppError::NotFound)));
    }

    #[test]
    fn programma_dat_niet_bestaat_geeft_een_fout() {
        let (m, _) = manager();
        assert!(m
            .spawn(spec("dit-programma-bestaat-niet-xyz", &[]))
            .is_err());
    }
}
