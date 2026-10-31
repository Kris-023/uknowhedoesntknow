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
  readonly state: { readonly phase: string } | null;
  /** A round is on (not over). */
  readonly running: boolean;
  onChange(f: () => void): () => void;
  /** Host: someone reloaded and came back with a new id. */
  rejoin(oldId: string, newId: string): void;
  /** Host: the Schaffner's fine; false if this game doesn't take it right now. */
  penalize(id: string, points: number): boolean;
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
