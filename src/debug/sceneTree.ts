import * as THREE from 'three';

const fmt = (n: number) => Math.round(n).toLocaleString('de-DE');

function meshCount(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) n++;
  });
  return n;
}

function triCount(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    n += tris * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
  });
  return n;
}

const pad = (s: string, n: number) => s.padEnd(n, ' ');

/**
 * Text tree of the scene, two levels deep. Numbered siblings (seat_1 … seat_16) collapse into one
 * line so the list stays readable once 10 NPCs and 4 players are in.
 */
export function sceneTree(scene: THREE.Scene): string {
  const out = [pad('scene', 26) + `${fmt(meshCount(scene))} / ${fmt(triCount(scene))}`];
  const walk = (parent: THREE.Object3D, prefix: string) => {
    const groups: { key: string; items: THREE.Object3D[] }[] = [];
    const byKey = new Map<string, number>();
    for (const c of parent.children) {
      if (!c.name) continue;
      const m = c.name.match(/^(.*)_(\d+)$/);
      const key = m ? m[1] : c.name;
      if (!byKey.has(key)) {
        byKey.set(key, groups.length);
        groups.push({ key, items: [] });
      }
      groups[byKey.get(key)!].items.push(c);
    }
    groups.forEach((g, i) => {
      const last = i === groups.length - 1;
      let me = 0;
      let tr = 0;
      for (const c of g.items) {
        me += meshCount(c);
        tr += triCount(c);
      }
      const name = g.items.length > 1 ? `${g.key}_1…${g.items.length}` : g.items[0].name;
      out.push(pad(prefix + (last ? '└─ ' : '├─ ') + name, 26) + `${fmt(me)} / ${fmt(tr)}`);
      if (prefix === '' && g.items.length === 1) walk(g.items[0], last ? '   ' : '│  ');
    });
  };
  walk(scene, '');
  return out.join('\n');
}
