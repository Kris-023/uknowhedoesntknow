/**
 * Shared clock: the host publishes its start time and a seed; every peer measures its offset
 * to the host via ping/pong. All ambient motion (flicker, shake, NPCs, halt display) is a pure
 * function of `now()` and `seed`, so none of it needs network traffic.
 */
export class SharedClock {
  /** Host clock minus local clock, in ms. Zero on the host itself. */
  offsetMs = 0;
  private bestRtt = Infinity;

  constructor(
    public seed: number,
    public startMs: number,
  ) {}

  static local(seed = (Math.random() * 2 ** 31) | 0): SharedClock {
    return new SharedClock(seed, localMs());
  }

  /** Seconds since the host started the lobby. */
  now(local = localMs()): number {
    return (local + this.offsetMs - this.startMs) / 1000;
  }

  /**
   * Feed one ping/pong round trip. Keeps the sample with the lowest RTT, because its
   * one-way-delay estimate (rtt / 2) has the smallest error.
   */
  addSample(sentLocal: number, hostMs: number, recvLocal: number): void {
    const rtt = recvLocal - sentLocal;
    if (rtt < 0 || rtt > this.bestRtt) return;
    this.bestRtt = rtt;
    this.offsetMs = hostMs + rtt / 2 - recvLocal;
  }

  get rttMs(): number {
    return this.bestRtt;
  }
}

/** Wall-clock milliseconds with sub-ms resolution and no jumps from NTP adjustments mid-session. */
export function localMs(): number {
  return performance.timeOrigin + performance.now();
}
