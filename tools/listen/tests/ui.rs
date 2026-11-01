//! The screens on ratatui's TestBackend, driven by key events like a user. Run with `--nocapture` to
//! see the screens as text.

mod common;

use std::fs;

use common::{
    add_card, card, content_only, content_only_with, ctrl, find, fixture, key, open_text, pass_file, project, run_until_question, salt,
    typ, PASS,
};
use crossterm::event::{Event, KeyCode, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use ratatui::backend::TestBackend;
use ratatui::Terminal;
use ukhdk_listen::app::{App, Modal};
use ukhdk_listen::content::{Entry, ListId};
use ukhdk_listen::ui;
use ukhdk_listen::vault::VAULT;

const W: u16 = 110;
const H: u16 = 30;

fn screen(app: &mut App) -> String {
    common::screen(app, W, H)
}

fn show(name: &str, s: &str) {
    println!("===== {name} =====\n{s}");
}

fn app() -> (common::TempDir, std::path::PathBuf, App) {
    let (tmp, root, pass) = content_only();
    let app = App::open(&root, Some(&pass)).unwrap();
    (tmp, root, app)
}

#[test]
fn main_screen() {
    let (_t, _r, mut a) = app();
    assert!(!a.locked());
    let s = screen(&mut a);
    show("Hauptansicht", &s);
    for want in [
        "Listen",
        "Wörter · Normal · 3 Einträge",
        "Begriff",
        "Verbotene Wörter",
        "Kaffeeküche",
        "Tasse, Pause, Büro",
        "Gleich gedacht",
        "Stadt Land Fluss",
        "✓ alles gültig",
        "a neu",
        "s versiegeln",
        "p pushen",
    ] {
        assert!(s.contains(want), "fehlt: {want}");
    }
}

#[test]
fn a_missing_vault_is_a_plain_error() {
    let tmp = common::TempDir::new("leer");
    let e = App::open(&tmp.0, None).err().unwrap().to_string();
    assert!(e.contains("Kein Tresor") && e.contains("--root"), "{e}");
}

#[test]
fn password_prompt_without_a_file() {
    let (t, root, _) = content_only();
    let mut a = App::open(&root, Some(&t.0.join("gibt-es-nicht"))).unwrap();
    assert!(a.locked());
    let s = screen(&mut a);
    show("Passwort", &s);
    assert!(s.contains("Stapel entsperren") && s.contains("Passwort für src/words/vault.json"));
    assert!(s.contains("Enter entsperren") && s.contains("Esc beenden"));
    // Nothing of the decks shows while locked.
    assert!(!s.contains("Kaffeeküche"));
    typ(&mut a, "falsch-falsch");
    let s = screen(&mut a);
    assert!(s.contains("•••••••••••••") && !s.contains("falsch-falsch"), "no echo of the password");
    key(&mut a, KeyCode::Enter);
    assert!(screen(&mut a).contains("Prüfe"));
    run_until_question(&mut a);
    let s = screen(&mut a);
    show("Passwort falsch", &s);
    assert!(s.contains("Passwort falsch."));
    assert!(a.locked());
    // Pasting works too; Enter opens.
    a.handle_event(Event::Paste(format!("{PASS}\n")));
    key(&mut a, KeyCode::Enter);
    run_until_question(&mut a);
    assert!(!a.locked());
    assert!(matches!(a.modal, Modal::None));
    assert_eq!(a.content, fixture());
    assert!(screen(&mut a).contains("Kaffeeküche"));
}

#[test]
fn esc_at_the_password_prompt_quits() {
    let (_t, root, _) = content_only();
    let mut a = App::open(&root, None).unwrap();
    key(&mut a, KeyCode::Esc);
    assert!(a.quit);
    let mut a = App::open(&root, None).unwrap();
    ctrl(&mut a, 'c');
    assert!(a.quit);
}

#[test]
fn a_password_file_that_does_not_fit_falls_back_to_the_prompt() {
    let (t, root, _) = content_only();
    let other = t.0.join("anders");
    fs::create_dir_all(&other).unwrap();
    let wrong = pass_file(&other, "nicht-das-passwort");
    let mut a = App::open(&root, Some(&wrong)).unwrap();
    assert!(a.locked());
    let s = screen(&mut a);
    assert!(s.contains("Das Passwort aus der Passwortdatei öffnet den Tresor nicht"), "{s}");
    let short = t.0.join("kurz");
    fs::write(&short, "kurz\n").unwrap();
    let mut a = App::open(&root, Some(&short)).unwrap();
    assert!(a.locked());
    assert!(screen(&mut a).contains("kürzer als 8 Zeichen"));
}

#[test]
fn problems_are_marked_with_the_reason() {
    let mut c = fixture();
    c.entries_mut(ListId::WordsNsfw).push(card("apfel", &["Sünde"]));
    c.entries_mut(ListId::WordsNsfw).push(Entry::card("Kaputt", vec![]));
    c.entries_mut(ListId::SlfText).retain(|e| e.text != "Fluss");
    let (_t, root, pass) = content_only_with(&c);
    let mut a = App::open(&root, Some(&pass)).unwrap();
    key(&mut a, KeyCode::Char('2'));
    let s = screen(&mut a);
    show("Probleme", &s);
    assert!(s.contains("Problem"));
    assert!(s.contains("doppelt, schon in Wörter · Normal, Nr. 1"));
    assert!(s.contains("1 bis 8 verbotene Wörter"));
    assert!(s.contains("⚠ 3 Probleme"));
    key(&mut a, KeyCode::Char('7'));
    assert!(screen(&mut a).contains("„Fluss“ fehlt"));
    // Sealing and pushing are refused while there are problems.
    key(&mut a, KeyCode::Char('a'));
    typ(&mut a, "Beruf");
    key(&mut a, KeyCode::Enter);
    key(&mut a, KeyCode::Char('s'));
    assert!(matches!(a.modal, Modal::None));
    assert!(screen(&mut a).contains("Erst die 3 Probleme beheben"));
    key(&mut a, KeyCode::Char('p'));
    assert!(matches!(a.modal, Modal::None));
    assert!(screen(&mut a).contains("Erst die 3 Probleme beheben"));
}

#[test]
fn edit_form_and_duplicate_check() {
    let (_t, _r, mut a) = app();
    key(&mut a, KeyCode::Down);
    key(&mut a, KeyCode::Char('e'));
    let s = screen(&mut a);
    show("Bearbeiten", &s);
    assert!(s.contains("Wortkarte bearbeiten · Wörter · Normal"));
    assert!(s.contains("Verbotene Wörter, mit Komma getrennt (1 bis 8)"));
    assert!(s.contains("Bär"));
    // Rename to an existing term: refused with the reason.
    ctrl(&mut a, 'u');
    typ(&mut a, "apfel");
    key(&mut a, KeyCode::Enter);
    assert!(matches!(a.modal, Modal::Form(_)));
    assert!(screen(&mut a).contains("doppelt, schon Nr. 1"));
    ctrl(&mut a, 'u');
    typ(&mut a, "Braunbär");
    key(&mut a, KeyCode::Tab);
    typ(&mut a, ", Grizzly");
    key(&mut a, KeyCode::Enter);
    assert!(matches!(a.modal, Modal::None));
    let e = &a.content.entries(ListId::WordsNormal)[1];
    assert_eq!(e.text, "Braunbär");
    assert_eq!(e.taboo, vec!["Tier", "Honig", "Wald", "Grizzly"]);
    assert!(a.is_dirty(ListId::WordsNormal));
    let s = screen(&mut a);
    assert!(s.contains("Normal     3 ●"));
    assert!(s.contains("1 Liste nicht versiegelt"));
}

#[test]
fn add_text_entry_strips_the_zeig_frame() {
    let (_t, _r, mut a) = app();
    key(&mut a, KeyCode::Char('5'));
    key(&mut a, KeyCode::Char('a'));
    show("Neu (Zeig drauf)", &screen(&mut a));
    typ(&mut a, "Wer würde am ehesten zu spät kommen?");
    key(&mut a, KeyCode::Enter);
    assert_eq!(a.content.entries(ListId::ZeigNormal)[1].text, "zu spät kommen");
}

#[test]
fn delete_undo_move_filter() {
    let (_t, _r, mut a) = app();
    key(&mut a, KeyCode::Char('d'));
    let s = screen(&mut a);
    show("Löschen", &s);
    assert!(s.contains("„Apfel“ aus Wörter · Normal löschen?"));
    key(&mut a, KeyCode::Char('j'));
    assert_eq!(a.content.count(ListId::WordsNormal), 2);
    key(&mut a, KeyCode::Char('u'));
    assert_eq!(a.content.count(ListId::WordsNormal), 3);
    assert!(!a.is_dirty(ListId::WordsNormal));
    // m: Normal -> NSFW directly (only one other list).
    key(&mut a, KeyCode::Char('m'));
    assert_eq!(a.content.count(ListId::WordsNsfw), 2);
    assert_eq!(a.content.entries(ListId::WordsNsfw)[1].text, "Apfel");
    // SLF has three lists: a chooser.
    key(&mut a, KeyCode::Char('7'));
    key(&mut a, KeyCode::End);
    key(&mut a, KeyCode::Char('m'));
    show("Verschieben", &screen(&mut a));
    key(&mut a, KeyCode::Char('2'));
    assert_eq!(a.content.entries(ListId::SlfNsfw).last().unwrap().text, "Tier");
    // Filter.
    key(&mut a, KeyCode::Char('1'));
    key(&mut a, KeyCode::Char('/'));
    typ(&mut a, "büro");
    let s = screen(&mut a);
    show("Filter", &s);
    assert!(s.contains("Filter „büro“: 1"));
    assert!(s.contains("Kaffeeküche") && !s.contains("Bär "));
    key(&mut a, KeyCode::Esc);
    assert!(a.filter.value.is_empty());
}

#[test]
fn import_preview_and_apply() {
    let (_t, _r, mut a) = app();
    let export = r#"{"ukhdkList":1,"kind":"words","name":"Büro-Insider","items":[
        {"id":"c:1","text":"Lochstanzer","taboo":["Papier","Loch"]},
        {"id":"c:2","text":"apfel","taboo":["grün"]},
        {"id":"c:3","text":"Kobold","taboo":["Zwerg"]},
        {"id":"c:4","text":"Montag","taboo":[]}]}"#;
    a.handle_event(Event::Paste(export.into()));
    show("Import (eingefügt)", &screen(&mut a));
    ctrl(&mut a, 's');
    let s = screen(&mut a);
    show("Import-Vorschau", &s);
    assert!(s.contains("Import-Vorschau"));
    assert!(s.contains("◀ Wörter · Normal ▶"));
    assert!(s.contains("1 neu · 2 doppelt · 1 ungültig"));
    assert!(s.contains("doppelt, schon in Wörter · NSFW, Nr. 1"));
    assert!(s.contains("1 bis 8 verbotene Wörter"));
    assert!(s.contains("Liste „Büro-Insider“"));
    key(&mut a, KeyCode::Right);
    assert!(screen(&mut a).contains("◀ Wörter · NSFW ▶"));
    key(&mut a, KeyCode::Left);
    key(&mut a, KeyCode::Enter);
    assert!(matches!(a.modal, Modal::None));
    assert_eq!(a.content.entries(ListId::WordsNormal).last().unwrap().text, "Lochstanzer");
    // Plain lines from a file, into the current text list.
    key(&mut a, KeyCode::Char('3'));
    let file = _t.0.join("fragen.txt");
    fs::write(&file, "# aus dem Chat\nEtwas Gelbes\nein tier mit vier beinen\n").unwrap();
    key(&mut a, KeyCode::Char('i'));
    key(&mut a, KeyCode::Tab);
    typ(&mut a, file.to_str().unwrap());
    key(&mut a, KeyCode::Enter);
    let s = screen(&mut a);
    assert!(s.contains("◀ Gleich gedacht · Normal ▶") && s.contains("1 neu · 1 doppelt · 0 ungültig"), "{s}");
    key(&mut a, KeyCode::Char('j'));
    assert_eq!(a.content.count(ListId::GleichNormal), 3);
}

#[test]
fn seal_writes_the_vault_and_nothing_else() {
    let (t, root, mut a) = app();
    let before = fs::read_to_string(root.join(VAULT)).unwrap();
    add_card(&mut a, "Zebra", "Streifen, Pferd");
    key(&mut a, KeyCode::Char('s'));
    let s = screen(&mut a);
    show("Versiegeln?", &s);
    assert!(s.contains("Versiegeln nach src/words/vault.json (nur im Arbeitsordner, kein Commit)"));
    assert!(s.contains("Wörter · Normal") && s.contains("3 → 4 Einträge"));
    key(&mut a, KeyCode::Char('j'));
    assert!(screen(&mut a).contains("Versiegelt: src/words/vault.json (nicht committet)"));
    assert!(a.dirty_lists().is_empty());
    let after = fs::read_to_string(root.join(VAULT)).unwrap();
    assert_eq!(salt(&after), salt(&before), "same password: same salt, remembered keys keep working");
    let c = open_text(&after, PASS);
    assert_eq!(find(&c, "Zebra").unwrap(), (ListId::WordsNormal, card("Zebra", &["Streifen", "Pferd"])));
    // Only the vault: no plaintext, no temp files.
    assert!(!root.join("private").exists());
    assert_eq!(fs::read_dir(root.join("src/words")).unwrap().count(), 1);
    assert!(!after.contains("Zebra"));
    // A fresh start sees it.
    let mut b = App::open(&root, Some(&common::pass_file(&t.0, PASS))).unwrap();
    assert_eq!(b.content, c);
    key(&mut b, KeyCode::Char('s'));
    assert!(screen(&mut b).contains("Nichts zu versiegeln"));
}

#[test]
fn seal_refuses_when_the_vault_changed_outside() {
    let (_t, root, mut a) = app();
    key(&mut a, KeyCode::Char('d'));
    key(&mut a, KeyCode::Char('j'));
    let foreign = common::seal(&fixture(), PASS, None);
    fs::write(root.join(VAULT), &foreign).unwrap();
    key(&mut a, KeyCode::Char('s'));
    key(&mut a, KeyCode::Char('j'));
    assert!(screen(&mut a).contains("wurde außerhalb geändert"));
    assert_eq!(fs::read_to_string(root.join(VAULT)).unwrap(), foreign);
}

#[test]
fn quit_warns_about_unsealed_changes() {
    let (_t, _r, mut a) = app();
    key(&mut a, KeyCode::Char('q'));
    assert!(a.quit);
    let (_t, _r, mut a) = app();
    key(&mut a, KeyCode::Char('d'));
    key(&mut a, KeyCode::Char('j'));
    key(&mut a, KeyCode::Char('q'));
    let s = screen(&mut a);
    show("Beenden?", &s);
    assert!(s.contains("Nicht versiegelte Änderungen in 1 Liste(n)"));
    assert!(s.contains("Wörter · Normal"));
    key(&mut a, KeyCode::Char('n'));
    assert!(!a.quit);
    // After sealing, quitting needs no question.
    key(&mut a, KeyCode::Char('s'));
    key(&mut a, KeyCode::Char('j'));
    key(&mut a, KeyCode::Char('q'));
    assert!(a.quit);
}

#[test]
fn reload_reads_the_vault_again() {
    let (_t, root, mut a) = app();
    let mut c = fixture();
    c.entries_mut(ListId::SlfBild).push(Entry::text("Etwas Blaues"));
    fs::write(root.join(VAULT), common::seal(&c, PASS, Some(&fs::read_to_string(root.join(VAULT)).unwrap()))).unwrap();
    key(&mut a, KeyCode::Char('r'));
    assert_eq!(a.content, c);
    assert!(screen(&mut a).contains("Neu geladen"));
    // A vault with another password (e.g. after a git pull): ask for the new one.
    fs::write(root.join(VAULT), common::seal(&c, common::OTHER_PASS, None)).unwrap();
    key(&mut a, KeyCode::Char('r'));
    assert!(a.locked());
    assert!(screen(&mut a).contains("bisherigen Passwort nicht mehr auf"));
    typ(&mut a, common::OTHER_PASS);
    key(&mut a, KeyCode::Enter);
    run_until_question(&mut a);
    assert!(!a.locked());
    assert_eq!(a.content, c);
}

#[test]
fn export_writes_plaintext_only_into_ignored_private() {
    let p = project();
    let mut a = p.app();
    add_card(&mut a, "Zebra", "Streifen");
    key(&mut a, KeyCode::Char('x'));
    let s = screen(&mut a);
    show("Export?", &s);
    assert!(s.contains("Klartext-Kopie") && s.contains("private/content/"));
    key(&mut a, KeyCode::Char('j'));
    assert!(screen(&mut a).contains("9 Klartext-Dateien"));
    let dir = p.root.join("private/content");
    let words = fs::read_to_string(dir.join("woerter-normal.txt")).unwrap();
    assert!(words.starts_with("# Wörter · Normal – exportiert"));
    assert!(words.ends_with("Kaffeeküche: Tasse, Pause, Büro\nZebra: Streifen\n"));
    let mut back = ukhdk_listen::content::Content::empty();
    for id in ListId::ALL {
        back.lists[id.index()] = common::parse_file(id.kind(), &fs::read_to_string(dir.join(id.file_name())).unwrap());
    }
    assert_eq!(back, a.content);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(fs::metadata(dir.join("slf-text.txt")).unwrap().permissions().mode() & 0o777, 0o600);
    }
    assert_eq!(common::git(&p.root, &["status", "--porcelain"]), "", "nothing for git to see");
    // Not ignored (or no git): no export.
    let (_t, root, mut b) = app();
    key(&mut b, KeyCode::Char('x'));
    assert!(matches!(b.modal, Modal::None));
    assert!(screen(&mut b).contains("Kein Export"));
    assert!(!root.join("private").exists());
}

#[test]
fn help_and_mouse() {
    let (_t, _r, mut a) = app();
    key(&mut a, KeyCode::Char('?'));
    let s = screen(&mut a);
    show("Hilfe", &s);
    assert!(s.contains("mit origin abgleichen, zusammenführen, pushen (fragt 2×)"));
    assert!(s.contains("Klartext-Backup nach private/content/"));
    key(&mut a, KeyCode::Char('x'));
    assert!(matches!(a.modal, Modal::None));
    screen(&mut a);
    let (y, _) = *a.hits.list_rows.iter().find(|(_, id)| *id == ListId::ZeigNsfw).unwrap();
    a.handle_event(Event::Mouse(MouseEvent {
        kind: MouseEventKind::Down(MouseButton::Left),
        column: 5,
        row: y,
        modifiers: KeyModifiers::NONE,
    }));
    assert_eq!(a.current, ListId::ZeigNsfw);
    a.handle_event(Event::Mouse(MouseEvent { kind: MouseEventKind::ScrollDown, column: 5, row: y, modifiers: KeyModifiers::NONE }));
    assert_eq!(a.current, ListId::SlfText);
    screen(&mut a);
    let top = a.hits.table_top;
    a.handle_event(Event::Mouse(MouseEvent {
        kind: MouseEventKind::Down(MouseButton::Left),
        column: 40,
        row: top + 2,
        modifiers: KeyModifiers::NONE,
    }));
    assert_eq!(a.selected(), Some(2));
}

#[test]
fn small_terminals_do_not_break() {
    let (_t, root, mut a) = app();
    for (w, h) in [(80, 24), (50, 12), (20, 6)] {
        let draw = |a: &mut App| {
            let mut t = Terminal::new(TestBackend::new(w, h)).unwrap();
            t.draw(|f| ui::draw(f, a)).unwrap();
        };
        draw(&mut a);
        key(&mut a, KeyCode::Char('e'));
        draw(&mut a);
        key(&mut a, KeyCode::Esc);
        key(&mut a, KeyCode::Char('?'));
        draw(&mut a);
        key(&mut a, KeyCode::Esc);
        key(&mut a, KeyCode::Char('i'));
        typ(&mut a, "x");
        draw(&mut a);
        ctrl(&mut a, 's');
        draw(&mut a);
        key(&mut a, KeyCode::Esc);
        key(&mut a, KeyCode::Esc);
        key(&mut a, KeyCode::Char('/'));
        typ(&mut a, "a");
        draw(&mut a);
        key(&mut a, KeyCode::Esc);
        let mut locked = App::open(&root, None).unwrap();
        typ(&mut locked, "abc");
        draw(&mut locked);
    }
}

#[test]
fn wrap_keeps_words_and_cuts_long_ones() {
    assert_eq!(ui::wrap("eins zwei drei", 9), vec!["eins zwei", "drei"]);
    assert_eq!(ui::wrap("ÄÖÜäöüß", 3), vec!["ÄÖÜ", "äöü", "ß"]);
    assert_eq!(ui::wrap("", 5), vec![""]);
}

#[test]
fn push_without_changes_has_nothing_to_do() {
    let p = project();
    let mut a = p.app();
    key(&mut a, KeyCode::Char('p'));
    let s = screen(&mut a);
    show("Push: nichts zu tun", &s);
    assert!(s.contains("nichts zu pushen"));
    assert!(matches!(&a.modal, Modal::Push(x) if x.stage == ukhdk_listen::app::PushStage::Done(true)));
    assert_eq!(remote_subject(&p), "Start");
}

fn remote_subject(p: &common::Project) -> String {
    common::remote_head(p).0
}
