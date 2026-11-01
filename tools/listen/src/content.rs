//! The nine lists of the built-in decks, in memory, and their JSON form inside the vault.
//!
//! The JSON is `Content` from src/words/types.ts. It is written with the same key order and
//! formatting as `JSON.stringify` in scripts/seal-content.mjs, so `npm run seal:check` sees the same
//! bytes whichever side sealed.

use serde::{Deserialize, Serialize};

/// The game a list belongs to; decides the line format and the length limit.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Kind {
    Words,
    Gleich,
    Zeig,
    Slf,
}

impl Kind {
    pub const ALL: [Kind; 4] = [Kind::Words, Kind::Gleich, Kind::Zeig, Kind::Slf];

    pub fn label(self) -> &'static str {
        match self {
            Kind::Words => "Wörter",
            Kind::Gleich => "Gleich gedacht",
            Kind::Zeig => "Zeig drauf",
            Kind::Slf => "Stadt Land Fluss",
        }
    }

    /// What one entry is called in messages.
    pub fn one(self) -> &'static str {
        match self {
            Kind::Words => "Wortkarte",
            Kind::Gleich | Kind::Zeig => "Frage",
            Kind::Slf => "Kategorie",
        }
    }

    pub fn lists(self) -> &'static [ListId] {
        match self {
            Kind::Words => &[ListId::WordsNormal, ListId::WordsNsfw],
            Kind::Gleich => &[ListId::GleichNormal, ListId::GleichNsfw],
            Kind::Zeig => &[ListId::ZeigNormal, ListId::ZeigNsfw],
            Kind::Slf => &[ListId::SlfText, ListId::SlfBild, ListId::SlfNsfw],
        }
    }
}

/// One of the nine lists, in the order the left pane shows them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ListId {
    WordsNormal,
    WordsNsfw,
    GleichNormal,
    GleichNsfw,
    ZeigNormal,
    ZeigNsfw,
    SlfText,
    SlfBild,
    SlfNsfw,
}

impl ListId {
    pub const ALL: [ListId; 9] = [
        ListId::WordsNormal,
        ListId::WordsNsfw,
        ListId::GleichNormal,
        ListId::GleichNsfw,
        ListId::ZeigNormal,
        ListId::ZeigNsfw,
        ListId::SlfText,
        ListId::SlfBild,
        ListId::SlfNsfw,
    ];

    pub fn index(self) -> usize {
        self as usize
    }

    /// Same names as `FILES` in scripts/seal-content.mjs (used by the plaintext export).
    pub fn file_name(self) -> &'static str {
        match self {
            ListId::WordsNormal => "woerter-normal.txt",
            ListId::WordsNsfw => "woerter-nsfw.txt",
            ListId::GleichNormal => "gleich-normal.txt",
            ListId::GleichNsfw => "gleich-nsfw.txt",
            ListId::ZeigNormal => "zeig-normal.txt",
            ListId::ZeigNsfw => "zeig-nsfw.txt",
            ListId::SlfText => "slf-text.txt",
            ListId::SlfBild => "slf-bild.txt",
            ListId::SlfNsfw => "slf-nsfw.txt",
        }
    }

    pub fn kind(self) -> Kind {
        match self {
            ListId::WordsNormal | ListId::WordsNsfw => Kind::Words,
            ListId::GleichNormal | ListId::GleichNsfw => Kind::Gleich,
            ListId::ZeigNormal | ListId::ZeigNsfw => Kind::Zeig,
            ListId::SlfText | ListId::SlfBild | ListId::SlfNsfw => Kind::Slf,
        }
    }

    /// Label within its group.
    pub fn variant(self) -> &'static str {
        match self {
            ListId::WordsNormal | ListId::GleichNormal | ListId::ZeigNormal => "Normal",
            ListId::WordsNsfw | ListId::GleichNsfw | ListId::ZeigNsfw | ListId::SlfNsfw => "NSFW",
            ListId::SlfText => "Text",
            ListId::SlfBild => "Bilder",
        }
    }

    /// "Wörter · NSFW"
    pub fn title(self) -> String {
        format!("{} · {}", self.kind().label(), self.variant())
    }

    /// The other lists of the same kind (targets for "verschieben").
    pub fn siblings(self) -> Vec<ListId> {
        self.kind().lists().iter().copied().filter(|&l| l != self).collect()
    }
}

/// One entry. For word cards `text` is the term and `taboo` the forbidden words; other kinds leave
/// `taboo` empty.
#[derive(Clone, Debug, PartialEq, Eq, Default, Hash, PartialOrd, Ord)]
pub struct Entry {
    pub text: String,
    pub taboo: Vec<String>,
}

impl Entry {
    pub fn text(text: impl Into<String>) -> Entry {
        Entry { text: text.into(), taboo: Vec::new() }
    }

    pub fn card(word: impl Into<String>, taboo: Vec<String>) -> Entry {
        Entry { text: word.into(), taboo }
    }

    /// The line as it goes into a plaintext file.
    pub fn line(&self, kind: Kind) -> String {
        if kind == Kind::Words {
            format!("{}: {}", self.text, self.taboo.join(", "))
        } else {
            self.text.clone()
        }
    }

    pub fn taboo_joined(&self) -> String {
        self.taboo.join(", ")
    }
}

/// Collapses whitespace runs and trims, like `readLines` in scripts/seal-content.mjs.
pub fn squash(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Same test as `readLines`: after trimming, empty or starting with `#` is not an entry.
pub fn is_entry_line(line: &str) -> bool {
    let t = line.trim();
    !t.is_empty() && !t.starts_with('#')
}

/// Comma separated forbidden words, trimmed, empty ones dropped.
pub fn split_taboo(s: &str) -> Vec<String> {
    s.split(',').map(squash).filter(|t| !t.is_empty()).collect()
}

/// All nine lists.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Content {
    pub lists: [Vec<Entry>; 9],
}

#[derive(Serialize, Deserialize)]
struct Pair<T> {
    normal: T,
    nsfw: T,
}

#[derive(Serialize, Deserialize)]
struct SlfJson {
    text: Vec<String>,
    image: Vec<String>,
    nsfw: Vec<String>,
}

/// `Content` in src/words/types.ts. Field order is the key order of the seal script's object literal.
#[derive(Serialize, Deserialize)]
struct ContentJson {
    v: u32,
    words: Pair<Vec<Vec<String>>>,
    gleich: Pair<Vec<String>>,
    zeig: Pair<Vec<String>>,
    slf: SlfJson,
}

impl Content {
    pub fn empty() -> Content {
        Content::default()
    }

    pub fn entries(&self, id: ListId) -> &[Entry] {
        &self.lists[id.index()]
    }

    pub fn entries_mut(&mut self, id: ListId) -> &mut Vec<Entry> {
        &mut self.lists[id.index()]
    }

    pub fn count(&self, id: ListId) -> usize {
        self.lists[id.index()].len()
    }

    /// Moves entry `i` of `from` to the end of `to`. Returns its new index.
    pub fn move_entry(&mut self, from: ListId, i: usize, to: ListId) -> usize {
        let e = self.entries_mut(from).remove(i);
        let dst = self.entries_mut(to);
        dst.push(e);
        dst.len() - 1
    }

    /// "Wörter A+B, Gleich C+D, Zeig E+F, SLF x/y/z" for the commit message.
    pub fn summary(&self) -> String {
        let c = |id| self.count(id);
        format!(
            "Wörter {}+{}, Gleich {}+{}, Zeig {}+{}, SLF {}/{}/{}",
            c(ListId::WordsNormal),
            c(ListId::WordsNsfw),
            c(ListId::GleichNormal),
            c(ListId::GleichNsfw),
            c(ListId::ZeigNormal),
            c(ListId::ZeigNsfw),
            c(ListId::SlfText),
            c(ListId::SlfBild),
            c(ListId::SlfNsfw)
        )
    }

    /// Decrypted vault data to lists, with the shape checks of `parseContent` in src/words/vault.ts.
    pub fn from_json(bytes: &[u8]) -> Result<Content, String> {
        let j: ContentJson = serde_json::from_slice(bytes).map_err(|e| format!("Inhalt des Tresors hat nicht die erwartete Form: {e}"))?;
        if j.v != 1 {
            return Err(format!("Inhalt des Tresors hat Version {}, erwartet 1.", j.v));
        }
        let cards = |v: Vec<Vec<String>>| -> Result<Vec<Entry>, String> {
            v.into_iter()
                .map(|mut e| {
                    if e.is_empty() {
                        return Err("Wortkarte ohne Begriff im Tresor.".to_string());
                    }
                    let word = e.remove(0);
                    Ok(Entry::card(word, e))
                })
                .collect()
        };
        let texts = |v: Vec<String>| v.into_iter().map(Entry::text).collect::<Vec<_>>();
        let mut c = Content::empty();
        c.lists[ListId::WordsNormal.index()] = cards(j.words.normal)?;
        c.lists[ListId::WordsNsfw.index()] = cards(j.words.nsfw)?;
        c.lists[ListId::GleichNormal.index()] = texts(j.gleich.normal);
        c.lists[ListId::GleichNsfw.index()] = texts(j.gleich.nsfw);
        c.lists[ListId::ZeigNormal.index()] = texts(j.zeig.normal);
        c.lists[ListId::ZeigNsfw.index()] = texts(j.zeig.nsfw);
        c.lists[ListId::SlfText.index()] = texts(j.slf.text);
        c.lists[ListId::SlfBild.index()] = texts(j.slf.image);
        c.lists[ListId::SlfNsfw.index()] = texts(j.slf.nsfw);
        Ok(c)
    }

    /// The plaintext that gets encrypted: compact JSON, byte for byte what `JSON.stringify(content)`
    /// gives in the seal script.
    pub fn to_json(&self) -> Vec<u8> {
        let cards = |id: ListId| {
            self.entries(id).iter().map(|e| std::iter::once(e.text.clone()).chain(e.taboo.iter().cloned()).collect()).collect()
        };
        let texts = |id: ListId| self.entries(id).iter().map(|e| e.text.clone()).collect();
        let j = ContentJson {
            v: 1,
            words: Pair { normal: cards(ListId::WordsNormal), nsfw: cards(ListId::WordsNsfw) },
            gleich: Pair { normal: texts(ListId::GleichNormal), nsfw: texts(ListId::GleichNsfw) },
            zeig: Pair { normal: texts(ListId::ZeigNormal), nsfw: texts(ListId::ZeigNsfw) },
            slf: SlfJson { text: texts(ListId::SlfText), image: texts(ListId::SlfBild), nsfw: texts(ListId::SlfNsfw) },
        };
        serde_json::to_vec(&j).expect("plain strings always serialize")
    }

    /// One list as a plaintext file the seal script reads back to the same entries: a comment header,
    /// a blank line, one entry per line.
    pub fn export_file(&self, id: ListId) -> String {
        let format = if id.kind() == Kind::Words {
            "Format: Begriff: verboten, verboten (ein Eintrag pro Zeile)"
        } else {
            "Format: ein Eintrag pro Zeile"
        };
        let mut out = format!("# {} – exportiert mit npm run listen\n# {format}. Zeilen mit # zählen nicht.\n\n", id.title());
        for e in self.entries(id) {
            out.push_str(&e.line(id.kind()));
            out.push('\n');
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Content {
        let mut c = Content::empty();
        c.lists[ListId::WordsNormal.index()] = vec![Entry::card("Ärger", vec!["Wut".into(), "Groll".into()])];
        c.lists[ListId::WordsNsfw.index()] = vec![Entry::card("Kobold", vec!["Zwerg".into()])];
        c.lists[ListId::GleichNormal.index()] = vec![Entry::text("Ein \"Ding\" mit \\ Strich")];
        c.lists[ListId::SlfBild.index()] = vec![Entry::text("Etwas mit Zacken")];
        c
    }

    #[test]
    fn json_has_the_key_order_of_the_seal_script() {
        let s = String::from_utf8(sample().to_json()).unwrap();
        assert_eq!(
            s,
            r#"{"v":1,"words":{"normal":[["Ärger","Wut","Groll"]],"nsfw":[["Kobold","Zwerg"]]},"gleich":{"normal":["Ein \"Ding\" mit \\ Strich"],"nsfw":[]},"zeig":{"normal":[],"nsfw":[]},"slf":{"text":[],"image":["Etwas mit Zacken"],"nsfw":[]}}"#
        );
        assert_eq!(Content::from_json(s.as_bytes()).unwrap(), sample());
    }

    #[test]
    fn from_json_checks_the_shape() {
        assert!(Content::from_json(b"{}").is_err());
        assert!(Content::from_json(br#"{"v":2,"words":{"normal":[],"nsfw":[]},"gleich":{"normal":[],"nsfw":[]},"zeig":{"normal":[],"nsfw":[]},"slf":{"text":[],"image":[],"nsfw":[]}}"#).is_err());
        assert!(Content::from_json(br#"{"v":1,"words":{"normal":[[]],"nsfw":[]},"gleich":{"normal":[],"nsfw":[]},"zeig":{"normal":[],"nsfw":[]},"slf":{"text":[],"image":[],"nsfw":[]}}"#).is_err());
        assert!(Content::from_json(br#"{"v":1,"words":{"normal":[[1]],"nsfw":[]},"gleich":{"normal":[],"nsfw":[]},"zeig":{"normal":[],"nsfw":[]},"slf":{"text":[],"image":[],"nsfw":[]}}"#).is_err());
        // A single word without forbidden words is a valid shape (the rules check it later).
        let one = br#"{"v":1,"words":{"normal":[["Solo"]],"nsfw":[]},"gleich":{"normal":[],"nsfw":[]},"zeig":{"normal":[],"nsfw":[]},"slf":{"text":[],"image":[],"nsfw":[]},"extra":1}"#;
        assert_eq!(Content::from_json(one).unwrap().entries(ListId::WordsNormal)[0], Entry::card("Solo", vec![]));
    }

    #[test]
    fn export_lines() {
        let c = sample();
        let f = c.export_file(ListId::WordsNormal);
        assert!(f.starts_with("# Wörter · Normal – exportiert"));
        assert!(f.ends_with("\n\nÄrger: Wut, Groll\n"));
        assert!(c.export_file(ListId::SlfBild).ends_with("\n\nEtwas mit Zacken\n"));
        assert!(c.export_file(ListId::ZeigNsfw).ends_with("\n\n"));
    }

    #[test]
    fn move_between_lists() {
        let mut c = sample();
        let at = c.move_entry(ListId::WordsNormal, 0, ListId::WordsNsfw);
        assert_eq!(at, 1);
        assert!(c.entries(ListId::WordsNormal).is_empty());
        assert_eq!(c.entries(ListId::WordsNsfw)[1].text, "Ärger");
        assert_eq!(ListId::SlfText.siblings(), vec![ListId::SlfBild, ListId::SlfNsfw]);
        assert_eq!(ListId::ZeigNsfw.siblings(), vec![ListId::ZeigNormal]);
        assert_eq!(ListId::ALL.iter().map(|l| l.index()).collect::<Vec<_>>(), (0..9).collect::<Vec<_>>());
    }
}
