//! Importing what the browser exports under "Eigene Listen" (src/words/lists.ts), or plain lines.
//!
//! Accepted, like `parseImport` in lists.ts: a per-list export `{ukhdkList, kind, name, items}`, the
//! old word list `{ukhdkWords, cards}`, a plain JSON array, or one entry per line (word cards as
//! `Wort: verboten, verboten`). Unlike the browser, entries that break a rule are not dropped
//! silently but shown as "ungültig" in the preview.

use std::collections::HashSet;

use serde_json::Value;

use crate::content::{split_taboo, Content, Entry, Kind, ListId};
use crate::validate::{check_entry, dup_msg, find_duplicate, norm};

/// The browser's list kinds (`LIST_KINDS` in lists.ts) and the files they go to.
pub fn kind_from_browser(s: &str) -> Option<Kind> {
    match s {
        "words" => Some(Kind::Words),
        "zeig" => Some(Kind::Zeig),
        "fragen" => Some(Kind::Gleich),
        "kategorien" => Some(Kind::Slf),
        _ => None,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Parsed {
    /// Set when the text says what it is (export with `kind`, or the old word list).
    pub kind: Option<Kind>,
    /// The list name from an export.
    pub name: Option<String>,
    pub items: Vec<Entry>,
    /// Entries of the JSON that were not text at all.
    pub skipped: usize,
}

/// `squeeze` in lists.ts: control characters to spaces, blanks collapsed, trimmed.
pub fn squeeze(s: &str) -> String {
    s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `cleanEntry` in lists.ts for "Zeig drauf": people paste whole questions, the game adds
/// "Wer würde am ehesten …?" itself.
pub fn strip_zeig_frame(s: &str) -> String {
    let mut words: Vec<&str> = s.split(' ').collect();
    let is = |w: &str, x: &str| w.to_lowercase() == x;
    if words.len() > 2 && is(words[0], "wer") && is(words[1], "würde") {
        words.drain(..2);
        if words.len() > 2 && is(words[0], "am") && is(words[1], "ehesten") {
            words.drain(..2);
        }
    }
    let t = words.join(" ");
    t.trim_end_matches(|c: char| c == '?' || c == '？' || c == '…' || c.is_whitespace()).trim().to_string()
}

fn clean_text(kind: Kind, s: &str) -> String {
    let t = squeeze(s);
    if kind == Kind::Zeig {
        strip_zeig_frame(&t)
    } else {
        t
    }
}

/// A word card from its parts: forbidden words cleaned, empty ones and the term itself dropped
/// (`parseCard` in custom.ts).
fn card(word: &str, taboo: impl IntoIterator<Item = String>) -> Entry {
    let word = squeeze(word);
    let key = norm(&word);
    let taboo = taboo.into_iter().map(|t| squeeze(&t)).filter(|t| !t.is_empty() && norm(t) != key).collect();
    Entry::card(word, taboo)
}

/// One typed line as a word card: term before the first `:`, forbidden words split at `,` or `;`.
fn card_from_line(line: &str) -> Entry {
    match line.split_once(':') {
        Some((w, rest)) => card(w, rest.split([',', ';']).map(str::to_string)),
        None => card(line, Vec::new()),
    }
}

fn item_from_json(kind: Kind, v: &Value) -> Option<Entry> {
    match v {
        Value::String(s) if kind == Kind::Words => Some(card_from_line(s)),
        Value::String(s) => Some(Entry::text(clean_text(kind, s))),
        Value::Object(o) if kind == Kind::Words => {
            let word = o.get("word").or_else(|| o.get("text")).and_then(Value::as_str)?;
            let taboo = o
                .get("taboo")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect::<Vec<_>>())
                .unwrap_or_default();
            Some(card(word, taboo))
        }
        Value::Object(o) => o.get("text").and_then(Value::as_str).map(|s| Entry::text(clean_text(kind, s))),
        _ => None,
    }
}

/// What kind the text declares, if any. A JSON array of objects with `taboo`/`word` is word cards.
pub fn detect_kind(text: &str) -> Option<Kind> {
    match serde_json::from_str::<Value>(text.trim()).ok()? {
        Value::Object(o) => {
            if let Some(k) = o.get("kind").and_then(Value::as_str).and_then(kind_from_browser) {
                return Some(k);
            }
            if o.contains_key("ukhdkWords") {
                return Some(Kind::Words);
            }
            let list = o.get("items").or_else(|| o.get("cards"))?.as_array()?;
            looks_like_cards(list).then_some(Kind::Words)
        }
        Value::Array(a) => looks_like_cards(&a).then_some(Kind::Words),
        _ => None,
    }
}

fn looks_like_cards(a: &[Value]) -> bool {
    a.iter().any(|v| v.as_object().is_some_and(|o| o.contains_key("taboo") || o.contains_key("word")))
}

/// Parses an import for lists of `kind`. `kind` is what the user picked; a text that declares
/// another kind is refused (like the browser does), so nothing lands in the wrong game.
pub fn parse(kind: Kind, text: &str) -> Result<Parsed, String> {
    let trimmed = text.trim();
    let json = serde_json::from_str::<Value>(trimmed).ok().filter(|v| v.is_object() || v.is_array());
    let Some(raw) = json else {
        let items = text
            .lines()
            .filter(|l| crate::content::is_entry_line(l))
            .map(|l| if kind == Kind::Words { card_from_line(l) } else { Entry::text(clean_text(kind, l)) })
            .filter(|e| !e.text.is_empty() || !e.taboo.is_empty())
            .collect();
        return Ok(Parsed { kind: None, name: None, items, skipped: 0 });
    };
    let declared = detect_kind(trimmed).filter(|_| raw.get("kind").is_some() || raw.get("ukhdkWords").is_some());
    if let Some(d) = declared {
        if d != kind {
            return Err(format!("Das ist eine Liste für „{}“.", d.label()));
        }
    }
    let list = match &raw {
        Value::Array(a) => a,
        Value::Object(o) => match o.get("items").or_else(|| o.get("cards")) {
            Some(Value::Array(a)) => a,
            _ => return Err("Das ist keine Liste.".into()),
        },
        _ => unreachable!(),
    };
    let name = raw.get("name").and_then(Value::as_str).map(squeeze).filter(|s| !s.is_empty());
    let mut items = Vec::new();
    let mut skipped = 0;
    for v in list {
        match item_from_json(kind, v) {
            Some(e) if !e.text.is_empty() || !e.taboo.is_empty() => items.push(e),
            _ => skipped += 1,
        }
    }
    Ok(Parsed { kind: declared, name, items, skipped })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Status {
    New,
    Dup(String),
    Invalid(String),
}

/// What each item would be in `target`: new, a duplicate (of the list, the other word list, or an
/// earlier line of the import) or invalid by the seal rules.
pub fn preview(c: &Content, target: ListId, items: &[Entry]) -> Vec<Status> {
    let mut seen = HashSet::new();
    items
        .iter()
        .map(|e| {
            if let Some(m) = check_entry(target.kind(), e) {
                return Status::Invalid(m);
            }
            if let Some(at) = find_duplicate(c, target, None, &e.text) {
                return Status::Dup(dup_msg(target, at));
            }
            if !seen.insert(norm(&e.text)) {
                return Status::Dup("doppelt im Import".into());
            }
            Status::New
        })
        .collect()
}

/// Adds the new items to `target`; returns how many.
pub fn apply(c: &mut Content, target: ListId, items: &[Entry]) -> usize {
    let status = preview(c, target, items);
    let new: Vec<Entry> = items.iter().zip(&status).filter(|(_, s)| **s == Status::New).map(|(e, _)| e.clone()).collect();
    let n = new.len();
    c.entries_mut(target).extend(new);
    n
}

/// Splits a form field of forbidden words (comma separated), like the files.
pub fn taboo_field(s: &str) -> Vec<String> {
    split_taboo(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn per_list_export() {
        let t = r#"{"ukhdkList":1,"kind":"words","name":"Büro-Insider","items":[
            {"id":"c:a:1","text":"Kaffeeküche","taboo":["Tasse","Pause","Kaffeeküche"]},
            {"id":"c:a:2","text":"Überstunden","taboo":[" Arbeit ","",42],"by":{"id":"p","name":"Jo"}}]}"#;
        assert_eq!(detect_kind(t), Some(Kind::Words));
        let p = parse(Kind::Words, t).unwrap();
        assert_eq!(p.kind, Some(Kind::Words));
        assert_eq!(p.name.as_deref(), Some("Büro-Insider"));
        assert_eq!(p.items[0], Entry::card("Kaffeeküche", vec!["Tasse".into(), "Pause".into()]));
        assert_eq!(p.items[1], Entry::card("Überstunden", vec!["Arbeit".into()]));
        assert!(parse(Kind::Zeig, t).unwrap_err().contains("Wörter"));
    }

    #[test]
    fn text_kind_exports_map_to_the_games() {
        let z = r#"{"ukhdkList":1,"kind":"zeig","name":"Z","items":[{"id":"1","text":"Wer würde am ehesten im Büro einschlafen?"},{"text":"heimlich weinen …"}]}"#;
        assert_eq!(detect_kind(z), Some(Kind::Zeig));
        let p = parse(Kind::Zeig, z).unwrap();
        assert_eq!(p.items.iter().map(|e| e.text.as_str()).collect::<Vec<_>>(), vec!["im Büro einschlafen", "heimlich weinen"]);
        assert_eq!(detect_kind(r#"{"kind":"fragen","items":[]}"#), Some(Kind::Gleich));
        assert_eq!(detect_kind(r#"{"kind":"kategorien","items":[]}"#), Some(Kind::Slf));
        let f = parse(Kind::Gleich, r#"{"kind":"fragen","items":[{"text":"Etwas, das man klaut"}, 7, {"x":1}]}"#).unwrap();
        assert_eq!(f.items.len(), 1);
        assert_eq!(f.skipped, 2);
    }

    #[test]
    fn old_word_export_and_plain_arrays() {
        let old = r#"{"ukhdkWords":1,"cards":[{"id":"x","word":"Ähre","taboo":["Korn","Feld"]}]}"#;
        assert_eq!(detect_kind(old), Some(Kind::Words));
        assert_eq!(parse(Kind::Words, old).unwrap().items[0], Entry::card("Ähre", vec!["Korn".into(), "Feld".into()]));
        assert!(parse(Kind::Slf, old).is_err());
        let arr = r#"["Fluss", "  Gemüse  ", "Straße"]"#;
        assert_eq!(detect_kind(arr), None);
        let p = parse(Kind::Slf, arr).unwrap();
        assert_eq!(p.items.iter().map(|e| e.text.as_str()).collect::<Vec<_>>(), vec!["Fluss", "Gemüse", "Straße"]);
        let cards = r#"[{"word":"Öl","taboo":["Auto"]}, "Bär: Tier; Honig"]"#;
        assert_eq!(detect_kind(cards), Some(Kind::Words));
        let p = parse(Kind::Words, cards).unwrap();
        assert_eq!(p.items[1], Entry::card("Bär", vec!["Tier".into(), "Honig".into()]));
        assert_eq!(parse(Kind::Words, r#"{"name":"x"}"#).unwrap_err(), "Das ist keine Liste.");
    }

    #[test]
    fn lines() {
        let t = "# Kommentar\n\nÄpfel:  Obst, Baum ; rot\r\nGrün\nStraße: Weg, straße\n";
        let p = parse(Kind::Words, t).unwrap();
        assert_eq!(p.kind, None);
        assert_eq!(p.items.len(), 3);
        assert_eq!(p.items[0], Entry::card("Äpfel", vec!["Obst".into(), "Baum".into(), "rot".into()]));
        assert_eq!(p.items[1], Entry::card("Grün", vec![]));
        assert_eq!(p.items[2], Entry::card("Straße", vec!["Weg".into()]));
        let q = parse(Kind::Gleich, "Was isst man\u{7} im Zirkuszelt?\n123\n").unwrap();
        assert_eq!(q.items[0].text, "Was isst man im Zirkuszelt?");
        // A single number is valid JSON but not a list: it is a line.
        assert_eq!(q.items[1].text, "123");
    }

    #[test]
    fn preview_and_apply() {
        let mut c = Content::empty();
        c.lists[ListId::WordsNormal.index()] = vec![Entry::card("Apfel", vec!["Obst".into()])];
        c.lists[ListId::WordsNsfw.index()] = vec![Entry::card("Bier", vec!["Hopfen".into()])];
        let p = parse(Kind::Words, "apfel: rot\nBIER: Malz\nKäse: Milch\nkäse: Loch\nNackt\n").unwrap();
        let s = preview(&c, ListId::WordsNormal, &p.items);
        assert_eq!(s[0], Status::Dup("doppelt, schon Nr. 1".into()));
        assert_eq!(s[1], Status::Dup("doppelt, schon in Wörter · NSFW, Nr. 1".into()));
        assert_eq!(s[2], Status::New);
        assert_eq!(s[3], Status::Dup("doppelt im Import".into()));
        assert_eq!(s[4], Status::Invalid("1 bis 8 verbotene Wörter".into()));
        assert_eq!(apply(&mut c, ListId::WordsNormal, &p.items), 1);
        assert_eq!(c.entries(ListId::WordsNormal), [Entry::card("Apfel", vec!["Obst".into()]), Entry::card("Käse", vec!["Milch".into()])]);
    }

    #[test]
    fn zeig_frame() {
        assert_eq!(strip_zeig_frame("wer WÜRDE am ehesten lügen?"), "lügen");
        assert_eq!(strip_zeig_frame("Wer würde lügen??"), "lügen");
        assert_eq!(strip_zeig_frame("Wer würde"), "Wer würde");
        assert_eq!(strip_zeig_frame("zuerst gehen …"), "zuerst gehen");
    }
}
