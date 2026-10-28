import { hash01 } from './rng';

// Pure functions of the shared clock. Same t and seed give the same result on every peer.

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Cheap 1D pseudo-noise from layered sines; smooth enough for camera wobble. */
export function noise1(t: number): number {
  return Math.sin(t) + 0.5 * Math.sin(t * 2.3 + 1.3) + 0.25 * Math.sin(t * 4.9 + 2.1);
}

/**
 * Neon segment brightness. Each segment has its own period (4..10 s). Most cycles start with a
 * stutter of random length and rate (hashed per cycle, so it never looks like a loop), some get
 * an extra dim blink halfway through.
 */
export function flick(t: number, seed: number): number {
  const period = 4 + ((seed * 2.7) % 6);
  const u = t + seed * 4.3;
  const cycle = Math.floor(u / period);
  const ph = u - cycle * period;
  const s = Math.floor(seed * 1000);
  const r = hash01(s, cycle);
  const k = 0.9 + 0.1 * Math.sin(t * 3 + seed);
  if (r < 0.7) {
    const dur = 0.25 + hash01(s, cycle, 1) * 0.9;
    if (ph < dur) {
      const rate = 40 + hash01(s, cycle, 2) * 80;
      return Math.sin(ph * rate + seed) > 0.1 ? k : 0.02;
    }
  }
  if (r > 0.85 && ph > period * 0.5 && ph < period * 0.5 + 0.12) return 0.25;
  return k;
}

export interface BlackoutWindow {
  windowS: number;
  chance: number;
  minS: number;
  maxS: number;
}

/**
 * Coach power, 1 = normal, 0 = total failure. Some clock windows contain one outage: a short
 * stutter as the power dies, darkness, then the tubes struggle back on.
 * `forcedAt` lets the debug panel trigger an outage at a given clock time.
 */
export function coachPower(t: number, seed: number, w: BlackoutWindow, forcedAt = -Infinity): number {
  const outage = (ph: number, dur: number): number | null => {
    if (ph < -0.6 || ph > dur + 0.9) return null;
    if (ph < 0) return Math.sin(ph * 90) > 0 ? 1 : 0.1;
    if (ph < dur) return 0;
    return Math.sin((ph - dur) * 55) > -0.3 ? 1 : 0;
  };
  const forced = outage(t - forcedAt - 0.6, 2.5);
  if (forced !== null) return forced;
  const idx = Math.floor(t / w.windowS);
  if (hash01(seed, idx, 99) > w.chance) return 1;
  const start = 4 + hash01(seed, idx, 98) * (w.windowS - w.maxS - 6);
  const dur = w.minS + hash01(seed, idx, 97) * (w.maxS - w.minS);
  return outage(t - idx * w.windowS - start, dur) ?? 1;
}

export interface Shake {
  x: number;
  y: number;
  roll: number;
}

/**
 * Camera shake in metres/radians for amplitude `amp` (metres). Rumble from noise and two
 * high-frequency rattles, plus rare jolts when two slow sines line up.
 */
export function shake(t: number, amp: number, phase = 0): Shake {
  const u = t + phase;
  const jolt = Math.pow(Math.max(0, Math.sin(u * 0.9) * Math.sin(u * 1.7 + 1)), 6);
  return {
    x: amp * (noise1(u * 7.1) * 0.5 + Math.sin(u * 41) * 0.4 + jolt * 3 * Math.sin(u * 23)),
    y: amp * (noise1(u * 5.3 + 4) * 0.5 + Math.sin(u * 57.3) * 0.4 + jolt * 2.5 * Math.sin(u * 29)),
    roll: amp * 1.6 * noise1(u * 3.1 + 2),
  };
}

/** Light spilling through the windows: hard strobing that scales with speed (sf = 0..1). */
export function windowFlash(t: number, sf: number, side: 0 | 1): number {
  const s = side === 0 ? Math.sin(t * 23) * Math.sin(t * 7.7) : Math.sin(t * 19) * Math.sin(t * 6.1 + 1);
  return (0.15 + 1.1 * Math.max(0, s)) * (sf + 0.2);
}

/** Seconds until the next halt, cycling every `cycle` seconds. */
export function haltCountdown(t: number, cycle: number): number {
  return cycle - Math.floor(((t % cycle) + cycle) % cycle);
}

/** An oncoming train passing one side of the coach, or null. Pure function of the shared clock. */
export interface Oncoming {
  /** Index of the event, to fire its sound exactly once. */
  id: number;
  /** 0..1 through the pass. */
  phase: number;
  side: -1 | 1;
}

export function oncoming(t: number, seed: number, w: { windowS: number; chance: number; durationS: number }): Oncoming | null {
  const idx = Math.floor(t / w.windowS);
  if (hash01(seed, idx, 71) > w.chance) return null;
  const start = idx * w.windowS + 2 + hash01(seed, idx, 72) * (w.windowS - w.durationS - 4);
  const ph = (t - start) / w.durationS;
  if (ph < 0 || ph > 1) return null;
  return { id: idx, phase: ph, side: hash01(seed, idx, 73) < 0.5 ? -1 : 1 };
}

/** Index of the stop the halt countdown is currently counting down to. */
export function nextStopIndex(t: number, cycle: number, stops: number): number {
  return ((Math.floor(t / cycle) % stops) + stops) % stops;
}
