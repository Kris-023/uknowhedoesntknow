import { describe, expect, it } from 'vitest';
import { makeLook } from '../src/characters/look';
import type { PersonState } from '../src/characters/person';
import { SharedClock } from '../src/core/clock';
import { mulberry32 } from '../src/core/rng';
import { parseState, parseWelcome, trainDistance } from '../src/net/protocol';
import { Session } from '../src/net/session';
import { MemoryHub } from '../src/net/transport';

const state = (n: number): PersonState => ({ name: `P${n}`, look: makeLook(mulberry32(n)), items: { head: 'gurke' } });

/** A fake wall clock per peer, with a fixed skew against the host. */
function peer(hub: MemoryHub, id: string, host: boolean, skewMs = 0, t = { ms: 1_000_000 }) {
  const now = () => t.ms + skewMs;
  const clock = host ? new SharedClock(42, now()) : new SharedClock(7, now());
  const s = new Session(hub.connect(id), clock, host, state(id.length), now);
  const events: string[] = [];
  s.listen({ welcome: () => events.push('welcome'), status: (x) => events.push(x) });
  return { s, clock, events, t };
}

describe('Session', () => {
  it('host welcomes joiners and assigns seats', () => {
    const hub = new MemoryHub();
    const t = { ms: 1_000_000 };
    const a = peer(hub, 'a', true, 0, t);
    const b = peer(hub, 'bb', false, 5000, t);
    const c = peer(hub, 'ccc', false, -3000, t);
    hub.flush();
    expect(b.events).toContain('welcome');
    expect(c.events).toContain('welcome');
    expect([a.s.mySeat, b.s.mySeat, c.s.mySeat]).toEqual([0, 2, 1]);
    expect(b.clock.seed).toBe(42);
    // Everyone has the same roster, names included.
    for (const p of [a, b, c]) {
      expect(p.s.roster.size).toBe(3);
      expect(p.s.roster.get('ccc')!.state.name).toBe('P3');
    }
  });

  it('clock sync removes the wall-clock skew of a client', () => {
    const hub = new MemoryHub();
    const t = { ms: 1_000_000 };
    const a = peer(hub, 'a', true, 0, t);
    const b = peer(hub, 'b', false, 12_345, t);
    hub.flush();
    for (let i = 0; i < 10; i++) {
      t.ms += 300;
      b.s.tick();
      hub.flush();
    }
    expect(Math.abs(b.clock.now(t.ms + 12_345) - a.clock.now(t.ms))).toBeLessThan(0.001);
  });

  it('a fifth player gets "full"', () => {
    const hub = new MemoryHub();
    const ps = [peer(hub, 'h', true), ...['p1', 'p2', 'p3', 'p4'].map((id) => peer(hub, id, false))];
    hub.flush();
    expect(ps[4].events).toContain('full');
    expect(ps[0].s.roster.size).toBe(4);
  });

  it('poses go peer to peer and map to seats', () => {
    const hub = new MemoryHub();
    const a = peer(hub, 'a', true);
    const b = peer(hub, 'b', false);
    const c = peer(hub, 'c', false);
    hub.flush();
    b.s.sendPose(0.7, -0.2);
    hub.flush();
    expect(c.s.poseForSeat(2)).toEqual({ yaw: 0.7, pitch: -0.2 });
    expect(a.s.poseForSeat(2)).toEqual({ yaw: 0.7, pitch: -0.2 });
  });

  it('item changes reach everyone through the host', () => {
    const hub = new MemoryHub();
    const a = peer(hub, 'a', true);
    const b = peer(hub, 'b', false);
    const c = peer(hub, 'c', false);
    hub.flush();
    b.s.setState({ ...state(9), items: { hand: 'huhn' } });
    hub.flush();
    expect(c.s.roster.get('b')!.state.items).toEqual({ hand: 'huhn' });
    expect(a.s.roster.get('b')!.state.name).toBe('P9');
  });

  it('when the host leaves, the longest-present player takes over and keeps the clock', () => {
    const hub = new MemoryHub();
    const t = { ms: 1_000_000 };
    const a = peer(hub, 'a', true, 0, t);
    const b = peer(hub, 'b', false, 500, t);
    const c = peer(hub, 'c', false, -800, t);
    hub.flush();
    for (let i = 0; i < 10; i++) {
      t.ms += 300;
      b.s.tick();
      c.s.tick();
      hub.flush();
    }
    a.s.setSpeed(600, a.clock.now(t.ms));
    hub.flush();
    a.s.leave();
    hub.flush();
    expect(b.s.role).toBe('host');
    expect(c.s.role).toBe('client');
    expect(c.s.hostId).toBe('b');
    expect(b.s.roster.size).toBe(2);
    expect(c.s.train.kmh).toBe(600);
    // c re-syncs against b; both still agree on the shared time.
    for (let i = 0; i < 10; i++) {
      t.ms += 300;
      c.s.tick();
      hub.flush();
    }
    expect(Math.abs(c.clock.now(t.ms - 800) - b.clock.now(t.ms + 500))).toBeLessThan(0.001);
    // A newcomer is welcomed by the new host into the free seat 0.
    const d = peer(hub, 'd', false, 0, t);
    hub.flush();
    expect(d.events).toContain('welcome');
    expect(d.s.mySeat).toBe(0);
  });

  it('speed changes keep the distance continuous', () => {
    const hub = new MemoryHub();
    const a = peer(hub, 'a', true);
    a.s.setSpeed(360, 0);
    const before = trainDistance(a.s.train, 10);
    a.s.setSpeed(720, 10);
    expect(trainDistance(a.s.train, 10)).toBeCloseTo(before, 6);
    expect(trainDistance(a.s.train, 11) - before).toBeCloseTo(200, 6);
  });
});

describe('protocol validation', () => {
  it('drops unknown items and items in the wrong slot', () => {
    const s = parseState({ look: makeLook(mulberry32(3)), items: { head: 'huhn', hand: 'ente', hip: 'rakete' } });
    expect(s?.items).toEqual({ hand: 'ente' });
  });

  it('cleans names', async () => {
    const { parseName } = await import('../src/net/protocol');
    expect(parseName('  Kalle \u0007 der   Große  ')).toBe('Kalle der Große');
    expect(parseName('x'.repeat(40))).toHaveLength(16);
    expect(parseName('   ')).toBeNull();
    expect(parseName(42)).toBeNull();
  });

  it('rejects broken looks and welcomes', () => {
    expect(parseState({ look: { ...makeLook(mulberry32(3)), hair: '<img>' }, items: {} })).toBeNull();
    expect(parseWelcome({ seed: 'x' })).toBeNull();
  });
});

describe('room code', async () => {
  const { newRoomCode, normalizeRoomCode, formatRoomCode } = await import('../src/net/roomCode');
  it('round-trips through formatting and links', () => {
    const c = newRoomCode();
    expect(normalizeRoomCode(formatRoomCode(c))).toBe(c);
    expect(normalizeRoomCode(`https://x.github.io/game/#${c}`)).toBe(c);
    expect(normalizeRoomCode('abc')).toBeNull();
    expect(normalizeRoomCode('abcd-efg0')).toBeNull();
  });
});

describe('room settings', () => {
  it('a quiet room tells joiners in the welcome and later changes reach everyone', () => {
    const hub = new MemoryHub();
    const a = peer(hub, 'a', true);
    a.s.setOpts({ voice: false });
    const b = peer(hub, 'b', false);
    hub.flush();
    expect(b.s.opts.voice).toBe(false);
    a.s.setOpts({ voice: true });
    hub.flush();
    expect(b.s.opts.voice).toBe(true);
    // Only the host decides.
    b.s.setOpts({ voice: false });
    hub.flush();
    expect(a.s.opts.voice).toBe(true);
  });
});

describe('rejoin', () => {
  it('someone who reloads gets their seat back and the host learns the old id', () => {
    const hub = new MemoryHub();
    const t = { ms: 1_000_000 };
    const now = () => t.ms;
    const host = new Session(hub.connect('h'), new SharedClock(1, now()), true, state(1), now, 'tok-h');
    const rejoins: string[] = [];
    host.listen({ rejoin: (o, n) => rejoins.push(`${o}->${n}`) });
    new Session(hub.connect('b1'), new SharedClock(2, now()), false, state(2), now, 'tok-b');
    const c = new Session(hub.connect('c1'), new SharedClock(3, now()), false, state(3), now, 'tok-c');
    hub.flush();
    const seatB = host.roster.get('b1')!.seat;
    hub.disconnect('b1');
    hub.flush();
    // c takes nothing; b comes back with a new peer id but the same tab token.
    t.ms += 10_000;
    const b2 = new Session(hub.connect('b2'), new SharedClock(4, now()), false, state(2), now, 'tok-b');
    hub.flush();
    expect(b2.mySeat).toBe(seatB);
    expect(rejoins).toEqual(['b1->b2']);
    expect(c.roster.has('b2')).toBe(true);
  });
});
