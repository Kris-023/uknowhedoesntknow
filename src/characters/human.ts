import * as THREE from 'three';
import { group } from '../scene/build';
import { canvasTex } from '../scene/textures';
import { addCollar, addFoot, topMats } from './clothes';
import { CUT_Y, faceWarp, HEAD_C, warpMeshes } from './face';
import { addBeard, addHair, HAIR_TOP, hairMat } from './hair';
import type { Build, Look } from './look';
import { bone, cm, darken, part, UBOX, UCYL, USPH, V } from './parts';
import { ARMPOSE, type Arm, type ArmSide, type Extent, type Rig } from './rig';

// Style "Mensch": realistic-stylised proportions after the Quaternius Universal Base Characters (CC0).
// The face stays deliberately calm: small dark eyes, no whites, the mouth is a thin dark line.

const pelvisCache = new Map<string, THREE.LatheGeometry>();
/** Pants top: hem radius at the waist, thigh span at the crotch, rounded seat below. */
function pelvisGeo(hem: number, thighs: number): THREE.LatheGeometry {
  const k = `${hem.toFixed(3)}_${thighs.toFixed(3)}`;
  let g = pelvisCache.get(k);
  if (!g) {
    const b = Math.min(hem * 1.04, Math.max(hem * 0.86, thighs));
    const P = [[hem, 0.08], [hem, 0.04], [b, -0.02], [b * 0.82, -0.065], [b * 0.4, -0.09], [0.001, -0.095]];
    g = new THREE.LatheGeometry(P.map(([r, y]) => new THREE.Vector2(r, y)).reverse(), 16);
    pelvisCache.set(k, g);
  }
  return g;
}

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

const glassRing = new THREE.TorusGeometry(0.036, 0.006, 5, 12);
// Brows are arcs whose middle sits at the origin: women's thin and arched, men's heavier and flatter.
const arc = (r: number, tube: number, a: number) => new THREE.TorusGeometry(r, tube, 4, 10, a).rotateZ(Math.PI / 2 - a / 2).translate(0, -r, 0);
const browF = arc(0.04, 0.0032, 1.0);
const browM = arc(0.09, 0.0058, 0.4);

// The head is split at mouth height into skull and jaw, so talking can flip the skull open like a lid
// (R.E.P.O.-style). Both halves come from the same unit sphere, so when closed the normals line up
// and the head still reads as one seamless ellipsoid.
const CUT_THETA = Math.acos((CUT_Y - HEAD_C.y) / HEAD_C.ry);
const CUT_R = Math.sin(CUT_THETA);
/** Hinge at the back of the head on the cut plane. */
const HINGE_Z = -HEAD_C.rz * CUT_R;
// Finer than the body parts: face shapes bend these, and coarse facets would show on the jaw.
const headTop = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, CUT_THETA);
const headBottom = new THREE.SphereGeometry(1, 20, 6, 0, Math.PI * 2, CUT_THETA, Math.PI - CUT_THETA);
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

/** Torso size at height `y` (torso space), measured from the parts built so far. */
function extent(T: THREE.Group, y: number): Extent {
  const e = { y, x: 0, zf: 0, zb: 0 };
  const p = new THREE.Vector3();
  for (const c of T.children) {
    const m = c as THREE.Mesh;
    if (!m.isMesh) continue;
    m.updateMatrix();
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(m.matrix);
      if (Math.abs(p.y - y) > 0.03) continue;
      e.x = Math.max(e.x, Math.abs(p.x));
      e.zf = Math.max(e.zf, p.z);
      e.zb = Math.min(e.zb, p.z);
    }
  }
  return e;
}

/** How far back (head space, positive) the skull hair reaches just above the mouth plane. */
function hairBack(S: THREE.Group): number {
  let back = 0;
  const p = new THREE.Vector3();
  for (const c of S.children) {
    const m = c as THREE.Mesh;
    if (!m.isMesh || m.material === undefined) continue;
    m.updateMatrix();
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(m.matrix);
      if (p.y < CUT_Y + 0.025 && Math.abs(p.x) < 0.1) back = Math.max(back, -p.z);
    }
  }
  return back;
}

/**
 * Eyes, brows, nose and mouth. Men: straight, heavier brows, bigger nose, thin mouth line. Women:
 * arched thin brows, lashes, slightly larger eyes, smaller nose, a fuller (still dark) lip line.
 * Calm on purpose: no whites, no expression.
 */
function addFace(S: THREE.Group, H: THREE.Group, L: Look, hairMatS: THREE.Material | null): void {
  const f = L.female;
  const skin = cm(darken(L.skin, 0.8), 0.65);
  const eyeMat = cm(0x2a2220, 0.5);
  // Brows share the hair material when there is one on the skull, so they merge into it.
  const browMat = hairMatS ?? hairMat('strand', L.hairCol);
  const onFace = (x: number, y: number, out = 0) =>
    HEAD_C.rz * Math.sqrt(Math.max(0, 1 - (x / HEAD_C.rx) ** 2 - ((y - HEAD_C.y) / HEAD_C.ry) ** 2)) + out;
  if (f) part(S, USPH, skin, 0, 0.176, 0.15, 0.019, 0.025, 0.023);
  else part(S, USPH, skin, 0, 0.172, 0.15, 0.024, 0.03, 0.029);
  for (const sx of [-1, 1]) {
    const ex = sx * 0.052;
    const ez = onFace(ex, 0.212);
    if (f) {
      part(S, USPH, eyeMat, ex, 0.212, ez, 0.0135, 0.0155, 0.008);
      // Thin upper lid line and a lash flick at the outer corner.
      part(S, UBOX, eyeMat, ex + sx * 0.002, 0.2262, ez + 0.002, 0.026, 0.0024, 0.006).rotation.z = sx * 0.16;
      part(S, UBOX, eyeMat, ex + sx * 0.0165, 0.2282, ez, 0.011, 0.0026, 0.004).rotation.z = sx * 0.7;
      const by = 0.247;
      part(S, browF, browMat, sx * 0.053, by, onFace(sx * 0.053, by, 0.003)).rotation.z = -sx * 0.1;
    } else {
      part(S, USPH, eyeMat, ex, 0.212, ez, 0.012, 0.014, 0.008);
      const by = 0.242;
      part(S, browM, browMat, sx * 0.054, by, onFace(sx * 0.054, by, 0.004)).rotation.z = -sx * 0.05;
    }
  }
  // Closed mouth: a thin dark line, a touch fuller and warmer for women.
  if (f) part(H, UBOX, cm(0x34121a, 0.7), 0, CUT_Y, 0.133, 0.046, 0.0075, 0.006);
  else part(H, UBOX, cm(0x24100e, 0.7), 0, CUT_Y, 0.133, 0.054, 0.005, 0.006);
}

export type BodyPose = 'sit' | 'stand';

/**
 * Body proportions per build, as factors on the normal body. w/d: torso width/depth, limb: arm
 * thickness, leg: leg thickness (spacing grows with it), belly: 0 none .. 1 the big one that hangs
 * over the lap, spread: arms held away from the body (rad) so they clear torso and belly.
 */
const BUILD: Record<Build, { w: number; d: number; limb: number; shoulder: number; hip: number; leg: number; neck: number; belly: number; spread: number }> = {
  duenn: { w: 0.74, d: 0.78, limb: 0.7, shoulder: 0.86, hip: 0.82, leg: 0.78, neck: 0.85, belly: 0, spread: -0.03 },
  normal: { w: 1, d: 1, limb: 1, shoulder: 1, hip: 1, leg: 1, neck: 1, belly: 0, spread: 0 },
  kraeftig: { w: 1.2, d: 1.25, limb: 1.3, shoulder: 1.12, hip: 1.15, leg: 1.25, neck: 1.25, belly: 0.45, spread: 0.1 },
  xxl: { w: 1.9, d: 1.95, limb: 1.9, shoulder: 1.55, hip: 2.1, leg: 1.95, neck: 1.8, belly: 1, spread: 0.5 },
};

export function rigHuman(root: THREE.Object3D, L: Look, pose: BodyPose, hat = false): Rig {
  const sit = pose === 'sit';
  const f = L.female;
  const B = BUILD[L.build] ?? BUILD.normal;
  const T = group('torso', root);
  const H = group('head', T);
  H.position.set(0, 0.62, 0);

  const skin = cm(darken(L.skin, 0.8), 0.65);
  const tm = topMats(L);
  const top = tm.limb;
  const pants = cm(L.pants, 0.9);
  const dark = cm(0x0b0d12, 0.4);

  // Trunk, pelvis, neck. The torso narrows towards the neck, so scaling it keeps the head joint.
  part(T, torsoGeo(f), tm.torso, 0, 0, 0, B.w, 1, B.d);
  // Pelvis runs straight from the shirt hem to the thighs: a ball here read as riding breeches.
  const hem = (f ? 0.17 : 0.18) * B.w;
  const thighs = 0.095 * (1 + (B.leg - 1) * 0.75) + 0.078 * B.leg;
  // Same depth-to-width ratio as the torso hem (whose lathe is pre-squashed and then scaled by
  // w/d); the radius here already contains B.w, so depth is scaled by d/w, not d.
  part(T, pelvisGeo(hem, thighs), pants, 0, 0, 0, 1, 1, (0.62 * B.d) / B.w);
  if (B.belly > 0) {
    // Belly in shirt colour: sits forward and low, the big one droops over the lap past the seat edge.
    const k = B.belly;
    if (k < 1) part(T, USPH, top, 0, 0.24 - 0.07 * k, 0.03 + 0.08 * k, 0.17 + 0.12 * k, 0.15 + 0.09 * k, 0.12 + 0.09 * k);
    else {
      // Low, wide belly resting on the thighs, a chest roll above it, and hips wider than the seat.
      part(T, USPH, top, 0, 0.14, 0.24, 0.4, 0.3, 0.36);
      part(T, USPH, top, 0, 0.4, 0.12, 0.36, 0.16, 0.3);
      for (const sx of [-1, 1]) part(T, USPH, top, sx * 0.3, 0.12, 0.02, 0.16, 0.16, 0.22);
    }
  }
  const fit = { neck: extent(T, 0.5), chest: extent(T, 0.4), belly: extent(T, 0.16) };
  addCollar(T, L, 0.052 * B.neck, top);
  // Neck ends inside the head but below the jaw bowl, otherwise it pokes into the open mouth.
  // It belongs to the body, so face shapes don't bend it.
  part(H, UCYL, skin, 0, -0.03, 0, 0.052 * B.neck, 0.06, 0.052 * B.neck).userData.noWarp = true;

  // Everything on the head is modelled on the oval base head and bent into the chosen face shape
  // at the end (see face.ts); hinge, eye point and item anchor go through the same warp.
  const warp = faceWarp(L);
  const hinge = warp(V(0, CUT_Y, HINGE_Z));

  // Jaw (stays) and skull (hinged at the back, opens with the voice). `S` is the skull in head
  // coordinates, so everything above the mouth line keeps its usual position.
  const skull = group('skull', H);
  skull.position.copy(hinge);
  const S = group('skull_space', skull);
  S.position.copy(hinge).negate();
  const cavity = new THREE.MeshStandardMaterial({ color: CAVITY, roughness: 0.95, metalness: 0, side: THREE.BackSide });
  cavity.userData.owned = true;
  const bowlMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
  bowlMat.userData.owned = true;
  const { y: hy, rx, ry, rz } = HEAD_C;
  const crx = rx * CUT_R;
  const crz = rz * CUT_R;
  part(H, headBottom, skin, 0, hy, 0, rx, ry, rz);
  part(S, headTop, skin, 0, hy, 0, rx, ry, rz);
  // Jaw bowl pure black, so the mouth reads as a dark hole and only the tongue decal shows in it.
  part(H, bowlGeo, bowlMat, 0, CUT_Y, 0, crx, 0.06, crz);
  part(H, tongueGeo, tongue(), 0, CUT_Y - 0.03, 0.02, crx * 1.1, 1, crz * 1.1);

  const hairMatS = addHair(S, H, L, hat);
  // Palate: a shallow dome just below the cut, reaching back as far as the hair does at mouth
  // height, so the hair's underside never shows through the open mouth. The jaw bowl gives depth.
  const domeBack = Math.max(crz, hairBack(S) + 0.006);
  const domeRz = (crz + domeBack) / 2;
  part(S, domeGeo, cavity, 0, CUT_Y - 0.004, crz - domeRz, crx, 0.014, domeRz);
  addFace(S, H, L, hairMatS);
  addBeard(S, H, L);
  if (L.glasses) {
    for (const sx of [-1, 1]) part(S, glassRing, dark, sx * 0.058, 0.215, 0.158);
    part(S, UBOX, dark, 0, 0.222, 0.16, 0.03, 0.006, 0.006);
  }
  warpMeshes(H, warp);

  // Arms: shoulder -> elbow -> hand, each its own joint group.
  const arms = {} as Record<ArmSide, Arm>;
  for (const n of ['L', 'R'] as const) {
    const sd = n === 'L' ? 1 : -1;
    const sh = group(`arm_${n}`, T);
    sh.position.set(sd * (f ? 0.205 : 0.225) * B.shoulder, 0.5, 0);
    const lr = B.limb;
    part(sh, USPH, top, 0, 0, 0, 0.06 * lr, 0.06 * lr, 0.06 * lr);
    bone(sh, V(0, 0, 0), V(0, -0.28, 0), 0.05 * lr, top);
    const el = group('forearm', sh);
    el.position.set(0, -0.28, 0);
    part(el, USPH, top, 0, 0, 0, 0.046 * lr, 0.046 * lr, 0.046 * lr);
    bone(el, V(0, 0, 0), V(0, -0.26, 0), 0.042 * lr, L.short ? skin : top);
    const hr = 0.85 + 0.15 * lr;
    part(el, USPH, skin, 0, -0.29, 0, 0.04 * hr, 0.045 * hr, 0.035 * hr);
    const hand = group('hand', el);
    hand.position.set(0, -0.3, 0);
    const bag = group('bagpt', el);
    bag.position.set(0, -0.13, 0);
    const P = ARMPOSE[sit ? 'lap' : 'hang'];
    sh.rotation.set(P.s, 0, sd * (P.z + B.spread));
    el.rotation.x = P.e;
    arms[n] = { shoulder: sh, elbow: el, hand, bag, sd, s: P.s, e: P.e, z: P.z, bob: 0, spread: B.spread, mode: 'free', base: 0 };
  }

  // Legs: on the seat or standing.
  const lg = B.leg;
  // Thicker legs need more room between them; the shoes follow the knees.
  const legX = 0.095 * (1 + (lg - 1) * 0.75);
  // Heavy legs reach further forward on the seat, so the knees come out from under the belly
  // instead of ending inside it.
  const fwd = Math.max(0, lg - 1) * 0.21;
  for (const sx of [-1, 1]) {
    const x = sx * legX;
    // Round thigh tops: a bare cylinder end shows as a flat disc whenever the torso (and belly)
    // turns away above the fixed legs.
    if (sit) {
      const hipJ = V(x, 0.08, 0);
      const knee = V(x, 0.1 + 0.03 * (lg - 1), 0.42 + fwd);
      const ankle = V(x, -0.455, 0.46 + fwd);
      part(root, USPH, pants, hipJ.x, hipJ.y, hipJ.z, 0.078 * lg, 0.078 * lg, 0.078 * lg);
      if (lg > 1.5) {
        // Heavy thighs as one rounded mass: a cylinder ends in hard rims at hip and knee.
        const d = knee.clone().sub(hipJ);
        const th = part(root, USPH, pants, (hipJ.x + knee.x) / 2, (hipJ.y + knee.y) / 2, (hipJ.z + knee.z) / 2, 0.08 * lg, d.length() / 2 + 0.03 * lg, 0.08 * lg);
        th.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
      } else bone(root, hipJ, knee, 0.078 * lg, pants);
      bone(root, knee, ankle, 0.064 * lg, pants);
      part(root, USPH, pants, knee.x, knee.y, knee.z, 0.068 * lg, 0.068 * lg, 0.068 * lg);
      addFoot(root, L, x, -0.49, 0.53 + fwd, 0.095 * (0.9 + 0.1 * lg), skin);
    } else {
      const knee = V(x, -0.43, 0.03);
      const ankle = V(x, -0.85, 0);
      part(root, USPH, pants, x, 0, 0, 0.078 * lg, 0.078 * lg, 0.078 * lg);
      bone(root, V(x, 0, 0), knee, 0.078 * lg, pants);
      bone(root, knee, ankle, 0.064 * lg, pants);
      part(root, USPH, pants, x, -0.43, 0.03, 0.066 * lg, 0.066 * lg, 0.066 * lg);
      addFoot(root, L, x, -0.865, 0.06, 0.095 * (0.9 + 0.1 * lg), skin);
    }
  }

  // Head items ride on the skull, so a cucumber flips up with every word.
  const headAnchor = group('a_head', S);
  headAnchor.position.copy(warp(V(0, hat ? HAIR_TOP.kurz : (HAIR_TOP[L.hair] ?? 0.37), 0)));
  const hip = group('a_hip', root);
  if (sit) {
    hip.position.set(0.215 * B.hip, 0.14, 0.1);
    hip.rotation.x = -1.0;
  } else {
    hip.position.set(0.215 * B.hip, 0.04, 0.02);
    hip.rotation.z = 0.05;
  }

  // Neck and body items ride on the torso; floor items (dog, crate) stand beside the legs.
  const neckAnchor = group('a_neck', T);
  neckAnchor.position.set(0, fit.neck.y, 0);
  const bodyAnchor = group('a_body', T);
  const floor = group('a_floor', root);
  const floorX = legX + 0.078 * lg + 0.17;
  if (sit) floor.position.set(floorX, -0.525, 0.38 + fwd * 0.5);
  else floor.position.set(floorX, -0.9, 0.12);

  return {
    torso: T,
    head: H,
    mouth: skull,
    arms,
    anchors: { head: headAnchor, handL: arms.L.hand, handR: arms.R.hand, arm: arms.L.bag, hip, neck: neckAnchor, body: bodyAnchor, floor },
    povHide: H,
    eye: warp(V(0, 0.2, 0.07)),
    warp,
    hatBase: V(0, HAIR_TOP.kurz, 0),
    fit,
  };
}
