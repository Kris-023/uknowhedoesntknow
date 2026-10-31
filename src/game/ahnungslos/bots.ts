import { wordPool } from '../../words';
import type { DeckId } from '../../words/types';
import { matches, normalize } from '../gleich/logic';
import type { LocalGameRoom } from '../minigame';
import { AhnungGame, type AhnRoom } from './game';
import { cleanClue, givesAway, type Clue } from './logic';

/** Vague words a clueless bot says when nobody has given a clue yet. */
const VAGUE = ['Alltag', 'Klassiker', 'Typisch', 'Manchmal', 'Praktisch', 'Bekannt', 'Groß', 'Wichtig'];

/** One word of a forbidden phrase: the longest one, so "im Kühlschrank" gives "Kühlschrank". */
const oneWord = (s: string) => cleanClue(s) ?? cleanClue([...s.split(/\s+/)].sort((a, b) => b.length - a.length)[0]);

/** A bot's clue: knowing the word, an unused forbidden word of the card; clueless, someone else's clue (or a vague one). */
export function botClue(me: string, word: string | null, taboo: readonly string[], clues: readonly Clue[], rand: () => number): string {
  const said = clues.map((c) => c.word).filter((w): w is string => !!w);
  const fresh = (w: string) => !said.some((x) => matches(x, w));
  if (word) {
    const ideas = taboo.map(oneWord).filter((w): w is string => !!w && fresh(w) && !givesAway(w, word));
    if (ideas.length) return ideas[Math.floor(rand() * ideas.length)];
    return VAGUE[Math.floor(rand() * VAGUE.length)];
  }
  const others = clues.filter((c) => c.by !== me && c.word).map((c) => c.word!);
  if (others.length) return others[Math.floor(rand() * others.length)];
  return VAGUE[Math.floor(rand() * VAGUE.length)];
}

/**
 * A bot's suspect: whoever copied clues (said what someone said before) or skipped most, the
 * plain lazy tells of a clueless player. Ties, and a bit of noise, are random.
 */
export function botSuspect(me: string, players: readonly string[], clues: readonly Clue[], rand: () => number): string | null {
  const others = players.filter((p) => p !== me);
  if (!others.length) return null;
  if (rand() < 0.2) return others[Math.floor(rand() * others.length)];
  const score = new Map(others.map((p) => [p, 0]));
  clues.forEach((c, i) => {
    if (!score.has(c.by)) return;
    if (!c.word) score.set(c.by, score.get(c.by)! + 1);
    else if (clues.slice(0, i).some((e) => e.by !== c.by && e.word && matches(e.word, c.word!))) score.set(c.by, score.get(c.by)! + 1);
  });
  const best = Math.max(...score.values());
  const top = others.filter((p) => score.get(p) === best);
  return top[Math.floor(rand() * top.length)];
}

/** The caught bot's guess: the card whose forbidden words overlap the clues most (it can't do better than the deck). */
export function botGuess(clues: readonly Clue[], decks: readonly DeckId[], rand: () => number): string {
  const said = clues.map((c) => c.word).filter((w): w is string => !!w);
  let best: string[] = [];
  let bestN = 0;
  for (const c of wordPool(decks.length ? decks : ['normal'], [])) {
    const n = said.filter((w) => c.taboo.some((t) => matches(t, w) || normalize(t).split(' ').some((p) => matches(p, w)))).length;
    if (n > bestN) {
      bestN = n;
      best = [c.word];
    } else if (n === bestN && n > 0) best.push(c.word);
  }
  if (best.length) return best[Math.floor(rand() * best.length)];
  return said.length ? said[Math.floor(rand() * said.length)] : 'Keine Ahnung';
}

/**
 * Test bots for the solo round: a clue a few seconds into their turn, a vote (they have no heads
 * to look with, so they pick directly) and a guess when caught.
 */
export class AhnungBots {
  private bots: { game: AhnungGame; wait: number; key: string }[] = [];

  constructor(
    private room: LocalGameRoom,
    ids: string[],
    private opts: AhnRoom,
  ) {
    for (const id of ids) this.bots.push({ game: new AhnungGame(room.net(id), { decks: () => opts.decks(), cards: () => [], pidOf: () => undefined }), wait: 0, key: '' });
  }

  tick(now: number): void {
    this.room.pump();
    for (const b of this.bots) {
      const g = b.game;
      g.tick(now);
      const s = g.state;
      if (!s || s.phase === 'done' || !g.knowsRole) continue;
      const me = g.selfId;
      const key = `${s.round}|${s.phase}|${s.turn}`;
      if (key !== b.key) {
        b.key = key;
        b.wait = now + (s.phase === 'clues' ? 2000 + Math.random() * 3500 : 2500 + Math.random() * 5000);
      }
      if (now < b.wait) continue;
      b.wait = Infinity;
      if (s.phase === 'clues' && g.onTurn === me) g.clue(botClue(me, g.myWord, g.taboo, s.clues, Math.random));
      else if (s.phase === 'vote' && !g.iLocked) g.lock(botSuspect(me, s.players, s.clues, Math.random));
      else if (s.phase === 'guess' && s.clueless === me) g.guess(botGuess(s.clues, this.opts.decks(), Math.random));
    }
  }
}
