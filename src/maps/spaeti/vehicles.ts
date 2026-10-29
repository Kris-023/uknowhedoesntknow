import * as THREE from 'three';
import { makeLook } from '../../characters/look';
import { Person } from '../../characters/person';
import { mulberry32 } from '../../core/rng';
import { group, std, tag } from '../../scene/build';
import { Merger } from './merge';

/** A car built facing +x; `lights` are the materials the map flashes (headlights, roof bar). */
export interface Car {
  root: THREE.Group;
  bar: THREE.MeshBasicMaterial[];
  head: THREE.MeshBasicMaterial;
}

function hdr(color: number, k: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color });
  m.color.multiplyScalar(k);
  return m;
}

/** Generic hatchback, or the patrol car: blue lower body, silver top, light bar. No lettering. */
export function buildCar(parent: THREE.Object3D, body: number, police: boolean): Car {
  const root = group(police ? 'patrol' : 'car', parent);
  const M = new Merger();
  const paint = std(body, { roughness: 0.3, metalness: 0.6 });
  const upper = police ? std(0xd8dde3, { roughness: 0.3, metalness: 0.6 }) : paint;
  const glass = std(0x0a0d12, { roughness: 0.08, metalness: 0.8 });
  const tyre = std(0x111111, { roughness: 0.8 });
  M.box(paint, 4.1, 0.45, 1.75, 0, 0.45, 0, 0, 'outside');
  M.box(upper, 4.1, 0.22, 1.76, 0, 0.78, 0, 0, 'outside');
  M.box(glass, 2.1, 0.46, 1.62, -0.2, 1.12, 0, 0, 'outside');
  M.box(upper, 2.0, 0.05, 1.56, -0.25, 1.37, 0, 0, 'outside');
  const wheel = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 14).rotateX(Math.PI / 2);
  for (const x of [-1.3, 1.3]) for (const z of [-0.82, 0.82]) M.add(tyre, wheel, x, 0.32, z, 0, 0, 0, 'outside');
  const head = hdr(0xfff4dd, 4);
  const tail = hdr(0xff1a1a, 1.6);
  for (const z of [-0.62, 0.62]) {
    M.box(head, 0.03, 0.12, 0.3, 2.06, 0.66, z, 0, 'light');
    M.box(tail, 0.03, 0.1, 0.26, -2.06, 0.7, z, 0, 'light');
  }
  const bar: THREE.MeshBasicMaterial[] = [];
  if (police) {
    M.box(std(0x202226, { roughness: 0.5 }), 0.3, 0.06, 1.2, -0.3, 1.42, 0, 0, 'outside');
    for (const z of [-0.33, 0.33]) {
      const m = hdr(0x2a5cff, 5);
      bar.push(m);
      M.box(m, 0.26, 0.11, 0.5, -0.3, 1.5, z, 0, 'light');
    }
  }
  M.build(root);
  root.visible = false;
  return { root, bar, head };
}

/** Delivery cyclist: a seated figure on a bike with a plain insulated box on the back. */
export interface Cyclist {
  root: THREE.Group;
  person: Person;
}

export function buildCyclist(parent: THREE.Object3D, seed: number): Cyclist {
  const root = group('cyclist', parent);
  const M = new Merger();
  const frame = std(0x3a3e44, { roughness: 0.4, metalness: 0.7 });
  const tyre = std(0x0d0d0d, { roughness: 0.8 });
  // Built facing +z like a person; the map turns the whole thing.
  const wheel = new THREE.TorusGeometry(0.34, 0.025, 6, 20).rotateY(Math.PI / 2);
  M.add(tyre, wheel, 0, 0.34, 0.55);
  M.add(tyre, wheel, 0, 0.34, -0.5);
  M.add(frame, new THREE.CylinderGeometry(0.018, 0.018, 0.75), 0, 0.62, 0.05, 0, 1.1, 0);
  M.add(frame, new THREE.CylinderGeometry(0.018, 0.018, 0.6), 0, 0.6, -0.2, 0, -0.3, 0);
  M.add(frame, new THREE.CylinderGeometry(0.016, 0.016, 0.6), 0, 0.68, 0.48, 0, 0.3, 0);
  M.box(frame, 0.5, 0.025, 0.025, 0, 0.98, 0.42);
  M.box(tyre, 0.12, 0.05, 0.24, 0, 0.88, -0.22);
  const box = std(0x2a2c30, { roughness: 0.7 });
  M.box(box, 0.42, 0.42, 0.4, 0, 1.55, -0.52);
  // Reflective strip: catches the street lamp, no logo.
  M.box(std(0xcfd4d8, { roughness: 0.2, metalness: 0.8 }), 0.43, 0.04, 0.41, 0, 1.45, -0.52);
  const front = new THREE.MeshBasicMaterial({ color: 0xffffff });
  front.color.multiplyScalar(3);
  M.box(front, 0.06, 0.04, 0.03, 0, 0.92, 0.6, 0, 'light');
  M.build(root);
  const rider = group('rider', root);
  rider.position.set(0, 0.92, -0.18);
  const person = new Person(rider, makeLook(mulberry32(seed ^ 0xc1c1)), 'sit');
  person.armOverride = { L: 'hold', R: 'hold' };
  person.handSide = null;
  person.lean = 0.25;
  person.settle();
  rider.traverse((o) => {
    if (o.userData.role === 'player') o.userData.role = 'npc';
  });
  tag(root, 'outside');
  root.visible = false;
  return { root, person };
}
