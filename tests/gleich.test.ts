import { describe, expect, it } from 'vitest';
import { GLEICH } from '../src/config';
import { mulberry32 } from '../src/core/rng';
import { botWord } from '../src/game/gleich/bots';
import {
  biggestGroup,
  cleanWord,
  commitOf,
  drawQuestions,
  GleichHost,
  groupsOf,
  matches,
  newSalt,
  normalize,
  parseIntent,
  verifyReveal,
} from '../src/game/gleich/logic';
import { QUESTIONS_NORMAL, QUESTIONS_NSFW } from '../src/words/questions';

describe('Gleich gedacht: matching', () => {
  it('normalizes case, articles, umlauts and punctuation', () => {
    expect(normalize('  Das   Auto! ')).toBe('auto');
    expect(normalize('Einen Apfel')).toBe('apfel');
    expect(normalize('The Cat')).toBe('cat');
    expect(normalize('Straße')).toBe('strasse');
    expect(normalize('Häuser')).toBe('haeuser');
    expect(normalize('Café')).toBe('cafe');
    // An article on its own stays a word.
    expect(normalize('Die')).toBe('die');
  });

  it.each([
    ['Auto', 'auto'],
    ['das Auto', 'Auto'],
    ['Häuser', 'Haeuser'],
    ['Katze', 'Katzen'],
    ['Strasse', 'Straße'],
    ['Banane', 'Bananr'],
    ['Haus', 'Hause'],
    ['Hund', 'Hunde'],
    ['Fuß ball', 'Fussball'],
    ['Lied', 'Lieder'],
    ['Auto.', 'Auto'],
  ])('%s = %s', (a, b) => {
    expect(matches(a, b)).toBe(true);
    expect(matches(b, a)).toBe(true);
  });

  it.each([
    // Short words get no typo forgiveness.
    ['Hund', 'Mund'],
    ['Bier', 'Bär'],
    ['Tee', 'Tees'],
    ['Katze', 'Hund'],
    ['Banane', 'Banal'],
    ['Haus', 'Maus'],
    ['', 'Auto'],
    ['!!!', '???'],
  ])('%s != %s', (a, b) => {
    expect(matches(a, b)).toBe(false);
  });

  it('groups chains and finds the biggest group; players without a word never match', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const words = { a: 'Katze', b: 'katzen', c: null, d: 'Hund' };
    expect(groupsOf(words, ids)).toEqual([['a', 'b'], ['d']]);
    expect(biggestGroup(words, ids)).toEqual(['a', 'b']);
    expect(biggestGroup({ a: null, b: null }, ['a', 'b'])).toEqual([]);
    // Two nulls are not "equal".
    expect(groupsOf({ a: null, b: null }, ['a', 'b'])).toEqual([]);
  });

  it('cleans words from strangers', () => {
    expect(cleanWord('  Zwei   Wörter\n')).toBe('Zwei Wörter');
    expect(cleanWord('a\u0000b\u0007c')).toBe('a b c');
    expect([...cleanWord('x'.repeat(100))!]).toHaveLength(GLEICH.maxWordLen);
    expect(cleanWord('   ')).toBeNull();
    expect(cleanWord(42)).toBeNull();
    // Emoji count as one character, not two.
    expect([...cleanWord('😀'.repeat(40))!]).toHaveLength(GLEICH.maxWordLen);
  });
});

describe('Gleich gedacht: commit and reveal', () => {
  it('accepts the locked word and refuses a changed word or salt', async () => {
    const salt = newSalt();
    const commit = await commitOf('Auto', salt);
    expect(commit).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyReveal(commit, 'Auto', salt)).toBe(true);
    expect(await verifyReveal(commit, 'Auto2', salt)).toBe(false);
    expect(await verifyReveal(commit, 'Auto', newSalt())).toBe(false);
    expect(await verifyReveal(undefined, 'Auto', salt)).toBe(false);
  });

  it('refuses malformed reveals', async () => {
    const salt = newSalt();
    const commit = await commitOf('Auto', salt);
    expect(await verifyReveal(commit, 'Auto', 'nothex')).toBe(false);
    expect(await verifyReveal(commit, 7, salt)).toBe(false);
    expect(await verifyReveal(commit, 'Auto', 7)).toBe(false);
    // Not in the cleaned form, so it can't be what was locked.
    expect(await verifyReveal(commit, ' Auto', salt)).toBe(false);
  });

  it('a commitment hides the word: same word, different salt, different hash', async () => {
    expect(await commitOf('Auto', newSalt())).not.toBe(await commitOf('Auto', newSalt()));
  });

  it('validates intents', () => {
    expect(parseIntent({ a: 'lock', c: 'x' })).toBeNull();
    expect(parseIntent({ a: 'lock', c: 'a'.repeat(64) })).toEqual({ a: 'lock', c: 'a'.repeat(64) });
    expect(parseIntent({ a: 'vote', v: 'yes' })).toBeNull();
    expect(parseIntent({ a: 'vote', v: false })).toEqual({ a: 'vote', v: false });
    expect(parseIntent({ a: 'hack' })).toBeNull();
    expect(parseIntent(null)).toBeNull();
  });
});

const P = ['a', 'b', 'c'];
const C = (id: string) => ({ a: 'lock' as const, c: id.repeat(64).slice(0, 64) });
/** Everyone locks and reveals the given words, at `t`. */
function play(h: GleichHost, words: Record<string, string | null>, t = 0): void {
  for (const p of h.state.players) if (words[p] !== null && words[p] !== undefined) h.intent(p, C('a'), t, p === 'a');
  for (const p of h.state.players) if (words[p]) h.reveal(p, words[p]!, t);
}

describe('Gleich gedacht: rules', () => {
  it('draws a different question for everyone', () => {
    const q = drawQuestions(['a', 'b', 'c', 'd'], QUESTIONS_NORMAL, mulberry32(1));
    expect(new Set(Object.values(q)).size).toBe(4);
    for (const v of Object.values(q)) expect(QUESTIONS_NORMAL).toContain(v);
    // Questions of an earlier round are avoided while enough are left.
    const avoid = new Set(QUESTIONS_NORMAL.slice(0, QUESTIONS_NORMAL.length - 4));
    const again = drawQuestions(['a', 'b', 'c', 'd'], QUESTIONS_NORMAL, mulberry32(2), avoid);
    for (const v of Object.values(again)) expect(avoid.has(v)).toBe(false);
  });

  it('has enough questions, and the crude ones are kept apart', () => {
    expect(QUESTIONS_NORMAL.length).toBeGreaterThanOrEqual(55);
    expect(QUESTIONS_NSFW.length).toBeGreaterThanOrEqual(20);
    expect(new Set([...QUESTIONS_NORMAL, ...QUESTIONS_NSFW]).size).toBe(QUESTIONS_NORMAL.length + QUESTIONS_NSFW.length);
  });

  it('writing ends when everybody has locked; only commitments are public', () => {
    const h = new GleichHost(P, {}, 1, 0);
    expect(h.state.phase).toBe('write');
    expect(h.state.tryNo).toBe(1);
    h.intent('a', C('a'), 1, true);
    h.intent('b', C('b'), 1, false);
    expect(h.state.phase).toBe('write');
    h.intent('c', C('c'), 1, false);
    expect(h.state.phase).toBe('reveal');
    expect(h.state.words).toBeNull();
    expect(Object.keys(h.state.commits).sort()).toEqual(P);
  });

  it('a timer that runs out moves on; those who did not lock show as nothing', () => {
    const h = new GleichHost(P, {}, 1, 0);
    h.intent('a', C('a'), 1, true);
    expect(h.tick(GLEICH.writeS * 1000 - 1)).toBe(false);
    expect(h.tick(GLEICH.writeS * 1000)).toBe(true);
    expect(h.state.phase).toBe('reveal');
    h.reveal('a', 'Auto', GLEICH.writeS * 1000);
    // Nobody else locked: nothing to wait for.
    expect(h.state.words).toEqual({ a: 'Auto', b: null, c: null });
    expect(h.state.solved).toBe(false);
  });

  it('judges once the revealed words are in, or when the collecting time is up', () => {
    const h = new GleichHost(P, {}, 1, 0);
    P.forEach((p) => h.intent(p, C(p), 1, p === 'a'));
    h.reveal('a', 'Auto', 2);
    h.reveal('b', 'Auto', 2);
    expect(h.state.words).toBeNull();
    // c never reveals (message lost, or a mismatch): after the collecting window the others count.
    h.tick(1 + GLEICH.collectS * 1000);
    expect(h.state.words).toEqual({ a: 'Auto', b: 'Auto', c: null });
    expect(h.state.group).toEqual(['a', 'b']);
    expect(h.state.of).toBe(3);
    expect(h.state.solved).toBe(false);
  });

  it('solves automatically when all words match, and pays everyone by the try', () => {
    const h = new GleichHost(P, { a: 5 }, 1, 0);
    play(h, { a: 'Auto', b: 'das auto', c: 'Autos' });
    expect(h.state.phase).toBe('done');
    expect(h.state.solved).toBe(true);
    expect(h.state.solvedTry).toBe(1);
    expect(h.state.scores).toEqual({ a: 5 + GLEICH.points[0], b: GLEICH.points[0], c: GLEICH.points[0] });
    expect(h.state.history).toHaveLength(1);
  });

  it('keeps trying with the last words in view; later tries pay less', () => {
    const h = new GleichHost(P, {}, 1, 0);
    play(h, { a: 'Katze', b: 'Hund', c: 'Maus' });
    expect(h.state.phase).toBe('reveal');
    expect(h.state.group).toEqual([]);
    P.forEach((p) => h.intent(p, { a: 'ready' }, 5, p === 'a'));
    expect(h.state.tryNo).toBe(2);
    expect(h.state.phase).toBe('write');
    expect(h.state.history).toEqual([{ a: 'Katze', b: 'Hund', c: 'Maus' }]);
    expect(h.state.commits).toEqual({});
    expect(h.state.words).toBeNull();
    play(h, { a: 'Tier', b: 'Tier', c: 'tiere' }, 6);
    expect(h.state.solvedTry).toBe(2);
    expect(h.state.scores.b).toBe(GLEICH.points[1]);
    expect(h.state.history).toHaveLength(2);
  });

  it('the reveal screen ends by itself after revealS', () => {
    const h = new GleichHost(P, {}, 1, 0);
    play(h, { a: 'Katze', b: 'Hund', c: 'Maus' }, 10);
    h.intent('a', { a: 'ready' }, 11, true);
    expect(h.tick(10 + GLEICH.revealS * 1000 - 1)).toBe(false);
    expect(h.tick(10 + GLEICH.revealS * 1000)).toBe(true);
    expect(h.state.tryNo).toBe(2);
  });

  it('is over after the last try with no points', () => {
    const h = new GleichHost(P, {}, 1, 0);
    for (let n = 1; n <= GLEICH.maxTries; n++) {
      expect(h.state.tryNo).toBe(n);
      play(h, { a: 'Katze', b: 'Hund', c: 'Maus' }, n * 1000);
      P.forEach((p) => h.intent(p, { a: 'ready' }, n * 1000 + 1, p === 'a'));
    }
    expect(h.state.phase).toBe('done');
    expect(h.state.solved).toBe(false);
    expect(h.state.solvedTry).toBeNull();
    expect(h.state.scores).toEqual({ a: 0, b: 0, c: 0 });
    expect(h.state.history).toHaveLength(GLEICH.maxTries);
  });

  it('points table covers every try', () => {
    expect(GLEICH.points).toHaveLength(GLEICH.maxTries);
    for (let i = 1; i < GLEICH.points.length; i++) expect(GLEICH.points[i]).toBeLessThanOrEqual(GLEICH.points[i - 1]);
  });

  it('may be locked again until the writing is over (changed my mind)', () => {
    const h = new GleichHost(P, {}, 1, 0);
    h.intent('a', C('a'), 1, true);
    h.intent('a', C('b'), 2, true);
    expect(h.state.commits.a).toBe('b'.repeat(64));
    P.forEach((p) => h.intent(p, C(p), 3, p === 'a'));
    expect(h.state.phase).toBe('reveal');
    expect(h.intent('a', C('c'), 4, true)).toBe(false);
  });

  it('refuses reveals nobody committed to, and strangers', () => {
    const h = new GleichHost(P, {}, 1, 0);
    h.intent('a', C('a'), 1, true);
    h.intent('b', C('b'), 1, false);
    h.tick(GLEICH.writeS * 1000);
    expect(h.reveal('c', 'Auto', 1)).toBe(false);
    expect(h.reveal('x', 'Auto', 1)).toBe(false);
    expect(h.intent('x', C('x'), 1, false)).toBe(false);
  });

  it('a vote with a majority of yes solves it; ties and silence do not', () => {
    const run = (votes: [string, boolean][]) => {
      const h = new GleichHost(P, {}, 1, 0);
      play(h, { a: 'Kaffee', b: 'Tasse', c: 'Café' }, 10);
      expect(h.state.solved).toBe(false);
      expect(h.intent('a', { a: 'call' }, 11, true)).toBe(true);
      // Only once per try.
      for (const [p, v] of votes) h.intent(p, { a: 'vote', v }, 12, p === 'a');
      return h;
    };
    const win = run([['a', true], ['b', false], ['c', true]]);
    expect(win.state.phase).toBe('done');
    expect(win.state.solvedTry).toBe(1);
    expect(win.state.scores.c).toBe(GLEICH.points[0]);

    const lose = run([['a', true], ['b', false], ['c', false]]);
    expect(lose.state.phase).toBe('reveal');
    expect(lose.state.last).toEqual({ result: 'no', yes: 1, no: 2 });
    expect(lose.intent('b', { a: 'call' }, 13, false)).toBe(false);

    // Two voters, one yes, one no: a tie is a no. The vote waits for the third until its deadline.
    const tie = run([['a', true], ['b', false]]);
    expect(tie.state.vote?.voters).toEqual(['a', 'b']);
    tie.tick(12 + GLEICH.voteS * 1000);
    expect(tie.state.last?.result).toBe('no');
    expect(tie.state.phase).toBe('reveal');
  });

  it('secret votes: nobody learns who voted what', () => {
    const h = new GleichHost(P, {}, 1, 0);
    play(h, { a: 'Kaffee', b: 'Tasse', c: 'Café' }, 10);
    h.intent('a', { a: 'call' }, 11, true);
    h.intent('b', { a: 'vote', v: true }, 12, false);
    expect(JSON.stringify(h.state.vote)).not.toContain('true');
    expect(h.intent('b', { a: 'vote', v: false }, 12, false)).toBe(false);
  });

  it('nobody can start a vote when it is solved, before the words are shown, or twice', () => {
    const h = new GleichHost(P, {}, 1, 0);
    expect(h.intent('a', { a: 'call' }, 1, true)).toBe(false);
    play(h, { a: 'Kaffee', b: 'Tasse', c: 'Café' }, 10);
    expect(h.intent('a', { a: 'call' }, 11, true)).toBe(true);
    expect(h.intent('b', { a: 'call' }, 11, false)).toBe(false);
  });

  it('after a lost vote the others get time to read before the next try', () => {
    const h = new GleichHost(P, {}, 1, 0);
    play(h, { a: 'Kaffee', b: 'Tasse', c: 'Café' }, 10);
    const end = 10 + GLEICH.revealS * 1000;
    h.intent('a', { a: 'call' }, end - 2000, true);
    P.forEach((p) => h.intent(p, { a: 'vote', v: false }, end - 1000, p === 'a'));
    expect(h.state.last?.result).toBe('no');
    expect(h.tick(end + 1000)).toBe(false);
    expect(h.state.deadline).toBe(end - 1000 + GLEICH.afterVoteS * 1000);
    expect(h.tick(end - 1000 + GLEICH.afterVoteS * 1000)).toBe(true);
    expect(h.state.tryNo).toBe(2);
  });

  it('the Schaffner takes a point', () => {
    const h = new GleichHost(P, {}, 1, 0);
    h.penalize('b', 1);
    expect(h.state.scores).toEqual({ a: 0, b: -1, c: 0 });
  });

  it('only the host ends a round early', () => {
    const h = new GleichHost(P, {}, 1, 0);
    expect(h.intent('b', { a: 'end' }, 1, false)).toBe(false);
    expect(h.intent('a', { a: 'end' }, 1, true)).toBe(true);
    expect(h.state.phase).toBe('done');
    expect(h.state.solved).toBe(false);
  });
});

describe('Gleich gedacht: absent and returning players', () => {
  it('absent players do not block locking, revealing, voting or going on', () => {
    const h = new GleichHost(['a', 'b', 'c', 'd'], {}, 1, 0);
    h.present = new Set(['a', 'b', 'c']);
    ['a', 'b', 'c'].forEach((p) => h.intent(p, C(p), 1, p === 'a'));
    expect(h.state.phase).toBe('reveal');
    ['a', 'b', 'c'].forEach((p) => h.reveal(p, p === 'c' ? 'Hund' : 'Katze', 2));
    expect(h.state.words).toEqual({ a: 'Katze', b: 'Katze', c: 'Hund', d: null });
    expect(h.state.of).toBe(3);
    h.intent('a', { a: 'call' }, 3, true);
    ['a', 'b', 'c'].forEach((p) => h.intent(p, { a: 'vote', v: true }, 4, p === 'a'));
    // Won by vote: the absent d is in the round and scores, too.
    expect(h.state.phase).toBe('done');
    expect(h.state.scores.d).toBe(GLEICH.points[0]);
  });

  it('is solved when all PRESENT players match, whatever the absent one wrote', () => {
    const h = new GleichHost(['a', 'b', 'c'], {}, 1, 0);
    h.present = new Set(['a', 'b']);
    ['a', 'b'].forEach((p) => h.intent(p, C(p), 1, p === 'a'));
    ['a', 'b'].forEach((p) => h.reveal(p, 'Mond', 2));
    expect(h.state.solved).toBe(true);
    expect(h.state.scores.c).toBe(GLEICH.points[0]);
  });

  it('a lone player cannot win by agreeing with themselves', () => {
    const h = new GleichHost(['a', 'b'], {}, 1, 0);
    h.present = new Set(['a']);
    h.intent('a', C('a'), 1, true);
    h.reveal('a', 'Mond', 2);
    expect(h.state.words).toEqual({ a: 'Mond', b: null });
    expect(h.state.solved).toBe(false);
  });

  it('someone who comes back in the writing phase can write again', () => {
    const h = new GleichHost(P, {}, 1, 0);
    h.intent('b', C('b'), 1, false);
    expect(h.replace('b', 'b2')).toBe(true);
    expect(h.state.players).toEqual(['a', 'b2', 'c']);
    // The reload lost the secret behind the commitment: they lock anew.
    expect(h.state.commits).toEqual({});
    expect(h.state.questions.b2).toBeTruthy();
    expect(h.state.questions.b).toBeUndefined();
    h.intent('b2', C('c'), 2, false);
    expect(h.state.commits.b2).toBe('c'.repeat(64));
    expect(h.intent('b', C('b'), 2, false)).toBe(false);
  });

  it('replace follows the new id into words, history, ready, votes and scores', () => {
    const h = new GleichHost(P, { b: 4 }, 1, 0);
    play(h, { a: 'Kaffee', b: 'Tasse', c: 'Café' }, 10);
    h.intent('b', { a: 'ready' }, 11, false);
    h.intent('a', { a: 'call' }, 11, true);
    h.intent('b', { a: 'vote', v: true }, 12, false);
    h.replace('b', 'b2');
    expect(h.state.words).toEqual({ a: 'Kaffee', b2: 'Tasse', c: 'Café' });
    expect(h.state.ready).toEqual(['b2']);
    expect(h.state.vote?.voters).toEqual(['b2']);
    expect(h.state.scores).toEqual({ a: 0, b2: 4, c: 0 });
    // The secret vote followed: b2 cannot vote twice, the rest decide.
    expect(h.intent('b2', { a: 'vote', v: false }, 13, false)).toBe(false);
    h.intent('a', { a: 'vote', v: true }, 13, true);
    h.intent('c', { a: 'vote', v: true }, 13, false);
    expect(h.state.solved).toBe(true);
    expect(h.state.history).toEqual([{ a: 'Kaffee', b2: 'Tasse', c: 'Café' }]);
    expect(h.replace('nobody', 'x')).toBe(false);
  });

  it('removePlayer drops their words and lets the rest carry on; too few end the round', () => {
    const h = new GleichHost(['a', 'b', 'c'], {}, 1, 0);
    ['a', 'b'].forEach((p) => h.intent(p, C(p), 1, p === 'a'));
    expect(h.state.phase).toBe('write');
    expect(h.removePlayer('c', 2)).toBe(true);
    // Everyone who is left has locked.
    expect(h.state.phase).toBe('reveal');
    expect(h.state.players).toEqual(['a', 'b']);
    expect(h.state.questions.c).toBeUndefined();
    expect(h.removePlayer('c', 3)).toBe(false);
    expect(h.removePlayer('b', 4)).toBe(true);
    expect(h.state.phase).toBe('done');
    expect(h.state.solved).toBe(false);
  });

  it('a new host continues from the public state', () => {
    const h = new GleichHost(P, {}, 1, 0);
    h.intent('a', C('a'), 1, true);
    const h2 = GleichHost.fromState(h.state, 100);
    expect(h2.state.phase).toBe('write');
    expect(h2.state.commits.a).toBe('a'.repeat(64));
    P.slice(1).forEach((p) => h2.intent(p, C(p), 101, false));
    expect(h2.state.phase).toBe('reveal');
    // Collecting starts over, with a fresh window.
    const h3 = GleichHost.fromState(h2.state, 200);
    expect(h3.state.deadline).toBe(200 + GLEICH.collectS * 1000);
    h3.reveal('a', 'Mond', 201);
    h3.reveal('b', 'Mond', 201);
    h3.reveal('c', 'Mond', 201);
    expect(h3.state.solved).toBe(true);
  });
});

describe('Gleich gedacht: bots', () => {
  it('lean more to the words so far with every try, so a round converges', () => {
    const tries: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const rand = mulberry32(seed);
      const history: Record<string, string | null>[] = [];
      let solved = 0;
      for (let n = 1; n <= GLEICH.maxTries && !solved; n++) {
        const w = { a: botWord(history, n, rand), b: botWord(history, n, rand), c: botWord(history, n, rand) };
        history.push(w);
        if (biggestGroup(w, ['a', 'b', 'c']).length === 3) solved = n;
      }
      tries.push(solved || GLEICH.maxTries + 1);
    }
    tries.sort((x, y) => x - y);
    // Most rounds are won well before the limit.
    expect(tries[Math.floor(tries.length / 2)]).toBeLessThanOrEqual(6);
    expect(tries.filter((n) => n > GLEICH.maxTries).length).toBeLessThanOrEqual(2);
  });
});

describe('Gleich gedacht over the network', async () => {
  const { LocalGameRoom } = await import('../src/game/minigame');
  const { GleichGame } = await import('../src/game/gleich/game');
  const ids = ['a', 'b', 'c'];
  const make = (decks: ('normal' | 'nsfw')[] = ['normal']) => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 0, name: 'A' },
      { id: 'b', seat: 2, name: 'B' },
      { id: 'c', seat: 1, name: 'C' },
    ]);
    const g = Object.fromEntries(ids.map((id) => [id, new GleichGame(room.net(id), { decks: () => decks })]));
    return { room, g };
  };
  /** Pump messages until `done()`; hashing is asynchronous, so give it real turns. */
  const until = async (room: InstanceType<typeof LocalGameRoom>, done: () => boolean, tick?: () => void) => {
    for (let i = 0; i < 200 && !done(); i++) {
      room.pump();
      tick?.();
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(done()).toBe(true);
  };

  it('three clients agree on a word: commit, reveal, verified, scored', async () => {
    const { room, g } = make();
    g.a.start();
    room.pump();
    expect(g.b.state?.phase).toBe('write');
    // Everyone has their own question.
    expect(new Set(Object.values(g.c.state!.questions)).size).toBe(3);
    expect(await g.a.lock('Auto')).toBe(true);
    expect(await g.b.lock('das auto')).toBe(true);
    room.pump();
    // Nothing but commitments is public while writing.
    const wire = JSON.stringify(g.c.state);
    expect(wire).not.toMatch(/[Aa]uto/);
    expect(g.c.state!.words).toBeNull();
    expect(await g.c.lock('Autos')).toBe(true);
    await until(room, () => g.c.state?.phase === 'done');
    for (const id of ids) {
      expect(g.a.state!.solved).toBe(true);
      expect(g[id].state!.scores).toEqual({ a: GLEICH.points[0], b: GLEICH.points[0], c: GLEICH.points[0] });
    }
    expect(g.b.wordsView()).toEqual({ a: 'Auto', b: 'das auto', c: 'Autos' });
  });

  it('someone who changes their word after locking shows as nothing and never matches', async () => {
    const { room, g } = make();
    g.a.start();
    room.pump();
    await g.a.lock('Auto');
    await g.b.lock('Auto');
    // c locks "Auto" but then tries to send something else.
    await g.c.lock('Auto');
    (g.c as unknown as { secret: { word: string } }).secret.word = 'Mogelei';
    await until(room, () => g.a.state?.words !== null && g.a.state?.words !== undefined);
    expect(g.a.state!.words).toEqual({ a: 'Auto', b: 'Auto', c: null });
    expect(g.a.state!.group).toEqual(['a', 'b']);
    expect(g.a.state!.solved).toBe(false);
    // Everyone's view agrees.
    await until(room, () => g.b.wordsView()?.c === null);
  });

  it('does not wait for an absent player, and they can be dropped', async () => {
    const { room, g } = make();
    g.a.start();
    room.pump();
    const gone = room.roster.pop()!;
    expect(gone.id).toBe('c');
    await g.a.lock('Mond');
    await g.b.lock('Mond');
    await until(room, () => g.a.state?.phase === 'done', () => g.a.tick(performance.now()));
    expect(g.a.state!.solved).toBe(true);
    expect(g.a.state!.scores.c).toBe(GLEICH.points[0]);
  });

  it('absent() names who is gone; drop needs the host to see them gone too', async () => {
    const { room, g } = make();
    g.a.start();
    room.pump();
    room.roster.pop();
    expect(g.b.absent()).toEqual(['c']);
    g.b.drop('a');
    room.pump();
    expect(g.a.state!.players).toContain('a');
    g.b.drop('c');
    room.pump();
    expect(g.a.state!.players).toEqual(['a', 'b']);
    expect(g.b.absent()).toEqual([]);
  });

  it('a rejoiner in the writing phase locks under the new id', async () => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 0, name: 'A' },
      { id: 'b', seat: 2, name: 'B' },
      { id: 'c', seat: 1, name: 'C' },
      { id: 'b2', seat: -1, name: 'B' },
    ]);
    const late = room.roster.pop()!;
    const gg = Object.fromEntries(['a', 'b', 'c', 'b2'].map((id) => [id, new GleichGame(room.net(id), { decks: () => ['normal'] })]));
    gg.a.start();
    room.pump();
    await gg.b.lock('Mond');
    room.pump();
    room.roster.splice(1, 1, { ...late, seat: 2 });
    gg.a.rejoin('b', 'b2');
    room.pump();
    expect(gg.b2.state?.players).toContain('b2');
    // Its old commitment is void (the word was lost with the reload): it counts as not locked.
    expect(gg.b2.state!.commits.b2).toBeUndefined();
    expect(gg.b2.myWord).toBeNull();
    await gg.a.lock('Mond');
    await gg.c.lock('Mond');
    await gg.b2.lock('Mond');
    await until(room, () => gg.a.state?.phase === 'done');
    expect(gg.a.state!.solved).toBe(true);
    expect(gg.a.state!.scores).toEqual({ a: 10, b2: 10, c: 10 });
  });

  it('a new host takes over a running round from the public state', async () => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 0, name: 'A' },
      { id: 'b', seat: 2, name: 'B' },
      { id: 'c', seat: 1, name: 'C' },
    ]);
    let host = 'a';
    const net = (id: string) => ({ ...room.net(id), isHost: () => host === id, hostId: () => host });
    const gg = Object.fromEntries(ids.map((id) => [id, new GleichGame(net(id), { decks: () => ['normal'] })]));
    gg.a.start();
    room.pump();
    await gg.b.lock('Mond');
    room.pump();
    // The host leaves; b is the new one and carries on from the state it holds.
    room.roster.shift();
    host = 'b';
    gg.b.tick(performance.now());
    room.pump();
    room.pump();
    expect(gg.c.state!.commits.b).toBeTruthy();
    await gg.c.lock('Mond');
    await until(room, () => gg.b.state?.phase === 'done', () => gg.b.tick(performance.now()));
    room.pump();
    expect(gg.b.state!.solved).toBe(true);
    expect(gg.c.state!.solved).toBe(true);
  });

  it('only rooms with the NSFW deck get the crude questions', () => {
    const crude = new Set(QUESTIONS_NSFW);
    for (let i = 0; i < 25; i++) {
      const { room, g } = make(['normal']);
      g.a.start();
      room.pump();
      for (const q of Object.values(g.b.state!.questions)) expect(crude.has(q)).toBe(false);
    }
    let seen = 0;
    for (let i = 0; i < 60; i++) {
      const { room, g } = make(['normal', 'nsfw']);
      g.a.start();
      room.pump();
      for (const q of Object.values(g.b.state!.questions)) if (crude.has(q)) seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('ignores a state or a reveal from the wrong sender', async () => {
    const { room, g } = make();
    g.a.start();
    room.pump();
    const before = JSON.stringify(g.c.state);
    // b is no host: its "state" must not replace the host's.
    room.net('b').send('gg:state', { ...g.a.state, tryNo: 9, sentAt: Date.now() }, 'c');
    room.net('b').send('gg:reveal', { round: 1, tryNo: 1, word: 'X', salt: 'zz' });
    room.pump();
    expect(JSON.stringify(g.c.state)).toBe(before);
  });
});
