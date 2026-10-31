import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GAZE } from '../src/config';
import { Gaze, gazePick, PickState } from '../src/game/gaze';
import { Players } from '../src/game/players';
import type { Spot } from '../src/maps/types';

const deg = (d: number) => (d * Math.PI) / 180;
const O = { x: 0, y: 0, z: 0 };
/** A point at `angle` degrees to the right of the +z axis, `dist` away. */
const at = (angle: number, dist = 2) => ({ x: Math.sin(deg(angle)) * dist, y: 0, z: Math.cos(deg(angle)) * dist });

describe('gaze: whom am I looking at', () => {
  const max = deg(GAZE.maxAngleDeg);

  it('picks the head straight ahead, and the one closest to the view ray', () => {
    const t = [
      { key: 'a', pos: at(0) },
      { key: 'b', pos: at(12) },
    ];
    expect(gazePick(O, { x: 0, y: 0, z: 1 }, t, max)).toBe('a');
    expect(gazePick(O, at(9, 1), t, max)).toBe('b');
  });

  it('nobody beyond the threshold, nobody behind', () => {
    const t = [{ key: 'a', pos: at(GAZE.maxAngleDeg + 2) }];
    expect(gazePick(O, { x: 0, y: 0, z: 1 }, t, max)).toBeNull();
    expect(gazePick(O, { x: 0, y: 0, z: -1 }, [{ key: 'a', pos: at(0) }], max)).toBeNull();
    // Just inside counts.
    expect(gazePick(O, { x: 0, y: 0, z: 1 }, [{ key: 'a', pos: at(GAZE.maxAngleDeg - 1) }], max)).toBe('a');
  });

  it('distance does not matter, only the angle; up and down count too', () => {
    const t = [
      { key: 'near', pos: at(10, 0.8) },
      { key: 'far', pos: at(5, 6) },
    ];
    expect(gazePick(O, { x: 0, y: 0, z: 1 }, t, max)).toBe('far');
    expect(gazePick(O, { x: 0, y: 1, z: 0 }, t, max)).toBeNull();
  });

  it('the current pick sticks within a few extra degrees, so it does not flicker', () => {
    const t = [
      { key: 'a', pos: at(-8) },
      { key: 'b', pos: at(8) },
    ];
    // Slightly closer to b, but a was picked and stays.
    const dir = at(1, 1);
    expect(gazePick(O, dir, t, max)).toBe('b');
    expect(gazePick(O, dir, t, max, 'a', deg(GAZE.stickDeg))).toBe('a');
    // Clearly on b: b wins anyway.
    expect(gazePick(O, at(6, 1), t, max, 'a', deg(GAZE.stickDeg))).toBe('b');
    // Stickiness stretches the threshold only for the current pick.
    expect(gazePick(O, { x: 0, y: 0, z: 1 }, [{ key: 'a', pos: at(GAZE.maxAngleDeg + 1) }], max, 'a', deg(GAZE.stickDeg))).toBe('a');
  });

  it('degenerate input picks nobody', () => {
    expect(gazePick(O, O, [{ key: 'a', pos: at(0) }], max)).toBeNull();
    expect(gazePick(O, { x: 0, y: 0, z: 1 }, [{ key: 'a', pos: O }], max)).toBeNull();
    expect(gazePick(O, { x: 0, y: 0, z: 1 }, [], max)).toBeNull();
  });

  it('in the scene: a camera at my head looking at a seat picks that seat, never my own or an empty one', () => {
    // Four seats round a table, facing its middle.
    const seats: Spot[] = [
      { x: -0.8, y: 0.5, z: -0.6, yaw: 0 },
      { x: -0.8, y: 0.5, z: 0.6, yaw: Math.PI },
      { x: 0.8, y: 0.5, z: -0.6, yaw: 0 },
      { x: 0.8, y: 0.5, z: 0.6, yaw: Math.PI },
    ];
    const scene = new THREE.Group();
    const players = new Players(scene, 3, seats);
    scene.updateMatrixWorld(true);
    players.active = 0;
    const camera = new THREE.PerspectiveCamera();
    const gaze = new Gaze(() => ({ camera, players }), null);
    const lookAt = (seat: number) => {
      players.headPos(0, camera.position);
      camera.lookAt(players.headPos(seat, new THREE.Vector3()));
      camera.updateMatrixWorld(true);
    };
    for (const s of [1, 2, 3]) {
      lookAt(s);
      expect(gaze.pick([0, 1, 2, 3])).toBe(s);
    }
    // Only the candidates offered count.
    lookAt(3);
    expect(gaze.pick([1, 2])).toBe(-1);
    players.occupied[3] = false;
    expect(gaze.pick([1, 2, 3])).toBe(-1);
  });
});

describe('gaze: sending my pick', () => {
  it('sends changes only, throttled; a lock goes out at once; a new host gets everything again', () => {
    const p = new PickState();
    const sent: [string | null, boolean][] = [];
    const send = (id: string | null, lock: boolean) => sent.push([id, lock]);
    p.flush('h', send, 0);
    expect(sent).toEqual([]); // no question yet
    p.reset('1|1');
    p.flush('h', send, 0);
    expect(sent).toEqual([[null, false]]);
    p.flush('h', send, 10);
    expect(sent).toHaveLength(1);
    p.id = 'a';
    p.flush('h', send, 20);
    expect(sent).toHaveLength(1); // too soon
    p.flush('h', send, 20 + GAZE.sendMs);
    expect(sent.at(-1)).toEqual(['a', false]);
    p.id = 'b';
    p.locked = true;
    p.flush('h', send, 21 + GAZE.sendMs);
    expect(sent.at(-1)).toEqual(['b', true]);
    const n = sent.length;
    p.flush('h2', send, 22 + GAZE.sendMs);
    expect(sent).toHaveLength(n + 1);
    expect(sent.at(-1)).toEqual(['b', true]);
    // A new question starts over.
    p.reset('1|2');
    expect(p.id).toBeNull();
    expect(p.locked).toBe(false);
  });
});
