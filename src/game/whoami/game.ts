import { NET, WHOAMI } from '../../config';
import { Recovery, type GameNet, type Minigame } from '../minigame';
import { byTableOrder } from '../tableOrder';
import { tabStore, type TabStore } from '../tabStore';
import { parseCardData } from './cardImage';
import { parseIntent, WhoamiHost, type Intent, type Vote, type WhoamiState } from './logic';

/** Light shape check of the host's broadcast; the host is trusted for game decisions anyway. */
function parseState(v: unknown): (WhoamiState & { sentAt: number }) | null {
  if (typeof v !== 'object' || v === null) return null;
  const s = v as Record<string, unknown>;
  if (!['cards', 'play', 'done'].includes(s.phase as string) || !Array.isArray(s.players) || typeof s.authorOf !== 'object') return null;
  return v as WhoamiState & { sentAt: number };
}

/** Topic of the "send me the cards I'm missing" ask (see `Recovery`). */
const CARDS_TOPIC = 'wi:cards';
/** A card has to be missing this long (ms of the tick clock) before we ask: normally it is just on its way. */
const MISSING_GRACE_MS = 1500;

const isMyCard = (v: unknown): v is { round: number; img: string } => typeof v === 'object' && v !== null && typeof (v as { round?: unknown }).round === 'number' && typeof (v as { img?: unknown }).img === 'string';
const isMyVote = (v: unknown): v is { key: string; v: Vote } =>
  typeof v === 'object' && v !== null && typeof (v as { key?: unknown }).key === 'string' && ['yes', 'no', 'idk'].includes((v as { v?: string }).v as string);

/**
 * "Wer bin ich?" on one client. The host part (rules, secret votes) runs only on the host; every
 * client keeps the public state and the cards it may see.
 *
 * Secrecy: a card goes straight from its author to every player except its target, not through
 * the host (the host is a player too). The target only gets it after solving it or at round end.
 *
 * Reload: what is private to this tab (the card I made, my vote) lives in `tabStore` ('wi') and
 * comes back with the first state. Cards I lack are asked for from the others (`wi:cards`) until I
 * have them all, so a push that was lost or arrived before the state doesn't matter.
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
  private rec: Recovery;
  /** When the cards I lack were first seen missing (tick clock), and the missing set an ask gave up on. */
  private missingSince: number | null = null;
  private gaveUpOn = '';

  /** What I voted in the running vote (only here, never sent back), for "Deine Stimme: Ja ✓". */
  myVote: { key: string; v: Vote } | null = null;

  /** Vote time from the room settings, read when a round starts; the dev override in the constructor wins. */
  roomVoteS: () => number | undefined = () => undefined;

  constructor(
    private net: GameNet,
    /** Vote time override for tests (dev only). */
    private devVoteS?: number,
    /** Private state of this tab; tests give each simulated tab its own scope. */
    private store: TabStore = tabStore('wi'),
  ) {
    net.onMessage((t, d, f) => this.onMessage(t, d, f));
    this.rec = new Recovery(net);
    this.rec.answer(CARDS_TOPIC, (q, from) => this.cardFor(q, from));
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

  /** A round is on: cards being made or played. */
  get running(): boolean {
    return !!this.state && this.state.phase !== 'done';
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
    const order = [...this.net.members()].sort((a, b) => byTableOrder(a.seat, b.seat)).map((m) => m.id);
    if (order.length < 2) return;
    if (this.host) this.scores = { ...this.host.state.scores };
    this.host = new WhoamiHost(order, this.scores, (this.host?.state.round ?? 0) + 1, this.voteS);
    this.publish();
  }

  end(): void {
    this.toHost({ a: 'end' });
  }

  /** Host: there is a decision of this round to take back. */
  get canUndo(): boolean {
    return this.isHost && !!this.host?.canUndo;
  }

  /** Host: take back the last decision ("Zug zurück"). */
  undo(): void {
    if (this.isHost && this.host?.undo()) this.publish();
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
    // Survives a reload: nobody else may hold this card (2 players), and the target needs it once solved.
    if (this.state) this.store.set('myCard', { round: this.state.round, img });
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
    this.store.set('myVote', this.myVote);
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
    this.renameCard(oldId, newId);
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

  /** The cards I hold are keyed by target: the target's new id after a reload. */
  private renameCard(oldId: string, newId: string): void {
    const img = this.cards.get(oldId);
    if (img === undefined) return;
    this.cards.delete(oldId);
    // Never my own card: it's only mine to see once revealed, and then it comes back through `wi:cards`.
    if (newId !== this.selfId) this.cards.set(newId, img);
  }

  /** The card of `target` is shown to them once they solved it or the round is over. */
  private revealedTo(target: string): boolean {
    const s = this.state;
    return !!s && (s.phase === 'done' || s.solved.includes(target));
  }

  /** Targets whose card I should have but don't: the author has sent it (ready), it's not mine, or mine and revealed. */
  missingCards(): string[] {
    const s = this.state;
    if (!s) return [];
    return s.players.filter((t) => !this.cards.has(t) && s.ready.includes(s.authorOf[t]) && (t !== this.selfId || this.revealedTo(t)));
  }

  /** Answer to a `wi:cards` ask: one card the asker lacks (they come one per reply, the asker asks again). */
  private cardFor(query: unknown, from: string): unknown {
    const have = (query as { have?: unknown } | null)?.have;
    if (!this.state || !Array.isArray(have)) return undefined;
    for (const [target, img] of this.cards) {
      if (have.includes(target) || !this.state.players.includes(target)) continue;
      // Their own card only once it's theirs to see.
      if (target === from && !this.revealedTo(from)) continue;
      return { target, img };
    }
    return undefined;
  }

  private askForCards(): void {
    const key = this.missingCards().join(',');
    this.rec.ask(CARDS_TOPIC, { have: [...this.cards.keys()] }, {
      onReply: (d, from) => {
        const c = d as { target?: unknown; img?: unknown } | null;
        const img = parseCardData(c?.img);
        // Progress: ask again at once with the new list, so the next card doesn't wait for the interval.
        if (img && typeof c?.target === 'string' && this.acceptCard(c.target, img, from) && this.missingCards().length) this.askForCards();
      },
      done: () => this.missingCards().length === 0,
      onGiveUp: () => (this.gaveUpOn = key),
    });
  }

  /** Take a card from `from` if it may be ours: from its author, or a copy from another player when we have none. */
  private acceptCard(target: string, img: string, from: string): boolean {
    const s = this.state;
    if (!s || !(s.authorOf[target] === from || (s.players.includes(from) && !this.cards.has(target)))) return false;
    // Our own card only once it's revealed: before that it is dropped, even if someone sends it.
    if (target === this.selfId && !this.revealedTo(target)) return false;
    this.cards.set(target, img);
    this.emit();
    return true;
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
    this.rec.tick(now);
    this.askIfMissing(now);
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

  /** Cards missing for a moment (a reload, a lost message) are asked for; an ask that gave up isn't repeated for the same set. */
  private askIfMissing(now: number): void {
    const missing = this.missingCards();
    if (!missing.length) {
      this.missingSince = null;
      this.gaveUpOn = '';
    } else if (this.rec.pending(CARDS_TOPIC) || missing.join(',') === this.gaveUpOn) {
      // Already asking, or nobody had them.
    } else if (this.missingSince === null) {
      this.missingSince = now;
    } else if (now - this.missingSince >= MISSING_GRACE_MS) {
      this.askForCards();
    }
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
      if (from === this.net.hostId() && typeof d?.new === 'string' && typeof d.old === 'string' && d.new !== this.selfId) {
        this.renameCard(d.old, d.new);
        this.resendTo(d.new, d.old);
      }
    } else if (type === 'wi:drop') {
      if (typeof data === 'string') this.dropNow(data);
    } else if (type === 'wi:intent') {
      const i = parseIntent(data);
      if (i && this.host) this.applyIntent(from, i);
    } else if (type === 'wi:card') {
      const d = data as { target?: unknown; img?: unknown };
      const img = parseCardData(d?.img);
      const target = typeof d?.target === 'string' ? d.target : null;
      // From the author, or a copy from another player after a rejoin (never overwriting what we have).
      // One that comes before we have any state is dropped: the ask for missing cards gets it again.
      if (img && target) this.acceptCard(target, img, from);
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

  /** After a reload: the card I made and my vote come back from this tab's store (checked against the state). */
  private restorePrivate(s: WhoamiState): void {
    if (!this.myCard && s.ready.includes(this.selfId)) {
      const c = this.store.get('myCard', isMyCard);
      const target = this.myTarget;
      if (c && c.round === s.round && target && parseCardData(c.img)) {
        this.myCard = c.img;
        this.cards.set(target, c.img);
      } else if (c) this.store.remove('myCard');
    }
    if (!this.myVote && s.vote) {
      const v = this.store.get('myVote', isMyVote);
      if (v && v.key === this.voteKey) this.myVote = v;
    }
  }

  private applyState(s: WhoamiState): void {
    s.undo ??= 0;
    if (!this.state || s.round !== this.state.round) {
      this.cards.clear();
      this.myCard = null;
      this.revealed.clear();
      this.missingSince = null;
      this.gaveUpOn = '';
      this.rec.cancel(CARDS_TOPIC);
      // A new round (not the first state after a reload) starts with nothing private.
      if (this.state) this.store.clear();
    } else if (s.undo !== this.state.undo) {
      // A solve was taken back. What was seen stays seen, but the own card goes back to "?" and
      // its author sends it again when it's solved for real.
      const open = (id: string) => s.phase !== 'done' && !s.solved.includes(id);
      if (open(this.selfId)) this.cards.delete(this.selfId);
      for (const t of [...this.revealed]) if (open(t)) this.revealed.delete(t);
    }
    this.state = s;
    this.restorePrivate(s);
    // Reveal: the card I made goes to its target once they solved it, or when the round is over.
    const target = this.myTarget;
    if (this.myCard && target && !this.revealed.has(target) && (s.phase === 'done' || s.solved.includes(target))) {
      this.revealed.add(target);
      this.net.send('wi:card', { target, img: this.myCard }, target);
    }
    this.emit();
  }
}
