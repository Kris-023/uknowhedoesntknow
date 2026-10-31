import { deckLock } from '../../src/words/content';
import { FALLBACK } from '../../src/words/fallback';
import type { Content, DeckEntry } from '../../src/words/types';

// Made-up content standing in for the sealed decks: the real ones never appear in the repo, so the
// tests must not name a single one of them.

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const card = (prefix: string, i: number): DeckEntry => [`${prefix} ${i}`, `${prefix}-Tabu ${i}a`, `${prefix}-Tabu ${i}b`, `${prefix}-Tabu ${i}c`, `${prefix}-Tabu ${i}d`];

export const FIXTURE: Content = {
  v: 1,
  words: { normal: range(30).map((i) => card('Testbegriff', i)), nsfw: range(12).map((i) => card('Derbtest', i)) },
  gleich: { normal: range(40).map((i) => `Testfrage ${i}`), nsfw: range(15).map((i) => `Derbe Testfrage ${i}`) },
  zeig: { normal: range(40).map((i) => `Testende ${i}`), nsfw: range(15).map((i) => `derbes Testende ${i}`) },
  slf: { text: [...FALLBACK.slf.text], image: [...FALLBACK.slf.image], nsfw: ['Derbkategorie A', 'Derbkategorie B', 'Derbkategorie C'] },
};

/** Games read the global deck lock; this puts the fixture in as if it had been unlocked. Returns the undo. */
export function useFixture(c: Content = FIXTURE): () => void {
  const before = deckLock.content;
  deckLock.content = c;
  return () => {
    deckLock.content = before;
  };
}
