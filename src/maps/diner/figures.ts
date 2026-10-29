import * as THREE from 'three';
import type { Look } from '../../characters/look';
import { Person } from '../../characters/person';
import { ARMPOSE } from '../../characters/rig';
import { smoothstep } from '../../core/motion';
import { group, std } from '../../scene/build';
import { cookPose, flareShape, waitressPose, type Flare } from './events';

/** Standing figures are scaled like the world's standing NPCs; feet end 0.9 below the root. */
const STAND_SCALE = 0.94;
const STAND_Y = 0.9 * STAND_SCALE;

const WAITRESS_LOOK: Look = {
  female: true,
  build: 'normal',
  skin: 0xc68f63,
  hair: 'dutt',
  hairCol: 0x5a3a1e,
  top: 0x7fc8b8,
  pants: 0x20263a,
  shoes: 0xf1f1f1,
  hat: 0xd9d4c4,
  glasses: false,
  beard: 'none',
  face: 'herz',
  topStyle: 'shirt',
  footwear: 'sneaker',
  acc: 0xe8e2d0,
  short: true,
};

const COOK_LOOK: Look = {
  female: false,
  build: 'kraeftig',
  skin: 0xe6b894,
  hair: 'muetze',
  hairCol: 0x2b2118,
  top: 0xe8e4da,
  pants: 0x2b2b30,
  shoes: 0x1a1a1a,
  hat: 0xf2f2f2,
  glasses: false,
  beard: 'stoppeln',
  face: 'kantig',
  topStyle: 'shirt',
  footwear: 'sneaker',
  acc: 0xe8e2d0,
  short: true,
};

function standing(parent: THREE.Object3D, name: string, look: Look): Person {
  const root = group(name, parent);
  root.scale.setScalar(STAND_SCALE);
  root.position.y = STAND_Y;
  const p = new Person(root, look, 'stand');
  root.traverse((o) => {
    if (o.userData.role === 'player') o.userData.role = 'npc';
  });
  return p;
}

/** Apron over the front of the torso, so the uniform reads at a glance. */
function apron(p: Person, color: number): void {
  const fit = p.rig.fit;
  const m = new THREE.Mesh(new THREE.BoxGeometry(fit.belly.x * 1.7, 0.34, 0.012), std(color, { roughness: 0.9, metalness: 0 }));
  m.position.set(0, fit.belly.y - 0.05, fit.belly.zf + 0.012);
  m.userData.role = 'npc';
  p.rig.torso.add(m);
}

/** Glass coffee pot: dark coffee, black lid and handle. */
function coffeePot(): THREE.Group {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), std(0x2a160c, { roughness: 0.15, metalness: 0.1 }));
  glass.scale.set(1, 0.85, 1);
  glass.position.y = -0.1;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.06, 12), std(0x111111, { roughness: 0.4 }));
  lid.position.y = -0.02;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.03), std(0x111111, { roughness: 0.4 }));
  handle.position.set(0, -0.06, -0.07);
  g.add(glass, lid, handle);
  g.traverse((o) => (o.userData.role = 'npc'));
  // Held in front of the knuckles, spout towards the counter.
  g.position.set(0, 0, 0.07);
  return g;
}

/** Waitress behind the counter: fetches coffee, refills the trucker, wipes, stares into the night. */
export class Waitress {
  readonly person: Person;
  private pot: THREE.Group;

  constructor(parent: THREE.Object3D) {
    this.person = standing(parent, 'diner_waitress', WAITRESS_LOOK);
    apron(this.person, 0xf2efe6);
    this.pot = coffeePot();
    this.person.rig.arms!.R.hand.add(this.pot);
    this.person.handSide = null;
    this.person.settle();
  }

  /** Whether the pot is in her hand (the machine shows its own pot otherwise). */
  get hasPot(): boolean {
    return this.pot.visible;
  }

  update(t: number, dt: number, seed: number): void {
    const w = waitressPose(t, seed);
    const p = this.person;
    const root = p.root;
    const arms = p.rig.arms!;
    const walking = w.act === 'walk';
    root.position.set(1.95, STAND_Y + (walking ? 0.012 * Math.abs(Math.sin(w.ph * 6)) : 0), w.z);
    root.rotation.y = w.yaw;
    root.rotation.z = walking ? 0.025 * Math.sin(w.ph * 6) : 0;
    this.pot.visible = w.hasPot;
    let yaw = 0;
    let pitch = 0.1;
    arms.R.mode = 'free';
    arms.L.bob = 0;
    p.armOverride = { R: w.hasPot ? 'hold' : 'hang', L: 'hang' };
    if (w.act === 'fetch') {
      // Back to the room at the machine, head down.
      pitch = 0.45;
      p.armOverride = { R: w.hasPot ? 'hold' : 'lap', L: 'lap' };
    } else if (w.act === 'pour') {
      // Reaches across the counter and tips the pot over the trucker's mug.
      const tip = smoothstep(1.0, 1.8, w.ph) * (1 - smoothstep(4.6, 5.4, w.ph));
      p.armOverride = { R: 'beer', L: 'hang' };
      arms.R.mode = 'fixed';
      arms.R.base = -(ARMPOSE.beer.s + ARMPOSE.beer.e) - 0.9 * tip;
      pitch = 0.4;
      yaw = 0.1;
    } else if (w.act === 'wipe') {
      // Circles with the rag, glancing over at the booth now and then.
      p.armOverride = { R: 'hold', L: 'lap' };
      arms.L.bob = 0.12 * Math.sin(w.ph * 5);
      const look = w.ph % 4.5 > 2.6;
      yaw = look ? 0.55 : 0.05 * Math.sin(w.ph);
      pitch = look ? 0.05 : 0.42;
    } else if (w.act === 'idle') {
      // Gazes out of the windows; a yawn tips the head back.
      yaw = 0.3 * Math.sin(w.ph * 0.4);
      pitch = w.ph > 3 && w.ph < 4.2 ? -0.3 : 0.02;
    }
    p.update(dt, t, yaw, pitch, 4, w.act === 'idle' && w.ph > 3 && w.ph < 4.2 ? 0.8 : 0);
  }
}

/** The cook: grill, fryer, a grumpy glare through the hatch, the bell. Jumps back when the fryer flares. */
export class Cook {
  readonly person: Person;

  constructor(parent: THREE.Object3D) {
    this.person = standing(parent, 'diner_cook', COOK_LOOK);
    apron(this.person, 0xd9d4c4);
    this.person.handSide = null;
    this.person.settle();
  }

  update(t: number, dt: number, flare: Flare | null): void {
    const c = cookPose(t);
    const p = this.person;
    const root = p.root;
    const arms = p.rig.arms!;
    // Facing the stove (+x) while cooking, the hatch (-x) for the glare and the bell.
    const toHatch = c.act === 'glare' || c.act === 'bell';
    let face = toHatch ? -Math.PI / 2 : Math.PI / 2;
    let yaw = 0;
    let pitch = 0.4;
    arms.R.bob = 0;
    arms.L.bob = 0;
    p.armOverride = { R: 'lap', L: 'lap' };
    if (c.act === 'grill') {
      arms.R.bob = 0.15 * Math.max(0, Math.sin(c.ph * 3.1));
      yaw = 0.1 * Math.sin(c.ph * 0.7);
    } else if (c.act === 'glare') {
      // Stares at the booth, unimpressed.
      yaw = 0.35;
      pitch = 0.02;
      p.armOverride = { R: 'hang', L: 'hang' };
    } else if (c.act === 'fryer') {
      // Shakes the basket.
      arms.R.bob = 0.08 * Math.sin(c.ph * 14);
      yaw = 0.25;
    } else {
      // Plate onto the sill, then a flat hand on the bell.
      const slap = c.ph > 0.6 && c.ph < 1.35;
      p.armOverride = { R: slap ? 'beer' : 'hold', L: 'hang' };
      pitch = 0.3;
    }
    let x = 3.85;
    let z = c.z;
    if (flare) {
      const f = flareShape(flare.ph);
      // Away from the fryer (at -z, +x), arms up, staring at the flames.
      x -= 0.3 * f.jump;
      z += 0.45 * f.jump;
      if (f.jump > 0.3) {
        face = Math.PI / 2;
        p.armOverride = { R: 'phone', L: 'phone' };
        yaw = 0.7;
        pitch = 0.1;
      }
    }
    root.position.set(x, STAND_Y + (flare ? 0.06 * smoothstep(0.08, 0.2, flare.ph) * (1 - smoothstep(0.2, 0.45, flare.ph)) : 0), z);
    // Turn smoothly instead of snapping between stove and hatch.
    let d = face - root.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    root.rotation.y += d * (1 - Math.exp(-dt * (flare ? 14 : 5)));
    p.update(dt, t, yaw, pitch, flare ? 10 : 4, 0);
  }
}
