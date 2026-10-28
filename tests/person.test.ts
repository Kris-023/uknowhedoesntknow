import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeLook } from '../src/characters/look';
import { Person } from '../src/characters/person';
import { HEAD } from '../src/config';
import { mulberry32 } from '../src/core/rng';

const make = () => new Person(new THREE.Group(), makeLook(mulberry32(1)), 'sit');
const run = (p: Person, yaw: number, secs = 6) => {
  for (let t = 0; t < secs; t += 1 / 60) p.update(1 / 60, t, yaw, 0, 6, 0);
};

describe('Person rig', () => {
  it('torso stays put for small head turns', () => {
    const p = make();
    run(p, 0.4);
    expect(p.rig.torso.rotation.y).toBeCloseTo(0, 5);
    expect(p.rig.head.rotation.y).toBeCloseTo(0.4, 2);
  });

  it('torso follows beyond the threshold, head + torso add up to the target', () => {
    const p = make();
    run(p, 1.5);
    const torso = p.rig.torso.rotation.y;
    expect(torso).toBeGreaterThan(0.2);
    expect(torso).toBeLessThanOrEqual(HEAD.torsoMax + 1e-9);
    expect(torso + p.rig.head.rotation.y).toBeCloseTo(1.5, 2);
  });

  it('a hand item pulls the arm into the holding pose and survives a look change', () => {
    const p = make();
    p.equip('huhn');
    run(p, 0, 3);
    expect(p.rig.arms!.R.shoulder.rotation.x).toBeLessThan(-0.6);
    p.setLook(makeLook(mulberry32(2)));
    expect(p.items.hand).toBe('huhn');
    expect(p.rig.anchors.handR.children.length).toBe(1);
  });

  it('skull snaps open while talking and shuts quickly after', () => {
    const p = make();
    for (let i = 0; i < 12; i++) p.update(1 / 60, i / 60, 0, 0, 6, 1);
    expect(p.rig.mouth.rotation.x).toBeLessThan(-0.5);
    for (let i = 0; i < 15; i++) p.update(1 / 60, 1, 0, 0, 6, 0);
    expect(p.rig.mouth.rotation.x).toBeGreaterThan(-0.05);
  });
});
