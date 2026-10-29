import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type Role, tag } from '../../scene/build';

/**
 * Collects static parts and merges them into one mesh per material, so the whole room costs a
 * handful of draw calls. Colours ride along as vertex colours: one material covers every
 * untextured surface of the same finish.
 */
export class Batch {
  private buckets = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; role: Role }>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private c = new THREE.Color();

  add(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    color: number,
    pos: readonly [number, number, number],
    rot: readonly [number, number, number] = [0, 0, 0],
    scale: readonly [number, number, number] = [1, 1, 1],
    role: Role = 'struct',
  ): void {
    this.q.setFromEuler(this.e.set(rot[0], rot[1], rot[2]));
    this.m.compose(new THREE.Vector3(...pos), this.q, new THREE.Vector3(...scale));
    this.addMatrix(geo, mat, color, this.m, role);
  }

  addMatrix(geo: THREE.BufferGeometry, mat: THREE.Material, color: number, m: THREE.Matrix4, role: Role = 'struct'): void {
    const g = geo.clone().applyMatrix4(m);
    if (!g.index) {
      const n = g.getAttribute('position').count;
      g.setIndex(Array.from({ length: n }, (_, i) => i));
    }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    g.morphAttributes = {};
    // Hex colours are sRGB like everywhere else; Color converts them to the linear working space.
    this.c.setHex(color);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([this.c.r, this.c.g, this.c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    let b = this.buckets.get(mat);
    if (!b) this.buckets.set(mat, (b = { geos: [], role }));
    b.geos.push(g);
  }

  flush(parent: THREE.Object3D, name: string): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    let i = 0;
    for (const [mat, b] of this.buckets) {
      const merged = mergeGeometries(b.geos);
      for (const g of b.geos) g.dispose();
      if (!merged) throw new Error(`wg batch ${name}: geometries do not merge`);
      merged.computeBoundingSphere();
      const mesh = tag(new THREE.Mesh(merged, mat), b.role);
      mesh.name = `${name}_${i++}`;
      parent.add(mesh);
      out.push(mesh);
    }
    this.buckets.clear();
    return out;
  }
}

/** Standard material that takes its colour from the vertices (multiplied with `map`, if any). */
export function vcMat(o: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0, ...o });
}
