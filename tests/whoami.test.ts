import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assignAuthors, majority, parseIntent, WhoamiHost } from '../src/game/whoami/logic';

const P = ['a', 'b', 'c'];
const ready = (h: WhoamiHost) => P.forEach((p) => h.intent(p, { a: 'ready' }, 0, p === 'a'));

describe('Wer bin ich? rules', () => {
  it('nobody makes their own card', () => {
    const m = assignAuthors(['a', 'b', 'c', 'd']);
    for (const [target, author] of Object.entries(m)) expect(author).not.toBe(target);
    expect(new Set(Object.values(m)).size).toBe(4);
  });

  it('starts playing once every card is in', () => {
    const h = new WhoamiHost(P);
    h.intent('a', { a: 'ready' }, 0, true);
    h.intent('b', { a: 'ready' }, 0, false);
    expect(h.state.phase).toBe('cards');
    h.intent('c', { a: 'ready' }, 0, false);
    expect(h.state.phase).toBe('play');
    expect(h.state.turn).toBe('a');
  });

  it('a yes lets you ask again, a no passes the turn; single votes stay secret', () => {
    const h = new WhoamiHost(P);
    ready(h);
    h.intent('a', { a: 'ask' }, 0, true);
    h.intent('b', { a: 'vote', v: 'yes' }, 0, false);
    expect(JSON.stringify(h.state)).not.toContain('"yes"');
    h.intent('c', { a: 'vote', v: 'yes' }, 0, false);
    expect(h.state.last?.result).toBe('yes');
    expect(h.state.turn).toBe('a');
    h.intent('a', { a: 'ask' }, 0, true);
    h.intent('b', { a: 'vote', v: 'no' }, 0, false);
    h.intent('c', { a: 'vote', v: 'idk' }, 0, false);
    expect(h.state.last?.result).toBe('idk');
    expect(h.state.turn).toBe('b');
    expect(h.state.questions.a).toBe(2);
  });

  it('only the player on turn can start a vote, and the guesser cannot vote', () => {
    const h = new WhoamiHost(P);
    ready(h);
    expect(h.intent('b', { a: 'ask' }, 0, false)).toBe(false);
    h.intent('a', { a: 'guess' }, 0, true);
    expect(h.intent('a', { a: 'vote', v: 'yes' }, 0, true)).toBe(false);
  });

  it('a right guess scores by order and the round ends when all solved', () => {
    const h = new WhoamiHost(P);
    ready(h);
    const solve = (g: string) => {
      h.intent(g, { a: 'guess' }, 0, g === 'a');
      for (const p of P) if (p !== g) h.intent(p, { a: 'vote', v: 'yes' }, 0, p === 'a');
    };
    solve('a');
    solve('b');
    expect(h.state.scores).toEqual({ a: 3, b: 2, c: 0 });
    // Only c is left: the turn stays with c until solved.
    expect(h.state.turn).toBe('c');
    solve('c');
    expect(h.state.phase).toBe('done');
    expect(h.state.scores.c).toBe(1);
  });

  it('a vote closes at its deadline; ties in a guess count as wrong', () => {
    const h = new WhoamiHost(P);
    ready(h);
    h.intent('a', { a: 'guess' }, 0, true);
    h.intent('b', { a: 'vote', v: 'yes' }, 0, false);
    expect(h.tick(1000)).toBe(false);
    expect(h.tick(60_000)).toBe(true);
    expect(h.state.last?.result).toBe('right');
    expect(majority('guess', ['yes', 'no'])).toBe('wrong');
  });

  it('a player leaving during the card phase redraws the circle', () => {
    const h = new WhoamiHost(['a', 'b', 'c', 'd']);
    h.intent('b', { a: 'ready' }, 0, false);
    h.removePlayer('c', 0);
    expect(h.state.players).toEqual(['a', 'b', 'd']);
    for (const [t, au] of Object.entries(h.state.authorOf)) expect(au).not.toBe(t);
  });

  it('rejects unknown intents', () => {
    expect(parseIntent({ a: 'vote', v: 'maybe' })).toBeNull();
    expect(parseIntent({ a: 'hack' })).toBeNull();
    expect(parseIntent({ a: 'vote', v: 'no' })).toEqual({ a: 'vote', v: 'no' });
  });
});

describe('Wer bin ich? over the network', async () => {
  const { LocalGameRoom } = await import('../src/game/minigame');
  const { WhoamiGame } = await import('../src/game/whoami/game');
  const card = (n: string) => `data:image/jpeg;base64,${btoa(n)}`;

  it('nobody ever holds their own card before solving it; it arrives afterwards', () => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 2, name: 'A' },
      { id: 'b', seat: 0, name: 'B' },
      { id: 'c', seat: 1, name: 'C' },
    ]);
    const g = Object.fromEntries(['a', 'b', 'c'].map((id) => [id, new WhoamiGame(room.net(id))]));
    g.a.start();
    room.pump();
    for (const id of ['a', 'b', 'c']) g[id].submitCard(card(`for-${g[id].myTarget}`));
    room.pump();
    room.pump();
    expect(g.b.state?.phase).toBe('play');
    for (const id of ['a', 'b', 'c']) {
      expect(g[id].cards.has(id)).toBe(false);
      expect(g[id].cards.size).toBe(2);
    }
    // Order is by table order (top right first, counter-clockwise): a, b, c. a guesses right.
    g.a.toHost({ a: 'guess' });
    room.pump();
    g.b.toHost({ a: 'vote', v: 'yes' });
    g.c.toHost({ a: 'vote', v: 'yes' });
    room.pump();
    room.pump();
    expect(g.c.state?.solved).toEqual(['a']);
    expect(g.a.cards.get('a')).toBe(card('for-a'));
    expect(g.b.cards.has('b')).toBe(false);
  });
});

describe('Schaffner', async () => {
  const { LoudTracker } = await import('../src/game/schaffner');
  const { SCHAFFNER } = await import('../src/config');
  it('comes after sustained shouting, not for a short laugh, and not again right away', () => {
    const t = new LoudTracker();
    const run = (level: number, secs: number, start: number) => {
      let hit: string | null = null;
      for (let s = 0; s < secs; s += 0.05) hit ??= t.feed(new Map([['a', level]]), 0.05, start + s);
      return hit;
    };
    expect(run(1, 1, 0)).toBeNull();
    expect(run(0, 5, 1)).toBeNull();
    expect(run(1, SCHAFFNER.loudS + 0.2, 10)).toBe('a');
    expect(run(1, SCHAFFNER.loudS + 0.2, 14)).toBeNull();
  });
});

describe('Wer bin ich? resilience', async () => {
  const { LocalGameRoom } = await import('../src/game/minigame');
  const { WhoamiGame } = await import('../src/game/whoami/game');
  const card = (n: string) => `data:image/jpeg;base64,${btoa(n)}`;

  it('a new host continues a running round from the public state', () => {
    const h = new WhoamiHost(P);
    ready(h);
    h.intent('a', { a: 'ask' }, 0, true);
    const h2 = WhoamiHost.fromState(h.state);
    expect(h2.state.phase).toBe('play');
    expect(h2.state.vote).toBeNull();
    expect(h2.intent('a', { a: 'ask' }, 0, false)).toBe(true);
  });

  it("after a rejoin the returning player gets the others' cards again, never their own", () => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 2, name: 'A' },
      { id: 'b', seat: 0, name: 'B' },
      { id: 'c', seat: 1, name: 'C' },
      { id: 'b2', seat: -1, name: 'B' },
    ]);
    // b2 is not in the room yet.
    const late = room.roster.pop()!;
    const g: Record<string, InstanceType<typeof WhoamiGame>> = Object.fromEntries(['a', 'b', 'c', 'b2'].map((id) => [id, new WhoamiGame(room.net(id))]));
    g.a.start();
    room.pump();
    for (const id of ['a', 'b', 'c']) g[id].submitCard(card(`for-${g[id].myTarget}`));
    room.pump();
    room.pump();
    // b reloads: gone, then back as b2 on the same seat.
    room.roster.splice(1, 1, { ...late, seat: 0 });
    g.a.rejoin('b', 'b2');
    room.pump();
    room.pump();
    expect(g.b2.state?.players).toContain('b2');
    expect(g.b2.cards.has('b2')).toBe(false);
    expect([...g.b2.cards.keys()].sort()).toEqual(['a', 'c']);
  });
});

describe('dropped-out players', async () => {
  const { LocalGameRoom } = await import('../src/game/minigame');
  const { WhoamiGame } = await import('../src/game/whoami/game');
  const card = (n: string) => `data:image/jpeg;base64,${btoa(n)}`;

  it('without the absent one, a vote closes once everyone here has voted', () => {
    const h = new WhoamiHost(['a', 'b', 'c', 'd']);
    ['a', 'b', 'c', 'd'].forEach((p) => h.intent(p, { a: 'ready' }, 0, p === 'a'));
    h.intent('a', { a: 'ask' }, 0, true);
    h.intent('b', { a: 'vote', v: 'yes' }, 0, false);
    const here = new Set(['a', 'b', 'c']);
    expect(h.closeIfAllIn(here)).toBe(false);
    h.intent('c', { a: 'vote', v: 'yes' }, 0, false);
    expect(h.closeIfAllIn(here)).toBe(true);
    expect(h.state.last?.result).toBe('yes');
    expect(h.state.players).toContain('d');
  });

  it('they keep their place until someone plays on without them, and only then', () => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 2, name: 'A' },
      { id: 'b', seat: 0, name: 'B' },
      { id: 'c', seat: 1, name: 'C' },
    ]);
    const g = Object.fromEntries(['a', 'b', 'c'].map((id) => [id, new WhoamiGame(room.net(id))]));
    g.a.start();
    room.pump();
    // c drops out before making a card: still in the round, the others see who is missing.
    room.roster.pop();
    for (let i = 0; i < 3; i++) g.a.tick(performance.now());
    room.pump();
    expect(g.a.state?.players).toContain('c');
    expect(g.b.absent()).toEqual(['c']);
    // Nobody can drop someone who is still here.
    g.b.drop('a');
    room.pump();
    expect(g.a.state?.players).toContain('a');
    // b decides to play on: c is out, the circle is redrawn for a and b.
    g.b.drop('c');
    room.pump();
    expect(g.a.state?.players).toEqual(['a', 'b']);
    room.pump();
    expect(g.b.absent()).toEqual([]);
    for (const id of ['a', 'b']) g[id].submitCard(card(id));
    room.pump();
    expect(g.a.state?.phase).toBe('play');
  });

  it('a request to play on waits until the host sees them gone too', () => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 2, name: 'A' },
      { id: 'b', seat: 0, name: 'B' },
      { id: 'c', seat: 1, name: 'C' },
    ]);
    const g = Object.fromEntries(['a', 'b', 'c'].map((id) => [id, new WhoamiGame(room.net(id))]));
    g.a.start();
    room.pump();
    // b already saw c leave, the host not yet.
    g.b.drop('c');
    room.pump();
    expect(g.a.state?.players).toContain('c');
    room.roster.pop();
    g.a.tick(performance.now());
    room.pump();
    expect(g.a.state?.players).toEqual(['a', 'b']);
  });
});

describe('WhoamiHost.replace', () => {
  it('moves everything that names the player to the new id, and a running vote keeps their vote', () => {
    const h = new WhoamiHost(P);
    ready(h);
    // a asks, b answers, then b is the one to reload.
    h.intent('a', { a: 'ask' }, 0, true);
    h.intent('b', { a: 'vote', v: 'no' }, 0, false);
    expect(h.replace('b', 'b2')).toBe(true);
    const s = h.state;
    expect(s.players).toEqual(['a', 'b2', 'c']);
    expect([...s.ready].sort()).toEqual(['a', 'b2', 'c']);
    expect(s.authorOf).toEqual({ b2: 'a', c: 'b2', a: 'c' });
    expect(s.vote?.voters).toEqual(['b2']);
    expect(s.questions).toEqual({ a: 0, b2: 0, c: 0 });
    expect(Object.keys(s.scores).sort()).toEqual(['a', 'b2', 'c']);
    // The old id is gone everywhere, and the vote already cast still counts (and can't be cast twice).
    expect(JSON.stringify(s)).not.toMatch(/"b"/);
    expect(h.intent('b2', { a: 'vote', v: 'yes' }, 0, false)).toBe(false);
    h.intent('c', { a: 'vote', v: 'no' }, 0, false);
    expect(h.state.last?.result).toBe('no');
    expect(h.state.last?.votes).toBe(2);
    expect(h.state.turn).toBe('b2');
  });

  it('follows the turn, the last result, solved players, scores and the undo history', () => {
    const h = new WhoamiHost(P);
    ready(h);
    // a solves, so b is on turn; b asks and gets a "yes" from a and c: last.guesser is b.
    h.intent('a', { a: 'guess' }, 0, true);
    h.intent('b', { a: 'vote', v: 'yes' }, 0, false);
    h.intent('c', { a: 'vote', v: 'yes' }, 0, false);
    h.intent('b', { a: 'ask' }, 0, false);
    h.intent('a', { a: 'vote', v: 'yes' }, 0, true);
    h.intent('c', { a: 'vote', v: 'yes' }, 0, false);
    expect(h.state.last?.guesser).toBe('b');
    expect(h.replace('b', 'b2')).toBe(true);
    h.replace('a', 'a2');
    const s = h.state;
    expect(s.turn).toBe('b2');
    expect(s.last?.guesser).toBe('b2');
    expect(s.solved).toEqual(['a2']);
    expect(s.scores).toEqual({ a2: 3, b2: 0, c: 0 });
    expect(s.questions.b2).toBe(1);
    // Taking back the last decision lands in a state that already speaks of the new ids.
    expect(h.undo()).toBe(true);
    expect(h.state.players).toEqual(['a2', 'b2', 'c']);
    expect(h.state.turn).toBe('b2');
    expect(JSON.stringify(h.state)).not.toMatch(/"[ab]"/);
  });

  it('knows nobody it was not told about', () => {
    const h = new WhoamiHost(P);
    const before = JSON.stringify(h.state);
    expect(h.replace('x', 'y')).toBe(false);
    expect(JSON.stringify(h.state)).toBe(before);
  });
});

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
}

describe('Wer bin ich? reload', async () => {
  const { LocalGameRoom } = await import('../src/game/minigame');
  const { WhoamiGame } = await import('../src/game/whoami/game');
  const { tabStore } = await import('../src/game/tabStore');
  const card = (n: string) => `data:image/jpeg;base64,${btoa(n)}`;
  type Game = InstanceType<typeof WhoamiGame>;
  type Net = ReturnType<InstanceType<typeof LocalGameRoom>['net']>;

  beforeEach(() => {
    const s = fakeStorage();
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: () => s });
  });
  afterEach(() => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  });

  /** A room of `ids` (in table order a, b, c ...) plus the ids of tabs that reload into it later. */
  function setup(ids: string[], later: string[] = []) {
    const seatOf = (id: string) => [2, 0, 1, 3][ids.indexOf(id)];
    const room = new LocalGameRoom([...ids, ...later].map((id) => ({ id, seat: seatOf(id) ?? -1, name: id.toUpperCase() })));
    const lateMembers = room.roster.splice(ids.length);
    const host = { id: ids[0] };
    const settle = () => {
      for (let i = 0; i < 8; i++) room.pump();
    };
    /** `scope` is the tab's store: a reload keeps it, even though the player gets a new id. */
    const open = (id: string, scope: string, wrap: (n: Net) => Net = (n) => n): Game => {
      const base = room.net(id);
      return new WhoamiGame(wrap({ ...base, isHost: () => host.id === id, hostId: () => host.id }), undefined, tabStore('wi', scope));
    };
    const g: Record<string, Game> = Object.fromEntries(ids.map((id) => [id, open(id, id)]));
    const submitAll = (ps: string[]) => {
      for (const id of ps) g[id].submitCard(card(`for-${g[id].myTarget}`));
      settle();
    };
    /** `old` is gone (if it still was in the room), `id` takes its seat; `hostGame` moves the round over to it. */
    const reload = (old: string, id: string, hostGame: Game, wrap?: (n: Net) => Net): Game => {
      const i = room.roster.findIndex((m) => m.id === old);
      const me = { ...lateMembers.find((m) => m.id === id)!, seat: seatOf(old) };
      if (i >= 0) room.roster.splice(i, 1, me);
      else room.roster.push(me);
      g[id] = open(id, old, wrap);
      hostGame.rejoin(old, id);
      settle();
      return g[id];
    };
    return { room, g, host, settle, submitAll, reload };
  }

  it('an author who reloads still lets their target see the card once solved', () => {
    const { g, settle, submitAll, reload } = setup(['a', 'b', 'c'], ['b2']);
    g.a.start();
    settle();
    submitAll(['a', 'b', 'c']);
    expect(g.a.state?.phase).toBe('play');
    // b made c's card and reloads; the stored card comes back with the state.
    const b2 = reload('b', 'b2', g.a);
    expect(b2.cards.get('c')).toBe(card('for-c'));
    expect(b2.cards.has('b2')).toBe(false);
    expect(b2.myCardSent).toBe(true);
    // a passes, b2 passes, c guesses right and gets the card from b2.
    g.a.toHost({ a: 'pass' });
    settle();
    b2.toHost({ a: 'pass' });
    settle();
    expect(g.a.state?.turn).toBe('c');
    g.c.toHost({ a: 'guess' });
    settle();
    g.a.toHost({ a: 'vote', v: 'yes' });
    b2.toHost({ a: 'vote', v: 'yes' });
    settle();
    expect(g.c.state?.solved).toEqual(['c']);
    expect(g.c.cards.get('c')).toBe(card('for-c'));
  });

  it('with two players the author gets back the card they made, and the target gets it when solving', () => {
    const { g, settle, submitAll, reload } = setup(['a', 'b'], ['b2']);
    g.a.start();
    settle();
    submitAll(['a', 'b']);
    // b is the only one who ever held the card for a: nobody else could send it again.
    expect(g.b.cards.get('a')).toBe(card('for-a'));
    const b2 = reload('b', 'b2', g.a);
    expect(b2.cards.get('a')).toBe(card('for-a'));
    g.a.toHost({ a: 'guess' });
    settle();
    b2.toHost({ a: 'vote', v: 'yes' });
    settle();
    expect(g.a.state?.solved).toEqual(['a']);
    expect(g.a.cards.get('a')).toBe(card('for-a'));
    // The card that a made is still known to a under b's new id.
    expect(g.a.cards.get('b2')).toBe(card('for-b'));
    expect(g.a.cards.has('b')).toBe(false);
  });

  it('a reload before the round ends also gets the card to the target at the end', () => {
    const { g, settle, submitAll, reload } = setup(['a', 'b'], ['b2']);
    g.a.start();
    settle();
    submitAll(['a', 'b']);
    const b2 = reload('b', 'b2', g.a);
    expect(g.a.cards.has('a')).toBe(false);
    g.a.end();
    settle();
    expect(b2.state?.phase).toBe('done');
    expect(g.a.cards.get('a')).toBe(card('for-a'));
  });

  it('when the host reloads, the longest-present player takes over and the round goes on', () => {
    const { room, g, host, settle, submitAll, reload } = setup(['a', 'b', 'c'], ['a2']);
    g.a.start();
    settle();
    submitAll(['a', 'b', 'c']);
    g.a.toHost({ a: 'guess' });
    settle();
    g.b.toHost({ a: 'vote', v: 'yes' });
    settle();
    expect(g.b.state?.vote).not.toBeNull();
    // a (host) is gone: b is next in line. The running vote is cancelled, the rest stays.
    room.roster.shift();
    host.id = 'b';
    g.b.tick(performance.now());
    settle();
    expect(g.b.isHost).toBe(true);
    expect(g.b.state?.phase).toBe('play');
    expect(g.b.state?.vote).toBeNull();
    expect(g.c.state?.vote).toBeNull();
    expect(g.c.state?.turn).toBe('a');
    // a is back as a2: seat, turn and card come back.
    const a2 = reload('a', 'a2', g.b);
    expect(a2.state?.players).toEqual(['a2', 'b', 'c']);
    expect(a2.state?.turn).toBe('a2');
    expect(a2.cards.get('b')).toBe(card('for-b'));
    expect(a2.cards.get('c')).toBe(card('for-c'));
    expect(a2.cards.has('a2')).toBe(false);
    // The round continues under the new host: a2 guesses right, and c (a's author) sends the card.
    a2.toHost({ a: 'guess' });
    settle();
    g.b.toHost({ a: 'vote', v: 'yes' });
    g.c.toHost({ a: 'vote', v: 'yes' });
    settle();
    expect(g.c.state?.solved).toEqual(['a2']);
    expect(a2.cards.get('a2')).toBe(card('for-a'));
    expect(g.b.state?.scores.a2).toBe(3);
  });

  it('missing cards are asked for again and again until they are all there', () => {
    const { g, settle, submitAll, reload } = setup(['a', 'b', 'c', 'd'], ['b2']);
    g.a.start();
    settle();
    submitAll(['a', 'b', 'c', 'd']);
    // The pushed cards get lost on the way, and so does every answer, until `open` is set.
    const wire = { open: false, asks: 0 };
    const b2 = reload('b', 'b2', g.a, (n) => ({
      ...n,
      send: (t, d, to) => {
        if (t === 'mg:ask') wire.asks++;
        n.send(t, d, to);
      },
      onMessage: (h) => n.onMessage((t, d, f) => (wire.open || (t !== 'wi:card' && t !== 'mg:have') ? h(t, d, f) : undefined)),
    }));
    // The card b made for c came back from the store; a's and d's are missing.
    expect(b2.missingCards().sort()).toEqual(['a', 'd']);
    // Nothing is asked in the first moment: a card may just be on its way.
    let now = 1000;
    const step = (ms: number) => {
      now += ms;
      b2.tick(now);
      settle();
    };
    step(0);
    step(500);
    expect(wire.asks).toBe(0);
    step(1500);
    expect(wire.asks).toBe(1);
    step(2000);
    step(2000);
    step(2000);
    expect(wire.asks).toBeGreaterThanOrEqual(3);
    expect([...b2.cards.keys()]).toEqual(['c']);
    wire.open = true;
    step(2000);
    expect([...b2.cards.keys()].sort()).toEqual(['a', 'c', 'd']);
    // Own card never came along, though a holds a copy of it.
    expect(b2.cards.has('b2')).toBe(false);
    // Got them all: no more asks.
    const asks = wire.asks;
    for (let i = 0; i < 6; i++) step(2000);
    expect(wire.asks).toBe(asks);
  });

  it('nobody who can help: it asks a few times and then stops', () => {
    const { g, settle, submitAll, reload } = setup(['a', 'b', 'c', 'd'], ['b2']);
    g.a.start();
    settle();
    submitAll(['a', 'b', 'c', 'd']);
    let asks = 0;
    const b2 = reload('b', 'b2', g.a, (n) => ({
      ...n,
      send: (t, d, to) => {
        if (t === 'mg:ask') asks++;
        n.send(t, d, to);
      },
      onMessage: (h) => n.onMessage((t, d, f) => (t === 'wi:card' || t === 'mg:have' ? undefined : h(t, d, f))),
    }));
    let now = 1000;
    for (let i = 0; i < 80; i++) {
      now += 1000;
      b2.tick(now);
      settle();
    }
    expect(asks).toBe(8);
    expect([...b2.cards.keys()]).toEqual(['c']);
  });

  it('a card that comes before there is any state is dropped (the ask brings it later)', () => {
    const { room } = setup(['a', 'b', 'c']);
    const lone = new WhoamiGame(room.net('c'), undefined, tabStore('wi', 'lone'));
    lone.onMessage('wi:card', { target: 'a', img: card('for-a') }, 'c');
    expect(lone.cards.size).toBe(0);
  });

  it('only a card that may be theirs is accepted: not their own before solving, not from a stranger', () => {
    const { g, settle, submitAll } = setup(['a', 'b', 'c']);
    g.a.start();
    settle();
    submitAll(['a', 'b', 'c']);
    g.c.onMessage('wi:card', { target: 'c', img: card('x') }, 'b');
    g.c.onMessage('wi:card', { target: 'a', img: card('x') }, 'zzz');
    g.c.onMessage('wi:card', { target: 'b', img: card('x') }, 'b');
    expect(g.c.cards.has('c')).toBe(false);
    expect(g.c.cards.get('a')).toBe(card('for-a'));
    expect(g.c.cards.get('b')).toBe(card('for-b'));
  });

  it('the card I made is kept for this tab only until the next round starts', () => {
    const { g, settle, submitAll } = setup(['a', 'b', 'c']);
    g.a.start();
    settle();
    expect(tabStore('wi', 'b').get('myCard')).toBeUndefined();
    submitAll(['a', 'b', 'c']);
    expect(tabStore('wi', 'b').get('myCard')).toEqual({ round: 1, img: card('for-c') });
    expect(tabStore('wi', 'a').get('myCard')).toEqual({ round: 1, img: card('for-b') });
    g.a.end();
    settle();
    // Still there while the round is over: the target may reload and ask for it.
    expect(tabStore('wi', 'b').get('myCard')).toBeDefined();
    g.a.start();
    settle();
    for (const id of ['a', 'b', 'c']) expect(tabStore('wi', id).get('myCard')).toBeUndefined();
  });

  it('works without any storage, from memory', () => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    const { g, settle, submitAll } = setup(['a', 'b']);
    g.a.start();
    settle();
    submitAll(['a', 'b']);
    expect(g.a.state?.phase).toBe('play');
    expect(g.a.cards.get('b')).toBe(card('for-b'));
  });
});
