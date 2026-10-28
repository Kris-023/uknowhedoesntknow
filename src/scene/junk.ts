import * as THREE from 'three';
import { buildBottle } from '../characters/accessories';
import { COACH } from '../config';
import { mulberry32 } from '../core/rng';
import { group, tag } from './build';
import { canvasTex } from './textures';

/** Bottle radius: rolling distance / radius = rotation, so they roll without sliding. */
const BOTTLE_R = 0.032;

/** Deposit bottles: start position (x, z) and phase of their back-and-forth roll. */
const ROLLERS = [
  { x: 0.45, z: -1.8, ph: 0 },
  { x: -0.55, z: 2.4, ph: 1.7 },
];

/**
 * Stickers on the side walls: (side, z, height, atlas cell). Four made-up motifs in one texture,
 * no brands, no logos.
 */
const STICKERS: [side: -1 | 1, z: number, y: number, cell: number][] = [
  [-1, -3.6, 0.7, 0],
  [-1, -1.8, 0.55, 1],
  [-1, 0.9, 0.8, 2],
  [-1, 2.7, 0.6, 3],
  [1, -2.7, 0.75, 1],
  [1, -0.9, 0.6, 3],
  [1, 1.8, 0.8, 0],
  [1, 3.6, 0.55, 2],
];

function stickerAtlas(): THREE.CanvasTexture {
  return canvasTex(256, 256, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    // Smiley
    x.fillStyle = '#ffd21f';
    x.beginPath();
    x.arc(64, 64, 52, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#111';
    x.beginPath();
    x.arc(46, 52, 7, 0, Math.PI * 2);
    x.arc(82, 52, 7, 0, Math.PI * 2);
    x.fill();
    x.lineWidth = 6;
    x.strokeStyle = '#111';
    x.beginPath();
    x.arc(64, 70, 26, 0.2, 2.9);
    x.stroke();
    // Star
    x.fillStyle = '#d0322a';
    x.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 22 : 52;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      x.lineTo(192 + Math.cos(a) * r, 64 + Math.sin(a) * r);
    }
    x.fill();
    // Stripes
    for (let s = 0; s < 8; s++) {
      x.fillStyle = s % 2 ? '#111' : '#f06aa8';
      x.fillRect(16 + s * 14, 144, 14, 96);
    }
    // "No entry"-ish circle
    x.fillStyle = '#2f8a3a';
    x.beginPath();
    x.arc(192, 192, 44, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#f2f2ee';
    x.fillRect(152, 184, 80, 16);
  });
}

export interface Junk {
  update(t: number): void;
}

/** Deposit bottles rolling with the clock, stickers on the walls. Both deterministic, no network. */
export function buildJunk(coach: THREE.Object3D, seed: number): Junk {
  const root = group('junk', coach);
  const rollers = ROLLERS.map((d, i) => {
    const g = group(`pfand_${i + 1}`, root);
    g.position.set(d.x, BOTTLE_R, d.z);
    const b = buildBottle();
    b.rotation.z = -Math.PI / 2;
    // Lying bottles get a seed-based heading, so each lobby's floor looks a bit different.
    g.rotation.y = (mulberry32(seed + i)() - 0.5) * 0.6;
    g.add(b);
    return { g, b, ...d };
  });

  const atlas = stickerAtlas();
  const geo = new THREE.PlaneGeometry(0.2, 0.2);
  const decals = group('stickers', root);
  for (const [side, z, y, cell] of STICKERS) {
    const tex = atlas.clone();
    tex.needsUpdate = true;
    tex.repeat.set(0.5, 0.5);
    tex.offset.set((cell % 2) * 0.5, 0.5 - (cell >> 1) * 0.5);
    // Lit like the wall (dark at night), so stickers never glow.
    const m = tag(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, alphaTest: 0.05 })), 'struct');
    m.position.set(side * (COACH.width / 2 - 0.006), y, z);
    m.rotation.y = side === -1 ? Math.PI / 2 : -Math.PI / 2;
    m.rotation.z = z * 0.3;
    decals.add(m);
  }

  return {
    update(t) {
      for (const r of rollers) {
        // Rolls back and forth with the coach's sway; the angle follows the distance.
        const dz = 0.5 * Math.sin(t * 0.45 + r.ph);
        r.g.position.z = r.z + dz;
        r.b.rotation.x = dz / BOTTLE_R;
      }
    },
  };
}
