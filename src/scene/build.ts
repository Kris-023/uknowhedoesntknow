import * as THREE from 'three';

/** Render role per mesh. Drives the "Meine Sicht" debug view and later per-role optimisation. */
export type Role = 'struct' | 'light' | 'player' | 'npc' | 'prop' | 'fx' | 'outside';

export function tag<T extends THREE.Object3D>(o: T, role: Role): T {
  o.userData.role = role;
  return o;
}

export function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

export function group(name: string, parent?: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  parent?.add(g);
  return g;
}

// Shared geometry/material caches: identical parts reuse GPU buffers and programs.
const boxCache = new Map<string, THREE.BoxGeometry>();
export function boxGeo(w: number, h: number, d: number): THREE.BoxGeometry {
  const k = `${w}|${h}|${d}`;
  let g = boxCache.get(k);
  if (!g) boxCache.set(k, (g = new THREE.BoxGeometry(w, h, d)));
  return g;
}

type StdOpts = THREE.MeshStandardMaterialParameters;
const stdCache = new Map<string, THREE.MeshStandardMaterial>();
/** Cached standard material. Only plain parameter sets are cached; textured ones get their own. */
export function std(color: number, o: StdOpts = {}): THREE.MeshStandardMaterial {
  const params = { color, roughness: 0.65, metalness: 0.2, ...o };
  const cacheable = !o.map && !o.bumpMap;
  if (!cacheable) return new THREE.MeshStandardMaterial(params);
  const k = JSON.stringify(params);
  let m = stdCache.get(k);
  if (!m) stdCache.set(k, (m = new THREE.MeshStandardMaterial(params)));
  return m;
}

export function basic(color: number, o: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, ...o });
}

export function box(w: number, h: number, d: number, color: number, role: Role = 'struct', o?: StdOpts): THREE.Mesh {
  return tag(new THREE.Mesh(boxGeo(w, h, d), std(color, o)), role);
}

export function glowBox(w: number, h: number, d: number, color: number): THREE.Mesh {
  return tag(new THREE.Mesh(boxGeo(w, h, d), basic(color)), 'light');
}
