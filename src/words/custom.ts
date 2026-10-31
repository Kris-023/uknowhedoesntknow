import { WORDS } from '../config';
import { DECK_IDS, type DeckId, type WordCard } from './types';

// Word cards from players (not built in), and the stable player id they carry. The lists they live
// in are in lists.ts; this file only validates cards, so the games can use it without the store.

/** Where the single word list of earlier versions lived; lists.ts migrates it into "Meine Wörter". */
export const LEGACY_WORDS_KEY = 'ukhdk.words.v1';
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
