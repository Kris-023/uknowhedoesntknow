import { describe, expect, it } from 'vitest';
import { ZEIG } from '../src/config';
import { mulberry32 } from '../src/core/rng';
import { botPick } from '../src/game/zeig/bots';
import { drawQuestions, parseIntent, tally, ZeigHost } from '../src/game/zeig/logic';
import { ZEIG_NORMAL, ZEIG_NSFW } from '../src/words/zeig';

const P = ['a', 'b', 'c', 'd'];
const Q = ['q1', 'q2', 'q3'];
const aim = (id: string | null, lock = true) => ({ a: 'aim' as const, id, lock });
/** Everyone locks the given pick at `t`. */
function pickAll(h: ZeigHost, picks: Record<string, string | null>, t = 0): void {
  for (const [p, id] of Object.entries(picks)) h.intent(p, aim(id), t, p === 'a');
}

describe('Zeig drauf: questions', () => {
  it('has enough questions, the crude ones kept apart, none twice', () => {
    expect(ZEIG_NORMAL.length).toBeGreaterThanOrEqual(55);
    expect(ZEIG_NSFW.length).toBeGreaterThanOrEqual(20);
    expect(new Set([...ZEIG_NORMAL, ...ZEIG_NSFW]).size).toBe(ZEIG_NORMAL.length + ZEIG_NSFW.length);
  });

  it('draws different questions and avoids the ones already asked', () => {
    const q = drawQuestions(ZEIG.questions, ZEIG_NORMAL, mulberry32(1));
    expect(new Set(q).size).toBe(ZEIG.questions);
    const avoid = new Set(ZEIG_NORMAL.slice(0, ZEIG_NORMAL.length - ZEIG.questions));
    for (const x of drawQuestions(ZEIG.questions, ZEIG_NORMAL, mulberry32(2), avoid)) expect(avoid.has(x)).toBe(false);
    // Too few left: the whole pool again.
    expect(drawQuestions(3, ['x', 'y', 'z'], mulberry32(3), new Set(['x', 'y']))).toHaveLength(3);
  });

  it('validates intents', () => {
    expect(parseIntent({ a: 'aim', id: 'b', lock: false })).toEqual({ a: 'aim', id: 'b', lock: false });
    expect(parseIntent({ a: 'aim', id: null, lock: true })).toEqual({ a: 'aim', id: null, lock: true });
    expect(parseIntent({ a: 'aim', id: 3, lock: true })).toBeNull();
    expect(parseIntent({ a: 'aim', id: 'b' })).toBeNull();
    expect(parseIntent({ a: 'aim', id: 'x'.repeat(200), lock: true })).toBeNull();
    expect(parseIntent({ a: 'ready' })).toEqual({ a: 'ready' });
    expect(parseIntent({ a: 'nope' })).toBeNull();
    expect(parseIntent(null)).toBeNull();
  });
});

describe('Zeig drauf: rules', () => {
  it('tally: most picked, ties, nobody; self-picks never count', () => {
    expect(tally({ a: 'b', b: 'c', c: 'b', d: null }, P)).toMatchObject({ top: ['b'], count: 2 });
    expect(tally({ a: 'b', b: 'a', c: null, d: null }, P)).toMatchObject({ top: ['a', 'b'], count: 1 });
    expect(tally({ a: null, b: null, c: null, d: null }, P)).toMatchObject({ top: [], count: 0 });
    expect(tally({ a: 'a', b: 'a' }, P)).toMatchObject({ top: ['a'], count: 1 });
  });

  it('picks stay secret while looking; all locked reveals at once', () => {
    const h = new ZeigHost(P, Q, {}, 1, 0);
    expect(h.state.phase).toBe('look');
    h.intent('a', aim('b', false), 1, true);
    h.intent('b', aim('c'), 1, false);
    // Nobody's pick is in the public state, only who locked: other picks, same state.
    const other = new ZeigHost(P, Q, {}, 1, 0);
    other.intent('a', aim('d', false), 1, true);
    other.intent('b', aim('a'), 1, false);
    expect(other.state).toEqual(h.state);
    expect(h.state.locked).toEqual(['b']);
    expect(h.state.history).toEqual([]);
    pickAll(h, { a: 'c', c: 'b', d: 'c' }, 2);
    expect(h.state.phase).toBe('reveal');
    expect(h.state.history[0]).toEqual({ question: 'q1', picks: { a: 'c', b: 'c', c: 'b', d: 'c' }, top: ['c'], count: 3 });
    // With the majority: a, b and d.
    expect(h.state.scores).toEqual({ a: ZEIG.majorityPoints, b: ZEIG.majorityPoints, c: 0, d: ZEIG.majorityPoints });
  });

  it('the timer counts what people look at; nothing = abstain', () => {
    const h = new ZeigHost(P, Q, {}, 1, 0);
    h.intent('a', aim('b', false), 1, true);
    h.intent('a', aim('c', false), 2, true); // looked elsewhere
    h.intent('b', aim('c', false), 2, false);
    h.tick(ZEIG.lookS * 1000 - 1);
    expect(h.state.phase).toBe('look');
    h.tick(ZEIG.lookS * 1000);
    expect(h.state.phase).toBe('reveal');
    expect(h.state.history[0].picks).toEqual({ a: 'c', b: 'c', c: null, d: null });
    expect(h.state.scores.a).toBe(ZEIG.majorityPoints);
    expect(h.state.scores.c).toBe(0);
  });

  it('a tied majority scores everyone in it; a "majority" of one scores nobody', () => {
    const h = new ZeigHost(P, Q, {}, 1, 0);
    pickAll(h, { a: 'b', b: 'a', c: 'b', d: 'a' });
    expect(h.state.history[0].top).toEqual(['a', 'b']);
    expect(h.state.scores).toEqual({ a: 1, b: 1, c: 1, d: 1 });
    h.intent('a', { a: 'ready' }, 1, true);
    for (const p of ['b', 'c', 'd']) h.intent(p, { a: 'ready' }, 1, false);
    expect(h.state.phase).toBe('look');
    pickAll(h, { a: 'b', b: 'c', c: 'd', d: null }, 2);
    expect(h.state.history[1].top).toEqual(['b', 'c', 'd']);
    expect(h.state.history[1].count).toBe(1);
    expect(h.state.scores).toEqual({ a: 1, b: 1, c: 1, d: 1 });
  });

  it('refuses picking yourself, strangers, picks after locking, and picks outside the look phase', () => {
    const h = new ZeigHost(P, Q, {}, 1, 0);
    expect(h.intent('a', aim('a'), 0, true)).toBe(false);
    expect(h.intent('a', aim('zz'), 0, true)).toBe(false);
    expect(h.intent('zz', aim('a'), 0, false)).toBe(false);
    expect(h.intent('a', aim('b'), 0, true)).toBe(true);
    expect(h.intent('a', aim('c'), 0, true)).toBe(false);
    pickAll(h, { b: 'a', c: 'a', d: 'a' });
    expect(h.state.phase).toBe('reveal');
    expect(h.intent('b', aim('c'), 0, false)).toBe(false);
    expect(h.state.history[0].picks.a).toBe('b');
  });

  it('runs through all questions, then is done; reveal ends by itself', () => {
    const h = new ZeigHost(['a', 'b', 'c'], Q, {}, 1, 0);
    let t = 0;
    for (let i = 0; i < Q.length; i++) {
      expect(h.state.qNo).toBe(i + 1);
      pickAll(h, { a: 'b', b: 'a', c: 'a' }, t);
      expect(h.state.phase).toBe('reveal');
      t += ZEIG.revealS * 1000;
      h.tick(t);
    }
    expect(h.state.phase).toBe('done');
    expect(h.state.history.map((r) => r.question)).toEqual(Q);
    expect(h.state.scores).toEqual({ a: 0, b: 3, c: 3 });
  });

  it('absent players block nothing', () => {
    const h = new ZeigHost(P, Q, {}, 1, 0);
    h.present = new Set(['a', 'b', 'c']);
    pickAll(h, { a: 'b', b: 'c', c: 'b' });
    expect(h.state.phase).toBe('reveal');
    expect(h.state.history[0].picks.d).toBeNull();
    for (const p of ['a', 'b', 'c']) h.intent(p, { a: 'ready' }, 1, p === 'a');
    expect(h.state.phase).toBe('look');
  });

  it('the Schaffner takes a point; only the host ends a round', () => {
    const h = new ZeigHost(P, Q, {}, 1, 0);
    h.penalize('c', 1);
    expect(h.state.scores.c).toBe(-1);
    expect(h.intent('b', { a: 'end' }, 0, false)).toBe(false);
    expect(h.intent('a', { a: 'end' }, 0, true)).toBe(true);
    expect(h.state.phase).toBe('done');
  });
});

describe('Zeig drauf: leaving, returning, new host', () => {
  it('replace follows the new id into picks (both sides), locks, history and scores', () => {
    const h = new ZeigHost(P, Q, { b: 4 }, 1, 0);
    pickAll(h, { a: 'b', b: 'c', c: 'b', d: 'b' });
    h.intent('a', { a: 'ready' }, 0, true);
    for (const p of ['b', 'c', 'd']) h.intent(p, { a: 'ready' }, 0, false);
    h.intent('b', aim('a', false), 1, false);
    h.intent('c', aim('b'), 1, false);
    expect(h.replace('b', 'b2')).toBe(true);
    expect(h.replace('zz', 'q')).toBe(false);
    expect(h.state.players).toEqual(['a', 'b2', 'c', 'd']);
    expect(h.state.locked).toEqual(['c']);
    expect(h.state.history[0].picks).toEqual({ a: 'b2', b2: 'c', c: 'b2', d: 'b2' });
    expect(h.state.history[0].top).toEqual(['b2']);
    expect(h.state.scores.b2).toBe(4 + 0);
    expect('b' in h.state.scores).toBe(false);
    // Picks in flight follow too: b2 still looks at a, c's lock on b counts for b2.
    pickAll(h, { a: 'c', b2: 'c', d: 'c' }, 2);
    expect(h.state.history[1].picks).toEqual({ a: 'c', b2: 'c', c: 'b2', d: 'c' });
  });

  it('removePlayer: their pick and picks on them go; too few players end the round', () => {
    const h = new ZeigHost(P, Q, {}, 1, 0);
    h.intent('a', aim('d', false), 0, true);
    h.intent('b', aim('a'), 0, false);
    h.intent('c', aim('a'), 0, false);
    expect(h.removePlayer('d', 1)).toBe(true);
    // The rest had locked or not: a has not.
    expect(h.state.phase).toBe('look');
    h.intent('a', aim('b'), 2, true);
    expect(h.state.phase).toBe('reveal');
    expect(h.state.history[0].picks).toEqual({ a: 'b', b: 'a', c: 'a' });
    expect(h.removePlayer('c', 3)).toBe(true);
    expect(h.state.phase).toBe('done');
    expect(h.state.short).toBe(true);
  });

  it('a new host continues from the public state and waits for the picks again', () => {
    const h = new ZeigHost(P, Q, { a: 2 }, 3, 0);
    pickAll(h, { a: 'b', b: 'a' });
    const n = ZeigHost.fromState(structuredClone(h.state), 500);
    expect(n.state.phase).toBe('look');
    expect(n.state.locked).toEqual([]);
    expect(n.state.round).toBe(3);
    expect(n.state.scores.a).toBe(2);
    expect(n.state.deadline).toBeGreaterThanOrEqual(500 + ZEIG.takeoverS * 1000);
    pickAll(n, { a: 'b', b: 'a', c: 'a', d: 'a' }, 600);
    expect(n.state.history[0].top).toEqual(['a']);
  });
});

describe('Zeig drauf: bots', () => {
  it('never pick themselves, and lean to the table favourite', () => {
    const r = mulberry32(5);
    const hist = [{ question: 'q', picks: {}, top: ['c'], count: 2 }];
    let c = 0;
    for (let i = 0; i < 400; i++) {
      const p = botPick('a', P, hist, r);
      expect(p).not.toBe('a');
      if (p === 'c') c++;
    }
    // Random alone would give a third.
    expect(c / 400).toBeGreaterThan(0.45);
    expect(botPick('a', ['a'], [], r)).toBeNull();
  });
});

describe('Zeig drauf over the network', async () => {
  const { LocalGameRoom } = await import('../src/game/minigame');
  const { ZeigGame } = await import('../src/game/zeig/game');
  const ids = ['a', 'b', 'c'];
  const make = (decks: ('normal' | 'nsfw')[] = ['normal']) => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 0, name: 'A' },
      { id: 'b', seat: 2, name: 'B' },
      { id: 'c', seat: 1, name: 'C' },
    ]);
    const g = Object.fromEntries(ids.map((id) => [id, new ZeigGame(room.net(id), { decks: () => decks })]));
    return { room, g };
  };

  it('three clients point, the host reveals together, everyone agrees on the result', () => {
    const { room, g } = make();
    g.a.start();
    room.pump();
    expect(g.b.state?.phase).toBe('look');
    expect(g.b.pickable()).toEqual(['a', 'c']);
    g.b.aim('c');
    g.c.aim('a');
    room.pump();
    expect(g.a.state!.locked).toEqual([]);
    g.b.lock();
    g.c.lock('b');
    g.a.lock('b');
    room.pump();
    for (const id of ids) {
      expect(g[id].state!.phase).toBe('reveal');
      expect(g[id].shown!.picks).toEqual({ a: 'b', b: 'c', c: 'b' });
      expect(g[id].shown!.top).toEqual(['b']);
      expect(g[id].state!.scores).toEqual({ a: 1, b: 0, c: 1 });
    }
    // After locking there is nothing left to pick; the lock stays highlighted while looking.
    expect(g.b.pickable()).toEqual([]);
  });

  it('a pick that changed counts as the last one the host got', () => {
    const { room, g } = make();
    g.a.start();
    room.pump();
    g.b.aim('a');
    // Throttled: the second change waits for the next flush.
    g.b.aim('c');
    room.pump();
    (g.b as unknown as { pick: { forget(): void } }).pick.forget();
    g.b.tick(performance.now());
    room.pump();
    g.a.lock('c');
    g.c.lock('b');
    room.pump();
    const a = g.a as unknown as { host: { tick(n: number): boolean; state: { deadline: number } }; publish(): void };
    a.host.tick(a.host.state.deadline);
    a.publish();
    room.pump();
    expect(g.c.shown!.picks.b).toBe('c');
  });

  it('only rooms with the NSFW deck get the crude questions', () => {
    const crude = new Set(ZEIG_NSFW);
    for (let i = 0; i < 10; i++) {
      const { room, g } = make(['normal']);
      g.a.start();
      room.pump();
      for (const q of g.b.state!.questions) expect(crude.has(q)).toBe(false);
    }
    let seen = 0;
    for (let i = 0; i < 20; i++) {
      const { room, g } = make(['normal', 'nsfw']);
      g.a.start();
      room.pump();
      seen += g.b.state!.questions.filter((q) => crude.has(q)).length;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('needs three players', () => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 0, name: 'A' },
      { id: 'b', seat: 2, name: 'B' },
    ]);
    const a = new ZeigGame(room.net('a'), { decks: () => ['normal'] });
    a.start();
    expect(a.state).toBeNull();
  });

  it('does not wait for an absent player, who can be dropped', () => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 0, name: 'A' },
      { id: 'b', seat: 2, name: 'B' },
      { id: 'c', seat: 1, name: 'C' },
      { id: 'd', seat: 3, name: 'D' },
    ]);
    const g = Object.fromEntries(['a', 'b', 'c', 'd'].map((id) => [id, new ZeigGame(room.net(id), { decks: () => ['normal'] })]));
    g.a.start();
    room.pump();
    room.roster.pop();
    expect(g.a.absent()).toEqual(['d']);
    expect(g.a.pickable()).toEqual(['b', 'c']);
    g.a.lock('b');
    g.b.lock('c');
    g.c.lock('b');
    room.pump();
    g.a.tick(performance.now());
    expect(g.a.state!.phase).toBe('reveal');
    g.b.drop('d');
    room.pump();
    expect(g.a.state!.players).toEqual(['a', 'b', 'c']);
    expect(g.a.absent()).toEqual([]);
  });

  it('a reload: the new id keeps the place, points and the lock it had', () => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 0, name: 'A' },
      { id: 'b', seat: 2, name: 'B' },
      { id: 'c', seat: 1, name: 'C' },
      { id: 'b2', seat: -1, name: 'B' },
    ]);
    const late = room.roster.pop()!;
    const g = Object.fromEntries(['a', 'b', 'c', 'b2'].map((id) => [id, new ZeigGame(room.net(id), { decks: () => ['normal'] })]));
    g.a.start();
    room.pump();
    g.b.lock('c');
    room.pump();
    room.roster.splice(1, 1, { ...late, seat: 2 });
    g.a.rejoin('b', 'b2');
    room.pump();
    expect(g.b2.state!.players).toContain('b2');
    expect(g.b2.state!.locked).toEqual(['b2']);
    expect(g.b2.iLocked).toBe(true);
    g.a.lock('c');
    g.c.lock('b2');
    room.pump();
    expect(g.b2.shown!.picks).toEqual({ a: 'c', b2: 'c', c: 'b2' });
  });

  it('a new host takes over mid-question and gets the picks again', () => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 0, name: 'A' },
      { id: 'b', seat: 2, name: 'B' },
      { id: 'c', seat: 1, name: 'C' },
      { id: 'd', seat: 3, name: 'D' },
    ]);
    let host = 'a';
    const net = (id: string) => ({ ...room.net(id), isHost: () => host === id, hostId: () => host });
    const g = Object.fromEntries(['a', 'b', 'c', 'd'].map((id) => [id, new ZeigGame(net(id), { decks: () => ['normal'] })]));
    g.a.start();
    room.pump();
    g.c.lock('b');
    g.d.aim('b');
    room.pump();
    // The host leaves; b carries on from the state it holds.
    room.roster.shift();
    host = 'b';
    g.b.tick(performance.now());
    room.pump();
    for (const id of ['c', 'd']) g[id].tick(performance.now() + 1000);
    room.pump();
    expect(g.b.state!.locked).toEqual(['c']);
    g.b.lock('c');
    room.pump();
    g.d.lock();
    room.pump();
    expect(g.c.state!.phase).toBe('reveal');
    expect(g.c.shown!.picks).toEqual({ a: null, b: 'c', c: 'b', d: 'b' });
  });
});
