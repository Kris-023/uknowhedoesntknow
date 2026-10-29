import { describe, expect, it } from 'vitest';
import { COLLECTOR, PATROL, ROOM } from '../src/maps/spaeti/config';
import { collectorAt, freezeAt, patrolAt } from '../src/maps/spaeti/events';
import { compressorOn } from '../src/maps/spaeti/sound';

describe('Späti events', () => {
  it('sends the patrol by now and then, slowly, and freezes people only while it passes', () => {
    let windows = 0;
    let maxK = 0;
    let bad = 0;
    for (let w = 0; w < 120; w++) {
      let seen = false;
      for (let t = w * PATROL.windowS; t < (w + 1) * PATROL.windowS; t += 0.5) {
        const p = patrolAt(t, 42);
        const f = freezeAt(t, 42);
        if (f.k < 0 || f.k > 1 || f.at > t || (!p && f.k !== 0)) bad++;
        if (p) seen = true;
        maxK = Math.max(maxK, f.k);
      }
      if (seen) windows++;
    }
    expect(bad).toBe(0);
    // Chance 0.5: roughly half the windows.
    expect(windows).toBeGreaterThan(35);
    expect(windows).toBeLessThan(85);
    expect(maxK).toBeGreaterThan(0.99);
  });

  it('is the same on every client (pure function of t and seed)', () => {
    for (let t = 0; t < 400; t += 3.7) {
      expect(patrolAt(t, 7)).toEqual(patrolAt(t, 7));
      expect(collectorAt(t, 7)).toEqual(collectorAt(t, 7));
    }
  });

  it('walks the collector in through the door and out again each cycle', () => {
    let inside = false;
    let crossings = 0;
    for (let t = 0; t < COLLECTOR.cycleS * 3; t += 0.1) {
      const c = collectorAt(t, 42);
      const now = !!c && c.z < ROOM.front;
      if (now !== inside) crossings++;
      inside = now;
      if (c && c.z < ROOM.front) {
        // Inside he stays clear of the crate corner (x ≤ 0.3 + knees).
        expect(c.x).toBeGreaterThan(1.0);
      }
    }
    expect(crossings).toBeGreaterThanOrEqual(5);
  });

  it('cycles the fridge compressor', () => {
    let on = 0;
    for (let t = 0; t < 470; t += 1) if (compressorOn(t, 3)) on++;
    expect(on).toBeGreaterThan(150);
    expect(on).toBeLessThan(420);
  });
});
