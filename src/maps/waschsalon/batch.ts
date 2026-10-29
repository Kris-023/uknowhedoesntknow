import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type Role, tag } from '../../scene/build';

// Static furniture is collected per material and fused into one mesh each: a room full of
// machines, chairs and frames costs a handful of draw calls instead of hundreds.

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();

export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
/** Unit cylinder (radius 1, height 1) along y. */
export const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 14);
/** Disc facing +z, radius 1. */
export const UNIT_DISC = new THREE.CircleGeometry(1, 28);
/** Plane facing +z, 1×1. */
export const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);

export class Batch {
  private parts = new Map<THREE.Material, { role: Role; geos: THREE.BufferGeometry[] }>();

  /** Add `geo` transformed by position, Euler rotation (XYZ) and scale. */
  add(geo: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number], s: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0], role: Role = 'struct'): void {
    tmpQ.setFromEuler(tmpE.set(rot[0], rot[1], rot[2]));
    tmpM.compose(tmpP.set(...p), tmpQ, tmpS.set(...s));
    this.addMatrix(geo, mat, tmpM, role);
  }

  addMatrix(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4, role: Role = 'struct'): void {
    let b = this.parts.get(mat);
    if (!b) this.parts.set(mat, (b = { role, geos: [] }));
    b.geos.push(geo.clone().applyMatrix4(m));
  }

  box(mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, rotY = 0): void {
    this.add(UNIT_BOX, mat, [x, y, z], [w, h, d], [0, rotY, 0]);
  }

  /** Fuse everything into `parent`, one mesh per material. */
  flush(parent: THREE.Object3D, name: string): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, b] of this.parts) {
      const merged = mergeGeometries(b.geos);
      for (const g of b.geos) g.dispose();
      if (!merged) throw new Error(`waschsalon: cannot merge ${name}`);
      const mesh = tag(new THREE.Mesh(merged, mat), b.role);
      mesh.name = `${name}_${out.length}`;
      // Static: the matrix never changes, so skip recomputing it every frame.
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}
