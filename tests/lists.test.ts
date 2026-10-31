import { describe, expect, it } from 'vitest';
import { LISTS } from '../src/config';
import { LocalGameRoom } from '../src/game/minigame';
import { RoomLists } from '../src/game/roomLists';
import { LEGACY_WORDS_KEY } from '../src/words/custom';
import { ADOPT_LIST, cleanEntry, ListStore, loadLists, MIGRATED_LIST, parseItem, parseShared, questionPool, type SharedLists, type StorageLike } from '../src/words/lists';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

const legacyCards = [
  { id: 'c:me:1', deck: 'custom', word: 'Bauchklatscher', taboo: ['Bauch', 'Sprungbrett'], by: { id: 'me', name: 'Kris' } },
  { id: 'c:me:2', deck: 'custom', word: 'Bürokaffee', taboo: [] },
  { id: 'c:x:3', deck: 'custom', word: '', taboo: [] },
];

describe('Eigene Listen: entries', () => {
  it('cleans entries per kind and strips the "Wer würde am ehesten" frame', () => {
    expect(cleanEntry('zeig', '  Wer würde am ehesten   im Büro einschlafen? ')).toBe('im Büro einschlafen');
    expect(cleanEntry('zeig', 'wer würde den Chef duzen…')).toBe('den Chef duzen');
    expect(cleanEntry('fragen', 'Etwas,\tdas brummt')).toBe('Etwas, das brummt');
    expect(cleanEntry('kategorien', 'x'.repeat(LISTS.maxChars.kategorien + 1))).toBeNull();
    expect(cleanEntry('kategorien', '   ')).toBeNull();
    expect(cleanEntry('words', 42)).toBeNull();
  });

  it('reads word cards of earlier versions and plain list items', () => {
    expect(parseItem('words', legacyCards[0])).toEqual({ id: 'c:me:1', text: 'Bauchklatscher', taboo: ['Bauch', 'Sprungbrett'], by: { id: 'me', name: 'Kris' } });
    expect(parseItem('words', { id: 'c:me:9', text: 'Mett', taboo: ['Mett', 'Zwiebeln'] })).toEqual({ id: 'c:me:9', text: 'Mett', taboo: ['Zwiebeln'] });
    expect(parseItem('kategorien', { text: 'Kollege', by: { id: 'p1', name: 'Lea' } })).toEqual({ id: '', text: 'Kollege', taboo: [], by: { id: 'p1', name: 'Lea' } });
    expect(parseItem('fragen', 'Ein Kraut')).toEqual({ id: '', text: 'Ein Kraut', taboo: [] });
    expect(parseItem('zeig', { text: null })).toBeNull();
  });
});

describe('Eigene Listen: storage and migration', () => {
  it('turns the old single word list into "Meine Wörter" and keeps the old data', () => {
    const st = new MemoryStorage();
    st.setItem(LEGACY_WORDS_KEY, JSON.stringify(legacyCards));
    const store = new ListStore(st, () => 'me');
    expect(store.all()).toHaveLength(1);
    const l = store.all()[0];
    expect(l).toMatchObject({ kind: 'words', name: MIGRATED_LIST, on: true });
    expect(l.items.map((x) => x.text)).toEqual(['Bauchklatscher', 'Bürokaffee']);
    // Ids stay, so cards drawn earlier keep counting as drawn.
    expect(l.items[0].id).toBe('c:me:1');
    // Old key untouched, new one written: a second start doesn't migrate again.
    expect(JSON.parse(st.getItem(LEGACY_WORDS_KEY)!)).toHaveLength(3);
    expect(st.getItem('ukhdk.lists.v1')).toBeTruthy();
    store.add(l.id, 'Faxgerätpapier');
    const again = new ListStore(st, () => 'me');
    expect(again.all()).toHaveLength(1);
    expect(again.all()[0].items.map((x) => x.text)).toContain('Faxgerätpapier');
  });

  it('nothing to migrate, broken or missing storage: no lists, no crash', () => {
    expect(loadLists(new MemoryStorage(), 'me').lists).toEqual([]);
    const broken = new MemoryStorage();
    broken.setItem('ukhdk.lists.v1', '{kaputt');
    expect(loadLists(broken, 'me').lists).toEqual([]);
    expect(loadLists(null, 'me').lists).toEqual([]);
    const junk = new MemoryStorage();
    junk.setItem('ukhdk.lists.v1', JSON.stringify({ lists: [{ kind: 'quatsch' }, { kind: 'zeig', name: 'A', items: ['x', 'x', 5] }] }));
    const lists = loadLists(junk, 'me').lists;
    expect(lists).toHaveLength(1);
    expect(lists[0].items.map((i) => i.text)).toEqual(['x']);
  });

  it('several named lists per kind; only lists that are on count', () => {
    const store = new ListStore(new MemoryStorage(), () => 'me');
    const a = store.create('zeig', 'Büro-Insider');
    const b = store.create('zeig', 'Familie');
    if (typeof a === 'string' || typeof b === 'string') throw new Error(String(a));
    expect(store.add(a.id, 'Wer würde am ehesten den Faxgerät anschreien?')).toBeNull();
    expect(store.add(a.id, 'den Faxgerät anschreien')).toMatch(/schon/);
    expect(store.add(b.id, 'den Faxgerät anschreien')).toBeNull();
    expect(store.add(b.id, 'Oma anrufen')).toBeNull();
    expect(store.enabled('zeig').map((x) => x.text)).toEqual(['den Faxgerät anschreien', 'Oma anrufen']);
    store.setOn(b.id, false);
    expect(store.enabled('zeig').map((x) => x.text)).toEqual(['den Faxgerät anschreien']);
    expect(store.shareable().zeig).toEqual(['den Faxgerät anschreien']);
    expect(store.enabled('fragen')).toEqual([]);
    store.rename(a.id, '  Büro  ');
    expect(store.get(a.id)!.name).toBe('Büro');
    store.remove(a.id);
    expect(store.ofKind('zeig')).toHaveLength(1);
  });

  it('caps the number of lists and the length of names', () => {
    const store = new ListStore(new MemoryStorage(), () => 'me');
    for (let i = 0; i < LISTS.maxLists; i++) expect(typeof store.create('fragen', `L${i}`)).toBe('object');
    expect(typeof store.create('fragen', 'eine zu viel')).toBe('string');
    const s2 = new ListStore(new MemoryStorage(), () => 'me');
    const l = s2.create('kategorien', 'x'.repeat(100));
    expect(typeof l !== 'string' && l.name.length).toBe(LISTS.maxNameChars);
  });

  it('own word cards carry my id; adopted ones keep their author and land in "Übernommen"', () => {
    const store = new ListStore(new MemoryStorage(), () => 'me');
    const l = store.create('words', 'Meine');
    if (typeof l === 'string') throw new Error(l);
    store.add(l.id, 'Kopierer', ['Papier', 'Toner']);
    expect(store.cards()).toEqual([{ id: l.items[0].id, deck: 'custom', word: 'Kopierer', taboo: ['Papier', 'Toner'], by: { id: 'me', name: '' } }]);
    const card = { id: 'c:lea:1', text: 'Kantine', taboo: ['Essen'], by: { id: 'lea', name: 'Lea' } };
    expect(store.adopt('words', card)).toBe(true);
    expect(store.adopt('words', card)).toBe(false);
    expect(store.has('words', 'kantine')).toBe(true);
    const adopted = store.ofKind('words').find((x) => x.name === ADOPT_LIST)!;
    expect(adopted.items[0]).toMatchObject({ text: 'Kantine', by: { id: 'lea', name: 'Lea' } });
    expect(store.cards().find((c) => c.word === 'Kantine')!.by!.id).toBe('lea');
  });

  it('export and import a list, also old word exports and one entry per line', () => {
    const a = new ListStore(new MemoryStorage(), () => 'a');
    const l = a.create('kategorien', 'Büro');
    if (typeof l === 'string') throw new Error(l);
    a.add(l.id, 'Kollege');
    a.add(l.id, 'Ausrede');
    const text = a.exportList(l.id);
    const b = new ListStore(new MemoryStorage(), () => 'b');
    expect(b.importText('kategorien', text)).toEqual({ added: 2, name: 'Büro' });
    // Same list again: merged, nothing new.
    expect(b.importText('kategorien', text)).toEqual({ added: 0, name: 'Büro' });
    expect(b.ofKind('kategorien')).toHaveLength(1);
    expect(() => b.importText('zeig', text)).toThrow(/Kategorien/);
    expect(b.importText('kategorien', 'Snack\n\nFaxgerät\nSnack')).toEqual({ added: 2, name: 'Importiert' });
    expect(b.importText('words', JSON.stringify({ ukhdkWords: 1, cards: legacyCards })).added).toBe(2);
    expect(() => b.importText('fragen', JSON.stringify({ ukhdkWords: 1, cards: legacyCards }))).toThrow(/Wörter/);
    expect(b.importText('words', 'Stempeluhr: Zeit, Karte\nMeeting').added).toBe(2);
    expect(b.ofKind('words').find((x) => x.name === 'Importiert')!.items.find((x) => x.text === 'Stempeluhr')!.taboo).toEqual(['Zeit', 'Karte']);
    expect(() => b.importText('fragen', '{"kein": "Export"}')).toThrow();
    expect(() => b.importText('fragen', '   \n ')).toThrow(/Keine/);
  });
});

describe('Eigene Listen: sharing', () => {
  it('validates and cuts what a peer sends', () => {
    expect(parseShared(null)).toBeNull();
    expect(parseShared({ pid: 'x'.repeat(41) })).toBeNull();
    expect(parseShared({ pid: 'p' })).toEqual({ pid: 'p', words: [], zeig: [], fragen: [], kategorien: [] });
    const many = Array.from({ length: LISTS.maxShared.kategorien + 20 }, (_, i) => `Kat ${i}`);
    const s = parseShared({
      pid: 'p',
      words: [{ id: 'n:hund', deck: 'normal', word: 'Hund', taboo: [] }, { id: 'x', word: '' }, 'kaputt', { id: 'c:p:2', word: 'hund', taboo: [] }],
      zeig: ['Wer würde am ehesten tanzen?', 7, null],
      fragen: 'kein Array',
      kategorien: [...many, 'Kat 1'],
    })!;
    // Peers can't smuggle built-in cards: whatever they send is "Eigene".
    expect(s.words).toEqual([{ id: 'n:hund', deck: 'custom', word: 'Hund', taboo: [], by: undefined }]);
    expect(s.zeig).toEqual(['tanzen']);
    expect(s.fragen).toEqual([]);
    expect(s.kategorien).toHaveLength(LISTS.maxShared.kategorien);
  });

  it('questions: own ones mixed in with "Eigene", alone only if there are enough', () => {
    const normal = ['n1', 'n2', 'n3'];
    const nsfw = ['x1'];
    expect(questionPool(['normal'], normal, nsfw, ['c1'], 2)).toEqual(normal);
    expect(questionPool(['normal', 'custom'], normal, nsfw, ['c1', 'N1', 'c1'], 2)).toEqual([...normal, 'c1']);
    expect(questionPool(['normal', 'nsfw', 'custom'], normal, nsfw, ['c1'], 2)).toEqual([...normal, ...nsfw, 'c1']);
    expect(questionPool(['custom'], normal, nsfw, ['c1', 'c2'], 2)).toEqual(['c1', 'c2']);
    // Not enough own ones: the normal ones fill in.
    expect(questionPool(['custom'], normal, nsfw, ['c1'], 2)).toEqual([...normal, 'c1']);
    expect(questionPool(['nsfw'], normal, nsfw, [], 2)).toEqual([...normal, ...nsfw]);
  });

  it('every member gets my lists once, newcomers too, again after a change, only with "Eigene" on', () => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 0, name: 'A' },
      { id: 'b', seat: 2, name: 'B' },
      { id: 'c', seat: 1, name: 'C' },
    ]);
    const late = room.roster.pop()!;
    let on = false;
    let version = 0;
    const lists: Record<string, SharedLists> = {
      a: { pid: 'pa', words: [{ id: 'c:pa:1', deck: 'custom', word: 'Kopierer', taboo: [], by: { id: 'pa', name: '' } }], zeig: ['tanzen'], fragen: [], kategorien: ['Kollege'] },
      b: { pid: 'pb', words: [], zeig: ['Tanzen', 'singen'], fragen: ['Ein Snack'], kategorien: [] },
      c: { pid: 'pc', words: [], zeig: [], fragen: [], kategorien: ['Snack'] },
    };
    let sent = 0;
    const rl = Object.fromEntries(
      ['a', 'b', 'c'].map((id) => {
        const net = room.net(id);
        const counted = { ...net, send: (t: string, d: unknown, to?: string) => (t === 'cl:lists' && sent++, net.send(t, d, to)) };
        return [id, new RoomLists(counted, () => lists[id], () => on, () => version)];
      }),
    );
    const run = () => {
      for (let i = 0; i < 3; i++) {
        for (const m of room.roster) rl[m.id].tick();
        room.pump();
      }
    };
    run();
    expect(sent).toBe(0);
    expect(rl.b.cards()).toEqual([]);
    on = true;
    run();
    expect(sent).toBe(2);
    expect(rl.b.cards().map((c) => c.word)).toEqual(['Kopierer']);
    expect(rl.a.texts('zeig')).toEqual(['tanzen', 'singen']);
    expect(rl.a.pidOf('b')).toBe('pb');
    expect(rl.a.pidOf('a')).toBe('pa');
    // A newcomer gets everyone's lists and sends theirs.
    room.roster.push(late);
    run();
    expect(rl.c.texts('kategorien')).toEqual(['Snack', 'Kollege']);
    expect(rl.a.texts('kategorien')).toEqual(['Kollege', 'Snack']);
    expect(sent).toBe(2 + 2 + 2);
    // My lists changed: they go out again.
    lists.a.kategorien = ['Kollege', 'Chef'];
    version++;
    run();
    expect(rl.b.texts('kategorien')).toContain('Chef');
    // Someone who left takes their lists along.
    room.roster.splice(1, 1);
    expect(rl.a.texts('zeig')).toEqual(['tanzen']);
  });

  it('still understands the word lists of peers from before ("sa:words")', () => {
    const room = new LocalGameRoom([
      { id: 'a', seat: 0, name: 'A' },
      { id: 'b', seat: 2, name: 'B' },
    ]);
    const rl = new RoomLists(room.net('a'), () => ({ pid: 'pa', words: [], zeig: [], fragen: [], kategorien: [] }), () => true);
    room.net('b').send('sa:words', { pid: 'pb', cards: [{ id: 'c:pb:1', deck: 'custom', word: 'Stempeluhr', taboo: ['Zeit'] }] }, 'a');
    room.pump();
    expect(rl.cards().map((c) => c.word)).toEqual(['Stempeluhr']);
    expect(rl.pidOf('b')).toBe('pb');
  });
});
