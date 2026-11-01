//! Three-way merge of deck content: base (the vault the edit started from), mine (the edit in
//! memory) and theirs (the vault someone else pushed meanwhile).
//!
//! An entry is identified per kind of list by its normalised text (`norm`, the same as the duplicate
//! check): word cards by the term, the other lists by the text itself. Its state is where it is and
//! what it says (`Placement`: list -> entry; for word cards the entry carries the forbidden words).
//! Per entry: whatever only one side changed wins; both sides changing it the same way is fine;
//! otherwise it is a conflict the user settles (mine or theirs). When both sides changed an entry
//! but in different respects (one moved it, the other edited it), both changes are kept.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use crate::content::{Content, Entry, Kind, ListId};
use crate::validate::norm;

/// Where an entry is and what it says there. Usually one list; text lists may hold the same text in
/// several lists of their kind.
pub type Placement = BTreeMap<ListId, Entry>;
/// None: not there (never added, or deleted).
pub type State = Option<Placement>;

fn index(c: &Content, kind: Kind) -> BTreeMap<String, Placement> {
    let mut m: BTreeMap<String, Placement> = BTreeMap::new();
    for &l in kind.lists() {
        for e in c.entries(l) {
            // A duplicate within one list (the rules forbid it) counts once: the first one.
            m.entry(norm(&e.text)).or_default().entry(l).or_insert_with(|| e.clone());
        }
    }
    m
}

/// How one side differs from the base, counted per entry.
#[derive(Default, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Changes {
    pub added: usize,
    pub removed: usize,
    /// Edited or moved.
    pub changed: usize,
}

impl Changes {
    pub fn is_empty(&self) -> bool {
        self.added + self.removed + self.changed == 0
    }

    /// "+2 −1 ~3"
    pub fn short(&self) -> String {
        format!("+{} −{} ~{}", self.added, self.removed, self.changed)
    }
}

pub fn changes(base: &Content, side: &Content) -> Changes {
    let mut ch = Changes::default();
    for kind in Kind::ALL {
        let (b, s) = (index(base, kind), index(side, kind));
        for key in b.keys().chain(s.keys()).collect::<BTreeSet<_>>() {
            match (b.get(key), s.get(key)) {
                (None, Some(_)) => ch.added += 1,
                (Some(_), None) => ch.removed += 1,
                (Some(x), Some(y)) if x != y => ch.changed += 1,
                _ => {}
            }
        }
    }
    ch
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    /// Both edited it, differently.
    BothChanged,
    /// Both moved it, to different lists.
    BothMoved,
    /// One deleted it, the other changed it.
    DeletedAndChanged,
    /// Both added it, differently.
    BothAdded,
}

impl Reason {
    pub fn label(self) -> &'static str {
        match self {
            Reason::BothChanged => "beide geändert",
            Reason::BothMoved => "beide verschoben",
            Reason::DeletedAndChanged => "gelöscht und geändert",
            Reason::BothAdded => "beide neu, verschieden",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Choice {
    Mine,
    Theirs,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Conflict {
    pub kind: Kind,
    pub key: String,
    pub base: State,
    pub mine: State,
    pub theirs: State,
    pub reason: Reason,
    pub choice: Option<Choice>,
}

impl Conflict {
    /// The entry text to show as its name (any side that has it).
    pub fn title(&self) -> String {
        [&self.mine, &self.theirs, &self.base]
            .into_iter()
            .flatten()
            .find_map(|p| p.values().next().map(|e| e.text.clone()))
            .unwrap_or_else(|| self.key.clone())
    }

    fn chosen(&self) -> Option<&State> {
        match self.choice? {
            Choice::Mine => Some(&self.mine),
            Choice::Theirs => Some(&self.theirs),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Merge {
    /// Base -> mine.
    pub mine_changes: Changes,
    /// Base -> theirs.
    pub theirs_changes: Changes,
    pub conflicts: Vec<Conflict>,
    /// Entries that merged by themselves.
    states: BTreeMap<(Kind, String), State>,
    mine: Content,
    theirs: Content,
    base: Content,
}

/// The result of three versions of one value: the side that changed it, None if both changed it
/// differently.
fn merge3<T: PartialEq + Clone>(b: &T, m: &T, t: &T) -> Option<T> {
    if m == t || t == b {
        Some(m.clone())
    } else if m == b {
        Some(t.clone())
    } else {
        None
    }
}

/// The lists of a placement, and its entry if it is the same in all of them.
fn split(p: &Placement) -> (BTreeSet<ListId>, Option<Entry>) {
    let lists = p.keys().copied().collect();
    let mut values = p.values();
    let first = values.next().cloned();
    let same = first.as_ref().filter(|f| values.all(|v| v == *f)).cloned();
    (lists, same)
}

pub fn merge_state(b: &State, m: &State, t: &State) -> Result<State, Reason> {
    if let Some(x) = merge3(b, m, t) {
        return Ok(x);
    }
    match (b, m, t) {
        (Some(b), Some(m), Some(t)) => {
            let ((lb, vb), (lm, vm), (lt, vt)) = (split(b), split(m), split(t));
            let (Some(vb), Some(vm), Some(vt)) = (vb, vm, vt) else { return Err(Reason::BothChanged) };
            let lists = merge3(&lb, &lm, &lt).ok_or(Reason::BothMoved)?;
            let value = merge3(&vb, &vm, &vt).ok_or(Reason::BothChanged)?;
            Ok(Some(lists.into_iter().map(|l| (l, value.clone())).collect()))
        }
        (None, Some(_), Some(_)) => Err(Reason::BothAdded),
        _ => Err(Reason::DeletedAndChanged),
    }
}

pub fn merge(base: &Content, mine: &Content, theirs: &Content) -> Merge {
    let mut states = BTreeMap::new();
    let mut conflicts = Vec::new();
    for kind in Kind::ALL {
        let (b, m, t) = (index(base, kind), index(mine, kind), index(theirs, kind));
        let keys: BTreeSet<&String> = b.keys().chain(m.keys()).chain(t.keys()).collect();
        for key in keys {
            let (sb, sm, st) = (b.get(key).cloned(), m.get(key).cloned(), t.get(key).cloned());
            match merge_state(&sb, &sm, &st) {
                Ok(s) => {
                    states.insert((kind, key.clone()), s);
                }
                Err(reason) => conflicts.push(Conflict { kind, key: key.clone(), base: sb, mine: sm, theirs: st, reason, choice: None }),
            }
        }
    }
    Merge {
        mine_changes: changes(base, mine),
        theirs_changes: changes(base, theirs),
        conflicts,
        states,
        mine: mine.clone(),
        theirs: theirs.clone(),
        base: base.clone(),
    }
}

impl Merge {
    pub fn unresolved(&self) -> usize {
        self.conflicts.iter().filter(|c| c.choice.is_none()).count()
    }

    /// The merged content, once every conflict has a choice. Order: theirs as it is, then what only I
    /// have in my order; untouched sides come back exactly as they were.
    pub fn result(&self) -> Option<Content> {
        if self.unresolved() > 0 {
            return None;
        }
        if self.conflicts.is_empty() {
            if self.theirs == self.base {
                return Some(self.mine.clone());
            }
            if self.mine == self.base {
                return Some(self.theirs.clone());
            }
        }
        let mut states: BTreeMap<(Kind, &str), &State> = self.states.iter().map(|((k, key), s)| ((*k, key.as_str()), s)).collect();
        for c in &self.conflicts {
            states.insert((c.kind, c.key.as_str()), c.chosen().expect("all chosen"));
        }
        let mut out = Content::empty();
        let mut done: HashSet<(ListId, String)> = HashSet::new();
        for src in [&self.theirs, &self.mine, &self.base] {
            for l in ListId::ALL {
                for e in src.entries(l) {
                    let key = norm(&e.text);
                    if done.contains(&(l, key.clone())) {
                        continue;
                    }
                    if let Some(Some(p)) = states.get(&(l.kind(), key.as_str())) {
                        if let Some(v) = p.get(&l) {
                            out.entries_mut(l).push(v.clone());
                            done.insert((l, key));
                        }
                    }
                }
            }
        }
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::ListId::*;

    fn card(w: &str, t: &[&str]) -> Entry {
        Entry::card(w, t.iter().map(|s| s.to_string()).collect())
    }

    fn base() -> Content {
        let mut c = Content::empty();
        c.lists[WordsNormal.index()] = vec![card("Apfel", &["Obst"]), card("Bär", &["Tier"]), card("Cello", &["Musik"])];
        c.lists[WordsNsfw.index()] = vec![card("Kobold", &["Zwerg"])];
        c.lists[SlfText.index()] = vec![Entry::text("Stadt"), Entry::text("Land"), Entry::text("Fluss"), Entry::text("Tier")];
        c.lists[SlfBild.index()] = vec![Entry::text("Etwas mit Zacken")];
        c.lists[GleichNormal.index()] = vec![Entry::text("Ein Tier mit vier Beinen")];
        c
    }

    fn texts(c: &Content, l: ListId) -> Vec<String> {
        c.entries(l).iter().map(|e| e.text.clone()).collect()
    }

    fn find(c: &Content, word: &str) -> Option<(ListId, Entry)> {
        ListId::ALL.iter().find_map(|&l| c.entries(l).iter().find(|e| e.text == word).map(|e| (l, e.clone())))
    }

    #[test]
    fn one_side_unchanged_gives_the_other_exactly() {
        let b = base();
        let mut m = base();
        m.entries_mut(WordsNormal).swap(0, 2);
        m.entries_mut(SlfText).push(Entry::text("Beruf"));
        let r = merge(&b, &m, &b);
        assert!(r.conflicts.is_empty());
        assert_eq!(r.result().unwrap(), m);
        let r = merge(&b, &b, &m);
        assert_eq!(r.result().unwrap(), m);
        assert_eq!(merge(&b, &b, &b).result().unwrap(), b);
    }

    #[test]
    fn additions_on_both_sides_are_kept() {
        let b = base();
        let mut m = base();
        m.entries_mut(WordsNormal).push(card("Zebra", &["Streifen"]));
        let mut t = base();
        t.entries_mut(WordsNsfw).push(card("Yeti", &["Schnee"]));
        t.entries_mut(GleichNormal).insert(0, Entry::text("Etwas Kariertes"));
        let r = merge(&b, &m, &t);
        assert!(r.conflicts.is_empty());
        assert_eq!(r.mine_changes, Changes { added: 1, removed: 0, changed: 0 });
        assert_eq!(r.theirs_changes, Changes { added: 2, removed: 0, changed: 0 });
        let out = r.result().unwrap();
        assert_eq!(texts(&out, WordsNormal), ["Apfel", "Bär", "Cello", "Zebra"]);
        assert_eq!(texts(&out, WordsNsfw), ["Kobold", "Yeti"]);
        assert_eq!(texts(&out, GleichNormal), ["Etwas Kariertes", "Ein Tier mit vier Beinen"]);
    }

    #[test]
    fn removal_on_one_side_wins_over_untouched() {
        let b = base();
        let mut m = base();
        m.entries_mut(WordsNormal).remove(1);
        let mut t = base();
        t.entries_mut(SlfText).remove(3);
        t.entries_mut(WordsNormal).push(card("Dachs", &["Bau"]));
        let r = merge(&b, &m, &t);
        assert!(r.conflicts.is_empty());
        let out = r.result().unwrap();
        assert_eq!(texts(&out, WordsNormal), ["Apfel", "Cello", "Dachs"]);
        assert_eq!(texts(&out, SlfText), ["Stadt", "Land", "Fluss"]);
        assert_eq!(r.mine_changes.short(), "+0 −1 ~0");
        assert_eq!(r.theirs_changes.short(), "+1 −1 ~0");
    }

    #[test]
    fn same_change_on_both_sides_is_no_conflict() {
        let b = base();
        let mut m = base();
        m.entries_mut(WordsNormal)[0].taboo.push("rot".into());
        m.entries_mut(WordsNormal).remove(2);
        let mut t = m.clone();
        t.entries_mut(SlfBild).push(Entry::text("Etwas Blaues"));
        let r = merge(&b, &m, &t);
        assert!(r.conflicts.is_empty());
        assert_eq!(r.result().unwrap(), t);
    }

    #[test]
    fn different_edits_of_the_same_card_conflict() {
        let b = base();
        let mut m = base();
        m.entries_mut(WordsNormal)[1].taboo = vec!["Tier".into(), "Honig".into()];
        let mut t = base();
        t.entries_mut(WordsNormal)[1].taboo = vec!["Tier".into(), "Wald".into()];
        t.entries_mut(WordsNormal).push(card("Dachs", &["Bau"]));
        let mut r = merge(&b, &m, &t);
        assert_eq!(r.conflicts.len(), 1);
        let c = &r.conflicts[0];
        assert_eq!((c.kind, c.key.as_str(), c.reason), (Kind::Words, "bär", Reason::BothChanged));
        assert_eq!(c.title(), "Bär");
        assert!(r.result().is_none());
        r.conflicts[0].choice = Some(Choice::Mine);
        let out = r.result().unwrap();
        assert_eq!(find(&out, "Bär").unwrap().1.taboo, ["Tier", "Honig"]);
        assert!(find(&out, "Dachs").is_some(), "the rest of theirs still comes along");
        r.conflicts[0].choice = Some(Choice::Theirs);
        assert_eq!(find(&r.result().unwrap(), "Bär").unwrap().1.taboo, ["Tier", "Wald"]);
    }

    #[test]
    fn a_case_only_edit_is_the_same_entry() {
        let b = base();
        let mut m = base();
        m.entries_mut(WordsNormal)[0].text = "APFEL".into();
        let r = merge(&b, &m, &b);
        assert_eq!(r.mine_changes, Changes { added: 0, removed: 0, changed: 1 });
        let mut t = base();
        t.entries_mut(WordsNormal)[0].text = "apfel".into();
        let r = merge(&b, &m, &t);
        assert_eq!(r.conflicts[0].reason, Reason::BothChanged);
    }

    #[test]
    fn deleted_on_one_side_and_changed_on_the_other_conflicts() {
        let b = base();
        let mut m = base();
        m.entries_mut(WordsNsfw).clear();
        let mut t = base();
        t.entries_mut(WordsNsfw)[0].taboo.push("Märchen".into());
        let mut r = merge(&b, &m, &t);
        assert_eq!(r.conflicts.len(), 1);
        assert_eq!(r.conflicts[0].reason, Reason::DeletedAndChanged);
        assert_eq!(r.conflicts[0].mine, None);
        r.conflicts[0].choice = Some(Choice::Mine);
        assert!(find(&r.result().unwrap(), "Kobold").is_none());
        r.conflicts[0].choice = Some(Choice::Theirs);
        assert_eq!(find(&r.result().unwrap(), "Kobold").unwrap().1.taboo, ["Zwerg", "Märchen"]);
        // The other way round too.
        let r = merge(&b, &t, &m);
        assert_eq!(r.conflicts[0].reason, Reason::DeletedAndChanged);
    }

    #[test]
    fn moved_on_one_side_and_edited_on_the_other_keeps_both() {
        let b = base();
        let mut m = base();
        m.move_entry(WordsNormal, 2, WordsNsfw);
        let mut t = base();
        t.entries_mut(WordsNormal)[2].taboo.push("Bogen".into());
        let r = merge(&b, &m, &t);
        assert!(r.conflicts.is_empty(), "{:?}", r.conflicts);
        let out = r.result().unwrap();
        assert_eq!(find(&out, "Cello").unwrap(), (WordsNsfw, card("Cello", &["Musik", "Bogen"])));
        assert_eq!(texts(&out, WordsNormal), ["Apfel", "Bär"]);
    }

    #[test]
    fn moved_to_different_lists_on_both_sides_conflicts() {
        let b = base();
        let mut m = base();
        m.move_entry(SlfText, 3, SlfBild);
        let mut t = base();
        t.move_entry(SlfText, 3, SlfNsfw);
        let mut r = merge(&b, &m, &t);
        assert_eq!(r.conflicts.len(), 1);
        assert_eq!(r.conflicts[0].reason, Reason::BothMoved);
        r.conflicts[0].choice = Some(Choice::Theirs);
        let out = r.result().unwrap();
        assert_eq!(texts(&out, SlfNsfw), ["Tier"]);
        assert_eq!(texts(&out, SlfBild), ["Etwas mit Zacken"]);
        assert_eq!(texts(&out, SlfText), ["Stadt", "Land", "Fluss"]);
        // Moved to the same list on both sides: no conflict.
        let r = merge(&b, &m, &m);
        assert!(r.conflicts.is_empty());
        // A word card moved on both sides to the same place but edited on one: fine too.
        let mut m2 = base();
        m2.move_entry(WordsNormal, 0, WordsNsfw);
        let mut t2 = m2.clone();
        t2.entries_mut(WordsNsfw)[1].taboo.push("rot".into());
        assert_eq!(find(&merge(&b, &m2, &t2).result().unwrap(), "Apfel").unwrap(), (WordsNsfw, card("Apfel", &["Obst", "rot"])));
    }

    #[test]
    fn added_on_both_sides_differently_conflicts() {
        let b = base();
        let mut m = base();
        m.entries_mut(WordsNormal).push(card("Zebra", &["Streifen"]));
        let mut t = base();
        t.entries_mut(WordsNsfw).push(card("zebra", &["Pferd"]));
        let mut r = merge(&b, &m, &t);
        assert_eq!(r.conflicts.len(), 1);
        assert_eq!(r.conflicts[0].reason, Reason::BothAdded);
        assert_eq!(r.conflicts[0].base, None);
        r.conflicts[0].choice = Some(Choice::Theirs);
        let out = r.result().unwrap();
        assert_eq!(find(&out, "zebra").unwrap().0, WordsNsfw);
        assert!(find(&out, "Zebra").is_none());
        // Same card added on both sides: one card.
        let mut t2 = base();
        t2.entries_mut(WordsNormal).push(card("Zebra", &["Streifen"]));
        let out = merge(&b, &m, &t2).result().unwrap();
        assert_eq!(texts(&out, WordsNormal), ["Apfel", "Bär", "Cello", "Zebra"]);
    }

    #[test]
    fn text_lists_match_by_text() {
        let b = base();
        let mut m = base();
        m.entries_mut(GleichNormal)[0].text = "Ein Tier mit vier BEINEN".into();
        let mut t = base();
        t.entries_mut(GleichNormal).push(Entry::text("Etwas Kariertes"));
        t.entries_mut(GleichNsfw).push(Entry::text("Ein Tier mit vier Beinen"));
        let r = merge(&b, &m, &t);
        assert!(r.conflicts.is_empty());
        let out = r.result().unwrap();
        assert_eq!(texts(&out, GleichNormal), ["Ein Tier mit vier BEINEN", "Etwas Kariertes"]);
        // Theirs also put the same text into NSFW (another place of the same entry), I edited the
        // text: both are kept, so the edit shows in both places.
        assert_eq!(texts(&out, GleichNsfw), ["Ein Tier mit vier BEINEN"]);
        // Two different texts that only differ in case are the same entry.
        let mut m2 = base();
        m2.entries_mut(SlfBild).push(Entry::text("Etwas Blaues"));
        let mut t2 = base();
        t2.entries_mut(SlfBild).push(Entry::text("etwas blaues"));
        assert_eq!(merge(&b, &m2, &t2).conflicts[0].reason, Reason::BothAdded);
    }
}
