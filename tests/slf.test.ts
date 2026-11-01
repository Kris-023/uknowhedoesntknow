import { afterEach, describe, expect, it } from 'vitest';
import { SLF } from '../src/config';
import { mulberry32 } from '../src/core/rng';
import { botAnswer, botWords } from '../src/game/slf/botWords';
import {
  applyEdit,
  categoryGroups,
  categoryPool,
  classicCategories,
  cleanCategory,
  defaultCategories,
  drawCategories,
  editKey,
  isLocked,
  parseEdit,
  type Edit,
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
import { FIXTURE, useFixture } from './fixtures/content';

const H = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const T0 = 1_000_000;
/** A tiny JPEG-shaped data URL: the format check only looks at the header and alphabet. */
const pic = (s: string) => `data:image/jpeg;base64,${btoa(s)}`;
/** Host: start a round and take the categories as they come (the step "Kategorien" has its own tests). */
const begin = (g: { start(): void; go(): boolean }) => {
  g.start();
  expect(g.go()).toBe(true);
};

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
  /** An unlocked deck with more text categories than a round needs (made up, not deck content). */
  const BIG = { ...FIXTURE, slf: { ...FIXTURE.slf, text: ['Stadt', 'Land', 'Fluss', 'Name', 'Tier', 'Beruf', 'Farbe', 'Sport', 'Musikinstrument', 'Getränk'] } };

  it('"Klassisch" is Stadt, Land, Fluss filled up from the public fallback', () => {
    expect(classicCategories('text')).toEqual([...FALLBACK.slf.text].slice(0, SLF.count.text));
    expect(classicCategories('text').slice(0, 3)).toEqual(['Stadt', 'Land', 'Fluss']);
    expect(classicCategories('bild')).toEqual(['Stadt', 'Land', 'Fluss']);
  });

  it('locked: the default is "Klassisch"; unlocked: a random draw, Stadt, Land, Fluss not forced', () => {
    expect(isLocked()).toBe(true);
    expect(isLocked(FIXTURE)).toBe(false);
    for (let i = 0; i < 5; i++) expect(defaultCategories('text', ['normal', 'custom'], ['Kollege'], rng)).toEqual(classicCategories('text'));
    expect(defaultCategories('bild', ['normal'], [], rng)).toEqual(classicCategories('bild'));
    const lists = new Set<string>();
    let withoutClassics = 0;
    for (let i = 0; i < 40; i++) {
      const cats = defaultCategories('text', ['normal'], [], rng, BIG);
      expect(cats).toHaveLength(SLF.count.text);
      expect(new Set(cats).size).toBe(SLF.count.text);
      for (const c of cats) expect(BIG.slf.text).toContain(c);
      lists.add([...cats].sort().join());
      if (!['Stadt', 'Land', 'Fluss'].every((c) => cats.includes(c))) withoutClassics++;
    }
    expect(lists.size).toBeGreaterThan(5);
    expect(withoutClassics).toBeGreaterThan(0);
  });

  it('the pool: built-ins by deck (locked: the fallback), NSFW only with that deck, own ones only with "Eigene"', () => {
    const extra = FIXTURE.slf.nsfw[0];
    expect(categoryPool('text', ['normal'], [], FIXTURE)).not.toContain(extra);
    expect(categoryPool('text', ['normal', 'nsfw'], [], FIXTURE)).toContain(extra);
    expect(categoryPool('bild', ['normal', 'nsfw'], [], FIXTURE)).toContain(extra);
    // Locked: the fallback, Stadt, Land, Fluss included now (they are no longer forced in).
    expect(categoryPool('text', ['normal', 'nsfw'], []).sort()).toEqual([...FALLBACK.slf.text].sort());
    expect(categoryPool('text', ['normal'], ['Kollege'])).not.toContain('Kollege');
    const mixed = categoryPool('text', ['normal', 'custom'], ['Kollege', 'Stadt']);
    expect(mixed).toContain('Kollege');
    expect(mixed.filter((c) => c === 'Stadt')).toHaveLength(1);
    expect(categoryGroups('text', ['normal', 'nsfw', 'custom'], ['Kollege'], FIXTURE).map((g) => g.label)).toEqual(['Normal', 'NSFW', 'Eigene']);
    expect(categoryGroups('text', ['normal', 'custom'], ['Kollege']).map((g) => g.label)).toEqual(['Ersatzstapel', 'Eigene']);
  });

  it('only "Eigene": own categories alone if there are enough (the default draws from them, locked or not)', () => {
    const six = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
    expect(categoryPool('text', ['custom'], six)).toEqual(six);
    expect(categoryPool('text', ['custom'], ['A1'])).toContain('Stadt');
    expect(categoryPool('bild', ['custom'], ['A1', 'A2', 'A3'])).toEqual(['A1', 'A2', 'A3']);
    expect([...defaultCategories('text', ['custom'], six, rng)].sort()).toEqual(six);
  });

  it('picture rounds draw picturable categories, never twice', () => {
    for (let i = 0; i < 30; i++) {
      const cats = drawCategories(categoryPool('bild', ['normal'], []), SLF.count.bild, rng);
      expect(cats).toHaveLength(3);
      expect(new Set(cats).size).toBe(3);
      for (const c of cats) expect(FALLBACK.slf.image).toContain(c);
    }
    expect(drawCategories(['A', 'B', 'C'], 5, rng, ['b'])).toHaveLength(2);
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
    begin(g.a);
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
    begin(g.a);
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
    begin(g.a);
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
      begin(g.a);
      room.pump();
      expect([...g.b.state!.categories].sort()).toEqual([...own].sort());
    }
    // Unlocked (locked rooms start with "Klassisch"), an own one is drawn now and then.
    const undo = useFixture();
    let seen = 0;
    try {
      for (let i = 0; i < 20; i++) {
        const { room, g } = make('text', ['Kollege'], ['normal', 'custom']);
        begin(g.a);
        room.pump();
        if (g.b.state!.categories.includes('Kollege')) seen++;
      }
    } finally {
      undo();
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('absent() names who is gone; drop needs the host to see them gone too', async () => {
    const { room, g } = make();
    begin(g.a);
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
    begin(gg.a);
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
    begin(gg.a);
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
    begin(g.a);
    room.pump();
    const before = JSON.stringify(g.c.state);
    room.net('b').send('sl:state', { ...g.a.state, letter: 'Q', sentAt: Date.now() }, 'c');
    room.net('b').send('sl:reveal', { round: 1, cat: 0, answers: ['x'], salt: 'zz' });
    room.pump();
    expect(JSON.stringify(g.c.state)).toBe(before);
  });
  describe('reload (F5): the tab store and the others give it back', () => {
    const fakeStorage = (blocked: (key: string) => boolean = () => false): Storage => {
      const m = new Map<string, string>();
      return {
        get length() {
          return m.size;
        },
        key: (i) => [...m.keys()][i] ?? null,
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => {
          if (blocked(k)) throw new Error('QuotaExceededError');
          m.set(k, String(v));
        },
        removeItem: (k) => void m.delete(k),
        clear: () => m.clear(),
      };
    };
    const install = (s: Storage) => Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: s });
    afterEach(() => {
      delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    });
    /** Three players; `b` reloads as `b2` (same seat, a new id). */
    const withReload = (mode: 'text' | 'bild') => {
      const room = new LocalGameRoom([
        { id: 'a', seat: 2, name: 'A' },
        { id: 'b', seat: 0, name: 'B' },
        { id: 'c', seat: 1, name: 'C' },
        { id: 'b2', seat: 0, name: 'B' },
      ]);
      const late = room.roster.pop()!;
      // One storage stands for one tab: only b's tab keeps drafts, the others (same fake storage) don't.
      const make = (id: string) => new SlfGame(room.net(id), { decks: () => ['normal'], mode: () => mode }, id.startsWith('b'));
      const gg: Record<string, InstanceType<typeof SlfGame>> = Object.fromEntries(['a', 'b', 'c'].map((id) => [id, make(id)]));
      /** The old tab dies: it hears nothing any more. */
      const kill = () => {
        (gg.b as unknown as { applyState: () => void }).applyState = () => {};
      };
      const reload = () => {
        // The new tab starts fresh (new instance, same sessionStorage) and hears the room from now on.
        gg.b2 = make('b2');
        room.roster.splice(1, 1, { ...late, seat: 0 });
        gg.a.rejoin('b', 'b2');
        room.pump();
      };
      return { room, gg, kill, reload };
    };
    const keys = (s: Storage) => Array.from({ length: s.length }, (_, i) => s.key(i)!);

    it('typed answers survive a reload', () => {
      install(fakeStorage());
      const { room, gg, kill, reload } = withReload('text');
      begin(gg.a);
      room.pump();
      gg.b.setText(0, 'Berlin');
      gg.b.setText(2, 'Elbe');
      kill();
      reload();
      expect(gg.b2.state!.round).toBe(gg.b.state!.round);
      expect(gg.b2.draft.texts.slice(0, 3)).toEqual(['Berlin', '', 'Elbe']);
      expect(gg.b2.canEdit).toBe(true);
    });

    it('a reload in the lock phase commits the restored draft, not an empty one', async () => {
      install(fakeStorage());
      const { room, gg, kill, reload } = withReload('text');
      begin(gg.a);
      room.pump();
      const L = gg.a.state!.letter;
      const n = gg.a.state!.categories.length;
      for (const id of ['a', 'c']) for (let c = 0; c < n; c++) gg[id].setText(c, `${L}${id}${c}`);
      for (let c = 0; c < n; c++) gg.b.setText(c, `${L}bb${c}`);
      await gg.a.stop();
      await gg.c.stop();
      room.pump();
      kill();
      expire(gg.a);
      gg.a.tick(performance.now());
      room.pump();
      expect(gg.a.state!.phase).toBe('lock');
      reload();
      await until(room, () => gg.a.state?.phase === 'rate');
      for (const id of ['a', 'c', 'b2']) await until(room, () => !!gg[id].state?.answers);
      expect(gg.a.state!.answers!.b2).toEqual(Array.from({ length: n }, (_, c) => `${L}bb${c}`));
    });

    it('a reload during the reveal brings back my commitment and pictures (tab store)', async () => {
      install(fakeStorage());
      const { room, gg, kill, reload } = withReload('bild');
      begin(gg.a);
      room.pump();
      const L = gg.a.state!.letter;
      for (const id of ['a', 'b', 'c'])
        for (let c = 0; c < 3; c++) {
          gg[id].setPic(c, pic(`${id}${c}`));
          gg[id].setCaption(c, `${L}${id}`);
        }
      // b never gets to reveal: it is gone as soon as the writing is over.
      (gg.b as unknown as { sendReveals: () => void }).sendReveals = () => {};
      for (const id of ['a', 'b', 'c']) await gg[id].stop();
      await until(room, () => gg.a.state?.phase === 'reveal');
      kill();
      reload();
      await until(room, () => gg.a.state?.phase === 'rate' && !!gg.b2.picOf('b2', 2) && !!gg.b2.picOf('a', 1) && !!gg.a.picOf('b2', 0));
      expect(gg.b2.picOf('b2', 1)).toEqual({ img: pic('b1'), cap: `${L}b` });
      expect(gg.a.picOf('b2', 0)).toEqual({ img: pic('b0'), cap: `${L}b` });
      expect(gg.b2.locked).toBe(true);
    });

    it('text: the commitment is back after a reload during the reveal', async () => {
      install(fakeStorage());
      const { room, gg, kill, reload } = withReload('text');
      begin(gg.a);
      room.pump();
      const L = gg.a.state!.letter;
      const n = gg.a.state!.categories.length;
      for (const id of ['a', 'b', 'c']) for (let c = 0; c < n; c++) gg[id].setText(c, `${L}${id}${c}`);
      (gg.b as unknown as { sendReveals: () => void }).sendReveals = () => {};
      for (const id of ['a', 'b', 'c']) await gg[id].stop();
      await until(room, () => gg.a.state?.phase === 'reveal');
      kill();
      reload();
      await until(room, () => gg.a.state?.phase === 'rate');
      expect(gg.a.state!.answers!.b2).toEqual(Array.from({ length: n }, (_, c) => `${L}b${c}`));
      expect(gg.b2.locked).toBe(true);
    });

    it('if the tab store is full, the others give the pictures back', async () => {
      const store = fakeStorage((k) => k.includes('.p.'));
      install(store);
      const { room, gg, kill, reload } = withReload('bild');
      begin(gg.a);
      room.pump();
      const L = gg.a.state!.letter;
      for (const id of ['a', 'b', 'c'])
        for (let c = 0; c < 3; c++) {
          gg[id].setPic(c, pic(`${id}${c}`));
          gg[id].setCaption(c, `${L}${id}`);
        }
      expect(keys(store).some((k) => k.includes('.p.'))).toBe(false);
      for (const id of ['a', 'b', 'c']) await gg[id].stop();
      await until(room, () => ['a', 'b', 'c'].every((id) => gg[id].state?.phase === 'rate') && !!gg.a.picOf('b', 2) && !!gg.c.picOf('b', 2));
      kill();
      reload();
      // The reloaded tab has no draft; its own pictures come from the others' proofs.
      expect(gg.b2.draft.pics.every((p) => !p.img)).toBe(true);
      const tick = () => gg.b2.tick(performance.now());
      await until(room, () => gg.b2.locked && !!gg.b2.picOf('b2', 2), tick);
      expect(gg.b2.picOf('b2', 0)).toEqual({ img: pic('b0'), cap: `${L}b` });
      expect(gg.b2.picOf('a', 1)).toEqual({ img: pic('a1'), cap: `${L}a` });
    });

    it('a liar cannot hand me wrong answers: they must match my commitment', async () => {
      install(fakeStorage((k) => k.includes('salt.')));
      const { room, gg, kill, reload } = withReload('text');
      begin(gg.a);
      room.pump();
      const L = gg.a.state!.letter;
      const n = gg.a.state!.categories.length;
      for (const id of ['a', 'b', 'c']) for (let c = 0; c < n; c++) gg[id].setText(c, `${L}${id}${c}`);
      for (const id of ['a', 'b', 'c']) await gg[id].stop();
      await until(room, () => ['a', 'b', 'c'].every((id) => gg[id].state?.phase === 'rate') && !!gg.a.state?.answers);
      kill();
      // Peers invent other answers for b2.
      const lie = () => ({ round: gg.a.state!.round, salt: 'x'.repeat(32), texts: Array.from({ length: n }, () => `${L}fake`) });
      for (const id of ['a', 'c']) (gg[id] as unknown as { proofFor: () => unknown }).proofFor = lie;
      reload();
      for (let i = 0; i < 15; i++) {
        room.pump();
        gg.b2.tick(performance.now());
        await new Promise((r) => setTimeout(r, 2));
      }
      expect(gg.b2.locked).toBe(false);
    });

    it('the stored draft goes with the round: the end clears it', async () => {
      const store = fakeStorage();
      install(store);
      const { room, gg } = withReload('text');
      begin(gg.a);
      room.pump();
      gg.b.setText(0, 'Berlin');
      expect(keys(store).length).toBeGreaterThan(0);
      gg.a.end();
      await until(room, () => gg.b.state?.phase === 'done');
      expect(keys(store)).toEqual([]);
    });
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
    begin(g.a);
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

describe('Stadt, Land, Fluss: the step "Kategorien"', () => {
  const P = ['a', 'b', 'c'];
  const CATS = ['Stadt', 'Land', 'Fluss', 'Name', 'Tier', 'Beruf'];
  const POOL = ['Stadt', 'Land', 'Fluss', 'Name', 'Tier', 'Beruf', 'Farbe', 'Sport'];
  const picking = (cats = CATS, mode: 'text' | 'bild' = 'text') => {
    const h = SlfHost.picking(P, mode, cats, { a: 2 }, 3);
    h.pool = () => POOL;
    h.rng = mulberry32(7);
    return h;
  };
  const pick = (h: SlfHost, from: string, e: Parameters<typeof parseIntent>[0], host = from === 'a', now = T0) => {
    const i = parseIntent({ a: 'pick', e });
    expect(i).not.toBeNull();
    return h.intent(from, i!, now, host);
  };

  it('starts without letter and timer; the host starts the writing with a letter, within the bounds', () => {
    const h = picking();
    expect(h.state).toMatchObject({ phase: 'pick', letter: '', deadline: null, proposals: [], keep: false, round: 3, scores: { a: 2, b: 0, c: 0 } });
    expect(h.tick(T0 + 10 * 3600_000)).toBe(false);
    expect(h.state.phase).toBe('pick');
    expect(h.begin('', T0)).toBe(false);
    expect(h.begin('B', T0, ['a'])).toBe(false);
    // Someone who joined meanwhile plays along.
    expect(h.begin('B', T0, ['a', 'b', 'c', 'd'])).toBe(true);
    expect(h.state).toMatchObject({ phase: 'write', letter: 'B', players: ['a', 'b', 'c', 'd'], deadline: T0 + SLF.writeS * 1000 });
    expect(h.state.scores.d).toBe(0);
    expect(h.begin('C', T0)).toBe(false);
    const short = picking(['Stadt', 'Land', 'Fluss']);
    expect(short.begin('B', T0)).toBe(false);
    const pics = picking(['Tier', 'Essen'], 'bild');
    expect(pics.begin('B', T0)).toBe(true);
    expect(pics.state.deadline).toBe(T0 + SLF.imageS * 1000);
  });

  it('host edits apply at once: replace, roll, add, remove, presets; bounds and duplicates hold', () => {
    const h = picking();
    expect(pick(h, 'a', { op: 'set', at: 'Tier', text: 'Farbe', how: 'pool' })).toBe(true);
    expect(h.state.categories).toEqual(['Stadt', 'Land', 'Fluss', 'Name', 'Farbe', 'Beruf']);
    // Already in the list (case and spaces aside), or not there to replace.
    expect(pick(h, 'a', { op: 'set', at: 'Name', text: ' stadt ', how: 'free' })).toBe(false);
    expect(pick(h, 'a', { op: 'set', at: 'Tier', text: 'Hobby', how: 'free' })).toBe(false);
    expect(pick(h, 'a', { op: 'roll', at: 'Beruf' })).toBe(true);
    const rolled = h.state.categories[5];
    expect(['Tier', 'Sport']).toContain(rolled);
    expect(pick(h, 'a', { op: 'add', text: 'Hobby', how: 'free' })).toBe(true);
    expect(pick(h, 'a', { op: 'add', text: null })).toBe(true);
    expect(h.state.categories).toHaveLength(8);
    expect(pick(h, 'a', { op: 'add', text: 'Getränk', how: 'free' })).toBe(true);
    expect(pick(h, 'a', { op: 'add', text: 'Gemüse', how: 'free' })).toBe(true);
    expect(h.state.categories).toHaveLength(SLF.pick.max.text);
    expect(pick(h, 'a', { op: 'add', text: 'Sportart', how: 'free' })).toBe(false);
    for (const c of [...h.state.categories].slice(0, 6)) pick(h, 'a', { op: 'remove', at: c });
    expect(h.state.categories).toHaveLength(SLF.pick.min.text);
    expect(pick(h, 'a', { op: 'remove', at: h.state.categories[0] })).toBe(false);
    expect(pick(h, 'a', { op: 'preset', name: 'klassisch' })).toBe(true);
    expect(h.state.categories).toEqual(classicCategories('text'));
    // The same list again changes nothing.
    expect(pick(h, 'a', { op: 'preset', name: 'klassisch' })).toBe(false);
    expect(pick(h, 'a', { op: 'preset', name: 'zufall' })).toBe(true);
    expect(h.state.categories).toHaveLength(SLF.count.text);
    for (const c of h.state.categories) expect(POOL).toContain(c);
    // A pool that is used up: nothing left to roll.
    const used = picking();
    used.pool = () => CATS;
    expect(pick(used, 'a', { op: 'add', text: null })).toBe(false);
    expect(pick(used, 'a', { op: 'roll', at: 'Tier' })).toBe(false);
    // Pictures have their own bounds.
    const b = picking(['Tier', 'Essen', 'Beruf'], 'bild');
    expect(pick(b, 'a', { op: 'remove', at: 'Tier' })).toBe(true);
    expect(pick(b, 'a', { op: 'remove', at: 'Essen' })).toBe(false);
  });

  it('everybody else proposes; the host accepts or rejects, the author may withdraw', () => {
    const h = picking();
    expect(pick(h, 'b', { op: 'set', at: 'Tier', text: 'Hobby', how: 'free' })).toBe(true);
    expect(pick(h, 'c', { op: 'roll', at: 'Name' })).toBe(true);
    expect(h.state.categories).toEqual(CATS);
    expect(h.state.proposals).toMatchObject([
      { id: 1, by: 'b', edit: { op: 'set', at: 'Tier', text: 'Hobby', how: 'free' } },
      { id: 2, by: 'c', edit: { op: 'set', at: 'Name', how: 'roll' } },
    ]);
    // The roll is drawn when it is proposed, so the host sees what it would be.
    expect(['Farbe', 'Sport']).toContain((h.state.proposals[1].edit as Extract<Edit, { op: 'set' }>).text);
    // Only the host decides; only the author withdraws.
    expect(h.intent('b', { a: 'accept', id: 1 }, T0, false)).toBe(false);
    expect(h.intent('c', { a: 'withdraw', id: 1 }, T0, false)).toBe(false);
    expect(h.intent('a', { a: 'accept', id: 1 }, T0, true)).toBe(true);
    expect(h.state.categories).toEqual(['Stadt', 'Land', 'Fluss', 'Name', 'Hobby', 'Beruf']);
    expect(h.intent('a', { a: 'reject', id: 2 }, T0, true)).toBe(true);
    expect(h.state.categories).toEqual(['Stadt', 'Land', 'Fluss', 'Name', 'Hobby', 'Beruf']);
    expect(h.state.proposals).toEqual([]);
    expect(h.intent('a', { a: 'accept', id: 2 }, T0, true)).toBe(false);
    expect(pick(h, 'c', { op: 'remove', at: 'Beruf' })).toBe(true);
    expect(h.intent('c', { a: 'withdraw', id: 3 }, T0, false)).toBe(true);
    expect(h.state.proposals).toEqual([]);
    // Strangers (not in the round, not in the room) cannot propose; someone in the room who joined late can.
    expect(pick(h, 'x', { op: 'remove', at: 'Beruf' }, false)).toBe(false);
    h.present = new Set([...P, 'x']);
    expect(pick(h, 'x', { op: 'remove', at: 'Beruf' }, false)).toBe(true);
  });

  it('at most a few open proposals per player; duplicates and pointless ones are dropped', () => {
    const h = picking();
    expect(pick(h, 'b', { op: 'add', text: 'Hobby', how: 'free' })).toBe(true);
    // Same thing again, from b or from c: one is enough. A roll of the same category too.
    expect(pick(h, 'b', { op: 'add', text: 'hobby', how: 'free' })).toBe(false);
    expect(pick(h, 'c', { op: 'add', text: 'Hobby', how: 'pool' })).toBe(false);
    expect(pick(h, 'b', { op: 'roll', at: 'Tier' })).toBe(true);
    expect(pick(h, 'c', { op: 'roll', at: 'Tier' })).toBe(false);
    // Pointless: not in the list, already in it.
    expect(pick(h, 'c', { op: 'remove', at: 'Hobby' })).toBe(false);
    expect(pick(h, 'c', { op: 'add', text: 'Stadt', how: 'free' })).toBe(false);
    expect(pick(h, 'b', { op: 'remove', at: 'Land' })).toBe(true);
    expect(h.state.proposals.filter((p) => p.by === 'b')).toHaveLength(SLF.pick.maxProposals);
    expect(pick(h, 'b', { op: 'remove', at: 'Fluss' })).toBe(false);
    expect(pick(h, 'c', { op: 'remove', at: 'Fluss' })).toBe(true);
    expect(editKey({ op: 'set', at: 'Tier', text: 'X', how: 'roll' })).toBe(editKey({ op: 'set', at: ' tier', text: 'Y', how: 'roll' }));
  });

  it('a host change makes proposals about it pointless: they go; merely out of bounds stays', () => {
    const h = picking(['Stadt', 'Land', 'Fluss', 'Name', 'Tier', 'Beruf', 'Farbe', 'Sport', 'Hobby']);
    pick(h, 'b', { op: 'set', at: 'Tier', text: 'Getränk', how: 'free' });
    pick(h, 'c', { op: 'add', text: 'Gemüse', how: 'free' });
    pick(h, 'c', { op: 'add', text: 'Band', how: 'free' });
    expect(h.state.proposals).toHaveLength(3);
    pick(h, 'a', { op: 'remove', at: 'Tier' });
    pick(h, 'a', { op: 'add', text: 'Gemüse', how: 'free' });
    pick(h, 'a', { op: 'add', text: 'Kleidung', how: 'free' });
    expect(h.state.categories).toHaveLength(SLF.pick.max.text);
    expect(h.state.proposals.map((p) => p.edit)).toEqual([{ op: 'add', text: 'Band', how: 'free' }]);
    // Full: accepting fails and the proposal waits; after a removal it fits.
    expect(h.intent('a', { a: 'accept', id: 3 }, T0, true)).toBe(false);
    expect(h.state.proposals).toHaveLength(1);
    pick(h, 'a', { op: 'remove', at: 'Kleidung' });
    expect(h.intent('a', { a: 'accept', id: 3 }, T0, true)).toBe(true);
    expect(h.state.categories.at(-1)).toBe('Band');
  });

  it('validates what comes from the network', () => {
    expect(parseIntent({ a: 'pick', e: { op: 'set', at: 'Tier', text: '  Haus\ntier  ', how: 'free' } })).toEqual({ a: 'pick', e: { op: 'set', at: 'Tier', text: 'Haus tier', how: 'free' } });
    expect(parseIntent({ a: 'pick', e: { op: 'set', at: 'Tier', text: 'x'.repeat(SLF.pick.maxLen + 1), how: 'free' } })).toBeNull();
    expect(parseIntent({ a: 'pick', e: { op: 'set', at: 'Tier', text: 'Hobby', how: 'roll' } })).toBeNull();
    expect(parseIntent({ a: 'pick', e: { op: 'set', at: '', text: 'Hobby', how: 'free' } })).toBeNull();
    expect(parseIntent({ a: 'pick', e: { op: 'add', text: null, how: 'free' } })).toEqual({ a: 'pick', e: { op: 'add', text: null, how: 'roll' } });
    expect(parseIntent({ a: 'pick', e: { op: 'add', text: 7, how: 'free' } })).toBeNull();
    expect(parseIntent({ a: 'pick', e: { op: 'preset', name: 'alles' } })).toBeNull();
    expect(parseIntent({ a: 'pick', e: { op: 'swap', at: 'Tier' } })).toBeNull();
    expect(parseIntent({ a: 'pick', e: 'Tier' })).toBeNull();
    expect(parseIntent({ a: 'accept', id: 0 })).toBeNull();
    expect(parseIntent({ a: 'reject', id: 1.5 })).toBeNull();
    expect(parseIntent({ a: 'withdraw', id: 3 })).toEqual({ a: 'withdraw', id: 3 });
    expect(parseIntent({ a: 'keep', on: 'ja' })).toBeNull();
    expect(cleanCategory('\u0007Tier\u0000')).toBe('Tier');
    expect(cleanCategory('   ')).toBeNull();
    expect(cleanCategory('x'.repeat(30), SLF.pick.maxTyped)).toBeNull();
    expect(parseEdit({ op: 'preset', name: 'zufall', list: ['A', 'B', 'C', 'D'] })).toEqual({ op: 'preset', name: 'zufall', list: ['A', 'B', 'C', 'D'] });
    expect(parseEdit({ op: 'preset', name: 'zufall', list: Array(SLF.pick.max.text + 1).fill('A') })).toBeNull();
    expect(parseEdit({ op: 'preset', name: 'zufall', list: ['A', ''] })).toBeNull();
    expect(applyEdit(['A', 'B', 'C', 'D'], { op: 'remove', at: 'a' }, 'text')).toBeNull();
    expect(applyEdit(['A', 'B', 'C'], { op: 'remove', at: 'a' }, 'bild')).toEqual(['B', 'C']);
  });

  it('only the host keeps the list for the next rounds; the toggle is no move', () => {
    const h = picking();
    expect(h.intent('b', { a: 'keep', on: true }, T0, false)).toBe(false);
    expect(h.intent('a', { a: 'keep', on: true }, T0, true)).toBe(true);
    expect(h.state.keep).toBe(true);
    expect(h.canUndo).toBe(false);
  });

  it('Zug zurück while picking: a change, an accept or a reject goes back; later proposals stay', () => {
    const h = picking();
    pick(h, 'a', { op: 'remove', at: 'Beruf' });
    expect(h.canUndo).toBe(true);
    pick(h, 'b', { op: 'set', at: 'Tier', text: 'Hobby', how: 'free' });
    h.intent('a', { a: 'accept', id: 1 }, T0, true);
    pick(h, 'c', { op: 'add', text: 'Farbe', how: 'pool' });
    h.intent('a', { a: 'keep', on: true }, T0, true);
    expect(h.undo(T0)).toBe(true);
    // The accept is undone: Tier is back, b's proposal waits again, c's (newer) is still there.
    expect(h.state).toMatchObject({ phase: 'pick', undo: 1, deadline: null, keep: true, seq: 2 });
    expect(h.state.categories).toEqual(['Stadt', 'Land', 'Fluss', 'Name', 'Tier']);
    expect(h.state.proposals.map((p) => p.id)).toEqual([1, 2]);
    h.intent('a', { a: 'reject', id: 2 }, T0, true);
    expect(h.undo(T0)).toBe(true);
    expect(h.state.proposals.map((p) => p.id)).toEqual([1, 2]);
    expect(h.undo(T0)).toBe(true);
    expect(h.state.categories).toEqual(CATS);
    expect(h.canUndo).toBe(false);
  });

  it('Zug zurück never leads from the writing back into the pick step; "end" while picking does', () => {
    const h = picking();
    pick(h, 'a', { op: 'remove', at: 'Beruf' });
    expect(h.begin('B', T0)).toBe(true);
    expect(h.canUndo).toBe(false);
    expect(h.undo(T0)).toBe(false);
    const e = picking();
    expect(e.intent('a', { a: 'end' }, T0, true)).toBe(true);
    expect(e.state.phase).toBe('done');
    expect(e.undo(T0)).toBe(true);
    expect(e.state).toMatchObject({ phase: 'pick', deadline: null, letter: '' });
  });

  it('a new host carries on from the public state, proposals and all; rejoin and leaving follow', () => {
    const h = picking();
    pick(h, 'b', { op: 'set', at: 'Tier', text: 'Hobby', how: 'free' });
    pick(h, 'c', { op: 'remove', at: 'Name' });
    const n = SlfHost.fromState(structuredClone(h.state));
    n.pool = () => POOL;
    expect(n.state).toMatchObject({ phase: 'pick', deadline: null, seq: 2 });
    expect(n.state.proposals).toHaveLength(2);
    expect(n.intent('b', { a: 'accept', id: 2 }, T0, true)).toBe(true);
    expect(n.state.categories).not.toContain('Name');
    pick(n, 'c', { op: 'add', text: 'Farbe', how: 'pool' }, false);
    expect(n.state.proposals.map((p) => p.id)).toEqual([1, 3]);
    // b reloads: the proposal follows the new id.
    n.replace('b', 'b2');
    expect(n.state.proposals[0].by).toBe('b2');
    expect(n.intent('b2', { a: 'withdraw', id: 1 }, T0, false)).toBe(true);
    pick(n, 'b2', { op: 'add', text: 'Sport', how: 'pool' }, false);
    // c leaves for good: c's proposals go with them.
    n.removePlayer('c', T0);
    expect(n.state.proposals.map((p) => p.by)).toEqual(['b2']);
    expect(n.state.phase).toBe('pick');
    n.removePlayer('b2', T0);
    expect(n.state.phase).toBe('done');
  });
});

describe('Stadt, Land, Fluss: the step "Kategorien" over the network', async () => {
  const { LocalGameRoom } = await import('../src/game/minigame');
  const { SlfGame, parseState } = await import('../src/game/slf/game');
  const ids = ['a', 'b', 'c'];
  const make = (mode: () => 'text' | 'bild' = () => 'text') => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 2, name: 'A' },
      { id: 'b', seat: 0, name: 'B' },
      { id: 'c', seat: 1, name: 'C' },
    ]);
    const g = Object.fromEntries(ids.map((id) => [id, new SlfGame(room.net(id), { decks: () => ['normal', 'custom'], mode, custom: () => ['Kollege', 'Ausrede'] })]));
    return { room, g };
  };

  it('locked: the round starts with "Klassisch"; proposals travel, the host decides, everyone sees the same list', () => {
    const { room, g } = make();
    g.a.start();
    room.pump();
    for (const id of ids) expect(g[id].state).toMatchObject({ phase: 'pick', letter: '', categories: classicCategories('text') });
    // Everyone sees the pool: the fallback and the room's own lists.
    expect(g.c.poolGroups().map((x) => x.label)).toEqual(['Ersatzstapel', 'Eigene']);
    g.b.replaceCat('Tier', 'Haustier', 'free');
    g.c.roll('Beruf');
    room.pump();
    expect(g.a.state!.proposals.map((p) => p.by)).toEqual(['b', 'c']);
    for (const id of ids) expect(g[id].state!.proposals).toHaveLength(2);
    expect(g.b.myProposals).toBe(1);
    const [p1, p2] = g.a.state!.proposals;
    // Non-hosts cannot decide.
    g.c.accept(p1.id);
    room.pump();
    expect(g.a.state!.proposals).toHaveLength(2);
    g.a.accept(p1.id);
    g.a.reject(p2.id);
    room.pump();
    for (const id of ids) {
      expect(g[id].state!.categories).toEqual(['Stadt', 'Land', 'Fluss', 'Name', 'Haustier', 'Beruf']);
      expect(g[id].state!.proposals).toEqual([]);
    }
    // The host's own change applies at once.
    g.a.addCat(null);
    room.pump();
    expect(g.c.state!.categories).toHaveLength(7);
    expect(['Kollege', 'Ausrede', 'Tier']).toContain(g.c.state!.categories[6]);
    expect(g.b.go()).toBe(false);
    expect(g.a.go()).toBe(true);
    room.pump();
    for (const id of ids) expect(g[id].state).toMatchObject({ phase: 'write', categories: g.a.state!.categories });
    expect(g.b.state!.letter).toMatch(/^[A-Z]$/);
  });

  it('"Behalten": the next round starts with the same list, still editable; a new mode draws anew', () => {
    let mode: 'text' | 'bild' = 'text';
    const { room, g } = make(() => mode);
    g.a.start();
    g.a.preset('zufall');
    g.a.removeCat(g.a.state!.categories[0]);
    g.a.setKeep(true);
    g.b.setKeep(false);
    room.pump();
    const list = [...g.a.state!.categories];
    expect(g.c.state!.keep).toBe(true);
    expect(g.a.go()).toBe(true);
    g.a.end();
    room.pump();
    g.a.start();
    room.pump();
    expect(g.b.state).toMatchObject({ phase: 'pick', round: 2, keep: true, categories: list });
    g.a.removeCat(list[0]);
    room.pump();
    expect(g.b.state!.categories).toEqual(list.slice(1));
    g.a.go();
    g.a.end();
    g.a.start();
    room.pump();
    expect(g.b.state!.categories).toEqual(list.slice(1));
    // Off again: the default.
    g.a.setKeep(false);
    g.a.go();
    g.a.end();
    g.a.start();
    room.pump();
    expect(g.b.state).toMatchObject({ keep: false, categories: classicCategories('text') });
    // Kept, but now pictures: a picture round gets its own list.
    g.a.setKeep(true);
    g.a.go();
    g.a.end();
    mode = 'bild';
    g.a.start();
    room.pump();
    expect(g.b.state).toMatchObject({ mode: 'bild', keep: true, categories: classicCategories('bild') });
  });

  it('a new host mid-pick keeps list and proposals; a reload brings the pick view back', () => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 2, name: 'A' },
      { id: 'b', seat: 0, name: 'B' },
      { id: 'c', seat: 1, name: 'C' },
      { id: 'c2', seat: 1, name: 'C' },
    ]);
    // c2 is c after a reload: known to the hub, not in the room yet.
    const late = room.roster.pop()!;
    let host = 'a';
    const opts = { decks: () => ['normal', 'custom'] as ('normal' | 'custom')[], mode: () => 'text' as const, custom: () => ['Kollege'] };
    const game = (id: string) => new SlfGame({ ...room.net(id), isHost: () => host === id, hostId: () => host }, opts);
    const g: Record<string, InstanceType<typeof SlfGame>> = Object.fromEntries(ids.map((id) => [id, game(id)]));
    g.a.start();
    room.pump();
    g.b.removeCat('Tier');
    g.c.addCat('Kollege', 'pool');
    room.pump();
    expect(g.c.state!.proposals).toHaveLength(2);
    // a leaves, b takes over from the public state.
    room.roster.shift();
    host = 'b';
    g.b.tick(performance.now());
    room.pump();
    expect(g.c.state).toMatchObject({ phase: 'pick', categories: classicCategories('text') });
    expect(g.c.state!.proposals).toHaveLength(2);
    const p = g.b.state!.proposals.find((x) => x.edit.op === 'add')!;
    g.b.accept(p.id);
    room.pump();
    expect(g.c.state!.categories).toContain('Kollege');
    expect(g.c.state!.proposals.map((x) => x.by)).toEqual(['b']);
    // c reloads: a fresh instance under a new id gets the pick back from the host.
    room.roster.splice(1, 1, late);
    const back = game('c2');
    g.b.rejoin('c', 'c2');
    room.pump();
    expect(back.state).toMatchObject({ phase: 'pick' });
    expect(back.state!.categories).toContain('Kollege');
    back.removeCat('Stadt');
    room.pump();
    expect(g.b.state!.proposals.map((x) => x.by)).toEqual(['b', 'c2']);
    expect(g.b.go()).toBe(true);
    room.pump();
    expect(back.state!.phase).toBe('write');
    expect(back.state!.proposals).toEqual([]);
    expect(back.playing).toBe(true);
  });

  it('a state with a letter while picking, or proposals that make no sense, are not taken as they are', () => {
    const base = { phase: 'pick', mode: 'text', round: 1, letter: '', categories: ['A', 'B', 'C', 'D'], players: ['a', 'b'], commits: {}, stopBy: null, deadline: null, answers: null, shown: null, cat: 0, step: 'show', flags: [], vote: null, judged: [], voteNo: 0, ready: [], results: [], scores: {}, undo: 0, sentAt: 1 };
    expect(parseState(base)).toMatchObject({ phase: 'pick', proposals: [], seq: 0, keep: false });
    expect(parseState({ ...base, letter: 'B' })).toBeNull();
    expect(parseState({ ...base, phase: 'write' })).toBeNull();
    expect(parseState({ ...base, categories: Array(SLF.pick.max.text + 1).fill('A') })).toBeNull();
    const s = parseState({ ...base, seq: 2, keep: true, proposals: [{ id: 1, by: 'b', edit: { op: 'remove', at: 'A' } }, { id: 2, by: 'b', edit: { op: 'nuke' } }, 'x'] });
    expect(s!.proposals).toEqual([{ id: 1, by: 'b', edit: { op: 'remove', at: 'A' } }]);
    expect(s!.keep).toBe(true);
  });
});
