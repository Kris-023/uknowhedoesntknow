//! The push against real git repos with a local bare origin: safety checks, the three-way merge with
//! someone who pushed meanwhile, conflicts, a push race, a changed password.

mod common;

use std::fs;

use common::{add_card, card, find, fixture, git, key, project, remote_head, run_until_question, salt, typ, Project, OTHER_PASS, PASS};
use crossterm::event::KeyCode;
use ukhdk_listen::app::{App, Modal, PushStage};
use ukhdk_listen::content::{Entry, ListId};
use ukhdk_listen::vault::VAULT;

fn stage(a: &App) -> PushStage {
    match &a.modal {
        Modal::Push(p) => p.stage.clone(),
        other => panic!("kein Push-Fenster: {other:?}"),
    }
}

fn log(a: &App) -> String {
    match &a.modal {
        Modal::Push(p) => p.log.text(),
        _ => String::new(),
    }
}

fn screen(a: &mut App) -> String {
    common::screen(a, 200, 40)
}

/// p, j: runs to the next question.
fn start_push(a: &mut App) {
    key(a, KeyCode::Char('p'));
    assert!(matches!(stage(a), PushStage::AskStart(_)), "{:?}", stage(a));
    key(a, KeyCode::Char('j'));
    run_until_question(a);
}

fn yes(a: &mut App) {
    key(a, KeyCode::Char('j'));
    run_until_question(a);
}

fn done_ok(a: &App) {
    assert_eq!(stage(a), PushStage::Done(true), "{}", log(a));
}

fn done_failed(a: &App) -> String {
    assert_eq!(stage(a), PushStage::Done(false), "{}", log(a));
    log(a)
}

fn staged(p: &Project) -> String {
    git(&p.root, &["diff", "--cached", "--name-only"])
}

#[test]
fn happy_path_pushes_only_the_vault() {
    let p = project();
    let start_salt = salt(&p.remote_vault());
    let mut a = p.app();
    add_card(&mut a, "Zebra", "Streifen");
    key(&mut a, KeyCode::Char('p'));
    let s = screen(&mut a);
    println!("{s}");
    assert!(s.contains("Deine Änderungen: +1 −0 ~0, davon 1 Liste(n) noch nicht versiegelt"), "{s}");
    key(&mut a, KeyCode::Char('j'));
    run_until_question(&mut a);
    let s = screen(&mut a);
    println!("{s}");
    let PushStage::AskPush(q) = stage(&a) else { panic!("{}", log(&a)) };
    assert_eq!(
        q,
        "Commit + Push von src/words/vault.json: Wörter 4+1, Gleich 2+1, Zeig 1+1, SLF 4/1/1. Von dir: +1 −0 ~0. Schlüssel unverändert. Pushen? (j/n)"
    );
    assert!(s.contains("✓ gestaged ist genau src/words/vault.json"));
    assert_eq!(staged(&p), VAULT);
    yes(&mut a);
    done_ok(&a);
    let (subject, files) = remote_head(&p);
    assert_eq!(subject, "Stapel aktualisiert (Wörter 4+1, Gleich 2+1, Zeig 1+1, SLF 4/1/1)");
    assert_eq!(files, vec![VAULT.to_string()]);
    let remote = p.remote_content(PASS);
    assert_eq!(remote, a.content);
    assert_eq!(find(&remote, "Zebra").unwrap().0, ListId::WordsNormal);
    assert_eq!(salt(&p.remote_vault()), start_salt, "same password: browsers stay unlocked");
    assert!(!p.remote_vault().contains("Zebra"));
    let all = git(&p.remote, &["ls-tree", "-r", "--name-only", "main"]);
    assert!(!all.contains("private"), "{all}");
    assert_eq!(git(&p.root, &["status", "--porcelain"]), "");
    assert!(!p.root.join("private").exists());
    // Pushed is the new base: nothing more to push, nothing unsealed.
    assert!(a.dirty_lists().is_empty() && !a.unpushed());
    key(&mut a, KeyCode::Enter);
    key(&mut a, KeyCode::Char('p'));
    assert!(log(&a).contains("nichts zu pushen"));
}

#[test]
fn declined_at_the_start_changes_nothing() {
    let p = project();
    let mut a = p.app();
    add_card(&mut a, "Zebra", "Streifen");
    key(&mut a, KeyCode::Char('p'));
    key(&mut a, KeyCode::Char('n'));
    assert!(matches!(a.modal, Modal::None));
    assert_eq!(git(&p.root, &["status", "--porcelain"]), "");
}

#[test]
fn declined_at_the_end_leaves_nothing_staged() {
    let p = project();
    let mut a = p.app();
    add_card(&mut a, "Zebra", "Streifen");
    start_push(&mut a);
    key(&mut a, KeyCode::Char('n'));
    let l = done_failed(&a);
    assert!(l.contains("Nicht gepusht.") && l.contains("versiegelt, aber nicht gestaged"), "{l}");
    assert_eq!(staged(&p), "");
    assert_eq!(git(&p.root, &["status", "--porcelain"]), format!("M {VAULT}"));
    assert_eq!(remote_head(&p).0, "Start");
    // Sealed, not pushed: the next run pushes it.
    assert!(a.unpushed() && a.dirty_lists().is_empty());
    key(&mut a, KeyCode::Enter);
    start_push(&mut a);
    yes(&mut a);
    done_ok(&a);
    assert!(find(&p.remote_content(PASS), "Zebra").is_some());
}

#[test]
fn concurrent_edits_are_merged() {
    let p = project();
    // Two people start from the same vault.
    let other_root = p.clone("zweiter");
    let mut b = App::open(&other_root, Some(&p.pass)).unwrap();
    let mut a = p.app();
    add_card(&mut a, "Zebra", "Streifen");
    start_push(&mut a);
    yes(&mut a);
    done_ok(&a);
    // B added something else meanwhile, and edited a card.
    key(&mut b, KeyCode::Char('2'));
    add_card(&mut b, "Yeti", "Schnee, Berg");
    key(&mut b, KeyCode::Char('1'));
    key(&mut b, KeyCode::Down);
    key(&mut b, KeyCode::Char('e'));
    key(&mut b, KeyCode::Tab);
    typ(&mut b, ", Pelz");
    key(&mut b, KeyCode::Enter);
    start_push(&mut b);
    let s = screen(&mut b);
    println!("{s}");
    assert_eq!(stage(&b), PushStage::Merge);
    assert!(s.contains("von dir: +1 −0 ~1, vom anderen: +1 −0 ~0, Konflikte: 0"), "{s}");
    assert!(s.contains("Enter übernimmt beide Seiten"));
    yes(&mut b);
    let PushStage::AskPush(q) = stage(&b) else { panic!("{}", log(&b)) };
    assert!(q.contains("Von dir: +1 −0 ~1, vom anderen übernommen: +1 −0 ~0."), "{q}");
    yes(&mut b);
    done_ok(&b);
    let remote = p.remote_content(PASS);
    assert_eq!(remote, b.content);
    assert!(find(&remote, "Zebra").is_some());
    assert_eq!(find(&remote, "Yeti").unwrap().0, ListId::WordsNsfw);
    assert_eq!(find(&remote, "Bär").unwrap().1.taboo, ["Tier", "Honig", "Wald", "Pelz"]);
    // B's main was fast-forwarded and then pushed: two vault commits on top of Start.
    assert_eq!(git(&other_root, &["rev-parse", "HEAD"]), git(&p.remote, &["rev-parse", "main"]));
    assert_eq!(git(&p.remote, &["rev-list", "--count", "main"]), "3");
    assert_eq!(git(&other_root, &["status", "--porcelain"]), "");
}

#[test]
fn only_the_other_side_changed_means_adopt_and_nothing_to_push() {
    let p = project();
    let mut a = p.app();
    // Changed and changed back: nothing of mine left.
    p.other_pushes(PASS, |c| c.entries_mut(ListId::SlfBild).push(Entry::text("Etwas Blaues")));
    add_card(&mut a, "Zebra", "Streifen");
    key(&mut a, KeyCode::Char('u'));
    key(&mut a, KeyCode::Char('p'));
    assert!(log(&a).contains("nichts zu pushen"), "no edit of mine: no fetch at all");
    key(&mut a, KeyCode::Enter);
    // An edit that the other side made the same way.
    key(&mut a, KeyCode::Char('8'));
    key(&mut a, KeyCode::Char('a'));
    typ(&mut a, "Etwas Blaues");
    key(&mut a, KeyCode::Enter);
    start_push(&mut a);
    assert_eq!(stage(&a), PushStage::Merge);
    yes(&mut a);
    done_ok(&a);
    assert!(log(&a).contains("nichts zu pushen"), "{}", log(&a));
    assert_eq!(remote_head(&p).0, "Stapel vom anderen");
    // Adopted: local main is at origin, the vault is origin's, nothing dirty.
    assert_eq!(git(&p.root, &["rev-parse", "HEAD"]), git(&p.remote, &["rev-parse", "main"]));
    assert_eq!(git(&p.root, &["status", "--porcelain"]), "");
    assert!(a.dirty_lists().is_empty() && !a.unpushed());
}

#[test]
fn a_conflict_is_settled_on_the_merge_screen() {
    let p = project();
    let mut a = p.app();
    p.other_pushes(PASS, |c| {
        c.entries_mut(ListId::WordsNormal)[1].taboo = vec!["Tier".into(), "Höhle".into()];
        c.entries_mut(ListId::GleichNormal).push(Entry::text("Etwas Kariertes"));
    });
    key(&mut a, KeyCode::Down);
    key(&mut a, KeyCode::Char('e'));
    key(&mut a, KeyCode::Tab);
    typ(&mut a, ", Pelz");
    key(&mut a, KeyCode::Enter);
    key(&mut a, KeyCode::Char('7'));
    key(&mut a, KeyCode::Char('a'));
    typ(&mut a, "Beruf");
    key(&mut a, KeyCode::Enter);
    start_push(&mut a);
    let s = screen(&mut a);
    println!("{s}");
    assert_eq!(stage(&a), PushStage::Merge);
    assert!(s.contains("von dir: +1 −0 ~1, vom anderen: +1 −0 ~1, Konflikte: 1"), "{s}");
    for want in ["Bär", "(beide geändert)", "Vorher", "Deine Version (←)", "Andere Version (→)", "Tier, Honig, Wald, Pelz", "Tier, Höhle"]
    {
        assert!(s.contains(want), "fehlt: {want}\n{s}");
    }
    assert!(s.contains("←/m meine Version") && s.contains("→/t andere Version"), "keys in the footer");
    // Enter with an open conflict: not yet.
    key(&mut a, KeyCode::Enter);
    assert_eq!(stage(&a), PushStage::Merge);
    assert!(screen(&mut a).contains("Noch 1 Konflikt(e) offen"));
    key(&mut a, KeyCode::Right);
    assert!(screen(&mut a).contains("✓ Wörter · Normal: Bär — Tier, Höhle"));
    key(&mut a, KeyCode::Left);
    assert!(screen(&mut a).contains("✓ Wörter · Normal: Bär — Tier, Honig, Wald, Pelz"));
    key(&mut a, KeyCode::Up);
    key(&mut a, KeyCode::Char('t'));
    yes(&mut a);
    let PushStage::AskPush(q) = stage(&a) else { panic!("{}", log(&a)) };
    assert!(q.contains("Konflikte: 1 entschieden"), "{q}");
    yes(&mut a);
    done_ok(&a);
    let remote = p.remote_content(PASS);
    assert_eq!(find(&remote, "Bär").unwrap().1, card("Bär", &["Tier", "Höhle"]));
    assert!(find(&remote, "Beruf").is_some() && find(&remote, "Etwas Kariertes").is_some());
}

#[test]
fn moves_to_different_lists_conflict_and_mine_wins() {
    let p = project();
    let mut a = p.app();
    p.other_pushes(PASS, |c| {
        c.move_entry(ListId::SlfText, 3, ListId::SlfBild);
    });
    key(&mut a, KeyCode::Char('7'));
    key(&mut a, KeyCode::End);
    key(&mut a, KeyCode::Char('m'));
    key(&mut a, KeyCode::Char('2'));
    assert_eq!(find(&a.content, "Tier").unwrap().0, ListId::SlfNsfw);
    start_push(&mut a);
    let s = screen(&mut a);
    assert!(s.contains("(beide verschoben)"), "{s}");
    assert!(s.contains("Stadt Land Fluss · NSFW: Tier") && s.contains("Stadt Land Fluss · Bilder: Tier"), "{s}");
    key(&mut a, KeyCode::Char('m'));
    yes(&mut a);
    yes(&mut a);
    done_ok(&a);
    assert_eq!(find(&p.remote_content(PASS), "Tier").unwrap().0, ListId::SlfNsfw);
}

#[test]
fn an_invalid_merge_blocks_the_push_and_stays_in_memory() {
    let p = project();
    let mut a = p.app();
    // The other moves the only NSFW card to Normal and adds Yeti to NSFW.
    p.other_pushes(PASS, |c| {
        c.move_entry(ListId::WordsNsfw, 0, ListId::WordsNormal);
        c.entries_mut(ListId::WordsNsfw).push(card("Yeti", &["Schnee"]));
    });
    // I add yeti to Normal: a conflict; keeping mine leaves NSFW empty.
    add_card(&mut a, "yeti", "Berg");
    start_push(&mut a);
    key(&mut a, KeyCode::Left);
    yes(&mut a);
    let l = done_failed(&a);
    assert!(l.contains("Wörter · NSFW: keine Einträge") && l.contains("verletzt 1 Regel(n)"), "{l}");
    assert_eq!(remote_head(&p).0, "Stapel vom anderen");
    assert_eq!(git(&p.root, &["status", "--porcelain"]), "", "git untouched");
    // The merged state is here to be fixed; then the push goes through without another merge.
    key(&mut a, KeyCode::Enter);
    assert_eq!(a.report.total(), 1);
    assert_eq!(find(&a.content, "Kobold").unwrap().0, ListId::WordsNormal);
    key(&mut a, KeyCode::Char('2'));
    add_card(&mut a, "Troll", "Brücke");
    start_push(&mut a);
    assert!(matches!(stage(&a), PushStage::AskPush(_)), "{}", log(&a));
    yes(&mut a);
    done_ok(&a);
    let remote = p.remote_content(PASS);
    assert_eq!(find(&remote, "yeti").unwrap().0, ListId::WordsNormal);
    assert_eq!(find(&remote, "Troll").unwrap().0, ListId::WordsNsfw);
    assert!(find(&remote, "Yeti").is_none());
}

#[test]
fn esc_on_the_merge_screen_changes_nothing() {
    let p = project();
    let mut a = p.app();
    p.other_pushes(PASS, |c| c.entries_mut(ListId::SlfBild).push(Entry::text("Etwas Blaues")));
    add_card(&mut a, "Zebra", "Streifen");
    start_push(&mut a);
    key(&mut a, KeyCode::Esc);
    assert!(done_failed(&a).contains("Zusammenführen abgebrochen"));
    assert_eq!(git(&p.root, &["status", "--porcelain"]), "");
    assert_eq!(git(&p.root, &["rev-list", "--count", "HEAD"]), "1", "not fast-forwarded");
    assert!(find(&a.content, "Zebra").is_some() && find(&a.content, "Etwas Blaues").is_none());
}

#[test]
fn a_rejected_push_is_merged_again_once() {
    let p = project();
    let mut a = p.app();
    add_card(&mut a, "Zebra", "Streifen");
    start_push(&mut a);
    assert!(matches!(stage(&a), PushStage::AskPush(_)));
    // Someone pushes between our fetch and our push.
    p.other_pushes(PASS, |c| c.entries_mut(ListId::SlfBild).push(Entry::text("Etwas Blaues")));
    yes(&mut a);
    assert_eq!(stage(&a), PushStage::Merge, "{}", log(&a));
    assert!(log(&a).contains("Abgelehnt: jemand hat inzwischen gepusht"));
    yes(&mut a);
    yes(&mut a);
    done_ok(&a);
    let remote = p.remote_content(PASS);
    assert!(find(&remote, "Zebra").is_some() && find(&remote, "Etwas Blaues").is_some());
    assert_eq!(git(&p.root, &["status", "--porcelain"]), "");
}

#[test]
fn rejected_twice_gives_up_with_a_message() {
    let p = project();
    let mut a = p.app();
    add_card(&mut a, "Zebra", "Streifen");
    start_push(&mut a);
    p.other_pushes(PASS, |c| c.entries_mut(ListId::SlfBild).push(Entry::text("Etwas Blaues")));
    yes(&mut a);
    yes(&mut a);
    assert!(matches!(stage(&a), PushStage::AskPush(_)), "{}", log(&a));
    p.other_pushes(PASS, |c| c.entries_mut(ListId::SlfBild).push(Entry::text("Etwas Grünes")));
    yes(&mut a);
    let l = done_failed(&a);
    assert!(l.contains("Wieder abgelehnt") && l.contains("Später nochmal p"), "{l}");
    // No local commit left behind, nothing staged; the merged state is sealed in the working tree.
    assert_eq!(staged(&p), "");
    assert_eq!(git(&p.root, &["rev-list", "--count", "@{u}..HEAD"]), "0");
    assert_eq!(git(&p.root, &["status", "--porcelain"]), format!("M {VAULT}"));
    assert_eq!(common::open_text(&fs::read_to_string(p.root.join(VAULT)).unwrap(), PASS), a.content);
    // Later it works.
    key(&mut a, KeyCode::Enter);
    start_push(&mut a);
    yes(&mut a);
    yes(&mut a);
    done_ok(&a);
    let remote = p.remote_content(PASS);
    for w in ["Zebra", "Etwas Blaues", "Etwas Grünes"] {
        assert!(find(&remote, w).is_some(), "{w}");
    }
}

#[test]
fn a_changed_password_is_asked_for() {
    let p = project();
    let mut a = p.app();
    p.other_pushes(OTHER_PASS, |c| c.entries_mut(ListId::SlfBild).push(Entry::text("Etwas Blaues")));
    let new_salt = salt(&p.remote_vault());
    add_card(&mut a, "Zebra", "Streifen");
    start_push(&mut a);
    assert_eq!(stage(&a), PushStage::AskPassword, "{}", log(&a));
    let s = screen(&mut a);
    println!("{s}");
    assert!(s.contains("das Passwort wurde wohl geändert") && s.contains("Neues Stapel-Passwort"));
    typ(&mut a, "immer-noch-falsch");
    assert!(!screen(&mut a).contains("immer-noch-falsch"));
    key(&mut a, KeyCode::Enter);
    run_until_question(&mut a);
    assert_eq!(stage(&a), PushStage::AskPassword);
    assert!(screen(&mut a).contains("Passwort falsch."));
    typ(&mut a, OTHER_PASS);
    key(&mut a, KeyCode::Enter);
    run_until_question(&mut a);
    assert_eq!(stage(&a), PushStage::Merge, "{}", log(&a));
    yes(&mut a);
    let PushStage::AskPush(q) = stage(&a) else { panic!("{}", log(&a)) };
    assert!(q.contains("Schlüssel unverändert"), "{q}");
    yes(&mut a);
    done_ok(&a);
    assert_eq!(salt(&p.remote_vault()), new_salt, "the new password's salt stays");
    let remote = p.remote_content(OTHER_PASS);
    assert!(find(&remote, "Zebra").is_some() && find(&remote, "Etwas Blaues").is_some());
}

#[test]
fn esc_at_the_new_password_aborts() {
    let p = project();
    let mut a = p.app();
    p.other_pushes(OTHER_PASS, |c| c.entries_mut(ListId::SlfBild).push(Entry::text("Etwas Blaues")));
    add_card(&mut a, "Zebra", "Streifen");
    start_push(&mut a);
    key(&mut a, KeyCode::Esc);
    assert!(done_failed(&a).contains("ohne das neue Passwort"));
    assert_eq!(git(&p.root, &["status", "--porcelain"]), "");
}

#[test]
fn a_sealed_but_unpushed_vault_survives_a_fast_forward() {
    let p = project();
    let mut a = p.app();
    add_card(&mut a, "Zebra", "Streifen");
    key(&mut a, KeyCode::Char('s'));
    key(&mut a, KeyCode::Char('j'));
    assert_eq!(git(&p.root, &["status", "--porcelain"]), format!("M {VAULT}"));
    p.other_pushes(PASS, |c| c.entries_mut(ListId::SlfBild).push(Entry::text("Etwas Blaues")));
    // Restarting keeps the sealed edit, with HEAD as the merge base.
    drop(a);
    let mut a = p.app();
    assert!(find(&a.content, "Zebra").is_some() && a.unpushed());
    start_push(&mut a);
    yes(&mut a);
    yes(&mut a);
    done_ok(&a);
    let remote = p.remote_content(PASS);
    assert!(find(&remote, "Zebra").is_some() && find(&remote, "Etwas Blaues").is_some());
}

#[test]
fn fast_forward_blocked_by_local_changes_restores_the_vault() {
    let p = project();
    let mut a = p.app();
    add_card(&mut a, "Zebra", "Streifen");
    key(&mut a, KeyCode::Char('s'));
    key(&mut a, KeyCode::Char('j'));
    let sealed = fs::read_to_string(p.root.join(VAULT)).unwrap();
    // The other changes README.md too; mine has an uncommitted edit of it.
    let dir = p.clone("readme");
    fs::write(dir.join("README.md"), "von woanders\n").unwrap();
    git(&dir, &["commit", "-q", "-am", "README"]);
    git(&dir, &["push", "-q"]);
    p.other_pushes(PASS, |c| c.entries_mut(ListId::SlfBild).push(Entry::text("Etwas Blaues")));
    fs::write(p.root.join("README.md"), "lokal, nicht committet\n").unwrap();
    start_push(&mut a);
    yes(&mut a);
    let l = done_failed(&a);
    assert!(l.contains("lässt sich nicht auf origin/main vorspulen"), "{l}");
    assert_eq!(fs::read_to_string(p.root.join(VAULT)).unwrap(), sealed, "my sealed vault is back");
    assert_eq!(fs::read_to_string(p.root.join("README.md")).unwrap(), "lokal, nicht committet\n");
    assert_eq!(git(&p.root, &["rev-list", "--count", "HEAD"]), "1");
    assert_eq!(staged(&p), "");
}

fn refused(p: &Project, want: &str) {
    let mut a = p.app();
    add_card(&mut a, "Zebra", "Streifen");
    start_push(&mut a);
    let l = done_failed(&a);
    assert!(l.contains(want), "{want}\n{l}");
    assert_eq!(remote_head(p).0, "Start");
}

#[test]
fn refuses_when_something_else_is_staged() {
    let p = project();
    fs::write(p.root.join("README.md"), "geändert\n").unwrap();
    git(&p.root, &["add", "README.md"]);
    refused(&p, "Es ist schon etwas gestaged (README.md)");
    // The user's staging is left alone.
    assert_eq!(staged(&p), "README.md");
}

#[test]
fn refuses_when_private_is_tracked() {
    let p = project();
    fs::create_dir_all(p.root.join("private/content")).unwrap();
    fs::write(p.root.join("private/content/slf-bild.txt"), "Etwas mit Zacken\n").unwrap();
    git(&p.root, &["add", "-f", "private/content/slf-bild.txt"]);
    refused(&p, "Dateien aus private/ sind in git");
}

#[test]
fn refuses_when_private_is_not_ignored() {
    let p = project();
    fs::write(p.root.join(".gitignore"), "node_modules/\n").unwrap();
    refused(&p, "nicht per .gitignore");
}

#[test]
fn refuses_on_another_branch() {
    let p = project();
    git(&p.root, &["switch", "-q", "-c", "test"]);
    refused(&p, "„test“");
}

#[test]
fn refuses_with_unpushed_local_commits() {
    let p = project();
    fs::write(p.root.join("README.md"), "lokal\n").unwrap();
    git(&p.root, &["commit", "-q", "-am", "lokal"]);
    refused(&p, "lokale(n) Commit(s)");
}

#[test]
fn refuses_without_upstream() {
    let p = project();
    git(&p.root, &["branch", "--unset-upstream"]);
    refused(&p, "keinen Upstream");
}

#[test]
fn refuses_a_remote_vault_with_plaintext_fields() {
    let p = project();
    let dir = p.clone("kaputt");
    fs::write(dir.join(VAULT), r#"{"format":"ukhdk-vault","v":1,"words":{"normal":[["Apfel","Obst"]]}}"#).unwrap();
    git(&dir, &["commit", "-q", "-am", "kaputt"]);
    git(&dir, &["push", "-q"]);
    let mut a = p.app();
    add_card(&mut a, "Zebra", "Streifen");
    start_push(&mut a);
    assert!(done_failed(&a).contains("nicht wie ein versiegelter Tresor"));
}

#[test]
fn refuses_when_the_vault_changed_outside() {
    let p = project();
    let mut a = p.app();
    add_card(&mut a, "Zebra", "Streifen");
    fs::write(p.root.join(VAULT), common::seal(&fixture(), PASS, None)).unwrap();
    start_push(&mut a);
    assert!(done_failed(&a).contains("wurde außerhalb geändert"));
}

#[test]
fn failed_push_keeps_the_commit_and_says_how_to_continue() {
    let p = project();
    let mut a = p.app();
    add_card(&mut a, "Zebra", "Streifen");
    start_push(&mut a);
    // Origin disappears between the checks and the push.
    fs::rename(&p.remote, p.tmp.0.join("weg.git")).unwrap();
    yes(&mut a);
    let l = done_failed(&a);
    assert!(l.contains("git push ist fehlgeschlagen") && l.contains("git reset --soft HEAD~1"), "{l}");
    assert_eq!(staged(&p), "");
    assert_eq!(git(&p.root, &["log", "-1", "--format=%s"]), "Stapel aktualisiert (Wörter 4+1, Gleich 2+1, Zeig 1+1, SLF 4/1/1)");
}
