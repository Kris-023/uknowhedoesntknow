import { NET, SAGS, WORDS } from '../../config';
import { parseCard } from '../../words/custom';
import { drawCard, wordPool } from '../../words';
import type { DeckId, WordCard } from '../../words/types';
import type { GameNet, Minigame } from '../minigame';
import { guessersOf, parseIntent, SagsHost, watchersOf, type Intent, type SagsState } from './logic';

/** Light shape check of the host's broadcast; the host is trusted for game decisions anyway. */
function parseState(v: unknown): (SagsState & { sentAt: number }) | null {
  if (typeof v !== 'object' || v === null) return null;
  const s = v as Record<string, unknown>;
  if (!['ready', 'turn', 'done'].includes(s.phase as string) || !Array.isArray(s.players) || !Array.isArray(s.log)) return null;
  return v as SagsState & { sentAt: number };
}

/** What this client brings into the room: its own submissions under its stable player id. */
export interface WordSource {
  pid: string;
  cards: readonly WordCard[];
}

/** Room settings the game reads when it draws or starts. */
export interface SagsRoom {
  decks(): readonly DeckId[];
  turnS(): number;
  /** Teams when four play (otherwise everyone against everyone). */
  teams(): boolean;
}

/**
 * "Sag's anders" on one client. The host part (rules, points) runs only on the host. The explainer
 * draws cards locally and sends each one straight to the other team (who watch for forbidden
 * words), never to the people who have to guess it and never through the host.
 */
export class SagsGame implements Minigame {
  state: SagsState | null = null;
  private host: SagsHost | null = null;
  private scores: Record<string, number> = {};
  private hostSkew = 0;
  private listeners = new Set<() => void>();
  private lastPublish = 0;
  /** My card while I explain. */
  hand: { no: number; card: WordCard } | null = null;
  /** The explainer's card while I watch for fouls (other team only). */
  seen: { no: number; card: WordCard } | null = null;
  /** Submissions in the room by session id (mine included). */
  private shared = new Map<string, WordSource>();
  /** Members I have sent my words to, so newcomers get them once. */
  private sentTo = new Set<string>();
  private sentRound = -1;
  /** Cards I drew this session, so a new round doesn't start with the same words. */
  private drawn = new Set<string>();
  private goneSince = new Map<string, number>();

  constructor(
    private net: GameNet,
    private room: SagsRoom,
    private mine: () => WordSource,
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

  /** Seconds left in the running turn. */
  get turnLeftS(): number {
    const d = this.state?.deadline;
    return d ? Math.max(0, (d - (Date.now() + this.hostSkew)) / 1000) : 0;
  }

  /** Seconds left to challenge a played card (free for all), 0 when it's too late. */
  challengeLeftS(at: number): number {
    return Math.max(0, SAGS.challengeS - (Date.now() + this.hostSkew - at) / 1000);
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
    this.host = new SagsHost(order, this.scores, (this.host?.state.round ?? 0) + 1, this.room.turnS(), this.room.teams());
    this.publish();
  }

  end(): void {
    this.toHost({ a: 'end' });
  }

  penalize(id: string, points: number): boolean {
    if (!this.host || this.host.state.phase === 'done') return false;
    this.host.penalize(id, points);
    this.publish();
    return true;
  }

  begin(): void {
    this.toHost({ a: 'begin' });
  }

  got(by: string | null): void {
    if (this.hand) this.toHost({ a: 'got', no: this.hand.no, card: this.hand.card, by });
  }

  skip(): void {
    if (this.hand) this.toHost({ a: 'skip', no: this.hand.no, card: this.hand.card });
  }

  foul(): void {
    if (this.seen && this.seen.no === this.state?.cardNo) this.toHost({ a: 'foul', no: this.seen.no, card: this.seen.card });
  }

  challenge(no: number): void {
    this.toHost({ a: 'challenge', no });
  }

  toHost(i: Intent): void {
    if (this.isHost) this.applyIntent(this.selfId, i);
    else {
      const h = this.net.hostId();
      if (h) this.net.send('sa:intent', i, h);
    }
  }

  /** Host: someone reloaded and came back with a new id; they keep place, team and points. */
  rejoin(oldId: string, newId: string): void {
    if (!this.host?.replace(oldId, newId)) return;
    this.goneSince.delete(oldId);
    this.publish();
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
      if (h) this.net.send('sa:drop', id, h);
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
    if (this.host.removePlayer(id)) this.publish();
  }

  tick(now: number): void {
    this.shareWords();
    if (this.host && !this.isHost) this.host = null;
    if (!this.host && this.isHost && this.state && this.state.phase !== 'done') {
      // A new host (the old one left) takes over a running round from its public state.
      this.host = SagsHost.fromState(this.state);
      this.scores = { ...this.state.scores };
      this.publish(now);
    }
    if (!this.host) return;
    const t = Date.now();
    let changed = this.host.tick(t);
    const here = new Set(this.net.members().map((m) => m.id));
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
      // An absent explainer: their turn ends after a moment, they leave the round after a while.
      if (t - since > SAGS.absentPassS * 1000 && s.explainer === p && s.phase !== 'done') changed = this.host.pass() || changed;
      if (t - since > SAGS.absentLeaveS * 1000) {
        this.goneSince.delete(p);
        changed = this.host.removePlayer(p) || changed;
      }
    }
    if (changed || now - this.lastPublish > 3000) this.publish(now);
  }

  onMessage(type: string, data: unknown, from: string): void {
    if (type === 'sa:state') {
      if (from !== this.net.hostId()) return;
      const s = parseState(data);
      if (s) {
        this.hostSkew = s.sentAt - Date.now();
        this.applyState(s);
      }
    } else if (type === 'sa:drop') {
      if (typeof data === 'string') this.dropNow(data);
    } else if (type === 'sa:intent') {
      const i = parseIntent(data);
      if (i && this.host) this.applyIntent(from, i);
    } else if (type === 'sa:card') {
      // Only from the explainer, and only kept if I'm one of the people meant to see it.
      const s = this.state;
      const d = data as { no?: unknown; card?: unknown };
      const card = parseCard(d?.card);
      if (!s || !card || typeof d.no !== 'number' || from !== s.explainer || !watchersOf(s, from).includes(this.selfId)) return;
      this.seen = { no: d.no, card };
      this.emit();
    } else if (type === 'sa:words') {
      const d = data as { pid?: unknown; cards?: unknown };
      if (typeof d?.pid !== 'string' || d.pid.length > 40 || !Array.isArray(d.cards)) return;
      const cards = d.cards
        .slice(0, WORDS.maxShared)
        .map(parseCard)
        .filter((c): c is WordCard => !!c && c.deck === 'custom');
      this.shared.set(from, { pid: d.pid, cards });
    }
  }

  /** Profile id of a member, as far as their words have arrived ("Ahnungslos" keeps a clueless player's own word away from them). */
  pidOf(id: string): string | undefined {
    return id === this.selfId ? this.mine().pid : this.shared.get(id)?.pid;
  }

  /** Every submission in the room: from the others as they arrived, mine fresh from storage. */
  roomCards(): WordCard[] {
    const out: WordCard[] = [...this.mine().cards];
    for (const [id, src] of this.shared) if (id !== this.selfId) out.push(...src.cards);
    return out;
  }

  /**
   * My submissions go to everyone in the room once (and again to whoever joins or each new round),
   * so whoever explains can draw them. Nobody's UI lists them before they're played.
   */
  private shareWords(): void {
    if (!this.room.decks().includes('custom')) return;
    const round = this.state?.round ?? 0;
    if (round !== this.sentRound) {
      this.sentRound = round;
      this.sentTo.clear();
    }
    const src = this.mine();
    for (const m of this.net.members()) {
      if (m.id === this.selfId || this.sentTo.has(m.id)) continue;
      this.sentTo.add(m.id);
      this.net.send('sa:words', { pid: src.pid, cards: src.cards.slice(0, WORDS.maxShared) }, m.id);
    }
  }

  private applyIntent(from: string, i: Intent): void {
    if (this.host?.intent(from, i, Date.now(), from === this.selfId)) this.publish();
  }

  private publish(now = performance.now()): void {
    if (!this.host) return;
    this.lastPublish = now;
    const s = { ...structuredClone(this.host.state), sentAt: Date.now() };
    this.net.send('sa:state', s);
    this.applyState(s);
  }

  private applyState(s: SagsState): void {
    if (this.state && s.round !== this.state.round) {
      this.hand = null;
      this.seen = null;
    }
    this.state = s;
    for (const p of s.log) this.drawn.add(p.card.id);
    if (this.seen && this.seen.no !== s.cardNo) this.seen = null;
    // My turn and the host moved on to a new card number: draw and show it to the other team.
    if (s.phase === 'turn' && s.explainer === this.selfId) {
      if (!this.hand || this.hand.no !== s.cardNo) this.draw(s);
    } else this.hand = null;
    this.emit();
  }

  private draw(s: SagsState): void {
    const pidOf = (id: string) => (id === this.selfId ? this.mine().pid : this.shared.get(id)?.pid);
    const guessers = new Set(guessersOf(s, this.selfId).map(pidOf).filter((p): p is string => !!p));
    const pool = wordPool(this.room.decks().length ? this.room.decks() : ['normal'], this.roomCards());
    // Cycle through everything before a word comes back.
    if (pool.every((c) => this.drawn.has(c.id))) this.drawn.clear();
    const card = drawCard(pool, this.drawn, guessers);
    if (!card) return;
    this.drawn.add(card.id);
    this.hand = { no: s.cardNo, card };
    for (const w of watchersOf(s, this.selfId)) this.net.send('sa:card', { no: s.cardNo, card }, w);
  }
}
