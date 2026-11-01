import { afterEach, describe, expect, it } from 'vitest';
import { clearTabGame, tabStore } from '../src/game/tabStore';

/** A Map-backed sessionStorage. */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
}

function install(s: Storage | (() => Storage)): void {
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: typeof s === 'function' ? s : () => s });
}

afterEach(() => {
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
});

describe('tabStore', () => {
  it('stores JSON and reads it back, also after "reload" (a new store object, same storage)', () => {
    install(fakeStorage());
    expect(tabStore('sf', 'ROOM').set('answers', { a: [1, 'x'], b: null })).toBe(true);
    expect(tabStore('sf', 'ROOM').get('answers')).toEqual({ a: [1, 'x'], b: null });
    expect(tabStore('sf', 'ROOM').get('missing')).toBeUndefined();
  });

  it('keeps games, scopes and keys apart', () => {
    const s = fakeStorage();
    install(s);
    tabStore('sf', 'R1').set('k', 1);
    tabStore('sf', 'R2').set('k', 2);
    tabStore('wi', 'R1').set('k', 3);
    expect([tabStore('sf', 'R1').get('k'), tabStore('sf', 'R2').get('k'), tabStore('wi', 'R1').get('k')]).toEqual([1, 2, 3]);
    expect(s.key(0)!.startsWith('ukhdk.g.')).toBe(true);
  });

  it('clear() removes one game in one scope, clearTabGame() the game in all scopes', () => {
    const s = fakeStorage();
    install(s);
    s.setItem('ukhdk.token.R1', 'tok');
    tabStore('sf', 'R1').set('a', 1);
    tabStore('sf', 'R1').set('b', 2);
    tabStore('sf', 'R2').set('a', 3);
    tabStore('sf.x', 'R1').set('a', 4);
    tabStore('wi', 'R1').set('a', 5);
    tabStore('sf', 'R1').clear();
    expect(tabStore('sf', 'R1').get('a')).toBeUndefined();
    expect(tabStore('sf', 'R2').get('a')).toBe(3);
    clearTabGame('sf');
    expect(tabStore('sf', 'R2').get('a')).toBeUndefined();
    // Other games and unrelated keys (the tab token) stay.
    expect(tabStore('sf.x', 'R1').get('a')).toBe(4);
    expect(tabStore('wi', 'R1').get('a')).toBe(5);
    expect(s.getItem('ukhdk.token.R1')).toBe('tok');
    tabStore('wi', 'R1').remove('a');
    expect(tabStore('wi', 'R1').get('a')).toBeUndefined();
  });

  it('get() drops values the check rejects and survives corrupt JSON', () => {
    const s = fakeStorage();
    install(s);
    const st = tabStore('sf', 'R');
    st.set('n', 'text');
    expect(st.get('n', (v): v is number => typeof v === 'number')).toBeUndefined();
    expect(st.get('n', (v): v is string => typeof v === 'string')).toBe('text');
    s.setItem('ukhdk.g.sf.R.bad', '{not json');
    expect(st.get('bad')).toBeUndefined();
  });

  it('blocked storage (throwing accessor) never throws and stores nothing', () => {
    install(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const st = tabStore('sf', 'R');
    expect(st.set('a', 1)).toBe(false);
    expect(st.get('a')).toBeUndefined();
    expect(() => {
      st.remove('a');
      st.clear();
      clearTabGame('sf');
    }).not.toThrow();
  });

  it('a full or throwing storage reports false from set() and no storage at all works too', () => {
    const s = fakeStorage();
    s.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    install(s);
    expect(tabStore('sf', 'R').set('a', 1)).toBe(false);
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    expect(tabStore('sf', 'R').set('a', 1)).toBe(false);
    expect(tabStore('sf', 'R').get('a')).toBeUndefined();
  });
});
