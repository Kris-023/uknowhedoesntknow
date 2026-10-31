import { NET, ZEIG } from '../../config';
import { mulberry32 } from '../../core/rng';
import { ZEIG_NORMAL, ZEIG_NSFW } from '../../words/zeig';
import type { DeckId } from '../../words/types';
import { PickState, type GazeTarget } from '../gaze';
import type { GameNet, Minigame } from '../minigame';
import { drawQuestions, parseIntent, ZeigHost, type Intent, type Picks, type ZeigRecord, type ZeigState } from './logic';

const isStrings = (v: unknown, max = 8): v is string[] => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && x.length <= 200);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parsePicks(v: unknown): Picks | null {
  if (!isRecord(v)) return null;
  const out: Picks = {};
  for (const [k, t] of Object.entries(v)) {
    if (t !== null && typeof t !== 'string') return null;
    out[k] = t;
  }
  return out;
}

/** Shape check of the host's broadcast; the host is trusted for game decisions anyway. */
function parseState(v: unknown): (ZeigState & { sentAt: number }) | null {
  if (!isRecord(v)) return null;
  if (!['look', 'reveal', 'done'].includes(v.phase as string) || !isStrings(v.players) || !isStrings(v.locked) || !isStrings(v.ready)) return null;
  if (!isStrings(v.questions, 64) || !isRecord(v.scores) || !Array.isArray(v.history) || v.history.length > 64) return null;
  if (typeof v.round !== 'number' || typeof v.qNo !== 'number' || typeof v.sentAt !== 'number') return null;
  const history: ZeigRecord[] = [];
  for (const h of v.history as unknown[]) {
    if (!isRecord(h) || typeof h.question !== 'string' || !isStrings(h.top) || typeof h.count !== 'number') return null;
    const picks = parsePicks(h.picks);
    if (!picks) return null;
    history.push({ question: h.question, picks, top: h.top, count: h.count });
  }
  return { ...(v as unknown as ZeigState), history, short: !!v.short, sentAt: v.sentAt };
}

/** Room settings the game reads when it draws questions. */
export interface ZeigRoom {
  decks(): readonly DeckId[];
}

/**
 * "Zeig drauf" on one client. The host part (picks, points) runs only on the host. A client tells
 * the host whom it is looking at while the question runs; the host reveals all picks together.
 */
export class ZeigGame implements Minigame, GazeTarget {
  state: ZeigState | null = null;
  private host: ZeigHost | null = null;
  private scores: Record<string, number> = {};
  private hostSkew = 0;
  private listeners = new Set<() => void>();
  private lastPublish = 0;
  /** Questions used in this session, so a new round starts with fresh ones. */
  private asked = new Set<string>();
  private goneSince = new Map<string, number>();
  private dropAsked = new Map<string, number>();
  private pick = new PickState();

  constructor(
    private net: GameNet,
    private room: ZeigRoom,
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

  /** Seconds left of the running timer. */
  get leftS(): number {
    const d = this.state?.deadline;
    return d ? Math.max(0, (d - (Date.now() + this.hostSkew)) / 1000) : 0;
  }

  /** The question being asked or shown. */
  get question(): string {
    const s = this.state;
    return s ? (s.questions[s.qNo - 1] ?? '') : '';
  }

  /** Whom I'm looking at (or locked), this question. */
  get myPick(): string | null {
    return this.pick.id;
  }

  get iLocked(): boolean {
    return this.pick.locked;
  }

  get lockedPick(): string | null {
    return this.state?.phase === 'look' && this.pick.locked ? this.pick.id : null;
  }

  /** The shown result while revealing. */
  get shown(): ZeigRecord | null {
    const s = this.state;
    return s?.phase === 'reveal' ? (s.history.at(-1) ?? null) : null;
  }

  private get picking(): boolean {
    const s = this.state;
    return !!s && s.phase === 'look' && s.players.includes(this.selfId) && !this.pick.locked;
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

  /** Lock the current pick (or `id`, chosen by click): it counts even if I look elsewhere later. */
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
    if (order.length < ZEIG.minPlayers) return;
    if (this.host) this.scores = { ...this.host.state.scores };
    const pool = this.room.decks().includes('nsfw') ? [...ZEIG_NORMAL, ...ZEIG_NSFW] : ZEIG_NORMAL;
    if (this.asked.size > pool.length - ZEIG.questions) this.asked.clear();
    const rng = mulberry32((Date.now() ^ (Math.random() * 2 ** 31)) | 0);
    const questions = drawQuestions(ZEIG.questions, pool, rng, this.asked);
    for (const q of questions) this.asked.add(q);
    this.host = new ZeigHost(order, questions, this.scores, (this.host?.state.round ?? 0) + 1, Date.now());
    this.host.present = this.hereSet();
    this.publish();
  }

  end(): void {
    this.toHost({ a: 'end' });
  }

  /** The Schaffner's fine, any time in a running round. */
  penalize(id: string, points: number): boolean {
    if (!this.host || this.host.state.phase === 'done') return false;
    this.host.penalize(id, points);
    this.publish();
    return true;
  }

  ready(): void {
    this.toHost({ a: 'ready' });
  }

  toHost(i: Intent): void {
    if (this.isHost) this.applyIntent(this.selfId, i);
    else {
      const h = this.net.hostId();
      if (h) this.net.send('zd:intent', i, h);
    }
  }

  /** Host: someone reloaded and came back with a new id; they keep place and points. */
  rejoin(oldId: string, newId: string): void {
    if (!this.host?.replace(oldId, newId)) return;
    this.goneSince.delete(oldId);
    this.publish();
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
      if (h) this.net.send('zd:drop', id, h);
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
    // A new host (the old one left) takes over a running round from its public state.
    if (!this.host && this.isHost && this.state) {
      this.host = ZeigHost.fromState(this.state);
      this.scores = { ...this.state.scores };
      this.host.present = this.hereSet();
      // My own pick went with the old host as well.
      this.pick.forget();
      this.publish(now);
    }
    // Changed picks, and all of them again to a new host.
    if (this.state?.phase === 'look') this.flush();
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
      if (t - since > ZEIG.absentLeaveS * 1000) {
        this.goneSince.delete(p);
        changed = this.host.removePlayer(p, t) || changed;
      }
    }
    if (changed || now - this.lastPublish > 3000) this.publish(now);
  }

  onMessage(type: string, data: unknown, from: string): void {
    if (type === 'zd:state') {
      if (from !== this.net.hostId()) return;
      const s = parseState(data);
      if (s) {
        this.hostSkew = s.sentAt - Date.now();
        this.applyState(s);
      }
    } else if (type === 'zd:drop') {
      if (typeof data === 'string') this.dropNow(data);
    } else if (type === 'zd:intent') {
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
    this.net.send('zd:state', s);
    this.applyState(s);
  }

  private applyState(s: ZeigState): void {
    this.state = s;
    if (s.phase === 'look') {
      this.pick.reset(`${s.round}|${s.qNo}`);
      // After a reload the host still has my lock; the pick behind it is no longer mine to show.
      if (s.locked.includes(this.selfId) && !this.pick.locked) this.pick.locked = true;
    }
    this.emit();
  }
}
