import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeLook } from '../src/characters/look';
import type { PersonState } from '../src/characters/person';
import { NET } from '../src/config';
import { SharedClock } from '../src/core/clock';
import { mulberry32 } from '../src/core/rng';
import { sessionNet } from '../src/game/minigame';
import { parseWelcome } from '../src/net/protocol';
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
  const left = new Set<string>();
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
      for (const [id, x] of Object.entries(s)) if (!left.has(id)) x.tick();
      hub.flush();
    }
  };
  /** Who thinks it is host, and whom everyone follows. */
  /** `deliverPending`: what the leaver already sent still arrives first (a closing tab, not a pulled plug). */
  const leave = (id: string, deliverPending = false) => {
    left.add(id);
    hub.disconnect(id, deliverPending);
    hub.flush();
  };
  const hosts = () => Object.entries(s).filter(([id, x]) => !left.has(id) && x.role === 'host').map(([id]) => id);
  const follows = () => Object.entries(s).filter(([id]) => !left.has(id)).map(([, x]) => x.hostId);
  return { hub, t, s, clocks, status, run, hosts, follows, now, leave, left };
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

describe('Host übergeben: findings of the second review', () => {
  type Priv = { peers: Set<string>; roster: Map<string, unknown>; onJoin(id: string): void; takeOver(): void; myState: PersonState; hostId: string | null };
  const priv = (x: Session) => x as unknown as Priv;
  const queueOf = (hub: MemoryHub) => (hub as unknown as { queue: { to: string; from: string; type: string }[] }).queue;

  it('N1: hosts that see different parts of the mesh still settle on one host and go quiet', () => {
    // x is host, c is connected to x only; b sees only x and elects itself, with a smaller roster than x's.
    // Unconfirmed, b's claim is weaker than x's; confirmed (higher epoch), it is stronger.
    for (const confirmed of [false, true]) {
      const { hub, s, run, hosts } = room(['x', 'b', 'c']);
      run();
      const b = priv(s.b);
      b.peers.delete('c');
      b.roster.delete('c');
      b.takeOver();
      if (confirmed) Object.assign(b, { epoch: 2, unconfirmed: null });
      const winner = confirmed ? 'b' : 'x';
      hub.flush();
      expect(hosts()).toEqual([winner]);
      // Nothing keeps bouncing between them.
      hub.flush(50);
      expect(queueOf(hub).length).toBe(0);
      run(3000);
      expect(hosts()).toEqual([winner]);
      expect(queueOf(hub).length).toBe(0);
    }
  });

  it('N2: a handover that never reached the target leaves no stale successor behind', () => {
    const { hub, t, s, run, hosts, follows, leave } = room(['a', 'b', 'c', 'd']);
    run();
    s.a.handOver('d');
    // The others got the note, the target did not.
    const q = hub as unknown as { queue: { to: string; type: string }[] };
    q.queue = q.queue.filter((p) => !(p.to === 'd' && p.type === 'handover'));
    hub.flush();
    t.ms += NET.handoverWaitMs + 100;
    run(600);
    expect(hosts()).toEqual(['a']);
    leave('a');
    run(6000);
    expect(hosts().length).toBe(1);
    expect(new Set(follows())).toEqual(new Set(hosts()));
  });

  it('N3: a welcome from a stranger, or one that does not list us, does not make the host give way', () => {
    const { hub, s, run, hosts, follows } = room(['m', 'b', 'c']);
    run();
    const stranger = hub.connect('a');
    const w = s.m.welcomeMsg();
    stranger.send('welcome', w);
    hub.flush();
    // A known client, but its welcome does not list the host.
    rawSend(s.b, 'welcome', { ...w, roster: w.roster.filter((e) => e.id !== 'm') }, 'm');
    hub.flush();
    run(3000);
    expect(hosts()).toEqual(['m']);
    expect(follows()).toEqual(['m', 'm', 'm']);
  });

  it('N4: once the handover is forgotten, a stale handover does not let a lone peer beat the room', () => {
    const { hub, s, run, hosts, follows } = room(['a', 'b', 'c']);
    run();
    s.a.handOver('b');
    const q = hub as unknown as { queue: { to: string; type: string }[] };
    q.queue = q.queue.filter((p) => !(p.to === 'b' && p.type === 'handover'));
    hub.flush();
    // The handover timed out long ago ...
    run(20_000);
    expect(hosts()).toEqual(['a']);
    // ... when b, cut off for a while, made itself host and now sees the others again.
    const b = priv(s.b);
    b.roster.clear();
    b.roster.set('b', { id: 'b', seat: 2, state: b.myState, keys: [] });
    b.takeOver();
    b.onJoin('a');
    b.onJoin('c');
    hub.flush();
    run(6000);
    expect(hosts()).toEqual(['a']);
    expect(follows()).toEqual(['a', 'a', 'a']);
    expect(queueOf(hub).length).toBe(0);
  });
});

describe('Host übergeben: both the old host and the target leave', () => {
  type Hub = { queue: { to: string; from: string; type: string; data: unknown }[]; nodes: Map<string, { emitLeave(id: string): void; deliver(t: string, d: unknown, f: string): void }> };
  /** Two peers leave; `opposite`: every second remaining peer sees the leaves in the other order. */
  function leaveTwo(hub: MemoryHub, ids: string[], first: string, second: string, deliverPending: boolean, opposite: boolean): void {
    const h = hub as unknown as Hub;
    for (const id of [first, second]) {
      if (deliverPending) {
        const mine = h.queue.filter((p) => p.from === id);
        h.queue = h.queue.filter((p) => p.from !== id);
        for (const p of mine) h.nodes.get(p.to)?.deliver(p.type, p.data, p.from);
      }
      h.nodes.delete(id);
      h.queue = h.queue.filter((p) => p.to !== id && p.from !== id);
    }
    ids
      .filter((id) => id !== first && id !== second)
      .forEach((id, i) => {
        for (const x of opposite && i % 2 === 1 ? [second, first] : [first, second]) h.nodes.get(id)?.emitLeave(x);
      });
  }

  for (const n of [3, 4]) {
    it(`${n} players: old host and target leave together, at any step, in any order and visibility: one host, everyone follows it`, () => {
      const ids = ['a', 'b', 'c', 'd'].slice(0, n);
      let cases = 0;
      for (const target of ids.slice(1)) {
        for (let step = 0; step <= 4; step++) {
          for (const order of ['host first', 'target first'] as const) {
            for (const deliverPending of [false, true]) {
              for (const opposite of [false, true]) {
                const { hub, s, run, left } = room(ids);
                run();
                expect(s.a.handOver(target)).toBe(true);
                hub.flush(step);
                const [first, second] = order === 'host first' ? ['a', target] : [target, 'a'];
                left.add('a');
                left.add(target);
                leaveTwo(hub, ids, first, second, deliverPending, opposite);
                hub.flush();
                run(NET.hostSilentMs + 4000);
                const label = `target ${target}, step ${step}, ${order}, pending ${deliverPending}, opposite ${opposite}`;
                // Only the peers that are still there count.
                const remaining = Object.entries(s).filter(([id]) => !left.has(id));
                const hs = remaining.filter(([, x]) => x.role === 'host').map(([id]) => id);
                expect(hs.length, `${label}: hosts ${hs}`).toBe(1);
                expect(new Set(remaining.map(([, x]) => x.hostId)), `${label}: follows ${remaining.map(([id, x]) => `${id}>${x.hostId}`)}`).toEqual(new Set(hs));
                cases++;
              }
            }
          }
        }
      }
      expect(cases).toBe((n - 1) * 5 * 2 * 2 * 2);
    });
  }
});

describe('Host-Wächter: a room never stays without a host', () => {
  type Priv = { hostSeenAt: number; role: string; hostId: string | null };
  it('the host-less end state (everyone follows a peer that is no host) ends with one host everyone follows', () => {
    const { s, t, run, leave, hosts, follows } = room(['a', 'b', 'c', 'd']);
    run();
    leave('a');
    run(1500);
    // The state two earlier races left behind: b follows d, d follows b, c follows d, nobody is host.
    const set = (x: Session, host: string) => {
      const p = x as unknown as Priv;
      p.role = 'client';
      p.hostId = host;
      p.hostSeenAt = t.ms;
    };
    set(s.b, 'd');
    set(s.c, 'd');
    set(s.d, 'b');
    expect(hosts()).toEqual([]);
    run(NET.hostSilentMs + 4000);
    expect(hosts().length).toBe(1);
    expect(new Set(follows())).toEqual(new Set(hosts()));
    // And the room works.
    s[hosts()[0]].setSpeed(250, 9);
    run(600);
    for (const id of ['b', 'c', 'd']) expect(s[id].train.kmh).toBe(250);
  });

  it('a working host is never replaced, even if its answers come late', () => {
    const { hub, t, s, hosts, follows } = room(['a', 'b', 'c']);
    hub.flush();
    // Ticks every 300 ms, but the network only delivers every 3.6 s: well inside the 6 s window.
    for (let i = 1; i <= 140; i++) {
      t.ms += 300;
      for (const x of Object.values(s)) x.tick();
      if (i % 12 === 0) hub.flush();
    }
    hub.flush();
    expect(hosts()).toEqual(['a']);
    expect(follows()).toEqual(['a', 'a', 'a']);
  });

  it('a client whose host went silent for good takes over with the best rank, the others follow', () => {
    const { hub, t, s, run, follows } = room(['a', 'b', 'c']);
    run();
    // a stops answering but the connection stays up (a frozen tab).
    (s.a as unknown as { net: { send(): void } }).net.send = () => {};
    s.a.tick = () => {};
    const q = hub as unknown as { queue: { from: string }[] };
    for (let i = 0; i < 40; i++) {
      t.ms += 300;
      s.b.tick();
      s.c.tick();
      q.queue = q.queue.filter((p) => p.from !== 'a');
      hub.flush();
    }
    expect(s.b.role === 'host' || s.c.role === 'host').toBe(true);
    const hs = ['b', 'c'].filter((id) => s[id].role === 'host');
    expect(hs.length).toBe(1);
    expect(follows().slice(1)).toEqual([hs[0], hs[0]]);
  });
});

type Room = ReturnType<typeof room>;
type HubPriv = { post(p: { type: string; data: unknown; from: string }, to?: string): void; nodes: Map<string, unknown> };
type Links = { onLeave(id: string): void; onJoin(id: string): void };

/**
 * A real network split: `cut` loses its connection to everyone else (both sides see the others
 * leave, nothing crosses), the rest stays connected. Returns `heal`, after which both sides see
 * each other join again.
 */
function partition(r: Room, cut: string[]): () => void {
  r.hub.flush();
  const hub = r.hub as unknown as HubPriv;
  const post = hub.post.bind(hub);
  let split = true;
  hub.post = (p, to) => {
    if (!split) return post(p, to);
    for (const id of to ? [to] : [...hub.nodes.keys()]) if (id !== p.from && cut.includes(id) === cut.includes(p.from)) post(p, id);
  };
  const others = Object.keys(r.s).filter((id) => !cut.includes(id) && !r.left.has(id));
  const link = (x: string) => r.s[x] as unknown as Links;
  for (const c of cut) for (const o of others) link(o).onLeave(c);
  for (const c of cut) for (const o of others) link(c).onLeave(o);
  return () => {
    split = false;
    for (const c of cut) for (const o of others) link(o).onJoin(c);
    for (const c of cut) for (const o of others) link(c).onJoin(o);
  };
}

const settled = (r: Room) => {
  const h = r.hosts();
  return h.length === 1 && r.follows().every((x) => x === h[0]);
};

describe('Host-Epoche: which of two hosts stays', () => {
  for (const ids of [['a', 'b', 'c'], ['z', 'b', 'c']]) {
    it(`F1: a host cut off longer than leave detection comes back (ex-host id ${ids[0]}): the room that played on stays`, () => {
      const r = room(ids);
      r.run();
      const ex = ids[0];
      const heal = partition(r, [ex]);
      r.run(8000);
      // Both sides have a host: the ex-host carries on alone, the room elected a new one with a higher epoch.
      expect(r.s[ex].role).toBe('host');
      const nh = r.hosts().filter((id) => id !== ex);
      expect(nh).toHaveLength(1);
      expect(r.s[nh[0]].epoch).toBeGreaterThan(r.s[ex].epoch);
      // The room makes progress the ex-host knows nothing of.
      r.s[nh[0]].setSpeed(321, 5);
      r.run(300);
      heal();
      r.hub.flush();
      r.run(6000);
      expect(r.hosts(), `follows ${r.follows()}`).toEqual(nh);
      expect(settled(r)).toBe(true);
      for (const id of ids) expect(r.s[id].train.kmh, id).toBe(321);
      // The ex-host joined like a returning player and kept its seat.
      expect(r.s[ex].mySeat).toBe(0);
      for (const id of ids) expect(r.s[id].roster.size, id).toBe(3);
    });
  }

  for (const lone of ['b', 'z']) {
    it(`a client cut off long enough to make itself host (id ${lone}) loses against the room it left`, () => {
      const ids = ['m', 'b', 'z'];
      const r = room(ids);
      r.run();
      const heal = partition(r, [lone]);
      r.run(8000);
      // The lone peer took over, nobody of the room confirmed it: a weaker claim than the room's.
      expect(r.s[lone].role).toBe('host');
      expect(r.s[lone].epoch).toBeLessThan(r.s.m.epoch);
      expect(r.s.m.role).toBe('host');
      r.s.m.setSpeed(222, 5);
      r.run(300);
      heal();
      r.hub.flush();
      r.run(6000);
      expect(r.hosts()).toEqual(['m']);
      expect(settled(r)).toBe(true);
      expect(r.s[lone].train.kmh).toBe(222);
    });
  }

  it('a client never switches back to a host with an older epoch, even by a welcome from a room member', () => {
    const r = room(['a', 'b', 'c']);
    r.run();
    const heal = partition(r, ['a']);
    r.run(8000);
    r.s.b.setSpeed(321, 5);
    heal();
    r.hub.flush();
    r.run(6000);
    expect(r.hosts()).toEqual(['b']);
    // a is a client of b now and in everyone's roster: a welcome of its old room (epoch 0) changes nothing.
    rawSend(r.s.a, 'welcome', { ...r.s.a.welcomeMsg(), epoch: 0, train: { kmh: 0, t0: 0, d0: 0 } });
    r.hub.flush();
    r.run(3000);
    expect(r.hosts()).toEqual(['b']);
    expect(settled(r)).toBe(true);
    expect(r.s.c.train.kmh).toBe(321);
  });

  for (const [ids, hinted, winner] of [
    [['a', 'b', 'c', 'd'], 'c', 'b'],
    [['a', 'z', 'c', 'd'], 'c', 'c'],
  ] as const) {
    it(`two peers elect themselves at once from the same epoch: the smaller id stays (${ids.join('')}, winner ${winner})`, () => {
      const r = room([...ids]);
      r.run();
      // The seat rank picks ids[1] (seat 2); a stale hint makes the hinted peer pick itself, too.
      (r.s[hinted] as unknown as { successor: { id: string; at: number } }).successor = { id: hinted, at: r.t.ms };
      r.left.add('a');
      r.hub.disconnect('a');
      const both = [ids[1], hinted];
      for (const id of both) expect(r.s[id].role, id).toBe('host');
      expect(r.s[ids[1]].epoch).toBe(r.s[hinted].epoch);
      r.hub.flush();
      r.run(3000);
      expect(r.hosts()).toEqual([winner]);
      expect(settled(r)).toBe(true);
      // Nothing keeps bouncing.
      expect((r.hub as unknown as { queue: unknown[] }).queue.length).toBe(0);
    });
  }

  it('epochs: a handover target claims +2 at once; an elected host claims -1 until a player of the room confirms it, then +2', () => {
    const r = room(['a', 'b', 'c']);
    r.run();
    const epochs = () => ['a', 'b', 'c'].filter((id) => !r.left.has(id)).map((id) => r.s[id].epoch);
    expect(epochs()).toEqual([0, 0, 0]);
    r.s.a.handOver('c');
    r.run(300);
    expect(r.hosts()).toEqual(['c']);
    expect(epochs()).toEqual([2, 2, 2]);
    // c leaves: a (seat 0) is elected and claims 1 until b's first ping, then 4.
    r.left.add('c');
    r.hub.disconnect('c');
    expect(r.hosts()).toEqual(['a']);
    expect(epochs()).toEqual([1, 1]);
    r.hub.flush();
    r.run(600);
    expect(epochs()).toEqual([4, 4]);
  });

  it('the wire format is checked: a roster or welcome without a whole-number epoch is dropped', () => {
    const r = room(['a', 'b', 'c']);
    r.run();
    const w = r.s.a.welcomeMsg();
    for (const epoch of [undefined, '9', 1.5, Infinity, 1e12]) {
      rawSend(r.s.b, 'welcome', { ...w, epoch }, 'a');
      rawSend(r.s.b, 'roster', { e: epoch, r: w.roster }, 'a');
    }
    // The old roster format (a bare array) is no host's roster any more.
    rawSend(r.s.b, 'roster', w.roster, 'a');
    r.hub.flush();
    r.run(1000);
    expect(r.hosts()).toEqual(['a']);
    expect(settled(r)).toBe(true);
  });
});

describe('Host-Wächter and other findings of the third review', () => {
  it('F2: a client whose tab ticks only every few seconds never replaces a working host', () => {
    for (const every of [5000, 20_000, 60_000]) {
      const r = room(['a', 'b', 'c']);
      r.run();
      let flips = 0;
      let last = r.s.c.hostId;
      for (let i = 0; i < 200; i++) {
        r.t.ms += 1000;
        r.s.a.tick();
        r.s.b.tick();
        if (r.t.ms % every < 1000) r.s.c.tick();
        r.hub.flush();
        if (r.s.c.hostId !== last) {
          flips++;
          last = r.s.c.hostId;
        }
      }
      expect(flips, `every ${every} ms`).toBe(0);
      expect(r.hosts()).toEqual(['a']);
      expect(settled(r)).toBe(true);
    }
  });

  for (const ids of [['a', 'b', 'c'], ['z', 'b', 'c']]) {
    it(`a host frozen for 20 s (id ${ids[0]}) is replaced, and stays replaced when it wakes up`, () => {
      const r = room(ids);
      r.run();
      const h = ids[0];
      const node = (r.hub as unknown as { nodes: Map<string, { deliver(t: string, d: unknown, f: string): void }> }).nodes.get(h)!;
      const deliver = node.deliver.bind(node);
      const held: [string, unknown, string][] = [];
      node.deliver = (t, d, f) => void held.push([t, d, f]);
      for (let i = 0; i < 70; i++) {
        r.t.ms += 300;
        for (const [id, x] of Object.entries(r.s)) if (id !== h) x.tick();
        r.hub.flush();
      }
      const nh = r.hosts().filter((id) => id !== h);
      expect(nh).toHaveLength(1);
      node.deliver = deliver;
      for (const [t, d, f] of held) deliver(t, d, f);
      r.run(20_000);
      expect(r.hosts()).toEqual(nh);
      expect(settled(r)).toBe(true);
    });
  }

  it('a host who reloads comes back as a client under its new id, with seat 0', () => {
    const r = room(['a', 'b', 'c']);
    r.run();
    r.leave('a');
    r.run();
    const a2 = new Session(r.hub.connect('a2'), new SharedClock(1, r.t.ms), false, state(1), () => r.t.ms, 'tok-a');
    r.s.a2 = a2;
    r.hub.flush();
    r.run(5000);
    expect(a2.role).toBe('client');
    expect(a2.mySeat).toBe(0);
    expect(r.hosts()).toEqual(['b']);
    expect(settled(r)).toBe(true);
  });

  it('a fifth peer in a full room never runs the watchdog or takes over', () => {
    const r = room(['a', 'b', 'c', 'd']);
    r.run();
    const e = new Session(r.hub.connect('e'), new SharedClock(1, r.t.ms), false, state(5), () => r.t.ms, 'tok-e');
    r.s.e = e;
    r.hub.flush();
    r.run(20_000);
    expect(e.welcomed).toBe(false);
    expect(e.role).toBe('client');
    expect(r.hosts()).toEqual(['a']);
  });

  it('a forged welcome or roster from a room member heals within a few seconds', () => {
    for (const forger of ['b', 'c'])
      for (const kind of ['welcome', 'roster'] as const) {
        const r = room(['m', 'b', 'c']);
        r.run();
        const w = r.s.m.welcomeMsg();
        rawSend(r.s[forger], kind, kind === 'welcome' ? w : { e: w.epoch, r: w.roster });
        r.hub.flush();
        r.run(20_000);
        expect(settled(r), `${forger} ${kind}: hosts ${r.hosts()} follows ${r.follows()}`).toBe(true);
      }
  });
});

/** Real partitions between any groups: `split(A, B)` cuts every link across, `heal()` joins everything again. */
function splitter(r: Room) {
  const hub = r.hub as unknown as HubPriv;
  const post = hub.post.bind(hub);
  let group: Record<string, number> = {};
  hub.post = (p, to) => {
    for (const id of to ? [to] : [...hub.nodes.keys()]) if (id !== p.from && (group[id] ?? 0) === (group[p.from] ?? 0)) post(p, id);
  };
  const ids = Object.keys(r.s);
  const apply = (g: Record<string, number>) => {
    const old = group;
    group = g;
    for (const a of ids)
      for (const b of ids) {
        if (!(a < b) || r.left.has(a) || r.left.has(b)) continue;
        const was = (old[a] ?? 0) === (old[b] ?? 0);
        const now = (g[a] ?? 0) === (g[b] ?? 0);
        const [x, y] = [r.s[a] as unknown as Links, r.s[b] as unknown as Links];
        if (was && !now) (x.onLeave(b), y.onLeave(a));
        if (!was && now) (x.onJoin(b), y.onJoin(a));
      }
    r.hub.flush();
  };
  return {
    split(...sides: string[][]) {
      const g: Record<string, number> = {};
      sides.forEach((side, i) => side.forEach((id) => (g[id] = i)));
      apply(g);
    },
    heal: () => apply({}),
  };
}

describe('Host-Wächter fragt alle, Epoche mit Sprung-Grenze (fourth review)', () => {
  type Priv = { hostId: string | null; hostSeenAt: number; known: number; epoch: number };

  it('L2: a stale client that follows a non-host finds the real host through the watchdog hello, not b, a, b, ...', () => {
    const r = room(['a', 'b', 'c', 'd']);
    r.run();
    r.s.a.handOver('d');
    r.run(600);
    expect(r.hosts()).toEqual(['d']);
    // c's stale view: it follows client b and its roster does not list d. The real host d ranks last by seat.
    const c = r.s.c as unknown as Priv;
    r.s.c.roster.delete('d');
    c.hostId = 'b';
    c.hostSeenAt = r.t.ms;
    r.run(2 * NET.hostSilentMs + 1500);
    expect(r.s.c.hostId).toBe('d');
    expect(r.hosts()).toEqual(['d']);
    expect(settled(r)).toBe(true);
    expect(r.s.c.roster.has('d')).toBe(true);
    // And it stays so: no further flips, c is a normal client of d.
    r.run(3 * NET.hostSilentMs);
    expect(r.hosts()).toEqual(['d']);
    expect(settled(r)).toBe(true);
    r.s.d.setSpeed(321, 5);
    r.run(600);
    expect(r.s.c.train.kmh).toBe(321);
  });

  it('L2: the watchdog hello does not let a stale ex-host pull the client back (its epoch is older)', () => {
    const r = room(['a', 'b', 'c']);
    r.run();
    const heal = partition(r, ['a']);
    r.run(8000);
    const nh = r.hosts().filter((id) => id !== 'a');
    expect(nh).toHaveLength(1);
    r.s[nh[0]].setSpeed(321, 5);
    r.run(300);
    heal();
    r.hub.flush();
    r.run(3000);
    // The other client of the new host stops hearing it for a while (its messages are lost) and fires the
    // watchdog while the stale ex-host a is connected and answers every hello with its older welcome.
    const q = r.hub as unknown as { queue: { from: string }[] };
    for (let i = 0; i < 30; i++) {
      r.t.ms += 300;
      for (const x of Object.values(r.s)) x.tick();
      q.queue = q.queue.filter((p) => p.from !== nh[0]);
      r.hub.flush();
    }
    r.run(8000);
    for (const id of ['a', 'b', 'c']) expect(r.s[id].train.kmh, id).toBe(321);
    expect(r.hosts()).toEqual(nh);
    expect(settled(r)).toBe(true);
  });

  it('L2: seeded mini-fuzz of splits, heals, leaves, handovers and progress ends in one host, a complete roster, one epoch', () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 300; seed++) {
      const rnd = mulberry32(seed);
      const n = 3 + Math.floor(rnd() * 2);
      const ids = ['a', 'b', 'c', 'd'].slice(0, n);
      if (rnd() < 0.5) ids.reverse();
      const r = room(ids);
      r.run(3000);
      const p = splitter(r);
      const alive = () => ids.filter((id) => !r.left.has(id));
      const log: string[] = [];
      let prog = 0;
      for (let step = 0; step < 8; step++) {
        const act = rnd();
        if (act < 0.35) {
          const k = 1 + Math.floor(rnd() * (n - 1));
          const sh = [...ids].sort(() => rnd() - 0.5);
          p.split(sh.slice(0, k), sh.slice(k));
          log.push(`split ${sh.slice(0, k)}|${sh.slice(k)}`);
        } else if (act < 0.55) {
          p.heal();
          log.push('heal');
        } else if (act < 0.7) {
          const al = alive();
          if (al.length > 2) {
            const v = al[Math.floor(rnd() * al.length)];
            r.leave(v, rnd() < 0.5);
            log.push(`leave ${v}`);
          }
        } else if (act < 0.85) {
          for (const x of r.hosts()) {
            const peers = (r.s[x] as unknown as { peers: Set<string> }).peers;
            const to = alive().filter((i) => i !== x && peers.has(i));
            if (to.length) r.s[x].handOver(to[Math.floor(rnd() * to.length)]);
          }
          log.push('handover');
        } else {
          for (const x of r.hosts()) r.s[x].setSpeed(100 + ++prog, 9);
          log.push('progress');
        }
        r.run([300, 900, 3000, 8000][Math.floor(rnd() * 4)]);
      }
      p.heal();
      r.run(60_000);
      const h = r.hosts();
      const ok = settled(r) && alive().every((id) => r.s[h[0]].roster.has(id)) && new Set(alive().map((id) => r.s[id].epoch)).size === 1;
      if (!ok) bad.push(`seed ${seed}: hosts ${h} follows ${r.follows()} | ${log.join('; ')}`);
    }
    expect(bad.slice(0, 3)).toEqual([]);
  });

  /** A newcomer is welcomed and a roster change reaches everyone: the host's messages are valid for all. */
  const roomStillWorks = (r: Room) => {
    const h = r.hosts()[0];
    const d = new Session(r.hub.connect('n'), new SharedClock(1, r.now('n')()), false, state(9), r.now('n'), 'tok-n');
    r.s.n = d;
    r.hub.flush();
    r.run(1500);
    expect(d.welcomed, 'newcomer welcomed').toBe(true);
    expect(d.hostId).toBe(h);
    for (const [id, x] of Object.entries(r.s)) if (!r.left.has(id)) expect(x.roster.has('n'), `${id} sees the newcomer`).toBe(true);
    const some = Object.keys(r.s).find((id) => id !== h && id !== 'n' && !r.left.has(id)) as string;
    r.s[some].setState({ ...state(2), name: 'Umbenannt' });
    r.run(600);
    for (const [id, x] of Object.entries(r.s)) if (!r.left.has(id)) expect(x.roster.get(some)?.state.name, `${id} sees the rename`).toBe('Umbenannt');
  };

  for (const kind of ['welcome', 'roster'] as const)
    for (const jump of [1e9, 1e9 - 1, 1e9 - 2, 1000, 65]) {
      it(`L1: a forged ${kind} with epoch ${jump} from a room member changes nothing, and the room keeps working`, () => {
        const r = room(['m', 'b', 'c']);
        r.run();
        const w = r.s.m.welcomeMsg();
        const epoch = jump > 1e6 ? jump : w.epoch + jump;
        rawSend(r.s.c, kind, kind === 'welcome' ? { ...w, epoch } : { e: epoch, r: w.roster });
        r.hub.flush();
        r.run(20_000);
        expect(r.hosts()).toEqual(['m']);
        expect(settled(r)).toBe(true);
        for (const x of Object.values(r.s)) expect(x.epoch).toBeLessThan(100);
        roomStillWorks(r);
        // A later host change from the room itself (a split) stays within what everyone parses.
        const heal = partition(r, ['m']);
        r.run(8000);
        heal();
        r.hub.flush();
        r.run(8000);
        expect(settled(r)).toBe(true);
        for (const [id, x] of Object.entries(r.s)) if (!r.left.has(id)) expect(x.epoch, id).toBeLessThan(100);
      });
    }

  it('L1: a host that meets a forged huge claim does not give way', () => {
    const r = room(['a', 'b', 'c']);
    r.run();
    const w = r.s.a.welcomeMsg();
    rawSend(r.s.b, 'welcome', { ...w, epoch: 1e9 }, 'a');
    rawSend(r.s.b, 'roster', { e: 1e9, r: w.roster }, 'a');
    r.hub.flush();
    r.run(3000);
    expect(r.hosts()).toEqual(['a']);
    expect(r.s.a.epoch).toBe(0);
  });

  it('L1: honest jumps are still believed: ten handovers in a row, and a cut-off peer back after them', () => {
    const r = room(['a', 'b', 'c']);
    r.run();
    const heal = partition(r, ['c']);
    r.run(8000);
    for (let i = 0; i < 10; i++) {
      const from = r.hosts().find((id) => id !== 'c') as string;
      expect(r.s[from].handOver(from === 'a' ? 'b' : 'a')).toBe(true);
      r.run(900);
    }
    const nh = r.hosts().filter((id) => id !== 'c');
    expect(nh).toHaveLength(1);
    expect(r.s[nh[0]].epoch).toBeGreaterThanOrEqual(20);
    r.s[nh[0]].setSpeed(321, 5);
    r.run(300);
    heal();
    r.hub.flush();
    r.run(8000);
    expect(r.hosts()).toEqual(nh);
    expect(settled(r)).toBe(true);
    expect(r.s.c.train.kmh).toBe(321);
  });

  it('L1: no host ever computes an epoch that parseEpoch rejects, even starting at the cap', () => {
    const r = room(['a', 'b', 'c']);
    r.run();
    for (const x of Object.values(r.s)) {
      const p = x as unknown as Priv;
      p.known = p.epoch = 1e9 - 1;
    }
    r.s.a.handOver('b');
    r.run(900);
    expect(r.hosts()).toEqual(['b']);
    expect(r.s.b.epoch).toBeLessThanOrEqual(1e9);
    expect(parseWelcome(r.s.b.welcomeMsg())).not.toBeNull();
    // b leaves: a takes over, claims within range, and is confirmed within range.
    r.leave('b');
    r.run(3000);
    expect(r.hosts()).toEqual(['a']);
    expect(Math.abs(r.s.a.epoch)).toBeLessThanOrEqual(1e9);
    expect(parseWelcome(r.s.a.welcomeMsg())).not.toBeNull();
    expect(settled(r)).toBe(true);
    roomStillWorks(r);
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
