import * as THREE from 'three';
import { buildBottle, buildNewspaper, buildPhone, ITEM_IDS, ITEMS } from '../characters/accessories';
import { makeLook } from '../characters/look';
import { Person } from '../characters/person';
import { ARMPOSE } from '../characters/rig';
import { NPC_DEFS, SEAT_X } from '../config';
import { smoothstep } from '../core/motion';
import { mulberry32 } from '../core/rng';
import { group } from '../scene/build';

type Act = (typeof NPC_DEFS)[number]['act'];

interface Npc {
  person: Person;
  act: Act;
  /** Phase offset, so the ten don't move in lockstep. */
  off: number;
  paper: THREE.Group | null;
  standing: boolean;
  baseYaw: number;
}

const STAND_SCALE = 0.94;

/**
 * The ten passengers. Who looks how and carries what comes from the lobby seed, what they do from
 * the shared clock, so every client sees the same coach without a single network message.
 */
export class Npcs {
  private npcs: Npc[] = [];

  constructor(parent: THREE.Object3D, seed: number) {
    NPC_DEFS.forEach((d, i) => {
      const rand = mulberry32((seed ^ 0x4e5043) + i * 7919);
      const root = group(`npc_${i + 1}`, parent);
      let standing = false;
      let baseYaw = 0;
      if ('seat' in d) {
        root.position.set(d.seat.side * SEAT_X, 0.525, d.seat.z);
        baseYaw = d.seat.side === -1 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        standing = true;
        // Feet on the floor: the standing rig reaches 0.9 below its root.
        root.position.set(d.stand.x, 0.9 * STAND_SCALE, d.stand.z);
        root.scale.setScalar(STAND_SCALE);
        baseYaw = d.stand.yaw;
      }
      root.rotation.y = baseYaw;
      const person = new Person(root, makeLook(rand), standing ? 'stand' : 'sit');
      const arms = person.rig.arms!;
      let paper: THREE.Group | null = null;
      if (d.act === 'phone') {
        arms.R.hand.add(buildPhone());
        arms.R.mode = 'fixed';
        // Screen tilted towards the face.
        arms.R.base = -(ARMPOSE.phone.s + ARMPOSE.phone.e) - 0.3;
        person.armOverride = { R: 'phone' };
        person.handSide = 'L';
      } else if (d.act === 'beer') {
        arms.R.hand.add(buildBottle('can' in d && d.can));
        // Fixed to the hand, so the bottle tips towards the mouth when drinking.
        arms.R.mode = 'fixed';
        arms.R.base = -(ARMPOSE.beer.s + ARMPOSE.beer.e);
        person.armOverride = { R: 'beer' };
        person.handSide = 'L';
      } else if (d.act === 'paper') {
        paper = buildNewspaper();
        person.rig.torso.add(paper);
        person.armOverride = { L: 'paper', R: 'paper' };
        person.handSide = null;
      } else {
        person.armOverride = { L: 'lap', R: 'lap' };
      }
      // Random accessories from the seed; hand items only for a free hand.
      for (const slot of ['head', 'hand', 'arm', 'hip'] as const) {
        if (rand() > (slot === 'hip' ? 0.2 : 0.4)) continue;
        if (slot === 'hand' && !person.handSide) continue;
        const ids = ITEM_IDS.filter((id) => ITEMS[id].slot === slot);
        person.equip(ids[Math.floor(rand() * ids.length) % ids.length]);
      }
      root.traverse((o) => {
        if (o.userData.role === 'player') o.userData.role = 'npc';
      });
      const npc = { person, act: d.act, off: i * 2.7 + 0.9, paper, standing, baseYaw };
      this.npcs.push(npc);
      // Start in pose, not unfolding from T-pose on the first frames.
      for (let k = 0; k < 6; k++) this.tick(npc, 1 + k, 0.5, 0);
    });
  }

  /** `shakeAmp` in metres, so the standing ones sway with the coach. */
  update(t: number, dt: number, shakeAmp: number): void {
    for (const n of this.npcs) this.tick(n, t, dt, shakeAmp);
  }

  private tick(n: Npc, t: number, dt: number, amp: number): void {
    const ph = t + n.off;
    const p = n.person;
    const arms = p.rig.arms!;
    let yaw = 0;
    let pitch = 0;
    let lean = 0;
    if (n.act === 'phone') {
      // Head down, thumb scrolling; every 9 s a short look up and to the side.
      const up = ph % 9 > 7.4;
      pitch = up ? -0.02 : 0.34 + 0.04 * Math.sin(ph * 0.9);
      yaw = up ? 0.9 * Math.sin(Math.floor(ph / 9) * 12.9898 + n.off) : 0.05 * Math.sin(ph * 0.5);
      arms.R.bob = up ? 0 : 0.04 * Math.sin(ph * 5);
    } else if (n.act === 'paper') {
      // Reading, the paper trembles with the coach; turning the page every 13 s.
      pitch = 0.1 + 0.03 * Math.sin(ph * 0.7);
      yaw = 0.04 * Math.sin(ph * 0.4);
      const pc = ph % 13;
      if (n.paper) {
        n.paper.rotation.z = 0.012 * Math.sin(ph * 1.7) + amp * 3 * Math.sin(ph * 31);
        n.paper.rotation.y = pc < 0.5 ? Math.sin((pc / 0.5) * Math.PI) * 0.5 : 0;
      }
    } else if (n.act === 'beer') {
      // A sip every 8 s: arm up, head back.
      const cyc = ph % 8;
      const drink = smoothstep(5.2, 5.9, cyc) * (1 - smoothstep(7.1, 7.7, cyc));
      p.armOverride.R = drink > 0.5 ? 'drink' : 'beer';
      pitch = -0.38 * drink + 0.04 * Math.sin(ph * 0.6);
      yaw = (1 - drink) * 0.5 * Math.sin(ph * 0.35);
    } else {
      // Asleep: head forward, upper body slumped, nodding slowly.
      pitch = 0.55 + 0.04 * Math.sin(ph * 0.5);
      lean = 0.28;
      yaw = 0.35;
    }
    p.lean += (lean - p.lean) * (1 - Math.exp(-dt * 4));
    p.update(dt, t, yaw, pitch, 3, 0);
    if (n.standing) {
      const root = p.root;
      root.rotation.z = 0.03 * Math.sin(ph * 0.9) + amp * 5 * Math.sin(t * 17 + n.off);
      root.rotation.x = 0.02 * Math.sin(ph * 0.7 + 1);
    }
  }
}
