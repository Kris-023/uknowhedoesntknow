import { coachPower, smoothstep, type BlackoutWindow } from '../../core/motion';
import { hash01 } from '../../core/rng';
import { FAILURE, NUMBERS, OFFICIAL, QUEUE } from './config';

// Pure functions of clock + seed: every client derives the same hall without a single message.

const FAIL_WINDOW: BlackoutWindow = { windowS: FAILURE.windowS, chance: FAILURE.chance, minS: FAILURE.minS, maxS: FAILURE.maxS };
const NO_FAILURES: BlackoutWindow = { ...FAIL_WINDOW, chance: -1 };

export function power(t: number, seed: number, failures: boolean, forcedAt: number): number {
  return coachPower(t, seed, failures ? FAIL_WINDOW : NO_FAILURES, forcedAt);
}

/**
 * 0 = normal, otherwise seconds since the power last dropped (up to FAILURE.holdS): the IT doesn't
 * come back with the light. Sampled backwards, because the outage itself is only a function of t.
 */
export function failureAge(t: number, seed: number, failures: boolean, forcedAt: number): number {
  for (let back = 0; back <= FAILURE.holdS; back += 0.25) {
    if (power(t - back, seed, failures, forcedAt) < 0.5) return Math.max(back, 0.001);
  }
  return 0;
}

/** Which call number slot the clock is in. */
export const callIndex = (t: number): number => Math.floor(t / NUMBERS.stepS);

/** The k-th called number: hashed from the pool, never the same twice in a row. */
export function callNumber(seed: number, k: number): { num: string; desk: number } {
  const n = NUMBERS.pool.length;
  let i = Math.floor(hash01(seed, k, 31) * n) % n;
  const prev = Math.floor(hash01(seed, k - 1, 31) * n) % n;
  if (i === prev) i = (i + 1 + (k % 5)) % n;
  // Mostly the closed Schalter 1 or the sleeping clerk at 3; 2 has nobody behind it at all.
  const r = hash01(seed, k, 32);
  return { num: NUMBERS.pool[i], desk: r < 0.45 ? 1 : r < 0.85 ? 3 : 2 };
}

/** Announce this call? Only every `announceEvery`th slot can, so calls are ≥ 51 s apart. */
export function announces(seed: number, k: number): boolean {
  return ((k % NUMBERS.announceEvery) + NUMBERS.announceEvery) % NUMBERS.announceEvery === 0 && hash01(seed, k, 33) < NUMBERS.announceChance;
}

/** Forward offset (m, towards the counter) of queue member `i` (0 = front, never moves). */
export function queueStep(t: number, i: number): number {
  if (i === 0) return 0;
  const ph = (t + i * 0.7) % QUEUE.cycleS;
  // Shuffle up quickly, then drift back slowly when it's clear nothing moves.
  return QUEUE.step * (smoothstep(3, 4.1, ph) - smoothstep(15, 17.5, ph));
}

/**
 * The official's position along his path (z) and heading. Walk to a door, stop, look at it, sip,
 * turn around, walk to the other one. He never goes through.
 */
export function officialAt(t: number): { z: number; yaw: number; walking: boolean; sip: number } {
  const leg = OFFICIAL.walkS + OFFICIAL.pauseS;
  const u = ((t % (2 * leg)) + 2 * leg) % (2 * leg);
  const out = u < leg;
  const ph = out ? u : u - leg;
  const [z0, z1] = out ? [OFFICIAL.z[0], OFFICIAL.z[1]] : [OFFICIAL.z[1], OFFICIAL.z[0]];
  const dir = Math.sign(z1 - z0);
  if (ph < OFFICIAL.walkS) {
    const k = smoothstep(0, 1, ph / OFFICIAL.walkS);
    return { z: z0 + (z1 - z0) * k, yaw: dir > 0 ? 0 : Math.PI, walking: ph > 0.4 && ph < OFFICIAL.walkS - 0.4, sip: 0 };
  }
  // At the door: turn towards it (left wall = -x), sip, turn back.
  const p = ph - OFFICIAL.walkS;
  const face = smoothstep(0, 0.8, p) * (1 - smoothstep(OFFICIAL.pauseS - 0.9, OFFICIAL.pauseS, p));
  const base = dir > 0 ? 0 : Math.PI;
  const toDoor = -Math.PI / 2;
  // Shortest turn from the walking heading to the door.
  let d = toDoor - base;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  const sip = smoothstep(1.2, 1.6, p) * (1 - smoothstep(2.4, 2.8, p));
  return { z: z1, yaw: base + d * face, walking: false, sip };
}

/** The wall clock runs wrong: hours backwards, minutes far too fast, seconds stuck now and then. */
export function clockHands(t: number, seed: number): { h: number; m: number; s: number } {
  const t0 = hash01(seed, 7) * 43200;
  const sec = Math.floor(t);
  // Every 7th second the hand ticks back instead of forward.
  const sTicks = sec - 2 * Math.floor(sec / 7);
  return {
    h: -((t0 + t * 3) / 43200) * Math.PI * 2,
    m: ((t0 + t * 37) / 3600) * Math.PI * 2,
    s: (sTicks / 60) * Math.PI * 2,
  };
}

/**
 * A rare one-off in each `windowS` window (with `chance`), lasting `durS`: printer, water glug,
 * ticket pulled. Returns its window index (to fire a sound once) and phase 0..1, or null.
 */
export function oneOff(t: number, seed: number, windowS: number, chance: number, durS: number, salt: number): { id: number; ph: number } | null {
  const id = Math.floor(t / windowS);
  if (hash01(seed, id, salt) > chance) return null;
  const start = id * windowS + 1 + hash01(seed, id, salt + 1) * (windowS - durS - 2);
  const ph = (t - start) / durS;
  return ph >= 0 && ph < 1 ? { id, ph } : null;
}
