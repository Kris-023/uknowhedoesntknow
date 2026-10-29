import { SAGS } from '../../config';
import { parseCard } from '../../words/custom';
import type { WordCard } from '../../words/types';

// Rules of "Sag's anders" as a pure state machine on the host. The explainer draws their cards
// locally and shows them only to the people allowed to see them; the host never needs the word
// before it's played. Played cards go into the public log (that's when everyone may see them).

export type Mode = 'teams' | 'ffa';
export type Outcome = 'got' | 'skip' | 'foul';

export interface Played {
  /** Card serial in this round; intents name it so late clicks can't hit the next card. */
  no: number;
  explainer: string;
  card: WordCard;
  result: Outcome;
  /** Who guessed it (free for all), or null. */
  guesser: string | null;
  /** Who called the foul. */
  foulBy: string | null;
  /** Host time when it was played; free for all can still challenge it for SAGS.challengeS. */
  at: number;
  /** The result before a challenge turned it into a foul. */
  was?: Outcome;
}

export interface SagsState {
  phase: 'ready' | 'turn' | 'done';
  round: number;
  mode: Mode;
  /** Turn order (seat order); in teams it alternates A, B, A, B. */
  players: string[];
  /** Teams A and B, or null in free for all. */
  teams: [string[], string[]] | null;
  explainer: string | null;
  /** Turns played so far and in total. */
  turnNo: number;
  turns: number;
  turnS: number;
  /** End of the running turn (host ms). */
  deadline: number | null;
  /** Serial of the card in hand; bumped by every result and at the end of a turn. */
  cardNo: number;
  log: Played[];
  scores: Record<string, number>;
}

export type Intent =
  | { a: 'begin' }
  | { a: 'got'; no: number; card: WordCard; by: string | null }
  | { a: 'skip'; no: number; card: WordCard }
  | { a: 'foul'; no: number; card: WordCard }
  | { a: 'challenge'; no: number }
  | { a: 'end' };

export function parseIntent(v: unknown): Intent | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.a === 'begin' || o.a === 'end') return { a: o.a };
  if (typeof o.no !== 'number' || !Number.isInteger(o.no)) return null;
  if (o.a === 'challenge') return { a: 'challenge', no: o.no };
  const card = parseCard(o.card);
  if (!card) return null;
  if (o.a === 'got') return { a: 'got', no: o.no, card, by: typeof o.by === 'string' ? o.by : null };
  if (o.a === 'skip' || o.a === 'foul') return { a: o.a, no: o.no, card };
  return null;
}

/** Four players make two teams if the room wants teams; fewer always play everyone against everyone. */
export function teamsFor(players: string[], teams = true): [string[], string[]] | null {
  if (!teams || players.length !== 4) return null;
  return [
    [players[0], players[2]],
    [players[1], players[3]],
  ];
}

export function teamOf(s: Pick<SagsState, 'teams'>, id: string): 0 | 1 | null {
  if (!s.teams) return null;
  return s.teams[0].includes(id) ? 0 : s.teams[1].includes(id) ? 1 : null;
}

/** Who has to guess the explainer's word (they must never see it before it's played). */
export function guessersOf(s: Pick<SagsState, 'teams' | 'players'>, explainer: string): string[] {
  const t = teamOf(s, explainer);
  if (t === null) return s.players.filter((p) => p !== explainer);
  return s.teams![t].filter((p) => p !== explainer);
}

/** Who sees the card live: the other team, watching for forbidden words. Nobody in free for all. */
export function watchersOf(s: Pick<SagsState, 'teams' | 'players'>, explainer: string): string[] {
  const t = teamOf(s, explainer);
  return t === null ? [] : s.teams![1 - t];
}

export function teamScore(s: SagsState, t: 0 | 1): number {
  return s.teams ? s.teams[t].reduce((n, p) => n + (s.scores[p] ?? 0), 0) : 0;
}

export class SagsHost {
  state: SagsState;

  constructor(
    players: string[],
    scores: Record<string, number> = {},
    round = 1,
    turnS: number = SAGS.turnS,
    wantTeams = true,
  ) {
    const teams = teamsFor(players, wantTeams);
    this.state = {
      phase: 'ready',
      round,
      mode: teams ? 'teams' : 'ffa',
      players: [...players],
      teams,
      explainer: players[0] ?? null,
      turnNo: 0,
      turns: players.length * SAGS.turnsEach,
      turnS,
      deadline: null,
      cardNo: 1,
      log: [],
      scores: Object.fromEntries(players.map((p) => [p, scores[p] ?? 0])),
    };
  }

  static fromState(state: SagsState): SagsHost {
    const h = new SagsHost(state.players, state.scores, state.round, state.turnS);
    h.state = structuredClone(state);
    return h;
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
    switch (i.a) {
      case 'begin':
        if (s.phase !== 'ready' || s.explainer !== from) return false;
        s.phase = 'turn';
        s.deadline = now + s.turnS * 1000;
        s.cardNo++;
        return true;
      case 'got': {
        if (s.phase !== 'turn' || s.explainer !== from || i.no !== s.cardNo) return false;
        const guesser = s.mode === 'ffa' ? i.by : null;
        if (s.mode === 'ffa' && (!guesser || guesser === from || !s.players.includes(guesser))) return false;
        this.play(i.no, i.card, 'got', guesser, null, now);
        if (s.mode === 'teams') this.add(from, SAGS.teamGot);
        else {
          this.add(guesser!, SAGS.ffaGuesser);
          this.add(from, SAGS.ffaExplainer);
        }
        return true;
      }
      case 'skip':
        if (s.phase !== 'turn' || s.explainer !== from || i.no !== s.cardNo) return false;
        this.play(i.no, i.card, 'skip', null, null, now);
        return true;
      case 'foul':
        // Live foul: only the other team sees the card while it's being explained.
        if (s.phase !== 'turn' || i.no !== s.cardNo || !s.explainer || !watchersOf(s, s.explainer).includes(from)) return false;
        this.play(i.no, i.card, 'foul', null, from, now);
        this.add(from, SAGS.teamFoul);
        return true;
      case 'challenge': {
        // Free for all: once a card is shown to everyone, anyone but its explainer may still object.
        const p = s.log.find((x) => x.no === i.no);
        if (s.mode !== 'ffa' || !p || p.result === 'foul' || p.explainer === from || now - p.at > SAGS.challengeS * 1000) return false;
        if (p.result === 'got' && p.guesser) {
          this.add(p.guesser, -SAGS.ffaGuesser);
          this.add(p.explainer, -SAGS.ffaExplainer);
        }
        this.add(p.explainer, -SAGS.ffaFoul);
        p.was = p.result;
        p.result = 'foul';
        p.foulBy = from;
        return true;
      }
    }
  }

  /** Per tick: the turn ends at its deadline; the card in hand is just put away. */
  tick(now: number): boolean {
    const s = this.state;
    if (s.phase === 'turn' && s.deadline !== null && now >= s.deadline) {
      this.nextTurn();
      return true;
    }
    return false;
  }

  /** Ends the current turn early (explainer gone); in the ready phase it passes to the next one. */
  pass(): boolean {
    if (this.state.phase === 'done') return false;
    this.nextTurn();
    return true;
  }

  /** The Schaffner's fine. */
  penalize(id: string, points: number): void {
    if (id in this.state.scores) this.state.scores[id] -= points;
  }

  /** A player came back under a new id (reload): everything that names them follows. */
  replace(oldId: string, newId: string): boolean {
    const s = this.state;
    if (!s.players.includes(oldId)) return false;
    const r = (id: string) => (id === oldId ? newId : id);
    s.players = s.players.map(r);
    if (s.teams) s.teams = [s.teams[0].map(r), s.teams[1].map(r)];
    s.explainer = s.explainer && r(s.explainer);
    for (const p of s.log) {
      p.explainer = r(p.explainer);
      p.guesser = p.guesser && r(p.guesser);
      p.foulBy = p.foulBy && r(p.foulBy);
    }
    if (oldId in s.scores) {
      s.scores[newId] = s.scores[oldId];
      delete s.scores[oldId];
    }
    return true;
  }

  /** Someone left for good: out of the order and their team; too few people end the round. */
  removePlayer(id: string): boolean {
    const s = this.state;
    if (!s.players.includes(id)) return false;
    const wasOn = s.explainer === id;
    const idx = s.players.indexOf(id);
    s.players = s.players.filter((p) => p !== id);
    if (s.teams) s.teams = [s.teams[0].filter((p) => p !== id), s.teams[1].filter((p) => p !== id)];
    if (s.players.length < 2 || (s.teams && (!s.teams[0].length || !s.teams[1].length))) {
      this.finish();
      return true;
    }
    s.turns = Math.max(s.turnNo + 1, s.turns - SAGS.turnsEach);
    if (wasOn) {
      // The next one in the order takes over without counting a turn.
      s.explainer = this.playable(idx % s.players.length);
      s.phase = 'ready';
      s.deadline = null;
      s.cardNo++;
    }
    return true;
  }

  private play(no: number, card: WordCard, result: Outcome, guesser: string | null, foulBy: string | null, now: number): void {
    const s = this.state;
    s.log.push({ no, explainer: s.explainer!, card, result, guesser, foulBy, at: now });
    s.cardNo++;
  }

  private add(id: string, n: number): void {
    this.state.scores[id] = (this.state.scores[id] ?? 0) + n;
  }

  private nextTurn(): void {
    const s = this.state;
    s.turnNo++;
    s.deadline = null;
    s.cardNo++;
    if (s.turnNo >= s.turns) {
      this.finish();
      return;
    }
    const i = s.explainer ? s.players.indexOf(s.explainer) : -1;
    s.explainer = this.playable((i + 1) % s.players.length);
    s.phase = 'ready';
  }

  /** First player from `i` on who has someone to guess for them (a team of one can't play). */
  private playable(i: number): string {
    const s = this.state;
    for (let k = 0; k < s.players.length; k++) {
      const p = s.players[(i + k) % s.players.length];
      if (guessersOf(s, p).length > 0) return p;
    }
    return s.players[i];
  }

  private finish(): void {
    const s = this.state;
    s.phase = 'done';
    s.explainer = null;
    s.deadline = null;
  }
}
