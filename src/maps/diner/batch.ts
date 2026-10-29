import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { tag, type Role } from '../../scene/build';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const p = new THREE.Vector3();
const s = new THREE.Vector3();
const col = new THREE.Color();

/** Placement of one part; rotation in radians (XYZ order), scale per axis. */
export interface Place {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

/**
 * Collects static parts per material key and fuses them into one mesh each. The colour of a part
 * goes into a vertex attribute, so a whole diner of differently coloured vinyl, Formica and
 * chrome costs a handful of draw calls instead of hundreds.
 */
export class Batch {
  private parts = new Map<string, THREE.BufferGeometry[]>();

  add(key: string, geo: THREE.BufferGeometry, color: number, at: Place = {}): void {
    const g = geo.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    e.set(at.rx ?? 0, at.ry ?? 0, at.rz ?? 0);
    m4.compose(p.set(at.x ?? 0, at.y ?? 0, at.z ?? 0), q.setFromEuler(e), s.set(at.sx ?? 1, at.sy ?? 1, at.sz ?? 1));
    g.applyMatrix4(m4);
    col.setHex(color);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.toArray(c, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    let list = this.parts.get(key);
    if (!list) this.parts.set(key, (list = []));
    list.push(g);
  }

  /** Box by its min/max corners, which is how a room plan is easiest to write down. */
  span(key: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number): void {
    this.add(key, unitBox, color, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, sx: Math.abs(x1 - x0), sy: Math.abs(y1 - y0), sz: Math.abs(z1 - z0) });
  }

  box(key: string, w: number, h: number, d: number, color: number, at: Place = {}): void {
    this.add(key, unitBox, color, { ...at, sx: w * (at.sx ?? 1), sy: h * (at.sy ?? 1), sz: d * (at.sz ?? 1) });
  }

  /** Upright cylinder; `seg` stays low for small props nobody looks at closely. */
  cyl(key: string, rTop: number, rBot: number, h: number, color: number, at: Place = {}, seg = 16): void {
    this.add(key, cylGeo(rTop, rBot, h, seg), color, at);
  }

  /** One mesh per material key; keys without a material are skipped. */
  build(parent: THREE.Object3D, mats: Record<string, THREE.Material>, role: Role = 'struct'): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [key, geos] of this.parts) {
      const mat = mats[key];
      if (!mat) continue;
      const merged = mergeGeometries(geos);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const mesh = tag(new THREE.Mesh(merged, mat), role);
      mesh.name = `diner_${key}`;
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const cylCache = new Map<string, THREE.CylinderGeometry>();
function cylGeo(rTop: number, rBot: number, h: number, seg: number): THREE.CylinderGeometry {
  const k = `${rTop}|${rBot}|${h}|${seg}`;
  let g = cylCache.get(k);
  if (!g) cylCache.set(k, (g = new THREE.CylinderGeometry(rTop, rBot, h, seg)));
  return g;
}
