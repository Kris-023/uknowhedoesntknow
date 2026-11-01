//! A fake project in a temp folder: a vault sealed from made-up decks with a test password, the
//! password in a temp file, a git repo with a local bare "origin" (no network), and helpers for a
//! second person who pushes in between.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ukhdk_listen::app::App;
use ukhdk_listen::content::{is_entry_line, split_taboo, squash, Content, Entry, Kind, ListId};
use ukhdk_listen::vault::{self, Keyring, Vault, VAULT};
use zeroize::Zeroizing;

pub const PASS: &str = "test-passwort-123";
pub const OTHER_PASS: &str = "ein-anderes-passwort";

pub struct TempDir(pub PathBuf);

impl TempDir {
    pub fn new(tag: &str) -> TempDir {
        static N: AtomicUsize = AtomicUsize::new(0);
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let p =
            std::env::temp_dir().join(format!("ukhdk-listen-{tag}-{}-{}-{nanos}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        fs::create_dir_all(&p).unwrap();
        TempDir(p)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Made-up decks in the plaintext format of the seal script.
pub const FILES: [(&str, &str); 9] = [
    ("woerter-normal.txt", "# Wortkarten Normal\n# Begriff: verboten, verboten\n\nApfel: Obst, Baum, rot\nBär: Tier, Honig, Wald\nKaffeeküche: Tasse, Pause, Büro\n"),
    ("woerter-nsfw.txt", "# Wortkarten NSFW\n\nKobold: Zwerg, Märchen, Wald\n"),
    ("gleich-normal.txt", "# Startfragen\n\nEtwas, das man im Büro klaut\nEin Tier mit vier Beinen\n"),
    ("gleich-nsfw.txt", "# Startfragen NSFW\n\nEin Ort für ein Date\n"),
    ("zeig-normal.txt", "# Zeig drauf\n\nim Büro einschlafen\n"),
    ("zeig-nsfw.txt", "# Zeig drauf NSFW\n\nauf der Party verschwinden\n"),
    ("slf-text.txt", "# SLF Text\n\nStadt\nLand\nFluss\nTier\n"),
    ("slf-bild.txt", "# SLF Bilder\n\nEtwas Rundes\n"),
    ("slf-nsfw.txt", "# SLF NSFW\n\nPeinliches Hobby\n"),
];

/// Reads a plaintext file the way the seal script does (`readLines`, `words()`).
pub fn parse_file(kind: Kind, text: &str) -> Vec<Entry> {
    text.lines()
        .filter(|l| is_entry_line(l))
        .map(|l| match (kind, l.split_once(':')) {
            (Kind::Words, Some((w, t))) => Entry::card(squash(w), split_taboo(t)),
            _ => Entry::text(squash(l)),
        })
        .collect()
}

pub fn fixture() -> Content {
    let mut c = Content::empty();
    for (id, (_, text)) in ListId::ALL.iter().zip(FILES) {
        c.lists[id.index()] = parse_file(id.kind(), text);
    }
    c
}

pub fn write_files(dir: &Path) {
    fs::create_dir_all(dir).unwrap();
    for (name, text) in FILES {
        fs::write(dir.join(name), text).unwrap();
    }
}

pub fn ring(pass: &str) -> Keyring {
    Keyring::new(Zeroizing::new(pass.to_string()))
}

/// A vault file text: over `current` (keeps its salt if the password fits), else with a new salt.
pub fn seal(c: &Content, pass: &str, current: Option<&str>) -> String {
    let current = current.map(|t| Vault::parse(t).unwrap());
    vault::seal_checked(&mut ring(pass), c, current.as_ref()).unwrap().0
}

pub fn open_text(text: &str, pass: &str) -> Content {
    ring(pass).open(&Vault::parse(text).unwrap()).unwrap()
}

pub fn salt(text: &str) -> String {
    Vault::parse(text).unwrap().salt
}

pub fn git(dir: &Path, args: &[&str]) -> String {
    let o = Command::new("git").args(args).current_dir(dir).output().unwrap();
    assert!(o.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&o.stderr));
    String::from_utf8_lossy(&o.stdout).trim().to_string()
}

pub fn git_config(dir: &Path) {
    for (k, v) in [("user.name", "Test"), ("user.email", "test@example.invalid"), ("commit.gpgsign", "false")] {
        git(dir, &["config", k, v]);
    }
}

pub fn pass_file(dir: &Path, pass: &str) -> PathBuf {
    let f = dir.join("deck-pass");
    fs::write(&f, format!("{pass}\n")).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&f, fs::Permissions::from_mode(0o600)).unwrap();
    }
    f
}

pub struct Project {
    pub tmp: TempDir,
    pub root: PathBuf,
    pub remote: PathBuf,
    pub pass: PathBuf,
}

impl Project {
    pub fn app(&self) -> App {
        App::open(&self.root, Some(&self.pass)).unwrap()
    }

    /// Another working copy of origin (a second person).
    pub fn clone(&self, name: &str) -> PathBuf {
        let dir = self.tmp.0.join(name);
        git(&self.tmp.0, &["clone", "-q", self.remote.to_str().unwrap(), dir.to_str().unwrap()]);
        git_config(&dir);
        dir
    }

    /// Someone else pushes a change of the decks, straight with git, sealed with `pass` (same salt if
    /// it is the vault's password).
    pub fn other_pushes(&self, pass: &str, f: impl FnOnce(&mut Content)) {
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = self.clone(&format!("anderer-{}", N.fetch_add(1, Ordering::SeqCst)));
        let old = fs::read_to_string(dir.join(VAULT)).unwrap();
        let v = Vault::parse(&old).unwrap();
        let mut c = [PASS, OTHER_PASS].iter().find_map(|p| ring(p).open(&v).ok()).expect("origin opens with a test password");
        f(&mut c);
        fs::write(dir.join(VAULT), seal(&c, pass, Some(&old))).unwrap();
        git(&dir, &["commit", "-q", "-am", "Stapel vom anderen"]);
        git(&dir, &["push", "-q"]);
    }

    /// The decks on origin/main.
    pub fn remote_content(&self, pass: &str) -> Content {
        open_text(&self.remote_vault(), pass)
    }

    pub fn remote_vault(&self) -> String {
        git_show(&self.remote, &format!("main:{VAULT}"))
    }
}

/// Raw file content at a revision.
pub fn git_show(dir: &Path, spec: &str) -> String {
    let o = Command::new("git").args(["show", spec]).current_dir(dir).output().unwrap();
    assert!(o.status.success(), "git show {spec}: {}", String::from_utf8_lossy(&o.stderr));
    String::from_utf8(o.stdout).unwrap()
}

/// A project folder with only a vault (no git, no private/), for UI tests.
pub fn content_only() -> (TempDir, PathBuf, PathBuf) {
    content_only_with(&fixture())
}

pub fn content_only_with(c: &Content) -> (TempDir, PathBuf, PathBuf) {
    let tmp = TempDir::new("ui");
    let root = tmp.0.join("projekt");
    fs::create_dir_all(root.join("src/words")).unwrap();
    fs::write(root.join(VAULT), seal(c, PASS, None)).unwrap();
    let pass = pass_file(&tmp.0, PASS);
    (tmp, root, pass)
}

/// The whole fake project with git and origin. No private/ folder: the tool must not need one.
pub fn project() -> Project {
    let tmp = TempDir::new("push");
    let root = tmp.0.join("projekt");
    let remote = tmp.0.join("origin.git");
    fs::create_dir_all(root.join("src/words")).unwrap();
    fs::write(root.join(VAULT), seal(&fixture(), PASS, None)).unwrap();
    fs::write(root.join(".gitignore"), "private/\n").unwrap();
    fs::write(root.join("README.md"), "Test\n").unwrap();
    git(&root, &["init", "-q", "-b", "main"]);
    git_config(&root);
    git(&root, &["add", "."]);
    git(&root, &["commit", "-q", "-m", "Start"]);
    git(&tmp.0, &["init", "-q", "--bare", "-b", "main", remote.to_str().unwrap()]);
    git(&root, &["remote", "add", "origin", remote.to_str().unwrap()]);
    git(&root, &["push", "-q", "-u", "origin", "main"]);
    let pass = pass_file(&tmp.0, PASS);
    Project { tmp, root, remote, pass }
}

/// Subject and files of the last commit on origin/main.
pub fn remote_head(p: &Project) -> (String, Vec<String>) {
    let subject = git(&p.remote, &["log", "-1", "--format=%s", "main"]);
    let files = git(&p.remote, &["diff-tree", "--no-commit-id", "--name-only", "-r", "main"]);
    (subject, files.lines().map(str::to_string).collect())
}

// ---- driving the app like a user ----

pub fn key(app: &mut App, code: KeyCode) {
    app.handle_key(KeyEvent::new(code, KeyModifiers::NONE));
}

pub fn ctrl(app: &mut App, c: char) {
    app.handle_key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::CONTROL));
}

pub fn typ(app: &mut App, s: &str) {
    for c in s.chars() {
        key(app, KeyCode::Char(c));
    }
}

/// Runs the steps that need no key until the next question.
pub fn run_until_question(a: &mut App) {
    for _ in 0..30 {
        if !a.has_work() {
            return;
        }
        a.tick();
    }
    panic!("läuft endlos");
}

/// `a` adds a word card to the current list.
pub fn add_card(a: &mut App, word: &str, taboo: &str) {
    key(a, KeyCode::Char('a'));
    typ(a, word);
    key(a, KeyCode::Tab);
    typ(a, taboo);
    key(a, KeyCode::Enter);
}

pub fn find(c: &Content, text: &str) -> Option<(ListId, Entry)> {
    ListId::ALL.iter().find_map(|&l| c.entries(l).iter().find(|e| e.text == text).map(|e| (l, e.clone())))
}

pub fn card(w: &str, t: &[&str]) -> Entry {
    Entry::card(w, t.iter().map(|s| s.to_string()).collect())
}

pub fn screen(app: &mut App, w: u16, h: u16) -> String {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    let mut t = Terminal::new(TestBackend::new(w, h)).unwrap();
    t.draw(|f| ukhdk_listen::ui::draw(f, app)).unwrap();
    let buf = t.backend().buffer().clone();
    let mut out = String::new();
    for y in 0..buf.area.height {
        let mut line = String::new();
        for x in 0..buf.area.width {
            line.push_str(buf[(x, y)].symbol());
        }
        out.push_str(line.trim_end());
        out.push('\n');
    }
    out
}
