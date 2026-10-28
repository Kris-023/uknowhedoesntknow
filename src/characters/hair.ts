import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LOOKS } from '../config';
import { mulberry32 } from '../core/rng';
import { canvasTex } from '../scene/textures';
import { CUT_Y, HEAD_C } from './face';
import type { Beard, HairStyle, Look } from './look';
import { darken, part } from './parts';
import { shell, surface, table, taperedTube } from './shell';

// Hair and beards: parametric shells (one mesh per piece) with procedural strand/curl/knit
// textures used as colour and bump map. Textures are grey and cached per kind; the hair colour is
// the material colour, so a new colour costs a material, never a texture.

type TexKind = 'strand' | 'curl' | 'knit' | 'beard' | 'stubble' | 'fluff';

/** Draw `n` times with horizontal wrap-around, so the texture tiles around the head without a seam. */
function wrapped(w: number, draw: (dx: number) => void): void {
  for (const dx of [-w, 0, w]) draw(dx);
}

const DRAW: Record<TexKind, { w: number; h: number; rep: [number, number]; draw: (x: CanvasRenderingContext2D, w: number, h: number) => void }> = {
  // Long strands running down from the crown, with light and dark streaks.
  strand: {
    w: 256,
    h: 256,
    rep: [3, 1],
    draw: (x, w, h) => {
      const r = mulberry32(11);
      x.fillStyle = '#c4c4c4';
      x.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        const sx = r() * w;
        const v = Math.floor(150 + r() * 105);
        const amp = 2 + r() * 4;
        const ph = r() * 6;
        x.strokeStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.35})`;
        x.lineWidth = 0.8 + r() * 1.6;
        wrapped(w, (dx) => {
          x.beginPath();
          for (let y = 0; y <= h; y += 16) {
            const px = sx + dx + Math.sin(y / 40 + ph) * amp;
            if (y === 0) x.moveTo(px, y);
            else x.lineTo(px, y);
          }
          x.stroke();
        });
      }
    },
  },
  // Ringlets: small spiral arcs with a highlight and a shadow side.
  curl: {
    w: 256,
    h: 256,
    rep: [3, 1.5],
    draw: (x, w, h) => {
      const r = mulberry32(23);
      x.fillStyle = '#9a9a9a';
      x.fillRect(0, 0, w, h);
      for (let i = 0; i < 380; i++) {
        const cx = r() * w;
        const cy = r() * h;
        const rad = 5 + r() * 6;
        const a0 = r() * Math.PI * 2;
        wrapped(w, (dx) => {
          x.lineWidth = 3.2;
          x.strokeStyle = 'rgba(60,60,60,.4)';
          x.beginPath();
          x.arc(cx + dx + 1.2, cy + 1.5, rad, a0, a0 + 4.2);
          x.stroke();
          x.lineWidth = 2.4;
          x.strokeStyle = `rgba(225,225,225,${0.35 + r() * 0.35})`;
          x.beginPath();
          x.arc(cx + dx, cy, rad, a0, a0 + 4.2);
          x.stroke();
        });
      }
    },
  },
  // Knitted rib: columns of V stitches.
  knit: {
    w: 128,
    h: 128,
    rep: [4, 2],
    draw: (x, w, h) => {
      x.fillStyle = '#6a6a6a';
      x.fillRect(0, 0, w, h);
      const cw = 8;
      const ch = 8;
      for (let cx = 0; cx < w; cx += cw) {
        for (let cy = 0; cy < h; cy += ch) {
          for (const [sx, c] of [[-1, '#e8e8e8'], [1, '#cfcfcf']] as const) {
            x.fillStyle = c;
            x.beginPath();
            x.ellipse(cx + cw / 2 + (sx * cw) / 4, cy + ch / 2, cw / 4.2, ch / 1.7, sx * -0.5, 0, Math.PI * 2);
            x.fill();
          }
        }
      }
    },
  },
  // Short, dense, mostly downward hairs.
  beard: {
    w: 128,
    h: 128,
    rep: [3, 1],
    draw: (x, w, h) => {
      const r = mulberry32(37);
      x.fillStyle = '#9a9a9a';
      x.fillRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) {
        const px = r() * w;
        const py = r() * h;
        const a = Math.PI / 2 + (r() - 0.5) * 1.2;
        const l = 3 + r() * 6;
        const v = Math.floor(70 + r() * 185);
        x.strokeStyle = `rgba(${v},${v},${v},.8)`;
        x.lineWidth = 1;
        wrapped(w, (dx) => {
          x.beginPath();
          x.moveTo(px + dx, py);
          x.lineTo(px + dx + Math.cos(a) * l, py + Math.sin(a) * l);
          x.stroke();
        });
      }
    },
  },
  // Stubble: transparent with fine dots; the material colour tints them.
  stubble: {
    w: 128,
    h: 128,
    rep: [4, 1],
    draw: (x, w, h) => {
      const r = mulberry32(53);
      // A faint shadow tint plus dots; both fade out towards the shell's edges (canvas top and bottom).
      const fade = (y: number) => smooth01(0, 0.25, y / h) * smooth01(1, 0.8, y / h);
      for (let y = 0; y < h; y++) {
        x.fillStyle = `rgba(255,255,255,${0.3 * fade(y)})`;
        x.fillRect(0, y, w, 1);
      }
      for (let i = 0; i < 2600; i++) {
        const py = r() * h;
        x.fillStyle = `rgba(255,255,255,${(0.5 + r() * 0.5) * fade(py)})`;
        x.fillRect(r() * w, py, 1 + r(), 1 + r());
      }
    },
  },
  // Fluffy wool for the beanie's pompom.
  fluff: {
    w: 64,
    h: 64,
    rep: [2, 1],
    draw: (x, w, h) => {
      const r = mulberry32(71);
      x.fillStyle = '#b0b0b0';
      x.fillRect(0, 0, w, h);
      for (let i = 0; i < 500; i++) {
        const v = Math.floor(140 + r() * 115);
        x.fillStyle = `rgba(${v},${v},${v},.7)`;
        x.beginPath();
        x.arc(r() * w, r() * h, 1 + r() * 2, 0, Math.PI * 2);
        x.fill();
      }
    },
  },
};

const texCache = new Map<TexKind, THREE.Texture | null>();
function hairTex(kind: TexKind): THREE.Texture | null {
  let t = texCache.get(kind);
  if (t === undefined) {
    // Unit tests build rigs in plain Node without a canvas; they don't need textures.
    const d = DRAW[kind];
    t = typeof document === 'undefined' ? null : canvasTex(d.w, d.h, d.draw);
    t?.repeat.set(...d.rep);
    texCache.set(kind, t);
  }
  return t;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
/** Textured hair material, cached per texture kind + colour. Hair shells are open, hence double-sided. */
export function hairMat(kind: TexKind, color: number, double = true): THREE.MeshStandardMaterial {
  const k = `${kind}_${color}_${double}`;
  let m = matCache.get(k);
  if (!m) {
    const map = hairTex(kind);
    m =
      kind === 'stubble'
        ? new THREE.MeshStandardMaterial({ color, map, transparent: true, opacity: LOOKS.stubbleOpacity, depthWrite: false, roughness: 0.9, metalness: 0 })
        : new THREE.MeshStandardMaterial({
            color,
            map,
            bumpMap: map,
            bumpScale: LOOKS.hairBump,
            roughness: kind === 'knit' || kind === 'fluff' ? 0.95 : 0.7,
            metalness: 0.02,
            side: double ? THREE.DoubleSide : THREE.FrontSide,
          });
    matCache.set(k, m);
  }
  return m;
}

// --- Hair -------------------------------------------------------------------------------------

/** Hair ellipsoid (a little larger than the head) that the hair shells are built on. */
const HAIR = { y: 0.2, z: -0.005, rx: 0.152, ry: 0.176, rz: 0.162 };
const CURL = { y: 0.205, z: -0.012, rx: 0.162, ry: 0.186, rz: 0.172 };
/** Lowest point of skull hair in unit space: just above the mouth plane, so it never hangs into the open mouth. */
const minY = (c: { y: number; ry: number }) => (CUT_Y + 0.004 - c.y) / c.ry;

const smooth01 = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Hairline per |azimuth| (0 front, PI back): forehead, temples, sideburn, behind the ear, nape. */
const LINE = {
  kurz: table([[0, 1.02], [0.5, 1.1], [1.05, 1.4], [1.35, 1.8], [1.62, 1.62], [2.2, 1.98], [Math.PI, 2.15]]),
  lang: table([[0, 0.98], [0.6, 1.12], [1.1, 1.6], [1.6, 1.95], [Math.PI, 2.15]]),
  dutt: table([[0, 1.04], [0.6, 1.14], [1.2, 1.52], [1.5, 1.72], [Math.PI, 2.12]]),
  locken: table([[0, 1.06], [0.7, 1.22], [1.3, 1.78], [1.75, 1.8], [Math.PI, 2.1]]),
};

/** Rim pulled in towards the scalp, so the hairline hugs the skin instead of standing off as a ledge. */
const rim = (v: number, k = 0.04) => 1 - k * smooth01(0.7, 1, v);

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(k: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = make()));
  return g;
}

const backness = (phi: number) => (1 - Math.cos(phi)) / 2;

function capGeo(style: 'kurz' | 'lang' | 'dutt' | 'fuzz'): THREE.BufferGeometry {
  return cached(`cap_${style}`, () => {
    const line = style === 'fuzz' ? LINE.kurz : LINE[style];
    const vol = { kurz: 0.035, lang: 0, dutt: 0.0, fuzz: -0.02 }[style];
    return shell({
      phi0: -Math.PI,
      phi1: Math.PI,
      th0: () => 0,
      // A slightly ragged edge reads as hair ends rather than a cut-off cap.
      th1: (phi) => line(Math.abs(phi)),
      // Long hair keeps its full radius at the back, where the curtain continues it.
      r: (phi, th, _d, v) => (1 + vol * backness(phi) * Math.sin(th) + 0.025 * Math.max(0, Math.cos(th))) * rim(v, style === 'lang' ? 0.04 * (1 - backness(phi)) : 0.04),
      minY: minY(HAIR),
      segU: 64,
      segV: 14,
    });
  });
}

/** Curls: the cap carries ~180 round bumps (one shell, not 180 spheres) plus a curl texture on top. */
/** `amp`: curl height; small under a hat, where the curls only show below the brim. */
function curlGeo(amp = 0.15): THREE.BufferGeometry {
  return cached(`locken_${amp}`, () => {
    const r = mulberry32(97);
    const N = 190;
    const bumps: { d: THREE.Vector3; a: number; s: number }[] = [];
    for (let i = 0; i < N; i++) {
      // Fibonacci sphere with jitter: even coverage without a visible pattern.
      const y = 1 - (2 * (i + 0.5)) / N;
      const rr = Math.sqrt(1 - y * y);
      const ph = i * 2.39996 + (r() - 0.5) * 0.5;
      const d = new THREE.Vector3(Math.sin(ph) * rr, y + (r() - 0.5) * 0.06, Math.cos(ph) * rr).normalize();
      bumps.push({ d, a: 0.6 + r() * 0.4, s: 0.03 + r() * 0.025 });
    }
    return shell({
      phi0: -Math.PI,
      phi1: Math.PI,
      th0: () => 0,
      // A gentle wave along the rim: curls end in soft scallops, not a zigzag.
      th1: (phi) => LINE.locken(Math.abs(phi)) + 0.035 * Math.sin(phi * 7 + 1),
      r: (phi, _th, d, v) => {
        let m = 0;
        for (const b of bumps) {
          const k = 1 - (1 - d.dot(b.d)) / b.s;
          if (k > 0) m = Math.max(m, b.a * k * k);
        }
        return (1.0 + 0.03 * backness(phi) + amp * m) * rim(v, 0.06);
      },
      minY: minY(CURL),
      segU: 72,
      segV: 30,
    });
  });
}

/**
 * Long hair: an outer layer from the crown down the back and sides, open at the face. Split at the
 * mouth plane: the upper part flips open with the skull, the lower part hangs from the jaw.
 */
function curtainGeo(part: 'top' | 'bottom'): THREE.BufferGeometry {
  return cached(`curtain_${part}`, () => {
    const a0 = 1.2;
    const top = HAIR.y + HAIR.ry;
    return surface(40, part === 'top' ? 14 : 12, (u, t) => {
      const phi = a0 + (Math.PI * 2 - 2 * a0) * u;
      const b = backness(phi);
      const len = 0.49 + 0.12 * b;
      const vCut = (top - CUT_Y) / len;
      const v = part === 'top' ? t * vCut : vCut + t * (1 - vCut);
      const y = top - v * len;
      // Lies on the cap, then falls straight where the cap curves in: one layer, no ledge.
      const cap = (r: number) => 1.03 * r * Math.sqrt(Math.max(0, 1 - ((y - HAIR.y) / HAIR.ry) ** 2));
      const fall = Math.sqrt(Math.max(0, (HAIR.y - y) / 0.4));
      const below = y < HAIR.y ? 1 : 0;
      const rx = Math.max(cap(HAIR.rx), (0.155 + 0.03 * fall) * below);
      const rz = Math.max(cap(HAIR.rz), (0.166 + 0.02 * fall - 0.03 * v * b) * below);
      // Soft wave at the ends instead of a straight cut.
      const yy = y - (part === 'bottom' ? t * t * 0.015 * Math.sin(phi * 9) : 0);
      return new THREE.Vector3(Math.sin(phi) * rx, yy, Math.cos(phi) * rz + HAIR.z);
    });
  });
}

/** Bun with spiral grooves in the geometry itself. */
function bunGeo(): THREE.BufferGeometry {
  return cached('bun', () =>
    shell({ phi0: -Math.PI, phi1: Math.PI, th0: () => 0, th1: () => Math.PI, r: (phi, th) => 1 + 0.09 * Math.sin(5 * phi + 7 * th) * Math.sin(th), segU: 32, segV: 16 }),
  );
}

function pompomGeo(): THREE.BufferGeometry {
  return cached('pompom', () =>
    shell({
      phi0: -Math.PI,
      phi1: Math.PI,
      th0: () => 0,
      th1: () => Math.PI,
      r: (phi, th) => 1 + 0.08 * Math.sin(9 * phi) * Math.sin(7 * th) * Math.sin(th) + 0.05 * Math.sin(13 * phi + 3 * th) * Math.sin(th),
      segU: 24,
      segV: 12,
    }),
  );
}

/** Mohawk crest: a row of flattened gel spikes from forehead to nape, fused into one mesh. */
function crestGeo(): THREE.BufferGeometry {
  return cached('crest', () => {
    const spikes: THREE.BufferGeometry[] = [];
    const n = 8;
    for (let i = 0; i < n; i++) {
      // s = polar angle along the midline, negative towards the forehead.
      const s = -0.75 + (2.45 * i) / (n - 1);
      const len = 0.15 - 0.045 * Math.abs(s - 0.4);
      const g = new THREE.ConeGeometry(0.05, len, 8, 3).translate(0, len / 2, 0);
      // Flat from the side, swept back a little like gelled hair.
      g.scale(0.32, 1, 1);
      g.rotateX(-s - 0.3);
      g.translate(0, 0.2 + Math.cos(s) * 0.155, Math.sin(-s) * 0.15 - 0.005);
      spikes.push(g);
    }
    return mergeGeometries(spikes)!;
  });
}

const ringGeo = new THREE.TorusGeometry(0.148, 0.024, 8, 24);

/** Height of the hair's top in head space, where head items sit. */
export const HAIR_TOP: Record<HairStyle, number> = { kurz: 0.372, lang: 0.372, dutt: 0.368, irokese: 0.37, locken: 0.395, muetze: 0.42 };

/**
 * Hair on the skull `S` (flips open with the mouth); long strands hang from the jaw side `H`.
 * Returns the material used on the skull, so brows can share it (one draw call less).
 */
export function addHair(S: THREE.Group, H: THREE.Group, L: Look, hat = false): THREE.Material | null {
  if (hat) return hairUnderHat(S, H, L);
  if (L.hair === 'muetze') {
    const knit = hairMat('knit', L.hat);
    part(S, capOf(1.13), knit, 0, 0.2, -0.005, 0.158, 0.182, 0.168);
    const ring = part(S, ringGeo, knit, 0, 0.275, -0.005);
    ring.rotation.x = Math.PI / 2;
    part(S, pompomGeo(), hairMat('fluff', L.hat), 0, 0.39, 0, 0.036, 0.036, 0.036);
    return null;
  }
  const hm = hairMat('strand', L.hairCol);
  const { y, z, rx, ry, rz } = HAIR;
  if (L.hair === 'irokese') {
    // Shaved sides: short fuzz hugging the scalp, the crest in full colour on top.
    const fuzz = hairMat('beard', darken(L.hairCol, 0.5));
    part(S, capGeo('fuzz'), fuzz, 0, y, z, rx, ry, rz);
    part(S, crestGeo(), hm, 0, 0, 0);
    return hm;
  }
  if (L.hair === 'locken') {
    const cm = hairMat('curl', L.hairCol);
    part(S, curlGeo(), cm, 0, CURL.y, CURL.z, CURL.rx, CURL.ry, CURL.rz);
    return cm;
  }
  part(S, capGeo(L.hair), hm, 0, y, z, rx, ry, rz);
  if (L.hair === 'lang') {
    part(S, curtainGeo('top'), hm, 0, 0, 0);
    part(H, curtainGeo('bottom'), hm, 0, 0, 0);
  }
  if (L.hair === 'dutt') part(S, bunGeo(), hm, 0, 0.335, -0.125, 0.07, 0.068, 0.07);
  return hm;
}

/**
 * Hair styled to sit under a hat (cap, helmet, ushanka): everything hugs the scalp so the hat fits
 * every style. The beanie gives way to short hair, the crest is shaved, curls flatten, the bun drops
 * to the nape; long hair keeps its curtain, which lies flat anyway.
 */
function hairUnderHat(S: THREE.Group, H: THREE.Group, L: Look): THREE.Material {
  const hm = hairMat('strand', L.hairCol);
  const { y, z, rx, ry, rz } = HAIR;
  if (L.hair === 'irokese') {
    part(S, capGeo('fuzz'), hairMat('beard', darken(L.hairCol, 0.5)), 0, y, z, rx, ry, rz);
    return hm;
  }
  if (L.hair === 'locken') {
    const cm = hairMat('curl', L.hairCol);
    part(S, curlGeo(0.025), cm, 0, y, z, rx, ry, rz);
    return cm;
  }
  part(S, capGeo(L.hair === 'muetze' ? 'kurz' : L.hair), hm, 0, y, z, rx, ry, rz);
  if (L.hair === 'lang') {
    part(S, curtainGeo('top'), hm, 0, 0, 0);
    part(H, curtainGeo('bottom'), hm, 0, 0, 0);
  }
  if (L.hair === 'dutt') part(S, bunGeo(), hm, 0, 0.19, -0.185, 0.06, 0.058, 0.06);
  return hm;
}

function capOf(th: number): THREE.BufferGeometry {
  return cached(`hat_${th}`, () => shell({ phi0: -Math.PI, phi1: Math.PI, th0: () => 0, th1: () => th, segU: 32, segV: 10 }));
}

// --- Beards -------------------------------------------------------------------------------------

/** Mouth plane as polar angle on the head ellipsoid. */
const CUT_TH = Math.acos((CUT_Y - HEAD_C.y) / HEAD_C.ry);
const gauss = (x: number, s: number) => Math.exp(-((x / s) ** 2));

/** Upper beard line per |azimuth|: under the nose in the middle, up to the sideburns at the sides. */
const CHEEK = table([[0, 1.86], [0.35, 1.9], [0.6, 1.92], [0.95, 1.74], [1.3, 1.55], [1.55, 1.42], [1.75, 1.45]]);
const SIDE = 1.75;

const beardCache = new Map<string, THREE.BufferGeometry | null>();
function beardGeo(style: Beard, half: 'top' | 'jaw'): THREE.BufferGeometry | null {
  const k = `${style}_${half}`;
  if (!beardCache.has(k)) beardCache.set(k, makeBeard(style, half));
  return beardCache.get(k)!;
}

function makeBeard(style: Beard, half: 'top' | 'jaw'): THREE.BufferGeometry | null {
  {
    // The mouth line stays visible: beard above stops a little over it, beard below leaves the lower lip.
    const lipTop = (phi: number) => CUT_TH - 0.03 * gauss(phi, 0.45);
    const edge = (phi: number, a: number) => smooth01(a, a * 0.8, Math.abs(phi));
    if (style === 'stoppeln') {
      return half === 'top'
        ? shell({ phi0: -SIDE, phi1: SIDE, th0: (p) => CHEEK(Math.abs(p)), th1: lipTop, r: () => 1.012, segU: 28, segV: 6 })
        : shell({ phi0: -SIDE, phi1: SIDE, th0: (p) => CUT_TH + 0.05 * gauss(p, 0.4), th1: () => Math.PI - 0.02, r: () => 1.012, segU: 28, segV: 8 });
    }
    if (style === 'vollbart') {
      if (half === 'top') {
        return shell({
          phi0: -SIDE,
          phi1: SIDE,
          th0: (p) => CHEEK(Math.abs(p)) - 0.02,
          th1: lipTop,
          r: (p, _t, _d, v) => 1.01 + 0.04 * Math.sqrt(smooth01(0, 0.5, v)) * edge(p, SIDE) + 0.02 * gauss(p, 0.4) * Math.sin(Math.PI * v),
          segU: 30,
          segV: 7,
        });
      }
      return shell({
        phi0: -SIDE,
        phi1: SIDE,
        th0: (p) => CUT_TH + 0.09 * gauss(p, 0.35),
        th1: () => Math.PI - 0.01,
        // Fuller towards the chin, and fullest in front: the beard hangs down a little.
        r: (p, _t, _d, v) => 1.01 + (0.04 + 0.16 * smooth01(0.1, 1, v) * Math.max(0, Math.cos(p)) ** 1.5) * edge(p, SIDE),
        segU: 30,
        segV: 10,
      });
    }
    if (style === 'schnurrbart' || style === 'kinnbart') {
      if (half === 'top') {
        // A band along the upper lip, thick in the middle, tapering to drooping points at the ends.
        const w = style === 'kinnbart' ? 0.42 : 0.52;
        const mid = (p: number) => 2.05 + 0.13 * (p / w) ** 2;
        const half = (p: number) => 0.012 + 0.07 * Math.sqrt(Math.max(0, 1 - (p / w) ** 2));
        return shell({
          phi0: -w,
          phi1: w,
          th0: (p) => mid(p) - half(p),
          th1: (p) => Math.min(mid(p) + half(p), Math.abs(p) < 0.3 ? lipTop(p) : 9),
          r: (p, _t, _d, v) => 1.008 + 0.045 * Math.sin(Math.PI * v) ** 0.6 * Math.sqrt(Math.max(0, 1 - (p / w) ** 2)),
          segU: 18,
          segV: 6,
        });
      }
      if (style === 'schnurrbart') return null;
      // Goatee: a chin patch with a small pointed tuft.
      const w = 0.45;
      return shell({
        phi0: -w,
        phi1: w,
        th0: (p) => CUT_TH + 0.1 + 0.06 * (p / w) ** 2,
        th1: () => Math.PI - 0.08,
        r: (p, th, _d, v) => 1.01 + Math.sqrt(Math.max(0, 1 - (p / w) ** 2)) * (0.04 + 0.12 * gauss(th - (Math.PI - 0.45), 0.25) * gauss(p, 0.25) + 0.02 * v),
        segU: 14,
        segV: 8,
      });
    }
    if (style === 'zwirbel' && half === 'top') {
      // Handlebar moustache: one tube from tip to tip, thick in the middle, curled up at both ends.
      const pts = [
        [-0.105, 0.163, 0.106], [-0.124, 0.148, 0.1], [-0.118, 0.125, 0.106], [-0.088, 0.108, 0.122], [-0.045, 0.111, 0.139], [0, 0.118, 0.146],
      ];
      const all = [...pts, ...pts.slice(0, -1).reverse().map(([x, y, z]) => [-x, y, z])].map(([x, y, z]) => new THREE.Vector3(x, y, z));
      const curve = new THREE.CatmullRomCurve3(all);
      return taperedTube(curve, 60, 8, (t) => 0.0025 + 0.011 * Math.sin(Math.PI * t) ** 1.6);
    }
    return null;
  }
}

/** Beard parts: above the mouth on the skull `S` (opens with it), below on the jaw `H` (stays). */
export function addBeard(S: THREE.Group, H: THREE.Group, L: Look): void {
  if (L.beard === 'none' || L.female) return;
  const { y, rx, ry, rz } = HEAD_C;
  const mat = L.beard === 'stoppeln' ? hairMat('stubble', darken(L.hairCol, 0.55)) : hairMat('beard', L.hairCol, false);
  const top = beardGeo(L.beard, 'top');
  const jaw = beardGeo(L.beard, 'jaw');
  // The handlebar tube is modelled in head space, everything else on the head ellipsoid.
  if (top) L.beard === 'zwirbel' ? part(S, top, mat, 0, 0, 0) : part(S, top, mat, 0, y, 0, rx, ry, rz);
  if (jaw) part(H, jaw, mat, 0, y, 0, rx, ry, rz);
}
