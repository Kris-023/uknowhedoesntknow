import * as THREE from 'three';
import { makeLook } from '../../characters/look';
import { Person } from '../../characters/person';
import { smoothstep } from '../../core/motion';
import { hash01, mulberry32 } from '../../core/rng';
import { at, box, group, std, tag } from '../../scene/build';
import { WS } from './config';
import { coinRoutine } from './schedule';

// The laundromat's bespoke extras: the woman folding one sock forever and the man the coin changer
// keeps robbing. Pure functions of the clock like every NPC; they look up when the machine rages.

const STAND_SCALE = 0.94;

function figure(parent: THREE.Object3D, name: string, seed: number, x: number, z: number, yaw: number, female: boolean): Person {
  const root = group(name, parent);
  root.position.set(x, 0.9 * STAND_SCALE, z);
  root.scale.setScalar(STAND_SCALE);
  root.rotation.y = yaw;
  const look = makeLook(mulberry32(seed));
  look.female = female;
  if (female) {
    look.beard = 'none';
    look.hair = 'dutt';
  } else if (look.hair === 'lang') look.hair = 'kurz';
  const p = new Person(root, look, 'stand');
  p.handSide = null;
  root.traverse((o) => {
    if (o.userData.role === 'player') o.userData.role = 'npc';
  });
  return p;
}

/** Yaw (relative to the body) that turns a head at `from` facing `bodyYaw` towards `to`. */
function yawTowards(from: THREE.Vector3, bodyYaw: number, to: THREE.Vector3): number {
  let a = Math.atan2(to.x - from.x, to.z - from.z) - bodyYaw;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export interface Extras {
  /** `stare` 0..1: how much the imbalance pulls their heads towards `target`. */
  update(t: number, dt: number, stare: number, target: THREE.Vector3): void;
  /** Clock times inside the coin routine (for the sound): coin in, fist on the machine. */
  readonly coinAt: number;
  readonly slapAt: number;
}

export function buildExtras(parent: THREE.Object3D, seed: number): Extras {
  const CO = WS.counter;
  const counterFront = WS.room.left + CO.d + 0.05;
  // --- The sock woman, at the folding counter under the window, facing it. ---
  const sockZ = 1.75;
  const womanPos = new THREE.Vector3(counterFront + 0.28, 0, sockZ);
  const womanYaw = -Math.PI / 2;
  const woman = figure(parent, 'sock_woman', (seed ^ 0x50c4) + 11, womanPos.x, womanPos.z, womanYaw, true);
  const wArms = woman.rig.arms!;
  woman.armOverride = { L: 'hold', R: 'hold' };

  const sockCol = [0xc2362f, 0x2c5fd6, 0xd9a521, 0x2f5d3a, 0xd24c9a][Math.floor(hash01(seed, 3, 9) * 5) % 5];
  const sock = group('sock', parent);
  sock.position.set(counterFront - 0.2, CO.h + 0.012, sockZ);
  const sMat = std(sockCol, { roughness: 0.95, metalness: 0 });
  const foot = tag(box(0.085, 0.018, 0.13, sockCol, 'prop', { roughness: 0.95, metalness: 0 }), 'prop');
  foot.position.set(0, 0, -0.065);
  sock.add(foot);
  sock.add(at(box(0.087, 0.02, 0.04, 0xe8e2d0, 'prop', { roughness: 0.95, metalness: 0 }), 0, 0, -0.12));
  // The leg half folds over the foot half about this hinge.
  const hinge = group('sock_hinge', sock);
  const leg = tag(new THREE.Mesh(foot.geometry, sMat), 'prop');
  leg.scale.set(1, 1, 1.15);
  leg.position.set(0, 0, 0.075);
  hinge.add(leg);

  // --- The coin man, in front of the changer, facing the back wall. ---
  const coinPos = new THREE.Vector3(WS.back.coinX + 0.05, 0, WS.room.back + 0.18 + 0.18 + 0.42);
  const coinYaw = Math.PI;
  const man = figure(parent, 'coin_man', (seed ^ 0xc014) + 5, coinPos.x, coinPos.z, coinYaw, false);
  const mArms = man.rig.arms!;
  const coinT = { coinAt: 1.0, slapAt: 3.45 };

  const tick = (t: number, dt: number, stare: number, target: THREE.Vector3) => {
    // Sock: lift, fold, press, look, unfold, smooth flat. Six seconds, forever.
    const p = (t + hash01(seed, 5, 5) * 6) % 6;
    const fold = smoothstep(1.0, 2.0, p) * (1 - smoothstep(3.7, 4.5, p));
    const lift = smoothstep(0.2, 0.8, p) * (1 - smoothstep(4.6, 5.4, p));
    hinge.rotation.x = -fold * Math.PI * 0.97;
    hinge.position.y = fold * 0.02;
    sock.position.y = CO.h + 0.012 + lift * 0.05;
    sock.rotation.y = 0.15 * Math.sin(t * 0.3);
    const press = smoothstep(2.1, 2.4, p) * (1 - smoothstep(3.0, 3.3, p));
    wArms.L.bob = 0.12 * fold * Math.sin(t * 3) + 0.25 * press;
    wArms.R.bob = -0.12 * fold * Math.sin(t * 3) + 0.25 * press;
    const wLook = yawTowards(womanPos, womanYaw, target);
    // She studies the folded sock, sighs (head tilt) and starts over.
    const sigh = smoothstep(4.4, 4.9, p) * (1 - smoothstep(5.4, 5.9, p));
    woman.update(dt, t, stare * wLook + (1 - stare) * 0.15 * Math.sin(t * 0.4), (1 - stare) * (0.55 - 0.3 * sigh) + stare * 0.05, 3, 0);

    // Coin man: coin in the slot, wait, nothing comes, a fist on the machine, head shaking, pockets.
    const c = coinRoutine(t, seed);
    const ph = c.ph;
    const reach = ph < 1.5;
    const slap = ph > 3.2 && ph < 3.8;
    man.armOverride = { R: reach ? 'phone' : ph > 6 ? 'hold' : 'hang', L: slap ? 'hold' : 'hang' };
    mArms.R.bob = reach ? -0.25 * smoothstep(0.4, 0.9, ph) : 0;
    mArms.L.bob = slap ? -0.5 * Math.sin(((ph - 3.2) / 0.6) * Math.PI) : 0;
    let yaw = 0;
    let pitch = 0.1;
    if (ph >= 1.5 && ph < 3.2) pitch = 0.45;
    else if (ph >= 3.8 && ph < 6) yaw = 0.35 * Math.sin((ph - 3.8) * 9) * (1 - smoothstep(5, 6, ph));
    else if (ph >= 6) {
      pitch = 0.5;
      yaw = 0.1;
    }
    man.lean = slap ? 0.12 : 0;
    const mLook = yawTowards(coinPos, coinYaw, target);
    man.update(dt, t, stare * mLook + (1 - stare) * yaw, (1 - stare) * pitch, 4, 0);
  };
  // Start in pose, not unfolding from a T-pose.
  for (let k = 0; k < 6; k++) tick(1 + k, 0.5, 0, womanPos);

  return {
    ...coinT,
    update: tick,
  };
}
