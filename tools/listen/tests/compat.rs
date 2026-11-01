//! Byte compatibility with scripts/seal-content.mjs and src/words/vault.ts, both ways, with node.
//! Everything runs on made-up fixtures in temp folders with a temp password file; the real vault and
//! password are never touched. Skipped (with a note) where node or the project files are missing.

mod common;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use common::{fixture, open_text, pass_file, salt, write_files, TempDir, OTHER_PASS, PASS};
use ukhdk_listen::content::{Content, Entry, ListId};

fn project_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn node_ok() -> bool {
    let ok = Command::new("node").arg("--version").output().is_ok_and(|o| o.status.success())
        && project_root().join("scripts/seal-content.mjs").is_file();
    if !ok {
        eprintln!("übersprungen: node oder scripts/seal-content.mjs fehlt");
    }
    ok
}

struct Out {
    ok: bool,
    stdout: String,
    stderr: String,
}

/// The seal script on fixture files, with the password from `pass` (never the default file).
fn seal_script(content: &Path, out: &Path, pass: &Path, check: bool) -> Out {
    let mut cmd = Command::new("node");
    cmd.arg(project_root().join("scripts/seal-content.mjs"));
    if check {
        cmd.arg("--check");
    }
    let o = cmd.arg("--content").arg(content).arg("--out").arg(out).env("UKHDK_DECK_PASS_FILE", pass).output().unwrap();
    Out { ok: o.status.success(), stdout: String::from_utf8_lossy(&o.stdout).into(), stderr: String::from_utf8_lossy(&o.stderr).into() }
}

struct Fixture {
    tmp: TempDir,
    content: PathBuf,
    out: PathBuf,
    pass: PathBuf,
}

fn setup() -> Fixture {
    let tmp = TempDir::new("compat");
    let content = tmp.0.join("content");
    write_files(&content);
    let out = tmp.0.join("vault.json");
    let pass = pass_file(&tmp.0, PASS);
    Fixture { tmp, content, out, pass }
}

#[test]
fn a_vault_sealed_by_the_script_opens_here() {
    if !node_ok() {
        return;
    }
    let f = setup();
    let r = seal_script(&f.content, &f.out, &f.pass, false);
    assert!(r.ok, "{}", r.stderr);
    assert!(r.stdout.contains("Versiegelt") && r.stdout.contains("Neuer Schlüssel"));
    let text = fs::read_to_string(&f.out).unwrap();
    assert_eq!(open_text(&text, PASS), fixture());
    // Same file format: re-serialising gives the same bytes.
    assert_eq!(ukhdk_listen::vault::Vault::parse(&text).unwrap().to_text(), text);
}

#[test]
fn a_vault_sealed_here_passes_the_script_check() {
    if !node_ok() {
        return;
    }
    let f = setup();
    fs::write(&f.out, common::seal(&fixture(), PASS, None)).unwrap();
    let r = seal_script(&f.content, &f.out, &f.pass, true);
    assert!(r.ok, "{}", r.stderr);
    // `--check` decrypts and compares JSON.stringify of both: same keys, same order, same strings.
    assert!(r.stdout.contains("Tresor geht auf: Wörter 3 + NSFW 1"), "{}", r.stdout);
    assert!(r.stdout.contains("Stimmt mit private/content überein"), "{}", r.stdout);
    // And with one entry less it notices.
    let mut c = fixture();
    c.entries_mut(ListId::SlfText).pop();
    fs::write(&f.out, common::seal(&c, PASS, None)).unwrap();
    assert!(seal_script(&f.content, &f.out, &f.pass, true).stdout.contains("Weicht von private/content ab"));
}

#[test]
fn the_salt_is_kept_across_both_sealers_with_the_same_password() {
    if !node_ok() {
        return;
    }
    let f = setup();
    assert!(seal_script(&f.content, &f.out, &f.pass, false).ok);
    let by_script = fs::read_to_string(&f.out).unwrap();
    // Here over the script's vault: same salt, fresh IV.
    let mut c = fixture();
    c.entries_mut(ListId::WordsNormal).push(Entry::card("Zebra", vec!["Streifen".into()]));
    let here = common::seal(&c, PASS, Some(&by_script));
    assert_eq!(salt(&here), salt(&by_script));
    assert_ne!(ukhdk_listen::vault::Vault::parse(&here).unwrap().iv, ukhdk_listen::vault::Vault::parse(&by_script).unwrap().iv);
    // The script over ours: also keeps it.
    fs::write(&f.out, &here).unwrap();
    let r = seal_script(&f.content, &f.out, &f.pass, false);
    assert!(r.stdout.contains("Schlüssel unverändert"), "{}", r.stdout);
    assert_eq!(salt(&fs::read_to_string(&f.out).unwrap()), salt(&here));
    // A new password: a new salt, and the script's check opens it with that password only.
    let other = common::seal(&fixture(), OTHER_PASS, Some(&here));
    assert_ne!(salt(&other), salt(&here));
    fs::write(&f.out, &other).unwrap();
    let r = seal_script(&f.content, &f.out, &f.pass, true);
    assert!(!r.ok && r.stderr.contains("nicht auf"), "{}", r.stderr);
    let other_pass_dir = f.tmp.0.join("anders");
    fs::create_dir_all(&other_pass_dir).unwrap();
    let r = seal_script(&f.content, &f.out, &pass_file(&other_pass_dir, OTHER_PASS), true);
    assert!(r.ok && r.stdout.contains("Stimmt mit private/content überein"), "{}{}", r.stdout, r.stderr);
}

#[test]
fn an_export_seals_back_to_the_same_content() {
    if !node_ok() {
        return;
    }
    let f = setup();
    let mut c = fixture();
    c.entries_mut(ListId::WordsNsfw).push(Entry::card("Ärger", vec!["Wut".into(), "Groll".into()]));
    c.entries_mut(ListId::ZeigNormal).push(Entry::text("„zitiert“ und \"anders\" zitiert"));
    let dir = f.tmp.0.join("export");
    fs::create_dir_all(&dir).unwrap();
    for id in ListId::ALL {
        fs::write(dir.join(id.file_name()), c.export_file(id)).unwrap();
    }
    fs::write(&f.out, common::seal(&c, PASS, None)).unwrap();
    let r = seal_script(&dir, &f.out, &f.pass, true);
    assert!(r.ok && r.stdout.contains("Stimmt mit private/content überein"), "{}{}", r.stdout, r.stderr);
}

/// Loads src/words/vault.ts itself in node (type stripping), with its `./vault.json` import pointed at
/// a test vault, and opens that vault with `deriveKey` + `openVault` like the browser does.
fn open_with_vault_ts(dir: &Path, vault: &Path, pass: &str) -> Option<String> {
    let hooks = dir.join("hooks.mjs");
    fs::write(
        &hooks,
        "import { pathToFileURL } from 'node:url';\n\
         export async function resolve(spec, ctx, next) {\n\
           if (spec === './vault.json') return { url: pathToFileURL(process.env.TEST_VAULT).href, format: 'json', importAttributes: { type: 'json' }, shortCircuit: true };\n\
           return next(spec, ctx);\n\
         }\n",
    )
    .unwrap();
    let reg = dir.join("register.mjs");
    fs::write(&reg, "import { register } from 'node:module';\nregister('./hooks.mjs', import.meta.url);\n").unwrap();
    let main = dir.join("open.mjs");
    fs::write(
        &main,
        "const { VAULT, deriveKey, openVault } = await import(process.env.VAULT_TS);\n\
         if (!VAULT) { console.error('parseVault: null'); process.exit(2); }\n\
         const c = await openVault(VAULT, await deriveKey(process.env.TEST_PASS, VAULT));\n\
         if (!c) { console.error('openVault: null'); process.exit(3); }\n\
         process.stdout.write(JSON.stringify(c));\n",
    )
    .unwrap();
    let o = Command::new("node")
        .args(["--experimental-strip-types", "--no-warnings", "--import"])
        .arg(&reg)
        .arg(&main)
        .current_dir(dir)
        .env("TEST_VAULT", vault)
        .env("TEST_PASS", pass)
        .env("VAULT_TS", project_root().join("src/words/vault.ts"))
        .output()
        .ok()?;
    if !o.status.success() {
        let err = String::from_utf8_lossy(&o.stderr);
        // Older node without type stripping: say so instead of failing.
        if err.contains("Unknown file extension") || err.contains("bad option") {
            eprintln!("übersprungen: node kann vault.ts nicht direkt laden ({err})");
            return None;
        }
        panic!("vault.ts: {err}");
    }
    Some(String::from_utf8(o.stdout).unwrap())
}

#[test]
fn a_vault_sealed_here_opens_with_vault_ts() {
    if !node_ok() || !project_root().join("src/words/vault.ts").is_file() {
        return;
    }
    let f = setup();
    let mut c: Content = fixture();
    c.entries_mut(ListId::SlfNsfw).push(Entry::text("Ümlaut-Ärger ß"));
    fs::write(&f.out, common::seal(&c, PASS, None)).unwrap();
    let Some(json) = open_with_vault_ts(&f.tmp.0, &f.out, PASS) else { return };
    assert_eq!(json.as_bytes(), c.to_json().as_slice());
    assert_eq!(Content::from_json(json.as_bytes()).unwrap(), c);
}
