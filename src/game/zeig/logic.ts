import { ZEIG } from '../../config';
import type { Rand } from '../../core/rng';

// Rules of "Zeig drauf" as a pure state machine on the host. Per question everyone looks at the
// person they choose; the picks stay with the host until the countdown is over (or all locked)
// and are revealed together. Whoever picked the most-picked person (ties included) scores.
// Picks are host-trusted: looking is public anyway, the heads are broadcast.

/** voter -> picked player (null = abstained: no pick, or absent). */
export type Picks = Record<string, string | null>;

export interface ZeigRecord {
  question: string;
  picks: Picks;
  /** The most picked (several on a tie), empty if nobody picked anyone. */
  top: string[];
  /** Votes the top got. */
  count: number;
}

export interface ZeigState {
  /** `look`: picking; `reveal`: picks shown, waiting for "Weiter". */
  phase: 'look' | 'reveal' | 'done';
  round: number;
  /** 1-based number of the running question. */
  qNo: number;
  /** The round's questions; public, they are no secret worth guarding. */
  questions: string[];
  /** Seat order. */
  players: string[];
  /** Who locked their pick (not whom). */
  locked: string[];
  /** Host ms: end of looking or of the reveal. */
  deadline: number | null;
  ready: string[];
  /** Judged questions, the shown one last; picks are only public from here. */
  history: ZeigRecord[];
  /** The round ended early with too few players. */
  short: boolean;
  scores: Record<string, number>;
}

export type Intent = { a: 'aim'; id: string | null; lock: boolean } | { a: 'ready' } | { a: 'end' };

export function parseIntent(v: unknown): Intent | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.a === 'aim') return (o.id === null || (typeof o.id === 'string' && o.id.length <= 64)) && typeof o.lock === 'boolean' ? { a: 'aim', id: o.id as string | null, lock: o.lock } : null;
  return o.a === 'ready' || o.a === 'end' ? { a: o.a } : null;
}

/** `n` different questions, avoiding the ones in `avoid` while enough are left. */
export function drawQuestions(n: number, pool: readonly string[], rng: Rand, avoid: ReadonlySet<string> = new Set()): string[] {
  let left = pool.filter((q) => !avoid.has(q));
  if (left.length < n) left = [...pool];
  const out: string[] = [];
  while (out.length < n && left.length) out.push(left.splice(Math.floor(rng() * left.length), 1)[0]);
  return out;
}

/** Count the picks: the most picked (ties included) and how many votes they got. */
export function tally(picks: Picks, players: readonly string[]): { top: string[]; count: number; votes: Record<string, string[]> } {
  const votes: Record<string, string[]> = Object.fromEntries(players.map((p) => [p, []]));
  for (const p of players) {
    const t = picks[p];
    if (t && t !== p && votes[t]) votes[t].push(p);
  }
  const count = Math.max(0, ...Object.values(votes).map((v) => v.length));
  return { top: count ? players.filter((p) => votes[p].length === count) : [], count, votes };
}

export class ZeigHost {
  state: ZeigState;
  /** Who is in the room right now; null = everyone (tests). Absent players never block anything. */
  present: ReadonlySet<string> | null = null;
  /** Picks of the running question as they came in; secret until the reveal. */
  private aims = new Map<string, string | null>();

  constructor(players: string[], questions: string[], scores: Record<string, number> = {}, round = 1, now = Date.now()) {
    this.state = {
      phase: 'look',
      round,
      qNo: 1,
      questions: [...questions],
      players: [...players],
      locked: [],
      deadline: now + ZEIG.lookS * 1000,
      ready: [],
      history: [],
      short: false,
      scores: Object.fromEntries(players.map((p) => [p, scores[p] ?? 0])),
    };
  }

  /** Continue a round from its public state: the new host after the old one left. The clients send their picks again. */
  static fromState(state: ZeigState, now = Date.now()): ZeigHost {
    const h = new ZeigHost(state.players, state.questions, state.scores, state.round, now);
    h.state = structuredClone(state);
    if (h.state.phase === 'look') {
      // Locks went with the old host's picks; the clients send both again.
      h.state.locked = [];
      h.state.deadline = Math.max(h.state.deadline ?? 0, now + ZEIG.takeoverS * 1000);
    }
    return h;
  }

  here(): string[] {
    return this.state.players.filter((p) => !this.present || this.present.has(p));
  }

  /** The shown result while revealing, else null. */
  get shown(): ZeigRecord | null {
    return this.state.phase === 'reveal' ? (this.state.history.at(-1) ?? null) : null;
  }

  /** Apply an intent from `from`. Returns whether the public state changed. */
  intent(from: string, i: Intent, now: number, isHost: boolean): boolean {
    const s = this.state;
    if (i.a === 'end') {
      if (!isHost || s.phase === 'done') return false;
      this.finish();
      return true;
    }
    if (!s.players.includes(from)) return false;
    if (i.a === 'aim') {
      if (s.phase !== 'look' || s.locked.includes(from)) return false;
      if (i.id !== null && (i.id === from || !s.players.includes(i.id))) return false;
      this.aims.set(from, i.id);
      if (!i.lock) return false;
      s.locked.push(from);
      this.step(now);
      return true;
    }
    if (s.phase !== 'reveal' || s.ready.includes(from)) return false;
    s.ready.push(from);
    this.step(now);
    return true;
  }

  tick(now: number): boolean {
    return this.step(now);
  }

  private step(now: number): boolean {
    const s = this.state;
    const here = this.here();
    const late = now >= (s.deadline ?? Infinity);
    if (s.phase === 'look' && here.length > 0 && (late || here.every((p) => s.locked.includes(p)))) {
      this.reveal(now);
      return true;
    }
    if (s.phase === 'reveal' && (late || (here.length > 0 && here.every((p) => s.ready.includes(p))))) {
      this.next(now);
      return true;
    }
    return false;
  }

  private reveal(now: number): void {
    const s = this.state;
    const picks: Picks = {};
    for (const p of s.players) {
      const t = this.aims.get(p) ?? null;
      picks[p] = t && s.players.includes(t) ? t : null;
    }
    const { top, count } = tally(picks, s.players);
    if (count >= ZEIG.minAgree) for (const p of s.players) if (picks[p] && top.includes(picks[p]!)) s.scores[p] = (s.scores[p] ?? 0) + ZEIG.majorityPoints;
    s.history.push({ question: s.questions[s.qNo - 1], picks, top, count });
    s.phase = 'reveal';
    s.ready = [];
    s.deadline = now + ZEIG.revealS * 1000;
    this.aims.clear();
  }

  private next(now: number): void {
    const s = this.state;
    if (s.qNo >= s.questions.length) {
      this.finish();
      return;
    }
    s.qNo++;
    s.phase = 'look';
    s.locked = [];
    s.ready = [];
    s.deadline = now + ZEIG.lookS * 1000;
    this.aims.clear();
  }

  private finish(short = false): void {
    const s = this.state;
    s.phase = 'done';
    s.deadline = null;
    s.short = short;
    this.aims.clear();
  }

  /** The Schaffner's fine, any time in a running round. */
  penalize(id: string, points: number): void {
    if (id in this.state.scores) this.state.scores[id] -= points;
  }

  /** A player came back under a new id (reload): everything that names them follows. */
  replace(oldId: string, newId: string): boolean {
    const s = this.state;
    if (!s.players.includes(oldId)) return false;
    const r = (id: string) => (id === oldId ? newId : id);
    const rp = (picks: Picks) => {
      const out: Picks = {};
      for (const [k, v] of Object.entries(picks)) out[r(k)] = v === null ? null : r(v);
      return out;
    };
    s.players = s.players.map(r);
    s.locked = s.locked.map(r);
    s.ready = s.ready.map(r);
    for (const h of s.history) {
      h.picks = rp(h.picks);
      h.top = h.top.map(r);
    }
    if (oldId in s.scores) {
      s.scores[newId] = s.scores[oldId];
      delete s.scores[oldId];
    }
    const aims = new Map<string, string | null>();
    for (const [k, v] of this.aims) aims.set(r(k), v === null ? null : r(v));
    this.aims = aims;
    return true;
  }

  /** Someone left for good: out of the round (past results stay as they were); too few end it. */
  removePlayer(id: string, now: number): boolean {
    const s = this.state;
    if (!s.players.includes(id)) return false;
    const not = (p: string) => p !== id;
    s.players = s.players.filter(not);
    s.locked = s.locked.filter(not);
    s.ready = s.ready.filter(not);
    this.aims.delete(id);
    for (const [k, v] of this.aims) if (v === id) this.aims.set(k, null);
    if (s.players.length < ZEIG.minPlayers) {
      if (s.phase !== 'done') this.finish(true);
      return true;
    }
    this.step(now);
    return true;
  }
}
