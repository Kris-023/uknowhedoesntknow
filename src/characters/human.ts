import * as THREE from 'three';
import { group } from '../scene/build';
import { canvasTex } from '../scene/textures';
import type { Look } from './look';
import { bone, cm, darken, HCAP, part, UBOX, UCYL, USPH, V } from './parts';
import { ARMPOSE, type Arm, type ArmSide, type Rig } from './rig';

// Style "Mensch": realistic-stylised proportions after the Quaternius Universal Base Characters (CC0).
// The face stays deliberately calm: small dark eyes, no whites, the mouth is a thin dark line.

const torsoCache = new Map<boolean, THREE.LatheGeometry>();
function torsoGeo(female: boolean): THREE.LatheGeometry {
  let g = torsoCache.get(female);
  if (!g) {
    const P = female
      ? [[0.17, 0.06], [0.2, 0.1], [0.158, 0.26], [0.168, 0.4], [0.188, 0.5], [0.12, 0.57], [0.058, 0.605], [0.001, 0.615]]
      : [[0.18, 0.06], [0.188, 0.1], [0.168, 0.26], [0.2, 0.42], [0.218, 0.5], [0.126, 0.572], [0.062, 0.605], [0.001, 0.615]];
    g = new THREE.LatheGeometry(P.map(([r, y]) => new THREE.Vector2(r, y)), 16);
    g.scale(1, 1, 0.62);
    torsoCache.set(female, g);
  }
  return g;
}

const beanieRing = new THREE.TorusGeometry(0.148, 0.022, 6, 16);
const glassRing = new THREE.TorusGeometry(0.036, 0.006, 5, 12);
const mouthGeo = new THREE.BoxGeometry(0.05, 0.006, 0.006);

// The head is split at mouth height into skull and jaw, so talking can flip the skull open like a lid
// (R.E.P.O.-style). Both halves come from the same unit sphere, so when closed the normals line up
// and the head still reads as one seamless ellipsoid.
const HEAD_C = { y: 0.19, rx: 0.143, ry: 0.17, rz: 0.155 };
const CUT_Y = 0.095;
const CUT_THETA = Math.acos((CUT_Y - HEAD_C.y) / HEAD_C.ry);
const CUT_R = Math.sin(CUT_THETA);
/** Hinge at the back of the head on the cut plane. */
const HINGE_Z = -HEAD_C.rz * CUT_R;
const headTop = new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, CUT_THETA);
const headBottom = new THREE.SphereGeometry(1, 14, 4, 0, Math.PI * 2, CUT_THETA, Math.PI - CUT_THETA);
// Mouth cavity: inverted half-ellipsoids under the jaw cut and above the skull cut. Seen through the
// opening they give the mouth depth instead of a flat lid; BackSide keeps them invisible from outside.
const bowlGeo = new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
const domeGeo = new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
const CAVITY = 0x2a1512;
// The tongue is only a decal lying in the black jaw bowl: reads as a mouth without a 3D shape.
const tongueGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
let tongueMat: THREE.MeshStandardMaterial | null = null;
function tongue(): THREE.MeshStandardMaterial {
  if (!tongueMat) {
    // Unit tests build rigs in plain Node without a canvas; they don't need the decal.
    const map = typeof document === 'undefined' ? null : canvasTex(64, 64, (x, w, h) => {
      // Muted rose, not a red area: the face rule asks for calm faces.
      x.fillStyle = '#8e4b52';
      x.beginPath();
      x.ellipse(w / 2, h * 0.58, w * 0.36, h * 0.4, 0, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = 'rgba(40,10,14,.55)';
      x.lineWidth = 3;
      x.beginPath();
      x.moveTo(w / 2, h * 0.3);
      x.lineTo(w / 2, h * 0.8);
      x.stroke();
    });
    // A little self-light so it still reads deep in the mouth at night; stays below the bloom threshold.
    tongueMat = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0x666666, roughness: 0.8, metalness: 0, alphaTest: 0.5 });
  }
  return tongueMat;
}

const cutCache = new Map<number, THREE.SphereGeometry>();
/**
 * Unit sphere cut flat at the mouth plane, for skull parts (back hair) whose ellipsoid centre is at
 * `cy` with vertical radius `ry`. Without the cut their lower half would hang into the open mouth.
 */
function cutSphere(cy: number, ry: number): { geo: THREE.SphereGeometry; r: number } {
  const theta = Math.acos(Math.max(-1, Math.min(1, (CUT_Y - cy) / ry)));
  const k = Math.round(theta * 1000);
  let geo = cutCache.get(k);
  if (!geo) cutCache.set(k, (geo = new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, theta)));
  return { geo, r: Math.sin(theta) };
}

/** Styles with a back-of-head hair volume reaching down to the mouth plane. */
const hasBackHair = (L: Look) => L.hair !== 'muetze' && L.hair !== 'irokese';

/** Hair on the skull `S` (flips open with the mouth); long strands hang from the jaw side `H`. */
function addHair(S: THREE.Group, H: THREE.Group, L: Look): void {
  const hm = cm(L.hairCol, 0.75, true);
  if (L.hair === 'muetze') {
    part(S, HCAP, cm(L.hat, 0.9, true), 0, 0.2, -0.005, 0.158, 0.182, 0.168);
    const ring = part(S, beanieRing, cm(L.hat, 0.9), 0, 0.275, -0.005);
    ring.rotation.x = Math.PI / 2;
    part(S, USPH, cm(L.hat, 0.9), 0, 0.39, 0, 0.032, 0.032, 0.032);
    return;
  }
  if (L.hair === 'irokese') {
    part(S, HCAP, cm(darken(L.hairCol, 0.35), 0.9, true), 0, 0.2, -0.005, 0.15, 0.172, 0.16);
    for (let k = 0; k < 6; k++) {
      const y = 0.385 - (k > 3 ? (k - 3) * 0.035 : 0) - (k === 0 ? 0.02 : 0);
      part(S, UBOX, hm, 0, y, 0.1 - k * 0.045, 0.028, 0.1, 0.05);
    }
    return;
  }
  part(S, HCAP, hm, 0, 0.2, -0.005, 0.152, 0.176, 0.162);
  // Back of the head, cut at the mouth plane. Single-sided, so from inside the open mouth its
  // underside never shows the hair colour; the skull's cavity dome covers that view instead.
  part(S, cutSphere(0.18, 0.15).geo, cm(L.hairCol, 0.75), 0, 0.18, -0.042, 0.15, 0.15, 0.14);
  if (L.hair === 'lang') {
    part(H, USPH, hm, 0, 0.02, -0.075, 0.15, 0.27, 0.085);
    for (const sx of [-1, 1]) part(H, USPH, hm, sx * 0.14, 0.09, -0.02, 0.035, 0.17, 0.06);
  } else if (L.hair === 'dutt') {
    part(S, USPH, hm, 0, 0.37, -0.075, 0.07, 0.07, 0.07);
  } else if (L.hair === 'locken') {
    for (let c = 0; c < 9; c++) {
      const a = c * 2.4;
      const pol = 0.35 + (c % 3) * 0.3;
      const dx = Math.sin(pol) * Math.cos(a);
      const dz = Math.sin(pol) * Math.sin(a);
      const dy = Math.cos(pol);
      // Skip curls that would hang over the forehead.
      if (dz > 0.5 && pol > 0.8) continue;
      part(S, USPH, hm, dx * 0.15, 0.2 + dy * 0.17, dz * 0.15 - 0.01, 0.055, 0.055, 0.055);
    }
  }
}

export type BodyPose = 'sit' | 'stand';

export function rigHuman(root: THREE.Object3D, L: Look, pose: BodyPose): Rig {
  const sit = pose === 'sit';
  const f = L.female;
  const T = group('torso', root);
  const H = group('head', T);
  H.position.set(0, 0.62, 0);

  const skin = cm(darken(L.skin, 0.8), 0.65);
  const top = cm(L.top, 0.85);
  const pants = cm(L.pants, 0.9);
  const shoe = cm(L.shoes, 0.55);
  const dark = cm(0x0b0d12, 0.4);

  // Trunk, pelvis, neck.
  part(T, torsoGeo(f), cm(L.top, 0.85, true), 0, 0, 0);
  part(T, USPH, pants, 0, 0.03, 0, f ? 0.2 : 0.185, 0.12, 0.14);
  // Neck ends inside the head but below the jaw bowl, otherwise it pokes into the open mouth.
  part(H, UCYL, skin, 0, -0.03, 0, 0.052, 0.06, 0.052);

  // Jaw (stays) and skull (hinged at the back, opens with the voice). `S` is the skull in head
  // coordinates, so everything above the mouth line keeps its usual position.
  const skull = group('skull', H);
  skull.position.set(0, CUT_Y, HINGE_Z);
  const S = group('skull_space', skull);
  S.position.set(0, -CUT_Y, -HINGE_Z);
  const cavity = new THREE.MeshStandardMaterial({ color: CAVITY, roughness: 0.95, metalness: 0, side: THREE.BackSide });
  const { y: hy, rx, ry, rz } = HEAD_C;
  const crx = rx * CUT_R;
  const crz = rz * CUT_R;
  part(H, headBottom, skin, 0, hy, 0, rx, ry, rz);
  part(S, headTop, skin, 0, hy, 0, rx, ry, rz);
  // Jaw bowl pure black, so the mouth reads as a dark hole and only the tongue decal shows in it.
  part(H, bowlGeo, new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }), 0, CUT_Y, 0, crx, 0.06, crz);
  part(H, tongueGeo, tongue(), 0, CUT_Y - 0.03, 0.02, crx * 1.1, 1, crz * 1.1);
  // Palate: a shallow dome just below the cut, so it hides the back hair's underside (which reaches
  // further back than the head and into any deeper dome). The jaw bowl provides the depth.
  const domeBack = hasBackHair(L) ? 0.042 + 0.14 * cutSphere(0.18, 0.15).r : crz;
  const domeRz = (crz + domeBack) / 2;
  part(S, domeGeo, cavity, 0, CUT_Y - 0.004, crz - domeRz, crx, 0.014, domeRz);
  part(S, USPH, skin, 0, 0.175, 0.15, 0.022, 0.028, 0.026);
  for (const sx of [-1, 1]) part(S, USPH, cm(0x2a2220, 0.5), sx * 0.052, 0.212, 0.142, 0.012, 0.014, 0.008);
  // Closed mouth: a thin dark line.
  part(H, mouthGeo, cm(0x3a1a18, 0.7), 0, CUT_Y, 0.133);
  if (L.beard && !f) part(H, USPH, cm(L.hairCol, 0.8), 0, 0.07, 0.02, 0.108, 0.07, 0.11);
  if (L.glasses) {
    for (const sx of [-1, 1]) part(S, glassRing, dark, sx * 0.058, 0.215, 0.158);
    part(S, UBOX, dark, 0, 0.222, 0.16, 0.03, 0.006, 0.006);
  }
  addHair(S, H, L);

  // Arms: shoulder -> elbow -> hand, each its own joint group.
  const arms = {} as Record<ArmSide, Arm>;
  for (const n of ['L', 'R'] as const) {
    const sd = n === 'L' ? 1 : -1;
    const sh = group(`arm_${n}`, T);
    sh.position.set(sd * (f ? 0.205 : 0.225), 0.5, 0);
    part(sh, USPH, top, 0, 0, 0, 0.06, 0.06, 0.06);
    bone(sh, V(0, 0, 0), V(0, -0.28, 0), 0.05, top);
    const el = group('forearm', sh);
    el.position.set(0, -0.28, 0);
    part(el, USPH, top, 0, 0, 0, 0.046, 0.046, 0.046);
    bone(el, V(0, 0, 0), V(0, -0.26, 0), 0.042, L.short ? skin : top);
    part(el, USPH, skin, 0, -0.29, 0, 0.04, 0.045, 0.035);
    const hand = group('hand', el);
    hand.position.set(0, -0.3, 0);
    const bag = group('bagpt', el);
    bag.position.set(0, -0.13, 0);
    const P = ARMPOSE[sit ? 'lap' : 'hang'];
    sh.rotation.set(P.s, 0, sd * P.z);
    el.rotation.x = P.e;
    arms[n] = { shoulder: sh, elbow: el, hand, bag, sd, s: P.s, e: P.e, z: P.z, bob: 0, mode: 'free', base: 0 };
  }

  // Legs: on the seat or standing.
  for (const sx of [-1, 1]) {
    const x = sx * 0.095;
    if (sit) {
      const knee = V(x, 0.1, 0.42);
      const ankle = V(x, -0.455, 0.46);
      bone(root, V(x, 0.08, 0), knee, 0.078, pants);
      bone(root, knee, ankle, 0.064, pants);
      part(root, USPH, pants, x, 0.1, 0.42, 0.07, 0.07, 0.07);
      part(root, UBOX, shoe, x, -0.49, 0.53, 0.095, 0.07, 0.24);
    } else {
      const knee = V(x, -0.43, 0.03);
      const ankle = V(x, -0.85, 0);
      bone(root, V(x, 0, 0), knee, 0.078, pants);
      bone(root, knee, ankle, 0.064, pants);
      part(root, USPH, pants, x, -0.43, 0.03, 0.07, 0.07, 0.07);
      part(root, UBOX, shoe, x, -0.865, 0.06, 0.095, 0.07, 0.24);
    }
  }

  // Head items ride on the skull, so a cucumber flips up with every word.
  const headAnchor = group('a_head', S);
  headAnchor.position.set(0, L.hair === 'muetze' ? 0.42 : 0.36, 0);
  const hip = group('a_hip', root);
  if (sit) {
    hip.position.set(0.215, 0.14, 0.1);
    hip.rotation.x = -1.0;
  } else {
    hip.position.set(0.215, 0.04, 0.02);
    hip.rotation.z = 0.05;
  }

  return {
    torso: T,
    head: H,
    mouth: skull,
    arms,
    anchors: { head: headAnchor, handL: arms.L.hand, handR: arms.R.hand, arm: arms.L.bag, hip },
    povHide: H,
    eye: V(0, 0.2, 0.07),
  };
}
