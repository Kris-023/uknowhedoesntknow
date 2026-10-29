import * as THREE from 'three';
import { mulberry32 } from '../../core/rng';
import { canvasTex } from '../../scene/textures';

// Canvas textures for the WG. Décor is drawn from a fixed seed: the flat looks the same in every room.

const DECOR_SEED = 0x57a6;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Regions of the 1024² atlas: posters, cleaning rota, game box, sleeves, rug, labels. */
export const ATLAS = {
  size: 1024,
  posterA: { x: 0, y: 0, w: 256, h: 384 },
  posterB: { x: 256, y: 0, w: 256, h: 384 },
  posterC: { x: 512, y: 0, w: 256, h: 384 },
  putzplan: { x: 768, y: 0, w: 256, h: 384 },
  game: { x: 0, y: 384, w: 256, h: 256 },
  sleeve: [
    { x: 256, y: 384, w: 128, h: 128 },
    { x: 384, y: 384, w: 128, h: 128 },
    { x: 256, y: 512, w: 128, h: 128 },
    { x: 384, y: 512, w: 128, h: 128 },
  ],
  chipsA: { x: 512, y: 384, w: 128, h: 192 },
  chipsB: { x: 640, y: 384, w: 128, h: 192 },
  label: { x: 768, y: 384, w: 256, h: 128 },
  rug: { x: 0, y: 640, w: 640, h: 384 },
  /** Plain white patch for parts that only want the material, not a picture. */
  white: { x: 1000, y: 1000, w: 16, h: 16 },
} as const;

/** Re-map a geometry's 0..1 uv onto an atlas rect (canvas y runs down, uv v up). */
export function atlasUV(geo: THREE.BufferGeometry, r: Rect): THREE.BufferGeometry {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const S = ATLAS.size;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (r.x + uv.getX(i) * r.w) / S, 1 - (r.y + (1 - uv.getY(i)) * r.h) / S);
  }
  return geo;
}

function noiseFill(x: CanvasRenderingContext2D, w: number, h: number, n: number, light: string, dark: string, rand: () => number): void {
  for (let i = 0; i < n; i++) {
    x.fillStyle = rand() < 0.5 ? light : dark;
    x.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

export interface WgTextures {
  floor: THREE.CanvasTexture;
  wall: THREE.CanvasTexture;
  tiles: THREE.CanvasTexture;
  atlas: THREE.CanvasTexture;
  facade: THREE.CanvasTexture;
  testcard: THREE.CanvasTexture;
  snow: THREE.CanvasTexture;
  glow: THREE.CanvasTexture;
  window: THREE.CanvasTexture;
  paper: THREE.CanvasTexture;
}

export function makeWgTextures(): WgTextures {
  const rand = mulberry32(DECOR_SEED);

  // Altbau Dielen: long boards along z, each its own tone, grain lines, butt joints, nail dots.
  const floor = canvasTex(512, 512, (x, w, h) => {
    const n = 8;
    const bw = w / n;
    for (let i = 0; i < n; i++) {
      const l = 30 + rand() * 14;
      const joint = rand() * h;
      for (const [y0, y1] of [
        [0, joint],
        [joint, h],
      ]) {
        const ll = l + (rand() - 0.5) * 6;
        x.fillStyle = `hsl(${24 + rand() * 6}, ${38 + rand() * 10}%, ${ll}%)`;
        x.fillRect(i * bw, y0, bw, y1 - y0);
      }
      x.strokeStyle = 'rgba(40,20,8,.18)';
      for (let g = 0; g < 9; g++) {
        x.beginPath();
        const gx = i * bw + 4 + rand() * (bw - 8);
        x.moveTo(gx, 0);
        for (let y = 0; y <= h; y += 32) x.lineTo(gx + Math.sin(y * 0.02 + g) * 3 * rand(), y);
        x.stroke();
      }
      x.fillStyle = 'rgba(15,8,3,.85)';
      x.fillRect(i * bw, 0, 2, h);
      x.fillRect(i * bw, joint, bw, 2);
      x.fillStyle = 'rgba(10,6,3,.7)';
      for (const ny of [joint + 10, joint - 10]) {
        x.fillRect(i * bw + 8, ny, 3, 3);
        x.fillRect(i * bw + bw - 11, ny, 3, 3);
      }
    }
    noiseFill(x, w, h, 3000, 'rgba(255,230,200,.04)', 'rgba(0,0,0,.08)', rand);
  });

  // Raufaser wallpaper, painted over a few times.
  const wall = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#d9d0c0';
    x.fillRect(0, 0, w, h);
    noiseFill(x, w, h, 7000, 'rgba(255,255,255,.07)', 'rgba(60,50,40,.07)', rand);
  });

  // The Fliesentisch top: brown and orange 1970s tiles whose quarter circles join into rings.
  const tiles = canvasTex(512, 512, (x, w) => {
    const n = 8;
    const s = w / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const px = i * s;
        const py = j * s;
        x.fillStyle = (i + j) % 2 ? '#6e3a1b' : '#7a4320';
        x.fillRect(px, py, s, s);
        // Corner the arc is centred on: alternating per tile, so four tiles form one ring.
        const cx = px + (i % 2 ? 0 : s);
        const cy = py + (j % 2 ? 0 : s);
        x.save();
        x.beginPath();
        x.rect(px, py, s, s);
        x.clip();
        for (const [r, c] of [
          [s * 0.95, '#d4762a'],
          [s * 0.72, '#e9c27a'],
          [s * 0.5, '#b4561f'],
          [s * 0.28, '#efe0b8'],
        ] as const) {
          x.fillStyle = c;
          x.beginPath();
          x.arc(cx, cy, r, 0, Math.PI * 2);
          x.fill();
        }
        x.restore();
        // Glaze: a soft highlight and a few crazing lines.
        const g = x.createLinearGradient(px, py, px + s, py + s);
        g.addColorStop(0, 'rgba(255,255,255,.12)');
        g.addColorStop(0.5, 'rgba(255,255,255,0)');
        x.fillStyle = g;
        x.fillRect(px, py, s, s);
      }
    }
    x.fillStyle = '#cdbf9e';
    for (let i = 0; i <= n; i++) {
      x.fillRect(i * s - 2, 0, 4, w);
      x.fillRect(0, i * s - 2, w, 4);
    }
    noiseFill(x, w, w, 2500, 'rgba(255,255,255,.05)', 'rgba(30,10,0,.1)', rand);
  });

  const atlas = canvasTex(ATLAS.size, ATLAS.size, (x) => drawAtlas(x, rand));

  // The house across the street: dark plaster, a few windows still lit at 2 a.m.
  const facade = canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#0d0e14';
    x.fillRect(0, 0, w, h);
    noiseFill(x, w, h, 4000, 'rgba(255,255,255,.025)', 'rgba(0,0,0,.2)', rand);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 6; col++) {
        const wx = 20 + col * 82;
        const wy = 30 + row * 98;
        const r = rand();
        x.fillStyle = r < 0.12 ? '#c98a3e' : r < 0.18 ? '#4a6bb0' : r < 0.22 ? '#9c5a8a' : '#050608';
        x.fillRect(wx, wy, 40, 62);
        x.fillStyle = 'rgba(0,0,0,.6)';
        x.fillRect(wx + 19, wy, 2, 62);
        x.fillRect(wx, wy + 22, 40, 2);
        x.fillStyle = '#1a1b22';
        x.fillRect(wx - 4, wy + 62, 48, 5);
      }
    }
  });

  // Invented test card: bars, ring and grid, "Sendeschluss" after the last programme.
  const testcard = canvasTex(256, 192, (x, w, h) => {
    const bars = ['#e8e8e8', '#e8e030', '#30d8e0', '#30d040', '#d030c8', '#d83030', '#3040d8', '#151515'];
    bars.forEach((c, i) => {
      x.fillStyle = c;
      x.fillRect((i * w) / bars.length, 0, w / bars.length + 1, h);
    });
    x.strokeStyle = 'rgba(255,255,255,.55)';
    x.lineWidth = 1;
    for (let gx = 0; gx <= w; gx += 16) {
      x.beginPath();
      x.moveTo(gx, 0);
      x.lineTo(gx, h);
      x.stroke();
    }
    for (let gy = 0; gy <= h; gy += 16) {
      x.beginPath();
      x.moveTo(0, gy);
      x.lineTo(w, gy);
      x.stroke();
    }
    x.fillStyle = '#202020';
    x.beginPath();
    x.arc(w / 2, h / 2, 70, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = '#f0f0f0';
    x.lineWidth = 4;
    x.stroke();
    x.fillStyle = '#f0f0f0';
    x.fillRect(w / 2 - 60, h / 2 - 14, 120, 28);
    x.fillStyle = '#111';
    x.font = 'bold 15px Arial, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('KANAL 3', w / 2, h / 2 + 1);
    x.fillStyle = '#f0f0f0';
    x.font = 'bold 12px Arial, sans-serif';
    x.fillText('SENDESCHLUSS', w / 2, h / 2 + 38);
    x.fillText('02:00', w / 2, h / 2 - 36);
  });

  const snow = canvasTex(128, 96, (x, w, h) => {
    const img = x.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = Math.floor(rand() * 255);
      img.data.set([v, v, v * 0.95 + 10, 255], i * 4);
    }
    x.putImageData(img, 0, 0);
  });

  // Radial falloff for fake light pools (candle on the tiles, street light on the floor).
  const glow = canvasTex(128, 128, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
  glow.wrapS = glow.wrapT = THREE.ClampToEdgeWrapping;

  // The window's light thrown onto the floorboards: four panes, soft edges.
  const window = canvasTex(128, 256, (x, w, h) => {
    x.filter = 'blur(5px)';
    x.fillStyle = '#fff';
    const m = 14;
    const cw = (w - 3 * m) / 2;
    const ch = (h - 3 * m) / 2;
    for (const i of [0, 1]) for (const j of [0, 1]) x.fillRect(m + i * (cw + m), m + j * (ch + m), cw, ch);
  });
  window.wrapS = window.wrapT = THREE.ClampToEdgeWrapping;

  // Paper-ball lamp: brighter between the wire ribs, darker towards the poles.
  const paper = canvasTex(64, 128, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#6a5a48');
    g.addColorStop(0.5, '#ffffff');
    g.addColorStop(1, '#7a6a58');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(80,60,40,.45)';
    for (let y = 6; y < h; y += 9) x.fillRect(0, y, w, 2);
    noiseFill(x, w, h, 600, 'rgba(255,255,255,.08)', 'rgba(0,0,0,.06)', rand);
  });

  return { floor, wall, tiles, atlas, facade, testcard, snow, glow, window, paper };
}

function poster(x: CanvasRenderingContext2D, r: Rect, bg: string, draw: () => void, title: string, sub: string, fg: string): void {
  x.save();
  x.translate(r.x, r.y);
  x.fillStyle = bg;
  x.fillRect(0, 0, r.w, r.h);
  draw();
  x.fillStyle = fg;
  x.textAlign = 'center';
  x.font = 'bold 30px Impact, "Arial Black", sans-serif';
  x.fillText(title, r.w / 2, r.h - 70, r.w - 20);
  x.font = 'bold 15px Arial, sans-serif';
  x.fillText(sub, r.w / 2, r.h - 40, r.w - 20);
  // Sun-bleached and taped: lighter corners, a tear.
  x.fillStyle = 'rgba(255,240,200,.25)';
  for (const [tx, ty] of [
    [6, 6],
    [r.w - 36, 6],
  ])
    x.fillRect(tx, ty, 30, 12);
  x.restore();
}

function drawAtlas(x: CanvasRenderingContext2D, rand: () => number): void {
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, ATLAS.size, ATLAS.size);

  const A = ATLAS.posterA;
  poster(
    x,
    A,
    '#1b1530',
    () => {
      for (let i = 0; i < 9; i++) {
        x.strokeStyle = `hsl(${300 + i * 9}, 90%, ${45 + i * 3}%)`;
        x.lineWidth = 6;
        x.beginPath();
        x.arc(128, 150, 20 + i * 11, Math.PI, Math.PI * 2);
        x.stroke();
      }
      x.fillStyle = '#f2c14e';
      x.beginPath();
      x.arc(128, 150, 16, 0, Math.PI * 2);
      x.fill();
    },
    'NEON DACKEL',
    'LIVE · KELLERBAR 23.11.',
    '#f7d36b',
  );

  const B = ATLAS.posterB;
  poster(
    x,
    B,
    '#d9cfb8',
    () => {
      x.fillStyle = '#c0392b';
      x.fillRect(20, 30, 216, 200);
      x.fillStyle = '#1a1a1a';
      for (let i = 0; i < 7; i++) x.fillRect(30 + i * 30, 60 + (i % 3) * 30, 18, 140 - (i % 3) * 30);
    },
    'DIE KACHELBRÜDER',
    'TOUR „FUGENLOS“',
    '#1a1a1a',
  );

  const C = ATLAS.posterC;
  poster(
    x,
    C,
    '#0f3b3a',
    () => {
      x.fillStyle = '#e8e2c8';
      x.beginPath();
      x.moveTo(128, 40);
      x.lineTo(220, 230);
      x.lineTo(36, 230);
      x.closePath();
      x.fill();
      x.fillStyle = '#0f3b3a';
      x.beginPath();
      x.arc(128, 170, 34, 0, Math.PI * 2);
      x.fill();
    },
    'SPERRMÜLL DISKO',
    'JEDEN 2. FREITAG',
    '#e8e2c8',
  );

  // Putzplan: rota grid, names scribbled, crossed out, re-written.
  const P = ATLAS.putzplan;
  x.save();
  x.translate(P.x, P.y);
  x.fillStyle = '#f4f1e6';
  x.fillRect(0, 0, P.w, P.h);
  x.fillStyle = '#222';
  x.font = 'bold 26px "Comic Sans MS", "Marker Felt", sans-serif';
  x.textAlign = 'center';
  x.fillText('PUTZPLAN', P.w / 2, 38);
  const jobs = ['Bad', 'Küche', 'Flur', 'Müll'];
  const names = ['Jule', 'Mo', 'Basti', 'Kaya'];
  x.font = '15px "Comic Sans MS", sans-serif';
  x.strokeStyle = '#333';
  x.lineWidth = 1.5;
  for (let r = 0; r <= 5; r++) {
    x.beginPath();
    x.moveTo(10, 60 + r * 56);
    x.lineTo(P.w - 10, 60 + r * 56);
    x.stroke();
  }
  x.textAlign = 'left';
  for (let r = 0; r < 5; r++) {
    x.fillStyle = '#333';
    x.fillText(`KW ${40 + r}`, 14, 94 + r * 56);
    for (let c = 0; c < 2; c++) {
      const name = names[(r + c * 2) % 4];
      const job = jobs[(r + c) % 4];
      const cx = 80 + c * 88;
      x.fillStyle = '#2a4a9a';
      x.fillText(`${job}: ${name}`, cx, 84 + r * 56, 84);
      if (rand() < 0.55) {
        x.strokeStyle = '#c0392b';
        x.lineWidth = 2.5;
        x.beginPath();
        x.moveTo(cx - 2, 79 + r * 56);
        x.lineTo(cx + 78, 79 + r * 56 + (rand() - 0.5) * 6);
        x.stroke();
        x.fillStyle = '#c0392b';
        x.fillText(rand() < 0.5 ? '???' : names[Math.floor(rand() * 4)], cx + 10, 104 + r * 56);
      }
    }
  }
  x.fillStyle = '#c0392b';
  x.font = 'bold 17px "Comic Sans MS", sans-serif';
  x.fillText('BASTI!!! MÜLL!!!', 30, P.h - 14);
  x.restore();

  // Board game box lid (invented): "Spätkauf-Imperium".
  const G = ATLAS.game;
  x.save();
  x.translate(G.x, G.y);
  x.fillStyle = '#2d6a8f';
  x.fillRect(0, 0, G.w, G.h);
  x.fillStyle = '#f2c14e';
  x.fillRect(16, 16, G.w - 32, G.h - 32);
  x.fillStyle = '#2d6a8f';
  x.fillRect(26, 26, G.w - 52, G.h - 52);
  x.fillStyle = '#f7f0dc';
  x.textAlign = 'center';
  x.font = 'bold 34px "Arial Black", sans-serif';
  x.fillText('SPÄTKAUF', G.w / 2, 110);
  x.font = 'bold 28px "Arial Black", sans-serif';
  x.fillText('IMPERIUM', G.w / 2, 148);
  x.font = '14px Arial, sans-serif';
  x.fillText('ab 2 Pfandflaschen', G.w / 2, 196);
  x.restore();

  // Record sleeves.
  ATLAS.sleeve.forEach((r, i) => {
    const hue = [12, 200, 48, 320][i];
    x.fillStyle = `hsl(${hue}, 55%, 40%)`;
    x.fillRect(r.x, r.y, r.w, r.h);
    x.fillStyle = `hsl(${hue + 40}, 70%, 70%)`;
    x.beginPath();
    x.arc(r.x + r.w / 2, r.y + r.h / 2, 26 + i * 6, 0, Math.PI * 2);
    x.fill();
  });

  // Chip bags: invented brands.
  for (const [r, bg, name] of [
    [ATLAS.chipsA, '#d8352a', 'KNUSPA'],
    [ATLAS.chipsB, '#2a7a3a', 'PAPRIKA\nPOWER'],
  ] as const) {
    x.fillStyle = bg;
    x.fillRect(r.x, r.y, r.w, r.h);
    x.fillStyle = '#f5d33a';
    x.beginPath();
    x.ellipse(r.x + r.w / 2, r.y + r.h / 2, 50, 36, -0.3, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#5a1a10';
    x.font = 'bold 20px "Arial Black", sans-serif';
    x.textAlign = 'center';
    name.split('\n').forEach((l, i, a) => x.fillText(l, r.x + r.w / 2, r.y + r.h / 2 + 7 - (a.length - 1) * 11 + i * 22));
  }

  const L = ATLAS.label;
  x.fillStyle = '#e8dcc0';
  x.fillRect(L.x, L.y, L.w, L.h);
  x.fillStyle = '#7a2a1a';
  x.font = 'bold 30px Georgia, serif';
  x.textAlign = 'center';
  x.fillText('Kiezbräu', L.x + L.w / 2, L.y + 60);
  x.font = '14px Georgia, serif';
  x.fillText('Helles · 0,5 l', L.x + L.w / 2, L.y + 92);

  // Rug: faded oriental-ish pattern with a fringe-less border.
  const R = ATLAS.rug;
  x.save();
  x.translate(R.x, R.y);
  x.fillStyle = '#6a1f24';
  x.fillRect(0, 0, R.w, R.h);
  x.strokeStyle = '#c9a66b';
  x.lineWidth = 10;
  x.strokeRect(18, 18, R.w - 36, R.h - 36);
  x.strokeStyle = '#1f2c4a';
  x.lineWidth = 16;
  x.strokeRect(40, 40, R.w - 80, R.h - 80);
  x.fillStyle = '#1f2c4a';
  x.beginPath();
  x.ellipse(R.w / 2, R.h / 2, 150, 90, 0, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#c9a66b';
  x.beginPath();
  x.ellipse(R.w / 2, R.h / 2, 80, 46, 0, 0, Math.PI * 2);
  x.fill();
  for (let i = 0; i < 12; i++) {
    x.fillStyle = i % 2 ? '#c9a66b' : '#2f5a46';
    x.beginPath();
    x.arc(90 + i * 42, 75, 9, 0, Math.PI * 2);
    x.arc(90 + i * 42, R.h - 75, 9, 0, Math.PI * 2);
    x.fill();
  }
  noiseFill(x, R.w, R.h, 14000, 'rgba(255,230,200,.06)', 'rgba(0,0,0,.14)', rand);
  x.restore();
}
