//! The rules of scripts/seal-content.mjs. Sealing (here or with the script) refuses content that
//! breaks them, and a merged result is checked with them before it is pushed.
//!
//! Keep in sync with seal-content.mjs: `LIMITS`, `norm`, `texts()`, `words()`, `unique()` and the
//! checks at the end of `readContent()`. The script stops at the first problem; here every entry
//! gets its own reason.

use crate::content::{squash, Content, Entry, Kind, ListId};

/// `LIMITS` in seal-content.mjs.
pub const MAX_WORD: usize = 40;
pub const MAX_TABOO: usize = 8;
pub const MAX_QUESTION: usize = 120;
pub const MAX_CATEGORY: usize = 40;

/// Categories every writing round has; seal-content.mjs refuses to seal without them in slf-text.txt.
pub const SLF_FIXED: [&str; 3] = ["Stadt", "Land", "Fluss"];

/// Lists the seal script refuses to seal empty (`Keine Einträge`).
pub const MUST_NOT_BE_EMPTY: [ListId; 6] =
    [ListId::WordsNormal, ListId::WordsNsfw, ListId::GleichNormal, ListId::GleichNsfw, ListId::ZeigNormal, ListId::ZeigNsfw];

/// `norm` in seal-content.mjs (and `normWord` in the browser): spaces and case don't count.
pub fn norm(s: &str) -> String {
    squash(s).to_lowercase()
}

pub fn max_chars(kind: Kind) -> usize {
    match kind {
        Kind::Words => MAX_WORD,
        Kind::Gleich | Kind::Zeig => MAX_QUESTION,
        Kind::Slf => MAX_CATEGORY,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Issue {
    /// Duplicate (the entry itself is fine) or broken entry.
    pub dup: bool,
    pub msg: String,
}

/// Problems of one entry on its own: `words()` / `texts()` in seal-content.mjs, plus the ones the
/// plaintext files need (a leading `#` would turn the line into a comment, a `:` in a term would
/// split it), so an export always seals back to the same content.
pub fn check_entry(kind: Kind, e: &Entry) -> Option<String> {
    let len = e.text.chars().count();
    if kind == Kind::Words {
        if e.text.is_empty() || len > MAX_WORD {
            return Some(format!("Begriff leer oder länger als {MAX_WORD} Zeichen"));
        }
        if e.text.contains(':') {
            return Some("Begriff darf keinen Doppelpunkt enthalten".into());
        }
        if e.text.starts_with('#') {
            return Some("beginnt mit # (wäre ein Kommentar)".into());
        }
        if e.taboo.is_empty() || e.taboo.len() > MAX_TABOO {
            return Some(format!("1 bis {MAX_TABOO} verbotene Wörter"));
        }
        if e.taboo.iter().any(|t| t.contains(',')) {
            return Some("verbotenes Wort mit Komma".into());
        }
        return None;
    }
    let max = max_chars(kind);
    if e.text.is_empty() {
        return Some("leer".into());
    }
    if len > max {
        return Some(format!("länger als {max} Zeichen"));
    }
    if e.text.starts_with('#') {
        return Some("beginnt mit # (wäre ein Kommentar)".into());
    }
    None
}

/// Where else an entry with this key already is, if anywhere: same list (except `skip`), and for word
/// cards also the other word list (`unique(..., 'Begriff in Normal und NSFW')`).
pub fn find_duplicate(c: &Content, list: ListId, skip: Option<usize>, text: &str) -> Option<(ListId, usize)> {
    let key = norm(text);
    let scopes: Vec<ListId> = if list.kind() == Kind::Words { Kind::Words.lists().to_vec() } else { vec![list] };
    for l in scopes {
        for (i, e) in c.entries(l).iter().enumerate() {
            if l == list && Some(i) == skip {
                continue;
            }
            if norm(&e.text) == key {
                return Some((l, i));
            }
        }
    }
    None
}

/// "schon in Wörter · NSFW, Nr. 12"
pub fn dup_msg(here: ListId, at: (ListId, usize)) -> String {
    if at.0 == here {
        format!("doppelt, schon Nr. {}", at.1 + 1)
    } else {
        format!("doppelt, schon in {}, Nr. {}", at.0.title(), at.1 + 1)
    }
}

/// Problems of a new or edited entry before it goes into `list` (at index `skip` when editing).
pub fn check_new(c: &Content, list: ListId, skip: Option<usize>, e: &Entry) -> Option<String> {
    if let Some(m) = check_entry(list.kind(), e) {
        return Some(m);
    }
    find_duplicate(c, list, skip, &e.text).map(|at| dup_msg(list, at))
}

#[derive(Clone, Debug, Default)]
pub struct Report {
    /// Per list, per entry.
    pub entries: [Vec<Option<Issue>>; 9],
    /// Problems of a whole list (missing Stadt/Land/Fluss, empty lists).
    pub global: Vec<(ListId, String)>,
}

impl Report {
    pub fn issue(&self, list: ListId, i: usize) -> Option<&Issue> {
        self.entries[list.index()].get(i).and_then(|x| x.as_ref())
    }

    pub fn count(&self, list: ListId) -> usize {
        self.entries[list.index()].iter().filter(|x| x.is_some()).count() + self.global.iter().filter(|(l, _)| *l == list).count()
    }

    pub fn total(&self) -> usize {
        ListId::ALL.iter().map(|&l| self.count(l)).sum()
    }

    /// All problems as text lines, for messages.
    pub fn lines(&self) -> Vec<String> {
        let mut out = Vec::new();
        for l in ListId::ALL {
            for (i, x) in self.entries[l.index()].iter().enumerate() {
                if let Some(x) = x {
                    out.push(format!("{} Nr. {}: {}", l.title(), i + 1, x.msg));
                }
            }
        }
        for (l, m) in &self.global {
            out.push(format!("{}: {}", l.title(), m));
        }
        out
    }
}

/// Validates everything. The first of two equal entries is fine, the later one is the duplicate (the
/// seal script reports the later line too). Word lists: Normal before NSFW.
pub fn validate(c: &Content) -> Report {
    let mut r = Report::default();
    for l in ListId::ALL {
        let kind = l.kind();
        let mut seen: std::collections::HashMap<String, (ListId, usize)> = std::collections::HashMap::new();
        if l == ListId::WordsNsfw {
            for (i, e) in c.entries(ListId::WordsNormal).iter().enumerate() {
                seen.entry(norm(&e.text)).or_insert((ListId::WordsNormal, i));
            }
        }
        r.entries[l.index()] = c
            .entries(l)
            .iter()
            .enumerate()
            .map(|(i, e)| {
                if let Some(m) = check_entry(kind, e) {
                    return Some(Issue { dup: false, msg: m });
                }
                let key = norm(&e.text);
                if let Some(&at) = seen.get(&key) {
                    return Some(Issue { dup: true, msg: dup_msg(l, at) });
                }
                seen.insert(key, (l, i));
                None
            })
            .collect();
    }
    let slf = c.entries(ListId::SlfText);
    for fixed in SLF_FIXED {
        if !slf.iter().any(|e| e.text == fixed) {
            r.global.push((ListId::SlfText, format!("„{fixed}“ fehlt (ist in jeder Schreib-Runde dabei)")));
        }
    }
    for l in MUST_NOT_BE_EMPTY {
        if c.entries(l).is_empty() {
            r.global.push((l, "keine Einträge".into()));
        }
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Lines like the plaintext files: `Begriff: a, b` for words (no colon: no forbidden words).
    fn parse(kind: Kind, text: &str) -> Vec<Entry> {
        text.lines()
            .filter(|l| crate::content::is_entry_line(l))
            .map(|l| match (kind, l.split_once(':')) {
                (Kind::Words, Some((w, t))) => Entry::card(squash(w), crate::content::split_taboo(t)),
                _ => Entry::text(squash(l)),
            })
            .collect()
    }

    fn content(files: &[(ListId, &str)]) -> Content {
        let mut c = Content::empty();
        for id in MUST_NOT_BE_EMPTY {
            let name = id.file_name();
            c.lists[id.index()] = parse(id.kind(), &if id.kind() == Kind::Words { format!("{name}: y\n") } else { format!("{name}\n") });
        }
        c.lists[ListId::SlfText.index()] = parse(Kind::Slf, "Stadt\nLand\nFluss\n");
        for (id, t) in files {
            c.lists[id.index()] = parse(id.kind(), t);
        }
        c
    }

    #[test]
    fn clean_content_has_no_problems() {
        let c = content(&[(ListId::WordsNormal, "Apfel: Obst\n"), (ListId::WordsNsfw, "Bier: Hopfen\n")]);
        assert_eq!(validate(&c).total(), 0);
    }

    #[test]
    fn word_card_rules() {
        let long = "x".repeat(41);
        let c = content(&[(
            ListId::WordsNormal,
            &format!(
                "ohne Doppelpunkt\n: leer\n{long}: a\nNull:\nNeun: 1,2,3,4,5,6,7,8,9\nAcht: 1,2,3,4,5,6,7,8\n{}: genau vierzig\n",
                "y".repeat(40)
            ),
        )]);
        let r = validate(&c);
        let msg = |i| r.issue(ListId::WordsNormal, i).map(|x| x.msg.clone());
        assert_eq!(msg(0).unwrap(), "1 bis 8 verbotene Wörter");
        assert_eq!(msg(1).unwrap(), "Begriff leer oder länger als 40 Zeichen");
        assert_eq!(msg(2).unwrap(), "Begriff leer oder länger als 40 Zeichen");
        assert_eq!(msg(3).unwrap(), "1 bis 8 verbotene Wörter");
        assert_eq!(msg(4).unwrap(), "1 bis 8 verbotene Wörter");
        assert_eq!(msg(5), None);
        assert_eq!(msg(6), None);
    }

    #[test]
    fn lengths_count_characters_not_bytes() {
        // 40 umlauts are 80 bytes but 40 characters, like [...s].length in the script.
        let c = content(&[
            (ListId::WordsNormal, &format!("{}: a\n", "ä".repeat(40))),
            (ListId::SlfBild, &format!("{}\n{}\n", "ö".repeat(40), "ö".repeat(41))),
        ]);
        let r = validate(&c);
        assert!(r.issue(ListId::WordsNormal, 0).is_none());
        assert!(r.issue(ListId::SlfBild, 0).is_none());
        assert_eq!(r.issue(ListId::SlfBild, 1).unwrap().msg, "länger als 40 Zeichen");
        let q = "q".repeat(121);
        let c = content(&[(ListId::GleichNormal, &format!("{}\n{q}\n", "q".repeat(120)))]);
        let r = validate(&c);
        assert!(r.issue(ListId::GleichNormal, 0).is_none());
        assert_eq!(r.issue(ListId::GleichNormal, 1).unwrap().msg, "länger als 120 Zeichen");
    }

    #[test]
    fn duplicates_ignore_case_and_spaces() {
        let c = content(&[(ListId::ZeigNormal, "im  Büro schlafen\nIM BÜRO   SCHLAFEN\nanderes\n")]);
        let r = validate(&c);
        assert!(r.issue(ListId::ZeigNormal, 0).is_none());
        let i = r.issue(ListId::ZeigNormal, 1).unwrap();
        assert!(i.dup);
        assert_eq!(i.msg, "doppelt, schon Nr. 1");
        assert!(r.issue(ListId::ZeigNormal, 2).is_none());
    }

    #[test]
    fn word_duplicates_across_normal_and_nsfw_but_texts_only_within_a_file() {
        let c = content(&[
            (ListId::WordsNormal, "Apfel: Obst\n"),
            (ListId::WordsNsfw, "apfel: Sünde\n"),
            (ListId::GleichNormal, "Eine Frage\n"),
            (ListId::GleichNsfw, "Eine Frage\n"),
        ]);
        let r = validate(&c);
        assert_eq!(r.issue(ListId::WordsNsfw, 0).unwrap().msg, "doppelt, schon in Wörter · Normal, Nr. 1");
        assert!(r.issue(ListId::GleichNsfw, 0).is_none());
        assert_eq!(find_duplicate(&c, ListId::WordsNormal, None, " APFEL ").unwrap(), (ListId::WordsNormal, 0));
        assert_eq!(find_duplicate(&c, ListId::WordsNormal, Some(0), "Apfel").unwrap(), (ListId::WordsNsfw, 0));
    }

    #[test]
    fn global_rules() {
        let mut c = content(&[(ListId::SlfText, "Stadt\nland\n")]);
        c.lists[ListId::ZeigNsfw.index()] = Vec::new();
        let r = validate(&c);
        let g: Vec<String> = r.global.iter().map(|(l, m)| format!("{}: {m}", l.file_name())).collect();
        assert!(g.contains(&"slf-text.txt: „Land“ fehlt (ist in jeder Schreib-Runde dabei)".to_string()));
        assert!(g.contains(&"slf-text.txt: „Fluss“ fehlt (ist in jeder Schreib-Runde dabei)".to_string()));
        assert!(g.contains(&"zeig-nsfw.txt: keine Einträge".to_string()));
        assert_eq!(r.total(), 3, "{:?}", r.lines());
    }

    #[test]
    fn hash_and_colon_would_break_the_file() {
        let e = Entry::card("a:b", vec!["c".into()]);
        assert!(check_entry(Kind::Words, &e).unwrap().contains("Doppelpunkt"));
        assert!(check_entry(Kind::Slf, &Entry::text("#Hashtag")).unwrap().contains('#'));
        assert!(check_entry(Kind::Slf, &Entry::text("")).is_some());
    }
}
