/** Message handler: `data` is untrusted input from another browser. */
export type Handler = (data: unknown, from: string) => void;

/**
 * The narrow slice of networking the session needs. Trystero in the browser, an in-memory hub in
 * tests, so the session logic (host election, seats, migration) is testable without WebRTC.
 */
export interface Transport {
  readonly selfId: string;
  /** Send to one peer, or to everyone when `to` is omitted. */
  send(type: string, data: unknown, to?: string): void;
  on(type: string, h: Handler): void;
  onJoin(h: (id: string) => void): void;
  onLeave(h: (id: string) => void): void;
  leave(): void;
  /** Media (voice). Optional: the in-memory test network has none. */
  addStream?(stream: MediaStream, to?: string): void;
  removeStream?(stream: MediaStream): void;
  onStream?(h: (stream: MediaStream, from: string) => void): void;
}

interface Packet {
  type: string;
  data: unknown;
  from: string;
  to: string;
}

/**
 * Deterministic in-memory network for tests: packets queue until `flush()`, like a real network
 * delivering later, but in a fixed order.
 */
export class MemoryHub {
  private nodes = new Map<string, MemoryTransport>();
  private queue: Packet[] = [];

  connect(id: string): MemoryTransport {
    const t = new MemoryTransport(id, this);
    // Everyone already here sees the newcomer and vice versa, like a full mesh.
    for (const other of this.nodes.values()) {
      other.emitJoin(id);
      t.emitJoin(other.selfId);
    }
    this.nodes.set(id, t);
    return t;
  }

  disconnect(id: string): void {
    this.nodes.delete(id);
    this.queue = this.queue.filter((p) => p.to !== id && p.from !== id);
    for (const other of this.nodes.values()) other.emitLeave(id);
  }

  post(p: Omit<Packet, 'to'>, to?: string): void {
    // JSON round trip: peers never share object references, exactly like the wire.
    const data = JSON.parse(JSON.stringify(p.data ?? null)) as unknown;
    for (const id of to ? [to] : [...this.nodes.keys()]) if (id !== p.from && this.nodes.has(id)) this.queue.push({ ...p, data, to: id });
  }

  /** Deliver until the network is quiet. */
  flush(maxRounds = 50): void {
    for (let i = 0; i < maxRounds && this.queue.length; i++) {
      const batch = this.queue;
      this.queue = [];
      for (const p of batch) this.nodes.get(p.to)?.deliver(p.type, p.data, p.from);
    }
  }
}

class MemoryTransport implements Transport {
  private handlers = new Map<string, Handler>();
  private peers = new Set<string>();
  private joinH: (id: string) => void = () => {};
  private leaveH: (id: string) => void = () => {};

  constructor(
    readonly selfId: string,
    private hub: MemoryHub,
  ) {}

  send(type: string, data: unknown, to?: string): void {
    this.hub.post({ type, data, from: this.selfId }, to);
  }
  on(type: string, h: Handler): void {
    this.handlers.set(type, h);
  }
  onJoin(h: (id: string) => void): void {
    // Like Trystero: peers already present are replayed to a newly assigned handler.
    this.joinH = h;
    for (const id of this.peers) h(id);
  }
  onLeave(h: (id: string) => void): void {
    this.leaveH = h;
  }
  leave(): void {
    this.hub.disconnect(this.selfId);
  }
  deliver(type: string, data: unknown, from: string): void {
    this.handlers.get(type)?.(data, from);
  }
  emitJoin(id: string): void {
    this.peers.add(id);
    this.joinH(id);
  }
  emitLeave(id: string): void {
    this.peers.delete(id);
    this.leaveH(id);
  }
}
