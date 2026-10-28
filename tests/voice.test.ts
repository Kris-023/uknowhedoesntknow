import { describe, expect, it } from 'vitest';
import { distanceMix, gateStep, rmsToLevel } from '../src/audio/voice';
import { VOICE } from '../src/config';

const rmsAt = (db: number) => 10 ** (db / 20);

describe('voice levels', () => {
  it('keeps the mouth shut below the gate and wide open at full level', () => {
    expect(rmsToLevel(0)).toBe(0);
    expect(rmsToLevel(rmsAt(VOICE.gateDb - 5))).toBe(0);
    expect(rmsToLevel(rmsAt(VOICE.fullDb + 5))).toBe(1);
    expect(rmsToLevel(rmsAt((VOICE.gateDb + VOICE.fullDb) / 2))).toBeCloseTo(0.5, 5);
  });

  it('voices in the coach stay dry, distant ones get dull and echoey', () => {
    const near = distanceMix(1.5);
    expect(near.lowpassHz).toBeCloseTo(VOICE.lowpassNearHz, 0);
    expect(near.wet).toBeCloseTo(VOICE.wetNear, 5);
    const mid = distanceMix((VOICE.nearM + VOICE.farM) / 2);
    expect(mid.lowpassHz).toBeLessThan(VOICE.lowpassNearHz);
    expect(mid.wet).toBeGreaterThan(VOICE.wetNear);
    const far = distanceMix(VOICE.farM + 5);
    expect(far.lowpassHz).toBeCloseTo(VOICE.lowpassFarHz, 0);
    expect(far.wet).toBeCloseTo(VOICE.wetFar, 5);
  });
});

describe('voice activation', () => {
  /** Feed levels every 15 ms, return the gate state per step. */
  const run = (levels: number[], threshold = 0.5, hang = 450) => {
    let g = { open: false, lastLoud: -Infinity };
    return levels.map((l, i) => (g = gateStep(g.open, l, threshold, i * 15, g.lastLoud, hang)).open);
  };

  it('stays closed below the threshold', () => {
    expect(run([0.1, 0.3, 0.49, 0.2]).some(Boolean)).toBe(false);
  });

  it('opens at once, holds through short pauses, closes after the hang time', () => {
    const quiet = (n: number) => Array(n).fill(0);
    const states = run([0.8, ...quiet(20), 0.7, ...quiet(40)]);
    expect(states[0]).toBe(true);
    // 300 ms pause between two words: still open.
    expect(states.slice(0, 22).every(Boolean)).toBe(true);
    // 450 ms after the last loud moment it's closed.
    expect(states[21 + 30]).toBe(false);
    expect(states.at(-1)).toBe(false);
  });
});
