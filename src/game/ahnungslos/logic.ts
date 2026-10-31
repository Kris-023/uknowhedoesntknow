import { AHNUNG } from '../../config';
import type { Rand } from '../../core/rng';
import { cleanWord, matches, normalize } from '../gleich/logic';
import { tally, type Picks } from '../zeig/logic';

// Rules of "Ahnungslos" as a pure state machine on the host. Everyone gets the same word but one
// player, who only learns that they are clueless. Reihum everyone says a clue word, then all point
// at whom they suspect. Caught: the clueless one may still win by guessing the word.
//
// Secrecy: the word and who is clueless live only in `AhnHost.secret` and in the private messages
// the host sends to each player; the public state names neither until the vote has caught someone
// (then `clueless`) or the round is over (then `word` too). The host is a player as well and its
// code holds the secret: there is no cheap way around that without a dealer outside the room, so
// the host's screen just never shows what its own player may not know (honest host, like the
// other games trust the host's verdicts).

export interface Clue {
  by: string;
  /** null: skipped (time ran out, or absent). */
  word: string | null;
}

export type Outcome = 'escaped' | 'guessed' | 'caught' | 'aborted';
/** Why a round was aborted: the host ended it, the host changed, the clueless one left, too few left. */
export type AbortReason = 'ended' | 'host' | 'gone' | 'few';

export interface AhnState {
  phase: 'clues' | 'vote' | 'guess' | 'done';
  round: number;
  /** Seat order. */
  players: string[];
  /** Turn order of the clue laps: seat order from a random start, AHNUNG.laps times. */
  seq: string[];
  /** Index into `seq` of whoever is on turn. */
  turn: number;
  clues: Clue[];
  /** Host ms: end of the turn, the vote or the guess. */
  deadline: number | null;
  /** Who locked their vote (not whom). */
  locked: string[];
  /** After the vote: voter -> suspect (null = no vote). */
  votes: Picks | null;
  /** After the vote: the one with the most votes, null on a tie or without votes. */
  accused: string | null;
  /** Public only once caught (guess) or at the end. */
  clueless: string | null;
  /** The caught player's guess, at the end. */
  guess: string | null;
  /** Public only at the end; null there too if the round was aborted by a new host. */
  word: string | null;
  outcome: Outcome | null;
  why: AbortReason | null;
  scores: Record<string, number>;
}

export interface Secret {
  word: string;
  /** The card's forbidden words: what the bots use as clues. */
  taboo: string[];
  clueless: string;
}

export type Intent =
  | { a: 'clue'; word: string }
  | { a: 'aim'; id: string | null; lock: boolean }
  | { a: 'guess'; word: string }
  | { a: 'end' };

export function parseIntent(v: unknown): Intent | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.a === 'clue' || o.a === 'guess') return typeof o.word === 'string' && o.word.length <= 200 ? { a: o.a, word: o.word } : null;
  if (o.a === 'aim') return (o.id === null || (typeof o.id === 'string' && o.id.length <= 64)) && typeof o.lock === 'boolean' ? { a: 'aim', id: o.id as string | null, lock: o.lock } : null;
  return o.a === 'end' ? { a: 'end' } : null;
}

/** A clue as typed: one word, at most AHNUNG.maxClueLen characters. Null if it isn't one word. */
export function cleanClue(raw: unknown): string | null {
  const w = cleanWord(raw, AHNUNG.maxClueLen);
  return w && !/\s/.test(w) ? w : null;
}

export function cleanGuess(raw: unknown): string | null {
  return cleanWord(raw, AHNUNG.maxGuessLen);
}

/** The clue is the word itself, or has it inside ("Haustür" for "Tür"): that would tell the clueless one. */
export function givesAway(clue: string, word: string): boolean {
  if (matches(clue, word)) return true;
  const c = normalize(clue).replace(/ /g, '');
  const w = normalize(word).replace(/ /g, '');
  return w.length >= 3 && c.includes(w);
}

/** Seat order from `start`, `laps` times round the table. */
export function turnOrder(players: readonly string[], start: number, laps: number = AHNUNG.laps): string[] {
  const n = players.length;
  const out: string[] = [];
  for (let i = 0; i < n * laps; i++) out.push(players[(start + i) % n]);
  return out;
}

export class AhnHost {
  state: AhnState;
  /** Who is in the room right now; null = everyone (tests). Absent players never block anything. */
  present: ReadonlySet<string> | null = null;
  /** Null after a host change: the new host never learned it. */
  secret: Secret | null;
  private aims = new Map<string, string | null>();

  constructor(players: string[], card: { word: string; taboo: readonly string[] }, clueless: string, start: number, scores: Record<string, number> = {}, round = 1, now = Date.now()) {
    this.secret = { word: card.word, taboo: [...card.taboo], clueless };
    this.state = {
      phase: 'clues',
      round,
      players: [...players],
      seq: turnOrder(players, start),
      turn: 0,
      clues: [],
      deadline: now + AHNUNG.clueS * 1000,
      locked: [],
      votes: null,
      accused: null,
      clueless: null,
      guess: null,
      word: null,
      outcome: null,
      why: null,
      scores: Object.fromEntries(players.map((p) => [p, scores[p] ?? 0])),
    };
  }

  /** The clueless player and the start of the turns, both uniform. */
  static create(players: string[], card: { word: string; taboo: readonly string[] }, rng: Rand, scores: Record<string, number> = {}, round = 1, now = Date.now()): AhnHost {
    const clueless = players[Math.floor(rng() * players.length)];
    const start = Math.floor(rng() * players.length);
    return new AhnHost(players, card, clueless, start, scores, round, now);
  }

  /**
   * A new host after the old one left. Only the old host knew who is clueless (and, if the new
   * host is the clueless one, the word), so a running round ends without points. Simpler and
   * harder to cheat than asking everyone to tell the new host their role.
   */
  static fromState(state: AhnState): AhnHost {
    const h = new AhnHost(state.players, { word: '', taboo: [] }, '', 0, state.scores, state.round);
    h.state = structuredClone(state);
    h.secret = null;
    if (h.state.phase !== 'done') h.finish('aborted', 'host');
    return h;
  }

  here(): string[] {
    return this.state.players.filter((p) => !this.present || this.present.has(p));
  }

  /** Whose clue it is, or null outside the clue laps. */
  get onTurn(): string | null {
    const s = this.state;
    return s.phase === 'clues' ? (s.seq[s.turn] ?? null) : null;
  }

  /** Apply an intent from `from`. Returns whether the public state changed. */
  intent(from: string, i: Intent, now: number, isHost: boolean): boolean {
    const s = this.state;
    if (i.a === 'end') {
      if (!isHost || s.phase === 'done') return false;
      this.finish('aborted', 'ended');
      return true;
    }
    if (!s.players.includes(from) || !this.secret) return false;
    switch (i.a) {
      case 'clue': {
        if (this.onTurn !== from) return false;
        const w = cleanClue(i.word);
        // Only those who know the word are held to it: refusing the clueless one's clue would tell them they hit it.
        if (!w || (from !== this.secret.clueless && givesAway(w, this.secret.word))) return false;
        s.clues.push({ by: from, word: w });
        this.nextTurn(now);
        return true;
      }
      case 'aim':
        if (s.phase !== 'vote' || s.locked.includes(from)) return false;
        if (i.id !== null && (i.id === from || !s.players.includes(i.id))) return false;
        this.aims.set(from, i.id);
        if (!i.lock) return false;
        s.locked.push(from);
        this.step(now);
        return true;
      case 'guess': {
        if (s.phase !== 'guess' || from !== this.secret.clueless) return false;
        const g = cleanGuess(i.word);
        if (!g) return false;
        this.resolve(g);
        return true;
      }
    }
  }

  /** Skip the player on turn (time ran out, or they are away). */
  pass(now: number): boolean {
    const p = this.onTurn;
    if (!p) return false;
    this.state.clues.push({ by: p, word: null });
    this.nextTurn(now);
    return true;
  }

  tick(now: number): boolean {
    return this.step(now);
  }

  private step(now: number): boolean {
    const s = this.state;
    const late = now >= (s.deadline ?? Infinity);
    if (s.phase === 'clues' && late) return this.pass(now);
    if (s.phase === 'vote') {
      const here = this.here();
      if (late || (here.length > 0 && here.every((p) => s.locked.includes(p)))) {
        this.closeVote(now);
        return true;
      }
    }
    if (s.phase === 'guess' && late) {
      this.resolve(null);
      return true;
    }
    return false;
  }

  private nextTurn(now: number): void {
    const s = this.state;
    s.turn++;
    if (s.turn < s.seq.length) s.deadline = now + AHNUNG.clueS * 1000;
    else this.toVote(now);
  }

  private toVote(now: number): void {
    const s = this.state;
    s.phase = 'vote';
    s.locked = [];
    s.deadline = now + AHNUNG.voteS * 1000;
    this.aims.clear();
  }

  private closeVote(now: number): void {
    const s = this.state;
    const sec = this.secret!;
    const votes: Picks = {};
    for (const p of s.players) {
      const t = this.aims.get(p) ?? null;
      votes[p] = t && s.players.includes(t) && t !== p ? t : null;
    }
    const { top } = tally(votes, s.players);
    s.votes = votes;
    s.accused = top.length === 1 ? top[0] : null;
    this.aims.clear();
    if (s.accused && s.accused === sec.clueless) {
      s.phase = 'guess';
      s.clueless = sec.clueless;
      s.deadline = now + AHNUNG.guessS * 1000;
      return;
    }
    s.scores[sec.clueless] = (s.scores[sec.clueless] ?? 0) + AHNUNG.escapePoints;
    this.finish('escaped');
  }

  private resolve(guess: string | null): void {
    const s = this.state;
    const sec = this.secret!;
    s.guess = guess;
    if (guess && matches(guess, sec.word)) {
      s.scores[sec.clueless] = (s.scores[sec.clueless] ?? 0) + AHNUNG.guessPoints;
      this.finish('guessed');
      return;
    }
    for (const p of s.players) if (p !== sec.clueless) s.scores[p] = (s.scores[p] ?? 0) + AHNUNG.catchPoints;
    this.finish('caught');
  }

  /** The end: everything is told (as far as this host knows it). */
  private finish(outcome: Outcome, why: AbortReason | null = null): void {
    const s = this.state;
    s.phase = 'done';
    s.outcome = outcome;
    s.why = why;
    s.deadline = null;
    s.locked = [];
    if (this.secret) {
      s.word = this.secret.word;
      s.clueless = this.secret.clueless;
    }
    this.aims.clear();
  }

  /** The Schaffner's fine, only while the clues go round. */
  penalize(id: string, points: number): boolean {
    if (this.state.phase !== 'clues' || !(id in this.state.scores)) return false;
    this.state.scores[id] -= points;
    return true;
  }

  /** A player came back under a new id (reload): everything that names them follows. */
  replace(oldId: string, newId: string): boolean {
    const s = this.state;
    if (!s.players.includes(oldId)) return false;
    const r = (id: string) => (id === oldId ? newId : id);
    s.players = s.players.map(r);
    s.seq = s.seq.map(r);
    s.locked = s.locked.map(r);
    for (const c of s.clues) c.by = r(c.by);
    if (s.votes) {
      const v: Picks = {};
      for (const [k, t] of Object.entries(s.votes)) v[r(k)] = t === null ? null : r(t);
      s.votes = v;
    }
    if (s.accused) s.accused = r(s.accused);
    if (s.clueless) s.clueless = r(s.clueless);
    if (this.secret) this.secret.clueless = r(this.secret.clueless);
    if (oldId in s.scores) {
      s.scores[newId] = s.scores[oldId];
      delete s.scores[oldId];
    }
    const aims = new Map<string, string | null>();
    for (const [k, v] of this.aims) aims.set(r(k), v === null ? null : r(v));
    this.aims = aims;
    return true;
  }

  /** Someone left for good. Without the clueless one, or with too few left, the round is off. */
  removePlayer(id: string, now: number): boolean {
    const s = this.state;
    if (!s.players.includes(id)) return false;
    const not = (p: string) => p !== id;
    s.players = s.players.filter(not);
    s.locked = s.locked.filter(not);
    // Their turns so far stay (the index keeps pointing at the same turn); those still to come are dropped.
    const onTurn = this.onTurn === id;
    s.seq = [...s.seq.slice(0, s.turn), ...s.seq.slice(s.turn).filter(not)];
    if (onTurn) s.deadline = now + AHNUNG.clueS * 1000;
    this.aims.delete(id);
    for (const [k, v] of this.aims) if (v === id) this.aims.set(k, null);
    if (s.phase === 'done') return true;
    if (id === this.secret?.clueless || s.players.length < AHNUNG.minPlayers) {
      this.finish('aborted', id === this.secret?.clueless ? 'gone' : 'few');
      return true;
    }
    if (s.phase === 'clues' && s.turn >= s.seq.length) this.toVote(now);
    this.step(now);
    return true;
  }
}
