//! Git naar en van GitHub via libgit2. Het token bestaat alleen in de `credentials`-callback (geheugen): niet in de URL, niet in een
//! bestand, niet op een opdrachtregel. We sturen alleen vooruit: nooit een `+`-refspec, nooit verwijderen, nooit herschrijven.
use super::GhError;
use git2::{Cred, ErrorClass, ErrorCode, FetchOptions, Oid, PushOptions, RemoteCallbacks, Repository, Sort};
use std::cell::{Cell, RefCell};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// Inloggegevens voor https. Wordt nooit afgedrukt.
pub struct Creds {
    user: String,
    token: String,
}

impl Creds {
    pub fn new(user: &str, token: &str) -> Self {
        Self { user: user.to_string(), token: token.to_string() }
    }
}

impl std::fmt::Debug for Creds {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Creds(..)")
    }
}

/// Instellingen voor één netwerkactie.
pub struct Net<'a> {
    pub creds: Option<&'a Creds>,
    pub cancel: &'a AtomicBool,
    pub max: Duration,
}

pub fn open(dir: &Path) -> Result<Repository, GhError> {
    Repository::open(dir).map_err(|_| GhError::GeenVersies)
}

/// De naam van de huidige tak, of `None` als er nog geen versie is (of geen tak).
pub fn head_branch(repo: &Repository) -> Option<String> {
    let h = repo.head().ok()?;
    h.is_branch().then(|| h.shorthand().map(String::from)).flatten()
}

pub fn head_oid(repo: &Repository) -> Option<Oid> {
    repo.head().ok()?.target()
}

/// Het aantal versies dat niet in `zonder` zit (of alle als `None`).
pub fn count_new(repo: &Repository, tip: Oid, zonder: Option<Oid>) -> usize {
    let Ok(mut w) = repo.revwalk() else { return 0 };
    let _ = w.set_sorting(Sort::TOPOLOGICAL);
    if w.push(tip).is_err() {
        return 0;
    }
    if let Some(z) = zonder {
        if repo.find_commit(z).is_ok() {
            let _ = w.hide(z);
        }
    }
    w.count()
}

/// (vooruit, achter) van `lokaal` ten opzichte van `remote`.
pub fn ahead_behind(repo: &Repository, lokaal: Oid, remote: Oid) -> (usize, usize) {
    repo.graph_ahead_behind(lokaal, remote).unwrap_or((0, 0))
}

/// De enige refspec voor sturen: tak naar dezelfde tak, zonder `+`. Een ongeldige tak geeft een fout.
pub fn push_refspec(branch: &str) -> Result<String, GhError> {
    let ok = !branch.is_empty() && !branch.starts_with(['+', '-', ':', '/']) && !branch.contains(['\\', ' ', ':', '~', '^', '?', '*', '[']) && !branch.contains("..");
    if !ok {
        return Err(GhError::Onverwacht);
    }
    let s = format!("refs/heads/{branch}:refs/heads/{branch}");
    debug_assert!(!s.starts_with('+'));
    Ok(s)
}

fn map(e: &git2::Error) -> GhError {
    let m = e.message().to_lowercase();
    if e.code() == ErrorCode::Auth || m.contains("401") || m.contains("authentication") || m.contains("too many redirects or authentication") {
        return GhError::OngeldigToken;
    }
    if m.contains("403") || m.contains("permission") {
        return GhError::GeenRechten;
    }
    if m.contains("429") {
        return GhError::TeVeelVerzoeken;
    }
    if m.contains("timed out") || m.contains("timeout") {
        return GhError::TimeOut;
    }
    if m.contains("cancel") {
        return GhError::Geannuleerd;
    }
    if m.contains("not found") || m.contains("404") {
        return GhError::NietGevonden;
    }
    match e.class() {
        ErrorClass::Net | ErrorClass::Http | ErrorClass::Ssl | ErrorClass::Os => GhError::GeenInternet,
        _ => GhError::Onverwacht,
    }
}

fn callbacks<'a>(net: &'a Net<'a>, start: Instant, progress: Option<&'a dyn Fn(u32, u32)>, rejected: Option<&'a RefCell<bool>>) -> RemoteCallbacks<'a> {
    let mut cb = RemoteCallbacks::new();
    let tries = Cell::new(0u8);
    cb.credentials(move |_url, _user, _allowed| {
        // Eén poging: bij een afwijzing niet blijven proberen (dat kan een tijdelijke blokkade geven).
        tries.set(tries.get() + 1);
        match (net.creds, tries.get()) {
            (Some(c), 1) => Cred::userpass_plaintext(&c.user, &c.token),
            _ => Err(git2::Error::from_str("authentication required")),
        }
    });
    cb.transfer_progress(move |s| {
        if let Some(p) = progress {
            p(s.received_objects() as u32, s.total_objects() as u32);
        }
        !net.cancel.load(Ordering::SeqCst) && start.elapsed() < net.max
    });
    if let Some(p) = progress {
        cb.push_transfer_progress(move |cur, total, _| {
            p(cur as u32, total as u32);
        });
    }
    if let Some(r) = rejected {
        cb.push_update_reference(move |_name, status| {
            if status.is_some() {
                *r.borrow_mut() = true;
            }
            Ok(())
        });
    }
    cb
}

/// De tip van een tak op de remote (`None` = tak bestaat niet, bijvoorbeeld een lege nieuwe repository). Haalt de versies binnen
/// als `refs/studio/remote/<tak>` zodat we kunnen vergelijken; het raakt de eigen takken en instellingen van de gebruiker niet.
pub fn fetch_tip(repo: &Repository, url: &str, branch: &str, net: &Net) -> Result<Option<Oid>, GhError> {
    push_refspec(branch)?; // zelfde controle op de naam van de tak
    let start = Instant::now();
    let mut remote = repo.remote_anonymous(url).map_err(|e| map(&e))?;
    let volgref = format!("refs/studio/remote/{branch}");
    // Onze eigen volgref (niet die van de gebruiker) eerst leegmaken, zodat een oude waarde nooit voor "actueel" doorgaat.
    if let Ok(mut oud) = repo.find_reference(&volgref) {
        let _ = oud.delete();
    }
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(callbacks(net, start, None, None));
    let spec = format!("+refs/heads/{branch}:{volgref}");
    match remote.fetch(&[spec.as_str()], Some(&mut fo), None) {
        Ok(()) => {}
        Err(e) if e.code() == ErrorCode::NotFound || e.message().contains("couldn't find remote ref") => return Ok(None),
        Err(e) => return Err(map(&e)),
    }
    Ok(repo.refname_to_id(&volgref).ok())
}

/// Stuurt de tak vooruit naar de remote. Een afwijzing door de server wordt een fout; er wordt nooit geforceerd.
pub fn push(repo: &Repository, url: &str, branch: &str, net: &Net, progress: &mut dyn FnMut(u32, u32)) -> Result<(), GhError> {
    let spec = push_refspec(branch)?;
    let start = Instant::now();
    let mut remote = repo.remote_anonymous(url).map_err(|e| map(&e))?;
    let rejected = RefCell::new(false);
    let prog = RefCell::new(progress);
    let f = |a: u32, b: u32| (prog.borrow_mut())(a, b);
    let mut po = PushOptions::new();
    po.remote_callbacks(callbacks(net, start, Some(&f), Some(&rejected)));
    remote.push(&[spec.as_str()], Some(&mut po)).map_err(|e| map(&e))?;
    if *rejected.borrow() {
        return Err(GhError::Afgewezen);
    }
    Ok(())
}

/// Haalt een repository binnen in een nieuwe, lege map.
pub fn clone_into(url: &str, dest: &Path, net: &Net, progress: &mut dyn FnMut(u32, u32)) -> Result<(), GhError> {
    let start = Instant::now();
    let prog = RefCell::new(progress);
    let f = |a: u32, b: u32| (prog.borrow_mut())(a, b);
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(callbacks(net, start, Some(&f), None));
    git2::build::RepoBuilder::new().fetch_options(fo).clone(url, dest).map_err(|e| map(&e))?;
    Ok(())
}
