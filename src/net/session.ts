import type { PersonState } from '../characters/person';
import { NET } from '../config';
import { localMs, type SharedClock } from '../core/clock';
import {
  encodePose,
  parsePose,
  parseRoster,
  parseState,
  parseTrain,
  parseOpts,
  parseWelcome,
  trainDistance,
  type RoomOpts,
  type RosterEntry,
  type Train,
  type Welcome,
} from './protocol';
import type { Transport } from './transport';

export type Role = 'host' | 'client';

export interface SessionEvents {
  /** First welcome from a host: seed and clock are known now, the world can be built. */
  welcome(w: Welcome): void;
  roster(): void;
  train(t: Train): void;
  blackout(at: number): void;
  /** Room settings changed (host decision). */
  opts(o: RoomOpts): void;
  /** Host role changed (migration) or the room was full. */
  status(s: 'host' | 'full'): void;
}

/**
 * Lobby logic on top of a Transport. The room creator is host: it owns seed, clock, seat
 * assignment, the speed profile and (later) the game state. Head poses go peer to peer, since
 * they're cosmetic and every hop through the host would add latency.
 *
 * If the host leaves, the remaining player who has been in the room longest takes over. Everyone knows the
 * same roster, so all peers reach the same decision without extra messages.
 */
export class Session {
  role: Role;
  hostId: string | null;
  welcomed: boolean;
  readonly roster = new Map<string, RosterEntry>();
  private poses = new Map<string, { yaw: number; pitch: number }>();
  private peers = new Set<string>();
  train: Train = { kmh: 0, t0: 0, d0: 0 };
  blackoutAt: number | null = null;
  opts: RoomOpts = { voice: true };
  private lastHello = -Infinity;
  private nextPing = 0;
  private pingsSent = 0;
  private ev: Partial<SessionEvents> = {};

  constructor(
    private net: Transport,
    private clock: SharedClock,
    host: boolean,
    private myState: PersonState,
    private now: () => number = localMs,
  ) {
    this.role = host ? 'host' : 'client';
    this.hostId = host ? net.selfId : null;
    this.welcomed = host;
    if (host) this.roster.set(net.selfId, { id: net.selfId, seat: 0, state: myState });

    net.onJoin((id) => this.onJoin(id));
    net.onLeave((id) => this.onLeave(id));
    net.on('hello', (d, from) => this.onHello(d, from));
    net.on('welcome', (d, from) => this.onWelcome(d, from));
    net.on('roster', (d, from) => this.onRoster(d, from));
    net.on('state', (d, from) => this.onState(d, from));
    net.on('pose', (d, from) => {
      const p = parsePose(d);
      if (p) this.poses.set(from, p);
    });
    net.on('ping', (d, from) => {
      if (this.role === 'host' && typeof d === 'number') net.send('pong', [d, this.clock.hostMs(this.now())], from);
    });
    net.on('pong', (d, from) => {
      if (from !== this.hostId || !Array.isArray(d) || typeof d[0] !== 'number' || typeof d[1] !== 'number') return;
      this.clock.addSample(d[0], d[1], this.now());
    });
    net.on('train', (d, from) => {
      const t = from === this.hostId ? parseTrain(d) : null;
      if (!t) return;
      this.train = t;
      this.ev.train?.(t);
    });
    net.on('blackout', (d, from) => {
      if (from !== this.hostId || typeof d !== 'number' || !Number.isFinite(d)) return;
      this.blackoutAt = d;
      this.ev.blackout?.(d);
    });
    net.on('opts', (d, from) => {
      if (from !== this.hostId) return;
      this.opts = parseOpts(d);
      this.ev.opts?.(this.opts);
    });
    net.on('full', (_d, from) => {
      if (!this.welcomed && from !== this.net.selfId) this.ev.status?.('full');
    });
    // Minigame traffic: one channel, typed inside. Only from players in the room.
    net.on('mg', (d, from) => {
      if (!this.roster.has(from) || typeof d !== 'object' || d === null) return;
      const { t, d: data } = d as { t?: unknown; d?: unknown };
      if (typeof t === 'string' && t.length < 40) for (const h of this.gameHandlers) h(t, data, from);
    });
  }

  private gameHandlers: ((type: string, data: unknown, from: string) => void)[] = [];

  /** Minigame message to one player or everyone else. */
  sendGame(type: string, data: unknown, to?: string): void {
    this.net.send('mg', { t: type, d: data }, to);
  }

  onGame(h: (type: string, data: unknown, from: string) => void): void {
    this.gameHandlers.push(h);
  }

  get selfId(): string {
    return this.net.selfId;
  }

  listen(ev: Partial<SessionEvents>): void {
    this.ev = { ...this.ev, ...ev };
  }

  get mySeat(): number {
    return this.roster.get(this.net.selfId)?.seat ?? -1;
  }

  /** Number of connected peers, not counting yourself. */
  get peerCount(): number {
    return this.peers.size;
  }

  poseForSeat(seat: number): { yaw: number; pitch: number } | null {
    for (const e of this.roster.values()) if (e.seat === seat) return this.poses.get(e.id) ?? null;
    return null;
  }

  /** Per frame: hello retries until welcomed, clock pings to the host. */
  tick(): void {
    const now = this.now();
    if (this.role === 'host') return;
    if (!this.welcomed) {
      if (this.peers.size && now - this.lastHello > NET.helloRetryMs) {
        this.lastHello = now;
        this.net.send('hello', this.myState);
      }
      return;
    }
    if (this.hostId && now >= this.nextPing) {
      this.net.send('ping', now, this.hostId);
      this.pingsSent++;
      this.nextPing = now + (this.pingsSent < NET.pingFastCount ? NET.pingFastMs : NET.pingSlowMs);
    }
  }

  sendPose(yaw: number, pitch: number): void {
    this.net.send('pose', encodePose(yaw, pitch));
  }

  /** Own look/items changed. */
  setState(s: PersonState): void {
    this.myState = s;
    if (this.role === 'host') {
      const e = this.roster.get(this.net.selfId);
      if (e) e.state = s;
      this.broadcastRoster();
    } else if (this.hostId) {
      this.net.send('state', s, this.hostId);
    }
  }

  /** Host only: new speed from now on; distance continues seamlessly. */
  setSpeed(kmh: number, t: number): void {
    if (this.role !== 'host') return;
    this.train = { kmh, t0: t, d0: trainDistance(this.train, t) };
    this.net.send('train', this.train);
    this.ev.train?.(this.train);
  }

  /** Host only: change room settings for everyone. */
  setOpts(o: RoomOpts): void {
    if (this.role !== 'host') return;
    this.opts = o;
    this.net.send('opts', o);
    this.ev.opts?.(o);
  }

  /** Host only: debug blackout for everyone. */
  triggerBlackout(at: number): void {
    if (this.role !== 'host') return;
    this.blackoutAt = at;
    this.net.send('blackout', at);
    this.ev.blackout?.(at);
  }

  leave(): void {
    this.net.leave();
  }

  /** Host: reopen an empty room yourself (everyone else is gone, e.g. after a reload). */
  takeOver(): void {
    if (this.role === 'host') return;
    this.becomeHost();
  }

  private onJoin(id: string): void {
    this.peers.add(id);
    if (this.role === 'client' && !this.welcomed) {
      this.lastHello = this.now();
      this.net.send('hello', this.myState, id);
    }
  }

  private onLeave(id: string): void {
    this.peers.delete(id);
    this.poses.delete(id);
    const wasHost = id === this.hostId;
    if (!this.roster.delete(id)) return;
    if (this.role === 'host') {
      this.broadcastRoster();
      return;
    }
    if (!wasHost) {
      this.ev.roster?.();
      return;
    }
    // Host gone: whoever got the earliest seat in fill order (= in the room longest) takes over.
    const rank = (e: RosterEntry) => NET.seatOrder.indexOf(e.seat);
    const next = [...this.roster.values()].sort((a, b) => rank(a) - rank(b))[0];
    if (!next || next.id === this.net.selfId) this.becomeHost();
    else {
      this.hostId = next.id;
      this.clock.resetSamples();
      this.pingsSent = 0;
      this.nextPing = 0;
      this.ev.roster?.();
    }
  }

  private becomeHost(): void {
    this.role = 'host';
    this.hostId = this.net.selfId;
    if (!this.roster.has(this.net.selfId)) this.roster.set(this.net.selfId, { id: this.net.selfId, seat: 0, state: this.myState });
    for (const id of this.roster.keys()) if (id !== this.net.selfId && !this.peers.has(id)) this.roster.delete(id);
    const first = !this.welcomed;
    this.welcomed = true;
    this.ev.status?.('host');
    this.broadcastRoster();
    this.net.send('train', this.train);
    if (first) this.ev.welcome?.(this.welcomeMsg());
  }

  private onHello(d: unknown, from: string): void {
    if (this.role !== 'host') return;
    const state = parseState(d);
    if (!state) return;
    if (!this.roster.has(from)) {
      const used = new Set([...this.roster.values()].map((e) => e.seat));
      const seat = NET.seatOrder.find((s) => !used.has(s));
      if (seat === undefined) {
        this.net.send('full', null, from);
        return;
      }
      this.roster.set(from, { id: from, seat, state });
    }
    this.net.send('welcome', this.welcomeMsg(), from);
    this.broadcastRoster();
  }

  welcomeMsg(): Welcome {
    return {
      seed: this.clock.seed,
      startMs: this.clock.startMs,
      hostMs: this.clock.hostMs(this.now()),
      roster: [...this.roster.values()],
      train: this.train,
      blackoutAt: this.blackoutAt,
      opts: this.opts,
    };
  }

  private onWelcome(d: unknown, from: string): void {
    if (this.role === 'host') return;
    const w = parseWelcome(d);
    if (!w || !w.roster.some((e) => e.id === this.net.selfId)) return;
    const first = !this.welcomed;
    this.hostId = from;
    this.welcomed = true;
    this.applyRoster(w.roster);
    this.train = w.train;
    this.blackoutAt = w.blackoutAt;
    this.opts = w.opts;
    if (first) {
      this.clock.seed = w.seed;
      this.clock.startMs = w.startMs;
      this.clock.roughSync(w.hostMs, this.now());
      this.ev.welcome?.(w);
    }
  }

  private onRoster(d: unknown, from: string): void {
    if (from !== this.hostId || this.role === 'host') return;
    const r = parseRoster(d);
    if (r) this.applyRoster(r);
  }

  private onState(d: unknown, from: string): void {
    if (this.role !== 'host') return;
    const e = this.roster.get(from);
    const s = parseState(d);
    if (!e || !s) return;
    e.state = s;
    this.broadcastRoster();
  }

  private applyRoster(r: RosterEntry[]): void {
    this.roster.clear();
    for (const e of r) this.roster.set(e.id, e);
    this.ev.roster?.();
  }

  private broadcastRoster(): void {
    this.net.send('roster', [...this.roster.values()]);
    this.ev.roster?.();
  }
}
