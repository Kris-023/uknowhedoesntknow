import { describe, expect, it } from 'vitest';
import { AHNUNG } from '../src/config';
import { mulberry32 } from '../src/core/rng';
import { botClue, botGuess, botSuspect } from '../src/game/ahnungslos/bots';
import { AhnHost, cleanClue, givesAway, parseIntent, turnOrder, type AhnState } from '../src/game/ahnungslos/logic';
import type { WordCard } from '../src/words/types';

const P = ['a', 'b', 'c', 'd'];
// A word no test clue, name or id contains.
const CARD = { word: 'Zebrastreifen', taboo: ['Ampel', 'Fußgänger', 'weiß', 'schwarz', 'über die Straße'] };
const SECRET = /zebra/i;
const clue = (word: string) => ({ a: 'clue' as const, word });
const aim = (id: string | null, lock = true) => ({ a: 'aim' as const, id, lock });

/** A round where `clueless` has no word, turns start at seat 0. */
const host = (clueless = 'c', players = P, now = 0) => new AhnHost(players, CARD, clueless, 0, {}, 1, now);

/** Everyone on turn gives a harmless clue until the vote. */
function allClues(h: AhnHost, t = 0): void {
  let i = 0;
  while (h.state.phase === 'clues') h.intent(h.onTurn!, clue(`Hinweis${i++}`), t, h.onTurn === 'a');
}

describe('Ahnungslos: basics', () => {
  it('turn order: seat order from the start player, laps times', () => {
    expect(turnOrder(['a', 'b', 'c'], 1, 2)).toEqual(['b', 'c', 'a', 'b', 'c', 'a']);
    expect(turnOrder(P, 0)).toHaveLength(P.length * AHNUNG.laps);
  });

  it('a clue is one cleaned word', () => {
    expect(cleanClue('  Streifen ')).toBe('Streifen');
    expect(cleanClue('zwei Wörter')).toBeNull();
    expect(cleanClue('Bindestrich-Wort')).toBe('Bindestrich-Wort');
    expect(cleanClue('')).toBeNull();
    expect(cleanClue(5)).toBeNull();
    expect([...cleanClue('x'.repeat(80))!]).toHaveLength(AHNUNG.maxClueLen);
  });

  it('the word itself, or a word with it inside, gives it away', () => {
    expect(givesAway('zebrastreifen', 'Zebrastreifen')).toBe(true);
    expect(givesAway('Zebrastreifens', 'Zebrastreifen')).toBe(true);
    expect(givesAway('Haustür', 'Tür')).toBe(true);
    expect(givesAway('Ampel', 'Zebrastreifen')).toBe(false);
    expect(givesAway('Zebra', 'Zebrastreifen')).toBe(false);
  });

  it('validates intents', () => {
    expect(parseIntent({ a: 'clue', word: 'x' })).toEqual({ a: 'clue', word: 'x' });
    expect(parseIntent({ a: 'clue', word: 7 })).toBeNull();
    expect(parseIntent({ a: 'guess', word: 'x'.repeat(300) })).toBeNull();
    expect(parseIntent({ a: 'aim', id: 'b', lock: true })).toEqual({ a: 'aim', id: 'b', lock: true });
    expect(parseIntent({ a: 'aim', id: {}, lock: true })).toBeNull();
    expect(parseIntent({ a: 'end' })).toEqual({ a: 'end' });
    expect(parseIntent({ a: 'win' })).toBeNull();
  });

  it('picks the clueless player and the start uniformly', () => {
    const r = mulberry32(9);
    const count = new Map<string, number>();
    const starts = new Map<string, number>();
    for (let i = 0; i < 800; i++) {
      const h = AhnHost.create(P, CARD, r);
      count.set(h.secret!.clueless, (count.get(h.secret!.clueless) ?? 0) + 1);
      starts.set(h.state.seq[0], (starts.get(h.state.seq[0]) ?? 0) + 1);
    }
    for (const p of P) {
      expect(count.get(p)! / 800).toBeGreaterThan(0.17);
      expect(starts.get(p)! / 800).toBeGreaterThan(0.17);
    }
  });
});

describe('Ahnungslos: secrecy', () => {
  it('the public state names neither word nor clueless player until the vote has caught them', () => {
    // Same clues and votes, different clueless player: the public state must not tell them apart.
    const run = (clueless: string) => {
      const h = host(clueless);
      const states: AhnState[] = [structuredClone(h.state)];
      allClues(h);
      states.push(structuredClone(h.state));
      h.intent('a', aim('b'), 1, true);
      h.intent('b', aim('a'), 1, false);
      states.push(structuredClone(h.state));
      return states;
    };
    const one = run('c');
    const other = run('d');
    expect(one).toEqual(other);
    for (const s of one) {
      expect(JSON.stringify(s)).not.toMatch(SECRET);
      expect(s.clueless).toBeNull();
      expect(s.word).toBeNull();
    }
  });

  it('the word comes out at the end, the clueless player when caught', () => {
    const h = host('c');
    allClues(h);
    for (const p of P) h.intent(p, aim(p === 'c' ? 'a' : 'c'), 1, p === 'a');
    expect(h.state.phase).toBe('guess');
    expect(h.state.clueless).toBe('c');
    expect(JSON.stringify(h.state)).not.toMatch(SECRET);
    h.intent('c', { a: 'guess', word: 'Ampel' }, 2, false);
    expect(h.state.phase).toBe('done');
    expect(h.state.word).toBe(CARD.word);
  });
});

describe('Ahnungslos: clues', () => {
  it('only the player on turn gives a clue; then the next; after the laps the vote', () => {
    const h = host('c');
    expect(h.onTurn).toBe('a');
    expect(h.intent('b', clue('Ampel'), 0, false)).toBe(false);
    expect(h.intent('a', clue('zwei Wörter'), 0, true)).toBe(false);
    expect(h.intent('a', clue('Ampel'), 0, true)).toBe(true);
    expect(h.onTurn).toBe('b');
    expect(h.state.clues).toEqual([{ by: 'a', word: 'Ampel' }]);
    allClues(h);
    expect(h.state.phase).toBe('vote');
    expect(h.state.clues).toHaveLength(P.length * AHNUNG.laps);
    expect(h.state.clues.map((c) => c.by)).toEqual(turnOrder(P, 0));
  });

  it('those who know the word may not say it; the clueless one may (refusing would tell them)', () => {
    const h = host('b');
    expect(h.intent('a', clue('Zebrastreifen'), 0, true)).toBe(false);
    expect(h.intent('a', clue('Streifen'), 0, true)).toBe(true);
    expect(h.intent('b', clue('Zebrastreifen'), 0, false)).toBe(true);
  });

  it('a turn runs out and is skipped; pass skips too', () => {
    const h = host('c', P, 0);
    h.tick(AHNUNG.clueS * 1000 - 1);
    expect(h.state.clues).toEqual([]);
    h.tick(AHNUNG.clueS * 1000);
    expect(h.state.clues).toEqual([{ by: 'a', word: null }]);
    expect(h.onTurn).toBe('b');
    expect(h.state.deadline).toBe(AHNUNG.clueS * 2000);
    expect(h.pass(1)).toBe(true);
    expect(h.state.clues[1]).toEqual({ by: 'b', word: null });
  });

  it('the Schaffner fines only while the clues go round', () => {
    const h = host('c');
    expect(h.penalize('b', 1)).toBe(true);
    expect(h.state.scores.b).toBe(-1);
    allClues(h);
    expect(h.penalize('b', 1)).toBe(false);
    expect(h.state.scores.b).toBe(-1);
  });
});

describe('Ahnungslos: vote, guess, points', () => {
  const toVote = (clueless = 'c') => {
    const h = host(clueless);
    allClues(h);
    return h;
  };

  it('wrong person: the clueless one escapes', () => {
    const h = toVote('c');
    for (const [p, t] of [['a', 'b'], ['b', 'a'], ['c', 'b'], ['d', 'b']]) h.intent(p, aim(t), 0, p === 'a');
    expect(h.state.phase).toBe('done');
    expect(h.state.accused).toBe('b');
    expect(h.state.outcome).toBe('escaped');
    expect(h.state.scores).toEqual({ a: 0, b: 0, c: AHNUNG.escapePoints, d: 0 });
    expect(h.state.clueless).toBe('c');
    expect(h.state.votes).toEqual({ a: 'b', b: 'a', c: 'b', d: 'b' });
  });

  it('a tie: nobody is accused, the clueless one escapes even if in the tie', () => {
    const h = toVote('c');
    for (const [p, t] of [['a', 'c'], ['b', 'c'], ['c', 'a'], ['d', 'a']]) h.intent(p, aim(t), 0, p === 'a');
    expect(h.state.accused).toBeNull();
    expect(h.state.outcome).toBe('escaped');
    expect(h.state.scores.c).toBe(AHNUNG.escapePoints);
  });

  it('no votes at all: escaped', () => {
    const h = toVote('c');
    h.tick(Number.MAX_SAFE_INTEGER);
    expect(h.state.outcome).toBe('escaped');
  });

  it('the timer counts what people look at; the last aim wins', () => {
    const h = toVote('d');
    h.intent('a', aim('b', false), 0, true);
    h.intent('a', aim('d', false), 0, true);
    h.intent('b', aim('d', false), 0, false);
    expect(h.intent('c', aim('c'), 0, false)).toBe(false); // not yourself
    h.tick(h.state.deadline!);
    expect(h.state.votes).toEqual({ a: 'd', b: 'd', c: null, d: null });
    expect(h.state.phase).toBe('guess');
  });

  it('caught and guessed right: +2 for the clueless one; forms of the word count', () => {
    const h = toVote('c');
    for (const p of ['a', 'b', 'd']) h.intent(p, aim('c'), 0, p === 'a');
    h.intent('c', aim('a'), 0, false);
    expect(h.state.phase).toBe('guess');
    expect(h.intent('a', { a: 'guess', word: 'Zebrastreifen' }, 1, true)).toBe(false); // not theirs to guess
    h.intent('c', { a: 'guess', word: 'zebrastreifens' }, 1, false);
    expect(h.state.outcome).toBe('guessed');
    expect(h.state.guess).toBe('zebrastreifens');
    expect(h.state.scores).toEqual({ a: 0, b: 0, c: AHNUNG.guessPoints, d: 0 });
  });

  it('caught and wrong (or out of time): +1 for each of the others', () => {
    const h = toVote('c');
    for (const p of ['a', 'b', 'd']) h.intent(p, aim('c'), 0, p === 'a');
    h.tick(h.state.deadline!);
    expect(h.state.phase).toBe('guess');
    h.tick(h.state.deadline!);
    expect(h.state.outcome).toBe('caught');
    expect(h.state.guess).toBeNull();
    expect(h.state.scores).toEqual({ a: 1, b: 1, c: 0, d: 1 });
  });

  it('absent players do not hold up the vote', () => {
    const h = toVote('c');
    h.present = new Set(['a', 'b', 'c']);
    for (const [p, t] of [['a', 'c'], ['b', 'c'], ['c', 'a']]) h.intent(p, aim(t), 0, p === 'a');
    expect(h.state.phase).toBe('guess');
  });

  it('only the host ends a round; that tells everything, no points', () => {
    const h = host('c');
    expect(h.intent('b', { a: 'end' }, 0, false)).toBe(false);
    expect(h.intent('a', { a: 'end' }, 0, true)).toBe(true);
    expect(h.state).toMatchObject({ phase: 'done', outcome: 'aborted', why: 'ended', word: CARD.word, clueless: 'c' });
  });
});

describe('Ahnungslos: leaving, returning, new host', () => {
  it('replace follows the new id everywhere, the secret included', () => {
    const h = host('b');
    h.intent('a', clue('Ampel'), 0, true);
    h.intent('b', clue('Hmm'), 0, false);
    expect(h.replace('b', 'b2')).toBe(true);
    expect(h.state.players).toEqual(['a', 'b2', 'c', 'd']);
    expect(h.state.seq.filter((p) => p === 'b2')).toHaveLength(AHNUNG.laps);
    expect(h.state.clues[1].by).toBe('b2');
    expect(h.secret!.clueless).toBe('b2');
    allClues(h);
    for (const p of ['a', 'c', 'd']) h.intent(p, aim('b2'), 0, p === 'a');
    h.intent('b2', aim('a'), 0, false);
    expect(h.state.clueless).toBe('b2');
    expect(h.state.phase).toBe('guess');
  });

  it('someone else leaves: their turns to come go, the round goes on', () => {
    const h = host('c');
    h.intent('a', clue('Ampel'), 0, true); // b is on turn
    expect(h.removePlayer('b', 5)).toBe(true);
    expect(h.state.players).toEqual(['a', 'c', 'd']);
    expect(h.onTurn).toBe('c');
    expect(h.state.seq).toEqual(['a', 'c', 'd', 'a', 'c', 'd']);
    expect(h.state.deadline).toBe(5 + AHNUNG.clueS * 1000);
    expect(h.state.phase).toBe('clues');
  });

  it('the last one on turn leaves: straight to the vote', () => {
    const h = host('c');
    while (h.state.turn < h.state.seq.length - 1) h.intent(h.onTurn!, clue('Ampel'), 0, h.onTurn === 'a');
    expect(h.onTurn).toBe('d');
    h.removePlayer('d', 0);
    expect(h.state.phase).toBe('vote');
  });

  it('the clueless one leaves, or too few are left: aborted, no points', () => {
    const h = host('c');
    h.removePlayer('c', 0);
    expect(h.state).toMatchObject({ phase: 'done', outcome: 'aborted', why: 'gone' });
    const k = host('c', ['a', 'b', 'c']);
    k.removePlayer('a', 0);
    expect(k.state).toMatchObject({ phase: 'done', outcome: 'aborted', why: 'few' });
    expect(Object.values(k.state.scores).every((v) => v === 0)).toBe(true);
  });

  it('a new host cannot know the secret: a running round is aborted without telling it', () => {
    const h = host('c');
    h.intent('a', clue('Ampel'), 0, true);
    const n = AhnHost.fromState(structuredClone(h.state));
    expect(n.state).toMatchObject({ phase: 'done', outcome: 'aborted', why: 'host', word: null, clueless: null });
    expect(n.secret).toBeNull();
    // A finished round stays as it was.
    const k = host('c');
    k.intent('a', { a: 'end' }, 0, true);
    expect(AhnHost.fromState(structuredClone(k.state)).state).toEqual(k.state);
  });
});

describe('Ahnungslos: bots', () => {
  const r = mulberry32(4);
  it('clues: knowing the word, a forbidden word that does not give it away; clueless, someone else’s clue', () => {
    for (let i = 0; i < 50; i++) {
      const c = botClue('a', CARD.word, CARD.taboo, [], r);
      expect(cleanClue(c)).toBe(c);
      expect(givesAway(c, CARD.word)).toBe(false);
    }
    expect(['Ampel', 'Fußgänger', 'weiß', 'schwarz', 'Straße']).toContain(botClue('a', CARD.word, CARD.taboo, [], () => 0.1));
    const said = [
      { by: 'b', word: 'Ampel' },
      { by: 'a', word: 'Hmm' },
    ];
    expect(botClue('a', null, [], said, r)).toBe('Ampel');
    // Nothing said yet: something vague, still one word.
    expect(cleanClue(botClue('a', null, [], [], r))).toBeTruthy();
  });

  it('suspect the copycat, never themselves', () => {
    const clues = [
      { by: 'a', word: 'Ampel' },
      { by: 'b', word: 'Straße' },
      { by: 'c', word: 'Ampel' },
      { by: 'd', word: 'weiß' },
    ];
    let c = 0;
    for (let i = 0; i < 200; i++) {
      const s = botSuspect('a', P, clues, r);
      expect(s).not.toBe('a');
      if (s === 'c') c++;
    }
    expect(c / 200).toBeGreaterThan(0.7);
  });

  it('the caught bot guesses the card whose forbidden words match the clues', () => {
    // Clues from a built-in card's forbidden words lead back to it.
    const g = botGuess(
      [
        { by: 'a', word: 'Spieß' },
        { by: 'b', word: 'Fladenbrot' },
        { by: 'c', word: 'Soße' },
      ],
      ['normal'],
      () => 0,
    );
    expect(g).toBe('Döner');
    // Nothing matches: one of the clues.
    expect(botGuess([{ by: 'a', word: 'Qwxyz' }], ['normal'], () => 0)).toBe('Qwxyz');
  });
});

describe('Ahnungslos over the network', async () => {
  const { LocalGameRoom } = await import('../src/game/minigame');
  const { AhnungGame } = await import('../src/game/ahnungslos/game');
  const custom: WordCard = { id: 'c:t:1', deck: 'custom', word: CARD.word, taboo: CARD.taboo };
  const ids = ['a', 'b', 'c'];
  type Game = InstanceType<typeof AhnungGame>;
  const make = (who = ids, hostOf?: () => string) => {
    const room = new LocalGameRoom(who.map((id, i) => ({ id, seat: [0, 2, 1, 3][i], name: id.toUpperCase() })));
    const seen: Record<string, string[]> = Object.fromEntries(who.map((id) => [id, []]));
    const g: Record<string, Game> = {};
    for (const id of who) {
      const base = room.net(id);
      const net = hostOf ? { ...base, isHost: () => hostOf() === id, hostId: () => hostOf() } : base;
      // Everything that reaches this client, to prove what it never got.
      base.onMessage((t, d) => seen[id].push(`${t} ${JSON.stringify(d)}`));
      g[id] = new AhnungGame(net, { decks: () => ['custom'], cards: () => [custom], pidOf: () => undefined });
    }
    return { room, g, seen };
  };
  /** A started round whose clueless player is not the host (the host's code knows the secret anyway). */
  const startedWithGuestClueless = (who = ids) => {
    for (let i = 0; i < 60; i++) {
      const m = make(who);
      m.g.a.start();
      m.room.pump();
      const cl = who.find((id) => m.g[id].iAmClueless);
      if (cl && cl !== 'a') return { ...m, cl };
    }
    throw new Error('no round with a guest as clueless');
  };
  const clueAll = (g: Record<string, Game>, room: InstanceType<typeof LocalGameRoom>) => {
    for (let i = 0; g.a.state!.phase === 'clues' && i < 20; i++) {
      const on = g.a.onTurn!;
      expect(g[on].clue(`Hinweis${i}`)).toBeNull();
      room.pump();
    }
  };

  it('each client learns only its part: the word, or that it is clueless', () => {
    const { g, cl, seen, room } = startedWithGuestClueless();
    for (const id of ids) {
      expect(g[id].knowsRole).toBe(true);
      if (id === cl) {
        expect(g[id].myWord).toBeNull();
        expect(g[id].taboo).toEqual([]);
      } else {
        expect(g[id].myWord).toBe(CARD.word);
        expect(g[id].iAmClueless).toBe(false);
      }
    }
    clueAll(g, room);
    expect(g.b.state!.phase).toBe('vote');
    // Nothing that reached the clueless client, nor any public state, carries the word so far.
    expect(seen[cl].join('\n')).not.toMatch(SECRET);
    for (const id of ids) expect(JSON.stringify(g[id].state)).not.toMatch(SECRET);
  });

  it('a whole round: clues, vote by looking, caught, guess, reveal', () => {
    const { g, cl, room } = startedWithGuestClueless();
    clueAll(g, room);
    for (const id of ids) {
      expect(g[id].pickable()).toEqual(ids.filter((p) => p !== id));
      if (id === cl) g[id].lock(ids.find((p) => p !== cl)!);
      else {
        g[id].aim(cl);
        g[id].lock();
      }
    }
    room.pump();
    expect(g.a.state!.phase).toBe('guess');
    expect(g.b.state!.clueless).toBe(cl);
    expect(g[cl].guess('Zebrastreifen')).toBe(true);
    room.pump();
    for (const id of ids) {
      expect(g[id].state!.phase).toBe('done');
      expect(g[id].state!.outcome).toBe('guessed');
      expect(g[id].state!.word).toBe(CARD.word);
      expect(g[id].state!.scores[cl]).toBe(AHNUNG.guessPoints);
    }
  });

  it('refuses a clue that gives the word away before it goes out', () => {
    const { g, cl } = startedWithGuestClueless();
    const on = g.a.onTurn!;
    if (on !== cl) expect(g[on].clue('Zebrastreifen')).toBe('word');
    expect(g[on].clue('zwei Wörter')).toBe('words');
    const off = ids.find((p) => p !== on)!;
    expect(g[off].clue('Ampel')).toBe('turn');
  });

  it('needs three players', () => {
    const { g } = make(['a', 'b']);
    g.a.start();
    expect(g.a.state).toBeNull();
  });

  it('a reload: the returning player is told their part again and keeps their place', () => {
    const who = ['a', 'b', 'c', 'b2'];
    for (let i = 0; i < 60; i++) {
      const { room, g, seen } = make(who);
      const late = room.roster.pop()!;
      g.a.start();
      room.pump();
      const cl = ['a', 'b', 'c'].find((id) => g[id].iAmClueless)!;
      if (cl !== 'b') continue;
      // b reloads and comes back as b2.
      room.roster.splice(1, 1, { ...late, seat: 2 });
      g.a.rejoin('b', 'b2');
      room.pump();
      expect(g.b2.state!.players).toContain('b2');
      expect(g.b2.iAmClueless).toBe(true);
      expect(seen.b2.join('\n')).not.toMatch(SECRET);
      return;
    }
    throw new Error('b was never clueless');
  });

  it('a client without its part asks the host again', () => {
    const { g, room, cl } = startedWithGuestClueless();
    const other = ids.find((p) => p !== 'a' && p !== cl)!;
    (g[other] as unknown as { told: null }).told = null;
    expect(g[other].knowsRole).toBe(false);
    g[other].tick(performance.now() + AHNUNG.askAgainMs + 1);
    room.pump();
    room.pump();
    expect(g[other].myWord).toBe(CARD.word);
  });

  it('only the host deals: a part sent by someone else is ignored', () => {
    const { g, cl } = startedWithGuestClueless();
    g[cl].onMessage('ah:secret', { round: g[cl].state!.round, word: 'Falle', taboo: [] }, ids.find((p) => p !== 'a' && p !== cl)!);
    expect(g[cl].iAmClueless).toBe(true);
  });

  it('the host leaves mid-round: the new host aborts it without points', () => {
    let hostId = 'a';
    const { room, g } = make(ids, () => hostId);
    g.a.start();
    room.pump();
    room.roster.shift();
    hostId = 'b';
    g.b.tick(performance.now());
    room.pump();
    for (const id of ['b', 'c']) {
      expect(g[id].state).toMatchObject({ phase: 'done', outcome: 'aborted', why: 'host' });
      expect(Object.values(g[id].state!.scores).every((v) => v === 0)).toBe(true);
    }
  });
});
