import { NET, WHOAMI } from '../../config';
import type { GameNet, Minigame } from '../minigame';
import { parseCardData } from './cardImage';
import { parseIntent, WhoamiHost, type Intent, type Vote, type WhoamiState } from './logic';

/** Light shape check of the host's broadcast; the host is trusted for game decisions anyway. */
function parseState(v: unknown): (WhoamiState & { sentAt: number }) | null {
  if (typeof v !== 'object' || v === null) return null;
  const s = v as Record<string, unknown>;
  if (!['cards', 'play', 'done'].includes(s.phase as string) || !Array.isArray(s.players) || typeof s.authorOf !== 'object') return null;
  return v as WhoamiState & { sentAt: number };
}

/**
 * "Wer bin ich?" on one client. The host part (rules, secret votes) runs only on the host; every
 * client keeps the public state and the cards it may see.
 *
 * Secrecy: a card goes straight from its author to every player except its target, not through
 * the host (the host is a player too). The target only gets it after solving it or at round end.
 */
export class WhoamiGame implements Minigame {
  state: WhoamiState | null = null;
  /** Host clock offset for the vote countdown: deadline is in host time. */
  private hostSkew = 0;
  private host: WhoamiHost | null = null;
  private scores: Record<string, number> = {};
  /** target id -> card image. Never our own before it's revealed. */
  readonly cards = new Map<string, string>();
  private myCard: string | null = null;
  private revealed = new Set<string>();
  private listeners = new Set<() => void>();
  private lastPublish = 0;

  /** What I voted in the running vote (only here, never sent back), for "Deine Stimme: Ja ✓". */
  myVote: { key: string; v: Vote } | null = null;

  /** Vote time from the room settings, read when a round starts; the dev override in the constructor wins. */
  roomVoteS: () => number | undefined = () => undefined;

  constructor(
    private net: GameNet,
    /** Vote time override for tests (dev only). */
    private devVoteS?: number,
  ) {
    net.onMessage((t, d, f) => this.onMessage(t, d, f));
  }

  private get voteS(): number | undefined {
    return this.devVoteS ?? this.roomVoteS();
  }

  get selfId(): string {
    return this.net.selfId;
  }

  get isHost(): boolean {
    return this.net.isHost();
  }

  /** Whom I make the card for this round. */
  get myTarget(): string | null {
    const s = this.state;
    if (!s) return null;
    return Object.entries(s.authorOf).find(([, a]) => a === this.selfId)?.[0] ?? null;
  }

  get myCardSent(): boolean {
    return !!this.state?.ready.includes(this.selfId);
  }

  /** Seconds left in the running vote. */
  get voteLeftS(): number {
    const v = this.state?.vote;
    return v ? Math.max(0, (v.deadline - (Date.now() + this.hostSkew)) / 1000) : 0;
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
    if (order.length < 2) return;
    if (this.host) this.scores = { ...this.host.state.scores };
    this.host = new WhoamiHost(order, this.scores, (this.host?.state.round ?? 0) + 1, this.voteS);
    this.publish();
  }

  end(): void {
    this.toHost({ a: 'end' });
  }

  /** The Schaffner's fine, only while a round is being played. */
  penalize(id: string, points: number): boolean {
    if (!this.host || this.host.state.phase !== 'play') return false;
    this.host.penalize(id, points);
    this.publish();
    return true;
  }

  submitCard(img: string): void {
    const target = this.myTarget;
    if (!target || this.myCardSent) return;
    this.myCard = img;
    this.cards.set(target, img);
    for (const m of this.net.members()) if (m.id !== this.selfId && m.id !== target) this.net.send('wi:card', { target, img }, m.id);
    this.toHost({ a: 'ready' });
    this.emit();
  }

  /** Key of the running vote, so a remembered vote never leaks into the next one. */
  get voteKey(): string {
    const s = this.state;
    return s?.vote ? `${s.round}|${s.vote.guesser}|${s.vote.kind}|${s.vote.deadline}` : '';
  }

  vote(v: Vote): void {
    if (!this.state?.vote || this.myVote?.key === this.voteKey) return;
    this.myVote = { key: this.voteKey, v };
    this.toHost({ a: 'vote', v });
    this.emit();
  }

  toHost(i: Intent): void {
    if (this.isHost) this.applyIntent(this.selfId, i);
    else {
      const h = this.net.hostId();
      if (h) this.net.send('wi:intent', i, h);
    }
  }

  /** Host: when each absent player was last seen, for the grace time before they leave the round. */
  private goneSince = new Map<string, number>();

  /**
   * Host: someone reloaded and came back with a new id. They keep their place, points and turn;
   * the authors send them the cards again (never their own).
   */
  rejoin(oldId: string, newId: string): void {
    if (!this.host?.replace(oldId, newId)) return;
    this.goneSince.delete(oldId);
    this.net.send('wi:rejoin', { old: oldId, new: newId });
    this.publish();
    this.resendTo(newId, oldId);
  }

  /**
   * Someone came back with an empty memory: send them every card I hold, except their own. Not just
   * the one I made, because the cards they made themselves were lost with the reload. Checked
   * against both ids: the rejoin note can arrive before the renamed state.
   */
  private resendTo(newId: string, oldId: string): void {
    for (const [target, img] of this.cards) if (target !== newId && target !== oldId && target !== this.selfId) this.net.send('wi:card', { target, img }, newId);
  }


  absent(): string[] {
    const s = this.state;
    if (!s || s.phase === 'done') return [];
    const here = new Set(this.net.members().map((m) => m.id));
    return s.players.filter((p) => !here.has(p));
  }

  drop(id: string): void {
    if (this.isHost) this.dropNow(id);
    else {
      const h = this.net.hostId();
      if (h) this.net.send('wi:drop', id, h);
    }
  }

  /**
   * Host: someone asked to play on without `id`. Only someone who really isn't in the room is dropped;
   * the asker may see them gone a moment before the host does, so the request waits a little.
   */
  private dropAsked = new Map<string, number>();

  private dropNow(id: string): void {
    if (!this.host) return;
    if (this.net.members().some((m) => m.id === id)) {
      this.dropAsked.set(id, Date.now());
      return;
    }
    this.dropAsked.delete(id);
    this.goneSince.delete(id);
    if (this.host.removePlayer(id, Date.now())) this.publish();
  }

  tick(now: number): void {
    // Gave way to another host (network split): their state counts from now on.
    if (this.host && !this.isHost) this.host = null;
    // A new host (the old one left) takes over a running round from its public state.
    if (!this.host && this.isHost && this.state) {
      this.host = WhoamiHost.fromState(this.state, this.voteS);
      this.scores = { ...this.state.scores };
      this.publish(now);
    }
    if (!this.host) return;
    // Absent players keep their place; their turn passes meanwhile and votes don't wait for them.
    const here = new Set(this.net.members().map((m) => m.id));
    let changed = this.host.closeIfAllIn(here) || this.host.tick(Date.now());
    const t = Date.now();
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
      const s = this.host.state;
      if (t - since > WHOAMI.absentPassS * 1000 && s.phase === 'play' && s.turn === p && !s.vote) changed = this.host.intent(p, { a: 'pass' }, t, false) || changed;
      if (t - since > WHOAMI.absentLeaveS * 1000) {
        this.goneSince.delete(p);
        changed = this.host.removePlayer(p, t) || changed;
      }
    }
    // A slow heartbeat re-syncs anyone who missed a message.
    if (changed || now - this.lastPublish > 3000) this.publish(now);
  }

  onMessage(type: string, data: unknown, from: string): void {
    if (type === 'wi:state') {
      if (from !== this.net.hostId()) return;
      const s = parseState(data);
      if (s) {
        this.hostSkew = s.sentAt - Date.now();
        this.applyState(s);
      }
    } else if (type === 'wi:rejoin') {
      // Someone came back: as an author, give them my card again (unless it's theirs).
      const d = data as { new?: unknown; old?: unknown };
      if (from === this.net.hostId() && typeof d?.new === 'string' && typeof d.old === 'string' && d.new !== this.selfId) this.resendTo(d.new, d.old);
    } else if (type === 'wi:drop') {
      if (typeof data === 'string') this.dropNow(data);
    } else if (type === 'wi:intent') {
      const i = parseIntent(data);
      if (i && this.host) this.applyIntent(from, i);
    } else if (type === 'wi:card') {
      const d = data as { target?: unknown; img?: unknown };
      const img = parseCardData(d?.img);
      const target = typeof d?.target === 'string' ? d.target : null;
      const s = this.state;
      // From the author, or a copy from another player after a rejoin (never overwriting what we have).
      if (!img || !target || !s || !(s.authorOf[target] === from || (s.players.includes(from) && !this.cards.has(target)))) return;
      // Our own card only once it's revealed: before that it is dropped, even if someone sends it.
      if (target === this.selfId && !(s.phase === 'done' || s.solved.includes(this.selfId))) return;
      this.cards.set(target, img);
      this.emit();
    }
  }

  private applyIntent(from: string, i: Intent): void {
    if (this.host?.intent(from, i, Date.now(), from === this.selfId)) this.publish();
  }

  private publish(now = performance.now()): void {
    if (!this.host) return;
    this.lastPublish = now;
    const s = { ...structuredClone(this.host.state), sentAt: Date.now() };
    this.net.send('wi:state', s);
    this.applyState(s);
  }

  private applyState(s: WhoamiState): void {
    if (!this.state || s.round !== this.state.round) {
      this.cards.clear();
      this.myCard = null;
      this.revealed.clear();
    }
    this.state = s;
    // Reveal: the card I made goes to its target once they solved it, or when the round is over.
    const target = this.myTarget;
    if (this.myCard && target && !this.revealed.has(target) && (s.phase === 'done' || s.solved.includes(target))) {
      this.revealed.add(target);
      this.net.send('wi:card', { target, img: this.myCard }, target);
    }
    this.emit();
  }
}
