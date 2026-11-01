import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { byTableOrder, fillOrder, setTableSeats, tableOrder } from '../src/game/tableOrder';
import { MAPS } from '../src/maps';
import { MAP_IDS } from '../src/maps/types';

// The maps paint their textures on <canvas>; node has none, so a canvas that swallows every call is enough to build them.
const swallow = (): unknown => new Proxy(function () {}, { get: (_t, k) => (k === 'width' || k === 'height' ? 0 : swallow()), set: () => true, apply: () => swallow() });
const realDocument = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 1, height: 1, getContext: () => swallow(), style: {} }) };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDocument;
});

/** Seen from above: x to the right, z towards the bottom of the picture. */
const corner = (p: { x: number; z: number }, all: { x: number; z: number }[]) => {
  const cx = all.reduce((s, q) => s + q.x, 0) / all.length;
  const cz = all.reduce((s, q) => s + q.z, 0) / all.length;
  return (p.z < cz ? 'T' : 'B') + (p.x < cx ? 'L' : 'R');
};

describe('table order', () => {
  it('runs top right, top left, bottom left, bottom right on every map', () => {
    for (const id of MAP_IDS) {
      const seats = MAPS[id].build(new THREE.Scene(), 1).seats;
      const order = tableOrder(seats);
      expect(order.map((i) => corner(seats[i], [...seats])), id).toEqual(['TR', 'TL', 'BL', 'BR']);
    }
    // Builds every map: slow when suites run concurrently.
  }, 30_000);

  it('turns counter-clockwise seen from above on every map', () => {
    for (const id of MAP_IDS) {
      const seats = MAPS[id].build(new THREE.Scene(), 1).seats;
      const p = tableOrder(seats).map((i) => seats[i]);
      // Looking down -y (x right, z down the picture) the screen cross product is -(dx1*dz2 - dz1*dx2); positive = left turn.
      for (let k = 0; k < 4; k++) {
        const a = p[k];
        const b = p[(k + 1) % 4];
        const c = p[(k + 2) % 4];
        const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
        expect(-cross, `${id} step ${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('orders players by seat in the current map, unknown seats last', () => {
    setTableSeats([
      { x: -1, z: -1 },
      { x: 1, z: -1 },
      { x: -1, z: 1 },
      { x: 1, z: 1 },
    ]);
    expect([0, 1, 2, 3].sort(byTableOrder)).toEqual([1, 0, 2, 3]);
    expect([7, 3, 1].sort(byTableOrder)).toEqual([1, 3, 7]);
    // The hypertrain numbers its seats differently: 2 is top right there.
    const hyper = MAPS.hypertrain.build(new THREE.Scene(), 1).seats;
    setTableSeats(hyper);
    expect([0, 1, 2, 3].sort(byTableOrder)).toEqual([2, 0, 1, 3]);
  });
});

describe('seat fill order', () => {
  // Seen from above, the first two players must sit on opposite sides of the table, looking at each other.
  it('puts the first two seats across the table from each other on every map', () => {
    const expected: Record<string, number[]> = { hypertrain: [0, 2, 1, 3], waschsalon: [0, 1, 2, 3], buergeramt: [0, 1, 2, 3], spaeti: [0, 1, 2, 3], wg: [0, 1, 2, 3], diner: [0, 1, 2, 3] };
    for (const id of MAP_IDS) {
      const seats = MAPS[id].build(new THREE.Scene(), 1).seats;
      const order = fillOrder(seats);
      expect(order, id).toEqual(expected[id]);
      for (const [a, b] of [order.slice(0, 2), order.slice(2)]) {
        const sa = seats[a];
        const sb = seats[b];
        // Same line across (no sideways offset along the facing direction's normal) ...
        const fx = Math.sin(sa.yaw);
        const fz = Math.cos(sa.yaw);
        expect(Math.abs((sb.x - sa.x) * fz - (sb.z - sa.z) * fx), `${id} ${a}/${b} offset`).toBeLessThan(1e-6);
        // ... in front of one another, looking at each other.
        expect((sb.x - sa.x) * fx + (sb.z - sa.z) * fz, `${id} ${a}/${b} in front`).toBeGreaterThan(0);
        expect(Math.sin(sb.yaw) * fx + Math.cos(sb.yaw) * fz, `${id} ${a}/${b} facing`).toBeLessThan(0);
      }
      expect([...order].sort(), id).toEqual([0, 1, 2, 3]);
    }
  }, 30_000);

  it('picks the seat in front, not the diagonal, on a rectangular table in any numbering', () => {
    // 0 top left facing right; 1 bottom right (diagonal, farthest), 2 top right (across), 3 bottom left.
    const seats = [
      { x: -1, z: -1, yaw: Math.PI / 2 },
      { x: 1, z: 1, yaw: -Math.PI / 2 },
      { x: 1, z: -1, yaw: -Math.PI / 2 },
      { x: -1, z: 1, yaw: Math.PI / 2 },
    ];
    expect(fillOrder(seats)).toEqual([0, 2, 3, 1]);
    expect(fillOrder([])).toEqual([]);
  });

  it('leaves the turn order alone', () => {
    // The fill order is a different thing: turn order still follows the geometry (see above), whatever fills first.
    setTableSeats(MAPS.hypertrain.build(new THREE.Scene(), 1).seats);
    expect([0, 1, 2, 3].sort(byTableOrder)).toEqual([2, 0, 1, 3]);
    setTableSeats(MAPS.waschsalon.build(new THREE.Scene(), 1).seats);
    expect([0, 1, 2, 3].sort(byTableOrder)).toEqual([1, 0, 2, 3]);
  });
});
