import { WORDS } from '../config';
import { DECK_IDS, type DeckId, type WordCard } from './types';

// The player's own submissions, kept in this browser like the profile. They travel to the others
// only while playing in a room together; "Übernehmen" copies someone else's card into your own list.

const KEY = 'ukhdk.words.v1';
const ID_KEY = 'ukhdk.player.v1';

/** Same word, different spelling of spaces or case: counts as a duplicate. */
export const normWord = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');

const clean = (s: unknown): string | null => {
  if (typeof s !== 'string') return null;
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > 0 && t.length <= WORDS.maxChars ? t : null;
};

/** Validates a card from storage, a file or a peer; anything odd is dropped, never trusted. */
export function parseCard(v: unknown): WordCard | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const word = clean(o.word);
  if (!word || typeof o.id !== 'string' || o.id.length > 80) return null;
  const taboo = Array.isArray(o.taboo) ? o.taboo.map(clean).filter((t): t is string => !!t && normWord(t) !== normWord(word)).slice(0, WORDS.maxTaboo) : [];
  const by = o.by as Record<string, unknown> | undefined;
  const author = by && typeof by.id === 'string' && by.id.length <= 40 ? { id: by.id, name: clean(by.name) ?? 'Jemand' } : undefined;
  const deck: DeckId = DECK_IDS.includes(o.deck as DeckId) ? (o.deck as DeckId) : 'custom';
  return { id: o.id, deck, word, taboo, by: author };
}

function read(): WordCard[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.map(parseCard).filter((c): c is WordCard => !!c) : [];
  } catch {
    return [];
  }
}

let cards: WordCard[] = read();
const listeners = new Set<() => void>();

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cards));
  } catch {
    // Not remembered, but the list still works for this session.
  }
  for (const f of listeners) f();
}

/** Without storage the id lasts as long as the tab. */
let memoryId: string | undefined;

/** Stable per-browser id, so cards keep their author across sessions and name changes. */
export function playerId(): string {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = crypto.randomUUID().slice(0, 12);
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return (memoryId ??= crypto.randomUUID().slice(0, 12));
  }
}

export function customCards(): readonly WordCard[] {
  return cards;
}

export function onCustom(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function hasWord(word: string): boolean {
  const n = normWord(word);
  return cards.some((c) => normWord(c.word) === n);
}

/** Add a new card of mine. Returns an error text for the form, or null when it was added. */
export function addCustom(word: string, taboo: string[], name: string): string | null {
  const w = clean(word);
  if (!w) return `Das Wort fehlt oder ist länger als ${WORDS.maxChars} Zeichen.`;
  if (hasWord(w)) return `„${w}“ ist schon in deiner Liste.`;
  if (cards.length >= WORDS.maxCustom) return `Deine Liste ist voll (${WORDS.maxCustom} Wörter).`;
  const id = playerId();
  const card = parseCard({ id: `c:${id}:${Date.now().toString(36)}`, deck: 'custom', word: w, taboo, by: { id, name } });
  if (!card) return 'Das Wort ließ sich nicht speichern.';
  cards = [card, ...cards];
  save();
  return null;
}

export function removeCustom(id: string): void {
  cards = cards.filter((c) => c.id !== id);
  save();
}

/** Someone else's card into my list (keeps its author); false if I have that word already. */
export function adoptCard(card: WordCard): boolean {
  const c = parseCard(card);
  if (!c || hasWord(c.word) || cards.length >= WORDS.maxCustom) return false;
  cards = [{ ...c, deck: 'custom' }, ...cards];
  save();
  return true;
}

/** The whole list as text to save or send to a friend. */
export function exportCustom(): string {
  return JSON.stringify({ ukhdkWords: 1, cards }, null, 1);
}

/** Cards from an exported text; duplicates are skipped. Returns how many were new. */
export function importCustom(text: string): number {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Das ist keine Wortliste (kein gültiges JSON).');
  }
  const list = Array.isArray(raw) ? raw : (raw as { cards?: unknown })?.cards;
  if (!Array.isArray(list)) throw new Error('Das ist keine Wortliste.');
  let added = 0;
  for (const v of list) {
    const c = parseCard(v);
    if (c && !hasWord(c.word) && cards.length < WORDS.maxCustom) {
      cards.push({ ...c, deck: 'custom' });
      added++;
    }
  }
  if (added) save();
  return added;
}
