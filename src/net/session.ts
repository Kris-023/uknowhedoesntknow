import type { PersonState } from '../characters/person';
import { NET } from '../config';
import { localMs, type SharedClock } from '../core/clock';
import {
  encodePose,
  idHash,
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

/** Game messages from peers not yet in the roster wait this long (ms) and at most this many (oldest dropped first). */
const PENDING_GAME_MS = 10_000;
const PENDING_GAME_MAX = 100;
/**
 * How long a handover is remembered for settling a clash and for electing its target when the old
 * host leaves. Long enough for a late welcome (the wait is `NET.handoverWaitMs`), short enough that a
 * handover that never happened stops mattering quickly.
 */
const HANDOVER_MEMORY_MS = 15_000;
/** A host that has answered a clash as the winner does not answer the same host again within this time. */
const CLASH_ANSWER_MS = 3_000;

export interface SessionEvents {
  /** First welcome from a host: seed and clock are known now, the world can be built. */
  welcome(w: Welcome): void;
  roster(): void;
  train(t: Train): void;
  blackout(at: number): void;
  /** Room settings changed (host decision). */
  opts(o: RoomOpts): void;
  /** Host only: a player who had left came back under a new id (reload, reconnect). */
  rejoin(oldId: string, newId: string): void;
  /** Host role changed (migration, a handover, or a second host after a network split gave way) or the room was full. */
  status(s: 'host' | 'client' | 'full'): void;
}

/**
 * Lobby logic on top of a Transport. The room creator is host: it owns seed, clock, seat
 * assignment, the speed profile and (later) the game state. Head poses go peer to peer, since
 * they're cosmetic and every hop through the host would add latency.
 *
 * If the host leaves, the remaining player who has been in the room longest takes over. Everyone knows the
 * same roster, so all peers reach the same decision without extra messages.
 *
 * Players who drop out (reload, network, another browser) are remembered by every peer for
 * `NET.rejoinMs`: by tab token, browser id or, failing both, by name. Whoever is host when they come
 * back gives them their place again, and the games learn the old id.
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
  opts: RoomOpts = parseOpts(undefined);
  private lastHello = -Infinity;
  /** Host who asked someone to take over and still waits for their welcome; stays host until it comes. */
  private handing: { to: string; until: number } | null = null;
  /**
   * Who handed over to whom, remembered for `HANDOVER_MEMORY_MS` on the two sides of a handover
   * (`handedTo` on the old host, `handedFrom` on the new one). If both claim to be host (the
   * confirmation was late or lost) the new host wins, whatever the roster sizes say.
   */
  private handedTo: { id: string; at: number } | null = null;
  private handedFrom: { id: string; at: number } | null = null;
  /** Every other peer's hint of the same handover: if the host leaves now, this player takes over. */
  private successor: { id: string; at: number } | null = null;
  /** When the host last showed a sign of life (any message of its we accepted, or since we started following it). */
  private hostSeenAt = 0;
  /** When we last answered a clash against this host as the winner (loop breaker). */
  private clashAnswered = new Map<string, number>();
  private nextPing = 0;
  private pingsSent = 0;
  private ev: Partial<SessionEvents> = {};

  constructor(
    private net: Transport,
    private clock: SharedClock,
    host: boolean,
    private myState: PersonState,
    private now: () => number = localMs,
    /**
     * Per-tab secret that survives a reload (sessionStorage): lets the host recognise someone who
     * comes back under a new peer id. Only the host ever sees it.
     */
    private token: string = Math.random().toString(36).slice(2),
    /** Per-browser id (localStorage): recognises the same browser in a new tab. */
    private pid = '',
  ) {
    this.role = host ? 'host' : 'client';
    this.hostId = host ? net.selfId : null;
    this.welcomed = host;
    if (host) this.roster.set(net.selfId, { id: net.selfId, seat: 0, state: myState, keys: this.myKeys() });

    net.onJoin((id) => this.onJoin(id));
    net.onLeave((id) => this.onLeave(id));
    net.on('hello', (d, from) => this.onHello(d, from));
    net.on('welcome', (d, from) => this.onWelcome(d, from));
    net.on('roster', (d, from) => this.onRoster(d, from));
    net.on('state', (d, from) => this.onState(d, from));
    net.on('handover', (d, from) => this.onHandover(d, from));
    net.on('pose', (d, from) => {
      const p = parsePose(d);
      if (p) this.poses.set(from, p);
    });
    net.on('ping', (d, from) => {
      if (this.role === 'host' && typeof d === 'number') net.send('pong', [d, this.clock.hostMs(this.now())], from);
    });
    net.on('pong', (d, from) => {
      if (from !== this.hostId || !Array.isArray(d) || typeof d[0] !== 'number' || typeof d[1] !== 'number') return;
      this.heard();
      this.clock.addSample(d[0], d[1], this.now());
    });
    net.on('train', (d, from) => {
      const t = from === this.hostId ? parseTrain(d) : null;
      if (!t) return;
      this.heard();
      this.train = t;
      this.ev.train?.(t);
    });
    net.on('blackout', (d, from) => {
      if (from !== this.hostId || typeof d !== 'number' || !Number.isFinite(d)) return;
      this.heard();
      this.blackoutAt = d;
      this.ev.blackout?.(d);
    });
    net.on('opts', (d, from) => {
      if (from !== this.hostId) return;
      this.heard();
      this.opts = parseOpts(d);
      this.ev.opts?.(this.opts);
    });
    net.on('full', (_d, from) => {
      if (!this.welcomed && from !== this.net.selfId) this.ev.status?.('full');
    });
    // Minigame traffic: one channel, typed inside. Only from players in the room; from someone who
    // is not (yet) in our roster it waits briefly: a just-rejoined peer speaks before the roster
    // that names it has reached us.
    net.on('mg', (d, from) => {
      if (typeof d !== 'object' || d === null) return;
      const { t, d: data } = d as { t?: unknown; d?: unknown };
      if (typeof t !== 'string' || t.length >= 40) return;
      if (this.roster.has(from)) this.deliverGame(t, data, from);
      else this.holdGame(t, data, from);
    });
  }

  /** Game messages from peers our roster doesn't know yet, oldest first. */
  private pendingGame: { t: string; d: unknown; from: string; at: number }[] = [];

  private deliverGame(t: string, data: unknown, from: string): void {
    for (const h of this.gameHandlers) h(t, data, from);
  }

  private holdGame(t: string, data: unknown, from: string): void {
    const now = this.now();
    this.pendingGame = this.pendingGame.filter((m) => now - m.at <= PENDING_GAME_MS);
    this.pendingGame.push({ t, d: data, from, at: now });
    if (this.pendingGame.length > PENDING_GAME_MAX) this.pendingGame.shift();
  }

  /** Roster grew: hand over what peers said before we knew them (in order); the rest keeps waiting until it expires. */
  private flushPending(): void {
    if (!this.pendingGame.length) return;
    const now = this.now();
    const all = this.pendingGame.filter((m) => now - m.at <= PENDING_GAME_MS);
    this.pendingGame = all.filter((m) => !this.roster.has(m.from));
    for (const m of all) if (this.roster.has(m.from)) this.deliverGame(m.t, m.d, m.from);
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

  /** Name of someone who dropped out recently (for "X ist getrennt"). */
  goneName(id: string): string | null {
    return this.gone.get(id)?.name ?? null;
  }

  /** Per frame: hello retries until welcomed (or back in the roster), clock pings to the host. */
  tick(): void {
    const now = this.now();
    if (this.role === 'host') {
      // Nobody confirmed the handover in time (the target left or never heard): carry on as host.
      if (this.handing && now > this.handing.until) {
        this.handing = null;
        // Tell the others it is off, so none of them keeps the target as its successor. The old host
        // keeps `handedTo` on purpose: the target may have become host after all, and then it wins.
        this.net.send('handover', this.net.selfId);
        this.broadcastRoster();
      }
      return;
    }
    // Last resort, whatever went wrong before (a lost message, two handovers, a host that is itself
    // a client): a host we have not heard from for too long is treated as gone.
    if (this.welcomed && this.hostId && now - this.hostSeenAt > NET.hostSilentMs) this.hostSilent(now);
    // Not (or no longer) in the host's roster: a connection drop the host noticed, or we gave way to
    // another host. Same hello as at the start; the host recognises the token.
    if (!this.welcomed || (this.hostId && !this.roster.has(this.net.selfId))) {
      if (this.peers.size && now - this.lastHello > NET.helloRetryMs) {
        this.lastHello = now;
        this.net.send('hello', this.helloMsg());
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

  /**
   * Host only: give the host role to another connected player. The target is asked directly and
   * becomes host on its own; we stay host until its welcome arrives (see `onWelcome`), so there is
   * normally never a moment without a host and, if the target vanishes, nothing is lost. The message
   * goes to everyone: the others only note who is next in line, in case we leave before the target's
   * welcome reaches them (`onLeave`). Returns false if the request does not apply (not host, a
   * handover already running, unknown or unreachable target).
   */
  handOver(id: string): boolean {
    if (this.role !== 'host' || this.handing || id === this.net.selfId || !this.roster.has(id) || !this.peers.has(id)) return false;
    const now = this.now();
    this.handing = { to: id, until: now + NET.handoverWaitMs };
    this.handedTo = { id, at: now };
    this.handedFrom = null;
    this.net.send('handover', id);
    return true;
  }

  /** A handover has been asked for and the new host's welcome has not arrived yet. */
  get handingOver(): boolean {
    return this.handing !== null;
  }

  /** Host: reopen an empty room yourself (everyone else is gone, e.g. after a reload). */
  takeOver(): void {
    if (this.role === 'host') return;
    this.becomeHost();
  }

  private onJoin(id: string): void {
    this.peers.add(id);
    if (this.role === 'host') {
      // If the newcomer is a host too (both sides of a network split), our roster settles who stays.
      this.net.send('roster', [...this.roster.values()], id);
    } else if (!this.welcomed || id === this.hostId) {
      // A first contact, or the host is reachable again after a drop.
      this.lastHello = this.now();
      this.net.send('hello', this.helloMsg(), id);
    }
  }

  private helloMsg(): { s: PersonState; k: string; p: string } {
    return { s: this.myState, k: this.token, p: this.pid };
  }

  private myKeys(): string[] {
    return this.pid ? [idHash(this.token), idHash(this.pid)] : [idHash(this.token)];
  }

  /** Everyone who left recently, by their last peer id; every peer keeps this, in case it becomes host. */
  private gone = new Map<string, { id: string; seat: number; at: number; keys: string[]; name: string }>();

  private remember(e: RosterEntry): void {
    if (e.id !== this.net.selfId) this.gone.set(e.id, { id: e.id, seat: e.seat, at: this.now(), keys: e.keys ?? [], name: e.state.name });
  }

  /** Host: who a newcomer was before, by token or browser, else by an unambiguous name. */
  private findGone(keys: string[], name: string) {
    const now = this.now();
    for (const [id, g] of this.gone) if (now - g.at > NET.rejoinMs || this.roster.has(id)) this.gone.delete(id);
    const all = [...this.gone.values()];
    for (const k of keys) {
      const hit = all.find((g) => g.keys[0] === k) ?? all.find((g) => g.keys.includes(k));
      if (hit) return hit;
    }
    // Another browser knows nothing of the old one: the name is all there is (a room of friends).
    const n = name.trim().toLowerCase();
    if (!n || [...this.roster.values()].some((e) => e.state.name.trim().toLowerCase() === n)) return undefined;
    const same = all.filter((g) => g.name.trim().toLowerCase() === n);
    return same.length === 1 ? same[0] : undefined;
  }

  private onLeave(id: string): void {
    this.peers.delete(id);
    this.poses.delete(id);
    const wasHost = id === this.hostId;
    if (this.handing?.to === id) {
      this.handing = null;
      this.handedTo = null;
    }
    const left = this.roster.get(id);
    if (left) this.remember(left);
    if (!this.roster.delete(id)) return;
    if (this.role === 'host') {
      this.broadcastRoster();
      return;
    }
    if (!wasHost) {
      this.ev.roster?.();
      return;
    }
    this.followElected(this.elect(false));
  }

  /**
   * Who takes over from a host that is gone: the player it just handed over to, if we were told and
   * they are still here; otherwise whoever got the earliest seat in fill order (= in the room
   * longest). Everyone holds the same roster, so all peers reach the same pick without a message.
   * `connectedOnly`: skip players we do not currently see (the watchdog, where the roster may still
   * list the dead).
   */
  private elect(connectedOnly: boolean, skip?: string): RosterEntry | undefined {
    const rank = (e: RosterEntry) => NET.seatOrder.indexOf(e.seat);
    const ok = (e: RosterEntry) => e.id !== skip && (!connectedOnly || e.id === this.net.selfId || this.peers.has(e.id));
    const hinted = this.successor && this.now() - this.successor.at <= HANDOVER_MEMORY_MS ? this.roster.get(this.successor.id) : undefined;
    this.successor = null;
    if (hinted && ok(hinted)) return hinted;
    return [...this.roster.values()].filter(ok).sort((a, b) => rank(a) - rank(b))[0];
  }

  /** Become host if elected, otherwise follow whoever was. */
  private followElected(next: RosterEntry | undefined, announce = false): void {
    if (!next || next.id === this.net.selfId) {
      this.becomeHost(announce);
      return;
    }
    this.setHost(next.id);
    this.clock.resetSamples();
    this.pingsSent = 0;
    this.nextPing = 0;
    this.ev.roster?.();
  }

  private heard(): void {
    this.hostSeenAt = this.now();
  }

  /** Follow `id` from now on; its silence is counted from here. */
  private setHost(id: string): void {
    this.hostId = id;
    this.heard();
  }

  /**
   * The watchdog fired: we have heard nothing from the host for `NET.hostSilentMs`. Run the same
   * election as for a host that left, without the silent one, among the peers we really see. A
   * duplicate host that comes out of it is settled by `hostClash`. The new pick gets a hello right
   * away, so it knows us even if it never had us in its roster.
   */
  private hostSilent(now: number): void {
    const lost = this.hostId;
    this.hostSeenAt = now;
    const next = this.elect(true, lost ?? undefined);
    // Announce by welcome: the others may be following somebody else and take our roster only after it.
    this.followElected(next, true);
    if (this.role === 'client') {
      this.lastHello = now;
      this.net.send('hello', this.helloMsg(), this.hostId ?? undefined);
    }
  }

  private becomeHost(announce = false): void {
    this.role = 'host';
    this.handing = null;
    this.successor = null;
    this.hostId = this.net.selfId;
    if (!this.roster.has(this.net.selfId)) this.roster.set(this.net.selfId, { id: this.net.selfId, seat: 0, state: this.myState, keys: this.myKeys() });
    for (const [id, e] of this.roster) {
      if (id === this.net.selfId || this.peers.has(id)) continue;
      this.remember(e);
      this.roster.delete(id);
    }
    const first = !this.welcomed;
    this.welcomed = true;
    this.ev.status?.('host');
    // After a handover (or a watchdog election) the others may still count another peer as host and
    // only take the roster from it: the welcome comes first (peers in the room switch on it), then
    // roster and train follow.
    if (announce) this.net.send('welcome', this.welcomeMsg());
    this.broadcastRoster();
    this.net.send('train', this.train);
    if (first) this.ev.welcome?.(this.welcomeMsg());
    this.flushPending();
  }

  private onHello(d: unknown, from: string): void {
    // While handing over, the joiner's next hello (they repeat it) goes to the new host.
    if (this.role !== 'host' || this.handing) return;
    const o = (typeof d === 'object' && d !== null ? d : {}) as { s?: unknown; k?: unknown; p?: unknown };
    const state = parseState(o.s);
    if (!state) return;
    const secret = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? idHash(v) : null);
    const keys = [secret(o.k), secret(o.p)].filter((k): k is string => !!k);
    if (!this.roster.has(from)) {
      const used = new Set([...this.roster.values()].map((e) => e.seat));
      // Back within the grace time: their seat if it's still free, and the games learn who it was.
      const back = this.findGone(keys, state.name);
      // Seats of people who just dropped stay free for them while others are left.
      const held = new Set([...this.gone.values()].filter((g) => g !== back).map((g) => g.seat));
      const seat = back && !used.has(back.seat) ? back.seat : (NET.seatOrder.find((s) => !used.has(s) && !held.has(s)) ?? NET.seatOrder.find((s) => !used.has(s)));
      if (seat === undefined) {
        this.net.send('full', null, from);
        return;
      }
      this.roster.set(from, { id: from, seat, state, keys });
      if (back) {
        this.gone.delete(back.id);
        this.net.send('welcome', this.welcomeMsg(), from);
        this.broadcastRoster();
        this.ev.rejoin?.(back.id, from);
        this.flushPending();
        return;
      }
    }
    this.net.send('welcome', this.welcomeMsg(), from);
    this.broadcastRoster();
    this.flushPending();
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
    const w = parseWelcome(d);
    if (!w) return;
    if (this.role === 'host') {
      // Another host announces itself: a handover target, or the winner of a clash. Only believed from
      // a peer we know and if the welcome lists us, like a client would require.
      if (!w.roster.some((e) => e.id === this.net.selfId) || !this.roster.has(from) || !this.peers.has(from)) return;
      this.hostClash(w.roster, from);
      if (this.role === 'host') return;
    }
    if (!w.roster.some((e) => e.id === this.net.selfId)) return;
    // Once in a room, a welcome counts only from someone our roster knows (not from a stranger).
    if (this.welcomed && !this.roster.has(from)) return;
    const first = !this.welcomed;
    // Another host than the one we followed (a handover): measure the clock against the new one.
    if (this.welcomed && this.hostId !== from) {
      this.clock.resetSamples();
      this.pingsSent = 0;
      this.nextPing = 0;
    }
    if (this.hostId !== from) this.successor = null;
    this.setHost(from);
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

  /**
   * The host hands over to `d`. Only the current host may say so. The one named takes over; everyone
   * else just notes who is next, so that they agree on the successor if the host leaves right after.
   */
  private onHandover(d: unknown, from: string): void {
    if (this.role !== 'client' || !this.welcomed || from !== this.hostId || typeof d !== 'string') return;
    // The host naming itself calls it off.
    if (d === from) {
      this.successor = null;
      return;
    }
    if (!this.roster.has(from) || !this.roster.has(d)) return;
    if (d !== this.net.selfId) {
      this.successor = { id: d, at: this.now() };
      return;
    }
    this.handedFrom = { id: from, at: this.now() };
    this.handedTo = null;
    this.becomeHost(true);
  }

  /** Give up the host role to `to` (it won a clash, or took over at our request). */
  private stepDown(to: string): void {
    this.role = 'client';
    this.setHost(to);
    this.handing = null;
    this.successor = null;
    this.clock.resetSamples();
    this.pingsSent = 0;
    this.nextPing = 0;
    this.lastHello = -Infinity;
    this.ev.status?.('client');
  }

  private onRoster(d: unknown, from: string): void {
    if (this.role === 'host' && from !== this.net.selfId) {
      this.hostClash(parseRoster(d), from);
      return;
    }
    if (from !== this.hostId) return;
    const r = parseRoster(d);
    if (r) {
      this.heard();
      this.applyRoster(r);
    }
  }

  /**
   * Two hosts at once: the old one was cut off and came back, or a handover's confirmation was late
   * or lost. Who stays:
   * 1. a handover target against the host that handed over to it (for `HANDOVER_MEMORY_MS`): the target;
   * 2. otherwise the smaller id.
   * Nothing else enters the decision: roster sizes differ between peers that see different parts of
   * the mesh (and between moments), and a rule on them let both sides win or both give way. Each side
   * evaluates the same rule on ids and on the handover it took part in, so they decide alike. The
   * loser joins the winner like a returning player and keeps its place through the rejoin; the winner
   * tells *everyone* by welcome, so the loser's followers switch too (`onWelcome`), at most once per
   * `CLASH_ANSWER_MS` per other host.
   */
  private hostClash(r: RosterEntry[] | null, from: string): void {
    if (!r || !r.some((e) => e.id === from)) return;
    const now = this.now();
    const fresh = (h: { id: string; at: number } | null) => h?.id === from && now - h.at <= HANDOVER_MEMORY_MS;
    const theyWin = fresh(this.handedTo) || (!fresh(this.handedFrom) && from < this.net.selfId);
    if (!theyWin) {
      const last = this.clashAnswered.get(from);
      if (last !== undefined && now - last < CLASH_ANSWER_MS) return;
      this.clashAnswered.set(from, now);
      // The loser hears it by roster (it may not know us yet, so a welcome alone would not convince it)
      // and everyone else by welcome.
      this.net.send('roster', [...this.roster.values()], from);
      this.net.send('welcome', this.welcomeMsg());
      return;
    }
    this.stepDown(from);
    this.applyRoster(r);
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
    const now = new Set(r.map((e) => e.id));
    for (const e of this.roster.values()) if (!now.has(e.id)) this.remember(e);
    this.roster.clear();
    for (const e of r) this.roster.set(e.id, e);
    this.ev.roster?.();
    this.flushPending();
  }

  private broadcastRoster(): void {
    // Not while handing over: the new host would take it for a second host's roster. It sends the roster itself.
    if (!this.handing) this.net.send('roster', [...this.roster.values()]);
    this.ev.roster?.();
  }
}
