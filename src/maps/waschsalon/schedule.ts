import { coachPower, smoothstep } from '../../core/motion';
import { hash01 } from '../../core/rng';
import { WS } from './config';

// Everything that happens in the laundromat, as pure functions of clock time and room seed.
// Scene and sound both read these, so every client sees and hears the same machine go wild.

const IM = WS.imbalance;
const RAGE_END = IM.rampS + IM.rageS;
const SETTLE_END = RAGE_END + IM.settleS;
/** Seconds from the event start to the moment the fuse trips. */
export const FUSE_AFTER = SETTLE_END + IM.fuseDelayS;
/** Room for the event plus the outage (coachPower's forced outage spans ~4 s) inside one window. */
const EVENT_SPAN = FUSE_AFTER + 5;
/** A window without any random outage, so only the fuse trip (and the debug button) cut the power. */
const NO_RANDOM = { windowS: 37, chance: -1, minS: 1, maxS: 2 };

/** Clock time at which window `idx` has its imbalance, or null if that window stays calm. */
export function imbalanceStart(idx: number, seed: number): number | null {
  if (idx < 0 || hash01(seed, idx, 311) > IM.chance) return null;
  const span = IM.windowS - EVENT_SPAN - IM.minStart;
  return idx * IM.windowS + IM.minStart + hash01(seed, idx, 312) * span;
}

export interface ImbalanceState {
  /** Window index, to fire one-shot sounds exactly once. */
  id: number;
  /** Seconds since the machine started to spin up (negative = not yet). */
  ph: number;
  /** 0..1 how hard it shakes. */
  shake: number;
  /** 0..1 how far it has walked away from the wall. */
  creep: number;
  /** 0..1 drum speed, from normal washing (0) to a full spin (1). */
  spin: number;
  /** Clock time the fuse trips. */
  fuseAt: number;
}

/** The current (or most recent) imbalance event of this window, or null. */
export function imbalanceAt(t: number, seed: number): ImbalanceState | null {
  const id = Math.floor(t / IM.windowS);
  const start = imbalanceStart(id, seed);
  if (start === null) return null;
  const ph = t - start;
  const shake = smoothstep(0, IM.rampS, ph) * (1 - smoothstep(RAGE_END, SETTLE_END, ph));
  // Walks out in jerks while raging, then is shoved back into place as it calms down.
  const walk = smoothstep(IM.rampS * 0.6, RAGE_END, ph) + 0.06 * Math.max(0, Math.sin(ph * 9)) * shake;
  const creep = Math.min(1, walk) * (1 - smoothstep(RAGE_END + 0.5, SETTLE_END, ph));
  const spin = smoothstep(-0.5, IM.rampS, ph) * (1 - smoothstep(RAGE_END, SETTLE_END + 1, ph));
  return { id, ph, shake, creep, spin, fuseAt: start + FUSE_AFTER };
}

/**
 * Supply of the laundromat. With blackouts allowed, the fuse trips right after each imbalance;
 * the debug/host button forces an outage at once. Same stutter-out, dark, stutter-on shape as the
 * coach (coachPower), so relay clunks and the frame tracer behave the same.
 */
export function laundromatPower(t: number, seed: number, blackouts: boolean, forcedAt: number): number {
  const forced = coachPower(t, seed, NO_RANDOM, forcedAt);
  if (!blackouts) return forced;
  const ev = imbalanceAt(t, seed);
  // coachPower's forced outage starts its stutter 0.6 s after `forcedAt`, so shift by that.
  const fuse = ev ? coachPower(t, seed, NO_RANDOM, ev.fuseAt - 0.6) : 1;
  return Math.min(forced, fuse);
}

/** Machine `i` is running (laundry inside, display lit). Long programmes with seeded gaps. */
export function machineBusy(i: number, t: number, seed: number): boolean {
  const T = WS.tumble;
  const off = hash01(seed, i, 41) * T.cycleS;
  const k = Math.floor((t + off) / T.cycleS);
  // Some machines sit idle for a whole cycle, the rest run most of theirs.
  if (hash01(seed, i, k) < 0.18) return false;
  return ((t + off) % T.cycleS) / T.cycleS < T.busy;
}

/** Washer drum angle: tumble one way, pause, tumble back. Continuous across cycles. */
export function washAngle(t: number, off: number): number {
  const T = WS.tumble;
  const P = T.washS + T.pauseS;
  const u = t + off;
  const k = Math.floor(u / P);
  const full = T.washRate * T.washS;
  // smoothstep's integral-like ease: slow start, full speed, slow stop.
  const f = full * smoothstep(0, T.washS, u - k * P);
  return k % 2 === 0 ? f : full - f;
}

/** Dryer drum angle: one slow direction, forever. */
export function dryAngle(t: number, off: number): number {
  return WS.tumble.dryRate * (t + off);
}

/** Clock time of the dryer beep in beep window `idx`, or null. */
export function beepAt(idx: number, seed: number): number | null {
  const S = WS.sound;
  if (hash01(seed, idx, 521) > S.beepChance) return null;
  return idx * S.beepWindowS + 1 + hash01(seed, idx, 522) * (S.beepWindowS - 3);
}

/** Coins the man feeds the changer: a try every `period` seconds; the machine keeps them all. */
export function coinRoutine(t: number, seed: number): { ph: number; cycle: number; period: number } {
  const period = 11;
  const u = t + hash01(seed, 7, 77) * period;
  const cycle = Math.floor(u / period);
  return { ph: u - cycle * period, cycle, period };
}

/** Flicker seed of the bad tube; the room seed shifts it so two rooms don't stutter in lockstep. */
export function badTubeSeed(seed: number): number {
  return 2.1 + (Math.abs(seed) % 997) * 0.013;
}
