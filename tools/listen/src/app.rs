//! State and key handling of the TUI. Drawing is in ui.rs.
//!
//! Three versions of the decks matter: `content` (the edit in memory), `sealed` (what
//! `src/words/vault.json` in the working tree holds) and `base` (the committed vault the edit started
//! from, the merge base for the push).

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Result};
use crossterm::event::{Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use ratatui::layout::{Position, Rect};
use ratatui::widgets::TableState;
use zeroize::Zeroizing;

use crate::content::{Content, Entry, Kind, ListId};
use crate::import::{self, Parsed, Status};
use crate::input::{PasteArea, SecretInput, TextInput};
use crate::merge::{self, Changes, Choice, Merge};
use crate::push::{self, Log, LogKind, Preflight, PushError, Snapshot};
use crate::validate::{check_new, validate, Report};
use crate::vault::{self, Keyring, OpenError, Vault, VAULT};

/// Largest file `i` reads; the decks are a few kB.
const MAX_IMPORT_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Focus {
    Lists,
    Entries,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone {
    Info,
    Ok,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
    Delete(ListId, usize),
    Seal,
    Export,
    Quit,
    Reload,
}

#[derive(Clone, Debug)]
pub struct Confirm {
    pub title: String,
    pub lines: Vec<String>,
    pub action: Action,
}

#[derive(Clone, Debug)]
pub struct Form {
    pub list: ListId,
    /// None: a new entry.
    pub idx: Option<usize>,
    pub fields: Vec<TextInput>,
    pub focus: usize,
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Preview {
    pub source: String,
    /// Set when the text says what kind it is; then only those lists are targets.
    pub kind_fixed: Option<Kind>,
    pub target: ListId,
    pub parsed: Parsed,
    pub status: Vec<Status>,
    pub table: TableState,
    pub error: Option<String>,
}

impl Preview {
    pub fn counts(&self) -> (usize, usize, usize) {
        let new = self.status.iter().filter(|s| **s == Status::New).count();
        let dup = self.status.iter().filter(|s| matches!(s, Status::Dup(_))).count();
        (new, dup, self.status.len() - new - dup)
    }
}

#[derive(Clone, Debug)]
pub enum Import {
    Input { file_mode: bool, area: PasteArea, path: TextInput, error: Option<String> },
    Preview(Box<Preview>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// Safety checks, fetch, read the vault on origin/main.
    Checks,
    /// Decrypt it and merge.
    Open,
    /// Same with a newly typed password.
    Unlock,
    /// Fast-forward, seal the merged decks, stage.
    Prepare,
    CommitPush,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PushStage {
    AskStart(String),
    Run(Step),
    AskPassword,
    Merge,
    AskPush(String),
    Done(bool),
}

/// The vault on origin/main during a push.
#[derive(Clone, Debug)]
struct Theirs {
    snap: Snapshot,
    vault: Vault,
    content: Option<Content>,
}

#[derive(Clone, Debug)]
pub struct Push {
    pub log: Log,
    pub stage: PushStage,
    /// Lines scrolled up from the end.
    pub scroll: usize,
    /// A rejected push was already fetched and merged again once.
    retried: bool,
    pre: Option<Preflight>,
    theirs: Option<Theirs>,
    pub merge: Option<Merge>,
    /// Selected conflict on the merge screen.
    pub sel: usize,
    /// Message on the merge screen (e.g. conflicts left).
    pub merge_note: Option<String>,
    merged: Option<Content>,
    pub mine_changes: Changes,
    pub theirs_changes: Changes,
    new_key: bool,
    /// main was fast-forwarded in this push.
    forwarded: bool,
    pub password: SecretInput,
    pub pw_error: Option<String>,
}

impl Push {
    fn new(log: Log, stage: PushStage) -> Push {
        Push {
            log,
            stage,
            scroll: 0,
            retried: false,
            pre: None,
            theirs: None,
            merge: None,
            sel: 0,
            merge_note: None,
            merged: None,
            mine_changes: Changes::default(),
            theirs_changes: Changes::default(),
            new_key: false,
            forwarded: false,
            password: SecretInput::default(),
            pw_error: None,
        }
    }
}

/// The password prompt at start (no password file, or it does not open the vault).
#[derive(Clone, Debug, Default)]
pub struct Unlock {
    pub input: SecretInput,
    pub error: Option<String>,
    /// Why the prompt shows (e.g. what was wrong with the password file).
    pub note: Option<String>,
    pub checking: bool,
}

#[derive(Clone, Debug)]
pub enum Modal {
    None,
    Unlock(Unlock),
    Help,
    Confirm(Confirm),
    Form(Form),
    Import(Import),
    MoveTo { from: ListId, idx: usize, targets: Vec<ListId>, sel: usize },
    Push(Box<Push>),
}

/// Screen areas from the last draw, for the mouse.
#[derive(Clone, Debug, Default)]
pub struct Hits {
    pub lists: Rect,
    pub list_rows: Vec<(u16, ListId)>,
    pub entries: Rect,
    /// First row of table data (below the header).
    pub table_top: u16,
}

/// The committed vault the edit started from.
#[derive(Clone, Debug)]
pub struct Base {
    pub snap: Snapshot,
    /// None if it does not open with the password (then a push can't merge).
    pub content: Option<Content>,
}

pub struct App {
    pub root: PathBuf,
    pub content: Content,
    /// What the vault in the working tree holds; "geändert" means different from this.
    pub sealed: Content,
    /// The vault file as this program last read or wrote it: sealing refuses if it changed outside.
    sealed_text: String,
    /// None outside a git repo (or no vault committed yet).
    pub base: Option<Base>,
    keyring: Option<Keyring>,
    pub report: Report,
    pub current: ListId,
    pub focus: Focus,
    /// Selected row (in the filtered view) per list.
    pub row: [usize; 9],
    pub table: TableState,
    pub filter: TextInput,
    pub filtering: bool,
    undo: Vec<(String, Content)>,
    pub status: Option<(Tone, String)>,
    pub modal: Modal,
    pub quit: bool,
    pub hits: Hits,
}

fn read_vault(root: &Path) -> Result<(String, Vault), String> {
    let path = root.join(VAULT);
    let text = fs::read_to_string(&path).map_err(|e| format!("Kein Tresor: {} ist nicht lesbar ({e}).", path.display()))?;
    let v = Vault::parse(&text)?;
    Ok((text, v))
}

/// Writes next to the target, then renames: a crash never leaves half a file.
fn write_atomic(path: &Path, text: &str, private: bool) -> Result<(), String> {
    let dir = path.parent().ok_or("kein Ordner")?;
    let name = path.file_name().and_then(|n| n.to_str()).ok_or("kein Dateiname")?;
    let tmp = dir.join(format!(".{name}.tmp"));
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    if private {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    #[cfg(not(unix))]
    let _ = private;
    let res = (|| {
        use std::io::Write;
        let mut f = opts.open(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        fs::rename(&tmp, path)
    })();
    if let Err(e) = res {
        let _ = fs::remove_file(&tmp);
        return Err(format!("Schreiben fehlgeschlagen: {}: {e}", path.display()));
    }
    Ok(())
}

impl App {
    /// Reads the vault (working tree and HEAD) and opens it with the password file if there is one;
    /// otherwise the TUI asks for the password first. A missing or broken vault is an error here, before
    /// the terminal is touched.
    pub fn open(root: &Path, pass_file: Option<&Path>) -> Result<App> {
        let (text, _) = match read_vault(root) {
            Ok(x) => x,
            Err(e) => bail!("{e}\nProjektordner richtig? Sonst --root angeben."),
        };
        let mut app = App {
            root: root.to_path_buf(),
            content: Content::empty(),
            sealed: Content::empty(),
            sealed_text: text,
            base: None,
            keyring: None,
            report: Report::default(),
            current: ListId::WordsNormal,
            focus: Focus::Entries,
            row: [0; 9],
            table: TableState::default(),
            filter: TextInput::default(),
            filtering: false,
            undo: Vec::new(),
            status: None,
            modal: Modal::None,
            quit: false,
            hits: Hits::default(),
        };
        let mut unlock = Unlock::default();
        match pass_file.map(vault::read_pass_file) {
            Some(Ok(Some(pf))) => match app.try_unlock(pf.password) {
                Ok(()) => {
                    if pf.loose {
                        app.say(Tone::Info, "Hinweis: die Passwortdatei ist für andere lesbar. Besser: chmod 600.");
                    }
                    return Ok(app);
                }
                Err(e) if e == "Passwort falsch." => {
                    unlock.note = Some("Das Passwort aus der Passwortdatei öffnet den Tresor nicht (wurde es geändert?).".into())
                }
                Err(e) => unlock.note = Some(e),
            },
            Some(Ok(None)) | None => {}
            Some(Err(e)) => unlock.note = Some(e),
        }
        app.modal = Modal::Unlock(unlock);
        Ok(app)
    }

    pub fn locked(&self) -> bool {
        self.keyring.is_none()
    }

    /// Opens the working-tree vault and the committed one with this password; keeps it on success.
    fn try_unlock(&mut self, password: Zeroizing<String>) -> Result<(), String> {
        let mut ring = Keyring::new(password);
        self.load(&mut ring)?;
        self.keyring = Some(ring);
        Ok(())
    }

    /// (Re)loads all three versions from disk and git. Nothing changes on error.
    fn load(&mut self, ring: &mut Keyring) -> Result<(), String> {
        let (text, v) = read_vault(&self.root)?;
        let c = match ring.open(&v) {
            Ok(c) => c,
            Err(OpenError::WrongKey) => return Err("Passwort falsch.".into()),
            Err(e) => return Err(e.to_string()),
        };
        let base = push::snapshot(&self.root, "HEAD").map(|snap| {
            let content =
                if snap.text == text { Some(c.clone()) } else { Vault::parse(&snap.text).ok().and_then(|bv| ring.open(&bv).ok()) };
            Base { snap, content }
        });
        self.content = c.clone();
        self.sealed = c;
        self.sealed_text = text;
        self.base = base;
        self.undo.clear();
        self.revalidate();
        self.clamp_row();
        let n = self.report.total();
        self.status = Some(if n > 0 {
            (Tone::Error, format!("{n} Probleme gefunden (rot/gelb markiert) – so wird nicht versiegelt."))
        } else {
            (Tone::Info, "Tresor entsperrt. ? zeigt alle Tasten.".into())
        });
        Ok(())
    }

    fn revalidate(&mut self) {
        self.report = validate(&self.content);
    }

    /// Different from the sealed vault in the working tree.
    pub fn is_dirty(&self, id: ListId) -> bool {
        self.content.entries(id) != self.sealed.entries(id)
    }

    pub fn dirty_lists(&self) -> Vec<ListId> {
        ListId::ALL.into_iter().filter(|&id| self.is_dirty(id)).collect()
    }

    /// The sealed vault in the working tree differs from the base (sealed, not pushed yet).
    pub fn unpushed(&self) -> bool {
        self.base.as_ref().and_then(|b| b.content.as_ref()).is_some_and(|b| *b != self.sealed)
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    /// Entry indices of the current list that pass the filter.
    pub fn visible(&self) -> Vec<usize> {
        let f = self.filter.value.trim().to_lowercase();
        self.content
            .entries(self.current)
            .iter()
            .enumerate()
            .filter(|(_, e)| f.is_empty() || e.text.to_lowercase().contains(&f) || e.taboo.iter().any(|t| t.to_lowercase().contains(&f)))
            .map(|(i, _)| i)
            .collect()
    }

    pub fn selected(&self) -> Option<usize> {
        self.visible().get(self.row[self.current.index()]).copied()
    }

    fn clamp_row(&mut self) {
        let n = self.visible().len();
        let r = &mut self.row[self.current.index()];
        if *r >= n {
            *r = n.saturating_sub(1);
        }
    }

    fn select_entry(&mut self, idx: usize) {
        if let Some(r) = self.visible().iter().position(|&i| i == idx) {
            self.row[self.current.index()] = r;
        }
    }

    fn select_list(&mut self, id: ListId) {
        if id != self.current {
            self.current = id;
            self.table = TableState::default();
            self.clamp_row();
        }
    }

    fn move_row(&mut self, delta: isize) {
        let n = self.visible().len();
        if n == 0 {
            return;
        }
        let r = &mut self.row[self.current.index()];
        *r = (*r as isize + delta).clamp(0, n as isize - 1) as usize;
    }

    fn say(&mut self, tone: Tone, msg: impl Into<String>) {
        self.status = Some((tone, msg.into()));
    }

    /// Every change goes through here: snapshot for undo, then revalidate.
    fn change(&mut self, label: impl Into<String>, f: impl FnOnce(&mut Content)) {
        self.undo.push((label.into(), self.content.clone()));
        f(&mut self.content);
        self.revalidate();
        self.clamp_row();
    }

    pub fn undo(&mut self) {
        match self.undo.pop() {
            Some((label, c)) => {
                self.content = c;
                self.revalidate();
                self.clamp_row();
                self.say(Tone::Info, format!("Rückgängig: {label}"));
            }
            None => self.say(Tone::Info, "Nichts rückgängig zu machen (Versiegeltes bleibt)."),
        }
    }

    /// The vault file changed since this program last read or wrote it, and the change exists only
    /// there (a file equal to HEAD, e.g. after `git pull`, loses nothing when overwritten)?
    fn vault_changed_outside(&self) -> Option<String> {
        let now = fs::read_to_string(self.root.join(VAULT)).unwrap_or_default();
        if now == self.sealed_text || push::snapshot(&self.root, "HEAD").is_some_and(|h| h.text == now) {
            return None;
        }
        Some(format!("{VAULT} wurde außerhalb geändert, seit es geladen wurde. r lädt neu (verwirft die Änderungen hier)."))
    }

    /// Seals the edit into the working-tree vault (no git). Returns whether the salt is new.
    pub fn seal(&mut self) -> Result<bool, String> {
        if let Some(e) = self.vault_changed_outside() {
            return Err(format!("Nichts versiegelt: {e}"));
        }
        let current = Vault::parse(&self.sealed_text).ok();
        let ring = self.keyring.as_mut().ok_or("Tresor ist gesperrt.")?;
        let (text, new_salt) = vault::seal_checked(ring, &self.content, current.as_ref())?;
        write_atomic(&self.root.join(VAULT), &text, false)?;
        self.sealed = self.content.clone();
        self.sealed_text = text;
        self.undo.clear();
        Ok(new_salt)
    }

    fn reload(&mut self) {
        let Some(mut ring) = self.keyring.take() else { return };
        let res = self.load(&mut ring);
        match res {
            Ok(()) => {
                self.keyring = Some(ring);
                self.say(Tone::Ok, format!("Neu geladen aus {VAULT}."));
            }
            Err(e) if e == "Passwort falsch." => {
                // Someone changed the password (e.g. after a git pull): ask for the new one.
                self.content = Content::empty();
                self.sealed = Content::empty();
                self.revalidate();
                self.modal = Modal::Unlock(Unlock {
                    note: Some("Der Tresor geht mit dem bisherigen Passwort nicht mehr auf (wurde es geändert?).".into()),
                    ..Unlock::default()
                });
            }
            Err(e) => {
                self.keyring = Some(ring);
                self.say(Tone::Error, e);
            }
        }
    }

    // ---- events ----

    pub fn handle_event(&mut self, ev: Event) {
        match ev {
            Event::Key(k) if k.kind == KeyEventKind::Press => self.handle_key(k),
            Event::Mouse(m) => self.handle_mouse(m),
            Event::Paste(s) => self.handle_paste(&s),
            _ => {}
        }
    }

    pub fn handle_paste(&mut self, s: &str) {
        match &mut self.modal {
            Modal::Unlock(u) => u.input.insert_str(s.trim_end_matches(['\n', '\r'])),
            Modal::Push(p) if p.stage == PushStage::AskPassword => p.password.insert_str(s.trim_end_matches(['\n', '\r'])),
            Modal::Form(f) => {
                let i = f.focus;
                f.fields[i].insert_str(s.trim_end_matches(['\n', '\r']));
                self.form_live_check();
            }
            Modal::Import(Import::Input { file_mode, area, path, .. }) => {
                if *file_mode {
                    path.insert_str(s.trim());
                } else {
                    area.insert_str(s);
                }
            }
            Modal::None if self.filtering => self.filter.insert_str(s.trim()),
            Modal::None => {
                let mut area = PasteArea::default();
                area.insert_str(s);
                self.modal = Modal::Import(Import::Input { file_mode: false, area, path: TextInput::default(), error: None });
                self.say(Tone::Info, "Eingefügt: Strg+S zeigt die Vorschau.");
            }
            _ => {}
        }
    }

    pub fn handle_key(&mut self, k: KeyEvent) {
        let ctrl = k.modifiers.contains(KeyModifiers::CONTROL);
        if ctrl && k.code == KeyCode::Char('c') && !matches!(self.modal, Modal::Push(_)) {
            if self.locked() {
                self.quit = true;
                return;
            }
            self.modal = Modal::None;
            self.request_quit();
            return;
        }
        match std::mem::replace(&mut self.modal, Modal::None) {
            Modal::None => self.key_main(k),
            Modal::Unlock(u) => self.key_unlock(k, u),
            Modal::Help => {}
            Modal::Confirm(c) => self.key_confirm(k, c),
            Modal::Form(f) => self.key_form(k, f),
            Modal::Import(i) => self.key_import(k, i),
            Modal::MoveTo { from, idx, targets, sel } => self.key_move(k, from, idx, targets, sel),
            Modal::Push(p) => self.key_push(k, *p),
        }
    }

    fn key_unlock(&mut self, k: KeyEvent, mut u: Unlock) {
        if u.checking {
            self.modal = Modal::Unlock(u);
            return;
        }
        match k.code {
            KeyCode::Esc => {
                self.quit = true;
                return;
            }
            KeyCode::Enter if !u.input.is_empty() => {
                u.checking = true;
                u.error = None;
            }
            _ => {
                if u.input.handle(&k) {
                    u.error = None;
                }
            }
        }
        self.modal = Modal::Unlock(u);
    }

    fn key_main(&mut self, k: KeyEvent) {
        if self.filtering {
            match k.code {
                KeyCode::Enter | KeyCode::Down => self.filtering = false,
                KeyCode::Esc => {
                    self.filtering = false;
                    self.filter.clear();
                }
                _ => {
                    self.filter.handle(&k);
                }
            }
            self.row[self.current.index()] = 0;
            self.clamp_row();
            return;
        }
        let ctrl = k.modifiers.contains(KeyModifiers::CONTROL);
        match k.code {
            KeyCode::Char('q') => self.request_quit(),
            KeyCode::Char('?') | KeyCode::F(1) => self.modal = Modal::Help,
            KeyCode::Tab | KeyCode::BackTab => {
                self.focus = if self.focus == Focus::Lists { Focus::Entries } else { Focus::Lists };
            }
            KeyCode::Left => self.focus = Focus::Lists,
            KeyCode::Right => self.focus = Focus::Entries,
            KeyCode::Up | KeyCode::Down => {
                let d = if k.code == KeyCode::Up { -1 } else { 1 };
                if self.focus == Focus::Lists {
                    let i = (self.current.index() as isize + d).clamp(0, 8) as usize;
                    self.select_list(ListId::ALL[i]);
                } else {
                    self.move_row(d);
                }
            }
            KeyCode::PageUp => self.move_row(-15),
            KeyCode::PageDown => self.move_row(15),
            KeyCode::Home => self.move_row(isize::MIN / 2),
            KeyCode::End => self.move_row(isize::MAX / 2),
            KeyCode::Char(c @ '1'..='9') => self.select_list(ListId::ALL[c as usize - '1' as usize]),
            KeyCode::Enter if self.focus == Focus::Lists => self.focus = Focus::Entries,
            KeyCode::Enter | KeyCode::Char('e') => self.open_edit(),
            KeyCode::Char('a') => self.open_add(),
            KeyCode::Char('d') | KeyCode::Delete => self.ask_delete(),
            KeyCode::Char('u') => self.undo(),
            KeyCode::Char('z') if ctrl => self.undo(),
            KeyCode::Char('m') => self.start_move(),
            KeyCode::Char('i') => {
                self.modal =
                    Modal::Import(Import::Input { file_mode: false, area: PasteArea::default(), path: TextInput::default(), error: None })
            }
            KeyCode::Char('s') => self.ask_seal(),
            KeyCode::Char('x') => self.ask_export(),
            KeyCode::Char('p') => self.start_push(),
            KeyCode::Char('r') => {
                if self.dirty_lists().is_empty() {
                    self.reload();
                } else {
                    self.modal = Modal::Confirm(Confirm {
                        title: "Neu laden".into(),
                        lines: vec!["Nicht versiegelte Änderungen gehen verloren.".into(), "Trotzdem neu laden?".into()],
                        action: Action::Reload,
                    });
                }
            }
            KeyCode::Char('/') => {
                self.filtering = true;
                self.focus = Focus::Entries;
            }
            KeyCode::Esc if !self.filter.value.is_empty() => {
                self.filter.clear();
                self.clamp_row();
            }
            _ => {}
        }
    }

    pub fn handle_mouse(&mut self, m: MouseEvent) {
        let pos = Position::new(m.column, m.row);
        if let Modal::Push(p) = &mut self.modal {
            let up = m.kind == MouseEventKind::ScrollUp;
            if matches!(m.kind, MouseEventKind::ScrollUp | MouseEventKind::ScrollDown) {
                if p.stage == PushStage::Merge {
                    let n = p.merge.as_ref().map_or(0, |x| x.conflicts.len());
                    p.sel = if up { p.sel.saturating_sub(1) } else { (p.sel + 1).min(n.saturating_sub(1)) };
                } else if up {
                    p.scroll += 3;
                } else {
                    p.scroll = p.scroll.saturating_sub(3);
                }
            }
            return;
        }
        if !matches!(self.modal, Modal::None) {
            return;
        }
        let in_lists = self.hits.lists.contains(pos);
        let in_entries = self.hits.entries.contains(pos);
        match m.kind {
            MouseEventKind::Down(MouseButton::Left) if in_lists => {
                if let Some(&(_, id)) = self.hits.list_rows.iter().find(|(y, _)| *y == m.row) {
                    self.select_list(id);
                }
                self.focus = Focus::Lists;
            }
            MouseEventKind::Down(MouseButton::Left) if in_entries => {
                self.focus = Focus::Entries;
                if m.row >= self.hits.table_top {
                    let r = self.table.offset() + (m.row - self.hits.table_top) as usize;
                    if r < self.visible().len() {
                        self.row[self.current.index()] = r;
                    }
                }
            }
            MouseEventKind::ScrollUp | MouseEventKind::ScrollDown => {
                let d = if m.kind == MouseEventKind::ScrollUp { -1 } else { 1 };
                if in_lists {
                    let i = (self.current.index() as isize + d).clamp(0, 8) as usize;
                    self.select_list(ListId::ALL[i]);
                } else if in_entries {
                    self.move_row(3 * d);
                }
            }
            _ => {}
        }
    }

    fn request_quit(&mut self) {
        let dirty = self.dirty_lists();
        if dirty.is_empty() {
            self.quit = true;
            return;
        }
        self.modal = Modal::Confirm(Confirm {
            title: "Beenden".into(),
            lines: vec![
                format!("Nicht versiegelte Änderungen in {} Liste(n):", dirty.len()),
                dirty.iter().map(|d| d.title()).collect::<Vec<_>>().join(", "),
                String::new(),
                "s versiegelt sie. Trotzdem beenden und verwerfen?".into(),
            ],
            action: Action::Quit,
        });
    }

    fn key_confirm(&mut self, k: KeyEvent, c: Confirm) {
        match k.code {
            KeyCode::Char('j' | 'J' | 'y' | 'Y') => self.confirmed(c.action),
            KeyCode::Char('n' | 'N') | KeyCode::Esc => self.say(Tone::Info, "Abgebrochen."),
            _ => self.modal = Modal::Confirm(c),
        }
    }

    fn confirmed(&mut self, a: Action) {
        match a {
            Action::Quit => self.quit = true,
            Action::Reload => self.reload(),
            Action::Delete(list, idx) => {
                let text = self.content.entries(list)[idx].text.clone();
                self.change(format!("„{text}“ gelöscht"), |c| {
                    c.entries_mut(list).remove(idx);
                });
                self.say(Tone::Ok, format!("„{text}“ gelöscht (u = rückgängig)."));
            }
            Action::Seal => match self.seal() {
                Ok(new_salt) => {
                    let key = if new_salt { " NEUER SCHLÜSSEL: alle schalten nach dem Push einmal neu frei." } else { "" };
                    self.say(Tone::Ok, format!("Versiegelt: {VAULT} (nicht committet). p pusht.{key}"));
                }
                Err(e) => self.say(Tone::Error, e),
            },
            Action::Export => match self.export() {
                Ok(n) => {
                    self.say(Tone::Ok, format!("{n} Klartext-Dateien nach private/content/ geschrieben (gitignored, nur als Backup)."))
                }
                Err(e) => self.say(Tone::Error, e),
            },
        }
    }

    // ---- add / edit / delete / move ----

    fn open_add(&mut self) {
        let list = self.current;
        let n = if list.kind() == Kind::Words { 2 } else { 1 };
        self.modal = Modal::Form(Form { list, idx: None, fields: vec![TextInput::default(); n], focus: 0, error: None });
    }

    fn open_edit(&mut self) {
        let Some(idx) = self.selected() else {
            self.say(Tone::Info, "Kein Eintrag ausgewählt. a legt einen neuen an.");
            return;
        };
        let list = self.current;
        let e = &self.content.entries(list)[idx];
        let fields = if list.kind() == Kind::Words {
            vec![TextInput::new(&e.text), TextInput::new(e.taboo_joined())]
        } else {
            vec![TextInput::new(&e.text)]
        };
        self.modal = Modal::Form(Form { list, idx: Some(idx), fields, focus: 0, error: None });
        self.form_live_check();
    }

    /// The entry a form describes, cleaned like the files and the browser do.
    pub fn form_entry(f: &Form) -> Entry {
        let text = import::squeeze(&f.fields[0].value);
        match f.list.kind() {
            Kind::Words => Entry::card(text, import::taboo_field(&f.fields[1].value)),
            Kind::Zeig => Entry::text(import::strip_zeig_frame(&text)),
            _ => Entry::text(text),
        }
    }

    fn form_live_check(&mut self) {
        if let Modal::Form(f) = &mut self.modal {
            let e = Self::form_entry(f);
            let untouched = f.idx.is_none() && f.fields.iter().all(|x| x.value.trim().is_empty());
            f.error = if untouched { None } else { check_new(&self.content, f.list, f.idx, &e) };
        }
    }

    fn key_form(&mut self, k: KeyEvent, mut f: Form) {
        match k.code {
            KeyCode::Esc => {
                self.say(Tone::Info, "Abgebrochen.");
                return;
            }
            KeyCode::Tab | KeyCode::Down | KeyCode::BackTab | KeyCode::Up => {
                f.focus = (f.focus + 1) % f.fields.len();
            }
            KeyCode::Enter => {
                let e = Self::form_entry(&f);
                if let Some(err) = check_new(&self.content, f.list, f.idx, &e) {
                    f.error = Some(err);
                    self.modal = Modal::Form(f);
                    return;
                }
                let list = f.list;
                match f.idx {
                    None => {
                        let label = format!("„{}“ hinzugefügt", e.text);
                        self.change(label.clone(), |c| c.entries_mut(list).push(e));
                        let idx = self.content.count(list) - 1;
                        self.select_entry(idx);
                        let hidden = !self.visible().contains(&idx);
                        self.say(Tone::Ok, if hidden { format!("{label} (vom Filter ausgeblendet).") } else { format!("{label}.") });
                    }
                    Some(idx) => {
                        if self.content.entries(list)[idx] == e {
                            self.say(Tone::Info, "Nichts geändert.");
                            return;
                        }
                        let label = format!("„{}“ bearbeitet", e.text);
                        self.change(label.clone(), |c| c.entries_mut(list)[idx] = e);
                        self.say(Tone::Ok, format!("{label}."));
                    }
                }
                return;
            }
            _ => {
                let i = f.focus;
                f.fields[i].handle(&k);
            }
        }
        self.modal = Modal::Form(f);
        self.form_live_check();
    }

    fn ask_delete(&mut self) {
        let Some(idx) = self.selected() else { return };
        let e = &self.content.entries(self.current)[idx];
        self.modal = Modal::Confirm(Confirm {
            title: "Löschen".into(),
            lines: vec![format!("„{}“ aus {} löschen?", e.text, self.current.title())],
            action: Action::Delete(self.current, idx),
        });
    }

    fn start_move(&mut self) {
        let Some(idx) = self.selected() else { return };
        let targets = self.current.siblings();
        if targets.len() == 1 {
            self.do_move(self.current, idx, targets[0]);
        } else {
            self.modal = Modal::MoveTo { from: self.current, idx, targets, sel: 0 };
        }
    }

    fn key_move(&mut self, k: KeyEvent, from: ListId, idx: usize, targets: Vec<ListId>, mut sel: usize) {
        match k.code {
            KeyCode::Esc | KeyCode::Char('n') => return,
            KeyCode::Up => sel = sel.saturating_sub(1),
            KeyCode::Down => sel = (sel + 1).min(targets.len() - 1),
            KeyCode::Char(c @ '1'..='9') if (c as usize - '1' as usize) < targets.len() => {
                return self.do_move(from, idx, targets[c as usize - '1' as usize]);
            }
            KeyCode::Enter => return self.do_move(from, idx, targets[sel]),
            _ => {}
        }
        self.modal = Modal::MoveTo { from, idx, targets, sel };
    }

    /// Moves an entry to the end of another list of its kind, unless it would be a duplicate there.
    pub fn do_move(&mut self, from: ListId, idx: usize, to: ListId) {
        let mut trial = self.content.clone();
        let at = trial.move_entry(from, idx, to);
        if let Some(issue) = validate(&trial).issue(to, at).filter(|i| i.dup) {
            self.say(Tone::Error, format!("Nicht verschoben: in {} {}", to.title(), issue.msg));
            return;
        }
        let text = self.content.entries(from)[idx].text.clone();
        self.change(format!("„{text}“ nach {} verschoben", to.title()), |c| {
            c.move_entry(from, idx, to);
        });
        self.say(Tone::Ok, format!("„{text}“ → {} (u = rückgängig).", to.title()));
    }

    // ---- seal / export ----

    fn problems_block(&mut self, what: &str) -> bool {
        let n = self.report.total();
        if n > 0 {
            let first = self.report.lines().into_iter().next().unwrap_or_default();
            self.say(Tone::Error, format!("Erst die {n} Probleme beheben (rot/gelb markiert), sonst wird nicht {what}. Z. B. {first}"));
        }
        n > 0
    }

    fn ask_seal(&mut self) {
        let dirty = self.dirty_lists();
        if dirty.is_empty() {
            self.say(Tone::Info, format!("Nichts zu versiegeln: {VAULT} enthält schon genau diesen Stand."));
            return;
        }
        if self.problems_block("versiegelt") {
            return;
        }
        let mut lines: Vec<String> = dirty
            .iter()
            .map(|&id| format!("  {:<24} {} → {} Einträge", id.title(), self.sealed.count(id), self.content.count(id)))
            .collect();
        lines.insert(0, format!("Versiegeln nach {VAULT} (nur im Arbeitsordner, kein Commit):"));
        if let Some(b) = self.base.as_ref().and_then(|b| b.content.as_ref()) {
            lines.push(String::new());
            lines.push(format!("Gegenüber dem letzten Push: {}", merge::changes(b, &self.content).short()));
        }
        lines.push(String::new());
        lines.push("Versiegeln?".into());
        self.modal = Modal::Confirm(Confirm { title: "Versiegeln".into(), lines, action: Action::Seal });
    }

    /// Only if git ignores private/content: plaintext must never be one `git add .` away from the repo.
    fn export_dir_ok(&self) -> Result<PathBuf, String> {
        let mut log = Log::default();
        let ignored = push::run(&self.root, &["git".into(), "check-ignore".into(), "-q".into(), "private/content".into()], &mut log, false)
            .map(|o| o.ok)
            .unwrap_or(false);
        if !ignored {
            return Err("Kein Export: private/content ist hier nicht per .gitignore ausgeschlossen (oder kein Git-Repo).".into());
        }
        Ok(self.root.join("private").join("content"))
    }

    fn ask_export(&mut self) {
        let dir = match self.export_dir_ok() {
            Ok(d) => d,
            Err(e) => return self.say(Tone::Error, e),
        };
        let existing = ListId::ALL.iter().filter(|id| dir.join(id.file_name()).exists()).count();
        let mut lines = vec![
            "Klartext-Kopie der Stapel (Stand im Speicher) nach private/content/ schreiben?".into(),
            "Nur als Backup: gitignored, das Programm selbst braucht sie nicht.".into(),
        ];
        if existing > 0 {
            lines.push(format!("{existing} vorhandene Datei(en) dort werden überschrieben."));
        }
        let n = self.report.total();
        if n > 0 {
            lines.push(format!("Achtung: {n} Probleme – npm run seal bricht damit ab."));
        }
        lines.push(String::new());
        lines.push("Exportieren?".into());
        self.modal = Modal::Confirm(Confirm { title: "Klartext exportieren".into(), lines, action: Action::Export });
    }

    /// Writes the nine plaintext files (owner-only permissions).
    pub fn export(&mut self) -> Result<usize, String> {
        let dir = self.export_dir_ok()?;
        fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        for id in ListId::ALL {
            write_atomic(&dir.join(id.file_name()), &self.content.export_file(id), true)?;
        }
        Ok(ListId::ALL.len())
    }

    // ---- import ----

    fn key_import(&mut self, k: KeyEvent, i: Import) {
        match i {
            Import::Input { mut file_mode, mut area, mut path, mut error } => {
                let ctrl = k.modifiers.contains(KeyModifiers::CONTROL);
                match k.code {
                    KeyCode::Esc => {
                        self.say(Tone::Info, "Import abgebrochen.");
                        return;
                    }
                    KeyCode::Tab | KeyCode::BackTab => file_mode = !file_mode,
                    KeyCode::Char('s') if ctrl => return self.import_preview(file_mode, area, path),
                    KeyCode::Enter if file_mode => return self.import_preview(file_mode, area, path),
                    _ => {
                        if file_mode {
                            path.handle(&k);
                        } else {
                            area.handle(&k);
                        }
                        error = None;
                    }
                }
                self.modal = Modal::Import(Import::Input { file_mode, area, path, error });
            }
            Import::Preview(mut p) => {
                match k.code {
                    KeyCode::Esc | KeyCode::Char('n') => {
                        // Back to the input, text kept.
                        let mut area = PasteArea::default();
                        area.insert_str(&p.source);
                        self.modal = Modal::Import(Import::Input { file_mode: false, area, path: TextInput::default(), error: None });
                        return;
                    }
                    KeyCode::Left | KeyCode::Right | KeyCode::Tab | KeyCode::BackTab => {
                        let targets: Vec<ListId> = match p.kind_fixed {
                            Some(kind) => kind.lists().to_vec(),
                            None => ListId::ALL.to_vec(),
                        };
                        let at = targets.iter().position(|&t| t == p.target).unwrap_or(0) as isize;
                        let d = if matches!(k.code, KeyCode::Left | KeyCode::BackTab) { -1 } else { 1 };
                        let next = targets[(at + d).rem_euclid(targets.len() as isize) as usize];
                        self.set_preview_target(&mut p, next);
                    }
                    KeyCode::Up => scroll_table(&mut p.table, -1, p.status.len()),
                    KeyCode::Down => scroll_table(&mut p.table, 1, p.status.len()),
                    KeyCode::PageUp => scroll_table(&mut p.table, -15, p.status.len()),
                    KeyCode::PageDown => scroll_table(&mut p.table, 15, p.status.len()),
                    KeyCode::Enter | KeyCode::Char('j') => {
                        let (new, _, _) = p.counts();
                        if new == 0 {
                            p.error = Some("Nichts Neues zum Übernehmen.".into());
                        } else {
                            let target = p.target;
                            let items = p.parsed.items.clone();
                            let mut added = 0;
                            self.change(format!("{new} Einträge nach {} importiert", target.title()), |c| {
                                added = import::apply(c, target, &items);
                            });
                            self.select_list(target);
                            self.say(Tone::Ok, format!("{added} neue Einträge in {} (u = rückgängig, s = versiegeln).", target.title()));
                            return;
                        }
                    }
                    _ => {}
                }
                self.modal = Modal::Import(Import::Preview(p));
            }
        }
    }

    fn set_preview_target(&self, p: &mut Preview, target: ListId) {
        match import::parse(target.kind(), &p.source) {
            Ok(parsed) => {
                p.status = import::preview(&self.content, target, &parsed.items);
                p.parsed = parsed;
                p.target = target;
                p.error = None;
                p.table = TableState::default().with_selected(Some(0));
            }
            Err(e) => p.error = Some(e),
        }
    }

    fn import_preview(&mut self, file_mode: bool, area: PasteArea, path: TextInput) {
        let source = if file_mode {
            match read_import_file(&path.value) {
                Ok(s) => s,
                Err(e) => {
                    self.modal = Modal::Import(Import::Input { file_mode, area, path, error: Some(e) });
                    return;
                }
            }
        } else {
            area.text.clone()
        };
        let kind_fixed = import::detect_kind(&source);
        let target = match kind_fixed {
            Some(k) if k != self.current.kind() => k.lists()[0],
            _ => self.current,
        };
        let err = |e: String, file_mode, area, path| Modal::Import(Import::Input { file_mode, area, path, error: Some(e) });
        match import::parse(target.kind(), &source) {
            Ok(parsed) if parsed.items.is_empty() => self.modal = err("Keine Einträge gefunden.".into(), file_mode, area, path),
            Ok(parsed) => {
                let status = import::preview(&self.content, target, &parsed.items);
                self.status = None;
                self.modal = Modal::Import(Import::Preview(Box::new(Preview {
                    source,
                    kind_fixed,
                    target,
                    parsed,
                    status,
                    table: TableState::default().with_selected(Some(0)),
                    error: None,
                })));
            }
            Err(e) => self.modal = err(e, file_mode, area, path),
        }
    }

    // ---- push ----

    fn start_push(&mut self) {
        if self.problems_block("gepusht") {
            return;
        }
        let mut log = Log::default();
        log.add(LogKind::Step, format!("Pushen: nur {VAULT} geht ins Repo, Klartext nie."));
        let base = self.base.as_ref().and_then(|b| b.content.as_ref());
        if base == Some(&self.content) {
            log.add(LogKind::Ok, "Keine Änderungen gegenüber dem letzten Stand aus git: nichts zu pushen.");
            self.say(Tone::Info, "Nichts zu pushen.");
            self.modal = Modal::Push(Box::new(Push::new(log, PushStage::Done(true))));
            return;
        }
        let mine = match base {
            Some(b) => format!("Deine Änderungen: {}", merge::changes(b, &self.content).short()),
            None => "Deine Änderungen: unbekannt (kein Ausgangsstand aus git)".into(),
        };
        let unsealed = self.dirty_lists().len();
        let unsealed = if unsealed > 0 { format!(", davon {unsealed} Liste(n) noch nicht versiegelt") } else { String::new() };
        let q = format!("{mine}{unsealed}. Mit origin/main abgleichen, versiegeln und pushen? (j/n)");
        self.modal = Modal::Push(Box::new(Push::new(log, PushStage::AskStart(q))));
    }

    /// Something to do without waiting for a key (a push step, a password check). The caller draws
    /// first, so the screen shows "läuft …" while the step blocks.
    pub fn has_work(&self) -> bool {
        match &self.modal {
            Modal::Push(p) => matches!(p.stage, PushStage::Run(_)),
            Modal::Unlock(u) => u.checking,
            _ => false,
        }
    }

    pub fn tick(&mut self) {
        match std::mem::replace(&mut self.modal, Modal::None) {
            Modal::Unlock(mut u) if u.checking => {
                u.checking = false;
                match self.try_unlock(u.input.take()) {
                    Ok(()) => {}
                    Err(e) => {
                        u.error = Some(e);
                        self.modal = Modal::Unlock(u);
                    }
                }
            }
            Modal::Push(mut p) => {
                if let PushStage::Run(step) = p.stage {
                    p.scroll = 0;
                    p.stage = self.push_step(&mut p, step);
                    if let PushStage::Done(ok) = p.stage {
                        self.say(
                            if ok { Tone::Ok } else { Tone::Error },
                            if ok { "Push abgeschlossen (Details: siehe Protokoll)." } else { "Nicht gepusht (Grund im Protokoll)." },
                        );
                    }
                }
                self.modal = Modal::Push(p);
            }
            other => self.modal = other,
        }
    }

    fn push_step(&mut self, p: &mut Push, step: Step) -> PushStage {
        let root = self.root.clone();
        match step {
            Step::Checks => {
                let pre = match push::preflight(&root, &mut p.log) {
                    Ok(pre) => pre,
                    Err(e) => return fail(&mut p.log, e),
                };
                if let Some(e) = self.vault_changed_outside() {
                    return fail(&mut p.log, e);
                }
                let Some(snap) = push::snapshot(&root, &pre.upstream) else {
                    return fail(&mut p.log, format!("{} enthält keinen {VAULT}.", pre.upstream));
                };
                let vault = match push::vault_shape_ok(&snap.text).and_then(|_| Vault::parse(&snap.text)) {
                    Ok(v) => v,
                    Err(e) => return fail(&mut p.log, format!("Tresor auf {}: {e}", pre.upstream)),
                };
                p.log.add(LogKind::Ok, format!("✓ Tresor auf {} gelesen ({})", pre.upstream, push::short(&snap.commit)));
                p.theirs = Some(Theirs { snap, vault, content: None });
                p.pre = Some(pre);
                PushStage::Run(Step::Open)
            }
            Step::Open | Step::Unlock => {
                let theirs = p.theirs.as_mut().expect("read in Checks");
                let same_as_base = self.base.as_ref().is_some_and(|b| b.snap.text == theirs.snap.text);
                let opened = match (&self.base, same_as_base) {
                    (Some(Base { content: Some(c), .. }), true) if step == Step::Open => Ok(c.clone()),
                    _ if step == Step::Unlock => {
                        let mut ring = Keyring::new(p.password.take());
                        let r = ring.open(&theirs.vault);
                        if r.is_ok() {
                            // The new password from now on (sealing keeps the salt of origin's vault).
                            self.keyring = Some(ring);
                        }
                        r
                    }
                    _ => self.keyring.as_mut().expect("unlocked").open(&theirs.vault),
                };
                match opened {
                    Ok(c) => theirs.content = Some(c),
                    Err(OpenError::WrongKey) if step == Step::Unlock => {
                        p.pw_error = Some("Passwort falsch.".into());
                        return PushStage::AskPassword;
                    }
                    Err(OpenError::WrongKey) => {
                        p.log.add(
                            LogKind::Warn,
                            "Der Tresor auf origin/main geht mit deinem Passwort nicht auf: das Passwort wurde wohl geändert.",
                        );
                        p.pw_error = None;
                        return PushStage::AskPassword;
                    }
                    Err(e) => return fail(&mut p.log, format!("Tresor auf origin/main: {e}")),
                }
                p.log.add(LogKind::Ok, "✓ Tresor auf origin/main entschlüsselt");
                self.merge_with_theirs(p)
            }
            Step::Prepare => self.prepare(p),
            Step::CommitPush => {
                let msg = push::commit_message(&self.content.summary());
                p.log.add(LogKind::Out, format!("Commit-Nachricht: {msg}"));
                let hash = match push::commit(&root, &msg, &mut p.log) {
                    Ok(h) => h,
                    Err(e) => return fail(&mut p.log, e),
                };
                match push::push(&root, &mut p.log) {
                    Ok(()) => {
                        self.base = Some(Base {
                            snap: Snapshot { commit: hash.clone(), text: self.sealed_text.clone() },
                            content: Some(self.sealed.clone()),
                        });
                        p.log.add(LogKind::Ok, format!("Fertig: {} ist gepusht, die Seite baut sich neu.", push::short(&hash)));
                        PushStage::Done(true)
                    }
                    Err(PushError::Rejected) => {
                        push::undo_commit(&root, &mut p.log);
                        if p.retried {
                            return fail(
                                &mut p.log,
                                format!(
                                    "Wieder abgelehnt: jemand pusht gerade gleichzeitig. Nicht gepusht; dein Stand ist in {VAULT} versiegelt (nicht committet). Später nochmal p."
                                ),
                            );
                        }
                        p.retried = true;
                        p.log.add(LogKind::Warn, "Abgelehnt: jemand hat inzwischen gepusht. Hole den neuen Stand und führe nochmal zusammen.");
                        PushStage::Run(Step::Checks)
                    }
                    Err(PushError::Failed(_)) => fail(
                        &mut p.log,
                        format!(
                            "git push ist fehlgeschlagen. Der Commit {} ist nur lokal. Nochmal: `git push`. Zurücknehmen: `git reset --soft HEAD~1 && git restore --staged {VAULT}`.",
                            push::short(&hash)
                        ),
                    ),
                }
            }
        }
    }

    /// Theirs is open: merge, or go straight on when nobody else changed anything.
    fn merge_with_theirs(&mut self, p: &mut Push) -> PushStage {
        let theirs = p.theirs.as_ref().expect("read").clone();
        let theirs_content = theirs.content.clone().expect("opened");
        let base = match &self.base {
            Some(Base { content: Some(c), .. }) => c.clone(),
            Some(b) if b.snap.text == theirs.snap.text => theirs_content.clone(),
            Some(_) => {
                return fail(
                    &mut p.log,
                    "Der Stand, von dem deine Änderungen ausgehen, geht mit diesem Passwort nicht auf: zusammenführen ist so nicht möglich. Mit x exportieren, git pull, neu starten.".into(),
                )
            }
            // No committed vault at start: every difference counts as added on both sides.
            None => Content::empty(),
        };
        let m = merge::merge(&base, &self.content, &theirs_content);
        p.mine_changes = m.mine_changes;
        p.theirs_changes = m.theirs_changes;
        if theirs_content == base {
            if self.content == theirs_content {
                p.log.add(LogKind::Ok, "Auf origin/main ist schon genau dieser Stand: nichts zu pushen.");
                return PushStage::Done(true);
            }
            p.merged = Some(self.content.clone());
            return PushStage::Run(Step::Prepare);
        }
        p.log.add(
            LogKind::Warn,
            format!(
                "Auf origin/main hat jemand die Stapel geändert ({}). Zusammenführen: {} Konflikt(e).",
                m.theirs_changes.short(),
                m.conflicts.len()
            ),
        );
        p.sel = 0;
        p.merge_note = None;
        p.merge = Some(m);
        PushStage::Merge
    }

    /// Fast-forward main, seal the merged decks over origin's vault, stage.
    fn prepare(&mut self, p: &mut Push) -> PushStage {
        let root = self.root.clone();
        let (Some(pre), Some(theirs), Some(merged)) = (p.pre.clone(), p.theirs.clone(), p.merged.clone()) else {
            return fail(&mut p.log, "interner Fehler: Zusammenführung fehlt".into());
        };
        let theirs_content = theirs.content.clone().expect("opened");
        if let Some(e) = self.vault_changed_outside() {
            return fail(&mut p.log, e);
        }
        let dirty = match push::vault_dirty(&root, &mut p.log) {
            Ok(d) => d,
            Err(e) => return fail(&mut p.log, e),
        };
        if pre.behind > 0 {
            // Our sealed vault would block the fast-forward; it is in memory (and rewritten below).
            if dirty {
                if let Err(e) = push::restore_vault(&root, &mut p.log) {
                    return fail(&mut p.log, e);
                }
            }
            if let Err(e) = push::fast_forward(&root, &pre.upstream, &mut p.log) {
                if dirty {
                    let _ = write_atomic(&root.join(VAULT), &self.sealed_text, false);
                }
                return fail(&mut p.log, e);
            }
            p.forwarded = true;
        }
        let changed_by_merge = merged != self.content;
        self.base = Some(Base { snap: theirs.snap.clone(), content: Some(theirs_content.clone()) });
        self.content = merged.clone();
        if changed_by_merge {
            self.undo.clear();
            self.revalidate();
            self.clamp_row();
        }
        if merged == theirs_content {
            let on_disk = fs::read_to_string(root.join(VAULT)).unwrap_or_default();
            if on_disk != theirs.snap.text {
                if let Err(e) = push::restore_vault(&root, &mut p.log) {
                    return fail(&mut p.log, e);
                }
            }
            self.sealed = theirs_content;
            self.sealed_text = theirs.snap.text.clone();
            p.log.add(LogKind::Ok, "Der Stand von origin/main ist übernommen; von dir bleibt nichts anderes übrig: nichts zu pushen.");
            return PushStage::Done(true);
        }
        p.log.add(LogKind::Step, "Versiegeln");
        let ring = self.keyring.as_mut().expect("unlocked");
        let (text, new_salt) = match vault::seal_checked(ring, &merged, Some(&theirs.vault)) {
            Ok(x) => x,
            Err(e) => return fail(&mut p.log, e),
        };
        if let Err(e) = write_atomic(&root.join(VAULT), &text, false) {
            return fail(&mut p.log, e);
        }
        self.sealed = merged;
        self.sealed_text = text;
        p.new_key = new_salt;
        p.log.add(LogKind::Ok, format!("✓ versiegelt und zur Probe wieder entschlüsselt: {}", self.content.summary()));
        if new_salt {
            p.log.add(LogKind::Warn, "Neuer Schlüssel: alle müssen nach dem Push einmal neu freischalten.");
        }
        if let Err(e) = push::stage(&root, &mut p.log) {
            return fail(&mut p.log, e);
        }
        let theirs_part = if p.theirs_changes.is_empty() {
            String::new()
        } else {
            let decided = p.merge.as_ref().map_or(0, |m| m.conflicts.len());
            let decided = if decided > 0 { format!(", Konflikte: {decided} entschieden") } else { String::new() };
            format!(", vom anderen übernommen: {}{decided}", p.theirs_changes.short())
        };
        let key = if p.new_key { " NEUER SCHLÜSSEL (alle schalten neu frei)." } else { " Schlüssel unverändert." };
        PushStage::AskPush(format!(
            "Commit + Push von {VAULT}: {}. Von dir: {}{theirs_part}.{key} Pushen? (j/n)",
            self.content.summary(),
            p.mine_changes.short()
        ))
    }

    /// Merge screen confirmed: the merged decks are checked with the seal rules first.
    fn finish_merge(&mut self, p: &mut Push) -> PushStage {
        let Some(merged) = p.merge.as_ref().and_then(|m| m.result()) else {
            let n = p.merge.as_ref().map_or(0, |m| m.unresolved());
            p.merge_note = Some(format!("Noch {n} Konflikt(e) offen: ← meine / → andere wählen."));
            return PushStage::Merge;
        };
        let report = validate(&merged);
        if report.total() > 0 {
            // Keep the merged state in memory (its base is origin's vault now), so it can be fixed here.
            let theirs = p.theirs.as_ref().expect("read");
            self.base = Some(Base { snap: theirs.snap.clone(), content: theirs.content.clone() });
            self.content = merged;
            self.undo.clear();
            self.revalidate();
            self.clamp_row();
            for l in report.lines() {
                p.log.add(LogKind::Err, l);
            }
            return fail(
                &mut p.log,
                format!(
                    "Das Zusammengeführte verletzt {} Regel(n) (oben). Es ist jetzt im Speicher: beheben, dann nochmal p. Nichts gepusht.",
                    report.total()
                ),
            );
        }
        p.log.add(LogKind::Ok, format!("✓ zusammengeführt: {}", merged.summary()));
        p.merged = Some(merged);
        PushStage::Run(Step::Prepare)
    }

    fn key_push(&mut self, k: KeyEvent, mut p: Push) {
        let yes = matches!(k.code, KeyCode::Char('j' | 'J' | 'y' | 'Y'));
        let no = matches!(k.code, KeyCode::Char('n' | 'N') | KeyCode::Esc);
        match p.stage.clone() {
            PushStage::AskStart(_) if yes => p.stage = PushStage::Run(Step::Checks),
            PushStage::AskStart(_) if no => {
                self.say(Tone::Info, "Abgebrochen.");
                return;
            }
            PushStage::AskPassword => match k.code {
                KeyCode::Esc => {
                    p.password = SecretInput::default();
                    p.stage =
                        fail(&mut p.log, "Abgebrochen: ohne das neue Passwort lässt sich nicht zusammenführen. Nichts geändert.".into());
                }
                KeyCode::Enter if !p.password.is_empty() => {
                    p.pw_error = None;
                    p.stage = PushStage::Run(Step::Unlock);
                }
                _ => {
                    p.password.handle(&k);
                }
            },
            PushStage::Merge => {
                let n = p.merge.as_ref().map_or(0, |m| m.conflicts.len());
                let choose = |p: &mut Push, c: Choice| {
                    if let Some(x) = p.merge.as_mut().and_then(|m| m.conflicts.get_mut(p.sel)) {
                        x.choice = Some(c);
                        p.sel = (p.sel + 1).min(n.saturating_sub(1));
                        p.merge_note = None;
                    }
                };
                match k.code {
                    KeyCode::Up => p.sel = p.sel.saturating_sub(1),
                    KeyCode::Down => p.sel = (p.sel + 1).min(n.saturating_sub(1)),
                    KeyCode::Left | KeyCode::Char('m' | '1') => choose(&mut p, Choice::Mine),
                    KeyCode::Right | KeyCode::Char('t' | '2') => choose(&mut p, Choice::Theirs),
                    KeyCode::Enter | KeyCode::Char('j') => p.stage = self.finish_merge(&mut p),
                    KeyCode::Esc | KeyCode::Char('n') => {
                        p.stage = fail(&mut p.log, "Zusammenführen abgebrochen. Nichts geändert, nichts gepusht.".into());
                    }
                    _ => {}
                }
            }
            PushStage::AskPush(_) if yes => p.stage = PushStage::Run(Step::CommitPush),
            PushStage::AskPush(_) if no => {
                push::unstage(&self.root, &mut p.log);
                let ff = if p.forwarded { " main steht jetzt auf dem Stand von origin/main." } else { "" };
                p.stage = fail(&mut p.log, format!("Nicht gepusht. {VAULT} ist versiegelt, aber nicht gestaged.{ff} Später nochmal p."));
                self.say(Tone::Info, "Nicht gepusht.");
            }
            PushStage::Done(_) if matches!(k.code, KeyCode::Esc | KeyCode::Enter | KeyCode::Char('q')) => return,
            _ => match k.code {
                KeyCode::Up => p.scroll += 1,
                KeyCode::Down => p.scroll = p.scroll.saturating_sub(1),
                KeyCode::PageUp => p.scroll += 10,
                KeyCode::PageDown => p.scroll = p.scroll.saturating_sub(10),
                _ => {}
            },
        }
        self.modal = Modal::Push(Box::new(p));
    }
}

fn fail(log: &mut Log, e: String) -> PushStage {
    log.add(LogKind::Err, format!("✗ {e}"));
    PushStage::Done(false)
}

fn scroll_table(t: &mut TableState, d: isize, n: usize) {
    if n == 0 {
        return;
    }
    let s = t.selected().unwrap_or(0) as isize;
    t.select(Some((s + d).clamp(0, n as isize - 1) as usize));
}

/// Reads a file for `i`. `~/` is the home directory; relative paths are from where the tool started.
fn read_import_file(p: &str) -> Result<String, String> {
    let p = p.trim();
    if p.is_empty() {
        return Err("Erst einen Dateipfad eingeben.".into());
    }
    let path = match p.strip_prefix("~/") {
        Some(rest) => PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(rest),
        None => PathBuf::from(p),
    };
    let meta = fs::metadata(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    if meta.len() > MAX_IMPORT_BYTES {
        return Err(format!("{} ist zu groß (über 2 MB).", path.display()));
    }
    let bytes = fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
