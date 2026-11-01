import type { Session } from '../net/session';
import { MemoryHub, type Transport } from '../net/transport';

export interface Member {
  id: string;
  seat: number;
  name: string;
}

/**
 * What a minigame sees of the network: who's here, who decides (host), and a typed message
 * channel. Real rooms run it over the session; the solo test round over an in-memory hub with bots.
 */
export interface GameNet {
  readonly selfId: string;
  isHost(): boolean;
  hostId(): string | null;
  members(): Member[];
  send(type: string, data: unknown, to?: string): void;
  onMessage(h: (type: string, data: unknown, from: string) => void): void;
}

/** Every minigame plugs in through these calls; new games need nothing else from the coach. */
export interface Minigame {
  /** Host only: begin a round. */
  start(): void;
  onMessage(type: string, data: unknown, from: string): void;
  tick(now: number): void;
  /** Host only: stop the round for everyone. */
  end(): void;
  /** Players of the running round who are not in the room right now (dropped out, maybe coming back). */
  absent(): string[];
  /** Play on without someone who dropped out; anyone may ask, the host only drops people who are really gone. */
  drop(id: string): void;
}

/** What the coach needs of a game besides the Minigame calls: its state, a change signal and the host's levers. */
export interface PlayableGame extends Minigame {
  readonly state: { readonly phase: string; readonly round: number; readonly undo?: number } | null;
  /** A round is on (not over). */
  readonly running: boolean;
  onChange(f: () => void): () => void;
  /** Host: someone reloaded and came back with a new id. */
  rejoin(oldId: string, newId: string): void;
  /** Host: the Schaffner's fine; false if this game doesn't take it right now. */
  penalize(id: string, points: number): boolean;
  /** Host: a decision of this round can be taken back ("Zug zurück", see undo.ts). */
  readonly canUndo: boolean;
  /** Host: take back the last decision; everyone gets the restored state. */
  undo(): void;
}

/** Screens of a game as the coach drives them: one game's screens are shown at a time. */
export interface GameUi {
  set shown(on: boolean);
  /** End screen open (or about to open): the lobby waits. */
  readonly doneOpen: boolean;
  /** Close the end screen (a new game starts). */
  close(): void;
  /** Per frame: countdowns. */
  tick(): void;
}

/** Message types of `Recovery` (shared by all games; topics inside keep the games apart). */
export const ASK_TYPE = 'mg:ask';
export const HAVE_TYPE = 'mg:have';

export interface AskOptions {
  /**
   * Whom to ask: a player id, or a function evaluated at every send (`() => net.hostId()`, since the
   * host may change); null means nobody to ask right now. Default: everyone else in the room.
   */
  to?: string | (() => string | null);
  /** Every reply, as sent by the answerer. It is untrusted input: validate it like any message. */
  onReply: (data: unknown, from: string) => void;
  /** Keep asking until this is true (checked after each reply and before each resend). Default: the first reply ends it. */
  done?: () => boolean;
  /** Resend interval in ms of the `now` given to `tick` (default 2000). */
  intervalMs?: number;
  /** Total sends, the first included, before giving up (default 8, so about 14 s). */
  maxTries?: number;
  onGiveUp?: () => void;
}

interface Pending extends AskOptions {
  query: unknown;
  tries: number;
  nextAt: number | null;
}

/**
 * "Ask for what I'm missing": a game that (re)joined and lacks data (a card, the current question,
 * its round state) asks the host or the others; whoever has it answers. The ask is resent until it
 * is answered or `maxTries` is used up, so games don't write their own retry loops.
 *
 * One `Recovery` per game instance, made from its `GameNet`. Games call `tick(now)` from their own
 * `tick`. Topics should carry the game's prefix (`'wi:cards'`), since every game instance hears every
 * ask. An ask that reaches a peer which doesn't know the sender yet is not lost: `Session` holds
 * such messages until the roster has caught up.
 */
export class Recovery {
  private answers = new Map<string, (query: unknown, from: string) => unknown>();
  private asks = new Map<string, Pending>();

  constructor(private net: GameNet) {
    net.onMessage((type, data, from) => {
      if (typeof data !== 'object' || data === null) return;
      const { k, q, d } = data as { k?: unknown; q?: unknown; d?: unknown };
      if (typeof k !== 'string') return;
      if (type === ASK_TYPE) {
        const reply = this.answers.get(k)?.(q, from);
        if (reply !== undefined) this.net.send(HAVE_TYPE, { k, d: reply }, from);
      } else if (type === HAVE_TYPE) {
        const a = this.asks.get(k);
        if (!a) return;
        a.onReply(d, from);
        if (!a.done || a.done()) this.asks.delete(k);
      }
    });
  }

  /**
   * Answering side: `fn` gets the asker's query and returns the data to send back (any JSON), or
   * undefined when this player can't help (then nothing is sent and the asker tries again later or asks others).
   */
  answer(topic: string, fn: (query: unknown, from: string) => unknown): void {
    this.answers.set(topic, fn);
  }

  /** Asking side: send now, then resend on `tick` until answered. Asking a topic again replaces the earlier ask. */
  ask(topic: string, query: unknown, opts: AskOptions): void {
    const a: Pending = { ...opts, query, tries: 0, nextAt: null };
    this.asks.set(topic, a);
    this.send(topic, a);
  }

  cancel(topic: string): void {
    this.asks.delete(topic);
  }

  /** Still asking this topic. */
  pending(topic: string): boolean {
    return this.asks.has(topic);
  }

  tick(now: number): void {
    for (const [topic, a] of this.asks) {
      if (a.done?.()) {
        this.asks.delete(topic);
      } else if (a.nextAt === null) {
        a.nextAt = now + (a.intervalMs ?? 2000);
      } else if (now >= a.nextAt) {
        if (a.tries >= (a.maxTries ?? 8)) {
          this.asks.delete(topic);
          a.onGiveUp?.();
        } else {
          a.nextAt = now + (a.intervalMs ?? 2000);
          this.send(topic, a);
        }
      }
    }
  }

  private send(topic: string, a: Pending): void {
    a.tries++;
    const to = typeof a.to === 'function' ? a.to() : a.to;
    if (to === null) return;
    this.net.send(ASK_TYPE, { k: topic, q: a.query }, to);
  }
}

export function sessionNet(session: Session): GameNet {
  return {
    selfId: session.selfId,
    isHost: () => session.role === 'host',
    hostId: () => session.hostId,
    members: () => [...session.roster.values()].map((e) => ({ id: e.id, seat: e.seat, name: e.state.name })),
    send: (t, d, to) => session.sendGame(t, d, to),
    onMessage: (h) => session.onGame(h),
  };
}

/**
 * In-memory room for the solo test round: you are the host, bots sit on the other seats. Messages
 * are delivered on `pump()`, so they arrive a frame later like on a real network.
 */
export class LocalGameRoom {
  private hub = new MemoryHub();
  private nodes = new Map<string, Transport>();
  private handlers = new Map<string, ((type: string, data: unknown, from: string) => void)[]>();

  /** Mutable so tests can let someone leave and come back. */
  constructor(readonly roster: Member[]) {
    for (const m of roster) {
      const t = this.hub.connect(m.id);
      const list: ((type: string, data: unknown, from: string) => void)[] = [];
      this.handlers.set(m.id, list);
      t.on('mg', (d, from) => {
        const { t: type, d: data } = d as { t: string; d: unknown };
        for (const h of list) h(type, data, from);
      });
      this.nodes.set(m.id, t);
    }
  }

  net(id: string): GameNet {
    const t = this.nodes.get(id)!;
    const host = this.roster[0].id;
    return {
      selfId: id,
      isHost: () => id === host,
      hostId: () => host,
      members: () => this.roster,
      send: (type, data, to) => t.send('mg', { t: type, d: data }, to),
      onMessage: (h) => this.handlers.get(id)!.push(h),
    };
  }

  pump(): void {
    this.hub.flush();
  }
}
