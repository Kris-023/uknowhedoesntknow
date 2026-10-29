import { smoothstep } from '../../core/motion';
import { hash01 } from '../../core/rng';
import { KNOCK, LAVA } from './config';

// Pure schedules of the shared clock and the room seed: every peer sees and hears the same night.

export interface Phase {
  /** Index of the clock window, to fire one-shot sounds exactly once. */
  id: number;
  /** Seconds since the event started. */
  ph: number;
}

/** Clock time the knock of window `idx` starts at, or null if that window stays quiet. */
export function knockStart(idx: number, seed: number): number | null {
  if (hash01(seed, idx, 31) > KNOCK.chance) return null;
  const room = KNOCK.windowS - KNOCK.durationS - KNOCK.leadS - 1;
  return idx * KNOCK.windowS + KNOCK.leadS + hash01(seed, idx, 32) * room;
}

/** The neighbour knocking right now (thuds, freeze, silence, slow return), or null. */
export function knock(t: number, seed: number): Phase | null {
  const idx = Math.floor(t / KNOCK.windowS);
  const s = knockStart(idx, seed);
  if (s === null || t < s || t > s + KNOCK.durationS) return null;
  return { id: idx, ph: t - s };
}

/** First knock at or after `from` (for tests and the debug clock jump). */
export function nextKnock(from: number, seed: number): number {
  for (let idx = Math.floor(from / KNOCK.windowS); ; idx++) {
    const s = knockStart(idx, seed);
    if (s !== null && s >= from) return s;
  }
}

/** 0..1: how still everyone holds during a knock. */
export function freezeAt(ph: number): number {
  const [a, b] = KNOCK.freeze;
  return smoothstep(a, a + 0.5, ph) * (1 - smoothstep(b - 1.5, b, ph));
}

/** Music level 0..1 at knock phase `ph`; null phase = full. */
export function bassLevel(k: Phase | null): number {
  if (!k) return 1;
  if (k.ph < KNOCK.bassOff) return 1;
  return smoothstep(KNOCK.bassBack[0], KNOCK.bassBack[1], k.ph);
}

/**
 * Fairy lights on a loose contact: steady most of the time, a stutter now and then, rarely a few
 * seconds dark. The neighbour's knock shakes them out until someone jiggles the plug.
 */
export function fairyContact(t: number, seed: number, k: Phase | null): number {
  if (k) {
    const [off, on] = KNOCK.lightsOff;
    if (k.ph >= off && k.ph < off + 0.35) return Math.sin(k.ph * 80) > 0 ? 1 : 0.05;
    if (k.ph >= off && k.ph < on) return 0;
    if (k.ph >= on && k.ph < on + 0.8) return Math.sin(k.ph * 47) > -0.2 ? 1 : 0;
  }
  const period = 9;
  const cyc = Math.floor(t / period);
  const ph = t - cyc * period;
  const r = hash01(seed, cyc, 41);
  if (r < 0.35) {
    const at = hash01(seed, cyc, 42) * 6;
    const dur = 0.15 + hash01(seed, cyc, 43) * 0.7;
    if (ph > at && ph < at + dur) return Math.sin(ph * (35 + 60 * hash01(seed, cyc, 44))) > 0 ? 0.95 : 0.04;
  } else if (r > 0.94) {
    if (ph > 2 && ph < 4.5) return ph < 2.2 || ph > 4.3 ? (Math.sin(ph * 70) > 0 ? 1 : 0) : 0;
  }
  return 0.92 + 0.08 * Math.sin(t * 1.3 + seed);
}

/** A lava blob tearing loose, 0..1 through its rise and fall, or null. */
export function lavaDetach(t: number, seed: number): Phase | null {
  const idx = Math.floor(t / LAVA.windowS);
  if (hash01(seed, idx, 51) > LAVA.chance) return null;
  const s = idx * LAVA.windowS + 3 + hash01(seed, idx, 52) * (LAVA.windowS - LAVA.durationS - 6);
  if (t < s || t > s + LAVA.durationS) return null;
  return { id: idx, ph: (t - s) / LAVA.durationS };
}

/** First blob detach at or after `from`. */
export function nextLava(from: number, seed: number): number {
  for (let idx = Math.floor(from / LAVA.windowS); ; idx++) {
    if (hash01(seed, idx, 51) > LAVA.chance) continue;
    const s = idx * LAVA.windowS + 3 + hash01(seed, idx, 52) * (LAVA.windowS - LAVA.durationS - 6);
    if (s >= from) return s;
  }
}

/** The TV loops: test pattern most of the night, snow in between (40 s slots). */
export function tvSnow(t: number, seed: number): boolean {
  return hash01(seed, Math.floor(t / 40), 61) < 0.4;
}

/**
 * Seconds the cat's routine lags behind the clock in this knock window: it stops dead while the
 * neighbour knocks. Integrated from the knock start, so it is still a pure function of t.
 */
export function catDelay(t: number, seed: number): number {
  const idx = Math.floor(t / KNOCK.windowS);
  const s = knockStart(idx, seed);
  if (s === null || t < s) return 0;
  const end = Math.min(t - s, KNOCK.freeze[1]);
  let d = 0;
  const step = 0.05;
  for (let ph = 0; ph < end; ph += step) d += freezeAt(ph) * Math.min(step, end - ph);
  return d;
}
