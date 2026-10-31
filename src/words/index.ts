import { content } from './content';
import { normWord } from './custom';
import { FALLBACK } from './fallback';
import type { Content, DeckEntry, DeckId, WordCard } from './types';

export type { DeckId, WordCard } from './types';

export const DECK_NAMES: Record<DeckId, string> = { normal: 'Normal', nsfw: 'NSFW', custom: 'Eigene' };

const slug = (s: string) => normWord(s).replace(/[^a-z0-9äöüß]+/g, '-');

function build(deck: DeckId, prefix: string, entries: readonly DeckEntry[]): WordCard[] {
  return entries.map(([word, ...taboo]) => ({ id: `${prefix}:${slug(word)}`, deck, word, taboo }));
}

let built: { from: Content; cards: Record<'normal' | 'nsfw', WordCard[]> } | null = null;

/**
 * Built-in decks as cards, from the unlocked vault or the fallback. Ids come from the word, so they
 * stay put when the list is reordered; fallback cards have their own prefix, so a card played before
 * the decks were unlocked never counts as one of the sealed deck.
 */
export function builtinDeck(deck: 'normal' | 'nsfw', from: Content = content()): readonly WordCard[] {
  if (built?.from !== from) {
    const n = from === FALLBACK ? 'f' : 'n';
    built = { from, cards: { normal: build('normal', n, from.words.normal), nsfw: build('nsfw', 'x', from.words.nsfw) } };
  }
  return built.cards[deck];
}

/**
 * Pool for a round: the chosen built-in decks plus everyone's submissions in the room, without
 * duplicate words (the first one wins, so a built-in word beats the same submission).
 */
export function wordPool(decks: readonly DeckId[], custom: Iterable<WordCard>, from: Content = content()): WordCard[] {
  const out: WordCard[] = [];
  const seen = new Set<string>();
  const add = (c: WordCard) => {
    const n = normWord(c.word);
    if (seen.has(n)) return;
    seen.add(n);
    out.push(c);
  };
  for (const d of decks) if (d !== 'custom') builtinDeck(d, from).forEach(add);
  if (decks.includes('custom')) for (const c of custom) add(c);
  return out;
}

/**
 * Draw an unused card. Submissions by the people who have to guess are skipped while anything else
 * is left (they'd know the answer); when everything was played, the used list starts over.
 */
export function drawCard(pool: readonly WordCard[], used: ReadonlySet<string>, guessers: ReadonlySet<string>, rand: () => number = Math.random): WordCard | null {
  const fresh = pool.filter((c) => !used.has(c.id));
  const fair = fresh.filter((c) => !c.by || !guessers.has(c.by.id));
  const from = fair.length ? fair : fresh.length ? fresh : pool;
  return from.length ? from[Math.floor(rand() * from.length)] : null;
}
