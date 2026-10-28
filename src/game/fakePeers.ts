import { hash01 } from '../core/rng';

export interface PeerPose {
  yaw: number;
  pitch: number;
  /** Voice level 0..1 (drives the mouth). */
  level: number;
}

/**
 * Scripted stand-in for a remote player, so the coach feels inhabited without friends online.
 * Mostly idle sway; every few seconds the head turns slowly to another player and stays there
 * for a while (the moment the game is about). One player "talks" at a time.
 * Pure function of the clock, like all ambience.
 */
export function fakePeer(t: number, i: number, seed: number, yawTo: (j: number) => number, count: number): PeerPose {
  const cycleLen = 6 + (i % 3);
  const cycle = Math.floor((t + i * 1.7) / cycleLen);
  const ph = t + i * 1.7 - cycle * cycleLen;
  let yaw = 0.18 * Math.sin(t * 0.5 + i * 2.1);
  if (hash01(seed, i, cycle) < 0.55) {
    const start = 0.5 + hash01(seed, i, cycle, 1) * 1.5;
    const dur = 2.5 + hash01(seed, i, cycle, 2) * 2;
    if (ph > start && ph < start + dur) {
      const j = (i + 1 + Math.floor(hash01(seed, i, cycle, 3) * (count - 1))) % count;
      yaw = yawTo(j);
    }
  }
  const speaker = Math.floor(t / 3.2) % count;
  const level = speaker === i ? (0.5 + 0.5 * Math.sin(t * 14)) * (0.5 + 0.5 * Math.sin(t * 4.3 + i)) : 0;
  return { yaw, pitch: 0.06 + 0.04 * Math.sin(t * 0.37 + i), level };
}
