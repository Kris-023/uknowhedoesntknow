import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeLook } from '../src/characters/look';
import type { PersonState } from '../src/characters/person';
import { NET } from '../src/config';
import { SharedClock } from '../src/core/clock';
import { mulberry32 } from '../src/core/rng';
import { sessionNet } from '../src/game/minigame';
import { Session } from '../src/net/session';
import { MemoryHub } from '../src/net/transport';

const state = (n: number): PersonState => ({ name: `P${n}`, look: makeLook(mulberry32(n)), items: { head: 'gurke' } });

/** Wall-clock skew per peer, so the clock tests mean something. */
const SKEW: Record<string, number> = { a: 0, b: 500, c: -800 };

function room(ids: string[]) {
  const hub = new MemoryHub();
  const t = { ms: 1_000_000 };
  const now = (id: string) => () => t.ms + (SKEW[id] ?? 0);
  const s: Record<string, Session> = {};
  const clocks: Record<string, SharedClock> = {};
  const status: Record<string, string[]> = {};
  ids.forEach((id, i) => {
    clocks[id] = new SharedClock(i === 0 ? 42 : 7, now(id)());
    s[id] = new Session(hub.connect(id), clocks[id], i === 0, state(i + 1), now(id), `tok-${id}`);
    status[id] = [];
    s[id].listen({ status: (x) => status[id].push(x) });
  });
  hub.flush();
  /** Pings and hellos for a few seconds of room time. */
  const run = (ms = 3000) => {
    for (let i = 0; i < ms / 300; i++) {
      t.ms += 300;
      for (const x of Object.values(s)) x.tick();
      hub.flush();
    }
  };
  /** Who thinks it is host, and whom everyone follows. */
  const left = new Set<string>();
  /** `deliverPending`: what the leaver already sent still arrives first (a closing tab, not a pulled plug). */
  const leave = (id: string, deliverPending = false) => {
    left.add(id);
    hub.disconnect(id, deliverPending);
    hub.flush();
  };
  const hosts = () => Object.entries(s).filter(([id, x]) => !left.has(id) && x.role === 'host').map(([id]) => id);
  const follows = () => Object.entries(s).filter(([id]) => !left.has(id)).map(([, x]) => x.hostId);
  return { hub, t, s, clocks, status, run, hosts, follows, now, leave };
}

/** A client's raw transport, to send messages a well-behaved session never would. */
const rawSend = (s: Session, type: string, data: unknown, to?: string) => (s as unknown as { net: { send(t: string, d: unknown, to?: string): void } }).net.send(type, data, to);

describe('Host übergeben (Session)', () => {
  it('in the lobby: the target becomes the only host, everyone follows it, nobody clashes', () => {
    const { s, status, run, hosts, follows } = room(['a', 'b', 'c']);
    run();
    s.a.setSpeed(500, 1);
    expect(s.a.handOver('c')).toBe(true);
    // Still host until the target confirms.
    expect(s.a.role).toBe('host');
    expect(s.a.handingOver).toBe(true);
    run(300);
    expect(hosts()).toEqual(['c']);
    expect(follows()).toEqual(['c', 'c', 'c']);
    expect(s.a.handingOver).toBe(false);
    expect(status.a).toEqual(['client']);
    expect(status.c).toEqual(['host']);
    expect(status.b).toEqual([]);
    // Roster, seats and the train survive; the new host owns them from now on.
    for (const x of Object.values(s)) expect(x.roster.size).toBe(3);
    expect(s.b.train.kmh).toBe(500);
    expect(s.c.mySeat).toBe(1);
    // Later host duties work from c: speed reaches everyone.
    s.c.setSpeed(200, 2);
    run(300);
    expect(s.a.train.kmh).toBe(200);
    expect(s.b.train.kmh).toBe(200);
  });

  it('everyone keeps one shared clock: they ping the new host and still agree', () => {
    const { s, clocks, t, run } = room(['a', 'b', 'c']);
    run(4000);
    s.a.handOver('b');
    run(4000);
    expect(s.c.hostId).toBe('b');
    expect(s.a.hostId).toBe('b');
    const at = (id: string) => clocks[id].now(t.ms + SKEW[id]);
    expect(Math.abs(at('c') - at('b'))).toBeLessThan(0.001);
    expect(Math.abs(at('a') - at('b'))).toBeLessThan(0.001);
  });

  it('a newcomer after the transfer is welcomed by the new host and gets a seat', () => {
    const { hub, s, run, hosts, now } = room(['a', 'b']);
    run();
    s.a.handOver('b');
    run(300);
    const d = new Session(hub.connect('d'), new SharedClock(1, now('d')()), false, state(4), now('d'), 'tok-d');
    hub.flush();
    run(300);
    expect(hosts()).toEqual(['b']);
    expect(d.welcomed).toBe(true);
    expect(d.hostId).toBe('b');
    expect(s.a.roster.has('d')).toBe(true);
  });

  it('only the current host may hand over, and only to someone connected', () => {
    const { s, run, hosts } = room(['a', 'b', 'c']);
    run();
    expect(s.b.handOver('c')).toBe(false);
    expect(s.a.handOver('a')).toBe(false);
    expect(s.a.handOver('nobody')).toBe(false);
    // A client sending the message on its own is ignored by the target and by everyone else.
    rawSend(s.b, 'handover', 'c', 'c');
    rawSend(s.b, 'handover', 'a', 'a');
    run(300);
    expect(hosts()).toEqual(['a']);
    expect(s.c.role).toBe('client');
  });

  it('a handover naming someone else only makes a note: nobody changes host', () => {
    const { s, run, hosts, follows } = room(['a', 'b', 'c']);
    run();
    rawSend(s.a, 'handover', 'c', 'b');
    run(300);
    expect(hosts()).toEqual(['a']);
    expect(follows()).toEqual(['a', 'a', 'a']);
  });

  it('a second request while one is open is refused', () => {
    const { s, run, hosts } = room(['a', 'b', 'c']);
    run();
    expect(s.a.handOver('b')).toBe(true);
    expect(s.a.handOver('c')).toBe(false);
    run(300);
    expect(hosts()).toEqual(['b']);
  });

  it('the target leaves right after the handover: still exactly one host, everyone agrees on it', () => {
    const { s, run, hosts, leave } = room(['a', 'b', 'c']);
    run();
    s.a.handOver('c');
    leave('c');
    run();
    // Nobody confirmed, so a never stepped down and stays host.
    expect(hosts()).toEqual(['a']);
    expect(s.b.hostId).toBe('a');
    expect(s.a.handingOver).toBe(false);
    // The room works afterwards.
    s.a.setSpeed(300, 3);
    run(300);
    expect(s.b.train.kmh).toBe(300);
  });

  it('the target leaves at any moment of the handover: the election leaves exactly one host', () => {
    for (let step = 0; step <= 4; step++) {
      const { hub, s, run, hosts, leave } = room(['a', 'b', 'c']);
      run();
      s.a.handOver('c');
      // Let the handover travel for `step` network rounds, then c drops.
      hub.flush(step);
      leave('c');
      run();
      expect(hosts().length, `step ${step}`).toBe(1);
      const host = hosts()[0];
      expect([s.a.hostId, s.b.hostId], `step ${step}`).toEqual([host, host]);
    }
  });

  it('the target never answers: the old host keeps the role after the wait and carries on', () => {
    const { hub, t, s, run, hosts } = room(['a', 'b']);
    run();
    // The handover message is lost on the way.
    s.a.handOver('b');
    (hub as unknown as { queue: unknown[] }).queue = [];
    t.ms += NET.handoverWaitMs + 100;
    s.a.tick();
    hub.flush();
    expect(s.a.handingOver).toBe(false);
    expect(hosts()).toEqual(['a']);
    expect(s.a.handOver('b')).toBe(true);
    run(300);
    expect(hosts()).toEqual(['b']);
  });

  it('a joiner whose hello arrives while handing over is welcomed by the new host', () => {
    const { hub, s, run, hosts, now } = room(['a', 'b']);
    run();
    s.a.handOver('b');
    const d = new Session(hub.connect('d'), new SharedClock(1, now('d')()), false, state(4), now('d'), 'tok-d');
    hub.flush();
    run(6000);
    expect(hosts()).toEqual(['b']);
    expect(d.welcomed).toBe(true);
    expect(d.hostId).toBe('b');
    expect(s.b.roster.has('d')).toBe(true);
    expect(s.a.roster.has('d')).toBe(true);
  });

  it('the old host can be handed the role back', () => {
    const { s, run, hosts, follows } = room(['a', 'b', 'c']);
    run();
    s.a.handOver('b');
    run(300);
    s.b.handOver('a');
    run(300);
    expect(hosts()).toEqual(['a']);
    expect(follows()).toEqual(['a', 'a', 'a']);
  });

  it('after a transfer, a later host leave still elects by seat rank', () => {
    const { s, run, hosts, leave } = room(['a', 'b', 'c']);
    run();
    s.a.handOver('c');
    run(300);
    leave('c');
    run();
    // a holds seat 0, the best rank: it is host again.
    expect(hosts()).toEqual(['a']);
    expect(s.b.hostId).toBe('a');
  });
});

describe('Host übergeben: the old host leaves, or the confirmation is late', () => {
  for (const n of [3, 4]) {
    for (const deliverPending of [false, true]) {
      it(`${n} players, the old host closes the tab at any moment of the handover${deliverPending ? ' (its messages still arrive)' : ' (its messages are lost)'}: one host, everyone follows it`, () => {
        const ids = ['a', 'b', 'c', 'd'].slice(0, n);
        for (const target of ids.slice(1)) {
          for (let step = 0; step <= 4; step++) {
            const { hub, s, run, hosts, follows, leave } = room(ids);
            run();
            expect(s.a.handOver(target)).toBe(true);
            // The handover travels for `step` network rounds, then the old host is gone.
            hub.flush(step);
            leave('a', deliverPending);
            run();
            const label = `target ${target}, step ${step}`;
            const host = hosts();
            expect(host.length, `${label}: hosts ${host}`).toBe(1);
            expect(new Set(follows()), `${label}: follows ${follows()}`).toEqual(new Set(host));
            // Whichever won, the room works: its speed reaches everyone.
            s[host[0]].setSpeed(321, 5);
            run(300);
            for (const [id, x] of Object.entries(s)) if (id !== 'a') expect(x.train.kmh, `${label} ${id}`).toBe(321);
            for (const [id, x] of Object.entries(s)) if (id !== 'a') expect(x.roster.size, `${label} ${id}`).toBe(n - 1);
          }
        }
      });
    }
  }

  it('with the handover delivered, the old host leaving elects the target everyone was told about', () => {
    const { hub, s, run, hosts, follows, leave } = room(['a', 'b', 'c', 'd']);
    run();
    s.a.handOver('d');
    hub.flush(1);
    leave('a', true);
    run();
    expect(hosts()).toEqual(['d']);
    expect(follows()).toEqual(['d', 'd', 'd']);
  });

  it('the confirmation comes after the wait: the target still wins and takes the others along', () => {
    // The target's welcome and roster never reach the old host in time (or at all), and only some others got them.
    for (const lostTo of [['a'], ['a', 'b'], ['a', 'b', 'c']]) {
      const { hub, t, s, run, hosts, follows } = room(['a', 'b', 'c']);
      run();
      s.a.handOver('c');
      hub.flush(1);
      const q = hub as unknown as { queue: { to: string; from: string }[] };
      q.queue = q.queue.filter((p) => !(p.from === 'c' && lostTo.includes(p.to)));
      t.ms += NET.handoverWaitMs + 100;
      s.a.tick();
      hub.flush();
      run();
      expect(hosts(), `lost to ${lostTo}`).toEqual(['c']);
      expect(follows(), `lost to ${lostTo}`).toEqual(['c', 'c', 'c']);
      expect(s.a.roster.size).toBe(3);
    }
  });

  it('two hosts who each see the other\'s older, bigger roster do not both give way', () => {
    const { hub, s, run, hosts, follows, leave } = room(['a', 'b', 'c', 'd']);
    run();
    // d becomes host while a is still there, and its welcome is in flight when a goes: b runs the election too.
    s.a.handOver('d');
    hub.flush(1);
    // Make b ignore the hint, as if it had never arrived: it elects itself, and a real clash follows.
    (s.b as unknown as { successor: null }).successor = null;
    leave('a', true);
    run();
    expect(hosts().length).toBe(1);
    expect(new Set(follows())).toEqual(new Set(hosts()));
  });

  it('a host handed the role back and forth settles on the last one', () => {
    const { s, run, hosts, follows } = room(['a', 'b', 'c']);
    run();
    s.a.handOver('b');
    run(300);
    s.b.handOver('a');
    run(300);
    s.a.handOver('b');
    run(300);
    expect(hosts()).toEqual(['b']);
    expect(follows()).toEqual(['b', 'b', 'b']);
  });
});

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

describe('Host übergeben mid-round (Wer bin ich?)', async () => {
  const { WhoamiGame } = await import('../src/game/whoami/game');
  const { tabStore } = await import('../src/game/tabStore');
  const card = (n: string) => `data:image/jpeg;base64,${btoa(n)}`;

  beforeEach(() => {
    const st = fakeStorage();
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: () => st });
  });
  afterEach(() => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  });

  it('the round goes on under the new host; the old one drops its host object and plays as a client', () => {
    const r = room(['a', 'b', 'c']);
    const g = Object.fromEntries(Object.entries(r.s).map(([id, ses]) => [id, new WhoamiGame(sessionNet(ses), undefined, tabStore('wi', id))]));
    const tickAll = () => {
      for (const x of Object.values(g)) x.tick(performance.now());
      r.hub.flush();
    };
    r.run();
    g.a.start();
    r.hub.flush();
    for (const id of ['a', 'b', 'c']) g[id].submitCard(card(`for-${g[id].myTarget}`));
    r.hub.flush();
    expect(g.a.state?.phase).toBe('play');
    const turn = g.a.state!.turn!;
    expect(turn).toBeTruthy();
    // The host (a) hands over to c in the middle of the round.
    expect(r.s.a.handOver('c')).toBe(true);
    r.run(300);
    tickAll();
    tickAll();
    expect(r.hosts()).toEqual(['c']);
    expect(g.a.isHost).toBe(false);
    expect(g.c.isHost).toBe(true);
    // The old host's game has dropped its host object (no undo, no host actions), c took the state over.
    expect(g.a.canUndo).toBe(false);
    expect(g.c.state).toMatchObject({ round: g.a.state!.round, phase: 'play', turn });
    expect(g.b.state?.turn).toBe(turn);
    // The turn player acts: the intent goes to c, and everybody (the old host a as a client, too) sees the new state.
    g[turn].toHost({ a: 'pass' });
    r.hub.flush();
    tickAll();
    const next = g.c.state!.turn;
    expect(next).not.toBe(turn);
    for (const id of ['a', 'b', 'c']) expect(g[id].state?.turn, id).toBe(next);
    expect(g.a.state?.scores).toEqual(g.c.state?.scores);
    // The old host still holds the card it made for its target.
    expect(g.a.cards.size).toBeGreaterThan(0);
  });
});
