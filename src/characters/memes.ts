import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng';
import { canvasTex } from '../scene/textures';
import { monogramTex } from './clothes';
import { hairMat } from './hair';
import { am, pp, shade, texOnce } from './itemkit';
import type { Look } from './look';
import { bone, UBOX, UCYL, USPH, V } from './parts';
import type { Fit } from './rig';
import { shell, taperedTube } from './shell';

// German meme-culture accessories: costumes and objects only, never faces or skin. Clothing pieces
// take the player's hat or accessory colour; nothing carries a real brand, logo or club.

/** What an item may read while building: the wearer's look (colours) and body size. */
export interface ItemCtx {
  look: Look;
  fit: Fit;
}

export type ItemTick = (t: number) => void;

/** Head anchor sits on top of the hair; the skull centre is about this far below it. */
const HC = -0.18;

const cache = new Map<string, THREE.BufferGeometry>();
const geo = (k: string, make: () => THREE.BufferGeometry) => {
  let g = cache.get(k);
  if (!g) cache.set(k, (g = make()));
  return g;
};

/** Crown of a hat: a cap over the head down to polar angle `th`, a bit larger than the hair. */
const crown = (th: number, r = 1) =>
  geo(`crown_${th}_${r}`, () => shell({ phi0: -Math.PI, phi1: Math.PI, th0: () => 0, th1: () => th, r: () => r, segU: 28, segV: 8 }));
const HAT = { rx: 0.165, ry: 0.19, rz: 0.177 };

/** Group for a hat. Hats are modelled on the base head; Person bends them with the face warp. */
const fitted = (_c: ItemCtx) => new THREE.Group();

/** Closed tube through points (strap, chain, belt). */
function loop(pts: THREE.Vector3[], r: number): THREE.BufferGeometry {
  const c = new THREE.CatmullRomCurve3(pts, true);
  return taperedTube(c, 48, 6, () => r);
}

/** Ellipse around the torso at an extent, `out` metres off the surface, with a y offset per angle. */
function around(e: { y: number; x: number; zf: number; zb: number }, out: number, dy: (a: number) => number = () => 0): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const z = Math.cos(a) >= 0 ? e.zf : -e.zb;
    pts.push(V(Math.sin(a) * (e.x + out), e.y + dy(a), Math.cos(a) * (Math.abs(z) + out)));
  }
  return pts;
}

// --- Head ---------------------------------------------------------------------------------------

export function basecap(c: ItemCtx): THREE.Group {
  const g = fitted(c);
  const m = am(c.look.hat, { roughness: 0.8 });
  pp(g, crown(1.2), m, 0, HC, -0.005, HAT.rx, HAT.ry, HAT.rz);
  const brim = pp(g, geo('brim', () => new THREE.CylinderGeometry(1, 1, 1, 18, 1, false, -Math.PI / 2, Math.PI)), m, 0, HC + 0.075, 0.12, 0.12, 0.012, 0.15);
  brim.rotation.x = 0.12;
  pp(g, USPH, m, 0, HC + 0.19, -0.005, 0.014, 0.008, 0.014);
  return g;
}

export function aluhut(c: ItemCtx): THREE.Group {
  const g = fitted(c);
  // Crumpled foil: a cone with random dents, flat-shaded so every crease catches the light.
  const cone = geo('alu', () => {
    const k = new THREE.ConeGeometry(0.16, 0.24, 14, 5, true).translate(0, 0.12, 0).toNonIndexed();
    const r = mulberry32(31);
    const p = k.attributes.position;
    const dents = new Map<string, number>();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!dents.has(key)) dents.set(key, 0.85 + r() * 0.3);
      const d = dents.get(key)!;
      p.setXYZ(i, p.getX(i) * d, p.getY(i) * (0.95 + (d - 0.85) * 0.3), p.getZ(i) * d);
    }
    k.computeVertexNormals();
    return k;
  });
  pp(g, cone, am(0xd8dde4, { metalness: 0.7, roughness: 0.28, flatShading: true, side: THREE.DoubleSide, emissive: 0x1a1c20 }), 0, -0.06, 0);
  return g;
}

/** Ushanka: fluffy round crown, a thick fur roll all around, big ear flaps framing the face. */
export function uschanka(c: ItemCtx): THREE.Group {
  const g = fitted(c);
  const fur = hairMat('fluff', c.look.hat, true);
  const fluffy = (k: number) => (p: number, t: number) => k + 0.035 * Math.sin(13 * p + 2) * Math.sin(9 * t) + 0.02 * Math.sin(29 * p) * Math.sin(17 * t);
  const top = geo('ushTop', () => shell({ phi0: -Math.PI, phi1: Math.PI, th0: () => 0, th1: () => 1.35, r: fluffy(1.14), segU: 40, segV: 12 }));
  // Taller than the head: the real thing is a puffy dome.
  pp(g, top, fur, 0, HC + 0.01, -0.005, HAT.rx, HAT.ry * 1.18, HAT.rz);
  // The folded-up brim: a fat roll, a little higher at the front like the real thing.
  const roll = geo('ushRoll', () => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      pts.push(V(Math.sin(a) * 0.96, 0.12 * Math.max(0, Math.cos(a)) ** 2, Math.cos(a) * 0.96));
    }
    return taperedTube(new THREE.CatmullRomCurve3(pts, true), 48, 10, (t) => 0.24 + 0.03 * Math.sin(t * 60));
  });
  pp(g, roll, fur, 0, HC + 0.19 * Math.cos(1.3), -0.005, HAT.rx, HAT.ry, HAT.rz);
  // Ear flaps: rounded at the bottom, hanging to the jaw, slightly away from the cheeks.
  for (const sx of [-1, 1]) {
    const flap = geo(`ushFlap${sx}`, () =>
      shell({
        phi0: sx > 0 ? 0.95 : -2.35,
        phi1: sx > 0 ? 2.35 : -0.95,
        th0: () => 1.35,
        th1: (p) => 2.5 - 0.9 * ((Math.abs(p) - 1.65) / 0.7) ** 2,
        r: (p, t, _d, v) => 1.16 + 0.05 * Math.sin(Math.PI * v) + 0.02 * Math.sin(11 * p) * Math.sin(7 * t),
        segU: 12,
        segV: 10,
      }),
    );
    pp(g, flap, fur, 0, HC, -0.005, HAT.rx, HAT.ry, HAT.rz);
  }
  return g;
}

export function barett(c: ItemCtx): THREE.Group {
  const g = fitted(c);
  const m = am(c.look.hat, { roughness: 0.95 });
  const b = pp(g, USPH, m, 0.03, -0.035, -0.01, 0.185, 0.05, 0.185);
  b.rotation.z = 0.2;
  pp(g, UCYL, m, 0.04, 0.01, -0.01, 0.006, 0.02, 0.006);
  return g;
}

/** Open-face scooter helmet: glossy shell over ears and nape, leather trim, tinted flip visor. */
export function rollerhelm(c: ItemCtx): THREE.Group {
  const g = fitted(c);
  const shellMat = am(c.look.hat, { roughness: 0.16, metalness: 0.08 });
  // Edge of the face opening per |azimuth|: brow at the front, below the ears at the sides, nape.
  const edge = (p: number) => {
    const a = Math.abs(p);
    return a < 0.9 ? 1.05 + 0.1 * (a / 0.9) ** 2 : a < 1.5 ? 1.15 + 1.0 * ((a - 0.9) / 0.6) : 2.15 + 0.15 * ((a - 1.5) / (Math.PI - 1.5));
  };
  const R = 1.13;
  pp(g, geo('helmShell', () => shell({ phi0: -Math.PI, phi1: Math.PI, th0: () => 0, th1: edge, r: () => R, segU: 48, segV: 16 })), shellMat, 0, HC, -0.005, HAT.rx, HAT.ry, HAT.rz);
  // Leather padding peeking out along the whole edge.
  const trim = geo('helmTrim', () => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 40; i++) {
      const p = -Math.PI + (i / 40) * Math.PI * 2;
      const t = edge(p) - 0.02;
      pts.push(V(Math.sin(p) * Math.sin(t) * (R - 0.03), Math.cos(t) * (R - 0.03), Math.cos(p) * Math.sin(t) * (R - 0.03)));
    }
    return taperedTube(new THREE.CatmullRomCurve3(pts, true), 80, 6, () => 0.03);
  });
  pp(g, trim, am(0x8a5a2e, { roughness: 0.8 }), 0, HC, -0.005, HAT.rx, HAT.ry, HAT.rz);
  // Centre stripe in the accessory colour.
  const stripe = geo('helmstripe', () => shell({ phi0: -0.1, phi1: 0.1, th0: () => -1.25, th1: () => 1.25, r: () => R + 0.005, segU: 3, segV: 16 }));
  pp(g, stripe, am(c.look.acc, { roughness: 0.3 }), 0, HC, -0.005, HAT.rx, HAT.ry, HAT.rz);
  // Tinted visor down to the nose, hinged at both sides.
  const visor = geo('helmVisor', () => shell({ phi0: -1.35, phi1: 1.35, th0: () => 1.0, th1: (p) => 1.95 - 0.25 * (p / 1.35) ** 2, r: () => R + 0.1, segU: 24, segV: 8 }));
  pp(g, visor, am(0xc89a5a, { roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }), 0, HC, -0.005, HAT.rx, HAT.ry, HAT.rz);
  const chrome = am(0xd0d4da, { metalness: 0.9, roughness: 0.2 });
  for (const sx of [-1, 1]) {
    const hinge = pp(g, UCYL, chrome, sx * HAT.rx * 1.2, HC + 0.005, 0.0, 0.03, 0.012, 0.03);
    hinge.rotation.z = (sx * Math.PI) / 2;
    pp(g, UBOX, am(0x2a2420), sx * 0.14, HC - 0.12, 0.04, 0.008, 0.1, 0.012);
  }
  return g;
}

export function zipfelmuetze(c: ItemCtx): THREE.Group {
  const g = fitted(c);
  const m = am(c.look.hat, { roughness: 0.9 });
  const tube = geo('zipfel', () => {
    const curve = new THREE.CatmullRomCurve3([V(0, -0.04, 0), V(0, 0.08, -0.01), V(0.02, 0.2, -0.04), V(0.1, 0.27, -0.07), V(0.17, 0.26, -0.08)]);
    return taperedTube(curve, 30, 14, (t) => 0.17 * (1 - t) ** 1.3 + 0.006);
  });
  pp(g, tube, m, 0, HC + 0.14, -0.005);
  pp(g, USPH, hairMat('fluff', 0xf2f2ee, false), 0.17, HC + 0.4, -0.085, 0.03, 0.03, 0.03);
  return g;
}

// --- Hand ---------------------------------------------------------------------------------------

export function baguette(): THREE.Group {
  const g = new THREE.Group();
  const tex = texOnce('baguette', () =>
    canvasTex(64, 128, (x, w, h) => {
      x.fillStyle = '#c98a3e';
      x.fillRect(0, 0, w, h);
      x.strokeStyle = '#f0d39a';
      x.lineWidth = 5;
      for (let y = 14; y < h; y += 26) {
        x.beginPath();
        x.moveTo(8, y + 10);
        x.lineTo(w - 8, y);
        x.stroke();
      }
    }),
  );
  const b = pp(g, USPH, am(0xffffff, { map: tex, roughness: 0.8 }), 0, 0.1, 0, 0.035, 0.32, 0.035);
  b.rotation.x = 0.5;
  return g;
}

export function espresso(): THREE.Group {
  const g = new THREE.Group();
  const white = am(0xf4f2ec, { roughness: 0.3 });
  pp(g, geo('cup', () => new THREE.CylinderGeometry(0.03, 0.022, 0.045, 14, 1, true).translate(0, 0.0225, 0)), white, 0, 0.02, 0);
  pp(g, UCYL, white, 0, 0.012, 0, 0.022, 0.01, 0.022);
  pp(g, UCYL, am(0x2a160c, { roughness: 0.2 }), 0, 0.058, 0, 0.026, 0.003, 0.026);
  pp(g, geo('handle', () => new THREE.TorusGeometry(0.012, 0.004, 5, 10)), white, 0.035, 0.045, 0);
  pp(g, UCYL, white, 0, 0.004, 0, 0.055, 0.006, 0.055);
  return g;
}

export function pizza(): THREE.Group {
  const g = new THREE.Group();
  const tex = texOnce('pizza', () =>
    canvasTex(128, 128, (x, w, h) => {
      x.fillStyle = '#d8c39a';
      x.fillRect(0, 0, w, h);
      x.strokeStyle = '#b5532a';
      x.lineWidth = 4;
      x.beginPath();
      x.arc(w / 2, h / 2, 36, 0, Math.PI * 2);
      x.stroke();
      x.fillStyle = '#b5532a';
      x.font = 'bold 20px sans-serif';
      x.textAlign = 'center';
      x.fillText('PIZZA', w / 2, h / 2 + 7);
    }),
  );
  pp(g, UBOX, am(0xffffff, { map: tex, roughness: 0.9 }), 0, 0.03, 0.1, 0.33, 0.045, 0.33);
  return g;
}

export function thermos(c: ItemCtx): THREE.Group {
  const g = new THREE.Group();
  pp(g, UCYL, am(c.look.acc, { roughness: 0.35, metalness: 0.3 }), 0, -0.08, 0, 0.038, 0.24, 0.038);
  pp(g, UCYL, am(0xb8bcc4, { metalness: 0.8, roughness: 0.3 }), 0, 0.16, 0, 0.04, 0.06, 0.04);
  return g;
}

/** Plain amber bottle with a blank label, the generic "mate" look. */
export function mate(): THREE.Group {
  const g = new THREE.Group();
  const glass = am(0x7a4a14, { roughness: 0.15, metalness: 0.1 });
  pp(g, UCYL, glass, 0, -0.07, 0, 0.033, 0.15, 0.033);
  pp(g, USPH, glass, 0, 0.08, 0, 0.028, 0.035, 0.028);
  pp(g, UCYL, glass, 0, 0.09, 0, 0.012, 0.08, 0.012);
  pp(g, UCYL, am(0xc2c6cc, { metalness: 0.7, roughness: 0.3 }), 0, 0.17, 0, 0.0145, 0.012, 0.0145);
  pp(g, UCYL, am(0xf0e6b0, { roughness: 0.7 }), 0, -0.04, 0, 0.0335, 0.06, 0.0335);
  return g;
}

/** Tall black can with a neon zig-zag; deliberately no claw or lettering. */
export function energy(): THREE.Group {
  const g = new THREE.Group();
  const tex = texOnce('energy', () =>
    canvasTex(64, 128, (x, w, h) => {
      x.fillStyle = '#121414';
      x.fillRect(0, 0, w, h);
      x.strokeStyle = '#7dff3a';
      x.lineWidth = 6;
      x.beginPath();
      for (let i = 0; i <= 8; i++) x.lineTo((i / 8) * w, h * 0.5 + (i % 2 ? -14 : 14));
      x.stroke();
    }),
  );
  pp(g, UCYL, am(0xffffff, { map: tex, roughness: 0.35, metalness: 0.3, emissive: 0x0a1a05 }), 0, -0.08, 0, 0.03, 0.17, 0.03);
  pp(g, UCYL, am(0xb8bcc4, { metalness: 0.8, roughness: 0.3 }), 0, 0.09, 0, 0.027, 0.008, 0.027);
  return g;
}

export function bratwurst(): THREE.Group {
  const g = new THREE.Group();
  const bun = pp(g, USPH, am(0xd9a35a, { roughness: 0.85 }), 0, 0.05, 0, 0.03, 0.09, 0.032);
  const wurst = pp(g, USPH, am(0x8a4a2a, { roughness: 0.5 }), 0, 0.05, 0.014, 0.02, 0.12, 0.02);
  const senf = pp(g, USPH, am(0xe2b51e, { roughness: 0.5 }), 0, 0.05, 0.03, 0.006, 0.09, 0.006);
  for (const m of [bun, wurst, senf]) m.rotation.x = 0.35;
  return g;
}

export function lauch(): THREE.Group {
  const g = new THREE.Group();
  pp(g, UCYL, am(0xeef0dc, { roughness: 0.6 }), 0, -0.12, 0, 0.026, 0.2, 0.026);
  pp(g, UCYL, am(0x9ac25a, { roughness: 0.6 }), 0, 0.08, 0, 0.024, 0.1, 0.024);
  const leaf = am(0x3f7a2c, { roughness: 0.6, side: THREE.DoubleSide });
  for (let k = 0; k < 4; k++) {
    const l = pp(g, UBOX, leaf, 0, 0.27, 0, 0.04, 0.22, 0.004);
    l.rotation.order = 'YXZ';
    l.rotation.y = (k / 4) * Math.PI;
    l.rotation.x = 0.2 * (k % 2 ? 1 : -1);
  }
  return g;
}

export function kartoffel(): THREE.Group {
  const g = new THREE.Group();
  const lumpy = geo('kartoffel', () =>
    shell({ phi0: -Math.PI, phi1: Math.PI, th0: () => 0, th1: () => Math.PI, r: (p, t) => 1 + 0.08 * Math.sin(3 * p + 1) * Math.sin(2 * t) + 0.05 * Math.sin(5 * p) * Math.sin(t), segU: 16, segV: 10 }),
  );
  pp(g, lumpy, am(0xb08a52, { roughness: 0.95 }), 0, 0.05, 0, 0.05, 0.04, 0.07);
  return g;
}

export function sparschwein(): THREE.Group {
  const g = new THREE.Group();
  const pink = am(0xf0a0b4, { roughness: 0.35 });
  pp(g, USPH, pink, 0, 0.07, 0, 0.065, 0.06, 0.085);
  pp(g, UCYL, pink, 0, 0.065, 0.08, 0.025, 0.025, 0.025).rotation.x = Math.PI / 2;
  for (const sx of [-1, 1]) {
    pp(g, UCYL, pink, sx * 0.035, 0, sx * 0.035 + 0.0, 0.012, 0.03, 0.012);
    pp(g, UCYL, pink, sx * 0.035, 0, -sx * 0.035, 0.012, 0.03, 0.012);
    pp(g, geo('pigEar', () => new THREE.ConeGeometry(0.018, 0.03, 4)), pink, sx * 0.03, 0.125, 0.045);
    pp(g, USPH, am(0x1a1a1a), sx * 0.025, 0.09, 0.07, 0.006, 0.006, 0.006);
  }
  pp(g, UBOX, am(0x3a2026), 0, 0.13, 0, 0.004, 0.003, 0.03);
  return g;
}

// --- Arm ----------------------------------------------------------------------------------------

export function gelberSack(): THREE.Group {
  const g = new THREE.Group();
  const lumpy = geo('sack', () =>
    shell({ phi0: -Math.PI, phi1: Math.PI, th0: () => 0, th1: () => Math.PI, r: (p, t) => 1 + 0.1 * Math.sin(4 * p) * Math.sin(3 * t) * Math.sin(t), segU: 16, segV: 10 }),
  );
  const m = am(0xf2d22a, { roughness: 0.3, transparent: true, opacity: 0.82, emissive: 0x2a2200 });
  pp(g, lumpy, m, 0, -0.28, 0, 0.13, 0.18, 0.1);
  pp(g, geo('knot', () => new THREE.ConeGeometry(0.03, 0.08, 6)), m, 0, -0.07, 0).rotation.x = Math.PI;
  return g;
}

// --- Neck / body -------------------------------------------------------------------------------

export function goldkette(c: ItemCtx): THREE.Group {
  const g = new THREE.Group();
  const e = c.fit.neck;
  // Lies on the shoulders and hangs in a shallow V on the chest; the anchor sits at this height.
  const pts = around({ ...e, y: 0.01 }, 0.012, (a) => -0.045 * Math.max(0, Math.cos(a)) ** 2);
  const gold = am(0xd9ad38, { metalness: 0.85, roughness: 0.25, emissive: 0x221500 });
  pp(g, loop(pts, 0.0075), gold, 0, 0, 0);
  pp(g, UCYL, gold, 0, -0.05, e.zf + 0.022, 0.018, 0.006, 0.018).rotation.x = Math.PI / 2 - 0.3;
  return g;
}

export function schal(c: ItemCtx): THREE.Group {
  const g = new THREE.Group();
  const col = c.look.acc;
  const tex = texOnce(`schal_${col}`, () =>
    canvasTex(32, 128, (x, w, h) => {
      x.fillStyle = `#${col.toString(16).padStart(6, '0')}`;
      x.fillRect(0, 0, w, h);
      x.fillStyle = '#efece4';
      for (let y = 0; y < h; y += 32) x.fillRect(0, y, w, 12);
    }),
  );
  const m = am(0xffffff, { map: tex, roughness: 0.95 });
  pp(g, loop(around({ ...c.fit.neck, y: 0.01 }, 0.012), 0.028), m, 0, 0, 0);
  for (const sx of [-1, 1]) {
    const end = pp(g, UBOX, m, sx * 0.05, -0.17, c.fit.neck.zf + 0.04, 0.07, 0.3, 0.02);
    end.rotation.set(-0.12, 0, sx * 0.08);
  }
  return g;
}

export function bauchtasche(c: ItemCtx): THREE.Group {
  const g = new THREE.Group();
  const e = c.fit.belly;
  const m = am(c.look.acc, { roughness: 0.6 });
  pp(g, loop(around(e, 0.008), 0.009), m, 0, 0, 0);
  pp(g, USPH, m, 0, e.y, e.zf + 0.04, 0.13, 0.065, 0.05);
  pp(g, UBOX, am(0x111111, { metalness: 0.5, roughness: 0.4 }), 0, e.y + 0.02, e.zf + 0.09, 0.16, 0.006, 0.006);
  return g;
}

/** Crossbody bag: strap from the left shoulder to the right hip, pouch on the chest with the invented monogram. */
export function umhaengetasche(c: ItemCtx): THREE.Group {
  const g = new THREE.Group();
  const ch = c.fit.chest;
  const be = c.fit.belly;
  const n = c.fit.neck;
  const m = am(shade(c.look.acc, 0.8), { roughness: 0.6 });
  const pts = [
    V(-n.x * 0.75, n.y + 0.02, 0),
    V(-ch.x * 0.35, ch.y + 0.08, ch.zf + 0.012),
    V(ch.x * 0.2, (ch.y + be.y) / 2, Math.max(ch.zf, be.zf) + 0.014),
    V(be.x + 0.012, be.y + 0.02, 0),
    V(ch.x * 0.2, (ch.y + be.y) / 2, ch.zb - 0.014),
    V(-ch.x * 0.35, ch.y + 0.08, ch.zb - 0.012),
  ];
  pp(g, loop(pts, 0.008), m, 0, 0, 0);
  const tex = monogramTex(c.look.acc);
  const pouch = pp(g, UBOX, am(0xffffff, { map: tex, roughness: 0.5 }), -ch.x * 0.15, ch.y + 0.02, ch.zf + 0.04, 0.17, 0.11, 0.05);
  pouch.rotation.z = 0.25;
  return g;
}

// --- Floor --------------------------------------------------------------------------------------

/** Beer crate with twenty capped bottles, blank sides, no brewery. */
export function kasten(c: ItemCtx): THREE.Group {
  const g = new THREE.Group();
  const crate = am(c.look.acc, { roughness: 0.55 });
  pp(g, UBOX, crate, 0, 0.13, 0, 0.3, 0.26, 0.4);
  pp(g, UBOX, am(0x0c0c0c, { roughness: 1 }), 0, 0.262, 0, 0.27, 0.004, 0.37);
  for (const sz of [-1, 1]) pp(g, UBOX, am(0x0c0c0c, { roughness: 1 }), 0, 0.22, sz * 0.201, 0.12, 0.03, 0.004);
  const necks = geo('necks', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 5; j++) parts.push(new THREE.CylinderGeometry(0.011, 0.016, 0.07, 8).translate(-0.105 + i * 0.07, 0.29, -0.15 + j * 0.075));
    return mergeGeometries(parts)!;
  });
  pp(g, necks, am(0x5b3213, { roughness: 0.2 }), 0, 0, 0);
  const caps = geo('caps', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 5; j++) parts.push(new THREE.CylinderGeometry(0.013, 0.013, 0.01, 8).translate(-0.105 + i * 0.07, 0.328, -0.15 + j * 0.075));
    return mergeGeometries(parts)!;
  });
  pp(g, caps, am(0xd4a82a, { metalness: 0.6, roughness: 0.3 }), 0, 0, 0);
  g.rotation.y = 0.15;
  return g;
}

/** Sitting golden retriever, looking up, wagging, with a collar in the accessory colour. */
export function hund(c: ItemCtx): THREE.Group {
  const g = new THREE.Group();
  const fur = hairMat('strand', 0xd6a052, false);
  const furLight = hairMat('strand', 0xe8c07a, false);
  const dark = am(0x1a1210, { roughness: 0.3 });
  const body = pp(g, USPH, fur, 0, 0.21, -0.03, 0.105, 0.17, 0.12);
  body.rotation.x = -0.35;
  pp(g, USPH, furLight, 0, 0.28, 0.07, 0.085, 0.11, 0.075);
  for (const sx of [-1, 1]) {
    pp(g, USPH, fur, sx * 0.075, 0.08, -0.06, 0.07, 0.075, 0.11);
    pp(g, USPH, fur, sx * 0.085, 0.02, 0.05, 0.035, 0.022, 0.065);
    bone(g, V(sx * 0.045, 0.02, 0.11), V(sx * 0.045, 0.26, 0.07), 0.028, furLight).userData.role = 'prop';
    pp(g, USPH, furLight, sx * 0.045, 0.018, 0.125, 0.03, 0.02, 0.04);
  }
  const collar = pp(g, geo('collar', () => new THREE.TorusGeometry(0.062, 0.011, 6, 18)), am(c.look.acc, { roughness: 0.5 }), 0, 0.355, 0.07);
  collar.rotation.x = Math.PI / 2 - 0.4;

  const head = new THREE.Group();
  head.position.set(0, 0.43, 0.1);
  g.add(head);
  pp(head, USPH, fur, 0, 0, 0, 0.072, 0.068, 0.078);
  pp(head, USPH, furLight, 0, -0.022, 0.07, 0.044, 0.038, 0.06);
  pp(head, USPH, dark, 0, -0.008, 0.128, 0.017, 0.013, 0.012);
  for (const sx of [-1, 1]) {
    pp(head, USPH, dark, sx * 0.033, 0.02, 0.062, 0.01, 0.011, 0.008);
    const ear = pp(head, USPH, fur, sx * 0.068, -0.025, -0.005, 0.022, 0.06, 0.045);
    ear.rotation.z = sx * 0.3;
  }
  // A little tongue out: the panting, happy dog look.
  pp(head, USPH, am(0xe0788a, { roughness: 0.6 }), 0, -0.058, 0.1, 0.018, 0.005, 0.024);

  const tail = new THREE.Group();
  tail.position.set(0, 0.06, -0.15);
  g.add(tail);
  const tg = geo('tail', () => taperedTube(new THREE.CatmullRomCurve3([V(0, 0, 0), V(0.03, -0.03, -0.1), V(0.1, -0.05, -0.15), V(0.18, -0.05, -0.12)]), 16, 8, (t) => 0.025 * (1 - t) + 0.008));
  pp(tail, tg, fur, 0, 0, 0);

  const tick: ItemTick = (t) => {
    tail.rotation.y = 0.45 * Math.sin(t * 9);
    head.rotation.z = 0.22 * Math.sin(t * 0.8);
    head.rotation.x = -0.15 + 0.05 * Math.sin(t * 1.7);
    body.scale.y = 0.17 * (1 + 0.02 * Math.sin(t * 6));
  };
  g.userData.tick = tick;
  return g;
}

export function gartenzwerg(c: ItemCtx): THREE.Group {
  const g = new THREE.Group();
  pp(g, USPH, am(c.look.acc, { roughness: 0.4 }), 0, 0.12, 0, 0.075, 0.1, 0.065);
  pp(g, UCYL, am(0x2a1d14, { roughness: 0.4 }), 0, 0.1, 0, 0.073, 0.018, 0.068);
  for (const sx of [-1, 1]) pp(g, USPH, am(0x2a1d14, { roughness: 0.4 }), sx * 0.035, 0.015, 0.02, 0.03, 0.02, 0.045);
  pp(g, USPH, am(0xf0c0a0, { roughness: 0.4 }), 0, 0.24, 0, 0.05, 0.05, 0.05);
  pp(g, USPH, am(0xf0c0a0, { roughness: 0.4 }), 0, 0.235, 0.05, 0.014, 0.014, 0.014);
  pp(g, geo('gnomeBeard', () => new THREE.ConeGeometry(0.045, 0.1, 10).rotateX(Math.PI)), am(0xf4f4f0, { roughness: 0.6 }), 0, 0.18, 0.03);
  pp(g, geo('gnomeHat', () => new THREE.ConeGeometry(0.055, 0.16, 12).translate(0, 0.08, 0)), am(c.look.hat, { roughness: 0.4 }), 0, 0.265, -0.005).rotation.x = -0.25;
  g.rotation.y = -0.3;
  return g;
}

/** Waste separation: yellow, blue and brown bin, the German classic. */
export function muell(): THREE.Group {
  const g = new THREE.Group();
  [0xe8c21e, 0x2c5fd6, 0x6a4a2a].forEach((col, i) => {
    const x = (i - 1) * 0.13;
    pp(g, UBOX, am(col, { roughness: 0.5 }), x, 0.11, 0, 0.11, 0.22, 0.13);
    pp(g, UBOX, am(0x222222, { roughness: 0.5 }), x, 0.228, -0.005, 0.12, 0.016, 0.14);
  });
  g.rotation.y = 0.2;
  return g;
}
