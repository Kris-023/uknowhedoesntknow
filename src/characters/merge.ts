import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Fewer draw calls for figures and items: every group's direct mesh children that share material
 * and role become one mesh. Groups are the joints (torso, head, skull, arms, the chicken's head),
 * so everything that moves still moves; only parts that never move against each other are fused.
 * A figure drops from ~40 draw calls to ~15.
 */
export function mergeStatic(root: THREE.Object3D): void {
  const groups: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) groups.push(o);
  });
  for (const g of groups) {
    const buckets = new Map<string, THREE.Mesh[]>();
    for (const c of g.children) {
      const m = c as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material) || m.userData.keep || !m.geometry.index) continue;
      const key = `${m.material.uuid}|${m.userData.role}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(m);
    }
    for (const meshes of buckets.values()) {
      if (meshes.length < 2) continue;
      const attrs = Object.keys(meshes[0].geometry.attributes).sort().join();
      // Only geometries with the same attributes can share one buffer.
      const same = meshes.filter((m) => Object.keys(m.geometry.attributes).sort().join() === attrs);
      if (same.length < 2) continue;
      const geos = same.map((m) => {
        m.updateMatrix();
        return m.geometry.clone().applyMatrix4(m.matrix);
      });
      const merged = mergeGeometries(geos);
      for (const geo of geos) geo.dispose();
      if (!merged) continue;
      merged.userData = { owned: true };
      const first = same[0];
      const out = new THREE.Mesh(merged, first.material);
      out.name = `${g.name || 'part'}_merged`;
      out.userData.role = first.userData.role;
      for (const m of same) g.remove(m);
      g.add(out);
    }
  }
}
