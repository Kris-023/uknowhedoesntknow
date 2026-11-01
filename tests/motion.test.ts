import { describe, expect, it } from 'vitest';
import { SharedClock } from '../src/core/clock';
import { BLACKOUT } from '../src/config';
import { coachPower, flick, haltCountdown, shake } from '../src/core/motion';
import { REDUCED_STREAK_SPEED, streakSpeed } from '../src/scene/streakSpeed';
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

describe('oncoming trains and stops', async () => {
  const { oncoming, nextStopIndex } = await import('../src/core/motion');
  const { ONCOMING } = await import('../src/config');
  it('are the same on every peer and come with a side', () => {
    const seen = new Set<number>();
    for (let t = 0; t < 600; t += 0.05) {
      const a = oncoming(t, 42, ONCOMING);
      expect(a).toEqual(oncoming(t, 42, ONCOMING));
      if (a) {
        seen.add(a.id);
        expect(a.phase).toBeGreaterThanOrEqual(0);
        expect(a.phase).toBeLessThanOrEqual(1);
        expect([-1, 1]).toContain(a.side);
      }
    }
    // Rare but present: roughly `chance` of the windows in 10 minutes.
    expect(seen.size).toBeGreaterThan(4);
    expect(seen.size).toBeLessThan(21);
  });

  it('counts down to the stops in order and wraps', () => {
    expect([0, 90, 180, 270, 360, 450].map((t) => nextStopIndex(t + 1, 90, 5))).toEqual([0, 1, 2, 3, 4, 0]);
    expect(nextStopIndex(-1, 90, 5)).toBe(4);
  });
});

describe('comfort settings (visual only, never the events)', async () => {
  const { COMFORT_OFF, comfortOf, LightPower, shakeAmplitude, STEADY_NEON, windowFlash } = await import('../src/core/motion');
  const STEADY = { steady: true, fade: false };
  const FADE = { steady: true, fade: true };

  // One forced outage, sampled at 60 fps: the raw supply and what each mode shows the lights.
  const run = (c: { steady: boolean; fade: boolean }) => {
    const lp = new LightPower();
    const rows: { t: number; raw: number; lit: number }[] = [];
    for (let t = 90; t < 112; t += 1 / 60) {
      const raw = coachPower(t, 4242, BLACKOUT, 100);
      rows.push({ t, raw, lit: lp.step(raw, 1 / 60, c) });
    }
    return rows;
  };

  it('maps the settings to a comfort mode; fade needs reduceFlicker', () => {
    expect(comfortOf({ reduceFlicker: false, fadeBlackouts: true })).toEqual(COMFORT_OFF);
    expect(comfortOf({ reduceFlicker: true, fadeBlackouts: false })).toEqual(STEADY);
    expect(comfortOf({ reduceFlicker: true, fadeBlackouts: true })).toEqual(FADE);
  });

  it('flick and the window strobe are constant when steady, unchanged otherwise', () => {
    for (let t = 0; t < 60; t += 0.013) {
      expect(flick(t, 1.87, true)).toBe(STEADY_NEON);
      expect(flick(t, 1.87)).toBe(flick(t, 1.87, false));
      expect(windowFlash(t, 0.8, 1, true)).toBe(windowFlash(0, 0.8, 0, true));
    }
    expect(windowFlash(3.3, 0.8, 0)).toBe(windowFlash(3.3, 0.8, 0, false));
  });

  it('shows the raw supply unchanged without reduceFlicker', () => {
    for (const r of run(COMFORT_OFF)) expect(r.lit).toBe(r.raw);
  });

  it('steady: one clean cut instead of the stutter, raw power untouched', () => {
    const rows = run(STEADY);
    const edges = (k: 'raw' | 'lit') => rows.filter((r, i) => i && r[k] < 0.5 !== rows[i - 1][k] < 0.5).length;
    expect(edges('raw')).toBeGreaterThan(6);
    expect(edges('lit')).toBe(2);
    // The lights are dark whenever the raw supply is, and only ever fully on or off.
    for (const r of rows) {
      if (r.raw < 0.5) expect(r.lit).toBe(0);
      expect([0, 1]).toContain(r.lit);
    }
    // The raw supply is the very same function as before.
    expect(rows.map((r) => r.raw)).toEqual(run(COMFORT_OFF).map((r) => r.raw));
  });

  it('fade: intermediate light values at the edges, settles to the hard values, power stays hard', () => {
    const rows = run(FADE);
    expect(rows.filter((r) => r.lit > 0.05 && r.lit < 0.95).length).toBeGreaterThan(20);
    // Eased: never a big jump between frames.
    for (let i = 1; i < rows.length; i++) expect(Math.abs(rows[i].lit - rows[i - 1].lit)).toBeLessThan(0.15);
    expect(rows[0].lit).toBe(1);
    expect(rows[rows.length - 1].lit).toBeGreaterThan(0.99);
    expect(Math.min(...rows.map((r) => r.lit))).toBeLessThan(0.01);
    // The raw supply still has its hard 0 / 1 edges.
    expect(rows.some((r) => r.raw === 0)).toBe(true);
    expect(rows.every((r) => r.raw === 0 || r.raw === 1 || r.raw === 0.1)).toBe(true);
  });

  it('shake amplitude is the fixed base times the map factor, and zero with reduceMotion', () => {
    expect(shakeAmplitude(false, 5, 1)).toBeCloseTo(0.005);
    expect(shakeAmplitude(false, 5, 0.12)).toBeCloseTo(0.0006);
    expect(shakeAmplitude(true, 5, 1)).toBe(0);
    expect(shake(12.3, shakeAmplitude(true, 5, 1))).toEqual({ x: 0, y: 0, roll: 0 });
  });
});

describe('Weniger Bewegung: tunnel lines', () => {
  it('runs at full speed normally and slower when reduced', () => {
    expect(streakSpeed(false)).toBe(1);
    expect(streakSpeed(true)).toBe(REDUCED_STREAK_SPEED);
    expect(REDUCED_STREAK_SPEED).toBeGreaterThan(0);
    expect(REDUCED_STREAK_SPEED).toBeLessThan(1);
  });
});
