import * as THREE from 'three';
import { mulberry32, type Rand } from '../../core/rng';
import { canvasTex } from '../../scene/textures';
import { WS } from './config';

// Canvas textures of the laundromat. Décor that never changes (tiles, notes, street) uses a fixed
// seed; only the laundry colours follow the room seed.

const DECOR_SEED = 0x5a1;

export interface WaschTextures {
  floor: THREE.CanvasTexture;
  wall: THREE.CanvasTexture;
  ceiling: THREE.CanvasTexture;
  laundry: THREE.CanvasTexture[];
  board: THREE.CanvasTexture;
  street: THREE.CanvasTexture;
  rain: THREE.CanvasTexture;
  drops: THREE.CanvasTexture;
  sign: THREE.CanvasTexture;
  letters: THREE.CanvasTexture;
  clock: THREE.CanvasTexture;
  glow: THREE.CanvasTexture;
  coin: THREE.CanvasTexture;
}

const rgb = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export function makeWaschTextures(seed: number): WaschTextures {
  const r = mulberry32(DECOR_SEED);

  // Worn linoleum in big two-tone squares, scuffed along the walking lines.
  const floor = canvasTex(256, 256, (x, w, h) => {
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        x.fillStyle = (i + j) % 2 ? WS.colors.floorA : WS.colors.floorB;
        x.fillRect(i * 64, j * 64, 64, 64);
      }
    speckle(x, w, h, r, 3000, 0.05);
    x.strokeStyle = 'rgba(0,0,0,.25)';
    for (let i = 0; i <= 4; i++) {
      x.beginPath();
      x.moveTo(i * 64, 0);
      x.lineTo(i * 64, h);
      x.moveTo(0, i * 64);
      x.lineTo(w, i * 64);
      x.stroke();
    }
  });

  // Lower half white tiles with greyed grout, upper half paint: one texture spans the wall height.
  const wall = canvasTex(256, 512, (x, w, h) => {
    x.fillStyle = rgb(WS.colors.paint);
    x.fillRect(0, 0, w, h);
    speckle(x, w, h * 0.55, r, 1500, 0.04);
    const top = h * 0.55;
    x.fillStyle = WS.colors.tileWall;
    x.fillRect(0, top, w, h - top);
    x.fillStyle = 'rgba(60,70,70,.55)';
    for (let yy = top; yy < h; yy += 32) x.fillRect(0, yy, w, 2);
    for (let xx = 0; xx < w; xx += 32) x.fillRect(xx, top, 2, h - top);
    for (let i = 0; i < 40; i++) {
      x.fillStyle = `rgba(90,80,50,${0.05 + r() * 0.08})`;
      x.fillRect(Math.floor(r() * 8) * 32 + 2, top + Math.floor(r() * 7) * 32 + 2, 30, 30);
    }
    x.fillStyle = '#7d8a87';
    x.fillRect(0, top - 6, w, 6);
  });

  const ceiling = canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = '#7a7d7a';
    x.fillRect(0, 0, w, h);
    speckle(x, w, h, r, 1500, 0.08);
    x.fillStyle = '#6b6e6c';
    x.fillRect(0, 0, w, 3);
    x.fillRect(0, 0, 3, h);
    x.fillStyle = 'rgba(120,100,60,.18)';
    x.beginPath();
    x.arc(80, 70, 22, 0, Math.PI * 2);
    x.fill();
  });

  // Laundry in the drum: tangled blobs in the room's colours over the dark steel, water at the bottom.
  const lr = mulberry32(seed ^ 0x1a0d);
  const palette = [0xc2362f, 0x2c5fd6, 0xe8e2d0, 0x2f5d3a, 0xd9a521, 0x7a3f6b, 0x181818, 0xd24c9a, 0x5aa0c8, 0xf0f0ea];
  const laundry = [0, 1, 2, 3].map(() =>
    canvasTex(128, 128, (x, w, h) => {
      x.fillStyle = '#16191c';
      x.fillRect(0, 0, w, h);
      const cols = [0, 1, 2].map(() => rgb(palette[Math.floor(lr() * palette.length)]));
      for (let i = 0; i < 26; i++) {
        x.fillStyle = cols[i % 3];
        x.globalAlpha = 0.75 + lr() * 0.25;
        x.beginPath();
        const a = lr() * Math.PI * 2;
        const d = lr() * 46;
        x.ellipse(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 10 + lr() * 18, 5 + lr() * 9, lr() * 3, 0, Math.PI * 2);
        x.fill();
      }
      x.globalAlpha = 1;
      // Folds and shadows, so it reads as cloth rather than paint.
      x.strokeStyle = 'rgba(0,0,0,.35)';
      x.lineWidth = 2;
      for (let i = 0; i < 18; i++) {
        x.beginPath();
        x.arc(lr() * w, lr() * h, 6 + lr() * 14, lr() * 6, lr() * 6 + 1.5);
        x.stroke();
      }
      x.fillStyle = 'rgba(140,190,230,.18)';
      x.fillRect(0, h * 0.72, w, h * 0.28);
      // Drum lifters and the dark rim, drawn last so the disc edge stays clean.
      const g = x.createRadialGradient(64, 64, 30, 64, 64, 64);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,.8)');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    }),
  );

  const board = canvasTex(512, 320, (x, w, h) => noticeBoard(x, w, h, r));
  const street = canvasTex(1024, 384, (x, w, h) => streetScene(x, w, h, r));

  // Rain streaks: thin, slanted a bit, transparent; scrolled vertically by the clock.
  const rain = canvasTex(256, 256, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    for (let i = 0; i < 220; i++) {
      const px = r() * w;
      const py = r() * h;
      const len = 10 + r() * 26;
      x.strokeStyle = `rgba(200,220,255,${0.25 + r() * 0.5})`;
      x.lineWidth = 1;
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(px - len * 0.08, py + len);
      x.stroke();
    }
  });

  // Drops on the glass: little lenses with a highlight, and a few running trails.
  const drops = canvasTex(256, 256, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      const px = r() * w;
      const py = r() * h;
      const rr = 0.8 + r() * 2.6;
      x.fillStyle = 'rgba(190,215,240,.35)';
      x.beginPath();
      x.arc(px, py, rr, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = 'rgba(255,255,255,.55)';
      x.fillRect(px - rr * 0.4, py - rr * 0.5, 1, 1);
    }
    x.strokeStyle = 'rgba(190,215,240,.22)';
    for (let i = 0; i < 9; i++) {
      const px = r() * w;
      x.lineWidth = 1 + r() * 1.5;
      x.beginPath();
      x.moveTo(px, r() * h * 0.5);
      x.bezierCurveTo(px + 4, h * 0.6, px - 4, h * 0.8, px + r() * 6, h);
      x.stroke();
    }
  });

  // Neon "24h" for the street: mirrored, because we read it from inside.
  const sign = canvasTex(256, 128, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.translate(w, 0);
    x.scale(-1, 1);
    x.font = 'bold 76px Arial, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineWidth = 7;
    x.strokeStyle = '#ffffff';
    x.shadowColor = '#ffffff';
    x.shadowBlur = 10;
    x.strokeText('24h', w / 2, h / 2 + 4);
  });

  // Window vinyl, also mirrored: the shop's name faces the street.
  const letters = canvasTex(1024, 128, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.translate(w, 0);
    x.scale(-1, 1);
    x.fillStyle = 'rgba(235,240,245,.85)';
    x.font = 'bold 64px Arial, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('WASCHSALON  SCHAUMKRONE', w / 2, h / 2 - 10);
    x.font = 'bold 26px Arial, sans-serif';
    x.fillText('SB · 7 TAGE · RUND UM DIE UHR', w / 2, h / 2 + 40);
  });

  const clock = canvasTex(128, 128, (x, w) => {
    x.fillStyle = '#ece8dc';
    x.beginPath();
    x.arc(w / 2, w / 2, 62, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#222';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      x.fillRect(w / 2 + Math.sin(a) * 52 - 2, w / 2 - Math.cos(a) * 52 - 5, 4, i % 3 ? 6 : 10);
    }
  });

  // Soft radial falloff for additive halos (neon sign, street lamp, tube glow on the ceiling).
  const glow = canvasTex(64, 64, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,.9)');
    g.addColorStop(0.4, 'rgba(255,255,255,.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
  glow.wrapS = glow.wrapT = THREE.ClampToEdgeWrapping;

  const coin = canvasTex(128, 256, (x, w, h) => {
    x.fillStyle = '#2f3a33';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#d9d4c4';
    x.font = 'bold 15px Arial, sans-serif';
    x.textAlign = 'center';
    x.fillText('GELDWECHSLER', w / 2, 22);
    x.font = '11px Arial, sans-serif';
    x.fillText('Scheine rein, Münzen raus.', w / 2, 40);
    x.fillText('Meistens.', w / 2, 54);
    x.fillStyle = '#111';
    x.fillRect(24, 120, 80, 10);
    x.fillRect(44, 200, 40, 30);
    x.fillStyle = '#b9c0c6';
    x.fillRect(90, 150, 14, 24);
    x.fillStyle = '#c2362f';
    x.beginPath();
    x.arc(34, 160, 9, 0, Math.PI * 2);
    x.fill();
  });

  return { floor, wall, ceiling, laundry, board, street, rain, drops, sign, letters, clock, glow, coin };
}

function speckle(x: CanvasRenderingContext2D, w: number, h: number, r: Rand, n: number, a: number): void {
  for (let i = 0; i < n; i++) {
    x.fillStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.5})`;
    x.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

/** Cork board with handwritten-ish notes. Invented people, invented problems. */
function noticeBoard(x: CanvasRenderingContext2D, w: number, h: number, r: Rand): void {
  x.fillStyle = '#9a6b3c';
  x.fillRect(0, 0, w, h);
  speckle(x, w, h, r, 4000, 0.12);
  x.strokeStyle = '#5b3c1e';
  x.lineWidth = 10;
  x.strokeRect(5, 5, w - 10, h - 10);
  const notes: { x: number; y: number; w: number; h: number; bg: string; lines: string[]; size: number; tabs?: boolean }[] = [
    { x: 22, y: 22, w: 150, h: 110, bg: '#f6f0a0', size: 15, lines: ['WER HAT MEINE', 'ROTE SOCKE?', 'Belohnung!', '– Gisela, Mi 22 Uhr'] },
    { x: 184, y: 18, w: 150, h: 92, bg: '#ffffff', size: 14, lines: ['Bitte KEINE', 'Turnschuhe schleudern!!!', 'Die Geschäftsleitung'] },
    { x: 346, y: 26, w: 146, h: 120, bg: '#bfe3f2', size: 14, lines: ['Katze entlaufen', 'hört auf', '„Flusensieb“', 'kratzt nicht', '(meistens)'] },
    { x: 26, y: 150, w: 160, h: 140, bg: '#ffffff', size: 14, tabs: true, lines: ['Gitarrenunterricht', 'auch nachts', 'Lagerfeuer-', 'Akkorde garantiert'] },
    { x: 200, y: 124, w: 136, h: 100, bg: '#ffd0e0', size: 13, lines: ['Der Geldwechsler', 'frisst Münzen.', 'NICHT FÜTTERN.'] },
    { x: 350, y: 166, w: 140, h: 126, bg: '#f6f0a0', size: 13, lines: ['Suche WG-Zimmer', 'kein Weichspüler-', 'Fanatiker*in', 'Tel. auf Abriss'] },
    { x: 200, y: 236, w: 136, h: 64, bg: '#ffffff', size: 12, lines: ['Wäsche >30 Min. fertig', 'wird umgelegt.'] },
  ];
  for (const n of notes) {
    x.save();
    x.translate(n.x + n.w / 2, n.y + n.h / 2);
    x.rotate((r() - 0.5) * 0.12);
    x.fillStyle = 'rgba(0,0,0,.35)';
    x.fillRect(-n.w / 2 + 3, -n.h / 2 + 4, n.w, n.h);
    x.fillStyle = n.bg;
    x.fillRect(-n.w / 2, -n.h / 2, n.w, n.h);
    x.fillStyle = '#1d2a5c';
    x.font = `bold ${n.size}px "Comic Sans MS", "Segoe Print", cursive, sans-serif`;
    x.textAlign = 'center';
    n.lines.forEach((l, i) => x.fillText(l, 0, -n.h / 2 + 22 + i * (n.size + 6)));
    if (n.tabs) {
      x.strokeStyle = '#999';
      x.setLineDash([3, 3]);
      for (let i = 0; i < 7; i++) {
        const tx = -n.w / 2 + 6 + i * 21;
        x.strokeRect(tx, n.h / 2 - 34, 21, 34);
      }
      x.setLineDash([]);
    }
    x.fillStyle = '#c2362f';
    x.beginPath();
    x.arc(0, -n.h / 2 + 6, 4, 0, Math.PI * 2);
    x.fill();
    x.restore();
  }
}

/** The street across: wet asphalt, a row of old houses, three lit windows, a shuttered shop. */
function streetScene(x: CanvasRenderingContext2D, w: number, h: number, r: Rand): void {
  const sky = x.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#04060c');
  sky.addColorStop(0.5, '#0b1020');
  sky.addColorStop(1, '#141420');
  x.fillStyle = sky;
  x.fillRect(0, 0, w, h);
  // House fronts.
  let px = 0;
  const base = h * 0.82;
  while (px < w) {
    const bw = 150 + r() * 120;
    const top = 20 + r() * 50;
    const v = 18 + Math.floor(r() * 14);
    x.fillStyle = `rgb(${v},${v + 2},${v + 8})`;
    x.fillRect(px, top, bw, base - top);
    for (let fy = top + 24; fy < base - 90; fy += 62)
      for (let fx = px + 18; fx < px + bw - 40; fx += 52) {
        const lit = r() < 0.12;
        x.fillStyle = lit ? (r() < 0.5 ? '#ffcf7a' : '#9fd0ff') : '#0a0c12';
        x.fillRect(fx, fy, 28, 38);
        if (lit) {
          x.fillStyle = 'rgba(0,0,0,.35)';
          x.fillRect(fx + 14, fy, 2, 38);
        }
      }
    px += bw + 4;
  }
  // A shuttered shop with a tag on it.
  x.fillStyle = '#3a3d44';
  x.fillRect(380, base - 86, 220, 86);
  x.strokeStyle = '#2a2c31';
  for (let yy = base - 84; yy < base; yy += 6) {
    x.beginPath();
    x.moveTo(380, yy);
    x.lineTo(600, yy);
    x.stroke();
  }
  x.font = 'bold italic 34px Arial, sans-serif';
  x.fillStyle = '#3fa36b';
  x.fillText('FLUSI 99', 410, base - 34);
  // Kerb and wet street with smeared reflections.
  x.fillStyle = '#1b1c22';
  x.fillRect(0, base, w, h - base);
  x.fillStyle = 'rgba(255,200,120,.12)';
  x.fillRect(0, base + 8, w, 3);
}
