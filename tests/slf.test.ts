import { describe, expect, it } from 'vitest';
import { SLF } from '../src/config';
import { mulberry32 } from '../src/core/rng';
import { botAnswer, botWords } from '../src/game/slf/botWords';
import {
  categoryPool,
  drawCategories,
  drawLetter,
  firstLetter,
  imageCommit,
  judgeImages,
  judgeText,
  liveText,
  parseIntent,
  SlfHost,
  startsWithLetter,
  textCommit,
  verifyImage,
  verifyText,
  type Judgement,
} from '../src/game/slf/logic';
import { newSalt } from '../src/game/gleich/logic';
import { FALLBACK } from '../src/words/fallback';
import { FIXTURE } from './fixtures/content';

const H = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const T0 = 1_000_000;
/** A tiny JPEG-shaped data URL: the format check only looks at the header and alphabet. */
const pic = (s: string) => `data:image/jpeg;base64,${btoa(s)}`;

describe('Stadt, Land, Fluss: letters', () => {
  it.each([
    ['Berlin', 'B'],
    ['  bremen ', 'B'],
    ['die Elbe', 'E'],
    ['Den Haag', 'D'],
    ['Der Rhein', 'R'],
    ['eine Ameise', 'A'],
    ['Ärmelkanal', 'A'],
    ['Österreich', 'O'],
    ['Überlingen', 'U'],
    ['Éclair', 'E'],
    ['„Bär“', 'B'],
    ['B', 'B'],
  ])('%s counts for %s', (a, l) => {
    expect(startsWithLetter(a, l)).toBe(true);
  });

  it.each([
    ['Berlin', 'D'],
    ['', 'B'],
    ['   ', 'B'],
    ['123', 'B'],
    ['das', 'B'],
  ])('%s does not count for %s', (a, l) => {
    expect(startsWithLetter(a, l)).toBe(false);
  });

  it('folds umlauts and accents to the plain letter', () => {
    expect(firstLetter('ärger')).toBe('A');
    expect(firstLetter('…!')).toBe('');
  });

  it('draws only allowed letters (no Q, X, Y) and avoids the used ones', () => {
    const rng = mulberry32(7);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(drawLetter(rng));
    expect([...seen].sort().join('')).toBe(SLF.letters);
    for (const l of 'QXY') expect(seen.has(l)).toBe(false);
    const avoid = new Set([...SLF.letters].slice(1));
    expect(drawLetter(rng, avoid)).toBe(SLF.letters[0]);
    expect(SLF.letters).not.toMatch(/[QXY]/);
  });
});

describe('Stadt, Land, Fluss: categories', () => {
  const rng = mulberry32(3);
  it('text rounds keep Stadt, Land, Fluss first; with only the classics it is all six', () => {
    const { fixed, pool } = categoryPool('text', ['normal'], ['Kollege']);
    expect(fixed).toEqual(['Stadt', 'Land', 'Fluss']);
    expect(pool).not.toContain('Kollege');
    const cats = drawCategories(fixed, pool, SLF.count.text, rng);
    expect(cats.slice(0, 3)).toEqual(['Stadt', 'Land', 'Fluss']);
    expect([...cats].sort()).toEqual([...FALLBACK.slf.text].sort());
  });

  it('NSFW extras only with that deck (and unlocked), own categories only with "Eigene"', () => {
    const extra = FIXTURE.slf.nsfw[0];
    expect(categoryPool('text', ['normal'], [], FIXTURE).pool).not.toContain(extra);
    expect(categoryPool('text', ['normal', 'nsfw'], [], FIXTURE).pool).toContain(extra);
    expect(categoryPool('bild', ['normal', 'nsfw'], [], FIXTURE).pool).toContain(extra);
    // Locked: the classics only.
    expect(categoryPool('text', ['normal', 'nsfw'], []).pool.sort()).toEqual(['Beruf', 'Name', 'Tier']);
    const mixed = categoryPool('text', ['normal', 'custom'], ['Kollege', 'Stadt']);
    expect(mixed.pool).toContain('Kollege');
    // No duplicate of a fixed one.
    expect(mixed.pool.filter((c) => c === 'Stadt')).toHaveLength(0);
  });

  it('only "Eigene": own categories alone if there are enough, else the classics fill in', () => {
    const six = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
    expect(categoryPool('text', ['custom'], six)).toEqual({ fixed: [], pool: six });
    expect(categoryPool('text', ['custom'], ['A1']).fixed).toEqual(['Stadt', 'Land', 'Fluss']);
    expect(categoryPool('bild', ['custom'], ['A1', 'A2', 'A3'])).toEqual({ fixed: [], pool: ['A1', 'A2', 'A3'] });
  });

  it('picture rounds draw three picturable categories, never twice', () => {
    for (let i = 0; i < 30; i++) {
      const { fixed, pool } = categoryPool('bild', ['normal'], []);
      const cats = drawCategories(fixed, pool, SLF.count.bild, rng);
      expect(cats).toHaveLength(3);
      expect(new Set(cats).size).toBe(3);
      for (const c of cats) expect(FALLBACK.slf.image).toContain(c);
    }
  });
});

describe('Stadt, Land, Fluss: points', () => {
  const P = ['a', 'b', 'c', 'd'];
  it('10 unique, 5 shared, 0 invalid or empty', () => {
    const r = judgeText(P, { a: 'Berlin', b: 'Bremen', c: 'berlin', d: 'Köln' }, 'B');
    expect(r.points).toEqual({ a: 5, b: 10, c: 5, d: 0 });
    expect(r.groups).toEqual([['a', 'c']]);
    expect(r.valid.d).toBe(false);
  });

  it('20 for the only valid answer of the category', () => {
    expect(judgeText(P, { a: 'Bonn', b: '', c: null, d: 'Köln' }, 'B').points).toEqual({ a: 20, b: 0, c: 0, d: 0 });
    // Two with the same answer are not "the only one".
    expect(judgeText(P, { a: 'Bonn', b: 'Bonn', c: null, d: null }, 'B').points).toEqual({ a: 5, b: 5, c: 0, d: 0 });
  });

  it('flags: "ungültig" takes an answer out (which may make another the only one), "gleich" merges', () => {
    const answers = { a: 'B', b: 'Bremen', c: 'Bremerhaven', d: 'Bonn' };
    expect(judgeText(P, answers, 'B').points).toEqual({ a: 10, b: 10, c: 10, d: 10 });
    expect(judgeText(P, answers, 'B', new Set(['a'])).points).toEqual({ a: 0, b: 10, c: 10, d: 10 });
    expect(judgeText(P, answers, 'B', new Set(['a']), [['b', 'c']]).points).toEqual({ a: 0, b: 5, c: 5, d: 10 });
    expect(judgeText(['a', 'b'], { a: 'B', b: 'Bremen' }, 'B', new Set(['a'])).points).toEqual({ a: 0, b: 20 });
    // Chains: a~b by vote, b~c automatically.
    expect(judgeText(['a', 'b', 'c'], { a: 'Bär', b: 'Biber', c: 'Bibers' }, 'B', new Set(), [['a', 'b']]).groups).toEqual([['a', 'b', 'c']]);
  });

  const votes = (o: Record<string, Judgement>) => new Map(Object.entries(o));
  it('pictures count unless most others say no; a tie counts', () => {
    const shown = { a: true, b: true, c: true, d: false };
    const r = judgeImages(P, shown, votes({
      a: { ok: { b: false, c: true }, best: 'c' },
      b: { ok: { a: true, c: false }, best: 'a' },
      c: { ok: { a: true, b: false, d: true }, best: 'a' },
      d: { ok: { a: true, b: true, c: true }, best: 'c' },
    }));
    expect(r.valid).toEqual({ a: true, b: false, c: true, d: false });
    expect(r.tally!.b).toEqual([1, 2, 0]);
    expect(r.tally!.c).toEqual([2, 1, 2]);
    // a and c tie for best: both get the bonus.
    expect(r.best).toEqual(['a', 'c']);
    expect(r.points).toEqual({ a: SLF.imagePoints + SLF.bestBonus, b: 0, c: SLF.imagePoints + SLF.bestBonus, d: 0 });
  });

  it('own votes and a best vote for a picture that does not count are ignored; no votes: everything counts', () => {
    const shown = { a: true, b: true };
    const r = judgeImages(['a', 'b'], shown, votes({ a: { ok: { a: true, b: false }, best: 'a' }, b: { ok: {}, best: null } }));
    expect(r.valid).toEqual({ a: true, b: false });
    expect(r.best).toEqual([]);
    expect(judgeImages(['a', 'b'], shown, new Map()).points).toEqual({ a: SLF.imagePoints, b: SLF.imagePoints });
  });
});

describe('Stadt, Land, Fluss: commit and reveal', () => {
  it('text: the locked answers check out, changed ones or a wrong salt do not', async () => {
    const salt = newSalt();
    const answers = ['Berlin', '', 'Bode'];
    const c = await textCommit(answers, salt);
    expect(await verifyText(c, answers, salt, 3)).toEqual(answers);
    expect(await verifyText(c, ['Berlin', 'Belgien', 'Bode'], salt, 3)).toBeNull();
    expect(await verifyText(c, answers, newSalt(), 3)).toBeNull();
    expect(await verifyText(c, answers, salt, 4)).toBeNull();
    expect(await verifyText(c, [' Berlin', '', 'Bode'], salt, 3)).toBeNull();
    expect(await verifyText(undefined, answers, salt, 3)).toBeNull();
    expect(await verifyText(c, 'Berlin', salt, 3)).toBeNull();
  });

  it('pictures: image and caption are bound to the commitment and the category', async () => {
    const salt = newSalt();
    const img = pic('bär');
    const c = await imageCommit(1, img, 'Bär', salt);
    expect(await verifyImage(c, 1, img, 'Bär', salt)).toBe(true);
    expect(await verifyImage(c, 0, img, 'Bär', salt)).toBe(false);
    expect(await verifyImage(c, 1, img, 'Biber', salt)).toBe(false);
    expect(await verifyImage(c, 1, pic('anders'), 'Bär', salt)).toBe(false);
    expect(await verifyImage(c, 1, 'data:image/png;base64,AAAA', 'Bär', salt)).toBe(false);
    const empty = await imageCommit(2, '', '', salt);
    expect(await verifyImage(empty, 2, '', '', salt)).toBe(true);
  });

  it('validates intents', () => {
    expect(parseIntent({ a: 'stop', c: [H] })).toEqual({ a: 'stop', c: [H] });
    expect(parseIntent({ a: 'lock', c: [] })).toBeNull();
    expect(parseIntent({ a: 'lock', c: ['xyz'] })).toBeNull();
    expect(parseIntent({ a: 'flag', kind: 'bad', target: 'b' })).toEqual({ a: 'flag', kind: 'bad', target: 'b' });
    expect(parseIntent({ a: 'flag', kind: 'same', target: 'b', other: 'b' })).toBeNull();
    expect(parseIntent({ a: 'flag', kind: 'evil', target: 'b' })).toBeNull();
    expect(parseIntent({ a: 'judge', cat: 1, ok: { b: true }, best: null })).toEqual({ a: 'judge', cat: 1, ok: { b: true }, best: null });
    expect(parseIntent({ a: 'judge', cat: 1, ok: { b: 'ja' }, best: null })).toBeNull();
    expect(parseIntent({ a: 'vote', v: 1 })).toBeNull();
    expect(parseIntent({ a: 'ready' })).toEqual({ a: 'ready' });
    expect(parseIntent('end')).toBeNull();
  });
});

/** A text host past the writing, with answers revealed (the game checks reveals; tests feed them directly). */
function textHost(players: string[], answers: Record<string, string[]>, cats = ['Stadt', 'Land'], letter = 'B') {
  const h = new SlfHost(players, 'text', letter, cats, {}, 1, T0);
  for (const p of players) h.intent(p, { a: 'lock', c: [H] }, T0, false);
  expect(h.state.phase).toBe('reveal');
  for (const p of players) h.revealText(p, answers[p], T0);
  expect(h.state.phase).toBe('rate');
  return h;
}

describe('Stadt, Land, Fluss: rules (text)', () => {
  it('writing: "Stopp!" leaves the others stopS, the rest commit in the lock phase', () => {
    const h = new SlfHost(['a', 'b', 'c'], 'text', 'B', ['Stadt'], {}, 1, T0);
    expect(h.state.deadline).toBe(T0 + SLF.writeS * 1000);
    h.intent('b', { a: 'stop', c: [H] }, T0 + 5000, false);
    expect(h.state.stopBy).toBe('b');
    expect(h.state.deadline).toBe(T0 + 5000 + SLF.stopS * 1000);
    // A second stop changes nothing about the time.
    h.intent('c', { a: 'stop', c: [H] }, T0 + 6000, false);
    expect(h.state.deadline).toBe(T0 + 5000 + SLF.stopS * 1000);
    expect(h.state.phase).toBe('write');
    h.tick(T0 + 5000 + SLF.stopS * 1000);
    expect(h.state.phase).toBe('lock');
    h.intent('a', { a: 'lock', c: [H2] }, T0 + 16000, false);
    expect(h.state.phase).toBe('reveal');
    // Only commitments are public until then.
    expect(h.state.answers).toBeNull();
  });

  it('wrong commitment sizes are refused; nobody locks after the writing', () => {
    const h = new SlfHost(['a', 'b'], 'bild', 'B', ['Tier', 'Essen', 'Pflanze'], {}, 1, T0);
    expect(h.intent('a', { a: 'stop', c: [H] }, T0, false)).toBe(false);
    expect(h.intent('a', { a: 'stop', c: [H, H, H] }, T0, false)).toBe(true);
    expect(h.state.deadline).toBe(T0 + SLF.imageStopS * 1000);
    h.tick(T0 + SLF.imageStopS * 1000);
    h.tick(T0 + SLF.imageStopS * 1000 + SLF.lockS * 1000);
    expect(h.state.phase).toBe('reveal');
    expect(h.intent('b', { a: 'lock', c: [H, H, H] }, T0 + 30000, false)).toBe(false);
  });

  it('answers that do not match their commitment or never came count as nothing', () => {
    const h = new SlfHost(['a', 'b', 'c'], 'text', 'B', ['Stadt'], {}, 1, T0);
    h.intent('a', { a: 'lock', c: [H] }, T0, false);
    h.intent('b', { a: 'lock', c: [H] }, T0, false);
    h.tick(T0 + SLF.writeS * 1000);
    h.tick(T0 + SLF.writeS * 1000 + SLF.lockS * 1000);
    expect(h.state.phase).toBe('reveal');
    h.revealText('a', null, T0 + 184_000);
    expect(h.state.phase).toBe('reveal');
    h.revealText('b', ['Bonn'], T0 + 184_000);
    expect(h.state.phase).toBe('rate');
    expect(h.state.answers).toEqual({ a: [null], b: ['Bonn'], c: [null] });
    expect(liveText(h.state)!.points).toEqual({ a: 0, b: 20, c: 0 });
  });

  it('goes through the categories; points add up per category', () => {
    const h = textHost(['a', 'b', 'c'], { a: ['Berlin', 'Belgien'], b: ['Bonn', 'Belgien'], c: ['berlin', ''] });
    for (const p of ['a', 'b', 'c']) h.intent(p, { a: 'ready' }, T0 + 1000, false);
    expect(h.state.cat).toBe(1);
    expect(h.state.scores).toEqual({ a: 5, b: 10, c: 5 });
    // The timer moves on by itself too.
    h.tick(h.state.deadline!);
    expect(h.state.phase).toBe('done');
    expect(h.state.results).toHaveLength(2);
    expect(h.state.scores).toEqual({ a: 10, b: 15, c: 5 });
  });

  it('a flag is a majority vote of the others; ties reject it', () => {
    const h = textHost(['a', 'b', 'c', 'd'], { a: ['B'], b: ['Bonn'], c: ['Bremen'], d: ['Berlin'] }, ['Stadt']);
    expect(h.intent('b', { a: 'flag', kind: 'bad', target: 'a' }, T0 + 1000, false)).toBe(true);
    const v = h.state.vote!;
    // The author doesn't vote; the flagger's flag is their yes.
    expect(v.eligible).toEqual(['b', 'c', 'd']);
    expect(v.voters).toEqual(['b']);
    expect(h.intent('a', { a: 'vote', v: false }, T0 + 1000, false)).toBe(false);
    // Only one vote at a time.
    expect(h.intent('c', { a: 'flag', kind: 'bad', target: 'd' }, T0 + 1000, false)).toBe(false);
    h.intent('c', { a: 'vote', v: false }, T0 + 2000, false);
    h.intent('d', { a: 'vote', v: true }, T0 + 2000, false);
    expect(h.state.vote).toBeNull();
    expect(h.state.flags[0]).toMatchObject({ kind: 'bad', target: 'a', result: 'yes', yes: 2, no: 1 });
    expect(liveText(h.state)!.valid.a).toBe(false);
    // The same flag can't be raised again.
    expect(h.intent('c', { a: 'flag', kind: 'bad', target: 'a' }, T0 + 3000, false)).toBe(false);
    // A tie (one yes from the flagger, one no, one silent until the deadline) is rejected.
    h.intent('c', { a: 'flag', kind: 'same', target: 'b', other: 'd' }, T0 + 3000, false);
    expect(h.state.vote!.eligible).toEqual(['a', 'c']);
    h.intent('a', { a: 'vote', v: false }, T0 + 3500, false);
    expect(h.state.flags[1]).toMatchObject({ result: 'no', yes: 1, no: 1 });
    expect(liveText(h.state)!.groups).toEqual([]);
  });

  it('with two players the authors vote too, so nobody decides alone', () => {
    const h = textHost(['a', 'b'], { a: ['B'], b: ['Bonn'] }, ['Stadt']);
    h.intent('b', { a: 'flag', kind: 'bad', target: 'a' }, T0, false);
    expect(h.state.vote!.eligible).toEqual(['a', 'b']);
    h.intent('a', { a: 'vote', v: false }, T0, false);
    expect(h.state.flags[0].result).toBe('no');
    // An honest author agrees.
    const h2 = textHost(['a', 'b'], { a: ['B'], b: ['Bonn'] }, ['Stadt']);
    h2.intent('b', { a: 'flag', kind: 'bad', target: 'a' }, T0, false);
    h2.intent('a', { a: 'vote', v: true }, T0, false);
    expect(liveText(h2.state)!.points).toEqual({ a: 0, b: SLF.points.only });
  });

  it('flags need valid answers; "gleich" only for answers not already together; votes time out', () => {
    const h = textHost(['a', 'b', 'c'], { a: ['Köln'], b: ['Bonn'], c: ['bonn'] }, ['Stadt']);
    expect(h.intent('b', { a: 'flag', kind: 'bad', target: 'a' }, T0, false)).toBe(false);
    expect(h.intent('a', { a: 'flag', kind: 'same', target: 'b', other: 'c' }, T0, false)).toBe(false);
    expect(h.intent('a', { a: 'flag', kind: 'bad', target: 'b' }, T0, false)).toBe(true);
    h.tick(T0 + SLF.voteS * 1000);
    expect(h.state.flags[0]).toMatchObject({ result: 'yes', yes: 1, no: 0 });
    // The category waits for the vote, then gives everyone a moment to read.
    expect(h.state.deadline).toBeGreaterThanOrEqual(T0 + SLF.voteS * 1000 + SLF.afterVoteS * 1000);
  });

  it('absent players block nothing', () => {
    const h = new SlfHost(['a', 'b', 'c'], 'text', 'B', ['Stadt'], {}, 1, T0);
    h.present = new Set(['a', 'b']);
    h.intent('a', { a: 'lock', c: [H] }, T0, false);
    h.intent('b', { a: 'lock', c: [H] }, T0, false);
    expect(h.state.phase).toBe('reveal');
    h.revealText('a', ['Bonn'], T0);
    h.revealText('b', ['Bern'], T0);
    expect(h.state.phase).toBe('rate');
    h.intent('a', { a: 'ready' }, T0, false);
    h.intent('b', { a: 'ready' }, T0, false);
    expect(h.state.phase).toBe('done');
  });

  it('the Schaffner takes a point; only the host ends a round early', () => {
    const h = new SlfHost(['a', 'b'], 'text', 'B', ['Stadt'], { a: 3 }, 1, T0);
    h.penalize('a', 1);
    expect(h.state.scores.a).toBe(2);
    expect(h.intent('b', { a: 'end' }, T0, false)).toBe(false);
    expect(h.intent('a', { a: 'end' }, T0, true)).toBe(true);
    expect(h.state.phase).toBe('done');
  });
});

describe('Stadt, Land, Fluss: rules (pictures)', () => {
  const imageHost = () => {
    const h = new SlfHost(['a', 'b', 'c'], 'bild', 'B', ['Tier', 'Essen'], {}, 1, T0);
    for (const p of ['a', 'b', 'c']) h.intent(p, { a: 'lock', c: [H, H] }, T0, false);
    for (const p of ['a', 'b', 'c']) for (const c of [0, 1]) h.revealImage(p, c, !(p === 'c' && c === 1), T0);
    return h;
  };

  it('judging, then the result with the best bonus, then the next category', () => {
    const h = imageHost();
    expect(h.state.phase).toBe('rate');
    expect(h.state.step).toBe('vote');
    expect(h.state.shown).toEqual({ a: [true, true], b: [true, true], c: [true, false] });
    h.intent('a', { a: 'judge', cat: 0, ok: { b: true, c: false }, best: 'b' }, T0, false);
    // Once per category; a judgement for another category is refused.
    expect(h.intent('a', { a: 'judge', cat: 0, ok: {}, best: null }, T0, false)).toBe(false);
    expect(h.intent('b', { a: 'judge', cat: 1, ok: {}, best: null }, T0, false)).toBe(false);
    h.intent('b', { a: 'judge', cat: 0, ok: { a: true, c: false }, best: 'a' }, T0, false);
    expect(h.state.judged).toEqual(['a', 'b']);
    h.intent('c', { a: 'judge', cat: 0, ok: { a: true, b: true }, best: 'b' }, T0, false);
    expect(h.state.step).toBe('show');
    expect(h.state.results[0].valid).toEqual({ a: true, b: true, c: false });
    expect(h.state.results[0].best).toEqual(['b']);
    expect(h.state.scores).toEqual({ a: SLF.imagePoints, b: SLF.imagePoints + SLF.bestBonus, c: 0 });
    for (const p of ['a', 'b', 'c']) h.intent(p, { a: 'ready' }, T0, false);
    expect(h.state.cat).toBe(1);
    expect(h.state.step).toBe('vote');
    // Nobody judges in time: every picture counts, a missing one doesn't.
    h.tick(h.state.deadline!);
    expect(h.state.results[1].valid).toEqual({ a: true, b: true, c: false });
    h.tick(h.state.deadline!);
    expect(h.state.phase).toBe('done');
  });

  it('a best vote for yourself or a missing picture is dropped', () => {
    const h = imageHost();
    h.intent('a', { a: 'judge', cat: 0, ok: {}, best: 'a' }, T0, false);
    h.intent('b', { a: 'judge', cat: 0, ok: {}, best: 'zz' }, T0, false);
    h.intent('c', { a: 'judge', cat: 0, ok: {}, best: null }, T0, false);
    expect(h.state.results[0].best).toEqual([]);
  });
});

describe('Stadt, Land, Fluss: leaving, returning, new host', () => {
  it('someone who returns while writing writes again; later their answers follow the new id', () => {
    const h = new SlfHost(['a', 'b'], 'text', 'B', ['Stadt'], { a: 4 }, 1, T0);
    h.intent('a', { a: 'stop', c: [H] }, T0, false);
    expect(h.replace('a', 'a2')).toBe(true);
    expect(h.state.commits.a2).toBeUndefined();
    expect(h.state.stopBy).toBe('a2');
    expect(h.state.scores).toEqual({ a2: 4, b: 0 });
    const g = textHost(['a', 'b', 'c'], { a: ['B'], b: ['Bonn'], c: ['Bern'] }, ['Stadt', 'Land']);
    g.intent('b', { a: 'flag', kind: 'bad', target: 'a' }, T0, false);
    g.intent('c', { a: 'vote', v: true }, T0, false);
    g.intent('b', { a: 'ready' }, T0, false);
    g.replace('a', 'a2');
    expect(g.state.answers!.a2).toEqual(['B', null]);
    expect(g.state.flags[0].target).toBe('a2');
    expect(liveText(g.state)!.valid.a2).toBe(false);
    for (const p of ['a2', 'c']) g.intent(p, { a: 'ready' }, T0, false);
    expect(g.state.results[0].points).toEqual({ a2: 0, b: 10, c: 10 });
  });

  it('removePlayer takes them out; a vote about their answer ends; too few end the round', () => {
    const h = textHost(['a', 'b', 'c'], { a: ['B'], b: ['Bonn'], c: ['Bern'] }, ['Stadt']);
    h.intent('b', { a: 'flag', kind: 'bad', target: 'a' }, T0, false);
    expect(h.removePlayer('a', T0)).toBe(true);
    expect(h.state.vote).toBeNull();
    expect(h.state.flags).toEqual([]);
    expect(h.state.players).toEqual(['b', 'c']);
    h.removePlayer('b', T0);
    expect(h.state.phase).toBe('done');
  });

  it('a new host continues from the public state; an open vote is dropped, judging starts over', () => {
    const h = textHost(['a', 'b', 'c'], { a: ['B'], b: ['Bonn'], c: ['Bern'] }, ['Stadt']);
    h.intent('b', { a: 'flag', kind: 'bad', target: 'a' }, T0, false);
    const n = SlfHost.fromState(h.state, T0 + 100);
    expect(n.state.vote).toBeNull();
    expect(n.state.flags).toEqual([]);
    expect(n.intent('b', { a: 'flag', kind: 'bad', target: 'a' }, T0 + 200, false)).toBe(true);
    const img = new SlfHost(['a', 'b'], 'bild', 'B', ['Tier'], {}, 1, T0);
    img.intent('a', { a: 'lock', c: [H] }, T0, false);
    img.intent('b', { a: 'lock', c: [H] }, T0, false);
    img.revealImage('a', 0, true, T0);
    img.revealImage('b', 0, true, T0);
    img.intent('a', { a: 'judge', cat: 0, ok: { b: false }, best: 'b' }, T0, false);
    const m = SlfHost.fromState(img.state, T0 + 100);
    expect(m.state.judged).toEqual([]);
    expect(m.state.voteNo).toBe(1);
    expect(m.state.deadline).toBe(T0 + 100 + SLF.imageVoteS * 1000);
  });
});

describe('Stadt, Land, Fluss: bots', () => {
  it('know words for the classics and sometimes write just the letter', () => {
    for (const l of SLF.letters) for (const c of FALLBACK.slf.text) expect(botWords(c, l).length, `${c} ${l}`).toBeGreaterThan(0);
    for (const l of SLF.letters) for (const c of FALLBACK.slf.text) for (const w of botWords(c, l)) expect(startsWithLetter(w, l), `${c} ${w}`).toBe(true);
    for (const l of SLF.letters) for (const c of FALLBACK.slf.image) for (const w of botWords(c, l)) expect(startsWithLetter(w, l), `${c} ${w}`).toBe(true);
    const rng = mulberry32(5);
    const got = Array.from({ length: 300 }, () => botAnswer('Kollege', 'M', rng));
    expect(got).toContain('M');
    expect(got.filter((w) => w.length > 2).every((w) => w.startsWith('M'))).toBe(true);
  });
});

describe('Stadt, Land, Fluss over the network', async () => {
  const { LocalGameRoom } = await import('../src/game/minigame');
  const { SlfGame } = await import('../src/game/slf/game');
  type Room = InstanceType<typeof LocalGameRoom>;
  const ids = ['a', 'b', 'c'];
  const make = (mode: 'text' | 'bild' = 'text', custom: string[] = [], decks: ('normal' | 'custom')[] = ['normal']) => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 2, name: 'A' },
      { id: 'b', seat: 0, name: 'B' },
      { id: 'c', seat: 1, name: 'C' },
    ]);
    const g = Object.fromEntries(ids.map((id) => [id, new SlfGame(room.net(id), { decks: () => decks, mode: () => mode, custom: () => custom })]));
    return { room, g };
  };
  /** Pump messages until `done()`; hashing is asynchronous, so give it real turns. */
  const until = async (room: Room, done: () => boolean, tick?: () => void) => {
    for (let i = 0; i < 300 && !done(); i++) {
      room.pump();
      tick?.();
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(done()).toBe(true);
  };
  /** Time travel for the host: its deadlines are Date.now()-based. */
  const expire = (g: InstanceType<typeof SlfGame>) => {
    const h = (g as unknown as { host: SlfHost }).host;
    if (h.state.deadline) h.state.deadline = Date.now() - 1;
  };

  it('text round: commit, nothing public while writing, reveal after the stop, points for all', async () => {
    const { room, g } = make();
    g.a.start();
    room.pump();
    const s = g.b.state!;
    expect(s.phase).toBe('write');
    expect(s.categories.slice(0, 3)).toEqual(['Stadt', 'Land', 'Fluss']);
    const L = s.letter;
    const n = s.categories.length;
    // Answers made from the letter, so whatever letter was drawn they count.
    const fill = (id: string, word: (c: number) => string) => {
      for (let c = 0; c < n; c++) g[id].setText(c, word(c));
    };
    fill('a', (c) => `${L}ora${c}`);
    fill('b', (c) => (c === 0 ? `${L}ora0` : `${L}ix${c}`));
    fill('c', (c) => (c === 1 ? L : ''));
    expect(g.c.filled).toBe(false);
    expect(await g.c.stop()).toBe(false);
    expect(g.a.filled).toBe(true);
    expect(await g.a.stop()).toBe(true);
    room.pump();
    expect(g.b.state!.stopBy).toBe('a');
    expect(g.a.canEdit).toBe(false);
    const wire = JSON.stringify(g.c.state);
    expect(wire).not.toContain('ora');
    // Time's up: everyone else commits what they have.
    expire(g.a);
    g.a.tick(performance.now());
    await until(room, () => g.a.state?.phase === 'rate');
    for (const id of ids) await until(room, () => !!g[id].state?.answers);
    expect(g.c.answersView()!.a[0]).toBe(`${L}ora0`);
    expect(g.a.state!.answers!.c).toEqual(Array.from({ length: n }, (_, c) => (c === 1 ? L : null)));
    // b flags c's bare letter in category 2; a agrees.
    for (const id of ids) g[id].ready();
    room.pump();
    expect(g.a.state!.cat).toBe(1);
    g.b.flagBad('c');
    room.pump();
    expect(g.a.state!.vote).not.toBeNull();
    g.a.vote(true);
    room.pump();
    expect(g.a.state!.flags[0].result).toBe('yes');
    for (let c = 1; c < n; c++) {
      for (const id of ids) g[id].ready();
      room.pump();
    }
    await until(room, () => g.c.state?.phase === 'done');
    const r = g.c.state!.results;
    expect(r).toHaveLength(n);
    expect(r[0].points).toEqual({ a: 5, b: 5, c: 0 });
    expect(r[1].points).toEqual({ a: 10, b: 10, c: 0 });
    expect(g.c.state!.scores.a).toBe(5 + 10 * (n - 1));
  });

  it('a changed answer after locking shows as nothing', async () => {
    const { room, g } = make();
    g.a.start();
    room.pump();
    const L = g.a.state!.letter;
    for (const id of ids) for (let c = 0; c < 6; c++) g[id].setText(c, `${L}${id}${c}x`);
    await g.a.stop();
    await g.b.stop();
    await g.c.stop();
    (g.c as unknown as { secret: { texts: string[] } }).secret.texts[0] = `${L}mogel`;
    await until(room, () => g.a.state?.phase === 'rate');
    expect(g.a.state!.answers!.c.every((x) => x === null)).toBe(true);
    expect(g.a.state!.answers!.b[0]).toBe(`${L}b0x`);
  });

  it('picture round: pictures go straight to everyone after the writing, judged, best bonus', async () => {
    const { room, g } = make('bild');
    g.a.start();
    room.pump();
    const s = g.a.state!;
    expect(s.categories).toHaveLength(3);
    for (const id of ids) for (let c = 0; c < 3; c++) {
      if (id === 'c' && c === 2) continue;
      g[id].setPic(c, pic(`${id}${c}`));
      g[id].setCaption(c, `${s.letter}${id}`);
    }
    expect(g.c.filled).toBe(false);
    await g.a.stop();
    await g.b.stop();
    room.pump();
    // Nothing of the pictures in the public state.
    expect(JSON.stringify(g.c.state)).not.toContain('data:image');
    expire(g.a);
    g.a.tick(performance.now());
    await until(room, () => g.a.state?.phase === 'rate', () => g.a.tick(performance.now()));
    await until(room, () => ids.every((id) => g[id].state?.phase === 'rate') && !!g.b.picOf('a', 0) && !!g.b.picOf('c', 1));
    expect(g.a.state!.shown).toEqual({ a: [true, true, true], b: [true, true, true], c: [true, true, false] });
    expect(g.b.picOf('c', 0)).toEqual({ img: pic('c0'), cap: `${s.letter}c` });
    expect(g.b.picOf('c', 2)).toBeNull();
    g.a.judge({ b: true, c: false }, 'b');
    g.b.judge({ a: true, c: false }, 'a');
    g.c.judge({ a: true, b: true }, 'b');
    room.pump();
    expect(g.c.state!.step).toBe('show');
    expect(g.c.state!.results[0].points).toEqual({ a: 10, b: 15, c: 0 });
  });

  it('own categories of the room come in with "Eigene"; only "Eigene" with enough: only those', () => {
    const own = ['Kollege', 'Ausrede', 'Snack', 'Meeting', 'Faxgerät', 'Kantine'];
    for (let i = 0; i < 10; i++) {
      const { room, g } = make('text', own, ['custom']);
      g.a.start();
      room.pump();
      expect([...g.b.state!.categories].sort()).toEqual([...own].sort());
    }
    let seen = 0;
    for (let i = 0; i < 20; i++) {
      const { room, g } = make('text', ['Kollege'], ['normal', 'custom']);
      g.a.start();
      room.pump();
      if (g.b.state!.categories.includes('Kollege')) seen++;
    }
    expect(seen).toBeGreaterThan(0);
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
  });

  it('a rejoiner while writing writes again under the new id', async () => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 2, name: 'A' },
      { id: 'b', seat: 0, name: 'B' },
      { id: 'b2', seat: -1, name: 'B' },
    ]);
    const late = room.roster.pop()!;
    const gg = Object.fromEntries(['a', 'b', 'b2'].map((id) => [id, new SlfGame(room.net(id), { decks: () => ['normal'], mode: () => 'text' })]));
    gg.a.start();
    room.pump();
    const L = gg.a.state!.letter;
    for (let c = 0; c < 6; c++) gg.b.setText(c, `${L}b`);
    await gg.b.stop();
    room.pump();
    room.roster.splice(1, 1, { ...late, seat: 0 });
    gg.a.rejoin('b', 'b2');
    room.pump();
    expect(gg.b2.state!.players).toEqual(['a', 'b2']);
    expect(gg.b2.canEdit).toBe(true);
    for (let c = 0; c < 6; c++) gg.b2.setText(c, `${L}neu`);
    await gg.b2.stop();
    for (let c = 0; c < 6; c++) gg.a.setText(c, `${L}a`);
    await gg.a.stop();
    await until(room, () => gg.a.state?.phase === 'rate');
    expect(gg.a.state!.answers!.b2[0]).toBe(`${L}neu`);
  });

  it('a new host takes over a picture round and the pictures stay', async () => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 2, name: 'A' },
      { id: 'b', seat: 0, name: 'B' },
      { id: 'c', seat: 1, name: 'C' },
    ]);
    let host = 'a';
    const net = (id: string) => ({ ...room.net(id), isHost: () => host === id, hostId: () => host });
    const gg = Object.fromEntries(ids.map((id) => [id, new SlfGame(net(id), { decks: () => ['normal'], mode: () => 'bild' })]));
    gg.a.start();
    room.pump();
    for (const id of ids) for (let c = 0; c < 3; c++) gg[id].setPic(c, pic(`${id}${c}`));
    for (const id of ids) await gg[id].stop();
    await until(room, () => ids.every((id) => gg[id].state?.phase === 'rate') && !!gg.c.picOf('b', 2) && !!gg.b.picOf('c', 2));
    room.roster.shift();
    host = 'b';
    gg.b.tick(performance.now());
    room.pump();
    expect(gg.c.state!.voteNo).toBe(1);
    gg.b.judge({ c: true }, 'c');
    gg.c.judge({ b: true }, 'b');
    room.pump();
    expect(gg.c.state!.step).toBe('show');
    expect(gg.c.state!.results[0].best.sort()).toEqual(['b', 'c']);
    expect(gg.c.picOf('a', 0)?.img).toBe(pic('a0'));
  });

  it('ignores a state or a reveal from the wrong sender', async () => {
    const { room, g } = make();
    g.a.start();
    room.pump();
    const before = JSON.stringify(g.c.state);
    room.net('b').send('sl:state', { ...g.a.state, letter: 'Q', sentAt: Date.now() }, 'c');
    room.net('b').send('sl:reveal', { round: 1, cat: 0, answers: ['x'], salt: 'zz' });
    room.pump();
    expect(JSON.stringify(g.c.state)).toBe(before);
  });
});

describe('Stadt, Land, Fluss: Zug zurück (host)', () => {
  const P = ['a', 'b', 'c'];
  const rate = () => textHost(P, { a: ['Berlin', 'Belgien'], b: ['Bonn', 'Belgien'], c: ['Bremen', 'Bulgarien'] });
  const ready = (h: SlfHost, now: number) => P.forEach((p) => h.intent(p, { a: 'ready' }, now, false));
  /** A flag on c's answer, voted down by a and b: the flag fails, nothing changes in the answers. */
  const flagAndVote = (h: SlfHost, now: number, v = false) => {
    h.intent('a', { a: 'flag', kind: 'bad', target: 'c' }, now, false);
    h.intent('b', { a: 'vote', v }, now, false);
  };

  it('nothing to take back at the start of the rating', () => {
    const h = rate();
    expect(h.canUndo).toBe(false);
    expect(h.undo(T0)).toBe(false);
  });

  it('a flag vote goes back to before the flag; it can be raised and voted anew', () => {
    const h = rate();
    flagAndVote(h, T0 + 1000, true);
    expect(h.state.flags[0]).toMatchObject({ result: 'yes' });
    expect(liveText(h.state)!.valid.c).toBe(false);
    expect(h.canUndo).toBe(true);
    expect(h.undo(T0 + 5000)).toBe(true);
    expect(h.state).toMatchObject({ undo: 1, phase: 'rate', cat: 0, vote: null, flags: [], ready: [], deadline: T0 + 5000 + SLF.rateS * 1000 });
    expect(liveText(h.state)!.valid.c).toBe(true);
    expect(h.canUndo).toBe(false);
    // The same flag can be raised again (and fails this time).
    flagAndVote(h, T0 + 6000, false);
    expect(h.state.flags[0]).toMatchObject({ result: 'no' });
    expect(liveText(h.state)!.valid.c).toBe(true);
  });

  it('moving on goes back to the category with its decided flags; points revert', () => {
    const h = rate();
    flagAndVote(h, T0 + 1000, true);
    ready(h, T0 + 2000);
    expect(h.state.cat).toBe(1);
    expect(h.state.scores).toEqual({ a: 10, b: 10, c: 0 });
    // The first undo is the move on, the second the flag vote.
    h.undo(T0 + 3000);
    expect(h.state).toMatchObject({ cat: 0, undo: 1, ready: [], results: [], flags: [expect.objectContaining({ result: 'yes' })] });
    expect(h.state.scores).toEqual({ a: 0, b: 0, c: 0 });
    // Everyone has to press "Weiter" again.
    h.intent('a', { a: 'ready' }, T0 + 3500, false);
    expect(h.state.cat).toBe(0);
    h.undo(T0 + 4000);
    expect(h.state.flags).toEqual([]);
  });

  it('the timer moving on and the end of the last category are decisions too', () => {
    const h = rate();
    h.tick(h.state.deadline!);
    expect(h.state.cat).toBe(1);
    h.tick(h.state.deadline!);
    expect(h.state.phase).toBe('done');
    expect(h.state.scores).toEqual({ a: 15, b: 15, c: 20 });
    // Back out of "done" into the last category, then the first.
    h.undo(T0 + 900_000);
    expect(h.state).toMatchObject({ phase: 'rate', cat: 1, deadline: T0 + 900_000 + SLF.rateS * 1000 });
    expect(h.state.results).toHaveLength(1);
    expect(h.state.scores).toEqual({ a: 10, b: 10, c: 10 });
    h.undo(T0 + 900_000);
    expect(h.state).toMatchObject({ cat: 0, undo: 2 });
    expect(h.state.scores).toEqual({ a: 0, b: 0, c: 0 });
  });

  it('"end" while a vote runs goes back to before the flag', () => {
    const h = rate();
    h.intent('a', { a: 'flag', kind: 'bad', target: 'c' }, T0, false);
    expect(h.intent('b', { a: 'end' }, T0, false)).toBe(false);
    expect(h.intent('a', { a: 'end' }, T0, true)).toBe(true);
    expect(h.state.phase).toBe('done');
    h.undo(T0 + 1000);
    expect(h.state).toMatchObject({ phase: 'rate', vote: null, flags: [], cat: 0 });
  });

  it('"end" while collecting keeps the reveals that were in', () => {
    const h = new SlfHost(P, 'text', 'B', ['Stadt'], {}, 1, T0);
    for (const p of P) h.intent(p, { a: 'lock', c: [H] }, T0, false);
    h.revealText('a', ['Berlin'], T0);
    h.intent('a', { a: 'end' }, T0, true);
    h.undo(T0 + 10_000);
    expect(h.state).toMatchObject({ phase: 'reveal', deadline: T0 + 10_000 + SLF.collectS * 1000 });
    // a's reveal is not asked for again, the others' still count.
    expect(h.revealText('a', ['Berlin'], T0)).toBe(false);
    h.revealText('b', ['Bonn'], T0);
    h.revealText('c', ['Bern'], T0);
    expect(h.state.phase).toBe('rate');
    expect(h.state.answers).toEqual({ a: ['Berlin'], b: ['Bonn'], c: ['Bern'] });
  });

  it('"end" while writing goes back to writing with a fresh timer', () => {
    const h = new SlfHost(P, 'text', 'B', ['Stadt'], {}, 1, T0);
    h.intent('a', { a: 'stop', c: [H] }, T0 + 1000, false);
    h.intent('a', { a: 'end' }, T0 + 2000, true);
    h.undo(T0 + 3000);
    expect(h.state).toMatchObject({ phase: 'write', stopBy: 'a', deadline: T0 + 3000 + SLF.stopS * 1000 });
    expect(h.state.commits).toEqual({ a: [H] });
  });

  it('Schaffner fines stay after an undo', () => {
    const h = rate();
    flagAndVote(h, T0, true);
    h.penalize('b', 1);
    h.undo(T0 + 1000);
    expect(h.state.scores).toEqual({ a: 0, b: -1, c: 0 });
  });

  it('snapshots follow a returning player; a player who left ends the history', () => {
    const h = rate();
    flagAndVote(h, T0, true);
    h.replace('c', 'c2');
    h.undo(T0 + 1000);
    expect(h.state.players).toEqual(['a', 'b', 'c2']);
    expect(h.state.answers!.c2).toEqual(['Bremen', 'Bulgarien']);
    expect(h.state.answers!.c).toBeUndefined();
    expect(Object.keys(h.state.scores).sort()).toEqual(['a', 'b', 'c2']);
    flagAndVote(h, T0 + 2000, true);
    h.removePlayer('b', T0 + 3000);
    expect(h.canUndo).toBe(false);
  });

  it('a new round starts without history; a new host without one too, keeping the count', () => {
    const h = rate();
    flagAndVote(h, T0, true);
    h.undo(T0 + 1000);
    const n = SlfHost.fromState(h.state, T0 + 2000);
    expect(n.canUndo).toBe(false);
    expect(n.state.undo).toBe(1);
    expect(new SlfHost(P, 'text', 'B', ['Stadt'], {}, 2, T0).state.undo).toBe(0);
  });

  describe('pictures', () => {
    const imageHost = () => {
      const h = new SlfHost(P, 'bild', 'B', ['Tier', 'Essen'], {}, 1, T0);
      for (const p of P) h.intent(p, { a: 'lock', c: [H, H] }, T0, false);
      for (const p of P) for (const c of [0, 1]) h.revealImage(p, c, true, T0);
      return h;
    };
    const judge = (h: SlfHost, ok: Record<string, boolean>) => {
      h.intent('a', { a: 'judge', cat: h.state.cat, ok: { b: true, c: ok.c }, best: 'b' }, T0, false);
      h.intent('b', { a: 'judge', cat: h.state.cat, ok: { a: true, c: ok.c }, best: 'a' }, T0, false);
      h.intent('c', { a: 'judge', cat: h.state.cat, ok: { a: true, b: true }, best: 'b' }, T0, false);
    };

    it('the result of a category goes back to its judging, to be judged anew', () => {
      const h = imageHost();
      judge(h, { c: false });
      expect(h.state.step).toBe('show');
      expect(h.state.results[0].valid.c).toBe(false);
      expect(h.state.scores.c).toBe(0);
      h.undo(T0 + 5000);
      expect(h.state).toMatchObject({ step: 'vote', cat: 0, judged: [], results: [], undo: 1, deadline: T0 + 5000 + SLF.imageVoteS * 1000 });
      expect(h.state.scores).toEqual({ a: 0, b: 0, c: 0 });
      // Judging again works, and a different verdict gives a different result.
      judge(h, { c: true });
      expect(h.state.results[0].valid.c).toBe(true);
      expect(h.state.scores.c).toBe(SLF.imagePoints);
    });

    it('moving on goes back to the shown result, then the result to the judging', () => {
      const h = imageHost();
      judge(h, { c: true });
      P.forEach((p) => h.intent(p, { a: 'ready' }, T0, false));
      expect(h.state).toMatchObject({ cat: 1, step: 'vote' });
      h.undo(T0 + 7000);
      expect(h.state).toMatchObject({ cat: 0, step: 'show', ready: [], deadline: T0 + 7000 + SLF.showS * 1000 });
      expect(h.state.results).toHaveLength(1);
      h.undo(T0 + 8000);
      expect(h.state).toMatchObject({ cat: 0, step: 'vote', results: [] });
    });

    it('"end" while judging comes back to judging with nobody having judged', () => {
      const h = imageHost();
      h.intent('a', { a: 'judge', cat: 0, ok: { b: true }, best: 'b' }, T0, false);
      h.intent('a', { a: 'end' }, T0, true);
      h.undo(T0 + 1000);
      expect(h.state).toMatchObject({ phase: 'rate', step: 'vote', judged: [] });
      judge(h, { c: true });
      expect(h.state.step).toBe('show');
    });
  });
});

describe('Stadt, Land, Fluss: Zug zurück (over the network)', async () => {
  const { LocalGameRoom } = await import('../src/game/minigame');
  const { SlfGame } = await import('../src/game/slf/game');
  type Room = InstanceType<typeof LocalGameRoom>;
  const ids = ['a', 'b', 'c'];
  const until = async (room: Room, done: () => boolean) => {
    for (let i = 0; i < 300 && !done(); i++) {
      room.pump();
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(done()).toBe(true);
  };

  it('text: a flag vote taken back can be raised and voted on again by every client', async () => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 2, name: 'A' },
      { id: 'b', seat: 0, name: 'B' },
      { id: 'c', seat: 1, name: 'C' },
    ]);
    const g = Object.fromEntries(ids.map((id) => [id, new SlfGame(room.net(id), { decks: () => ['normal'], mode: () => 'text' })]));
    g.a.start();
    room.pump();
    const L = g.b.state!.letter;
    const n = g.b.state!.categories.length;
    ids.forEach((id, k) => {
      for (let c = 0; c < n; c++) g[id].setText(c, `${L}${'xyz'[k]}${c}`);
    });
    expect(await g.a.stop()).toBe(true);
    (g.a as unknown as { host: SlfHost }).host.state.deadline = Date.now() - 1;
    g.a.tick(performance.now());
    await until(room, () => ids.every((id) => !!g[id].state?.answers));
    expect(g.a.canUndo).toBe(false);

    // b calls c's answer invalid, a agrees: it's out.
    g.b.flagBad('c');
    room.pump();
    expect(g.c.state!.vote).not.toBeNull();
    g.a.vote(true);
    room.pump();
    for (const id of ids) expect(g[id].state!.flags[0]).toMatchObject({ target: 'c', result: 'yes' });
    expect(g.a.iVoted).toBe(false);
    expect(g.a.canUndo).toBe(true);
    // Only the host can take a move back.
    expect(g.b.canUndo).toBe(false);
    g.b.undo();
    room.pump();
    expect(g.c.state!.flags).toHaveLength(1);

    g.a.undo();
    room.pump();
    for (const id of ids) expect(g[id].state).toMatchObject({ undo: 1, phase: 'rate', cat: 0, flags: [], vote: null });
    expect(g.a.canUndo).toBe(false);

    // The same flag again: nobody counts as having voted already, the clients' votes go through.
    g.b.flagBad('c');
    room.pump();
    expect(g.a.iVoted).toBe(false);
    g.a.vote(false);
    room.pump();
    for (const id of ids) expect(g[id].state!.flags[0]).toMatchObject({ target: 'c', result: 'no', yes: 1, no: 1 });
    expect(g.a.iVoted).toBe(false);
    // The answers survived the round trip.
    expect(g.c.answersView()!.a[0]).toBe(`${L}x0`);
  });
});
