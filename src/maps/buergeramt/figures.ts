import * as THREE from 'three';
import { makeLook, type Look } from '../../characters/look';
import { Person } from '../../characters/person';
import { smoothstep } from '../../core/motion';
import { mulberry32 } from '../../core/rng';
import { group, std, tag } from '../../scene/build';
import { FORM, OFFICIAL } from './config';
import { officialAt } from './logic';

/** Standing figures are scaled like the world's standing NPCs; the rig's feet are 0.9 below its root. */
const STAND_SCALE = 0.94;

function figure(parent: THREE.Object3D, name: string, look: Look): Person {
  const root = group(name, parent);
  root.scale.setScalar(STAND_SCALE);
  const p = new Person(root, look, 'stand');
  root.traverse((o) => {
    if (o.userData.role === 'player') o.userData.role = 'npc';
  });
  return p;
}

function mug(): THREE.Group {
  const g = new THREE.Group();
  const m = std(0xd9d4c4, { roughness: 0.4, metalness: 0 });
  g.add(tag(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.1, 12), m), 'npc'));
  const handle = tag(new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.008, 6, 10), m), 'npc');
  handle.position.x = 0.045;
  g.add(handle);
  g.position.y = 0.02;
  return g;
}

export interface Extras {
  update(t: number, dt: number): void;
}

/**
 * Two bespoke extras the world's simple NPCs can't do: the official who carries his coffee from
 * door to door without ever going through one, and the citizen on her endless Formular 12.
 */
export function buildExtras(parent: THREE.Object3D, seed: number): Extras {
  const rand = mulberry32((seed ^ 0xb0e2) + 17);
  const official = figure(parent, 'official', {
    ...makeLook(rand),
    build: 'kraeftig',
    top: 0x6b5a45,
    topStyle: 'shirt',
    pants: 0x2b2b30,
    glasses: true,
    short: false,
    footwear: 'hausschuhe',
    shoes: 0x5b4a36,
  });
  const offArms = official.rig.arms!;
  offArms.R.hand.add(mug());
  official.handSide = 'L';
  official.armOverride = { R: 'hold' };

  const filler = figure(parent, 'formfiller', { ...makeLook(mulberry32((seed ^ 0xf012) + 3)), short: false });
  const fillArms = filler.rig.arms!;
  const pen = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.13, 6), std(0x1d3d8a, { roughness: 0.4 })), 'npc');
  pen.rotation.x = 0.9;
  fillArms.R.hand.add(pen);
  filler.handSide = null;
  filler.armOverride = { L: 'hold', R: 'hold' };
  filler.root.position.set(FORM.x, 0.9 * STAND_SCALE, FORM.z);
  filler.root.rotation.y = 0;

  const tick = (t: number, dt: number) => {
    // Official: walk bob and sway (the legs are rigid, the shoulders sell the walking).
    const o = officialAt(t);
    const r = official.root;
    const bob = o.walking ? Math.abs(Math.sin(t * 5.2)) * 0.025 : 0;
    r.position.set(OFFICIAL.x, 0.9 * STAND_SCALE + bob, o.z);
    r.rotation.y = o.yaw;
    r.rotation.z = o.walking ? 0.035 * Math.sin(t * 5.2) : 0;
    official.armOverride.R = o.sip > 0.5 ? 'drink' : 'hold';
    // Looks at the door, then at nothing in particular.
    official.update(dt, t, o.walking ? 0.15 * Math.sin(t * 0.7) : 0, o.sip > 0.5 ? -0.3 : 0.05, 3, 0);

    // Form filler: write, read it back, shake the head, start over.
    const ph = ((t % FORM.cycleS) + FORM.cycleS) % FORM.cycleS;
    const review = smoothstep(FORM.cycleS - 5, FORM.cycleS - 4.3, ph) * (1 - smoothstep(FORM.cycleS - 0.8, FORM.cycleS, ph));
    fillArms.R.bob = review > 0.5 ? 0 : 0.06 * Math.sin(t * 11) * (Math.sin(t * 1.3) > -0.4 ? 1 : 0);
    filler.armOverride.L = review > 0.5 ? 'paper' : 'hold';
    const shake = review > 0.5 && ph > FORM.cycleS - 2.4 ? 0.35 * Math.sin(t * 9) : 0;
    filler.update(dt, t, shake + 0.08 * Math.sin(t * 0.6), review > 0.5 ? 0.15 : 0.62, 4, 0);
  };
  // Start in pose instead of unfolding from the rest pose.
  for (let k = 0; k < 6; k++) tick(1 + k, 0.5);
  return { update: tick };
}
