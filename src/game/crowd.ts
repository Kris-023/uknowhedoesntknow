import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildBottle, buildNewspaper, buildPhone, ITEM_IDS, ITEMS } from '../characters/accessories';
import { makeLook } from '../characters/look';
import { Person } from '../characters/person';
import { ARMPOSE } from '../characters/rig';
import { SEAT_X, SEAT_Z } from '../config';
import { mulberry32, type Rand } from '../core/rng';

/** Passengers per neighbour coach: seated and standing, a frozen moment of the same four activities. */
const CROWD = { seatedMin: 5, seatedMax: 8, standingMax: 2 } as const;
const STAND_SCALE = 0.94;

type Pose = 'phone' | 'paper' | 'beer' | 'sleep' | 'idle';

/** One passenger in a fixed pose, built like the real NPCs (same rig, same props). */
function figure(parent: THREE.Object3D, r: Rand, standing: boolean): void {
  const root = new THREE.Group();
  parent.add(root);
  const person = new Person(root, makeLook(r), standing ? 'stand' : 'sit');
  const arms = person.rig.arms!;
  const pose = (['phone', 'phone', 'paper', 'beer', 'sleep', 'idle'] as const)[Math.floor(r() * 6)] as Pose;
  let pitch = 0.05;
  let yaw = (r() - 0.5) * 0.8;
  if (pose === 'phone') {
    arms.R.hand.add(buildPhone());
    arms.R.mode = 'fixed';
    arms.R.base = -(ARMPOSE.phone.s + ARMPOSE.phone.e) - 0.3;
    person.armOverride = { R: 'phone' };
    person.handSide = 'L';
    pitch = 0.36;
    yaw = 0.05;
  } else if (pose === 'beer') {
    arms.R.hand.add(buildBottle(r() < 0.5));
    arms.R.mode = 'fixed';
    arms.R.base = -(ARMPOSE.beer.s + ARMPOSE.beer.e);
    person.armOverride = { R: 'beer' };
    person.handSide = 'L';
  } else if (pose === 'paper') {
    person.rig.torso.add(buildNewspaper());
    person.armOverride = { L: 'paper', R: 'paper' };
    person.handSide = null;
    pitch = 0.1;
    yaw = 0;
  } else if (pose === 'sleep') {
    person.armOverride = { L: 'lap', R: 'lap' };
    person.lean = 0.28;
    pitch = 0.55;
    yaw = 0.35;
  }
  for (const slot of ['head', 'hand', 'arm', 'hip'] as const) {
    if (r() > (slot === 'hip' ? 0.15 : 0.3) || (slot === 'hand' && !person.handSide)) continue;
    const ids = ITEM_IDS.filter((id) => ITEMS[id].slot === slot);
    person.equip(ids[Math.floor(r() * ids.length) % ids.length]);
  }
  for (let k = 0; k < 8; k++) person.update(0.5, k, yaw, pitch, 6, 0);
  if (standing) {
    root.position.set((r() - 0.5) * 0.9, 0.9 * STAND_SCALE, (r() - 0.5) * 7);
    root.scale.setScalar(STAND_SCALE);
    root.rotation.y = r() * Math.PI * 2;
  }
}

/**
 * Bakes a coach full of passengers into one geometry with vertex colours: one draw call per
 * neighbour coach instead of hundreds. Textures (newspaper, bag print) become their base colour,
 * which is all that's left of them at that distance in the fog anyway.
 */
export function bakeCrowd(seed: number): THREE.BufferGeometry {
  const r = mulberry32(seed ^ 0xc20d);
  const tmp = new THREE.Group();
  const seats = [-1, 1].flatMap((side) => SEAT_Z.map((z) => ({ side, z })));
  for (let i = seats.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [seats[i], seats[j]] = [seats[j], seats[i]];
  }
  const seated = CROWD.seatedMin + Math.floor(r() * (CROWD.seatedMax - CROWD.seatedMin + 1));
  for (const s of seats.slice(0, seated)) {
    const g = new THREE.Group();
    g.position.set(s.side * SEAT_X, 0.525, s.z);
    g.rotation.y = s.side === -1 ? Math.PI / 2 : -Math.PI / 2;
    tmp.add(g);
    figure(g, r, false);
  }
  const standing = Math.floor(r() * (CROWD.standingMax + 1));
  for (let i = 0; i < standing; i++) figure(tmp, r, true);

  tmp.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  const c = new THREE.Color();
  tmp.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    // The mouth cavity sits inside the closed head; it never shows from outside.
    if (mat.side === THREE.BackSide || !mesh.visible) return;
    c.copy(mat.color ?? c.set(0x888888));
    if (mat.map) c.multiplyScalar(0.75);
    const geo = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);
    // Every part keeps only position, normal, colour, so all of them merge into one buffer.
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(col, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.morphAttributes = {};
    geos.push(geo);
  });
  return mergeGeometries(geos)!;
}

/**
 * Hemisphere light the crowds follow: colour × intensity × Lambert factor, set per frame by the
 * neighbours from the scene's hemisphere light.
 */
export const crowdHemi = { sky: { value: new THREE.Color() }, ground: { value: new THREE.Color() } };

/**
 * Shared material for all baked crowds. Unlit basic material with hand-made hemisphere shading:
 * the neighbour coaches lie outside the reach of the player coach's point lights anyway, but a
 * standard material still paid for all of them on every crowd pixel. Fog works as before.
 * Double-sided because hair caps and the torso are open shells; back faces shade with the flipped normal.
 */
export const crowdMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
crowdMaterial.onBeforeCompile = (sh) => {
  sh.uniforms.hemiSky = crowdHemi.sky;
  sh.uniforms.hemiGround = crowdHemi.ground;
  sh.vertexShader =
    'varying float vUpN;\n' +
    sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vUpN = normalize(mat3(modelMatrix) * normal).y;');
  sh.fragmentShader =
    'uniform vec3 hemiSky;\nuniform vec3 hemiGround;\nvarying float vUpN;\n' +
    sh.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n  float upN = gl_FrontFacing ? vUpN : -vUpN;\n  diffuseColor.rgb *= mix(hemiGround, hemiSky, 0.5 * upN + 0.5);',
    );
};
