import { LISTS } from '../config';
import { LEGACY_WORDS_KEY, normWord, parseCard, playerId } from './custom';
import type { DeckId, WordCard } from './types';

// "Eigene Listen": the player's own named lists, kept in this browser like the profile. Each list
// has a kind, which says which games draw from it. Lists that are switched on travel to the others
// only while playing in a room together with the deck "Eigene" on (game/roomLists.ts).

export const LIST_KINDS = ['words', 'zeig', 'fragen', 'kategorien'] as const;
export type ListKind = (typeof LIST_KINDS)[number];
/** Kinds whose entries are plain text (everything but word cards). */
export type TextKind = Exclude<ListKind, 'words'>;

/** Names for the menu and the hints; `games` lists where the entries show up. */
export const KIND_INFO: Record<ListKind, { label: string; games: string; one: string; many: string; example: string }> = {
  words: { label: 'Wörter', games: '„Sag’s anders“ und „Ahnungslos“', one: 'Wort', many: 'Wörter', example: 'z. B. Bauchklatscher' },
  zeig: { label: 'Zeig drauf', games: '„Zeig drauf“', one: 'Frage', many: 'Fragen', example: 'z. B. im Büro einschlafen' },
  fragen: { label: 'Startfragen', games: '„Gleich gedacht“', one: 'Frage', many: 'Fragen', example: 'z. B. Etwas, das man im Büro klaut' },
  kategorien: { label: 'Kategorien', games: '„Stadt, Land, Fluss“', one: 'Kategorie', many: 'Kategorien', example: 'z. B. Kollege' },
};

export interface Author {
  id: string;
  name: string;
}

export interface ListItem {
  /** Stable across sessions (`c:<player>:<n>`); word cards keep it as their card id. */
  id: string;
  text: string;
  /** Word cards only: the forbidden words. */
  taboo: string[];
  /** Taken over from someone else: who made it. */
  by?: Author;
}

export interface CustomList {
  id: string;
  kind: ListKind;
  name: string;
  /** "Im Raum nutzen": only lists that are on travel to the room. */
  on: boolean;
  items: ListItem[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** What one player brings into a room: the entries of all lists that are on, by kind. */
export interface SharedLists {
  pid: string;
  words: WordCard[];
  zeig: string[];
  fragen: string[];
  kategorien: string[];
}

const KEY = 'ukhdk.lists.v1';
/** Where "Übernehmen" puts cards of others. */
export const ADOPT_LIST = 'Übernommen';
/** The single word list of earlier versions becomes this list. */
export const MIGRATED_LIST = 'Meine Wörter';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Control characters out, blanks collapsed, trimmed; null if nothing is left. */
function squeeze(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  return t || null;
}

/** People paste whole questions: "Wer würde am ehesten …?" is the frame the game adds itself. */
const ZEIG_FRAME = /^wer\s+würde\s+(am\s+ehesten\s+)?/i;

/** An entry as it is kept: cleaned, within the length of its kind, or null. */
export function cleanEntry(kind: ListKind, v: unknown): string | null {
  let t = squeeze(v);
  if (!t) return null;
  if (kind === 'zeig') t = t.replace(ZEIG_FRAME, '').replace(/[?？…\s]+$/u, '').trim();
  return t && t.length <= LISTS.maxChars[kind] ? t : null;
}

function parseAuthor(v: unknown): Author | undefined {
  if (!isObj(v) || typeof v.id !== 'string' || v.id.length > 40) return undefined;
  return { id: v.id, name: squeeze(v.name)?.slice(0, 40) ?? 'Jemand' };
}

const validId = (v: unknown): string => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? v : '');

/**
 * One entry from storage, a file or a peer. A plain string is an entry without id (the caller gives
 * it one). Word cards of earlier versions (`word` instead of `text`) are read too.
 */
export function parseItem(kind: ListKind, v: unknown): ListItem | null {
  if (typeof v === 'string') {
    const text = cleanEntry(kind, v);
    return text ? { id: '', text, taboo: [] } : null;
  }
  if (!isObj(v)) return null;
  if (kind === 'words') {
    const c = parseCard({ ...v, word: v.word ?? v.text, id: validId(v.id) || 'x' });
    return c ? { id: validId(v.id), text: c.word, taboo: c.taboo, ...(c.by ? { by: c.by } : {}) } : null;
  }
  const text = cleanEntry(kind, v.text);
  if (!text) return null;
  const by = parseAuthor(v.by);
  return { id: validId(v.id), text, taboo: [], ...(by ? { by } : {}) };
}

let seq = 0;
/** Ids from the player id and the time, like the word cards always had. */
const newId = (prefix: string, pid: string) => `${prefix}:${pid}:${Date.now().toString(36)}${(seq++ % 1296).toString(36).padStart(2, '0')}`;

/** Items without duplicates (same text, spaces and case aside), each with an id, at most `max`. */
function tidy(items: (ListItem | null)[], pid: string, max: number = LISTS.maxItems): ListItem[] {
  const out: ListItem[] = [];
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const it of items) {
    if (!it || out.length >= max) continue;
    const n = normWord(it.text);
    if (seen.has(n)) continue;
    seen.add(n);
    const id = it.id && !ids.has(it.id) ? it.id : newId('c', pid);
    ids.add(id);
    out.push({ ...it, id });
  }
  return out;
}

const cleanName = (v: unknown): string | null => {
  const t = squeeze(v);
  return t ? t.slice(0, LISTS.maxNameChars).trim() : null;
};

export function parseList(v: unknown, pid: string): CustomList | null {
  if (!isObj(v) || !LIST_KINDS.includes(v.kind as ListKind)) return null;
  const kind = v.kind as ListKind;
  const items = Array.isArray(v.items) ? tidy(v.items.map((x) => parseItem(kind, x)), pid) : [];
  return { id: validId(v.id) || newId('l', pid), kind, name: cleanName(v.name) ?? KIND_INFO[kind].label, on: v.on !== false, items };
}

/** All lists from storage: valid ones only, unique ids, at most LISTS.maxLists. */
export function parseLists(v: unknown, pid: string): CustomList[] {
  const raw = isObj(v) && Array.isArray(v.lists) ? v.lists : Array.isArray(v) ? v : [];
  const out: CustomList[] = [];
  const ids = new Set<string>();
  for (const x of raw) {
    const l = parseList(x, pid);
    if (!l || out.length >= LISTS.maxLists) continue;
    if (ids.has(l.id)) l.id = newId('l', pid);
    ids.add(l.id);
    out.push(l);
  }
  return out;
}

/**
 * Lists from storage. Without any yet, the word list of earlier versions becomes "Meine Wörter";
 * its old key is left alone, so nothing is lost even if the new data can't be written.
 */
export function loadLists(storage: StorageLike | null, pid: string): { lists: CustomList[]; migrated: boolean } {
  if (!storage) return { lists: [], migrated: false };
  try {
    const raw = storage.getItem(KEY);
    if (raw !== null) return { lists: parseLists(JSON.parse(raw), pid), migrated: false };
    const old = JSON.parse(storage.getItem(LEGACY_WORDS_KEY) ?? '[]') as unknown;
    const items = Array.isArray(old) ? tidy(old.map((c) => parseItem('words', c)), pid) : [];
    if (!items.length) return { lists: [], migrated: false };
    return { lists: [{ id: newId('l', pid), kind: 'words', name: MIGRATED_LIST, on: true, items }], migrated: true };
  } catch {
    return { lists: [], migrated: false };
  }
}

/** A peer's lists, validated and cut to the limits; unknown or broken parts are just empty. */
export function parseShared(v: unknown): SharedLists | null {
  if (!isObj(v) || typeof v.pid !== 'string' || !v.pid || v.pid.length > 40) return null;
  const words: WordCard[] = [];
  const seen = new Set<string>();
  if (Array.isArray(v.words)) {
    for (const x of v.words.slice(0, LISTS.maxShared.words)) {
      const c = parseCard(x);
      if (!c || seen.has(normWord(c.word))) continue;
      seen.add(normWord(c.word));
      words.push({ ...c, deck: 'custom' });
    }
  }
  const texts = (kind: TextKind) => {
    const raw = v[kind];
    return Array.isArray(raw) ? uniqueTexts(raw.slice(0, LISTS.maxShared[kind]).map((x) => cleanEntry(kind, x))) : [];
  };
  return { pid: v.pid, words, zeig: texts('zeig'), fragen: texts('fragen'), kategorien: texts('kategorien') };
}

/** Texts without empties and duplicates (spaces and case aside), first one wins. */
export function uniqueTexts(list: Iterable<string | null | undefined>, avoid: Iterable<string> = []): string[] {
  const seen = new Set([...avoid].map(normWord));
  const out: string[] = [];
  for (const t of list) {
    if (!t || seen.has(normWord(t))) continue;
    seen.add(normWord(t));
    out.push(t);
  }
  return out;
}

/**
 * Questions (or categories) for a round: the built-ins by deck plus the room's own when "Eigene" is
 * on. A room with only "Eigene" plays only its own if there are at least `need`, else the normal ones
 * fill in. As before, the normal ones stay in with NSFW (there are few crude questions).
 */
export function questionPool(decks: readonly DeckId[], normal: readonly string[], nsfw: readonly string[], custom: readonly string[], need: number): string[] {
  const own = decks.includes('custom') ? uniqueTexts(custom) : [];
  if (!decks.includes('normal') && !decks.includes('nsfw') && own.length >= need) return own;
  const base = decks.includes('nsfw') ? [...normal, ...nsfw] : [...normal];
  return [...base, ...uniqueTexts(own, base)];
}

/** Entries from a pasted text: an export (JSON) or simply one per line; words as "Wort: verboten, verboten". */
function parseImport(kind: ListKind, text: string): { name: string | null; items: ListItem[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const items = text
      .split(/\r?\n/)
      .map((line) => {
        if (kind !== 'words') return parseItem(kind, line);
        const [word, rest = ''] = line.split(/:(.*)/s);
        return parseItem('words', { word, taboo: rest.split(/[,;]/) });
      })
      .filter((x): x is ListItem => !!x);
    return { name: null, items };
  }
  if (isObj(raw) && typeof raw.kind === 'string' && LIST_KINDS.includes(raw.kind as ListKind) && raw.kind !== kind) {
    throw new Error(`Das ist eine Liste für „${KIND_INFO[raw.kind as ListKind].label}“. Importier sie dort.`);
  }
  // Exports of the old word list: {ukhdkWords, cards}.
  if (isObj(raw) && 'ukhdkWords' in raw && kind !== 'words') throw new Error(`Das ist eine Liste für „${KIND_INFO.words.label}“. Importier sie dort.`);
  const list = Array.isArray(raw) ? raw : isObj(raw) ? (raw.items ?? raw.cards) : null;
  if (!Array.isArray(list)) throw new Error('Das ist keine Liste.');
  return { name: isObj(raw) ? cleanName(raw.name) : null, items: list.map((x) => parseItem(kind, x)).filter((x): x is ListItem => !!x) };
}

/**
 * The player's lists. Every change is saved at once and announced; `version` lets the room know
 * when to send the lists again.
 */
export class ListStore {
  private data: CustomList[];
  private listeners = new Set<() => void>();
  version = 0;

  constructor(
    private storage: StorageLike | null,
    private pid: () => string = playerId,
  ) {
    const { lists, migrated } = loadLists(storage, pid());
    this.data = lists;
    if (migrated) this.write();
  }

  all(): readonly CustomList[] {
    return this.data;
  }

  ofKind(kind: ListKind): CustomList[] {
    return this.data.filter((l) => l.kind === kind);
  }

  get(id: string): CustomList | undefined {
    return this.data.find((l) => l.id === id);
  }

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private write(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify({ v: 1, lists: this.data }));
    } catch {
      // Not remembered, but the lists still work for this session.
    }
  }

  private save(): void {
    this.version++;
    this.write();
    for (const f of this.listeners) f();
  }

  /** A new empty list; an error text if there are too many. */
  create(kind: ListKind, name: string): CustomList | string {
    if (this.data.length >= LISTS.maxLists) return `Mehr als ${LISTS.maxLists} Listen gehen nicht.`;
    const n = this.ofKind(kind).length + 1;
    const list: CustomList = { id: newId('l', this.pid()), kind, name: cleanName(name) ?? `Liste ${n}`, on: true, items: [] };
    this.data = [...this.data, list];
    this.save();
    return list;
  }

  rename(id: string, name: string): void {
    const l = this.get(id);
    const n = cleanName(name);
    if (!l || !n || n === l.name) return;
    l.name = n;
    this.save();
  }

  setOn(id: string, on: boolean): void {
    const l = this.get(id);
    if (!l || l.on === on) return;
    l.on = on;
    this.save();
  }

  remove(id: string): void {
    this.data = this.data.filter((l) => l.id !== id);
    this.save();
  }

  /** Add an entry of mine. Returns an error text for the form, or null when it was added. */
  add(listId: string, text: string, taboo: string[] = []): string | null {
    const l = this.get(listId);
    if (!l) return 'Die Liste gibt es nicht mehr.';
    const it = parseItem(l.kind, l.kind === 'words' ? { word: text, taboo } : { text });
    const info = KIND_INFO[l.kind];
    if (!it) return `Leer oder länger als ${LISTS.maxChars[l.kind]} Zeichen.`;
    if (l.items.some((x) => normWord(x.text) === normWord(it.text))) return `„${it.text}“ ist schon in dieser Liste.`;
    if (l.items.length >= LISTS.maxItems) return `Die Liste ist voll (${LISTS.maxItems} ${info.many}).`;
    l.items = [{ ...it, id: newId('c', this.pid()) }, ...l.items];
    this.save();
    return null;
  }

  removeItem(listId: string, itemId: string): void {
    const l = this.get(listId);
    if (!l) return;
    l.items = l.items.filter((x) => x.id !== itemId);
    this.save();
  }

  /** In any of my lists of this kind. */
  has(kind: ListKind, text: string): boolean {
    const n = normWord(text);
    return this.ofKind(kind).some((l) => l.items.some((x) => normWord(x.text) === n));
  }

  /** Someone else's entry into my list "Übernommen" (keeps its author); false if I have it already. */
  adopt(kind: ListKind, entry: { id?: string; text: string; taboo?: string[]; by?: Author }): boolean {
    const it = parseItem(kind, kind === 'words' ? { ...entry, word: entry.text } : entry);
    if (!it || this.has(kind, it.text)) return false;
    let l = this.ofKind(kind).find((x) => x.name === ADOPT_LIST);
    if (!l) {
      const made = this.create(kind, ADOPT_LIST);
      if (typeof made === 'string') return false;
      l = made;
    }
    if (l.items.length >= LISTS.maxItems) return false;
    l.items = [{ ...it, id: it.id || newId('c', this.pid()) }, ...l.items];
    this.save();
    return true;
  }

  /** One list as text to save or send to a friend. */
  exportList(id: string): string {
    const l = this.get(id);
    if (!l) return '';
    const items = l.items.map((x) => (l.kind === 'words' ? x : { id: x.id, text: x.text, ...(x.by ? { by: x.by } : {}) }));
    return JSON.stringify({ ukhdkList: 1, kind: l.kind, name: l.name, items }, null, 1);
  }

  /**
   * Entries from an exported or typed text. They go into my list of the same name (the export's
   * name, else "Importiert"), which is made if needed. Throws a message for the user.
   */
  importText(kind: ListKind, text: string): { added: number; name: string } {
    const { name, items } = parseImport(kind, text);
    if (!items.length) throw new Error('Keine Einträge gefunden.');
    const target = name ?? 'Importiert';
    let l = this.ofKind(kind).find((x) => normWord(x.name) === normWord(target));
    if (!l) {
      const made = this.create(kind, target);
      if (typeof made === 'string') throw new Error(made);
      l = made;
    }
    const before = l.items.length;
    l.items = tidy([...l.items, ...items], this.pid());
    const added = l.items.length - before;
    this.save();
    return { added, name: l.name };
  }

  /** Entries of all lists that are on, without duplicates. */
  enabled(kind: ListKind): ListItem[] {
    const out: ListItem[] = [];
    const seen = new Set<string>();
    for (const l of this.data) {
      if (l.kind !== kind || !l.on) continue;
      for (const it of l.items) {
        const n = normWord(it.text);
        if (seen.has(n)) continue;
        seen.add(n);
        out.push(it);
      }
    }
    return out;
  }

  /** My word cards in play. Own entries carry my id, so I don't get them to guess. */
  cards(): WordCard[] {
    const me = { id: this.pid(), name: '' };
    return this.enabled('words').map((it) => ({ id: it.id, deck: 'custom', word: it.text, taboo: it.taboo, by: it.by ?? me }));
  }

  /** What I bring into a room. */
  shareable(): SharedLists {
    const t = (k: TextKind) => this.enabled(k).slice(0, LISTS.maxShared[k]).map((x) => x.text);
    return { pid: this.pid(), words: this.cards().slice(0, LISTS.maxShared.words), zeig: t('zeig'), fragen: t('fragen'), kategorien: t('kategorien') };
  }
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The lists of this browser. */
export const myLists = new ListStore(browserStorage());
