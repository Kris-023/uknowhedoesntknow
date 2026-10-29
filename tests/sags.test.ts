import { describe, expect, it } from 'vitest';
import { SAGS } from '../src/config';
import { SagsGame } from '../src/game/sagsanders/game';
import { guessersOf, parseIntent, SagsHost, watchersOf } from '../src/game/sagsanders/logic';
import { LocalGameRoom, type Member } from '../src/game/minigame';
import { normWord, parseCard } from '../src/words/custom';
import { NORMAL } from '../src/words/decks/normal';
import { NSFW } from '../src/words/decks/nsfw';
import { builtinDeck, drawCard, wordPool } from '../src/words';
import type { WordCard } from '../src/words/types';

const card = (word: string, by?: string): WordCard => ({ id: `t:${word}`, deck: by ? 'custom' : 'normal', word, taboo: ['x'], by: by ? { id: by, name: by } : undefined });

describe('word decks', () => {
  it('every built-in card has 4–5 forbidden words, none of them the word itself', () => {
    for (const [word, ...taboo] of [...NORMAL, ...NSFW]) {
      expect(taboo.length, word).toBeGreaterThanOrEqual(4);
      expect(taboo.length, word).toBeLessThanOrEqual(5);
      for (const t of taboo) expect(normWord(t), word).not.toBe(normWord(word));
    }
  });

  it('no word appears twice across the decks, and ids are unique', () => {
    const all = [...builtinDeck('normal'), ...builtinDeck('nsfw')];
    expect(new Set(all.map((c) => normWord(c.word))).size).toBe(all.length);
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  });

  it('the pool joins the chosen decks and drops duplicate submissions', () => {
    const normal = builtinDeck('normal');
    const dup = { ...card(normal[0].word.toUpperCase(), 'p1') };
    const pool = wordPool(['normal', 'custom'], [dup, card('Eigenes Wort', 'p1')]);
    expect(pool.length).toBe(normal.length + 1);
    expect(wordPool(['nsfw'], [card('Eigenes Wort', 'p1')]).length).toBe(builtinDeck('nsfw').length);
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
    const members: Member[] = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, seat: [0, 2, 1, 3][i], name: `P${i}` }));
    const r = new LocalGameRoom(members);
    const opts = { decks: () => ['normal', 'custom'] as const, turnS: () => 60, teams: () => true };
    const games = members.map((m) => new SagsGame(r.net(m.id), opts, () => ({ pid: `pid-${m.id}`, cards: [card(`Wort von ${m.id}`, `pid-${m.id}`)] })));
    const run = () => {
      for (let k = 0; k < 4; k++) {
        games.forEach((g) => g.tick(0));
        r.pump();
      }
    };
    return { games, run };
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
    const { games, run } = room(3);
    games[0].start();
    run();
    const explainer = games.find((g) => g.selfId === games[0].state!.explainer)!;
    explainer.begin();
    run();
    expect(explainer.hand).not.toBeNull();
    for (const g of games) if (g !== explainer) expect(g.seen).toBeNull();
    // Submissions from the room are in the explainer's pool, but not the guessers' own ones first.
    expect(explainer.roomCards().length).toBe(3);
  });
});
