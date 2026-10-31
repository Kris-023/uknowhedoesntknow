// Shared word cards for every word game (first: "Sag's anders"). A card is a term plus the words
// that must not be used to explain it; games that only need the term ignore `taboo`.

export const DECK_IDS = ['normal', 'nsfw', 'custom'] as const;
export type DeckId = (typeof DECK_IDS)[number];

export interface WordCard {
  /** Stable across sessions: `n:…`/`x:…` for the sealed decks, `f:…` for the public fallback, `c:<author>:<n>` for submissions. */
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

/**
 * Built-in content of all games: the sealed decks from src/words/vault.json once unlocked, the small
 * public fallback (fallback.ts) before. NSFW parts are empty in the fallback.
 */
export interface Content {
  v: 1;
  /** Word cards: "Sag's anders", "Ahnungslos". */
  words: { normal: readonly DeckEntry[]; nsfw: readonly DeckEntry[] };
  /** Start questions of "Gleich gedacht". */
  gleich: { normal: readonly string[]; nsfw: readonly string[] };
  /** Endings for "Wer würde am ehesten …?" in "Zeig drauf". */
  zeig: { normal: readonly string[]; nsfw: readonly string[] };
  /** "Stadt, Land, Fluss": categories of text rounds, picture rounds, and the NSFW extras. */
  slf: { text: readonly string[]; image: readonly string[]; nsfw: readonly string[] };
}
