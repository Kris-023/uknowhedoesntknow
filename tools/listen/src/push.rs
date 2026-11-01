//! Git steps of the push, with the safety checks that keep plaintext and other work out of it.
//!
//! Every external program runs through `std::process::Command` with the project root as working
//! directory and fixed arguments, never through a shell string, with no stdin. Nothing here sees the
//! password or plaintext: only the sealed vault text passes through.

use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::Value;

pub use crate::vault::VAULT;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogKind {
    /// A step heading.
    Step,
    /// A command line.
    Cmd,
    Out,
    Err,
    Ok,
    Warn,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LogLine {
    pub kind: LogKind,
    pub text: String,
}

#[derive(Default, Debug, Clone)]
pub struct Log {
    pub lines: Vec<LogLine>,
}

impl Log {
    pub fn add(&mut self, kind: LogKind, text: impl Into<String>) {
        for l in text.into().lines() {
            self.lines.push(LogLine { kind, text: l.to_string() });
        }
    }

    pub fn text(&self) -> String {
        self.lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n")
    }
}

#[derive(Debug)]
pub struct Output {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Runs a program in `root`. No stdin: nothing can wait for input inside the TUI. Git must not ask for
/// credentials on the terminal either (a credential helper works without).
pub fn run(root: &Path, argv: &[String], log: &mut Log, echo: bool) -> Result<Output, String> {
    let (prog, args) = argv.split_first().ok_or("leerer Befehl")?;
    if echo {
        let shown: Vec<String> = argv.iter().map(|a| if a.contains(' ') { format!("\"{a}\"") } else { a.clone() }).collect();
        log.add(LogKind::Cmd, format!("$ {}", shown.join(" ")));
    }
    let out = Command::new(prog)
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("{prog} lässt sich nicht starten: {e}"))?;
    let o = Output {
        ok: out.status.success(),
        stdout: String::from_utf8_lossy(&out.stdout).trim_end().to_string(),
        stderr: String::from_utf8_lossy(&out.stderr).trim_end().to_string(),
    };
    if echo {
        if !o.stdout.is_empty() {
            log.add(LogKind::Out, &o.stdout);
        }
        if !o.stderr.is_empty() {
            log.add(if o.ok { LogKind::Out } else { LogKind::Err }, &o.stderr);
        }
    }
    Ok(o)
}

fn git(root: &Path, args: &[&str], log: &mut Log, echo: bool) -> Result<Output, String> {
    let mut argv = vec!["git".to_string()];
    argv.extend(args.iter().map(|s| s.to_string()));
    run(root, &argv, log, echo)
}

/// Git output that must succeed; its stdout.
fn git_ok(root: &Path, args: &[&str], log: &mut Log) -> Result<String, String> {
    let o = git(root, args, log, false)?;
    if !o.ok {
        return Err(format!("git {} ist fehlgeschlagen: {}", args.join(" "), o.stderr));
    }
    Ok(o.stdout)
}

/// Does the vault look like a sealed vault and nothing else (no plaintext field)?
pub fn vault_shape_ok(text: &str) -> Result<(), String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("{VAULT} ist kein JSON: {e}"))?;
    let o = v.as_object().ok_or(format!("{VAULT} ist kein Objekt"))?;
    let mut keys: Vec<&str> = o.keys().map(String::as_str).collect();
    keys.sort_unstable();
    if keys != ["cipher", "data", "format", "iv", "kdf", "salt", "v"] || o.get("format").and_then(Value::as_str) != Some("ukhdk-vault") {
        return Err(format!("{VAULT} sieht nicht wie ein versiegelter Tresor aus (Felder: {})", keys.join(", ")));
    }
    Ok(())
}

/// A commit and the vault text in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub commit: String,
    pub text: String,
}

/// The vault as committed at `rev` (e.g. `HEAD`). None: not a git repo, no such commit, or no vault
/// in it.
pub fn snapshot(root: &Path, rev: &str) -> Option<Snapshot> {
    let mut log = Log::default();
    let commit = git_ok(root, &["rev-parse", "--verify", "--quiet", &format!("{rev}^{{commit}}")], &mut log).ok()?;
    // Raw bytes (run() trims output), so the text compares equal to the file in the working tree.
    let out = Command::new("git")
        .args(["cat-file", "blob", &format!("{commit}:{VAULT}")])
        .current_dir(root)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    out.status.success().then(|| Snapshot { commit, text: String::from_utf8_lossy(&out.stdout).into_owned() })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Preflight {
    pub upstream: String,
    /// Commits on the upstream that main does not have yet (a fast-forward takes them).
    pub behind: usize,
}

/// Safety checks and `git fetch`. Any `Err` means: don't push; nothing was changed in git.
pub fn preflight(root: &Path, log: &mut Log) -> Result<Preflight, String> {
    log.add(LogKind::Step, "Sicherheitsprüfungen");
    let branch = git_ok(root, &["symbolic-ref", "--quiet", "--short", "HEAD"], log)
        .map_err(|_| "Kein Branch ausgecheckt (detached HEAD) oder kein Git-Repo.".to_string())?;
    if branch != "main" {
        return Err(format!("Aktueller Branch ist „{branch}“, nicht „main“. Erst `git switch main`."));
    }
    log.add(LogKind::Ok, "✓ Branch ist main");
    let tracked = git_ok(root, &["ls-files", "--", "private"], log)?;
    if !tracked.is_empty() {
        return Err(format!(
            "Dateien aus private/ sind in git ({}). Das darf nie sein: `git rm --cached -r private` und prüfen, ob schon etwas gepusht wurde.",
            tracked.lines().count()
        ));
    }
    log.add(LogKind::Ok, "✓ nichts aus private/ in git");
    if !git(root, &["check-ignore", "-q", "private/content"], log, false)?.ok {
        return Err("private/content ist nicht per .gitignore ausgeschlossen.".into());
    }
    log.add(LogKind::Ok, "✓ private/content ist ignoriert");
    let staged = git_ok(root, &["diff", "--cached", "--name-only"], log)?;
    if !staged.is_empty() {
        return Err(format!(
            "Es ist schon etwas gestaged ({}). Erst selbst committen oder `git restore --staged …`, dann nochmal.",
            staged.lines().collect::<Vec<_>>().join(", ")
        ));
    }
    log.add(LogKind::Ok, "✓ nichts anderes gestaged");
    let upstream = git_ok(root, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], log)
        .map_err(|_| "main hat keinen Upstream (origin/main). Erst `git push -u origin main`.".to_string())?;
    let f = git(root, &["fetch", "--quiet"], log, true)?;
    if !f.ok {
        return Err("git fetch ist fehlgeschlagen (Netz oder Anmeldung?).".into());
    }
    let counts = git_ok(root, &["rev-list", "--left-right", "--count", "HEAD...@{u}"], log)?;
    let mut it = counts.split_whitespace().map(|n| n.parse::<usize>().unwrap_or(0));
    let (ahead, behind) = (it.next().unwrap_or(0), it.next().unwrap_or(0));
    if ahead > 0 {
        return Err(format!(
            "main hat {ahead} lokale(n) Commit(s), die noch nicht auf {upstream} sind. Die würden mitgepusht: erst selbst prüfen und pushen."
        ));
    }
    if behind > 0 {
        log.add(LogKind::Ok, format!("✓ keine lokalen Commits; {upstream} ist {behind} Commit(s) weiter"));
    } else {
        log.add(LogKind::Ok, format!("✓ auf Stand mit {upstream}"));
    }
    Ok(Preflight { upstream, behind })
}

/// The vault differs from HEAD in the working tree (or index).
pub fn vault_dirty(root: &Path, log: &mut Log) -> Result<bool, String> {
    Ok(!git_ok(root, &["status", "--porcelain", "--", VAULT], log)?.is_empty())
}

/// Puts the vault back to HEAD in the working tree (only that file).
pub fn restore_vault(root: &Path, log: &mut Log) -> Result<(), String> {
    git_ok(root, &["checkout", "--quiet", "HEAD", "--", VAULT], log).map(|_| ())
}

/// `git merge --ff-only` to the upstream. Git refuses before touching anything if local changes are in
/// the way.
pub fn fast_forward(root: &Path, upstream: &str, log: &mut Log) -> Result<(), String> {
    log.add(LogKind::Step, format!("main auf {upstream} vorspulen"));
    let o = git(root, &["merge", "--ff-only", "--quiet", upstream], log, true)?;
    if !o.ok {
        return Err(format!(
            "main lässt sich nicht auf {upstream} vorspulen (git merge --ff-only). Meist stehen andere lokale Änderungen im Weg: erst committen oder wegräumen, dann nochmal p. Nichts gepusht."
        ));
    }
    log.add(LogKind::Ok, format!("✓ main ist auf {upstream}"));
    Ok(())
}

/// Undoes `stage` (only the vault; the file itself stays as sealed).
pub fn unstage(root: &Path, log: &mut Log) {
    if let Err(e) = git(root, &["reset", "--quiet", "--", VAULT], log, false) {
        log.add(LogKind::Err, e);
    }
}

/// `git add` of the vault, then the staged set must be exactly that file.
pub fn stage(root: &Path, log: &mut Log) -> Result<(), String> {
    let a = git(root, &["add", "--", VAULT], log, true)?;
    if !a.ok {
        unstage(root, log);
        return Err("git add ist fehlgeschlagen.".into());
    }
    let staged = git_ok(root, &["diff", "--cached", "--name-only"], log)?;
    if staged != VAULT {
        unstage(root, log);
        return Err(format!("Gestaged wäre nicht nur {VAULT}, sondern: {}. Abgebrochen und zurückgenommen.", staged.replace('\n', ", ")));
    }
    log.add(LogKind::Ok, format!("✓ gestaged ist genau {VAULT}"));
    Ok(())
}

pub fn commit_message(summary: &str) -> String {
    format!("Stapel aktualisiert ({summary})")
}

/// Commits the staged vault (pathspec as a second guard: only that file goes in). Returns the full hash.
pub fn commit(root: &Path, message: &str, log: &mut Log) -> Result<String, String> {
    log.add(LogKind::Step, "Commit und Push");
    let c = git(root, &["commit", "--quiet", "-m", message, "--", VAULT], log, true)?;
    if !c.ok {
        unstage(root, log);
        return Err("git commit ist fehlgeschlagen; nichts committet, Tresor wieder ungestaged.".into());
    }
    let files = git_ok(root, &["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], log)?;
    if files != VAULT {
        undo_commit(root, log);
        return Err(format!("Der Commit enthielt mehr als {VAULT} ({}). Zurückgenommen, nichts gepusht.", files.replace('\n', ", ")));
    }
    let hash = git_ok(root, &["rev-parse", "HEAD"], log)?;
    log.add(LogKind::Ok, format!("✓ Commit {}", short(&hash)));
    Ok(hash)
}

pub fn short(hash: &str) -> &str {
    &hash[..hash.len().min(7)]
}

/// Takes the last commit back; the vault stays in the working tree, unstaged.
pub fn undo_commit(root: &Path, log: &mut Log) {
    if let Err(e) = git(root, &["reset", "--quiet", "--soft", "HEAD~1"], log, true) {
        log.add(LogKind::Err, e);
    }
    unstage(root, log);
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PushError {
    /// The remote has commits we don't: someone pushed meanwhile.
    Rejected,
    Failed(String),
}

pub fn push(root: &Path, log: &mut Log) -> Result<(), PushError> {
    let p = git(root, &["push", "--quiet"], log, true).map_err(PushError::Failed)?;
    if p.ok {
        log.add(LogKind::Ok, "✓ gepusht");
        return Ok(());
    }
    let e = p.stderr.to_lowercase();
    if e.contains("[rejected]") || e.contains("non-fast-forward") || e.contains("fetch first") {
        return Err(PushError::Rejected);
    }
    Err(PushError::Failed(p.stderr))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_shape() {
        let ok = r#"{"format":"ukhdk-vault","v":1,"kdf":{},"cipher":"AES-256-GCM","salt":"a","iv":"b","data":"c"}"#;
        assert!(vault_shape_ok(ok).is_ok());
        assert!(
            vault_shape_ok(r#"{"format":"ukhdk-vault","v":1,"kdf":{},"cipher":"x","salt":"a","iv":"b","data":"c","words":[]}"#).is_err()
        );
        assert!(vault_shape_ok(r#"{"v":1,"words":{"normal":[]}}"#).is_err());
        assert!(vault_shape_ok("nicht json").is_err());
    }
}
