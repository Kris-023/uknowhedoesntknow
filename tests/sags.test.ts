import { describe, expect, it } from 'vitest';
import { SAGS } from '../src/config';
import { SagsGame } from '../src/game/sagsanders/game';
import { guessersOf, parseIntent, SagsHost, watchersOf } from '../src/game/sagsanders/logic';
import { LocalGameRoom, Recovery, type Member } from '../src/game/minigame';
import { RoomLists } from '../src/game/roomLists';
import { normWord, parseCard } from '../src/words/custom';
import { builtinDeck, drawCard, wordPool } from '../src/words';
import { FALLBACK } from '../src/words/fallback';
import type { WordCard } from '../src/words/types';
import { FIXTURE, useFixture } from './fixtures/content';

const card = (word: string, by?: string): WordCard => ({ id: `t:${word}`, deck: by ? 'custom' : 'normal', word, taboo: ['x'], by: by ? { id: by, name: by } : undefined });

describe('word decks', () => {
  it('the public fallback: enough cards, 3–5 forbidden words each, none of them the word itself, no NSFW', () => {
    expect(FALLBACK.words.normal.length).toBeGreaterThanOrEqual(60);
    expect(FALLBACK.words.nsfw).toHaveLength(0);
    for (const [word, ...taboo] of FALLBACK.words.normal) {
      expect(taboo.length, word).toBeGreaterThanOrEqual(3);
      expect(taboo.length, word).toBeLessThanOrEqual(5);
      for (const t of taboo) expect(normWord(t), word).not.toBe(normWord(word));
    }
  });

  it('no word appears twice across the decks, and ids are unique', () => {
    for (const from of [FALLBACK, FIXTURE]) {
      const all = [...builtinDeck('normal', from), ...builtinDeck('nsfw', from)];
      expect(new Set(all.map((c) => normWord(c.word))).size).toBe(all.length);
      expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
    }
  });

  it('fallback cards have their own ids, so they never pass for cards of the sealed decks', () => {
    expect(builtinDeck('normal', FALLBACK).every((c) => c.id.startsWith('f:'))).toBe(true);
    expect(builtinDeck('normal', FIXTURE).every((c) => c.id.startsWith('n:'))).toBe(true);
    expect(builtinDeck('nsfw', FIXTURE).every((c) => c.id.startsWith('x:'))).toBe(true);
  });

  it('the pool joins the chosen decks and drops duplicate submissions', () => {
    const normal = builtinDeck('normal', FIXTURE);
    const dup = { ...card(normal[0].word.toUpperCase(), 'p1') };
    const pool = wordPool(['normal', 'custom'], [dup, card('Eigenes Wort', 'p1')], FIXTURE);
    expect(pool.length).toBe(normal.length + 1);
    expect(wordPool(['nsfw'], [card('Eigenes Wort', 'p1')], FIXTURE).length).toBe(builtinDeck('nsfw', FIXTURE).length);
    // Locked: NSFW is empty, the normal deck is the fallback.
    expect(wordPool(['nsfw'], [], FALLBACK)).toHaveLength(0);
    expect(wordPool(['normal'], [], FALLBACK)).toHaveLength(FALLBACK.words.normal.length);
  });

  it('unlocked mid-session: the next draw sees the new decks', () => {
    const before = wordPool(['normal', 'nsfw'], []);
    expect(before.every((c) => c.id.startsWith('f:'))).toBe(true);
    const undo = useFixture();
    try {
      const after = wordPool(['normal', 'nsfw'], []);
      expect(after.length).toBe(FIXTURE.words.normal.length + FIXTURE.words.nsfw.length);
      expect(after.some((c) => c.deck === 'nsfw')).toBe(true);
    } finally {
      undo();
    }
  });

  it('skips used cards and the guessers’ own submissions while anything else is left', () => {
    const pool = [card('A'), card('B', 'g'), card('C')];
    expect(drawCard(pool, new Set(['t:A']), new Set(['g']), () => 0)?.word).toBe('C');
    expect(drawCard(pool, new Set(['t:A', 't:C']), new Set(['g']), () => 0)?.word).toBe('B');
  });

  it('parseCard rejects junk and cleans forbidden words', () => {
    expect(parseCard({ id: 'c:1', word: '' })).toBeNull();
    expect(parseCard({ id: 'c:1', word: 'x'.repeat(41) })).toBeNull();
    expect(parseCard({ id: 'c:1', word: 'Hund', taboo: ['hund', ' Bellen ', 5] })?.taboo).toEqual(['Bellen']);
  });
});

describe("Sag's anders rules", () => {
  it('four players make two alternating teams; fewer play free for all', () => {
    const t = new SagsHost(['a', 'b', 'c', 'd']).state;
    expect(t.mode).toBe('teams');
    expect(t.teams).toEqual([
      ['a', 'c'],
      ['b', 'd'],
    ]);
    expect(guessersOf(t, 'a')).toEqual(['c']);
    expect(watchersOf(t, 'a')).toEqual(['b', 'd']);
    expect(new SagsHost(['a', 'b', 'c', 'd'], {}, 1, 60, false).state.mode).toBe('ffa');
    expect(new SagsHost(['a', 'b', 'c'], {}, 1, 60, true).state.mode).toBe('ffa');
    const f = new SagsHost(['a', 'b', 'c']).state;
    expect(f.mode).toBe('ffa');
    expect(guessersOf(f, 'a')).toEqual(['b', 'c']);
    expect(watchersOf(f, 'a')).toEqual([]);
  });

  it('free for all: guesser 2, explainer 1; a challenge takes it back and costs the explainer', () => {
    const h = new SagsHost(['a', 'b', 'c']);
    h.intent('a', { a: 'begin' }, 0, true);
    const no = h.state.cardNo;
    expect(h.intent('a', { a: 'got', no, card: card('Hund'), by: 'a' }, 1, true)).toBe(false);
    h.intent('a', { a: 'got', no, card: card('Hund'), by: 'b' }, 1, true);
    expect(h.state.scores).toEqual({ a: SAGS.ffaExplainer, b: SAGS.ffaGuesser, c: 0 });
    // A late click on the same card does nothing.
    expect(h.intent('a', { a: 'got', no, card: card('Hund'), by: 'c' }, 2, true)).toBe(false);
    expect(h.intent('a', { a: 'challenge', no }, 2, true)).toBe(false);
    h.intent('c', { a: 'challenge', no }, 2, false);
    expect(h.state.scores).toEqual({ a: -SAGS.ffaFoul, b: 0, c: 0 });
    expect(h.state.log[0]).toMatchObject({ result: 'foul', was: 'got', foulBy: 'c' });
    expect(h.intent('b', { a: 'challenge', no }, 3, false)).toBe(false);
  });

  it('challenges close after the window', () => {
    const h = new SagsHost(['a', 'b']);
    h.intent('a', { a: 'begin' }, 0, true);
    const no = h.state.cardNo;
    h.intent('a', { a: 'skip', no, card: card('Hund') }, 0, true);
    expect(h.intent('b', { a: 'challenge', no }, SAGS.challengeS * 1000 + 1, false)).toBe(false);
  });

  it('teams: a guessed word scores for the team, only the other team can call a foul', () => {
    const h = new SagsHost(['a', 'b', 'c', 'd']);
    h.intent('a', { a: 'begin' }, 0, true);
    let no = h.state.cardNo;
    h.intent('a', { a: 'got', no, card: card('Hund'), by: null }, 1, true);
    expect(h.state.scores.a).toBe(SAGS.teamGot);
    no = h.state.cardNo;
    expect(h.intent('c', { a: 'foul', no, card: card('Katze') }, 2, false)).toBe(false);
    h.intent('b', { a: 'foul', no, card: card('Katze') }, 2, false);
    expect(h.state.scores.b).toBe(SAGS.teamFoul);
    expect(h.state.log.map((p) => p.result)).toEqual(['got', 'foul']);
  });

  it('turns rotate at the deadline and the round ends after everyone explained', () => {
    const h = new SagsHost(['a', 'b'], {}, 1, 10);
    const seen: string[] = [];
    let t = 0;
    while (h.state.phase !== 'done') {
      seen.push(h.state.explainer!);
      h.intent(h.state.explainer!, { a: 'begin' }, t, false);
      t += 10_001;
      h.tick(t);
    }
    expect(seen).toEqual(['a', 'b', 'a', 'b'].slice(0, 2 * SAGS.turnsEach));
  });

  it('only the explainer begins, and not twice', () => {
    const h = new SagsHost(['a', 'b']);
    expect(h.intent('b', { a: 'begin' }, 0, false)).toBe(false);
    expect(h.intent('a', { a: 'begin' }, 0, true)).toBe(true);
    expect(h.intent('a', { a: 'begin' }, 0, true)).toBe(false);
  });

  it('someone leaving mid-turn hands the turn on; an empty team ends the round', () => {
    const h = new SagsHost(['a', 'b', 'c']);
    h.intent('a', { a: 'begin' }, 0, true);
    h.removePlayer('a');
    expect(h.state.phase).toBe('ready');
    expect(h.state.explainer).toBe('b');
    const t = new SagsHost(['a', 'b', 'c', 'd']);
    t.removePlayer('b');
    t.removePlayer('d');
    expect(t.state.phase).toBe('done');
  });

  it('rejects malformed intents', () => {
    expect(parseIntent({ a: 'got', no: 1.5, card: card('x') })).toBeNull();
    expect(parseIntent({ a: 'got', no: 1, card: { id: 'x' } })).toBeNull();
    expect(parseIntent({ a: 'begin' })).toEqual({ a: 'begin' });
  });
});

describe("Sag's anders over the network", () => {
  const room = (n: number) => {
    const members: Member[] = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, seat: [2, 0, 1, 3][i], name: `P${i}` }));
    const r = new LocalGameRoom(members);
    const decks = () => ['normal', 'custom'] as const;
    // Own words travel through the shared room lists, one instance per client like in main.ts.
    const lists = members.map(
      (m) => new RoomLists(r.net(m.id), () => ({ pid: `pid-${m.id}`, words: [card(`Wort von ${m.id}`, `pid-${m.id}`)], zeig: [], fragen: [], kategorien: [] }), () => true),
    );
    const games = members.map((m, i) => new SagsGame(r.net(m.id), { decks, turnS: () => 60, teams: () => true, cards: () => lists[i].cards(), pidOf: (id) => lists[i].pidOf(id) }));
    const run = () => {
      for (let k = 0; k < 4; k++) {
        lists.forEach((l) => l.tick());
        games.forEach((g) => g.tick(0));
        r.pump();
      }
    };
    return { games, lists, run };
  };

  it('teams: the card reaches only the other team, never the teammate who guesses', () => {
    const { games, run } = room(4);
    games[0].start();
    run();
    const s = games[0].state!;
    const explainer = games.find((g) => g.selfId === s.explainer)!;
    explainer.begin();
    run();
    expect(explainer.hand).not.toBeNull();
    const word = explainer.hand!.card.word;
    for (const g of games) {
      if (g === explainer) continue;
      const watching = watchersOf(g.state!, explainer.selfId).includes(g.selfId);
      expect(g.seen?.card.word ?? null, g.selfId).toBe(watching ? word : null);
    }
    // The other team calls a foul: the explainer moves on to a new card.
    const watcher = games.find((g) => g.seen)!;
    watcher.foul();
    run();
    expect(explainer.state!.log[0].result).toBe('foul');
    expect(explainer.hand!.no).toBe(explainer.state!.cardNo);
  });

  it('free for all: nobody else gets the card while it is explained', () => {
    const { games, lists, run } = room(3);
    games[0].start();
    run();
    const explainer = games.find((g) => g.selfId === games[0].state!.explainer)!;
    explainer.begin();
    run();
    expect(explainer.hand).not.toBeNull();
    for (const g of games) if (g !== explainer) expect(g.seen).toBeNull();
    // Submissions from the room are in the explainer's pool, but not the guessers' own ones first.
    expect(lists[games.indexOf(explainer)].cards().length).toBe(3);
  });
});

describe("Sag's anders after a reload", () => {
  const ROOM = ['p0', 'p1', 'p2', 'p3'];
  const seatOf = (id: string) => [1, 2, 0, 3][ROOM.indexOf(id.slice(0, 2))];
  const opts = { decks: () => ['normal' as const], turnS: () => 60, teams: () => true, cards: () => [], pidOf: () => undefined };
  const setup = () => {
    // Every member also has a "b" twin: the same person after a reload (new id, same seat), not in the room yet.
    const room = new LocalGameRoom([...ROOM, ...ROOM.map((id) => `${id}b`)].map((id) => ({ id, seat: seatOf(id), name: id.toUpperCase() })));
    room.roster.length = ROOM.length;
    let host = 'p0';
    const make = (id: string) => new SagsGame({ ...room.net(id), isHost: () => host === id, hostId: () => host }, opts);
    const games: Record<string, SagsGame> = Object.fromEntries(ROOM.map((id) => [id, make(id)]));
    let now = 1000;
    const run = (ms = 0) => {
      now += ms;
      for (let k = 0; k < 4; k++) {
        Object.values(games).forEach((g) => g.tick(now));
        room.pump();
      }
    };
    /** `id` reloads: gone from the room, a new client (fresh game) comes back with the twin id and the same seat. */
    const reload = (id: string) => {
      const twin = `${id}b`;
      room.roster.splice(
        room.roster.findIndex((m) => m.id === id),
        1,
        { id: twin, seat: seatOf(id), name: id.toUpperCase() },
      );
      delete games[id];
      games[twin] = make(twin);
      return twin;
    };
    return { room, games, run, reload, make, host: (id?: string) => (id ? (host = id) : games[host]) };
  };

  /** A started round: p1 explains (table order), p2 and p3 watch for fouls, p0 guesses with p1. */
  const turn = () => {
    const t = setup();
    t.games.p0.start();
    t.run();
    t.games.p1.begin();
    t.run();
    expect(t.games.p0.state).toMatchObject({ phase: 'turn', explainer: 'p1' });
    expect(t.games.p1.hand).not.toBeNull();
    expect(t.games.p2.seen?.card.word).toBe(t.games.p1.hand!.card.word);
    return t;
  };

  it('a watcher who reloads gets the current card back from the explainer, and stops asking', () => {
    const t = turn();
    const word = t.games.p1.hand!.card.word;
    const w = t.reload('p3');
    (t.host() as SagsGame).rejoin('p3', w);
    t.run();
    expect(t.games[w].state?.players).toContain(w);
    expect(t.games[w].seen).toBeNull();
    // The card is asked for after a short grace, not at once.
    t.run(500);
    expect(t.games[w].seen).toBeNull();
    t.run(2000);
    expect(t.games[w].seen?.card.word).toBe(word);
    expect(t.games[w].seen?.no).toBe(t.games[w].state!.cardNo);
    expect(t.games[w]['rec'].pending('sa:card')).toBe(false);
    // And can call a foul on it.
    t.games[w].foul();
    t.run();
    expect(t.games.p1.state!.log[0]).toMatchObject({ result: 'foul', foulBy: w });
  });

  it('the guessing teammate gets nothing, however they ask', () => {
    const t = turn();
    let got: unknown = 'nothing';
    const peek = new Recovery(t.room.net('p0'));
    peek.ask('sa:card', { no: t.games.p1.state!.cardNo }, { onReply: (d) => (got = d) });
    t.run();
    expect(got).toBe('nothing');
    expect(t.games.p0.seen).toBeNull();
  });

  it('a watcher keeps asking until the card turns up', () => {
    const t = turn();
    const w = t.reload('p3');
    (t.host() as SagsGame).rejoin('p3', w);
    // The explainer can't answer for a while: the asks go unanswered.
    const rec = t.games.p1['rec'];
    const answer = rec['answers'].get('sa:card')!;
    rec['answers'].delete('sa:card');
    t.run();
    t.run(2000);
    t.run(2000);
    expect(t.games[w].seen).toBeNull();
    expect(t.games[w]['rec'].pending('sa:card')).toBe(true);
    rec.answer('sa:card', answer);
    t.run(2000);
    expect(t.games[w].seen).not.toBeNull();
  });

  it('an explainer who reloads draws a new card for the same turn and the watchers follow', () => {
    const t = turn();
    const e = t.reload('p1');
    (t.host() as SagsGame).rejoin('p1', e);
    t.run();
    expect(t.games.p0.state).toMatchObject({ phase: 'turn', explainer: e });
    const hand = t.games[e].hand!;
    expect(hand.no).toBe(t.games[e].state!.cardNo);
    for (const id of ['p2', 'p3']) expect(t.games[id].seen?.card.word, id).toBe(hand.card.word);
    expect(t.games.p0.seen).toBeNull();
    // The turn goes on: a guessed word scores for the team and the next card comes.
    t.games[e].got(null);
    t.run();
    expect(t.games.p0.state!.scores[e]).toBe(SAGS.teamGot);
    expect(t.games[e].hand!.no).toBe(t.games[e].state!.cardNo);
    expect(t.games.p2.seen?.no).toBe(t.games[e].state!.cardNo);
  });

  it('a host who reloads mid-round: the next one takes over from the public state and the round continues', () => {
    const t = turn();
    t.games.p1.got(null);
    t.run();
    const before = t.games.p2.state!;
    expect(before.scores.p1).toBe(SAGS.teamGot);
    // p0 (host) leaves; p2 is the longest-present player now.
    t.room.roster.splice(0, 1);
    t.host('p2');
    delete t.games.p0;
    t.run();
    const after = t.games.p2.state!;
    expect(after).toMatchObject({ round: before.round, phase: 'turn', explainer: 'p1', cardNo: before.cardNo });
    expect(after.scores.p1).toBe(SAGS.teamGot);
    expect(t.games.p3.seen?.no).toBe(after.cardNo);
    // p0 comes back as a new client; the new host keeps their place.
    t.room.roster.push({ id: 'p0b', seat: 1, name: 'P0' });
    t.games.p0b = t.make('p0b');
    t.games.p2.rejoin('p0', 'p0b');
    t.run();
    expect(t.games.p0b.state?.players).toContain('p0b');
    expect(t.games.p0b.state?.players).not.toContain('p0');
    // The round goes on under the new host: a guessed word, the next card, a foul from the other team.
    t.games.p1.got(null);
    t.run();
    expect(t.games.p2.state!.scores.p1).toBe(SAGS.teamGot * 2);
    t.games.p3.foul();
    t.run();
    expect(t.games.p1.state!.log.map((p) => p.result)).toEqual(['got', 'got', 'foul']);
    expect(t.games.p1.hand!.no).toBe(t.games.p1.state!.cardNo);
  });
});
