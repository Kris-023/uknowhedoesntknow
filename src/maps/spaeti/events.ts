import { smoothstep } from '../../core/motion';
import { hash01 } from '../../core/rng';
import { COLLECTOR, PATROL, ROOM } from './config';

// Everything that happens outside (and the bottle collector's round) as pure functions of the
// shared clock and seed: every client sees the same car at the same moment.

export interface Pass {
  /** Index of the window, to fire one-off sounds exactly once. */
  id: number;
  /** 0..1 through the pass. */
  phase: number;
  /** Driving direction along x. */
  dir: -1 | 1;
  /** Current x position. */
  x: number;
  lane: 0 | 1;
}

interface PassWindow {
  windowS: number;
  chance: number;
  durationS: number;
  fromX: number;
  toX: number;
}

/** One pass per clock window (with `chance`), at a hashed start time within it. */
export function pass(t: number, seed: number, w: PassWindow, salt: number): Pass | null {
  const idx = Math.floor(t / w.windowS);
  if (hash01(seed, idx, salt) > w.chance) return null;
  const start = idx * w.windowS + 1 + hash01(seed, idx, salt + 1) * (w.windowS - w.durationS - 2);
  const phase = (t - start) / w.durationS;
  if (phase < 0 || phase > 1) return null;
  const dir = hash01(seed, idx, salt + 2) < 0.5 ? -1 : 1;
  // Right-hand traffic: cars going +x use the near lane.
  const lane = dir === 1 ? 0 : 1;
  const x = dir === 1 ? w.fromX + (w.toX - w.fromX) * phase : w.toX + (w.fromX - w.toX) * phase;
  return { id: idx, phase, dir, x, lane };
}

export const patrolAt = (t: number, seed: number): Pass | null => pass(t, seed, PATROL, 31);

/**
 * How frozen the shop's people are (0..1) during a patrol: they stop mid-move while the blue
 * light is in front of the window. Also returns the clock time they froze at, so poses can be
 * re-evaluated there and blended (pure, no state).
 */
export function freezeAt(t: number, seed: number): { k: number; at: number } {
  const p = patrolAt(t, seed);
  if (!p) return { k: 0, at: t };
  // The car is in front of the window between x ≈ -6 and 6.
  const span = PATROL.toX - PATROL.fromX;
  const a = (-6 - PATROL.fromX) / span;
  const b = (6 - PATROL.fromX) / span;
  const k = smoothstep(a - 0.03, a + 0.02, p.phase) * (1 - smoothstep(b - 0.02, b + 0.04, p.phase));
  const start = t - (p.phase - (a - 0.03)) * PATROL.durationS;
  return { k, at: Math.min(t, start) };
}

/** The collector's place on his round, or null while he is away. */
export interface CollectorPose {
  x: number;
  z: number;
  yaw: number;
  walking: boolean;
  /** At the counter handing over bottles. */
  atCounter: boolean;
  /** Cycle index (for the door chime). */
  cycle: number;
  /** Seconds into the cycle. */
  c: number;
}

const DOOR_X = (ROOM.doorX0 + ROOM.doorX1) / 2;
/** Path: along the pavement, through the door, to the counter and back the same way. */
const PATH: readonly [number, number][] = [
  [-9, 4.1],
  [DOOR_X - 0.3, 4.1],
  [DOOR_X - 0.3, 2.2],
  [1.3, 0.85],
];

function lerpPath(u: number): [number, number, number] {
  const n = PATH.length - 1;
  const s = Math.max(0, Math.min(n - 1e-6, u * n));
  const i = Math.floor(s);
  const f = s - i;
  const [x0, z0] = PATH[i];
  const [x1, z1] = PATH[i + 1];
  return [x0 + (x1 - x0) * f, z0 + (z1 - z0) * f, Math.atan2(x1 - x0, z1 - z0)];
}

export function collectorAt(t: number, seed: number): CollectorPose | null {
  const C = COLLECTOR;
  const shifted = t + hash01(seed, 7) * C.cycleS;
  const cycle = Math.floor(shifted / C.cycleS);
  const c = shifted - cycle * C.cycleS;
  if (c > C.goneS) return null;
  // Path parameter 0..1 (one third per segment) in, hold at the counter, then back to the door
  // and off along the pavement the other way.
  let u: number;
  let out = false;
  if (c < C.arriveS) u = (c / C.arriveS) / 3;
  else if (c < C.enterS) u = (1 + (c - C.arriveS) / (C.enterS - C.arriveS)) / 3;
  else if (c < C.atCounterS) u = (2 + (c - C.enterS) / (C.atCounterS - C.enterS)) / 3;
  else if (c < C.leaveS) u = 1;
  else if (c < C.exitS) {
    u = 1 - ((c - C.leaveS) / (C.exitS - C.leaveS)) * (2 / 3);
    out = true;
  } else {
    const f = (c - C.exitS) / (C.goneS - C.exitS);
    return { x: DOOR_X - 0.3 + f * 9, z: 4.1, yaw: Math.PI / 2, walking: true, atCounter: false, cycle, c };
  }
  const [x, z, yawIn] = lerpPath(u);
  const holding = c >= C.atCounterS && c < C.leaveS;
  const yaw = holding ? Math.PI / 2 : out ? yawIn + Math.PI : yawIn;
  return { x, z, yaw, walking: !holding, atCounter: holding, cycle, c };
}
