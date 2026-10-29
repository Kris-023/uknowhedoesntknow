import { smoothstep } from '../../core/motion';
import { hash01 } from '../../core/rng';
import { COOK_BELL_AT, COOK_LOOP_S, FRYER, SIGN } from './config';

// Everything that happens in the diner, as pure functions of clock and seed: the same t gives the
// same flare, the same dead letter and the same waitress position on every client.

/**
 * Dev hook: clock time of a forced flare (set from the console via the map's `forceFlare`). Local
 * to this tab, like the debug panel's forced blackout.
 */
export const debugFlare = { at: -Infinity };

export interface Flare {
  /** Window index, to fire the sound exactly once. */
  id: number;
  /** Seconds since the flare started (0..FRYER.durS). */
  ph: number;
}

function flareStart(idx: number, seed: number): number | null {
  if (hash01(seed, idx, 311) > FRYER.chance) return null;
  return idx * FRYER.windowS + 5 + hash01(seed, idx, 312) * (FRYER.windowS - FRYER.durS - 10);
}

/** The deep fryer flaring up, or null. */
export function fryerFlare(t: number, seed: number, forcedAt = -Infinity): Flare | null {
  const f = t - forcedAt;
  if (f >= 0 && f <= FRYER.durS) return { id: -1 - Math.floor(forcedAt), ph: f };
  const idx = Math.floor(t / FRYER.windowS);
  const start = flareStart(idx, seed);
  if (start === null) return null;
  const ph = t - start;
  return ph < 0 || ph > FRYER.durS ? null : { id: idx, ph };
}

/** Clock time of the next flare at or after `t` (for tests and the screenshot script). */
export function nextFlare(t: number, seed: number): number {
  for (let idx = Math.floor(t / FRYER.windowS); ; idx++) {
    const s = flareStart(idx, seed);
    if (s !== null && s >= t) return s;
  }
}

/** Shape of a flare: the first flash, the flames, the smoke, the cook's jump, the beeping. */
export function flareShape(ph: number): { flash: number; fire: number; smoke: number; jump: number; beep: boolean } {
  const flash = ph < 0 ? 0 : Math.exp(-ph * 5) * smoothstep(0, 0.05, ph);
  const fire = smoothstep(0, 0.12, ph) * (1 - smoothstep(1.2, 3.6, ph));
  const smoke = smoothstep(0.3, 1.4, ph) * (1 - smoothstep(4.5, FRYER.durS, ph));
  const jump = smoothstep(0.08, 0.3, ph) * (1 - smoothstep(2.8, 4.6, ph));
  const beep = FRYER.beeps.some((b) => ph >= b && ph < b + FRYER.beepS);
  return { flash, fire, smoke, jump, beep };
}

/**
 * Brightness of each sign letter. Some windows hold one dying letter: it stutters, goes dark for a
 * few seconds and stutters back. Returns the index of the troubled letter (-1 = all fine).
 */
export function signLetters(t: number, seed: number, count: number, out: number[]): number {
  out.length = count;
  out.fill(1);
  const idx = Math.floor(t / SIGN.windowS);
  if (hash01(seed, idx, 401) > SIGN.chance) return -1;
  const letter = Math.floor(hash01(seed, idx, 402) * count) % count;
  const off = SIGN.minOffS + hash01(seed, idx, 403) * (SIGN.maxOffS - SIGN.minOffS);
  const start = idx * SIGN.windowS + 2 + hash01(seed, idx, 404) * (SIGN.windowS - off - 5);
  const ph = t - start;
  if (ph < 0 || ph > off + 1.6) return -1;
  let k: number;
  if (ph < 0.8) k = Math.sin(ph * 70 + letter) > 0.2 ? 1 : 0.1;
  else if (ph < 0.8 + off) k = 0;
  else k = Math.sin(ph * 48) > -0.2 ? 0.9 : 0.05;
  out[letter] = k;
  return letter;
}

/** Waitress stops behind the counter: where she stands, which way she faces, what she does. */
export type WaitressAct = 'fetch' | 'pour' | 'wipe' | 'idle' | 'walk';
const STOPS: { z: number; yaw: number; act: WaitressAct; dur: number }[] = [
  { z: -2.05, yaw: Math.PI / 2, act: 'fetch', dur: 6 },
  { z: 1.2, yaw: -Math.PI / 2, act: 'pour', dur: 6.5 },
  { z: -0.1, yaw: -Math.PI / 2, act: 'wipe', dur: 9 },
  { z: -1.4, yaw: -Math.PI / 2, act: 'idle', dur: 6 },
];
const WALK_SPEED = 0.75;
/** Built once: start times of each stop and of each walk after it. */
const PLAN = (() => {
  const legs: { t0: number; stop: (typeof STOPS)[number]; walkT0: number; walkS: number; next: (typeof STOPS)[number] }[] = [];
  let t = 0;
  STOPS.forEach((stop, i) => {
    const next = STOPS[(i + 1) % STOPS.length];
    const walkS = Math.abs(next.z - stop.z) / WALK_SPEED + 0.8;
    legs.push({ t0: t, stop, walkT0: t + stop.dur, walkS, next });
    t += stop.dur + walkS;
  });
  return { legs, loop: t };
})();
export const WAITRESS_LOOP = PLAN.loop;

export interface WaitressPose {
  z: number;
  yaw: number;
  act: WaitressAct;
  /** Seconds into the current act. */
  ph: number;
  /** She is carrying the pot (not at the machine). */
  hasPot: boolean;
}

const lerpAngle = (a: number, b: number, k: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

export function waitressPose(t: number, seed: number): WaitressPose {
  const u = (((t + (seed % 97) * 0.61) % PLAN.loop) + PLAN.loop) % PLAN.loop;
  let leg = PLAN.legs[0];
  for (const l of PLAN.legs) if (l.t0 <= u) leg = l;
  // She takes the pot at the end of the fetch and puts it back right as she arrives.
  if (u < leg.walkT0) {
    const ph = u - leg.t0;
    const hasPot = leg.stop.act !== 'fetch' || ph > leg.stop.dur - 1.2;
    return { z: leg.stop.z, yaw: leg.stop.yaw, act: leg.stop.act, ph, hasPot };
  }
  const ph = u - leg.walkT0;
  const k = smoothstep(0.4, leg.walkS - 0.4, ph);
  const z = leg.stop.z + (leg.next.z - leg.stop.z) * k;
  const travel = leg.next.z > leg.stop.z ? 0 : Math.PI;
  // Turn into the walk at the start and out of it at the end.
  const tin = smoothstep(0, 0.5, ph);
  const tout = smoothstep(leg.walkS - 0.5, leg.walkS, ph);
  const yaw = lerpAngle(lerpAngle(leg.stop.yaw, travel, tin), leg.next.yaw, tout);
  return { z, yaw, act: 'walk', ph, hasPot: leg.next.act !== 'fetch' || ph < leg.walkS - 0.3 };
}

/** The cook's routine; the bell rings at COOK_BELL_AT each loop. */
export type CookAct = 'grill' | 'glare' | 'fryer' | 'bell';
export function cookPose(t: number): { z: number; act: CookAct; ph: number } {
  const u = ((t % COOK_LOOP_S) + COOK_LOOP_S) % COOK_LOOP_S;
  const glide = (a: number, b: number, t0: number, t1: number) => a + (b - a) * smoothstep(t0, t1, u);
  if (u < 6) return { z: 0.25, act: 'grill', ph: u };
  if (u < 9) return { z: 0.25, act: 'glare', ph: u - 6 };
  if (u < 13) return { z: glide(0.25, -0.5, 9, 9.8), act: 'fryer', ph: u - 9 };
  if (u < COOK_BELL_AT + 1.2) return { z: glide(-0.5, 0.35, 13, 13.9), act: 'bell', ph: u - 13 };
  return { z: glide(0.35, 0.25, COOK_BELL_AT + 1.2, COOK_BELL_AT + 2), act: 'grill', ph: u };
}

/** Index of the bell ring at or before `t` (rings once per cook loop). */
export const bellIndex = (t: number) => Math.floor((t - COOK_BELL_AT) / COOK_LOOP_S);
