import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS, LIGHTS, TRAIN } from '../config';
import { flick } from '../core/motion';
import { group, tag, type Role } from './build';

export interface Neighbours {
  update(t: number): void;
}

/**
 * Copies of the player coach in both directions, so every door looks into the next car and the
 * train seems endless. Each copy is the static coach baked into one mesh per material (about 15
 * draw calls instead of 150). Neon flickers per copy as a whole, and copies never black out:
 * the outage belongs to the player coach only.
 */
export function buildNeighbours(
  scene: THREE.Scene,
  coach: THREE.Object3D,
  poweredMaterials: THREE.Material[],
  /** Baked passengers (one mesh each), spread over the nearer copies. */
  crowds: { geos: THREE.BufferGeometry[]; material: THREE.Material; upTo: number } | null = null,
): Neighbours {
  const root = group('neighbours', scene);
  coach.updateMatrixWorld(true);
  const powered = new Map(poweredMaterials.map((m) => [m, m.clone()]));

  // Group every static mesh by (material, role); neon is collected separately so each copy can own it.
  const buckets = new Map<string, { mat: THREE.Material | 'tube' | 'halo'; role: Role; geos: THREE.BufferGeometry[] }>();
  let haloMap: THREE.Texture | null = null;
  coach.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const role = mesh.userData.role as Role;
    const neon = mesh.userData.neon as 'tube' | 'halo' | undefined;
    if (neon === 'halo') haloMap = (mesh.material as THREE.MeshBasicMaterial).map;
    const mat = neon ?? powered.get(mesh.material) ?? mesh.material;
    const key = typeof mat === 'string' ? mat : `${mat.uuid}|${role}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat, role, geos: [] }));
    // All coach parts are indexed Box/Plane geometries with the same attributes, so they merge directly.
    b.geos.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
  });

  const baked = [...buckets.values()].map((b) => ({ ...b, geo: mergeGeometries(b.geos)! }));

  const copies: { tube: THREE.MeshBasicMaterial; halo: THREE.MeshBasicMaterial; seed: number }[] = [];
  const neonColor = new THREE.Color(COLORS.neon);
  let n = 0;
  for (const dir of [-1, 1]) {
    for (let k = 1; k <= TRAIN.neighboursPerSide; k++) {
      const copy = group(`car_${++n}`, root);
      copy.position.z = dir * k * TRAIN.period;
      const tube = new THREE.MeshBasicMaterial({ color: COLORS.neon });
      const halo = new THREE.MeshBasicMaterial({
        map: haloMap,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      for (const b of baked) {
        const mat = b.mat === 'tube' ? tube : b.mat === 'halo' ? halo : b.mat;
        copy.add(tag(new THREE.Mesh(b.geo, mat), b.role));
      }
      // The far copies vanish in the fog; passengers there would only cost triangles.
      if (crowds && k <= crowds.upTo) copy.add(tag(new THREE.Mesh(crowds.geos[n % crowds.geos.length], crowds.material), 'npc'));
      copies.push({ tube, halo, seed: 31.7 + dir * 7.3 + k * 2.9 });
    }
  }

  return {
    update(t) {
      for (const c of copies) {
        const k = flick(t, c.seed);
        c.tube.color.copy(neonColor).multiplyScalar((0.04 + 0.96 * k) * LIGHTS.neonTubeHdr);
        c.halo.opacity = 0.55 * k;
      }
    },
  };
}
