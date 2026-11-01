import { describe, expect, it } from 'vitest';
import { makeLook } from '../src/characters/look';
import type { PersonState } from '../src/characters/person';
import { SharedClock } from '../src/core/clock';
import { mulberry32 } from '../src/core/rng';
import { parseOpts, parseState, parseWelcome, trainDistance } from '../src/net/protocol';
import { Recovery, sessionNet } from '../src/game/minigame';
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
    // A newcomer is welcomed by the new host; seat 0 stays free for the old host to come back to.
    const d = peer(hub, 'd', false, 0, t);
    hub.flush();
    expect(d.events).toContain('welcome');
    expect(d.s.mySeat).toBe(3);
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
    a.s.setOpts({ ...parseOpts(undefined), voice: false, schaffner: 'warn', voteS: 45, blackouts: false, decks: ['nsfw'], turnS: 90, sagsTeams: false, slfMode: 'bild', map: 'hypertrain' });
    const b = peer(hub, 'b', false);
    hub.flush();
    expect(b.s.opts).toEqual({ voice: false, schaffner: 'warn', voteS: 45, blackouts: false, decks: ['nsfw'], turnS: 90, sagsTeams: false, slfMode: 'bild', map: 'hypertrain' });
    a.s.setOpts({ ...a.s.opts, voice: true });
    hub.flush();
    expect(b.s.opts.voice).toBe(true);
    // Only the host decides.
    b.s.setOpts({ ...b.s.opts, voice: false });
    hub.flush();
    expect(a.s.opts.voice).toBe(true);
  });

  it('settings from older peers or saves fall back to the defaults', () => {
    const words = { decks: ['normal', 'custom'], turnS: 60, sagsTeams: true, slfMode: 'text', map: 'hypertrain' };
    expect(parseOpts({ voice: false })).toEqual({ voice: false, schaffner: 'fine', voteS: 20, blackouts: true, ...words });
    expect(parseOpts({ schaffner: 'laut', voteS: 7, blackouts: 'nein' })).toEqual({ voice: true, schaffner: 'fine', voteS: 20, blackouts: true, ...words });
    expect(parseOpts({ decks: ['nsfw', 'kaputt'], turnS: 5 })).toMatchObject({ decks: ['nsfw'], turnS: 60 });
    expect(parseOpts({ map: 'mond' }).map).toBe('hypertrain');
    expect(parseOpts({ map: 'diner' }).map).toBe('diner');
    expect(parseOpts({ slfMode: 'bild' }).slfMode).toBe('bild');
    expect(parseOpts({ slfMode: 'video' }).slfMode).toBe('text');
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

  it('from another browser the name is enough, if it is unambiguous', () => {
    const hub = new MemoryHub();
    const t = { ms: 1_000_000 };
    const now = () => t.ms;
    const host = new Session(hub.connect('h'), new SharedClock(1, now()), true, state(1), now, 'tok-h');
    const rejoins: string[] = [];
    host.listen({ rejoin: (o, n) => rejoins.push(`${o}->${n}`) });
    new Session(hub.connect('b1'), new SharedClock(2, now()), false, state(2), now, 'tok-b', 'pid-b');
    hub.flush();
    const seatB = host.roster.get('b1')!.seat;
    hub.disconnect('b1');
    hub.flush();
    // Someone else joins meanwhile: they don't get b's seat.
    const c = new Session(hub.connect('c1'), new SharedClock(3, now()), false, state(3), now, 'tok-c', 'pid-c');
    hub.flush();
    expect(c.mySeat).not.toBe(seatB);
    t.ms += 20 * 60_000;
    const other = new Session(hub.connect('b2'), new SharedClock(4, now()), false, state(2), now, 'tok-new', 'pid-new');
    hub.flush();
    expect(other.mySeat).toBe(seatB);
    expect(rejoins).toEqual(['b1->b2']);
  });

  it('a new host still recognises everyone, the old host included', () => {
    const hub = new MemoryHub();
    const t = { ms: 1_000_000 };
    const now = () => t.ms;
    new Session(hub.connect('a'), new SharedClock(1, now()), true, state(1), now, 'tok-a', 'pid-a');
    const b = new Session(hub.connect('b'), new SharedClock(2, now()), false, state(2), now, 'tok-b', 'pid-b');
    const c = new Session(hub.connect('c'), new SharedClock(3, now()), false, state(3), now, 'tok-c', 'pid-c');
    hub.flush();
    const seatA = b.roster.get('a')!.seat;
    hub.disconnect('a');
    hub.flush();
    expect(b.role).toBe('host');
    const rejoins: string[] = [];
    b.listen({ rejoin: (o, n) => rejoins.push(`${o}->${n}`) });
    // a comes back in a new tab of the same browser, under a different name even.
    const a2 = new Session(hub.connect('a2'), new SharedClock(4, now()), false, { ...state(1), name: 'Neu' }, now, 'tok-a2', 'pid-a');
    hub.flush();
    expect(a2.mySeat).toBe(seatA);
    expect(rejoins).toEqual(['a->a2']);
    expect(c.roster.has('a2')).toBe(true);
  });

  it('a name shared by two who left is not enough', () => {
    const hub = new MemoryHub();
    const t = { ms: 1_000_000 };
    const now = () => t.ms;
    const host = new Session(hub.connect('h'), new SharedClock(1, now()), true, state(1), now, 'tok-h');
    const rejoins: string[] = [];
    host.listen({ rejoin: (o, n) => rejoins.push(`${o}->${n}`) });
    new Session(hub.connect('x'), new SharedClock(2, now()), false, state(2), now, 'tok-x');
    new Session(hub.connect('y'), new SharedClock(3, now()), false, state(2), now, 'tok-y');
    hub.flush();
    hub.disconnect('x');
    hub.disconnect('y');
    hub.flush();
    new Session(hub.connect('z'), new SharedClock(4, now()), false, state(2), now, 'tok-z');
    hub.flush();
    expect(rejoins).toEqual([]);
    expect(host.roster.has('z')).toBe(true);
  });

  it('two hosts after a split: the room that elected a new host stays, the cut-off ex-host joins it like a returning player', () => {
    const hub = new MemoryHub();
    const t = { ms: 1_000_000 };
    const now = () => t.ms;
    // 'a' is the smallest id: ids must not decide this.
    const ex = new Session(hub.connect('a'), new SharedClock(1, now()), true, state(1), now, 'tok-a');
    const m = new Session(hub.connect('m'), new SharedClock(2, now()), false, state(2), now, 'tok-m');
    const n = new Session(hub.connect('n'), new SharedClock(3, now()), false, state(3), now, 'tok-n');
    const tick = (all: Session[]) => {
      for (let i = 0; i < 10; i++) {
        t.ms += 300;
        for (const x of all) x.tick();
        hub.flush();
      }
    };
    tick([ex, m, n]);
    // a loses its connection: nothing crosses between a and the others, and each side sees the other leave.
    const h = hub as unknown as { post(p: { from: string }, to?: string): void; nodes: Map<string, unknown> };
    const post = h.post.bind(h);
    let split = true;
    h.post = (p, to) => {
      for (const id of to ? [to] : [...h.nodes.keys()]) if (!split || (id === 'a') === (p.from === 'a')) post(p, id);
    };
    const links = (x: Session) => x as unknown as { onLeave(id: string): void; onJoin(id: string): void };
    links(m).onLeave('a');
    links(n).onLeave('a');
    links(ex).onLeave('m');
    links(ex).onLeave('n');
    tick([ex, m, n]);
    expect(ex.role).toBe('host');
    expect(m.role).toBe('host');
    // The room plays on without a.
    m.setSpeed(321, 5);
    hub.flush();
    split = false;
    for (const x of [m, n]) links(x).onJoin('a');
    links(ex).onJoin('m');
    links(ex).onJoin('n');
    hub.flush();
    tick([ex, m, n]);
    expect(ex.role).toBe('client');
    expect(m.role).toBe('host');
    expect([ex.hostId, n.hostId]).toEqual(['m', 'm']);
    expect(ex.train.kmh).toBe(321);
    expect(n.train.kmh).toBe(321);
    expect(ex.mySeat).toBe(0);
    expect(m.roster.size).toBe(3);
  });

  it('two rooms opened under the same code (both hosts from the start): the smaller id stays, the other joins it like a returning player', () => {
    const hub = new MemoryHub();
    const t = { ms: 1_000_000 };
    const now = () => t.ms;
    const big = new Session(hub.connect('m'), new SharedClock(1, now()), true, state(1), now, 'tok-m');
    new Session(hub.connect('n'), new SharedClock(2, now()), false, state(2), now, 'tok-n');
    hub.flush();
    // Same Host-Epoche on both sides: the id decides, not the room size; 'z' is the larger id.
    const lone = new Session(hub.connect('z'), new SharedClock(3, now()), true, state(3), now, 'tok-z');
    const status: string[] = [];
    lone.listen({ status: (s) => status.push(s) });
    hub.flush();
    // The hello goes out on the next tick.
    lone.tick();
    hub.flush();
    expect(status).toContain('client');
    expect(lone.role).toBe('client');
    expect(lone.hostId).toBe('m');
    expect(big.role).toBe('host');
    expect(big.roster.has('z')).toBe(true);
    expect(lone.mySeat).toBeGreaterThanOrEqual(0);
  });
});

describe('game messages around a rejoin', () => {
  function room() {
    const hub = new MemoryHub();
    const t = { ms: 1_000_000 };
    const now = () => t.ms;
    const mk = (id: string, host: boolean) => new Session(hub.connect(id), new SharedClock(1, now()), host, state(id.length), now, `tok-${id}`);
    const h = mk('h', true);
    const b1 = mk('b1', false);
    const c = mk('c1', false);
    hub.flush();
    const got = (s: Session) => {
      const log: string[] = [];
      s.onGame((ty, d, from) => log.push(`${from}:${ty}:${JSON.stringify(d)}`));
      return log;
    };
    return { hub, t, mk, h, b1, c, got };
  }

  it('a message from a just-rejoined peer reaches a peer whose roster does not know it yet', () => {
    const { hub, mk, c, got } = room();
    const log = got(c);
    hub.disconnect('b1');
    hub.flush();
    const b2 = mk('b2', false);
    // Sent before the host's roster has told c1 about b2.
    b2.sendGame('wi:card', { x: 1 }, 'c1');
    hub.flush();
    expect(c.roster.has('b2')).toBe(true);
    expect(log).toEqual(['b2:wi:card:{"x":1}']);
  });

  it('a message to a peer that is not welcomed yet is delivered once it is', () => {
    const { hub, mk, c, got } = room();
    const b2 = mk('b2', false);
    const log = got(b2);
    c.sendGame('wi:state', 7, 'b2');
    hub.flush();
    expect(b2.roster.has('b2')).toBe(true);
    expect(log).toEqual(['c1:wi:state:7']);
  });

  it('held messages keep their order', () => {
    const { hub, mk, c, got } = room();
    const log = got(c);
    const d = mk('d2', false);
    d.sendGame('a', 1, 'c1');
    d.sendGame('b', 2, 'c1');
    d.sendGame('a', 3, 'c1');
    hub.flush();
    expect(log).toEqual(['d2:a:1', 'd2:b:2', 'd2:a:3']);
  });

  it.each([
    [1_000, ['p4:a:"early"']],
    [9_000, []],
  ])('a message from someone the roster only learns of %i ms before its hello retry is delivered only if fresh', (wait, expected) => {
    const { hub, t, h, got } = room();
    const log = got(h);
    const mk = (id: string) => new Session(hub.connect(id), new SharedClock(1, t.ms), false, state(1), () => t.ms, `tok-${id}`);
    mk('p3');
    hub.flush();
    // Room is full: p4 is turned away, but already said something.
    const p4 = mk('p4');
    p4.sendGame('a', 'early', 'h');
    hub.flush();
    expect(h.roster.has('p4')).toBe(false);
    // The hello retry comes 2 s after the first (+0.5 s slack).
    t.ms += wait + 2_500;
    hub.disconnect('p3');
    hub.flush();
    p4.tick();
    hub.flush();
    expect(h.roster.has('p4')).toBe(true);
    expect(log).toEqual(expected);
  });
});

describe('Recovery (ask for what I am missing)', () => {
  function room() {
    const hub = new MemoryHub();
    const t = { ms: 1_000_000 };
    const now = () => t.ms;
    const mk = (id: string, host: boolean) => new Session(hub.connect(id), new SharedClock(1, now()), host, state(id.length), now, `tok-${id}`);
    const h = mk('h', true);
    const b = mk('b', false);
    hub.flush();
    return { hub, t, mk, h, b, hr: new Recovery(sessionNet(h)), br: new Recovery(sessionNet(b)) };
  }

  it('the host answers an ask, the reply reaches onReply once and ends the ask', () => {
    const { hub, hr, br } = room();
    hr.answer('x:cards', (q) => ({ you: q, cards: [1, 2] }));
    const got: unknown[] = [];
    br.ask('x:cards', 'me', { to: () => 'h', onReply: (d, from) => got.push([d, from]) });
    hub.flush();
    expect(got).toEqual([[{ you: 'me', cards: [1, 2] }, 'h']]);
    expect(br.pending('x:cards')).toBe(false);
  });

  it('a peer that cannot answer yet stays silent and the ask is resent until it can', () => {
    const { hub, hr, br } = room();
    let ready = false;
    hr.answer('x:q', () => (ready ? 'now' : undefined));
    const got: unknown[] = [];
    br.ask('x:q', null, { to: 'h', onReply: (d) => got.push(d) });
    hub.flush();
    br.tick(0);
    br.tick(1_000);
    hub.flush();
    expect(got).toEqual([]);
    ready = true;
    br.tick(2_000);
    hub.flush();
    expect(got).toEqual(['now']);
    br.tick(10_000);
    hub.flush();
    expect(got).toEqual(['now']);
  });

  it('gives up after maxTries sends', () => {
    const { hub, hr, br } = room();
    let asked = 0;
    hr.answer('x:q', () => void asked++);
    let gaveUp = 0;
    br.ask('x:q', null, { to: 'h', onReply: () => {}, intervalMs: 100, maxTries: 3, onGiveUp: () => gaveUp++ });
    for (let i = 0; i < 20; i++) {
      br.tick(i * 100);
      hub.flush();
    }
    expect(asked).toBe(3);
    expect(gaveUp).toBe(1);
    expect(br.pending('x:q')).toBe(false);
  });

  it('with done(), replies are taken until the game has everything; to-function follows the host', () => {
    const { hub, h, hr, br } = room();
    hr.answer('x:cards', () => 'part');
    const got: unknown[] = [];
    let have = 0;
    br.ask('x:cards', null, { to: () => h.selfId, onReply: (d) => (got.push(d), have++), done: () => have >= 2, intervalMs: 100 });
    hub.flush();
    expect(br.pending('x:cards')).toBe(true);
    br.tick(0);
    br.tick(100);
    hub.flush();
    expect(got).toEqual(['part', 'part']);
    expect(br.pending('x:cards')).toBe(false);
  });

  it('an ask from a just-rejoined player is answered even though the host has just learned of it', () => {
    const { hub, mk, hr } = room();
    hr.answer('x:q', () => 'hi');
    hub.disconnect('b');
    hub.flush();
    const b2 = mk('b2', false);
    const r2 = new Recovery(sessionNet(b2));
    const got: unknown[] = [];
    // Right at the start, before the welcome: sent to everyone (default).
    r2.ask('x:q', null, { onReply: (d) => got.push(d) });
    hub.flush();
    expect(got).toEqual(['hi']);
  });

  it('asks for unknown topics are ignored and cancel stops an ask', () => {
    const { hub, br, hr } = room();
    let seen = 0;
    hr.answer('x:q', () => ++seen);
    br.ask('y:other', null, { to: 'h', onReply: () => {} });
    br.cancel('y:other');
    br.ask('x:q', null, { to: 'h', onReply: () => {} });
    br.cancel('x:q');
    br.tick(0);
    br.tick(5_000);
    hub.flush();
    expect(br.pending('y:other')).toBe(false);
    expect(seen).toBe(1); // only the immediate first send of x:q
  });
});
