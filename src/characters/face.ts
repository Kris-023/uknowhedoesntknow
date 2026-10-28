import * as THREE from 'three';
import type { FaceShape, Look } from './look';

// Face shapes are a smooth warp of head space, applied to every mesh on the head after it is built
// (skin, hair, beard, eyes). Hair and beard therefore follow any shape without per-shape variants,
// and both head halves stay a seamless fit because the warp keeps the mouth plane flat.

/** Base head ellipsoid in head space. */
export const HEAD_C = { y: 0.19, rx: 0.143, ry: 0.17, rz: 0.155 } as const;
/** Mouth plane: skull above, jaw below. */
export const CUT_Y = 0.095;
const HCUT = (CUT_Y - HEAD_C.y) / HEAD_C.ry;

/**
 * Per shape, in units of the base ellipsoid: sx/sz overall width/depth, up/down vertical scale
 * above/below the mouth plane, jaw width at the chin (front only), cheek fullness, taper (wider
 * forehead, narrower chin), square (jaw corners pushed out near the chin bottom), flat (chin
 * bottom flattened; negative = pointier), crown (top corners pushed up, i.e. a flat top).
 */
interface Shape {
  sx: number;
  sz: number;
  up: number;
  down: number;
  jaw: number;
  cheek: number;
  taper: number;
  square: number;
  flat: number;
  crown: number;
}
const S0: Shape = { sx: 1, sz: 1, up: 1, down: 1, jaw: 1, cheek: 0, taper: 0, square: 0, flat: 0, crown: 0 };

const SHAPES: Record<FaceShape, Shape> = {
  oval: S0,
  rund: { ...S0, sx: 1.08, sz: 1.03, up: 0.95, down: 0.88, jaw: 1.12, cheek: 0.07, flat: 0.12 },
  kantig: { ...S0, sx: 1.04, jaw: 1.16, square: 0.9, flat: 0.24, crown: 0.18 },
  herz: { ...S0, sx: 1.05, up: 1.02, down: 1.15, jaw: 0.78, cheek: 0.05, taper: 0.06, square: -0.25, flat: -0.15 },
  // Jokes.
  gestreckt: { ...S0, sx: 1.5, sz: 1.08, up: 0.8, down: 0.85, jaw: 1.05, flat: 0.15 },
  laenglich: { ...S0, sx: 0.86, sz: 0.96, up: 1.55, down: 1.6, jaw: 0.95 },
  dorito: { ...S0, sx: 1.12, sz: 0.76, up: 1.08, down: 1.35, jaw: 0.62, taper: 0.3, square: -0.2, flat: -0.2, crown: 0.42 },
};

/** Sex on top of the shape: men a wider, squarer jaw with a chin; women narrower chin, fuller cheeks. */
const SEX = {
  male: { jaw: 1.06, cheek: 0, square: 0.35, flat: 0.12, chin: 0.06 },
  female: { jaw: 0.92, cheek: 0.035, square: -0.12, flat: -0.05, chin: 0 },
} as const;

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export type Warp = (p: THREE.Vector3) => THREE.Vector3;

/** The warp for a look: maps a head-space point (in place) and returns it. */
export function faceWarp(L: Pick<Look, 'face' | 'female'>): Warp {
  const F = SHAPES[L.face] ?? S0;
  const X = L.female ? SEX.female : SEX.male;
  const jaw = F.jaw * X.jaw;
  const cheek = F.cheek + X.cheek;
  const square = F.square + X.square;
  const flat = F.flat + X.flat;
  const { y: cy, rx, ry, rz } = HEAD_C;
  return (p) => {
    const ux = p.x / rx;
    const h = (p.y - cy) / ry;
    const uz = p.z / rz;
    // 0 at the mouth plane, 1 at the chin bottom.
    const w = clamp((HCUT - h) / (HCUT + 1), 0, 1);
    // Chin and jaw are a front thing; the back of the head (and long hair hanging there) keeps its shape.
    const front = smooth(-0.7, 0.35, uz);
    // Below the chin (long hair hanging there) the jaw terms fade out, otherwise a square jaw flares
    // the hair ends and a pointed one pinches them.
    const near = smooth(-1.7, -1.0, h);
    const low = smooth(0.1, -0.9, h) * front * near;
    const hc = clamp(h, -1, 1);
    const base = 1 + cheek * Math.exp(-(((h + 0.35) / 0.32) ** 2)) + F.taper * Math.max(0, hc);
    // Jaw terms move the head surface; anything further out (hair beside the jaw) is shifted with
    // the surface instead of scaled, or a square jaw would fling long hair sideways. Never below a
    // sliver: a negative width would fold the chin inside out.
    const lower = Math.max(0.2 - base, (jaw - 1) * low + F.taper * Math.min(0, hc) * front * near + square * w * w * front * near);
    // Half-width of the base head at this height: the surface the jaw terms are defined on.
    const edge = Math.sqrt(Math.max(0, 1 - hc * hc));
    const nx = F.sx * (ux * base + Math.sign(ux) * Math.min(Math.abs(ux), edge) * lower);
    const nz = uz * F.sz + X.chin * low * w;
    let nh: number;
    if (h < HCUT) {
      // Only the face down to the chin stretches; anything below just moves along, so long hair
      // keeps its length on a long face.
      const hf = Math.max(h, -1);
      nh = HCUT + (hf - HCUT) * F.down * (1 - flat * w ** 4 * front * near) + (h - hf);
    } else nh = HCUT + (h - HCUT) * F.up * (1 + F.crown * Math.min(1, ux * ux));
    return p.set(nx * rx, cy + nh * ry, nz * rz);
  };
}

const EPS = 1e-4;
/**
 * Warp every mesh under `root` (skipping `userData.noWarp`) in root space. Geometries are cloned,
 * since the unit primitives are shared. Normals go through the warp's Jacobian, so shading stays
 * smooth across both head halves instead of being recomputed per piece.
 */
export function warpMeshes(root: THREE.Object3D, warp: Warp, space: THREE.Object3D = root): void {
  space.updateMatrixWorld(true);
  const inv = space.matrixWorld.clone().invert();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !o.userData.noWarp) meshes.push(o as THREE.Mesh);
  });
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const J = new THREE.Matrix3();
  const col: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const nm = new THREE.Matrix3();
  const nmi = new THREE.Matrix3();
  for (const m of meshes) {
    const M = inv.clone().multiply(m.matrixWorld);
    const Mi = M.clone().invert();
    nm.getNormalMatrix(M);
    nmi.getNormalMatrix(Mi);
    const g = m.geometry.clone();
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(M);
      for (let k = 0; k < 3; k++) {
        a.copy(p).setComponent(k, p.getComponent(k) + EPS);
        b.copy(p).setComponent(k, p.getComponent(k) - EPS);
        col[k].copy(warp(a)).sub(warp(b)).divideScalar(2 * EPS);
      }
      warp(p).applyMatrix4(Mi);
      pos.setXYZ(i, p.x, p.y, p.z);
      if (nor) {
        J.set(col[0].x, col[1].x, col[2].x, col[0].y, col[1].y, col[2].y, col[0].z, col[1].z, col[2].z).invert().transpose();
        n.fromBufferAttribute(nor, i).applyMatrix3(nm).applyMatrix3(J).applyMatrix3(nmi).normalize();
        nor.setXYZ(i, n.x, n.y, n.z);
      }
    }
    g.computeBoundingSphere();
    g.computeBoundingBox();
    // clone() shares the userData object with the source; give the copy its own.
    g.userData = { owned: true };
    // A geometry made for this figure alone (merged) is replaced here, so free it.
    if (m.geometry.userData.owned) m.geometry.dispose();
    m.geometry = g;
  }
}
