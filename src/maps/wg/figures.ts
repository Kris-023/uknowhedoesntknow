import * as THREE from 'three';
import { buildBottle, buildPhone } from '../../characters/accessories';
import { makeLook } from '../../characters/look';
import { Person } from '../../characters/person';
import { ARMPOSE } from '../../characters/rig';
import { smoothstep } from '../../core/motion';
import { mulberry32 } from '../../core/rng';
import { group, tag } from '../../scene/build';
import { Batch, vcMat } from './batch';
import { COL, KNOCK, ROOM } from './config';
import { catDelay, freezeAt, type Phase } from './events';
import { CYL, SPH } from './room';

// The WG's own people: they freeze when the neighbour knocks, which the generic NPC acts can't do,
// so they are driven here. All of it is a function of the shared clock.

export interface Figures {
  update(t: number, dt: number, k: Phase | null): void;
}

const STAND = 0.94;

function npcRoles(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o.userData.role === 'player') o.userData.role = 'npc';
  });
}

function standing(parent: THREE.Object3D, name: string, seed: number, x: number, z: number, yaw: number): Person {
  const root = group(name, parent);
  root.position.set(x, 0.9 * STAND, z);
  root.scale.setScalar(STAND);
  root.rotation.y = yaw;
  return new Person(root, makeLook(mulberry32(seed)), 'stand');
}

export function buildFigures(parent: THREE.Object3D, seed: number): Figures {
  // Flatmate asleep on the mattress, curled up on his side: the seated rig tipped over.
  const bed = group('wg_sleeper', parent);
  bed.position.set(ROOM.minX + 0.5, 0.35, -2.0);
  bed.rotation.y = Math.PI / 2;
  const sleepRoot = group('sleeper', bed);
  sleepRoot.rotation.z = -Math.PI / 2;
  const sleeper = new Person(sleepRoot, { ...makeLook(mulberry32(seed ^ 0x51ee9)), short: true }, 'sit');
  sleeper.armOverride = { L: 'lap', R: 'lap' };
  sleeper.handSide = null;
  sleeper.settle();
  npcRoles(bed);

  // On the phone in the hallway door, half turned away.
  const caller = standing(parent, 'wg_caller', seed ^ 0xca11, ROOM.maxX - 0.02, ROOM.doorZ[0] + 0.5, -1.25);
  const arms = caller.rig.arms!;
  arms.R.hand.add(buildPhone());
  arms.R.mode = 'fixed';
  arms.R.base = -(ARMPOSE.phone.s + ARMPOSE.phone.e) - 0.3;
  caller.armOverride = { R: 'phone' };
  caller.handSide = 'L';
  npcRoles(caller.root);

  // Party guest with a beer by the record player, looking at the table.
  const guest = standing(parent, 'wg_guest', seed ^ 0xbee2, 1.15, -1.8, -0.6);
  const ga = guest.rig.arms!;
  ga.R.hand.add(buildBottle(false));
  ga.R.mode = 'fixed';
  ga.R.base = -(ARMPOSE.beer.s + ARMPOSE.beer.e);
  guest.armOverride = { R: 'beer' };
  guest.handSide = 'L';
  npcRoles(guest.root);

  const cat = buildCat(parent);

  const tick = (t: number, dt: number, k: Phase | null) => {
    const fz = k ? freezeAt(k.ph) : 0;
    // Asleep: breathing, the occasional twitch; sleeps right through the knocking.
    sleeper.lean += (0.15 - sleeper.lean) * (1 - Math.exp(-dt * 3));
    sleeper.update(dt, t, 0.15, 0.25 + 0.03 * Math.sin(t * 0.45), 3, 0);
    sleeper.rig.torso.scale.setScalar(1 + 0.012 * Math.sin(t * 1.6));

    // Phone: head down, thumb scrolling, every 11 s a look into the room. On the knock: eyes up.
    {
      const ph = t + 3.1;
      const up = ph % 11 > 9.2;
      const pitch = (up ? -0.05 : 0.38 + 0.04 * Math.sin(ph * 0.9)) * (1 - fz) - 0.45 * fz;
      const yaw = (up ? -0.7 : 0.05 * Math.sin(ph * 0.5)) * (1 - fz) + 0.2 * fz;
      arms.R.bob = up || fz > 0.2 ? 0 : 0.04 * Math.sin(ph * 5);
      caller.update(dt, t, yaw, pitch, fz > 0.1 ? 6 : 3, (1 - fz) * Math.max(0, Math.sin(t * 7.3) * Math.sin(t * 2.1)) * 0.5);
      caller.root.rotation.z = 0.02 * Math.sin(t * 0.8) * (1 - fz);
    }
    // Beer: a sip every 9 s, stopped dead (bottle halfway) if the knock comes.
    {
      const ph = t + 5.4;
      const cyc = ph % 9;
      const drink = smoothstep(6, 6.7, cyc) * (1 - smoothstep(7.9, 8.5, cyc)) * (1 - fz);
      guest.armOverride.R = drink > 0.5 ? 'drink' : 'beer';
      const pitch = -0.38 * drink + 0.06 * Math.sin(ph * 0.6) * (1 - fz) - 0.5 * fz;
      const yaw = (1 - drink) * 0.45 * Math.sin(ph * 0.33) * (1 - fz) - 0.3 * fz;
      guest.update(dt, t, yaw, pitch, fz > 0.1 ? 6 : 3, 0);
      // Nodding to the bass through the wall, which stops with the music.
      const beat = Math.max(0, Math.sin(t * Math.PI * 2 * (122 / 60)));
      guest.root.rotation.x = 0.02 * beat * (1 - fz) * (k && k.ph > KNOCK.bassOff && k.ph < KNOCK.bassBack[1] ? 0 : 1);
    }
    cat.update(t, seedFor(t), fz);
  };
  const seedFor = (t: number) => catDelay(t, seed);
  // Start in pose, not unfolding from the T-pose.
  for (let i = 0; i < 6; i++) tick(1 + i, 0.5, null);
  return { update: tick };
}

/**
 * The flat's cat on the window sill: a loaf most of the time, now and then a walk to the other
 * end and back. Ears up and head to the ceiling when it knocks.
 */
function buildCat(parent: THREE.Object3D): { update(t: number, delay: number, fz: number): void } {
  const mat = vcMat({ roughness: 0.95 });
  const root = group('wg_cat', parent);
  const sillY = ROOM.winY0;
  const z = ROOM.minZ - 0.12;
  root.position.set(0, sillY, z);
  const body = group('cat_body', root);
  const b = new Batch();
  b.add(SPH, mat, COL.cat, [0, 0.11, 0], [0, 0, 0], [0.16, 0.075, 0.075]);
  b.add(SPH, mat, 0xd8c0a0, [0.06, 0.085, 0], [0, 0, 0], [0.1, 0.07, 0.07]);
  b.flush(body, 'cat_torso');
  const head = group('cat_head', body);
  head.position.set(0.15, 0.17, 0);
  b.add(SPH, mat, COL.cat, [0, 0, 0], [0, 0, 0], [0.058, 0.052, 0.058]);
  b.add(SPH, mat, 0xd8c0a0, [0.045, -0.015, 0], [0, 0, 0], [0.025, 0.02, 0.025]);
  const ear = new THREE.ConeGeometry(1, 1, 4);
  for (const s of [-1, 1]) b.add(ear, mat, COL.cat, [0.005, 0.055, s * 0.03], [s * 0.2, 0, -0.15], [0.02, 0.045, 0.02]);
  b.flush(head, 'cat_head');
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb8e070).multiplyScalar(2.2) });
  const eyes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.008, 6, 4), eyeMat, 2);
  for (const [i, s] of [-1, 1].entries()) eyes.setMatrixAt(i, new THREE.Matrix4().makeTranslation(0.052, 0.008, s * 0.02));
  head.add(tag(eyes, 'npc'));
  const legs: THREE.Mesh[] = [];
  const legGeo = CYL.clone().translate(0, -0.5, 0);
  for (const [lx, lz] of [
    [0.1, 0.035],
    [0.1, -0.035],
    [-0.1, 0.035],
    [-0.1, -0.035],
  ]) {
    const l = tag(new THREE.Mesh(legGeo, mat), 'npc');
    l.position.set(lx, 0.09, lz);
    l.scale.set(0.014, 0.09, 0.014);
    body.add(l);
    legs.push(l);
  }
  const tail = group('cat_tail', body);
  tail.position.set(-0.15, 0.12, 0);
  const tm = tag(new THREE.Mesh(CYL.clone().translate(0, 0.5, 0), mat), 'npc');
  tm.scale.set(0.012, 0.2, 0.012);
  tail.add(tm);
  body.traverse((o) => {
    if (o.userData.role === 'struct') o.userData.role = 'npc';
  });

  const x0 = ROOM.winX - 0.45;
  const x1 = ROOM.winX + 0.2;
  return {
    update(t, delay, fz) {
      const u = (((t - delay) % 61) + 61) % 61;
      // Routine: loaf at x0, walk, sit at x1, walk back, loaf; identical at both ends of the window.
      let x = x0;
      let walking = 0;
      let dir = 1;
      if (u >= 8 && u < 16) {
        x = x0 + (x1 - x0) * smoothstep(8, 16, u);
        walking = 1;
      } else if (u >= 16 && u < 30) x = x1;
      else if (u >= 30 && u < 38) {
        x = x1 + (x0 - x1) * smoothstep(30, 38, u);
        walking = 1;
        dir = -1;
      }
      const facing = u >= 16 && u < 30 ? -1 : u >= 30 && u < 38 ? -1 : dir;
      const loaf = 1 - walking;
      root.position.x = x;
      root.rotation.y = facing > 0 ? 0 : Math.PI;
      // Walking: legs swing in diagonal pairs and the body bobs; loafing: legs tucked away.
      const step = u * 9;
      legs.forEach((l, i) => {
        l.rotation.z = walking * (fz > 0.5 ? 0.25 : 0.45 * Math.sin(step + (i === 0 || i === 3 ? 0 : Math.PI)));
        l.scale.y = 0.09 * (1 - 0.8 * loaf);
      });
      body.position.y = -0.045 * loaf + walking * 0.006 * Math.abs(Math.sin(step));
      // Head: looks into the room when loafing (towards the players), up at the ceiling on the knock.
      const look = -1.2 * facing * loaf;
      head.rotation.set(0, (look + 0.25 * Math.sin(t * 0.4)) * (1 - fz), (0.08 * Math.sin(t * 0.3)) * (1 - fz) + 0.7 * fz);
      tail.rotation.z = -0.9 + 0.5 * loaf * -1 + (0.25 * Math.sin(t * (walking ? 3 : 0.9))) * (1 - fz) + 0.7 * fz;
      tail.rotation.x = loaf * 0.9;
    },
  };
}
