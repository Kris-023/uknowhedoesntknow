import * as THREE from 'three';
import { part } from './parts';

// Shared helpers for accessory builders: cached materials and textures, so twenty passengers with
// the same item share one material and one texture.

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function am(color: number, o: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const k = `${color}|${JSON.stringify(o, (key, v) => (key === 'map' || key === 'bumpMap' ? (v as THREE.Texture | null)?.uuid ?? null : v))}`;
  let m = matCache.get(k);
  if (!m) matCache.set(k, (m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...o })));
  return m;
}

const texCache = new Map<string, THREE.Texture | null>();
/** Texture made once per key; null in plain Node (unit tests), where there is no canvas. */
export function texOnce(k: string, make: () => THREE.Texture): THREE.Texture | null {
  if (!texCache.has(k)) texCache.set(k, typeof document === 'undefined' ? null : make());
  return texCache.get(k)!;
}

export const pp = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx?: number, sy?: number, sz?: number) =>
  part(parent, geo, mat, x, y, z, sx, sy, sz, 'prop');

/** Lighter/darker variant of a colour (k > 1 lightens towards white). */
export function shade(c: number, k: number): number {
  const col = new THREE.Color(c);
  return k >= 1 ? col.lerp(new THREE.Color(0xffffff), Math.min(1, k - 1)).getHex() : col.multiplyScalar(k).getHex();
}
