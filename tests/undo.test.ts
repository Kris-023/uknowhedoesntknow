import { describe, expect, it } from 'vitest';
import { AHNUNG, GLEICH, SAGS, UNDO, WHOAMI, ZEIG } from '../src/config';
import { AhnHost } from '../src/game/ahnungslos/logic';
import { GleichHost } from '../src/game/gleich/logic';
import { SagsHost } from '../src/game/sagsanders/logic';
import { renameDeep, UndoStack } from '../src/game/undo';
import { WhoamiHost } from '../src/game/whoami/logic';
import { ZeigHost } from '../src/game/zeig/logic';
import type { WordCard } from '../src/words/types';

describe('Zug zurück: the stack', () => {
  it('keeps at most UNDO.depth snapshots, newest first, as copies', () => {
    const u = new UndoStack<{ n: number }>();
    const o = { n: 0 };
    for (let i = 0; i < UNDO.depth + 3; i++) {
      o.n = i;
      u.push(o, i);
    }
    o.n = 99;
    expect(u.size).toBe(UNDO.depth);
    const got: number[] = [];
    for (let r = u.pop(); r; r = u.pop()) got.push(r.snap.n);
    expect(got).toEqual([7, 6, 5, 4, 3].map((n) => n + UNDO.depth - 5));
  });

  it('reports the fines given after a snapshot, and follows renamed players', () => {
    const u = new UndoStack<{ scores: Record<string, number> }>();
    u.fine('a', 1);
    u.push({ scores: { a: 0 } }, 0);
    u.fine('a', 1);
    u.fine('b', 2);
    u.rename('a', 'a2');
    const r = u.pop()!;
    expect(r.snap.scores).toEqual({ a2: 0 });
    expect(r.later).toEqual({ a2: 1, b: 2 });
  });

  it('renameDeep swaps ids as values and keys, nothing else', () => {
    expect(renameDeep({ a: ['a', 'b', { x: 'a' }], m: new Map([['a', 'ab']]) }, 'a', 'z')).toEqual({ z: ['z', 'b', { x: 'z' }], m: new Map([['z', 'ab']]) });
  });
});

const P3 = ['a', 'b', 'c'];

describe('Zug zurück: Wer bin ich?', () => {
  const play = () => {
    const h = new WhoamiHost(P3);
    P3.forEach((p) => h.intent(p, { a: 'ready' }, 0, p === 'a'));
    return h;
  };
  const guess = (h: WhoamiHost, g: string, v: 'yes' | 'no') => {
    h.intent(g, { a: 'guess' }, 0, g === 'a');
    for (const p of P3) if (p !== g) h.intent(p, { a: 'vote', v }, 0, p === 'a');
  };

  it('nothing to take back before the first decision', () => {
    const h = play();
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBe(false);
  });

  it('a guess judged wrong: back to before the vote, the guesser is on turn again', () => {
    const h = play();
    guess(h, 'a', 'no');
    expect(h.state.turn).toBe('b');
    expect(h.undo()).toBe(true);
    expect(h.state).toMatchObject({ phase: 'play', turn: 'a', vote: null, last: null, undo: 1, solved: [] });
    // The same guess can be voted on again, now right.
    guess(h, 'a', 'yes');
    expect(h.state.solved).toEqual(['a']);
    expect(h.state.scores.a).toBe(WHOAMI.points[0]);
    expect(h.state.undo).toBe(1);
  });

  it('a right guess taken back takes its points and the solve with it; questions too', () => {
    const h = play();
    h.intent('a', { a: 'ask' }, 0, true);
    h.intent('b', { a: 'vote', v: 'no' }, 0, false);
    h.intent('c', { a: 'vote', v: 'no' }, 0, false);
    guess(h, 'b', 'yes');
    expect(h.state.scores.b).toBe(WHOAMI.points[0]);
    h.undo();
    expect(h.state.scores.b).toBe(0);
    expect(h.state.solved).toEqual([]);
    expect(h.state.turn).toBe('b');
    h.undo();
    expect(h.state.turn).toBe('a');
    expect(h.state.questions.a).toBe(0);
    expect(h.canUndo).toBe(false);
  });

  it('from the end of the round back into play', () => {
    const h = play();
    guess(h, 'a', 'yes');
    guess(h, 'b', 'yes');
    guess(h, 'c', 'yes');
    expect(h.state.phase).toBe('done');
    h.undo();
    expect(h.state).toMatchObject({ phase: 'play', turn: 'c', solved: ['a', 'b'] });
    // The host ending the round by mistake can be taken back as well.
    h.intent('a', { a: 'end' }, 0, true);
    h.undo();
    expect(h.state.phase).toBe('play');
  });

  it('passes are decisions; the depth is limited', () => {
    const h = play();
    for (let i = 0; i < UNDO.depth + 2; i++) h.intent(h.state.turn!, { a: 'pass' }, 0, h.state.turn === 'a');
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(UNDO.depth);
  });

  it("the Schaffner's fine stays; leaving ends the history; a rejoin keeps it under the new id", () => {
    const h = play();
    guess(h, 'a', 'yes');
    h.penalize('a', 1);
    h.undo();
    expect(h.state.scores.a).toBe(-1);
    guess(h, 'a', 'no');
    h.replace('b', 'b2');
    h.undo();
    expect(h.state.players).toEqual(['a', 'b2', 'c']);
    expect(Object.keys(h.state.scores).sort()).toEqual(['a', 'b2', 'c']);
    guess(h, 'a', 'no');
    h.removePlayer('c', 0);
    expect(h.canUndo).toBe(false);
  });

  it('a vote taken back by a timeout restores before that vote too', () => {
    const h = play();
    h.intent('a', { a: 'guess' }, 0, true);
    h.tick(WHOAMI.voteS * 1000 + 1);
    expect(h.state.turn).toBe('b');
    h.undo();
    expect(h.state).toMatchObject({ turn: 'a', vote: null });
  });
});

const card = (word: string): WordCard => ({ id: `t:${word}`, deck: 'normal', word, taboo: ['x'] });

describe("Zug zurück: Sag's anders", () => {
  it('a card result taken back: points and log go back, the card number moves on, the turn keeps running', () => {
    const h = new SagsHost(['a', 'b', 'c']);
    h.intent('a', { a: 'begin' }, 0, true);
    const deadline = h.state.deadline;
    const no = h.state.cardNo;
    h.intent('a', { a: 'got', no, card: card('Hund'), by: 'b' }, 5000, true);
    expect(h.state.scores.b).toBe(SAGS.ffaGuesser);
    expect(h.undo(6000)).toBe(true);
    expect(h.state).toMatchObject({ phase: 'turn', explainer: 'a', log: [], undo: 1 });
    expect(h.state.scores).toEqual({ a: 0, b: 0, c: 0 });
    expect(h.state.cardNo).toBeGreaterThan(no + 1);
    // The time left when the card was decided, from now.
    expect(h.state.deadline).toBe(6000 + (deadline! - 5000));
    // A late click on the old card number does nothing.
    expect(h.intent('a', { a: 'skip', no, card: card('Hund') }, 6000, true)).toBe(false);
  });

  it('a challenge taken back restores the result before it', () => {
    const h = new SagsHost(['a', 'b', 'c']);
    h.intent('a', { a: 'begin' }, 0, true);
    const no = h.state.cardNo;
    h.intent('a', { a: 'got', no, card: card('Hund'), by: 'b' }, 1, true);
    h.intent('c', { a: 'challenge', no }, 2, false);
    expect(h.state.log[0].result).toBe('foul');
    h.undo(3);
    expect(h.state.log[0].result).toBe('got');
    expect(h.state.scores).toEqual({ a: SAGS.ffaExplainer, b: SAGS.ffaGuesser, c: 0 });
  });

  it('a turn ended by time taken back resumes with at least UNDO.resumeMinS', () => {
    const h = new SagsHost(['a', 'b'], {}, 1, 10);
    h.intent('a', { a: 'begin' }, 0, true);
    h.tick(10_001);
    expect(h.state).toMatchObject({ phase: 'ready', explainer: 'b' });
    h.undo(20_000);
    expect(h.state).toMatchObject({ phase: 'turn', explainer: 'a', turnNo: 0 });
    expect(h.state.deadline).toBe(20_000 + UNDO.resumeMinS * 1000);
  });

  it('from the end back into the last turn; fines stay', () => {
    const h = new SagsHost(['a', 'b'], {}, 1, 10);
    let t = 0;
    while (h.state.phase !== 'done') {
      h.intent(h.state.explainer!, { a: 'begin' }, t, false);
      t += 10_001;
      h.tick(t);
    }
    h.penalize('b', 1);
    h.undo(t);
    expect(h.state.phase).toBe('turn');
    expect(h.state.scores.b).toBe(-1);
  });
});

describe('Zug zurück: Gleich gedacht', () => {
  const C = (id: string) => ({ a: 'lock' as const, c: id.repeat(64).slice(0, 64) });
  const play = (h: GleichHost, words: Record<string, string>, t = 0) => {
    for (const p of h.state.players) h.intent(p, C('a'), t, p === 'a');
    for (const p of h.state.players) h.reveal(p, words[p], t);
  };

  it('a "Zählt als gleich?" vote taken back: the words are shown again, the vote can be held again', () => {
    const h = new GleichHost(P3, {}, 1, 0);
    play(h, { a: 'Hund', b: 'Hunde', c: 'Katze' });
    expect(h.state.phase).toBe('reveal');
    h.intent('a', { a: 'call' }, 1, true);
    for (const p of P3) h.intent(p, { a: 'vote', v: true }, 1, p === 'a');
    expect(h.state.phase).toBe('done');
    expect(h.state.scores.a).toBe(GLEICH.points[0]);
    expect(h.undo(1000)).toBe(true);
    expect(h.state).toMatchObject({ phase: 'reveal', solved: false, vote: null, voted: false, last: null, ready: [], undo: 1, tryNo: 1 });
    expect(h.state.words).toEqual({ a: 'Hund', b: 'Hunde', c: 'Katze' });
    expect(h.state.scores.a).toBe(0);
    expect(h.state.deadline).toBe(1000 + GLEICH.revealS * 1000);
    expect(h.intent('b', { a: 'call' }, 1001, false)).toBe(true);
  });

  it('an automatic "all the same" taken back stays on the shown words, unsolved', () => {
    const h = new GleichHost(P3, {}, 1, 0);
    play(h, { a: 'Mond', b: 'Mond', c: 'mond' });
    expect(h.state.solved).toBe(true);
    h.undo(5);
    expect(h.state).toMatchObject({ phase: 'reveal', solved: false, solvedTry: null });
    expect(h.state.history).toEqual([]);
    // Everyone moves on: the next try starts.
    for (const p of P3) h.intent(p, { a: 'ready' }, 6, p === 'a');
    expect(h.state).toMatchObject({ phase: 'write', tryNo: 2 });
  });

  it('moving on taken back: back to the reveal of the try before', () => {
    const h = new GleichHost(P3, {}, 1, 0);
    play(h, { a: 'Hund', b: 'Katze', c: 'Maus' });
    for (const p of P3) h.intent(p, { a: 'ready' }, 1, p === 'a');
    expect(h.state.tryNo).toBe(2);
    h.undo(2);
    expect(h.state).toMatchObject({ phase: 'reveal', tryNo: 1, ready: [], history: [] });
    expect(h.tick(3)).toBe(false);
  });
});

describe('Zug zurück: Zeig drauf', () => {
  const P4 = ['a', 'b', 'c', 'd'];
  const aim = (id: string) => ({ a: 'aim' as const, id, lock: true });
  const pickAll = (h: ZeigHost, picks: Record<string, string>, t = 0) => {
    for (const [p, id] of Object.entries(picks)) h.intent(p, aim(id), t, p === 'a');
  };

  it('a reveal taken back: the same question is looked at again, picks cleared, points back', () => {
    const h = new ZeigHost(P4, ['q1', 'q2'], {}, 1, 0);
    pickAll(h, { a: 'b', b: 'c', c: 'b', d: 'b' });
    expect(h.state.phase).toBe('reveal');
    expect(h.state.scores.a).toBe(ZEIG.majorityPoints);
    h.undo(500);
    expect(h.state).toMatchObject({ phase: 'look', qNo: 1, locked: [], history: [], undo: 1 });
    expect(h.state.scores.a).toBe(0);
    expect(h.state.deadline).toBe(500 + ZEIG.lookS * 1000);
    // Old picks are gone: nobody locked means the timer reveals all abstained.
    h.tick(500 + ZEIG.lookS * 1000);
    expect(h.state.history[0].top).toEqual([]);
  });

  it('from the next question, and from the end, back to looking at the one before', () => {
    const h = new ZeigHost(P4, ['q1', 'q2'], {}, 1, 0);
    pickAll(h, { a: 'b', b: 'c', c: 'b', d: 'b' });
    for (const p of P4) h.intent(p, { a: 'ready' }, 1, p === 'a');
    expect(h.state.qNo).toBe(2);
    pickAll(h, { a: 'c', b: 'c', c: 'a', d: 'c' }, 2);
    for (const p of P4) h.intent(p, { a: 'ready' }, 3, p === 'a');
    expect(h.state.phase).toBe('done');
    h.undo(4);
    expect(h.state).toMatchObject({ phase: 'look', qNo: 2 });
    expect(h.state.history).toHaveLength(1);
    h.undo(5);
    expect(h.state).toMatchObject({ phase: 'look', qNo: 1, history: [] });
    expect(h.state.scores).toEqual({ a: 0, b: 0, c: 0, d: 0 });
  });
});

describe('Zug zurück: Ahnungslos', () => {
  const P4 = ['a', 'b', 'c', 'd'];
  const CARD = { word: 'Zebrastreifen', taboo: ['Ampel'] };
  const aim = (id: string) => ({ a: 'aim' as const, id, lock: true });
  const clues = (h: AhnHost) => {
    let i = 0;
    while (h.state.phase === 'clues') h.intent(h.onTurn!, { a: 'clue', word: `Hinweis${i++}` }, 0, h.onTurn === 'a');
  };

  it('a vote that let the clueless one escape: back to the vote, picks cleared, points back', () => {
    const h = new AhnHost(P4, CARD, 'c', 0, {}, 1, 0);
    clues(h);
    for (const p of P4) h.intent(p, aim(p === 'a' ? 'b' : 'a'), 0, p === 'a');
    expect(h.state).toMatchObject({ phase: 'done', outcome: 'escaped', word: CARD.word });
    expect(h.state.scores.c).toBe(AHNUNG.escapePoints);
    h.undo(100);
    expect(h.state).toMatchObject({ phase: 'vote', locked: [], votes: null, accused: null, clueless: null, word: null, outcome: null, undo: 1 });
    expect(h.state.scores.c).toBe(0);
    expect(h.state.deadline).toBe(100 + AHNUNG.voteS * 1000);
    // Same round, same secret: this time they catch c.
    for (const p of P4) h.intent(p, aim(p === 'c' ? 'a' : 'c'), 101, p === 'a');
    expect(h.state).toMatchObject({ phase: 'guess', clueless: 'c' });
  });

  it('a guess taken back: the clueless one may guess again', () => {
    const h = new AhnHost(P4, CARD, 'c', 0, {}, 1, 0);
    clues(h);
    for (const p of P4) h.intent(p, aim(p === 'c' ? 'a' : 'c'), 0, p === 'a');
    h.intent('c', { a: 'guess', word: 'Ampel' }, 1, false);
    expect(h.state.outcome).toBe('caught');
    expect(h.state.scores.a).toBe(AHNUNG.catchPoints);
    h.undo(10);
    expect(h.state).toMatchObject({ phase: 'guess', guess: null, outcome: null, clueless: 'c' });
    expect(h.state.scores.a).toBe(0);
    expect(h.state.deadline).toBe(10 + AHNUNG.guessS * 1000);
    h.intent('c', { a: 'guess', word: 'Zebrastreifen' }, 11, false);
    expect(h.state.outcome).toBe('guessed');
    // Back twice: before the guess, then before the vote.
    h.undo(12);
    h.undo(13);
    expect(h.state.phase).toBe('vote');
    expect(h.canUndo).toBe(false);
  });

  it('clues are no decisions; a new host has no history', () => {
    const h = new AhnHost(P4, CARD, 'c', 0, {}, 1, 0);
    clues(h);
    expect(h.canUndo).toBe(false);
    expect(AhnHost.fromState(h.state).canUndo).toBe(false);
  });
});

describe('Zug zurück over the network', async () => {
  const { LocalGameRoom } = await import('../src/game/minigame');
  const { WhoamiGame } = await import('../src/game/whoami/game');
  const { ZeigGame } = await import('../src/game/zeig/game');
  const { GleichGame } = await import('../src/game/gleich/game');
  const roster = () => [
    { id: 'a', seat: 0, name: 'A' },
    { id: 'b', seat: 2, name: 'B' },
    { id: 'c', seat: 1, name: 'C' },
  ];
  const cardOf = (n: string) => `data:image/jpeg;base64,${btoa(n)}`;

  it('Wer bin ich?: clients follow an undo; a solve taken back hides the own card until solved again', () => {
    const room = new LocalGameRoom(roster());
    const g = Object.fromEntries(P3.map((id) => [id, new WhoamiGame(room.net(id))]));
    g.a.start();
    room.pump();
    for (const id of P3) g[id].submitCard(cardOf(`for-${g[id].myTarget}`));
    room.pump();
    room.pump();
    // b and c call a's guess right.
    g.a.toHost({ a: 'guess' });
    room.pump();
    g.b.vote('yes');
    g.c.vote('yes');
    room.pump();
    room.pump();
    expect(g.a.cards.get('a')).toBe(cardOf('for-a'));
    expect(g.b.canUndo).toBe(false);
    expect(g.a.canUndo).toBe(true);
    g.a.undo();
    room.pump();
    for (const id of P3) expect(g[id].state).toMatchObject({ phase: 'play', turn: 'a', solved: [], undo: 1 });
    expect(g.c.state!.scores.a).toBe(0);
    expect(g.a.cards.has('a')).toBe(false);
    // Vote again: a fresh vote key, so b and c may vote again.
    g.a.toHost({ a: 'guess' });
    room.pump();
    g.b.vote('yes');
    g.c.vote('yes');
    room.pump();
    room.pump();
    expect(g.b.state!.solved).toEqual(['a']);
    expect(g.a.cards.get('a')).toBe(cardOf('for-a'));
    // A new round starts without history.
    g.a.start();
    expect(g.a.canUndo).toBe(false);
  });

  it('Zeig drauf: after an undo every client can pick again for the same question', () => {
    const room = new LocalGameRoom(roster());
    const g = Object.fromEntries(P3.map((id) => [id, new ZeigGame(room.net(id), { decks: () => ['normal'] })]));
    g.a.start();
    room.pump();
    g.a.lock('b');
    g.b.lock('c');
    g.c.lock('b');
    room.pump();
    expect(g.b.state!.phase).toBe('reveal');
    g.a.undo();
    room.pump();
    for (const id of P3) {
      expect(g[id].state).toMatchObject({ phase: 'look', qNo: 1, locked: [] });
      expect(g[id].iLocked).toBe(false);
      expect(g[id].pickable().length).toBe(2);
    }
    g.a.lock('c');
    g.b.lock('c');
    g.c.lock('a');
    room.pump();
    expect(g.b.shown!.top).toEqual(['c']);
  });

  it('Gleich gedacht: a vote taken back can be voted on again by every client', async () => {
    const room = new LocalGameRoom(roster());
    const g = Object.fromEntries(P3.map((id) => [id, new GleichGame(room.net(id), { decks: () => ['normal'] })]));
    const until = async (done: () => boolean) => {
      for (let i = 0; i < 200 && !done(); i++) {
        room.pump();
        await new Promise((r) => setTimeout(r, 2));
      }
      expect(done()).toBe(true);
    };
    g.a.start();
    room.pump();
    await g.a.lock('Hund');
    await g.b.lock('Hunde');
    await g.c.lock('Katze');
    await until(() => !!g.c.state?.words);
    g.b.call();
    await until(() => !!g.c.state?.vote);
    for (const id of P3) g[id].vote(true);
    await until(() => g.c.state?.phase === 'done');
    expect(g.b.iVoted).toBe(true);
    g.a.undo();
    await until(() => g.c.state?.phase === 'reveal');
    for (const id of P3) {
      expect(g[id].iVoted).toBe(false);
      expect(g[id].state!.words).toEqual({ a: 'Hund', b: 'Hunde', c: 'Katze' });
    }
    g.c.call();
    await until(() => !!g.b.state?.vote);
    for (const id of P3) g[id].vote(false);
    await until(() => g.a.state?.last?.result === 'no');
    expect(g.b.state!.phase).toBe('reveal');
  });
});
