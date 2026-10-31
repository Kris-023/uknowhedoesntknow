import * as THREE from 'three';

/** GPU-backed things one scene graph uses. */
export interface Resources {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
  /** Objects with their own GPU data or dispose hook (instanced meshes, lights with shadow maps). */
  objects: Set<THREE.Object3D & { dispose(): void }>;
}

function texturesOf(value: unknown, out: Set<THREE.Texture>): void {
  if (value instanceof THREE.Texture) out.add(value);
  else if (Array.isArray(value)) for (const v of value) texturesOf(v, out);
}

/**
 * Everything under `root` that holds GPU memory: geometry, materials, every texture a material
 * points at (maps, env, shader uniforms), and the background/environment of a scene.
 */
export function collectResources(root: THREE.Object3D): Resources {
  const r: Resources = { geometries: new Set(), materials: new Set(), textures: new Set(), objects: new Set() };
  if (root instanceof THREE.Scene) {
    texturesOf(root.background, r.textures);
    texturesOf(root.environment, r.textures);
  }
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry instanceof THREE.BufferGeometry) r.geometries.add(m.geometry);
    const mats = m.material === undefined ? [] : Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      if (!(mat instanceof THREE.Material) || r.materials.has(mat)) continue;
      r.materials.add(mat);
      for (const v of Object.values(mat)) texturesOf(v, r.textures);
      const uniforms = (mat as THREE.ShaderMaterial).uniforms;
      if (uniforms) for (const u of Object.values(uniforms)) texturesOf(u?.value, r.textures);
    }
    if ((o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.Light).isLight) r.objects.add(o as THREE.Object3D & { dispose(): void });
  });
  return r;
}

/**
 * Frees the GPU memory of `old`, except what `keep` still uses. Characters, items and many props
 * come from module-level caches that the next world takes again: those stay uploaded. Anything
 * freed that a later world reuses is simply uploaded again by three.js, so this never breaks a
 * scene, at worst it costs an upload.
 * Returns how many of each were freed (for the debug log).
 */
export function disposeExcept(old: THREE.Object3D, keep: Resources | null): { geometries: number; materials: number; textures: number } {
  const r = collectResources(old);
  const n = { geometries: 0, materials: 0, textures: 0 };
  for (const g of r.geometries) {
    if (keep?.geometries.has(g)) continue;
    g.dispose();
    n.geometries++;
  }
  for (const m of r.materials) {
    if (keep?.materials.has(m)) continue;
    m.dispose();
    n.materials++;
  }
  for (const t of r.textures) {
    if (keep?.textures.has(t)) continue;
    t.dispose();
    n.textures++;
  }
  for (const o of r.objects) if (!keep?.objects.has(o)) o.dispose();
  return n;
}
