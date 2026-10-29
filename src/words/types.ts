// Shared word cards for every word game (first: "Sag's anders"). A card is a term plus the words
// that must not be used to explain it; games that only need the term ignore `taboo`.

export const DECK_IDS = ['normal', 'nsfw', 'custom'] as const;
export type DeckId = (typeof DECK_IDS)[number];

export interface WordCard {
  /** Stable across sessions: `n:…`/`x:…` for built-in decks, `c:<author>:<n>` for submissions. */
  id: string;
  deck: DeckId;
  word: string;
  /** Close words that are off limits; the term itself and its parts always are. */
  taboo: string[];
  /** Submissions only: who made it (profile id and name at the time). */
  by?: { id: string; name: string };
}

/** Built-in deck entries are written compactly: term, then the forbidden words. */
export type DeckEntry = readonly [word: string, ...taboo: string[]];
