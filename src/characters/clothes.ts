import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import { canvasTex } from '../scene/textures';
import { hairMat } from './hair';
import { shade } from './itemkit';
import type { Footwear, Look } from './look';
import { cm, darken, part, UBOX, USPH } from './parts';

// Clothing styles. Every pattern is drawn from the player's own colour (top colour for prints,
// shoe colour for sandals/slides), so costume styles never override the customisation.

const texCache = new Map<string, THREE.Texture | null>();
function tex(k: string, w: number, h: number, draw: (x: CanvasRenderingContext2D, w: number, h: number) => void): THREE.Texture | null {
  if (!texCache.has(k)) texCache.set(k, typeof document === 'undefined' ? null : canvasTex(w, h, draw));
  return texCache.get(k)!;
}
const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Invented monogram: a rounded diamond with a four-point star, alternating with a dot. No real brand. */
export function monogramTex(color: number): THREE.Texture | null {
  return tex(`mono_${color}`, 128, 128, (x, w, h) => {
    x.fillStyle = css(color);
    x.fillRect(0, 0, w, h);
    const ink = css(shade(color, 1.45));
    const dark = css(shade(color, 0.7));
    const cell = 32;
    for (let r = 0; r < h / cell; r++) {
      for (let c = 0; c < w / cell; c++) {
        const cx = c * cell + (r % 2 ? cell / 2 : 0) + cell / 4;
        const cy = r * cell + cell / 2;
        for (const dx of [0, -w]) {
          const px = cx + dx;
          x.strokeStyle = ink;
          x.lineWidth = 2;
          x.beginPath();
          x.moveTo(px, cy - 9);
          x.quadraticCurveTo(px + 2, cy - 2, px + 9, cy);
          x.quadraticCurveTo(px + 2, cy + 2, px, cy + 9);
          x.quadraticCurveTo(px - 2, cy + 2, px - 9, cy);
          x.quadraticCurveTo(px - 2, cy - 2, px, cy - 9);
          x.stroke();
          x.fillStyle = dark;
          x.beginPath();
          x.arc(px + cell / 2, cy, 2.5, 0, Math.PI * 2);
          x.fill();
        }
      }
    }
  });
}

/** Breton stripes: off-white with stripes in the top colour. */
function stripeTex(color: number): THREE.Texture | null {
  return tex(`ringel_${color}`, 32, 64, (x, w, h) => {
    x.fillStyle = '#efece4';
    x.fillRect(0, 0, w, h);
    x.fillStyle = css(color);
    for (let y = 0; y < h; y += 16) x.fillRect(0, y, w, 7);
  });
}

/**
 * Torso print for jackets as a grey mask (multiplied with the top colour, like the sleeves): zip
 * down the front (u = 0 is the front of the lathe), optional dark yoke and a plain chest patch.
 */
function jacketTex(yoke: boolean): THREE.Texture | null {
  return tex(`jacket_${yoke}`, 128, 128, (x, w, h) => {
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, w, h);
    if (yoke) {
      x.fillStyle = '#9e9e9e';
      x.fillRect(0, 0, w, h * 0.24);
      x.fillRect(w * 0.12, h * 0.3, w * 0.07, h * 0.06);
      const r = mulberry32(5);
      x.fillStyle = 'rgba(0,0,0,.06)';
      for (let i = 0; i < 300; i++) x.fillRect(r() * w, r() * h, 2, 1);
    }
    x.fillStyle = '#5a5a5a';
    x.fillRect(0, 0, 2, h);
    x.fillRect(w - 2, 0, 2, h);
  });
}

export interface TopMats {
  torso: THREE.Material;
  limb: THREE.Material;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(k: string, make: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  let m = matCache.get(k);
  if (!m) matCache.set(k, (m = make()));
  return m;
}

/** Materials for the torso (open lathe, double-sided) and for sleeves/belly. */
export function topMats(L: Look): TopMats {
  const c = L.top;
  const k = `${L.topStyle}_${c}`;
  switch (L.topStyle) {
    case 'monogramm': {
      const map = monogramTex(c);
      const limbMap = map?.clone() ?? null;
      if (limbMap) {
        limbMap.repeat.set(2, 2);
        limbMap.needsUpdate = true;
      }
      map?.repeat.set(5, 4);
      return {
        torso: mat(`${k}_t`, () => new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.55, side: THREE.DoubleSide })),
        limb: mat(`${k}_l`, () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: limbMap, roughness: 0.55 })),
      };
    }
    case 'ringel': {
      const map = stripeTex(c);
      const limbMap = map?.clone() ?? null;
      if (limbMap) {
        limbMap.repeat.set(1, 3);
        limbMap.needsUpdate = true;
      }
      map?.repeat.set(1, 6);
      return {
        torso: mat(`${k}_t`, () => new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.85, side: THREE.DoubleSide })),
        limb: mat(`${k}_l`, () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: limbMap, roughness: 0.85 })),
      };
    }
    case 'trainingsjacke':
    case 'funktion': {
      // The tracksuit's shine is what sells it; the functional jacket is matte.
      const rough = L.topStyle === 'trainingsjacke' ? 0.38 : 0.75;
      const map = jacketTex(L.topStyle === 'funktion');
      return {
        torso: mat(`${k}_t`, () => new THREE.MeshStandardMaterial({ color: c, map, roughness: rough, side: THREE.DoubleSide })),
        limb: cm(c, rough),
      };
    }
    default:
      return { torso: cm(c, 0.85, true), limb: cm(c, 0.85) };
  }
}

const collarGeo = new THREE.TorusGeometry(1, 0.22, 6, 18);
/** Stand-up collar for the jackets, sized to the neck. */
export function addCollar(T: THREE.Object3D, L: Look, neck: number, limb: THREE.Material): void {
  if (L.topStyle !== 'trainingsjacke' && L.topStyle !== 'funktion') return;
  const c = part(T, collarGeo, limb, 0, 0.6, 0, neck * 1.25, neck * 1.25, neck * 1.25 * 0.85);
  c.rotation.x = Math.PI / 2;
}

/**
 * One foot on the floor: `y` is the sole's centre height, `w` the shoe width. Sandals come with
 * white socks, slides show the bare foot.
 */
export function addFoot(root: THREE.Object3D, L: Look, x: number, y: number, z: number, w: number, skin: THREE.Material): void {
  const shoe = cm(L.shoes, 0.55);
  const kind: Footwear = L.footwear ?? 'sneaker';
  if (kind === 'sneaker') {
    // Rounded upper (heel, body, toe cap) on a lighter sole: reads as a shoe, not a brick.
    const bottom = y - 0.035;
    const sole = cm(shade(L.shoes, 1.55), 0.6);
    part(root, USPH, sole, x, bottom + 0.012, z + 0.005, w * 0.56, 0.016, 0.128);
    part(root, USPH, shoe, x, bottom + 0.04, z - 0.055, w * 0.48, 0.05, 0.07);
    part(root, USPH, shoe, x, bottom + 0.032, z + 0.01, w * 0.52, 0.045, 0.115);
    part(root, USPH, shoe, x, bottom + 0.026, z + 0.07, w * 0.47, 0.03, 0.06);
    // Toe cap and lace strip in the sole tone, padded collar at the ankle.
    part(root, USPH, sole, x, bottom + 0.028, z + 0.1, w * 0.4, 0.024, 0.035);
    part(root, UBOX, sole, x, bottom + 0.07, z + 0.025, w * 0.26, 0.006, 0.08).rotation.x = -0.32;
    part(root, USPH, shoe, x, bottom + 0.07, z - 0.05, w * 0.42, 0.025, 0.05);
    return;
  }
  const sole = cm(darken(L.shoes, 0.75), 0.7);
  const bottom = y - 0.035;
  if (kind === 'hausschuhe') {
    part(root, USPH, hairMat('fluff', L.shoes, false), x, bottom + 0.04, z + 0.01, w * 0.62, 0.05, 0.14);
    part(root, UBOX, sole, x, bottom + 0.008, z + 0.01, w * 1.05, 0.016, 0.25);
    return;
  }
  part(root, UBOX, sole, x, bottom + 0.01, z, w * 1.08, 0.02, 0.26);
  if (kind === 'sandalen') {
    part(root, USPH, cm(0xeeeee8, 0.9), x, bottom + 0.04, z, w * 0.5, 0.04, 0.125);
    for (const dz of [-0.03, 0.06]) part(root, UBOX, shoe, x, bottom + 0.05, z + dz, w * 1.02, 0.018, 0.028);
  } else {
    part(root, USPH, skin, x, bottom + 0.035, z, w * 0.46, 0.032, 0.12);
    part(root, UBOX, shoe, x, bottom + 0.045, z + 0.035, w * 1.1, 0.03, 0.1);
  }
}
