import { AHNUNG, NET, WORDS } from '../../config';
import { mulberry32 } from '../../core/rng';
import { drawCard, wordPool } from '../../words';
import type { DeckId, WordCard } from '../../words/types';
import { PickState, type GazeTarget } from '../gaze';
import type { GameNet, Minigame } from '../minigame';
import { AhnHost, cleanClue, cleanGuess, givesAway, parseIntent, type AhnState, type Clue, type Intent } from './logic';

const isStrings = (v: unknown, max = 8, len = 64): v is string[] => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && x.length <= len);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const optStr = (v: unknown, len: number) => v === null || (typeof v === 'string' && v.length <= len);

/** Shape check of the host's broadcast; the host is trusted for game decisions anyway. Free text is cleaned again. */
function parseState(v: unknown): (AhnState & { sentAt: number }) | null {
  if (!isRecord(v)) return null;
  if (!['clues', 'vote', 'guess', 'done'].includes(v.phase as string) || !isStrings(v.players) || !isStrings(v.seq, 8 * AHNUNG.laps) || !isStrings(v.locked)) return null;
  if (typeof v.round !== 'number' || typeof v.turn !== 'number' || typeof v.sentAt !== 'number' || !isRecord(v.scores) || !Array.isArray(v.clues) || v.clues.length > 8 * AHNUNG.laps) return null;
  if (!optStr(v.accused, 64) || !optStr(v.clueless, 64) || !optStr(v.guess, 200) || !optStr(v.word, 200)) return null;
  if (v.votes !== null && !isRecord(v.votes)) return null;
  const clues: Clue[] = [];
  for (const c of v.clues as unknown[]) {
    if (!isRecord(c) || typeof c.by !== 'string') return null;
    clues.push({ by: c.by, word: c.word === null ? null : cleanClue(c.word) });
  }
  return {
    ...(v as unknown as AhnState),
    clues,
    guess: v.guess === null ? null : cleanGuess(v.guess),
    word: v.word === null ? null : (v.word as string).slice(0, WORDS.maxChars),
    sentAt: v.sentAt,
  };
}

/** Room settings and words the host draws from. */
export interface AhnRoom {
  decks(): readonly DeckId[];
  /** Everyone's own words in the room ("Sag's anders" shares them), used with the "Eigene" deck. */
  cards(): readonly WordCard[];
  /** Profile id behind a session id, so the clueless one never gets a word they submitted themselves. */
  pidOf(id: string): string | undefined;
}

/** What the host told me privately for a round: the word, or that I'm the clueless one (word null). */
interface Told {
  round: number;
  word: string | null;
  taboo: string[];
}

/** Why a clue was refused before it was sent. */
export type ClueProblem = 'empty' | 'words' | 'word' | 'turn';

/**
 * "Ahnungslos" on one client. The host part (rules, secret, points) runs only on the host, which
 * tells each player privately what they may know: the word, or "ahnungslos". The public state
 * carries neither until the round reveals it (see logic.ts for what that means for the host).
 */
export class AhnungGame implements Minigame, GazeTarget {
  state: AhnState | null = null;
  private host: AhnHost | null = null;
  private scores: Record<string, number> = {};
  private hostSkew = 0;
  private listeners = new Set<() => void>();
  private lastPublish = 0;
  private told: Told | null = null;
  private askedAt = -Infinity;
  /** Cards drawn in this session, so a new round brings a new word. */
  private drawn = new Set<string>();
  private goneSince = new Map<string, number>();
  private dropAsked = new Map<string, number>();
  private pick = new PickState();

  constructor(
    private net: GameNet,
    private room: AhnRoom,
  ) {
    net.onMessage((t, d, f) => this.onMessage(t, d, f));
  }

  get selfId(): string {
    return this.net.selfId;
  }

  get isHost(): boolean {
    return this.net.isHost();
  }

  get running(): boolean {
    return !!this.state && this.state.phase !== 'done';
  }

  /** Clues are going round: shouting brings the Schaffner. */
  get cluing(): boolean {
    return this.state?.phase === 'clues';
  }

  get leftS(): number {
    const d = this.state?.deadline;
    return d ? Math.max(0, (d - (Date.now() + this.hostSkew)) / 1000) : 0;
  }

  private get toldNow(): Told | null {
    const s = this.state;
    return s && this.told && this.told.round === s.round ? this.told : null;
  }

  /** The host has told me my part of this round. */
  get knowsRole(): boolean {
    return !!this.toldNow;
  }

  /** The word, if I'm not the clueless one (and the host told me). */
  get myWord(): string | null {
    return this.toldNow?.word ?? null;
  }

  get iAmClueless(): boolean {
    const t = this.toldNow;
    return !!t && t.word === null;
  }

  /** The card's forbidden words (only for those who know the word): clue ideas for the bots. */
  get taboo(): readonly string[] {
    return this.toldNow?.taboo ?? [];
  }

  get onTurn(): string | null {
    const s = this.state;
    return s?.phase === 'clues' ? (s.seq[s.turn] ?? null) : null;
  }

  get myPick(): string | null {
    return this.pick.id;
  }

  get iLocked(): boolean {
    return this.pick.locked;
  }

  get lockedPick(): string | null {
    return this.state?.phase === 'vote' && this.pick.locked ? this.pick.id : null;
  }

  private get picking(): boolean {
    const s = this.state;
    return !!s && s.phase === 'vote' && s.players.includes(this.selfId) && !this.pick.locked;
  }

  pickable(): readonly string[] {
    if (!this.picking) return [];
    const here = this.hereSet();
    return this.state!.players.filter((p) => p !== this.selfId && here.has(p));
  }

  aim(id: string | null): void {
    if (!this.picking || this.pick.id === id) return;
    this.pick.id = id;
    this.flush();
    this.emit();
  }

  lock(id: string | null = this.pick.id): void {
    if (!this.picking || (id !== null && (id === this.selfId || !this.state!.players.includes(id)))) return;
    this.pick.id = id;
    this.pick.locked = true;
    this.flush();
    this.emit();
  }

  nameOf(id: string | null): string {
    return this.net.members().find((m) => m.id === id)?.name || 'Jemand';
  }

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private emit(): void {
    for (const f of this.listeners) f();
  }

  start(): void {
    if (!this.isHost) return;
    const order = [...this.net.members()].sort((a, b) => NET.seatOrder.indexOf(a.seat) - NET.seatOrder.indexOf(b.seat)).map((m) => m.id);
    if (order.length < AHNUNG.minPlayers) return;
    if (this.host) this.scores = { ...this.host.state.scores };
    const decks = this.room.decks().length ? this.room.decks() : (['normal'] as const);
    const pool = wordPool(decks, this.room.cards());
    if (pool.every((c) => this.drawn.has(c.id))) this.drawn.clear();
    const rng = mulberry32((Date.now() ^ (Math.random() * 2 ** 31)) | 0);
    // Uniform, and before the word: the clueless one must not get a word they submitted.
    const clueless = order[Math.floor(rng() * order.length)];
    const start = Math.floor(rng() * order.length);
    const pid = this.room.pidOf(clueless);
    const card = drawCard(pool, this.drawn, new Set(pid ? [pid] : []), rng);
    if (!card) return;
    this.drawn.add(card.id);
    this.host = new AhnHost(order, card, clueless, start, this.scores, (this.host?.state.round ?? 0) + 1, Date.now());
    this.host.present = this.hereSet();
    this.publish();
    for (const p of order) this.tell(p);
  }

  /** Host: tell `id` privately what they may know of this round. */
  private tell(id: string): void {
    const h = this.host;
    const sec = h?.secret;
    if (!h || !sec || !h.state.players.includes(id)) return;
    const mine = id === sec.clueless ? { round: h.state.round, word: null, taboo: [] } : { round: h.state.round, word: sec.word, taboo: sec.taboo };
    if (id === this.selfId) {
      this.told = mine;
      this.emit();
    } else this.net.send('ah:secret', mine, id);
  }

  end(): void {
    this.toHost({ a: 'end' });
  }

  /** The Schaffner's fine, only while the clues go round. */
  penalize(id: string, points: number): boolean {
    if (!this.host?.penalize(id, points)) return false;
    this.publish();
    return true;
  }

  /** My clue for my turn; returns why not, or null when it went out. */
  clue(raw: string): ClueProblem | null {
    if (!raw.trim()) return 'empty';
    const w = cleanClue(raw);
    if (!w) return 'words';
    if (this.onTurn !== this.selfId) return 'turn';
    const word = this.myWord;
    if (word && givesAway(w, word)) return 'word';
    this.toHost({ a: 'clue', word: w });
    return null;
  }

  guess(raw: string): boolean {
    const s = this.state;
    const g = cleanGuess(raw);
    if (!g || s?.phase !== 'guess' || s.clueless !== this.selfId) return false;
    this.toHost({ a: 'guess', word: g });
    return true;
  }

  toHost(i: Intent): void {
    if (this.isHost) this.applyIntent(this.selfId, i);
    else {
      const h = this.net.hostId();
      if (h) this.net.send('ah:intent', i, h);
    }
  }

  /** Host: someone reloaded and came back with a new id; they keep place, points and their part (told again). */
  rejoin(oldId: string, newId: string): void {
    if (!this.host?.replace(oldId, newId)) return;
    this.goneSince.delete(oldId);
    this.publish();
    if (this.host.state.phase !== 'done') this.tell(newId);
  }

  absent(): string[] {
    const s = this.state;
    if (!s || s.phase === 'done') return [];
    const here = this.hereSet();
    return s.players.filter((p) => !here.has(p));
  }

  drop(id: string): void {
    if (this.isHost) this.dropNow(id);
    else {
      const h = this.net.hostId();
      if (h) this.net.send('ah:drop', id, h);
    }
  }

  private hereSet(): Set<string> {
    return new Set(this.net.members().map((m) => m.id));
  }

  /** Host: play on without `id`, once they're really gone (see GleichGame.dropNow). */
  private dropNow(id: string): void {
    if (!this.host) return;
    if (this.net.members().some((m) => m.id === id)) {
      this.dropAsked.set(id, Date.now());
      return;
    }
    this.dropAsked.delete(id);
    this.goneSince.delete(id);
    this.host.present = this.hereSet();
    if (this.host.removePlayer(id, Date.now())) this.publish();
  }

  private flush(): void {
    this.pick.flush(this.net.hostId(), (id, lock) => this.toHost({ a: 'aim', id, lock }));
  }

  tick(now: number): void {
    // Gave way to another host (network split): their state counts from now on.
    if (this.host && !this.isHost) this.host = null;
    // The old host left: only it knew who is clueless, so a running round ends here (AhnHost.fromState).
    if (!this.host && this.isHost && this.state) {
      this.host = AhnHost.fromState(this.state);
      this.scores = { ...this.state.scores };
      this.publish(now);
    }
    const s = this.state;
    // Lost my part (reload, or the message went missing): ask the host again now and then.
    if (s && s.phase !== 'done' && !this.isHost && s.players.includes(this.selfId) && !this.knowsRole && now - this.askedAt > AHNUNG.askAgainMs) {
      this.askedAt = now;
      const h = this.net.hostId();
      if (h) this.net.send('ah:need', s.round, h);
    }
    if (s?.phase === 'vote') this.flush();
    if (!this.host) return;
    const t = Date.now();
    const here = this.hereSet();
    this.host.present = here;
    let changed = this.host.tick(t);
    for (const p of [...this.host.state.players]) {
      if (here.has(p)) {
        this.goneSince.delete(p);
        continue;
      }
      const since = this.goneSince.get(p) ?? t;
      this.goneSince.set(p, since);
      const asked = this.dropAsked.get(p);
      if (asked !== undefined) {
        this.dropAsked.delete(p);
        if (t - asked < NET.dropWaitMs) {
          this.dropNow(p);
          changed = true;
          continue;
        }
      }
      // Away on their turn: the clue is skipped after a moment.
      if (t - since > AHNUNG.absentPassS * 1000 && this.host.onTurn === p) changed = this.host.pass(t) || changed;
      if (t - since > AHNUNG.absentLeaveS * 1000) {
        this.goneSince.delete(p);
        changed = this.host.removePlayer(p, t) || changed;
      }
    }
    if (changed || now - this.lastPublish > 3000) this.publish(now);
  }

  onMessage(type: string, data: unknown, from: string): void {
    if (type === 'ah:state') {
      if (from !== this.net.hostId()) return;
      const s = parseState(data);
      if (s) {
        this.hostSkew = s.sentAt - Date.now();
        this.applyState(s);
      }
    } else if (type === 'ah:secret') {
      // Only the host deals; anything else could be someone trying to confuse me.
      if (from !== this.net.hostId() || !isRecord(data) || !Number.isInteger(data.round)) return;
      const word = data.word === null ? null : typeof data.word === 'string' ? data.word.trim().slice(0, WORDS.maxChars) || null : undefined;
      if (word === undefined || (data.word !== null && word === null)) return;
      const taboo = isStrings(data.taboo, WORDS.maxTaboo, WORDS.maxChars) ? data.taboo : [];
      this.told = { round: data.round as number, word, taboo };
      this.emit();
    } else if (type === 'ah:need') {
      if (this.host && this.host.state.phase !== 'done' && data === this.host.state.round) this.tell(from);
    } else if (type === 'ah:drop') {
      if (typeof data === 'string') this.dropNow(data);
    } else if (type === 'ah:intent') {
      const i = parseIntent(data);
      if (i && this.host) this.applyIntent(from, i);
    }
  }

  private applyIntent(from: string, i: Intent): void {
    if (!this.host) return;
    this.host.present = this.hereSet();
    if (this.host.intent(from, i, Date.now(), from === this.selfId)) this.publish();
  }

  private publish(now = performance.now()): void {
    if (!this.host) return;
    this.lastPublish = now;
    const s = { ...structuredClone(this.host.state), sentAt: Date.now() };
    this.net.send('ah:state', s);
    this.applyState(s);
  }

  private applyState(s: AhnState): void {
    this.state = s;
    if (s.phase === 'vote') {
      this.pick.reset(`${s.round}|vote`);
      if (s.locked.includes(this.selfId) && !this.pick.locked) this.pick.locked = true;
    }
    this.emit();
  }
}
