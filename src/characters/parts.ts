import * as THREE from 'three';
import { tag, type Role } from '../scene/build';

// Unit primitives shared by every character: each body part is one of these, scaled. Sharing the
// geometry keeps GPU memory flat no matter how many people sit in the coach.
export const UCYL = new THREE.CylinderGeometry(0.85, 1, 1, 10).translate(0, 0.5, 0);
export const USPH = new THREE.SphereGeometry(1, 14, 10);
export const UBOX = new THREE.BoxGeometry(1, 1, 1);

const UP = new THREE.Vector3(0, 1, 0);
export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const matCache = new Map<string, THREE.MeshStandardMaterial>();
/** Cached matte material for skin, cloth and hair. `double` for open shapes like the lathe torso and caps. */
export function cm(color: number, rough = 0.8, double = false): THREE.MeshStandardMaterial {
  const k = `${color}_${rough}_${double}`;
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.02, side: double ? THREE.DoubleSide : THREE.FrontSide });
    matCache.set(k, m);
  }
  return m;
}

export function part(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  sx?: number,
  sy?: number,
  sz?: number,
  role: Role = 'player',
): THREE.Mesh {
  const m = tag(new THREE.Mesh(geo, mat), role);
  m.position.set(x, y, z);
  if (sx !== undefined) m.scale.set(sx, sy!, sz!);
  parent.add(m);
  return m;
}

/** Tapered cylinder from a to b with radius r (a limb segment). */
export function bone(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const d = b.clone().sub(a);
  const m = tag(new THREE.Mesh(UCYL, mat), 'player');
  m.scale.set(r, d.length(), r);
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  parent.add(m);
  return m;
}

export function darken(c: number, k: number): number {
  return new THREE.Color(c).multiplyScalar(k).getHex();
}
