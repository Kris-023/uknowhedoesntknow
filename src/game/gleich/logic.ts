import { GLEICH } from '../../config';
import type { Rand } from '../../core/rng';
import { QUESTIONS_NORMAL } from '../../words/questions';

// Rules of "Gleich gedacht" as a pure state machine on the host. Cooperative: everyone writes a
// word without talking; if they all wrote the same one, everybody scores, else they try again
// with the last words in mind.
//
// Anti-peeking: the host is a player too, so words never pass through it in the clear. A player
// locks by sending only a commitment (SHA-256 of "salt|word"); once everybody has locked, each
// reveals {word, salt} to everyone and the commitments published in the state prove nobody changed
// their word after seeing the others'.

export type Words = Record<string, string | null>;

export interface GleichState {
  /** `reveal` covers collecting the revealed words (`words` still null) and showing them. */
  phase: 'write' | 'reveal' | 'done';
  round: number;
  /** 1-based number of the running try. */
  tryNo: number;
  /** Seat order. */
  players: string[];
  /** Question per player, try 1 only. Public: it is no secret worth guarding. */
  questions: Record<string, string>;
  /** Commitments of this try, by player. Present = locked. */
  commits: Record<string, string>;
  /** Verified words of the judged try (null = nothing valid: not locked, not revealed, mismatch); null until judged. */
  words: Words | null;
  /** The biggest group of matching words in the judged try. */
  group: string[];
  /** How many players were here when it was judged (the "3 von 4" denominator). */
  of: number;
  solved: boolean;
  /** Host ms: end of writing, of collecting the reveals, or of the reveal screen. */
  deadline: number | null;
  /** Players who want to go on. */
  ready: string[];
  vote: { voters: string[]; deadline: number } | null;
  /** A vote was already held in this try (once is enough). */
  voted: boolean;
  last: { result: 'yes' | 'no'; yes: number; no: number } | null;
  /** Judged tries before the running one (and the running one too once the round is over). */
  history: Words[];
  /** The try it was solved in, or null. */
  solvedTry: number | null;
  scores: Record<string, number>;
}

export type Intent = { a: 'lock'; c: string } | { a: 'call' } | { a: 'vote'; v: boolean } | { a: 'ready' } | { a: 'end' };

const HEX64 = /^[0-9a-f]{64}$/;
const SALT = /^[0-9a-f]{16,64}$/;

export function parseIntent(v: unknown): Intent | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.a === 'lock') return typeof o.c === 'string' && HEX64.test(o.c) ? { a: 'lock', c: o.c } : null;
  if (o.a === 'vote') return typeof o.v === 'boolean' ? { a: 'vote', v: o.v } : null;
  return o.a === 'call' || o.a === 'ready' || o.a === 'end' ? { a: o.a } : null;
}

// ---------- words ----------

/** A word as typed: control characters out, blanks collapsed, trimmed, at most maxWordLen characters. Null if nothing is left. */
export function cleanWord(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = [...raw.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()].slice(0, GLEICH.maxWordLen).join('').trim();
  return t || null;
}

const ARTICLES = /^(der|die|das|ein|eine|einen|the|a|an)\s+/;

/** The form words are compared in: case, umlauts, accents, punctuation and a leading article don't matter. */
export function normalize(raw: string): string {
  let t = raw
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const bare = t.replace(ARTICLES, '');
  if (bare) t = bare;
  return t;
}

/** Plural and case endings German nouns pick up; the other word must be exactly the stem. */
const ENDINGS = ['e', 'n', 'en', 's', 'er'];
const MIN_STEM = 4;
/** Typos are only forgiven in words this long, so Hund and Mund stay different. */
const MIN_TYPO = 5;

/** Same word, or one with an ending or one slip: Haus/Haeuser aside, Katze/Katzen and Banane/Bananr count. */
export function matches(a: string, b: string): boolean {
  const x = normalize(a).replace(/ /g, '');
  const y = normalize(b).replace(/ /g, '');
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= MIN_STEM && long.startsWith(short) && ENDINGS.includes(long.slice(short.length))) return true;
  return short.length >= MIN_TYPO && withinOneEdit(short, long);
}

/** Levenshtein distance at most 1 (substitution, insertion or deletion), without building the table. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.slice(i) === l.slice(i + 1);
}

/** Groups of players whose words match (chains count: a~b and b~c puts all three together). Players without a word are left out. */
export function groupsOf(words: Words, ids: readonly string[]): string[][] {
  const have = ids.filter((id) => words[id]);
  const out: string[][] = [];
  const seen = new Set<string>();
  for (const id of have) {
    if (seen.has(id)) continue;
    const comp = [id];
    seen.add(id);
    for (let k = 0; k < comp.length; k++) {
      for (const other of have) {
        if (!seen.has(other) && matches(words[comp[k]]!, words[other]!)) {
          seen.add(other);
          comp.push(other);
        }
      }
    }
    out.push(ids.filter((p) => comp.includes(p)));
  }
  return out;
}

/** The largest group, the first one (by seat order) on a tie. */
export function biggestGroup(words: Words, ids: readonly string[]): string[] {
  let best: string[] = [];
  for (const g of groupsOf(words, ids)) if (g.length > best.length) best = g;
  return best;
}

// ---------- commit / reveal ----------

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function newSalt(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

export async function commitOf(word: string, salt: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${word}`)));
}

/** Whether a revealed {word, salt} is what the player locked. Anything malformed is simply false. */
export async function verifyReveal(commit: string | undefined, word: unknown, salt: unknown): Promise<boolean> {
  if (!commit || typeof salt !== 'string' || !SALT.test(salt)) return false;
  const w = cleanWord(word);
  // Only words in the cleaned form can have been locked.
  if (!w || w !== word) return false;
  return (await commitOf(w, salt)) === commit;
}

// ---------- host ----------

/** Pick a different question for everyone, none twice in a round. */
export function drawQuestions(players: readonly string[], pool: readonly string[], rng: Rand, avoid: ReadonlySet<string> = new Set()): Record<string, string> {
  let left = pool.filter((q) => !avoid.has(q));
  if (left.length < players.length) left = [...pool];
  const out: Record<string, string> = {};
  for (const p of players) {
    const i = Math.floor(rng() * left.length);
    out[p] = left[i];
    left.splice(i, 1);
  }
  return out;
}

export class GleichHost {
  state: GleichState;
  /** Who is in the room right now; null = everyone (tests). Absent players never block anything. */
  present: ReadonlySet<string> | null = null;
  private votes = new Map<string, boolean>();
  /** Verified words of this try as they came in; null = revealed something that doesn't match its commitment. */
  private revealed = new Map<string, string | null>();

  constructor(
    players: string[],
    scores: Record<string, number> = {},
    round = 1,
    now = Date.now(),
    rng: Rand = Math.random,
    pool: readonly string[] = QUESTIONS_NORMAL,
    avoid?: ReadonlySet<string>,
  ) {
    this.state = {
      phase: 'write',
      round,
      tryNo: 1,
      players: [...players],
      questions: drawQuestions(players, pool, rng, avoid),
      commits: {},
      words: null,
      group: [],
      of: players.length,
      solved: false,
      deadline: now + GLEICH.writeS * 1000,
      ready: [],
      vote: null,
      voted: false,
      last: null,
      history: [],
      solvedTry: null,
      scores: Object.fromEntries(players.map((p) => [p, scores[p] ?? 0])),
    };
  }

  /** Continue a round from its public state: the new host after the old one left. Secret votes are gone with the old host. */
  static fromState(state: GleichState, now = Date.now()): GleichHost {
    const h = new GleichHost(state.players, state.scores, state.round, now);
    h.state = structuredClone(state);
    h.state.vote = null;
    h.state.voted = false;
    // The collecting window starts over; the clients' verified words are fed back in by the game.
    if (h.state.phase === 'reveal' && !h.state.words) h.state.deadline = now + GLEICH.collectS * 1000;
    return h;
  }

  /** Players of the round who are in the room. */
  here(): string[] {
    return this.state.players.filter((p) => !this.present || this.present.has(p));
  }

  /** Apply an intent from `from`. Returns whether the public state changed. */
  intent(from: string, i: Intent, now: number, isHost: boolean): boolean {
    const s = this.state;
    if (i.a === 'end') {
      if (!isHost || s.phase === 'done') return false;
      this.finish(false);
      return true;
    }
    if (!s.players.includes(from)) return false;
    switch (i.a) {
      case 'lock':
        // Locking again replaces the commitment (changed my mind, or came back without my secret).
        if (s.phase !== 'write') return false;
        s.commits[from] = i.c;
        this.step(now);
        return true;
      case 'call':
        if (s.phase !== 'reveal' || !s.words || s.solved || s.vote || s.voted) return false;
        s.vote = { voters: [], deadline: now + GLEICH.voteS * 1000 };
        s.voted = true;
        s.last = null;
        this.votes.clear();
        this.step(now);
        return true;
      case 'vote':
        if (!s.vote || this.votes.has(from)) return false;
        this.votes.set(from, i.v);
        s.vote.voters.push(from);
        this.step(now);
        return true;
      case 'ready':
        if (s.phase !== 'reveal' || !s.words || s.ready.includes(from)) return false;
        s.ready.push(from);
        this.step(now);
        return true;
    }
  }

  /** The reveal of `from`, checked by the game: the word if it matched its commitment, else null (which needs no waiting for). */
  reveal(from: string, word: string | null, now: number): boolean {
    const s = this.state;
    if (s.phase !== 'reveal' || s.words || !s.players.includes(from) || !s.commits[from] || this.revealed.has(from)) return false;
    this.revealed.set(from, word);
    this.step(now);
    return true;
  }

  /** Per tick: deadlines, and everything that waited for people who turned out to be absent. */
  tick(now: number): boolean {
    return this.step(now);
  }

  private step(now: number): boolean {
    const s = this.state;
    const here = this.here();
    const late = (t: number | null) => now >= (t ?? Infinity);
    let changed = false;
    if (s.phase === 'write' && here.length > 0 && (late(s.deadline) || here.every((p) => s.commits[p]))) {
      this.toReveal(now);
      changed = true;
    }
    if (s.phase === 'reveal' && !s.words && (late(s.deadline) || here.filter((p) => s.commits[p]).every((p) => this.revealed.has(p)))) {
      this.judge(now, here);
      changed = true;
    }
    if (s.phase === 'reveal' && s.words) {
      const v = s.vote;
      if (v ? late(v.deadline) || here.every((p) => v.voters.includes(p)) : late(s.deadline) || (here.length > 0 && here.every((p) => s.ready.includes(p)))) {
        if (v) this.closeVote(now);
        else this.nextTry(now);
        changed = true;
      }
    }
    return changed;
  }

  private toReveal(now: number): void {
    const s = this.state;
    s.phase = 'reveal';
    s.words = null;
    s.deadline = now + GLEICH.collectS * 1000;
    this.revealed.clear();
  }

  private judge(now: number, here: string[]): void {
    const s = this.state;
    const words: Words = {};
    for (const p of s.players) words[p] = s.commits[p] ? (this.revealed.get(p) ?? null) : null;
    // Only people who are here count; someone who left after revealing neither helps nor blocks.
    const mine = Object.fromEntries(here.map((p) => [p, words[p]]));
    s.words = words;
    // A lone word is no group: nothing to highlight.
    const best = biggestGroup(mine, here);
    s.group = best.length >= 2 ? best : [];
    s.of = here.length;
    s.ready = [];
    s.vote = null;
    s.voted = false;
    s.last = null;
    s.deadline = now + GLEICH.revealS * 1000;
    // Two people at least, or "everyone agrees" would be a one-man victory.
    if (here.length >= 2 && s.group.length === here.length) this.finish(true);
  }

  private closeVote(now: number): void {
    const s = this.state;
    const v = [...this.votes.values()];
    const yes = v.filter(Boolean).length;
    const no = v.length - yes;
    s.vote = null;
    this.votes.clear();
    s.last = { result: yes > no ? 'yes' : 'no', yes, no };
    if (yes > no) this.finish(true);
    else s.deadline = Math.max(s.deadline ?? 0, now + GLEICH.afterVoteS * 1000);
  }

  private nextTry(now: number): void {
    const s = this.state;
    if (s.words) s.history.push(s.words);
    if (s.tryNo >= GLEICH.maxTries) {
      this.finish(false, true);
      return;
    }
    s.tryNo++;
    s.phase = 'write';
    s.commits = {};
    s.words = null;
    s.group = [];
    s.ready = [];
    s.vote = null;
    s.voted = false;
    s.last = null;
    s.deadline = now + GLEICH.writeS * 1000;
    this.revealed.clear();
  }

  /** Ends the round. `solved` pays out everyone in it by the try; `pushed` = the judged words are already in the history. */
  private finish(solved: boolean, pushed = false): void {
    const s = this.state;
    if (s.words && !pushed) s.history.push(s.words);
    s.phase = 'done';
    s.vote = null;
    s.deadline = null;
    s.solved = solved;
    if (solved) {
      s.solvedTry = s.tryNo;
      const gain = GLEICH.points[s.tryNo - 1] ?? GLEICH.points.at(-1)!;
      for (const p of s.players) s.scores[p] = (s.scores[p] ?? 0) + gain;
    }
  }

  /** The Schaffner's fine, only while people are writing (talking = trying to agree). */
  penalize(id: string, points: number): void {
    if (id in this.state.scores) this.state.scores[id] -= points;
  }

  /** A player came back under a new id (reload): everything that names them follows. */
  replace(oldId: string, newId: string): boolean {
    const s = this.state;
    if (!s.players.includes(oldId)) return false;
    const r = (id: string) => (id === oldId ? newId : id);
    const rk = <T>(rec: Record<string, T>) => {
      if (oldId in rec) {
        rec[newId] = rec[oldId];
        delete rec[oldId];
      }
    };
    s.players = s.players.map(r);
    s.group = s.group.map(r);
    s.ready = s.ready.map(r);
    if (s.vote) s.vote.voters = s.vote.voters.map(r);
    rk(s.questions);
    rk(s.scores);
    // Whoever returns has lost their secret with the reload, so a commitment made while writing is
    // worthless: they lock anew instead of counting as done. Later it only proves they can't reveal.
    if (s.phase === 'write') delete s.commits[oldId];
    else rk(s.commits);
    if (s.words) rk(s.words);
    for (const w of s.history) rk(w);
    const word = this.revealed.get(oldId);
    if (word !== undefined) {
      this.revealed.delete(oldId);
      this.revealed.set(newId, word);
    }
    const v = this.votes.get(oldId);
    if (v !== undefined) {
      this.votes.delete(oldId);
      this.votes.set(newId, v);
    }
    return true;
  }

  /** Someone left for good: out of the round with their words; too few people end it. */
  removePlayer(id: string, now: number): boolean {
    const s = this.state;
    if (!s.players.includes(id)) return false;
    const not = (p: string) => p !== id;
    s.players = s.players.filter(not);
    s.group = s.group.filter(not);
    s.ready = s.ready.filter(not);
    if (s.vote) s.vote.voters = s.vote.voters.filter(not);
    delete s.questions[id];
    delete s.commits[id];
    if (s.words) delete s.words[id];
    for (const w of s.history) delete w[id];
    this.revealed.delete(id);
    this.votes.delete(id);
    if (s.players.length < 2) {
      if (s.phase !== 'done') this.finish(false);
      return true;
    }
    s.of = Math.min(s.of, s.players.length);
    this.step(now);
    return true;
  }
}
