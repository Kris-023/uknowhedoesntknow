import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { byTableOrder, setTableSeats, tableOrder } from '../src/game/tableOrder';
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
  });

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
