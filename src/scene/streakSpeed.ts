/**
 * Weniger Bewegung: how fast the hypertrain's tunnel lines rush past the windows, as a fraction of
 * normal. Visual only: it scales the distance the tunnel and the speed-FOV read, never `kmh`, the
 * clock, `power`, sounds or events, so peers stay in step.
 * Why 0.3: slow enough that the streaks read as drifting light, fast enough to still feel like a train.
 */
export const REDUCED_STREAK_SPEED = 0.3;

export function streakSpeed(reduceMotion: boolean): number {
  return reduceMotion ? REDUCED_STREAK_SPEED : 1;
}
