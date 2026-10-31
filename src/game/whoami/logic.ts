import { WHOAMI } from '../../config';

// Rules of "Wer bin ich?" as a pure state machine on the host. Clients send intents, the host
// applies them and broadcasts the public state. Single votes stay on the host: everyone only
// learns who has voted and the majority result.

export type Vote = 'yes' | 'no' | 'idk';
export type VoteKind = 'question' | 'guess';
export type Result = Vote | 'right' | 'wrong';

export interface WhoamiState {
  phase: 'cards' | 'play' | 'done';
  round: number;
  /** Turn order (seat order). Joiners during a round watch until the next one. */
  players: string[];
  /** target -> author: who makes the card for whom. */
  authorOf: Record<string, string>;
  /** Authors whose card has gone out. */
  ready: string[];
  turn: string | null;
  vote: { kind: VoteKind; guesser: string; voters: string[]; deadline: number } | null;
  /** Last vote result; `timedOut` when the time ran out before everyone voted. */
  last: { kind: VoteKind; guesser: string; result: Result; timedOut: boolean; votes: number } | null;
  questions: Record<string, number>;
  solved: string[];
  scores: Record<string, number>;
}

export type Intent = { a: 'ready' } | { a: 'ask' } | { a: 'guess' } | { a: 'pass' } | { a: 'vote'; v: Vote } | { a: 'end' };

export function parseIntent(v: unknown): Intent | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.a === 'vote') return o.v === 'yes' || o.v === 'no' || o.v === 'idk' ? { a: 'vote', v: o.v } : null;
  return o.a === 'ready' || o.a === 'ask' || o.a === 'guess' || o.a === 'pass' || o.a === 'end' ? { a: o.a } : null;
}

/** Everyone makes the card for the next one in the circle, so nobody makes their own. */
export function assignAuthors(players: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  players.forEach((author, i) => (out[players[(i + 1) % players.length]] = author));
  return out;
}

export function majority(kind: VoteKind, votes: Vote[]): Result {
  const n = (v: Vote) => votes.filter((x) => x === v).length;
  if (kind === 'guess') return n('yes') > n('no') ? 'right' : 'wrong';
  if (n('yes') > n('no') && n('yes') > n('idk')) return 'yes';
  if (n('no') > n('yes') && n('no') > n('idk')) return 'no';
  return 'idk';
}

export class WhoamiHost {
  state: WhoamiState;
  private votes = new Map<string, Vote>();

  constructor(
    players: string[],
    scores: Record<string, number> = {},
    round = 1,
    /** Vote time in seconds (tests stretch it). */
    private voteS: number = WHOAMI.voteS,
  ) {
    this.state = {
      phase: 'cards',
      round,
      players: [...players],
      authorOf: assignAuthors(players),
      ready: [],
      turn: null,
      vote: null,
      last: null,
      questions: Object.fromEntries(players.map((p) => [p, 0])),
      solved: [],
      scores: Object.fromEntries(players.map((p) => [p, scores[p] ?? 0])),
    };
  }

  /** Apply an intent from `from`. Returns whether the public state changed. */
  intent(from: string, i: Intent, now: number, isHost: boolean): boolean {
    const s = this.state;
    if (!s.players.includes(from) && !(i.a === 'end' && isHost)) return false;
    switch (i.a) {
      case 'ready':
        if (s.phase !== 'cards' || s.ready.includes(from)) return false;
        s.ready.push(from);
        if (s.ready.length >= s.players.length) this.startPlay();
        return true;
      case 'ask':
      case 'guess':
        if (s.phase !== 'play' || s.turn !== from || s.vote) return false;
        s.vote = { kind: i.a === 'ask' ? 'question' : 'guess', guesser: from, voters: [], deadline: now + this.voteS * 1000 };
        this.votes.clear();
        return true;
      case 'pass':
        if (s.phase !== 'play' || s.turn !== from || s.vote) return false;
        this.nextTurn();
        return true;
      case 'vote':
        if (!s.vote || from === s.vote.guesser || this.votes.has(from)) return false;
        this.votes.set(from, i.v);
        s.vote.voters.push(from);
        if (s.vote.voters.length >= s.players.length - 1) this.resolve();
        return true;
      case 'end':
        if (!isHost) return false;
        s.phase = 'done';
        s.vote = null;
        s.turn = null;
        return true;
    }
  }

  /** Everyone still in the room has voted: the vote closes without waiting for those who dropped out. */
  closeIfAllIn(present: ReadonlySet<string>): boolean {
    const v = this.state.vote;
    if (!v || !v.voters.length || this.state.players.some((p) => p !== v.guesser && present.has(p) && !v.voters.includes(p))) return false;
    this.resolve();
    return true;
  }

  /** Per tick: a vote closes at its deadline with whatever came in. */
  tick(now: number): boolean {
    if (this.state.vote && now >= this.state.vote.deadline) {
      this.resolve(true);
      return true;
    }
    return false;
  }

  /**
   * Continue a round from its public state: the new host after the old one left. Secret votes of a
   * running vote are gone with the old host, so that vote starts over.
   */
  static fromState(state: WhoamiState, voteS?: number): WhoamiHost {
    const h = new WhoamiHost(state.players, state.scores, state.round, voteS);
    h.state = structuredClone(state);
    h.state.vote = null;
    return h;
  }

  /** A player came back under a new id (reload): everything that names them follows. */
  replace(oldId: string, newId: string): boolean {
    const s = this.state;
    if (!s.players.includes(oldId)) return false;
    const r = (id: string) => (id === oldId ? newId : id);
    s.players = s.players.map(r);
    s.authorOf = Object.fromEntries(Object.entries(s.authorOf).map(([t, a]) => [r(t), r(a)]));
    s.ready = s.ready.map(r);
    s.solved = s.solved.map(r);
    s.turn = s.turn && r(s.turn);
    if (s.vote) {
      s.vote.guesser = r(s.vote.guesser);
      s.vote.voters = s.vote.voters.map(r);
      const v = this.votes.get(oldId);
      if (v) {
        this.votes.delete(oldId);
        this.votes.set(newId, v);
      }
    }
    if (s.last) s.last.guesser = r(s.last.guesser);
    for (const rec of [s.scores, s.questions]) {
      if (oldId in rec) {
        rec[newId] = rec[oldId];
        delete rec[oldId];
      }
    }
    return true;
  }

  /** The Schaffner's fine. */
  penalize(id: string, points: number): void {
    if (id in this.state.scores) this.state.scores[id] -= points;
  }

  /** Someone left: drop them; in the card phase the circle is drawn anew without them. */
  removePlayer(id: string, now: number): boolean {
    const s = this.state;
    if (!s.players.includes(id)) return false;
    s.players = s.players.filter((p) => p !== id);
    s.solved = s.solved.filter((p) => p !== id);
    if (s.players.length < 2) {
      s.phase = 'done';
      s.vote = null;
      s.turn = null;
      return true;
    }
    if (s.phase === 'cards') {
      const before = s.authorOf;
      s.authorOf = assignAuthors(s.players);
      // Authors whose target didn't change keep their submitted card.
      s.ready = s.ready.filter((a) => a !== id && Object.entries(s.authorOf).some(([t, au]) => au === a && before[t] === a));
      if (s.ready.length >= s.players.length) this.startPlay();
    } else if (s.phase === 'play') {
      if (s.vote?.guesser === id) s.vote = null;
      if (s.vote) {
        s.vote.voters = s.vote.voters.filter((v) => v !== id);
        this.votes.delete(id);
        if (s.vote.voters.length >= s.players.length - 1) this.resolve();
      }
      if (s.turn === id) {
        s.turn = this.nextUnsolved(s.players.indexOf(id) - 1);
        if (!s.turn) s.phase = 'done';
      }
    }
    void now;
    return true;
  }

  private startPlay(): void {
    const s = this.state;
    s.phase = 'play';
    s.turn = s.players[0];
  }

  private resolve(timedOut = false): void {
    const s = this.state;
    const v = s.vote;
    if (!v) return;
    const result = majority(v.kind, [...this.votes.values()]);
    s.vote = null;
    s.last = { kind: v.kind, guesser: v.guesser, result, timedOut, votes: this.votes.size };
    this.votes.clear();
    if (v.kind === 'question') {
      s.questions[v.guesser] = (s.questions[v.guesser] ?? 0) + 1;
      // A "yes" lets you ask again; anything else passes the turn.
      if (result !== 'yes') this.nextTurn();
      return;
    }
    if (result === 'right') {
      s.solved.push(v.guesser);
      s.scores[v.guesser] = (s.scores[v.guesser] ?? 0) + (WHOAMI.points[s.solved.length - 1] ?? WHOAMI.points.at(-1)!);
    }
    this.nextTurn();
  }

  private nextTurn(): void {
    const s = this.state;
    const from = s.turn ? s.players.indexOf(s.turn) : -1;
    s.turn = this.nextUnsolved(from);
    if (!s.turn) s.phase = 'done';
  }

  private nextUnsolved(from: number): string | null {
    const s = this.state;
    for (let k = 1; k <= s.players.length; k++) {
      const p = s.players[(from + k + s.players.length) % s.players.length];
      if (!s.solved.includes(p)) return p;
    }
    return null;
  }
}
