/**
 * Private game state of this tab (typed answers, secrets, own cards), kept in `sessionStorage`: it
 * survives a reload (F5) in the same tab, and a new tab starts empty, like the tab token in
 * `main.ts:tabToken`. Every access is wrapped: storage may be blocked, full or missing (tests), and
 * then nothing is stored and the game works from memory alone.
 *
 * Keys are `ukhdk.g.<game>.<scope>.<key>`. `scope` is the room code by default (a new room never
 * sees an old room's answers); games that also want a round in it put it in the scope or the key.
 * Dots in `game` and `scope` are replaced, so `clearTabGame('sf')` cannot touch game `sf.x`.
 */
const ROOT = 'ukhdk.g.';

const seg = (s: string): string => s.replace(/\./g, '_');

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** The room this tab is in, as `main.ts` keeps it in the address (`#CODE`); '' outside a room. */
export function currentRoom(): string {
  try {
    return seg(globalThis.location?.hash.slice(1) ?? '');
  } catch {
    return '';
  }
}

export interface TabStore {
  /** Stored value, or undefined if missing, unreadable, or `check` rejects it (stored data is still untrusted: old versions, edits). */
  get<T>(key: string, check?: (v: unknown) => v is T): T | undefined;
  /** Store a JSON-serialisable value; false if it could not be stored (blocked, quota). */
  set(key: string, value: unknown): boolean;
  remove(key: string): void;
  /** Remove every key of this game and scope. */
  clear(): void;
}

/** The store of one game in one scope (default: the current room). */
export function tabStore(game: string, scope: string = currentRoom()): TabStore {
  const prefix = `${ROOT}${seg(game)}.${seg(scope)}.`;
  return {
    get<T>(key: string, check?: (v: unknown) => v is T): T | undefined {
      try {
        const raw = storage()?.getItem(prefix + key);
        if (raw === null || raw === undefined) return undefined;
        const v: unknown = JSON.parse(raw);
        return check && !check(v) ? undefined : (v as T);
      } catch {
        return undefined;
      }
    },
    set(key, value) {
      try {
        const s = storage();
        const raw = JSON.stringify(value);
        if (!s || raw === undefined) return false;
        s.setItem(prefix + key, raw);
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      removeWhere((k) => k === prefix + key);
    },
    clear() {
      removeWhere((k) => k.startsWith(prefix));
    },
  };
}

/** Remove everything one game stored in this tab, in every scope (game over, or leaving the room). */
export function clearTabGame(game: string): void {
  const prefix = `${ROOT}${seg(game)}.`;
  removeWhere((k) => k.startsWith(prefix));
}

function removeWhere(match: (key: string) => boolean): void {
  try {
    const s = storage();
    if (!s) return;
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && match(k)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
  } catch {
    // Nothing to clean up if storage can't be read.
  }
}
