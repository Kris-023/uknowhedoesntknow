import { describe, expect, it } from 'vitest';
import { KNOCK, LAVA, ROOM, SEAT, TABLE } from '../src/maps/wg/config';
import { bassLevel, catDelay, fairyContact, freezeAt, knock, lavaDetach, nextKnock, nextLava } from '../src/maps/wg/events';

describe('wg events', () => {
  it('finds a knock and keeps it inside its clock window', () => {
    for (const seed of [1, 42, 777]) {
      const s = nextKnock(0, seed);
      const k = knock(s + 1, seed);
      expect(k).not.toBeNull();
      expect(k!.ph).toBeCloseTo(1, 5);
      expect(Math.floor(s / KNOCK.windowS)).toBe(Math.floor((s + KNOCK.durationS) / KNOCK.windowS));
    }
  });

  it('cuts the fairy lights and the bass during the knock, then brings them back', () => {
    const seed = 42;
    const s = nextKnock(0, seed);
    expect(fairyContact(s + 4, seed, knock(s + 4, seed))).toBe(0);
    expect(bassLevel(knock(s + 5, seed))).toBe(0);
    expect(bassLevel(knock(s + KNOCK.bassBack[1] + 0.1, seed))).toBe(1);
    expect(freezeAt(3)).toBe(1);
    expect(freezeAt(KNOCK.durationS)).toBe(0);
  });

  it('keeps the fairy lights steady with Weniger Flackern: dark stays dark, no stutter', () => {
    const seed = 42;
    const s = nextKnock(0, seed);
    expect(fairyContact(s + 4, seed, knock(s + 4, seed), true)).toBe(0);
    const after = s + KNOCK.lightsOff[1] + 0.2;
    expect(fairyContact(after, seed, knock(after, seed), true)).toBe(0.92);
    let steadyDips = 0;
    let rawDips = 0;
    for (let t = 0; t < 900; t += 0.01) {
      const k = knock(t, seed);
      // Only fully off or the one steady level; never a stutter in between.
      expect([0, 0.92]).toContain(fairyContact(t, seed, k, true));
      // Count entries into a dark spell as seen by each mode.
      if (fairyContact(t, seed, k, true) === 0 && fairyContact(t - 0.01, seed, knock(t - 0.01, seed), true) !== 0) steadyDips++;
      if (fairyContact(t, seed, k) < 0.1 && fairyContact(t - 0.01, seed, knock(t - 0.01, seed)) >= 0.1) rawDips++;
    }
    expect(steadyDips).toBeGreaterThan(0);
    expect(rawDips).toBeGreaterThan(steadyDips);
    // A 900 s sweep in 10 ms steps: slow when suites run concurrently.
  }, 30_000);

  it('pauses the cat by the integrated freeze, no more', () => {
    const seed = 42;
    const s = nextKnock(0, seed);
    expect(catDelay(s - 0.1, seed)).toBe(0);
    const d = catDelay(s + KNOCK.durationS, seed);
    expect(d).toBeGreaterThan(4);
    expect(d).toBeLessThan(KNOCK.freeze[1]);
  });

  it('lets a lava blob detach now and then', () => {
    const s = nextLava(0, 42);
    expect(lavaDetach(s + LAVA.durationS / 2, 42)!.ph).toBeCloseTo(0.5, 5);
  });

  it('seats the four players about a metre apart, with elbow room around the table', () => {
    expect(2 * SEAT.z).toBeGreaterThanOrEqual(1.0);
    expect(2 * SEAT.x).toBeGreaterThanOrEqual(1.7);
    expect(2 * SEAT.x).toBeLessThanOrEqual(1.9);
    // The table never reaches under the hips, and fits between the seat rows.
    expect(TABLE.w / 2).toBeLessThan(SEAT.x - 0.4);
    expect(TABLE.d / 2).toBeGreaterThan(SEAT.z);
    // Sofa wall stays far enough behind the sofa seats for the sofa's depth.
    expect(-SEAT.x - ROOM.minX).toBeGreaterThanOrEqual(0.6);
  });
});
