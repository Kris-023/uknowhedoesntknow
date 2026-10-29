import * as THREE from 'three';
import type { Look } from '../../characters/look';
import { makeLook } from '../../characters/look';
import { Person } from '../../characters/person';
import type { ArmPoseName } from '../../characters/rig';
import { noise1, smoothstep } from '../../core/motion';
import { hash01, mulberry32 } from '../../core/rng';
import { group } from '../../scene/build';
import { COUNTER, FRIDGE, OWNER, ROOM } from './config';
import { collectorAt, freezeAt } from './events';

// The shop's own people. Each pose is a pure function of the clock; during a patrol everybody
// blends towards the pose they had when the blue light arrived and stares straight ahead.

const STAND_SCALE = 0.94;
const STAND_Y = 0.9 * STAND_SCALE;

interface Pose {
  x: number;
  z: number;
  yaw: number;
  headYaw: number;
  pitch: number;
  armL: ArmPoseName;
  armR: ArmPoseName;
  bob: number;
  /** Walking: a little hop and sway. */
  step: number;
  visible: boolean;
}

function standing(parent: THREE.Object3D, name: string, look: Look): Person {
  const root = group(name, parent);
  root.scale.setScalar(STAND_SCALE);
  const p = new Person(root, look, 'stand');
  root.traverse((o) => {
    if (o.userData.role === 'player') o.userData.role = 'npc';
  });
  return p;
}

function apply(p: Person, now: Pose, frozen: Pose | null, k: number, dt: number, t: number): void {
  const root = p.root;
  const f = frozen && k > 0 ? frozen : now;
  const mix = (a: number, b: number) => a + (b - a) * (frozen ? k : 0);
  root.visible = k > 0.5 ? f.visible : now.visible;
  if (!root.visible) return;
  const x = mix(now.x, f.x);
  const z = mix(now.z, f.z);
  const step = now.step * (1 - k);
  root.position.set(x, STAND_Y + 0.014 * Math.abs(Math.sin(t * 6.5)) * step, z);
  root.rotation.y = mix(now.yaw, f.yaw);
  root.rotation.z = 0.035 * Math.sin(t * 3.25) * step;
  const arms = p.rig.arms!;
  arms.R.bob = now.bob * (1 - k);
  const src = k > 0.5 ? f : now;
  p.armOverride = { L: src.armL, R: src.armR };
  // Frozen: eyes front, chin up, nothing to see here.
  const headYaw = mix(now.headYaw, 0);
  const pitch = mix(now.pitch, -0.06);
  p.update(dt, t, headYaw, pitch, k > 0.1 ? 8 : 3, 0);
}

export interface Figures {
  update(t: number, dt: number): void;
}

export function buildFigures(root: THREE.Object3D, seed: number): Figures {
  const C = COUNTER;
  // The owner: same man in every room (he's always there), the others vary with the seed.
  const owner = standing(root, 'owner', {
    female: false,
    build: 'kraeftig',
    skin: 0xc68f63,
    hair: 'kurz',
    hairCol: 0x1a1612,
    top: 0x2a2d33,
    pants: 0x1b2030,
    shoes: 0x1a1a1a,
    hat: 0x1a1a1a,
    glasses: false,
    beard: 'vollbart',
    face: 'rund',
    topStyle: 'trainingsjacke',
    footwear: 'schlappen',
    acc: 0xd9a521,
    short: false,
  });
  owner.equip('kette');
  owner.handSide = null;

  const rc = mulberry32(seed ^ 0x9fa4d);
  const collLook = makeLook(rc);
  collLook.build = 'duenn';
  collLook.female = false;
  collLook.beard = 'stoppeln';
  collLook.top = 0x4a4636;
  collLook.topStyle = 'funktion';
  const collector = standing(root, 'collector', collLook);
  collector.equip('uschanka');
  collector.handSide = 'R';
  collector.equip('pfand');
  collector.equip('gelbersack');

  const browser = standing(root, 'browser', makeLook(mulberry32(seed ^ 0x2b70)));
  browser.handSide = 'R';
  browser.equip('mate');

  const goalSeed = (cycle: number) => hash01(seed, cycle, 404);

  const ownerPose = (t: number): Pose => {
    const cycle = Math.floor(t / OWNER.cycleS);
    const c = t - cycle * OWNER.cycleS;
    const base: Pose = { x: C.ownerX, z: C.ownerZ, yaw: -Math.PI / 2, headYaw: -0.3, pitch: 0.55, armL: 'hold', armR: 'hold', bob: 0, step: 0, visible: true };
    const coll = collectorAt(t, seed);
    if (coll && (coll.atCounter || (coll.c > 11 && coll.c < 28))) {
      // Customer at the counter: face him, take the bottles.
      return { ...base, headYaw: 0.9, pitch: 0.12, armR: coll.atCounter ? 'hold' : 'lap', armL: 'lap' };
    }
    if (c < OWNER.countS) {
      // Counting coins into the tray: quick little dabs of the right hand.
      return { ...base, headYaw: -0.32 + 0.04 * Math.sin(t * 0.7), pitch: 0.55, bob: 0.08 * Math.sin(t * 9) };
    }
    // Football on the phone; some cycles bring a goal and a small fist in the air.
    const goal = goalSeed(cycle) < 0.4 && c > OWNER.countS + 5 && c < OWNER.countS + 6.4;
    return {
      ...base,
      headYaw: goal ? -0.5 : -0.78 + 0.03 * noise1(t * 0.8),
      pitch: goal ? -0.1 : 0.62,
      armL: 'lap',
      armR: goal ? 'drink' : 'lap',
    };
  };

  const fridgeFront = ROOM.left + 0.55;
  const browserPose = (t: number): Pose => {
    // Shuffling along the fridge doors, never deciding.
    const u = t * 0.045 + hash01(seed, 5) * 6;
    const z = FRIDGE.z0 + 0.9 + 1.5 * (0.5 + 0.5 * Math.sin(u));
    const speed = Math.abs(Math.cos(u));
    return {
      x: fridgeFront + 0.55,
      z,
      yaw: -Math.PI / 2,
      headYaw: 0.4 * noise1(t * 0.31 + 3),
      pitch: 0.15 + 0.2 * Math.sin(t * 0.23),
      armL: 'hang',
      armR: 'hold',
      bob: 0,
      step: smoothstep(0.6, 0.9, speed),
      visible: true,
    };
  };

  const collectorPose = (t: number): Pose => {
    const c = collectorAt(t, seed);
    if (!c) return { x: 0, z: 0, yaw: 0, headYaw: 0, pitch: 0, armL: 'hang', armR: 'hang', bob: 0, step: 0, visible: false };
    return {
      x: c.x,
      z: c.z,
      yaw: c.yaw,
      headYaw: c.atCounter ? 0 : 0.2 * Math.sin(t * 0.5),
      pitch: c.atCounter ? 0.15 : 0.25,
      armL: 'hang',
      // Holds a bottle up to the owner while at the counter.
      armR: c.atCounter && c.c % 4 < 2.6 ? 'hold' : 'hang',
      bob: 0,
      step: c.walking ? 1 : 0,
      visible: true,
    };
  };

  const people: [Person, (t: number) => Pose][] = [
    [owner, ownerPose],
    [browser, browserPose],
    [collector, collectorPose],
  ];
  // Start in pose instead of unfolding from the rest pose.
  for (const [p, f] of people) for (let i = 0; i < 6; i++) apply(p, f(0), null, 0, 0.5, i);

  return {
    update(t, dt) {
      const fz = freezeAt(t, seed);
      for (const [p, f] of people) apply(p, f(t), fz.k > 0 ? f(fz.at) : null, fz.k, dt, t);
    },
  };
}
