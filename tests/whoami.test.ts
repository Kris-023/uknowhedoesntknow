import { describe, expect, it } from 'vitest';
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
      { id: 'a', seat: 0, name: 'A' },
      { id: 'b', seat: 2, name: 'B' },
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
    // Order is by seat order 0, 2, 1: a, b, c. a guesses right.
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
