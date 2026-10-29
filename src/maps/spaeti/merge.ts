import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { tag, type Role } from '../../scene/build';

const tmp = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const one = new THREE.Vector3(1, 1, 1);
const pos = new THREE.Vector3();

/**
 * Collects static parts per material and bakes each set into one mesh: the shop has hundreds of
 * boxes but should cost one draw call per material.
 */
export class Merger {
  private parts = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; role: Role }>();

  add(mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, role: Role = 'struct'): void {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()) as THREE.BufferGeometry;
    // Keep only what every part has, so geometries from different generators merge.
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    q.setFromEuler(e.set(rx, ry, rz));
    g.applyMatrix4(tmp.compose(pos.set(x, y, z), q, one));
    let p = this.parts.get(mat);
    if (!p) this.parts.set(mat, (p = { geos: [], role }));
    p.geos.push(g);
  }

  /** A box of size w×h×d centred at (x, y, z). */
  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, role: Role = 'struct'): void {
    this.add(mat, new THREE.BoxGeometry(w, h, d), x, y, z, ry, 0, 0, role);
  }

  build(parent: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, p] of this.parts) {
      const geo = mergeGeometries(p.geos, false);
      for (const g of p.geos) g.dispose();
      const m = tag(new THREE.Mesh(geo, mat), p.role);
      m.matrixAutoUpdate = false;
      parent.add(m);
      out.push(m);
    }
    this.parts.clear();
    return out;
  }
}

/** Box geometry whose UVs repeat per metre, so one tiled texture fits boxes of any size. */
export function metricBox(w: number, h: number, d: number, perM = 1): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    // Face size along u and v depends on which axis the face looks along.
    const [su, sv] = ax > 0.5 ? [d, h] : ay > 0.5 ? [w, d] : [w, h];
    uv.setXY(i, uv.getX(i) * su * perM, uv.getY(i) * sv * perM);
  }
  return g;
}
