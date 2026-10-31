import { UNDO } from '../config';

// "Zug zurück": every game host keeps the last few decisions as full snapshots of its state, taken
// right before the decision, and the host player can step back to one. Snapshots live only on
// the host, like the rest of the host state: a new host (the old one left) starts without history.
//
// What can't be undone: anything a client has already been shown (a whoami card revealed to its
// target, the word and the clueless player at the end of "Ahnungslos"). The state goes back, the
// knowledge stays.

interface Entry<T> {
  snap: T;
  /** Host ms when it was taken, for timers that resume where they were. */
  at: number;
  /** Fines up to then, so the ones given later can be kept on restore. */
  fines: Record<string, number>;
}

export interface Restore<T> {
  snap: T;
  at: number;
  /** Schaffner fines given after the snapshot, by player: they stay (see `keepFines`). */
  later: Record<string, number>;
}

/** Bounded history of host snapshots for one round. A new round gets a new host and so a new stack. */
export class UndoStack<T> {
  private items: Entry<T>[] = [];
  private fines: Record<string, number> = {};

  constructor(private depth: number = UNDO.depth) {}

  get size(): number {
    return this.items.length;
  }

  /** Remember `snap` (copied) as the state right before a decision; the oldest falls out past the depth. */
  push(snap: T, at: number): void {
    this.items.push({ snap: structuredClone(snap), at, fines: { ...this.fines } });
    if (this.items.length > this.depth) this.items.shift();
  }

  pop(): Restore<T> | null {
    const e = this.items.pop();
    if (!e) return null;
    const later: Record<string, number> = {};
    for (const [id, n] of Object.entries(this.fines)) if (n - (e.fines[id] ?? 0)) later[id] = n - (e.fines[id] ?? 0);
    return { snap: e.snap, at: e.at, later };
  }

  /** A Schaffner fine was given. */
  fine(id: string, points: number): void {
    this.fines[id] = (this.fines[id] ?? 0) + points;
  }

  clear(): void {
    this.items = [];
  }

  /** A player came back under a new id: the snapshots follow, so an undo doesn't bring the old id back. */
  rename(oldId: string, newId: string): void {
    for (const e of this.items) {
      e.snap = renameDeep(e.snap, oldId, newId);
      e.fines = renameDeep(e.fines, oldId, newId);
    }
    this.fines = renameDeep(this.fines, oldId, newId);
  }
}

/**
 * Copy of `v` with every string equal to `oldId` (as a value or a record key) replaced by `newId`.
 * Player ids are long random strings, so no word or question can be mistaken for one.
 */
export function renameDeep<T>(v: T, oldId: string, newId: string): T {
  const r = (x: unknown): unknown => {
    if (x === oldId) return newId;
    if (Array.isArray(x)) return x.map(r);
    if (x instanceof Map) return new Map([...x].map(([k, val]) => [r(k), r(val)]));
    if (typeof x === 'object' && x !== null) return Object.fromEntries(Object.entries(x).map(([k, val]) => [k === oldId ? newId : k, r(val)]));
    return x;
  };
  return r(v) as T;
}

/**
 * The Schaffner's fines survive an undo: shouting is not a game move, and taking back a vote
 * shouldn't pardon whoever was too loud meanwhile.
 */
export function keepFines(scores: Record<string, number>, later: Record<string, number>): void {
  for (const [id, n] of Object.entries(later)) if (id in scores) scores[id] -= n;
}

/** Key of a round and its undo count: what a client has dismissed or echoed is per this, so it comes again after an undo. */
export const stepKey = (s: { round: number; undo?: number }): string => `${s.round}.${s.undo ?? 0}`;
