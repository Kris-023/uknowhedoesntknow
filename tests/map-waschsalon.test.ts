import { describe, expect, it } from 'vitest';
import { WS } from '../src/maps/waschsalon/config';
import { FUSE_AFTER, imbalanceAt, imbalanceStart, laundromatPower, washAngle } from '../src/maps/waschsalon/schedule';

const firstEvent = (seed: number) => {
  for (let i = 0; i < 100; i++) {
    const s = imbalanceStart(i, seed);
    if (s !== null) return s;
  }
  throw new Error('no imbalance');
};

describe('waschsalon schedule', () => {
  it('places each imbalance and its outage inside its window', () => {
    for (let i = 0; i < 200; i++) {
      const s = imbalanceStart(i, 42);
      if (s === null) continue;
      expect(s).toBeGreaterThanOrEqual(i * WS.imbalance.windowS);
      expect(s + FUSE_AFTER + 4.5).toBeLessThan((i + 1) * WS.imbalance.windowS);
    }
  });

  it('rages, walks out, comes back, then trips the fuse', () => {
    const s = firstEvent(42);
    expect(imbalanceAt(s + 5, 42)!.shake).toBeCloseTo(1);
    expect(imbalanceAt(s + 8, 42)!.creep).toBeGreaterThan(0.5);
    expect(imbalanceAt(s + FUSE_AFTER, 42)!.creep).toBe(0);
    expect(laundromatPower(s + 5, 42, true, -Infinity)).toBe(1);
    expect(laundromatPower(s + FUSE_AFTER + 1, 42, true, -Infinity)).toBe(0);
    expect(laundromatPower(s + FUSE_AFTER + 4.5, 42, true, -Infinity)).toBe(1);
    // Blackouts off: the machine still rages, but the fuse holds.
    expect(laundromatPower(s + FUSE_AFTER + 1, 42, false, -Infinity)).toBe(1);
  });

  it('obeys a forced blackout', () => {
    expect(laundromatPower(101.5, 7, false, 100)).toBe(0);
  });

  it('turns the washer drum continuously', () => {
    for (let t = 0; t < 60; t += 0.05) expect(Math.abs(washAngle(t + 0.05, 0.3) - washAngle(t, 0.3))).toBeLessThan(0.5);
  });
});

describe('waschsalon seating', () => {
  const { seat, table, room, stack } = WS;
  it('gives neighbours about a metre and facing players about 1.7 m', () => {
    expect(seat.z * 2).toBeGreaterThanOrEqual(0.95);
    expect(seat.z * 2).toBeLessThanOrEqual(1.1);
    expect(seat.x * 2).toBeGreaterThanOrEqual(1.6);
    expect(seat.x * 2).toBeLessThanOrEqual(1.8);
  });

  it('keeps the table between the chairs and inside the room', () => {
    // Seat front edge (chair is 0.42 deep, 0.44 wide) sits just off the table edge:
    // close enough to reach, never inside the tabletop.
    const gap = seat.x - 0.21 - table.w / 2;
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(0.15);
    // Both chairs on one side fit along the table's length.
    expect(seat.z + 0.22).toBeLessThan(table.l / 2);
  });

  it('leaves walking room to the machines, the window counter and the scold spot', () => {
    expect(room.right - stack.depth - (seat.x * 1.15 + 0.3)).toBeGreaterThan(0.8);
    expect(seat.x + 0.45 + 0.5).toBeLessThan(room.right - stack.depth);
  });
});
