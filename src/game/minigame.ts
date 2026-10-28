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

/** Every minigame plugs in through these four calls; new games need nothing else from the coach. */
export interface Minigame {
  /** Host only: begin a round. */
  start(): void;
  onMessage(type: string, data: unknown, from: string): void;
  tick(now: number): void;
  /** Host only: stop the round for everyone. */
  end(): void;
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

  constructor(private roster: Member[]) {
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
