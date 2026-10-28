import * as THREE from 'three';
import { COACH, COLORS, LIGHTS, SEAT_Z, TRAIN } from '../config';
import { at, basic, box, group, tag } from './build';
import { type CoachTextures, HaltDisplay, tiled } from './textures';

// Static coach geometry. Deliberately no grab poles: they blocked the view across the circle of seats.

export interface Coach {
  root: THREE.Group;
  halt: HaltDisplay;
  /** Dims everything that runs on coach power (frames, screens); 1 = normal, 0 = blackout. */
  setPower(power: number): void;
  /** Materials mutated by setPower; neighbour coaches need their own copies. */
  poweredMaterials: THREE.Material[];
}

export function buildCoach(parent: THREE.Object3D, tex: CoachTextures): Coach {
  const root = group('coach', parent);
  buildShell(root, tex);
  const frameMat = buildCeiling(root, tex);
  const { halt, screenMats } = buildScreens(root, tex);
  buildSeats(root);
  return {
    root,
    halt,
    poweredMaterials: [frameMat, ...screenMats],
    setPower(power) {
      frameMat.opacity = LIGHTS.frameOpacity * power;
      for (const m of screenMats) m.color.setScalar(0.08 + 0.92 * power);
    },
  };
}

function buildShell(coach: THREE.Group, tex: CoachTextures): void {
  const shell = group('shell', coach);
  const L = COACH.length;
  const floor = box(COACH.width, 0.1, L, 0xffffff, 'struct', {
    map: tiled(tex.floor, 3, 11),
    bumpMap: tiled(tex.grain, 6, 22),
    bumpScale: 0.6,
    roughness: 0.38,
    metalness: 0.1,
  });
  shell.add(at(floor, 0, -0.05, 0));
  shell.add(at(box(0.3, 0.006, L - 0.2, 0x34373d), 0, 0.003, 0));

  // Both bulkheads have a door opening; a short gangway at the front links to the next coach.
  // The rear gangway is the front gangway of the neighbour behind (see neighbours.ts).
  for (const e of [-1, 1]) {
    const z = e * 5.35;
    for (const s of [-1, 1]) shell.add(at(box(0.85, COACH.height, 0.1, COLORS.bulkhead), s * 1.075, 1.25, z));
    shell.add(at(box(1.3, 0.5, 0.1, COLORS.bulkhead), 0, 2.25, z));
  }
  const gl = TRAIN.gangwayLength;
  const gz = -5.4 - gl / 2;
  const gangway = group('gangway', shell);
  for (const s of [-1, 1]) gangway.add(at(box(0.05, 2.0, gl, COLORS.gangway, 'struct', { roughness: 0.9 }), s * 0.65, 1.0, gz));
  gangway.add(at(box(1.3, 0.05, gl, 0x1a1c20), 0, 0.0, gz));
  gangway.add(at(box(1.3, 0.05, gl, COLORS.gangway), 0, 2.0, gz));

  // Side walls: low panel, window band with pillars, upper band. The windows themselves are open.
  const wallMat = { map: tiled(tex.wall, 10, 1), roughness: 0.55 };
  for (const s of [-1, 1]) {
    const wx = s * COACH.wallX;
    shell.add(at(box(0.1, 0.95, L, 0xffffff, 'struct', wallMat), wx, 0.475, 0));
    shell.add(at(box(0.1, 0.35, L, COLORS.pale), wx, 2.175, 0));
    for (const z of [-4.5, -2.7, -0.9, 0.9, 2.7, 4.5]) shell.add(at(box(0.1, 1.05, 0.3, COLORS.pale), wx, 1.475, z));
    for (const z of [-4.975, 4.975]) shell.add(at(box(0.1, 1.05, 0.65, COLORS.pale), wx, 1.475, z));
  }
}

function buildCeiling(coach: THREE.Group, tex: CoachTextures): THREE.MeshBasicMaterial {
  const ceil = group('ceiling', coach);
  const L = COACH.length;
  const slope = COACH.ceilingSlope;
  ceil.add(at(box(0.9, 0.05, L, 0x6d747d, 'struct', { roughness: 0.5 }), 0, 2.4, 0));
  const ventMat = new THREE.MeshStandardMaterial({ map: tiled(tex.vent, 1, 6), roughness: 0.6 });
  const ventGeo = new THREE.PlaneGeometry(0.45, 10.2).rotateX(Math.PI / 2);
  for (const s of [-1, 1]) {
    const p = box(1.124, 0.05, L, 0x7a828b, 'struct', { roughness: 0.55 });
    p.rotation.z = -s * slope;
    ceil.add(at(p, s * 0.975, 2.2, 0));
    const v = tag(new THREE.Mesh(ventGeo, ventMat), 'struct');
    v.rotation.z = -s * slope;
    ceil.add(at(v, s * 1.25, 2.07, 0));
  }

  const frames = group('frames', coach);
  const frameGeo = new THREE.PlaneGeometry(0.5, 0.64).rotateX(Math.PI / 2);
  const frameMat = new THREE.MeshBasicMaterial({
    map: tex.frame,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: LIGHTS.frameOpacity,
  });
  for (const s of [-1, 1]) {
    for (const z of [3.4, 1.7, 0, -1.7, -3.4]) {
      const f = tag(new THREE.Mesh(frameGeo, frameMat), 'light');
      f.rotation.z = -s * slope;
      frames.add(at(f, s * 0.85, 2.22, z));
    }
  }
  return frameMat;
}

function buildScreens(coach: THREE.Group, tex: CoachTextures): { halt: HaltDisplay; screenMats: THREE.MeshBasicMaterial[] } {
  const halt = new HaltDisplay();
  const faceGeo = new THREE.PlaneGeometry(0.7, 0.2);
  const lineMat = basic(0xffffff, { map: tex.line });
  const haltMat = basic(0xffffff, { map: halt.texture });
  [3.4, 1.2, -1.0, -3.2].forEach((z, i) => {
    const g = group(`screen_${i + 1}`, coach);
    g.add(at(box(0.8, 0.3, 0.12, 0x14171c), 0, 2.22, z));
    for (const f of [1, -1]) {
      const p = tag(new THREE.Mesh(faceGeo, i === 3 ? haltMat : lineMat), 'light');
      if (f < 0) p.rotation.y = Math.PI;
      g.add(at(p, 0, 2.22, z + f * 0.062));
    }
  });
  return { halt, screenMats: [lineMat, haltMat] };
}

function buildSeats(coach: THREE.Group): void {
  const seatOpts = { roughness: 0.55, metalness: 0.05 };
  let n = 0;
  for (const s of [-1, 1]) {
    for (const z of SEAT_Z) {
      const g = group(`seat_${++n}`, coach);
      g.add(at(box(0.44, 0.05, 0.4, COLORS.seat, 'struct', seatOpts), s * 1.15, 0.5, z));
      const back = box(0.04, 0.42, 0.38, COLORS.seat, 'struct', seatOpts);
      back.rotation.z = -s * 0.1;
      g.add(at(back, s * 1.36, 0.76, z));
      g.add(at(box(0.3, 0.05, 0.05, COLORS.seatFoot), s * 1.25, 0.44, z));
    }
  }
}
