import { describe, expect, it } from 'vitest';
import { SharedClock } from '../src/core/clock';
import { BLACKOUT } from '../src/config';
import { coachPower, flick, haltCountdown, shake } from '../src/core/motion';
import { hash01, mulberry32 } from '../src/core/rng';

describe('shared-clock determinism', () => {
  it('rng yields the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('hash01 is stateless and in [0, 1)', () => {
    expect(hash01(1, 2, 3)).toBe(hash01(1, 2, 3));
    expect(hash01(1, 2, 3)).not.toBe(hash01(1, 2, 4));
    for (let i = 0; i < 1000; i++) {
      const v = hash01(7, i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('flick stays in range and actually flickers sometimes', () => {
    let dips = 0;
    for (let t = 0; t < 60; t += 0.01) {
      const k = flick(t, 1.87);
      expect(k).toBeGreaterThan(0);
      expect(k).toBeLessThanOrEqual(1);
      if (k < 0.5) dips++;
    }
    expect(dips).toBeGreaterThan(0);
  });

  it('shake scales linearly with amplitude and is zero at rest', () => {
    const a = shake(12.3, 0.008);
    const b = shake(12.3, 0.016);
    expect(b.x).toBeCloseTo(a.x * 2);
    expect(shake(12.3, 0)).toEqual({ x: 0, y: 0, roll: 0 });
  });

  it('halt countdown cycles from cycle down to 1', () => {
    expect(haltCountdown(0, 90)).toBe(90);
    expect(haltCountdown(89.5, 90)).toBe(1);
    expect(haltCountdown(90, 90)).toBe(90);
  });

  it('clock sync keeps the lowest-RTT sample', () => {
    const c = new SharedClock(1, 0);
    c.addSample(1000, 5050, 1100); // rtt 100 -> offset 4000
    c.addSample(2000, 6010, 2020); // rtt 20 -> offset 4000
    expect(c.offsetMs).toBe(4000);
    c.addSample(3000, 9999, 3500); // rtt 500, ignored
    expect(c.offsetMs).toBe(4000);
    expect(c.now(1000)).toBe(5);
  });

  it('coach power has rare outages of bounded length, and a forced one', () => {
    let darkFrames = 0;
    let outages = 0;
    let prev = 1;
    const step = 0.05;
    for (let t = 0; t < 3600; t += step) {
      const p = coachPower(t, 4242, BLACKOUT);
      if (p === 0) darkFrames++;
      if (p === 0 && prev !== 0) outages++;
      prev = p;
    }
    // Roughly one outage per window with the configured chance; restart flicker adds short extra dips.
    expect(outages).toBeGreaterThan(20);
    expect(darkFrames * step).toBeLessThan(3600 * 0.1);
    expect(coachPower(101.5, 4242, BLACKOUT, 100)).toBe(0);
  });
});
