import * as THREE from 'three';
import { mulberry32, type Rand } from '../../core/rng';
import { canvasTex } from '../../scene/textures';

// Canvas textures for the Späti. Fixed seeds: the shelves look the same in every room; only
// what moves depends on the lobby seed.

const FONT = 'Arial, Helvetica, sans-serif';

function roundRect(x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, r: number): void {
  x.beginPath();
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r);
  x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r);
  x.arcTo(px, py, px + w, py, r);
  x.closePath();
}

const DRINKS = ['#2b120a', '#e8761c', '#2f9a3c', '#d8d24a', '#c22b3a', '#2d6fd6', '#f2f2f2', '#7a2fb0', '#f5b62a', '#55c7e8', '#1d1d1d', '#a6e04a'];

/** One door's worth of shelves per column (4 columns): bottles, cans and cartons, backlit. */
export function fridgeTex(): THREE.CanvasTexture {
  const r = mulberry32(0x5fa7);
  const tex = canvasTex(1024, 512, (x, W, H) => {
    const cw = W / 4;
    for (let col = 0; col < 4; col++) {
      const x0 = col * cw;
      const g = x.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#f4fbff');
      g.addColorStop(0.5, '#cfe4f4');
      g.addColorStop(1, '#9fbad0');
      x.fillStyle = g;
      x.fillRect(x0, 0, cw, H);
      const shelves = 5;
      const sh = H / shelves;
      for (let s = 0; s < shelves; s++) {
        const base = (s + 1) * sh - 6;
        // One product kind per run, like a real fridge: a few facings of the same thing.
        let px = x0 + 4;
        while (px < x0 + cw - 14) {
          const kind = r() < 0.45 ? 'bottle' : r() < 0.6 ? 'can' : 'carton';
          const col1 = DRINKS[Math.floor(r() * DRINKS.length)];
          const label = r() < 0.5 ? '#f4efe0' : DRINKS[Math.floor(r() * DRINKS.length)];
          const run = 2 + Math.floor(r() * 4);
          for (let k = 0; k < run && px < x0 + cw - 14; k++) {
            drawItem(x, r, kind, px, base, sh, col1, label);
            px += kind === 'bottle' ? 15 : kind === 'can' ? 14 : 22;
          }
          px += 2;
        }
        // Shelf edge with price strip.
        x.fillStyle = '#3a4048';
        x.fillRect(x0, base, cw, 6);
        x.fillStyle = '#f7f7f2';
        x.fillRect(x0, base + 1, cw, 3);
        x.fillStyle = '#c22b3a';
        for (let p = x0 + 10; p < x0 + cw - 10; p += 34) x.fillRect(p, base + 1, 10, 3);
      }
      // LED strip glare at the top of each door.
      const glare = x.createLinearGradient(0, 0, 0, 40);
      glare.addColorStop(0, 'rgba(255,255,255,0.9)');
      glare.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = glare;
      x.fillRect(x0, 0, cw, 40);
      // Cold glass: faint diagonal reflections and condensation at the bottom.
      x.fillStyle = 'rgba(255,255,255,0.07)';
      x.beginPath();
      x.moveTo(x0 + cw * 0.15, 0);
      x.lineTo(x0 + cw * 0.38, 0);
      x.lineTo(x0 + cw * 0.05, H);
      x.lineTo(x0 - cw * 0.18, H);
      x.fill();
      const fog = x.createLinearGradient(0, H * 0.75, 0, H);
      fog.addColorStop(0, 'rgba(230,240,250,0)');
      fog.addColorStop(1, 'rgba(230,240,250,0.35)');
      x.fillStyle = fog;
      x.fillRect(x0, H * 0.75, cw, H * 0.25);
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function drawItem(x: CanvasRenderingContext2D, r: Rand, kind: string, px: number, base: number, sh: number, body: string, label: string): void {
  if (kind === 'bottle') {
    const h = sh * (0.66 + r() * 0.08);
    const top = base - h;
    x.fillStyle = body;
    roundRect(x, px, top + h * 0.35, 13, h * 0.65, 4);
    x.fill();
    x.fillRect(px + 4, top + 4, 5, h * 0.4);
    x.fillStyle = '#d9d9d9';
    x.fillRect(px + 3.5, top, 6, 5);
    x.fillStyle = label;
    x.fillRect(px, top + h * 0.55, 13, h * 0.2);
    x.fillStyle = 'rgba(255,255,255,0.35)';
    x.fillRect(px + 2, top + h * 0.38, 2, h * 0.55);
  } else if (kind === 'can') {
    const h = sh * 0.42;
    x.fillStyle = body;
    roundRect(x, px, base - h, 12, h, 2);
    x.fill();
    x.fillStyle = label;
    x.fillRect(px, base - h * 0.62, 12, h * 0.25);
    x.fillStyle = '#c9ccd2';
    x.fillRect(px, base - h, 12, 2);
    x.fillStyle = 'rgba(255,255,255,0.4)';
    x.fillRect(px + 2, base - h + 3, 2, h - 6);
  } else {
    const h = sh * 0.55;
    x.fillStyle = label === '#f4efe0' ? '#f4efe0' : body;
    x.fillRect(px, base - h, 20, h);
    x.fillStyle = body;
    x.fillRect(px, base - h * 0.55, 20, h * 0.3);
    x.fillStyle = 'rgba(0,0,0,0.25)';
    x.beginPath();
    x.moveTo(px, base - h);
    x.lineTo(px + 10, base - h - 7);
    x.lineTo(px + 20, base - h);
    x.fill();
  }
}

/** Grey-white vinyl tiles with a hundred nights of shoe soles on them. */
export function floorTex(): THREE.CanvasTexture {
  const r = mulberry32(0x71e5);
  const t = canvasTex(512, 512, (x, w, h) => {
    const n = 4;
    const s = w / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const v = 196 + Math.floor(r() * 18);
        x.fillStyle = (i + j) % 2 ? `rgb(${v},${v + 2},${v + 6})` : `rgb(${v - 26},${v - 24},${v - 20})`;
        x.fillRect(i * s, j * s, s, s);
      }
    for (let k = 0; k < 2200; k++) {
      x.fillStyle = r() < 0.6 ? 'rgba(40,36,30,0.07)' : 'rgba(255,255,255,0.05)';
      x.fillRect(r() * w, r() * h, 1 + r() * 4, 1 + r() * 3);
    }
    x.strokeStyle = 'rgba(60,60,60,0.35)';
    x.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      x.beginPath();
      x.moveTo(i * s, 0);
      x.lineTo(i * s, h);
      x.moveTo(0, i * s);
      x.lineTo(w, i * s);
      x.stroke();
    }
  });
  return t;
}

/** Off-white wall paint with grime near the floor. */
export function wallTex(): THREE.CanvasTexture {
  const r = mulberry32(0x3a11);
  return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#e4e6e2';
    x.fillRect(0, 0, w, h);
    for (let k = 0; k < 1800; k++) {
      x.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.05)';
      x.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
    }
    const g = x.createLinearGradient(0, h * 0.7, 0, h);
    g.addColorStop(0, 'rgba(70,60,40,0)');
    g.addColorStop(1, 'rgba(70,60,40,0.25)');
    x.fillStyle = g;
    x.fillRect(0, h * 0.7, w, h * 0.3);
  });
}

/** Suspended ceiling tiles. */
export function ceilingTex(): THREE.CanvasTexture {
  const r = mulberry32(0xce11);
  return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#d8dadb';
    x.fillRect(0, 0, w, h);
    for (let k = 0; k < 2500; k++) {
      x.fillStyle = 'rgba(0,0,0,0.06)';
      x.fillRect(r() * w, r() * h, 1.5, 1.5);
    }
    // One old water stain.
    const g = x.createRadialGradient(170, 90, 4, 170, 90, 40);
    g.addColorStop(0, 'rgba(150,120,60,0.25)');
    g.addColorStop(1, 'rgba(150,120,60,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#9a9ea2';
    x.lineWidth = 4;
    x.strokeRect(0, 0, w, h);
  });
}

/** White-ish product label; multiplied by the instance colour it reads as packaging. */
export function productTex(): THREE.CanvasTexture {
  return canvasTex(64, 64, (x, w, h) => {
    x.fillStyle = '#d0d0d0';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#ffffff';
    x.fillRect(0, h * 0.3, w, h * 0.28);
    x.fillStyle = '#7a7a7a';
    x.fillRect(8, h * 0.36, w - 16, 5);
    x.fillRect(8, h * 0.47, w * 0.5, 4);
    x.fillStyle = '#9a9a9a';
    x.beginPath();
    x.arc(w * 0.7, h * 0.78, 9, 0, Math.PI * 2);
    x.fill();
  });
}

/** Plastic beer crate side: ribs and a handle slot. */
export function crateTex(): THREE.CanvasTexture {
  return canvasTex(128, 96, (x, w, h) => {
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(0,0,0,0.28)';
    for (let i = 8; i < w; i += 16) x.fillRect(i, 26, 5, h - 34);
    x.fillStyle = '#1a1a1a';
    roundRect(x, w * 0.3, 8, w * 0.4, 12, 6);
    x.fill();
    x.fillStyle = 'rgba(0,0,0,0.35)';
    x.fillRect(0, h - 5, w, 5);
    x.fillRect(0, 0, w, 3);
  });
}

/** Window stickers and painted lettering; the big lettering faces the street (mirrored from inside). */
export function stickerTex(): THREE.CanvasTexture {
  const tex = canvasTex(2048, 512, (x, W, H) => {
    x.clearRect(0, 0, W, H);
    // Painted on the outside: reads backwards from the shop.
    x.save();
    x.translate(W, 0);
    x.scale(-1, 1);
    x.font = `bold 92px ${FONT}`;
    x.textAlign = 'center';
    x.fillStyle = 'rgba(255,255,255,0.92)';
    x.fillText('SPÄTI · RUND UM DIE UHR', W * 0.5, 104);
    x.font = `bold 46px ${FONT}`;
    x.fillStyle = 'rgba(20,200,180,0.95)';
    x.fillText('GETRÄNKE · TABAK · SNACKS · LOTTO · PAKETE', W * 0.5, 160);
    x.restore();
    const sticker = (cx: number, cy: number, w: number, h: number, bg: string, fg: string, lines: string[], size: number, round = false) => {
      x.save();
      x.translate(cx, cy);
      x.rotate((cx * 0.013) % 0.12 - 0.06);
      x.fillStyle = bg;
      if (round) {
        x.beginPath();
        x.arc(0, 0, w / 2, 0, Math.PI * 2);
        x.fill();
      } else {
        roundRect(x, -w / 2, -h / 2, w, h, 10);
        x.fill();
      }
      x.fillStyle = fg;
      x.font = `bold ${size}px ${FONT}`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      lines.forEach((l, i) => x.fillText(l, 0, (i - (lines.length - 1) / 2) * size * 1.15));
      x.restore();
    };
    sticker(170, 330, 240, 110, '#ffd23a', '#1a1a1a', ['KARTENZAHLUNG', 'AB 5 €'], 30);
    sticker(420, 300, 150, 150, '#e0263c', '#ffffff', ['18+', 'KEIN ALK', 'AN U18'], 26, true);
    sticker(640, 350, 260, 90, '#ffffff', '#1a1a1a', ['ICH BIN KEIN', 'GELDAUTOMAT'], 28);
    sticker(890, 310, 210, 120, '#1f6fd6', '#ffffff', ['PFAND-', 'ANNAHME'], 34);
    sticker(1140, 360, 300, 100, '#ffffff', '#c22b3a', ['BITTE NICHT VOR', 'DEM LADEN TRINKEN'], 26);
    sticker(1380, 300, 140, 140, '#14c8b4', '#08201d', ['WLAN?', 'NEIN.'], 30, true);
    sticker(1600, 345, 240, 100, '#ff3d8b', '#ffffff', ['KALTE', 'GETRÄNKE'], 32);
    sticker(1830, 300, 200, 120, '#f2f2f2', '#1a1a1a', ['PAKET-', 'SHOP'], 36);
    sticker(1060, 450, 120, 120, '#2a2a2a', '#ffd23a', ['HUND', 'DARF', 'REIN'], 22, true);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Lightbox text on a coloured face (signs over the counter and the fridges). */
export function signTex(text: string, sub: string, bg: string, fg: string, w = 1024, h = 160): THREE.CanvasTexture {
  const tex = canvasTex(w, h, (x) => {
    x.fillStyle = bg;
    x.fillRect(0, 0, w, h);
    x.fillStyle = fg;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = `bold ${Math.round(h * 0.5)}px ${FONT}`;
    x.fillText(text, w / 2, sub ? h * 0.4 : h * 0.52);
    if (sub) {
      x.font = `${Math.round(h * 0.18)}px ${FONT}`;
      x.fillText(sub, w / 2, h * 0.82);
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Back wall behind the counter: tobacco wall and scratch-card dispenser in one sheet. */
export function rackTex(): THREE.CanvasTexture {
  const r = mulberry32(0x7ac7);
  const tex = canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#20232a';
    x.fillRect(0, 0, w, h);
    // Tobacco packs: plain colours, grey warning band, no brands.
    const pc = ['#d8d4cc', '#1f2a5a', '#b22424', '#e8e8e8', '#3a6a3a', '#c9a24a', '#5a5a64', '#87a6c8'];
    for (let row = 0; row < 7; row++)
      for (let c = 0; c < 12; c++) {
        const px = 10 + c * 41;
        const py = 10 + row * 42;
        x.fillStyle = pc[Math.floor(r() * pc.length)];
        x.fillRect(px, py, 36, 34);
        x.fillStyle = '#6b6b6b';
        x.fillRect(px, py + 22, 36, 12);
      }
    // Scratch-card dispenser: colourful strips with invented game names.
    x.fillStyle = '#0b0d12';
    x.fillRect(0, 312, w, 200);
    const cards: [string, string][] = [
      ['GLÜCKSKLEE', '#2fb34a'],
      ['GOLDRAUSCH', '#e5b322'],
      ['KIEZKÖNIG', '#d63a8a'],
      ['DOPPELT', '#2f7ad6'],
      ['JACKPOTT', '#e0532a'],
      ['MONDSCHEIN', '#7a4ad6'],
    ];
    cards.forEach(([name, col], i) => {
      const px = 8 + i * 84;
      x.fillStyle = col;
      x.fillRect(px, 322, 78, 176);
      x.fillStyle = 'rgba(255,255,255,0.85)';
      x.fillRect(px + 6, 340, 66, 40);
      x.fillStyle = '#ffffff';
      x.font = `bold 13px ${FONT}`;
      x.textAlign = 'center';
      x.fillText(name, px + 39, 404);
      x.font = `bold 26px ${FONT}`;
      x.fillText(`${(i % 3) + 1} €`, px + 39, 446);
      x.fillStyle = 'rgba(0,0,0,0.3)';
      for (let k = 0; k < 4; k++) x.fillRect(px + 8 + k * 17, 470, 12, 12);
    });
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Price board above the counter, black with chalk-white prices. */
export function priceTex(): THREE.CanvasTexture {
  return canvasTex(512, 256, (x, w, h) => {
    x.fillStyle = '#121418';
    x.fillRect(0, 0, w, h);
    x.font = `bold 30px ${FONT}`;
    x.textBaseline = 'middle';
    const rows: [string, string][] = [
      ['Wegbier', '1,40'],
      ['Mate', '2,20'],
      ['Kaffee to go', '1,50'],
      ['Hot Dog', '2,90'],
      ['Slush groß', '2,50'],
    ];
    rows.forEach(([a, b], i) => {
      const y = 30 + i * 48;
      x.fillStyle = '#f2f2ea';
      x.textAlign = 'left';
      x.fillText(a, 20, y);
      x.fillStyle = '#ffd23a';
      x.textAlign = 'right';
      x.fillText(`${b} €`, w - 20, y);
    });
  });
}

/** House across the street: dark plaster, a few windows still lit at 3 a.m. */
export function facadeTex(): THREE.CanvasTexture {
  const r = mulberry32(0xfa5a);
  const tex = canvasTex(1024, 512, (x, w, h) => {
    x.fillStyle = '#2a2724';
    x.fillRect(0, 0, w, h);
    for (let k = 0; k < 4000; k++) {
      x.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.03)';
      x.fillRect(r() * w, r() * h, 2, 2);
    }
    // Ground floor: closed shop shutter with tags, and a house door.
    x.fillStyle = '#4a4c50';
    x.fillRect(80, 400, 360, 112);
    x.fillStyle = 'rgba(0,0,0,0.3)';
    for (let y = 404; y < 512; y += 7) x.fillRect(80, y, 360, 2);
    x.font = `bold 46px ${FONT}`;
    x.fillStyle = '#d63a8a';
    x.fillText('KIEZ', 120, 470);
    x.fillStyle = '#3ad6c4';
    x.fillText('OK', 300, 490);
    x.fillStyle = '#3a2a1e';
    x.fillRect(620, 392, 90, 120);
    for (let fl = 0; fl < 4; fl++)
      for (let c = 0; c < 8; c++) {
        const px = 40 + c * 124;
        const py = 30 + fl * 92;
        const lit = r();
        x.fillStyle = lit < 0.18 ? '#e8b060' : lit < 0.24 ? '#6a8ad8' : '#0c0d10';
        x.fillRect(px, py, 58, 62);
        if (lit < 0.24) {
          // Curtains.
          x.fillStyle = 'rgba(0,0,0,0.35)';
          x.fillRect(px, py, 14, 62);
          x.fillRect(px + 44, py, 14, 62);
        }
        x.fillStyle = '#3a3632';
        x.fillRect(px - 4, py + 62, 66, 5);
      }
  });
  return tex;
}

/** Wet asphalt with a dashed centre line. */
export function roadTex(): THREE.CanvasTexture {
  const r = mulberry32(0xa5f1);
  return canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#1b1c1f';
    x.fillRect(0, 0, w, h);
    for (let k = 0; k < 6000; k++) {
      const v = 20 + Math.floor(r() * 40);
      x.fillStyle = `rgb(${v},${v},${v + 3})`;
      x.fillRect(r() * w, r() * h, 2, 2);
    }
    x.fillStyle = '#b8b4a0';
    for (let i = 0; i < w; i += 128) x.fillRect(i, h / 2 - 5, 64, 10);
  });
}

/** Swirling slush: diagonal bands of one colour, scrolled by the update. */
export function slushTex(a: string, b: string): THREE.CanvasTexture {
  return canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = a;
    x.fillRect(0, 0, w, h);
    x.strokeStyle = b;
    x.lineWidth = 14;
    for (let i = -h; i < w + h; i += 32) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(i + h * 0.6, h);
      x.stroke();
    }
    x.fillStyle = 'rgba(255,255,255,0.18)';
    for (let k = 0; k < 60; k++) x.fillRect((k * 37) % w, (k * 53) % h, 3, 3);
  });
}

/** Sausage skin with grill stripes, so the rolling shows. */
export function sausageTex(): THREE.CanvasTexture {
  return canvasTex(64, 32, (x, w, h) => {
    x.fillStyle = '#b5633a';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#6a2e16';
    for (let i = 0; i < w; i += 16) x.fillRect(i, 0, 5, h);
    x.fillStyle = 'rgba(255,220,180,0.25)';
    x.fillRect(0, h * 0.2, w, 3);
  });
}

/** The owner's phone, propped against the till: a football match in the middle of the night. */
export function pitchTex(): THREE.CanvasTexture {
  return canvasTex(128, 64, (x, w, h) => {
    x.fillStyle = '#2f8a3a';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#36983f';
    for (let i = 0; i < w; i += 16) x.fillRect(i, 0, 8, h);
    x.strokeStyle = '#e8f4e8';
    x.lineWidth = 2;
    x.strokeRect(4, 4, w - 8, h - 8);
    x.beginPath();
    x.moveTo(w / 2, 4);
    x.lineTo(w / 2, h - 4);
    x.stroke();
    x.beginPath();
    x.arc(w / 2, h / 2, 10, 0, Math.PI * 2);
    x.stroke();
    x.fillStyle = '#e03a3a';
    for (const [px, py] of [[40, 20], [52, 40], [70, 28], [30, 44]]) x.fillRect(px, py, 3, 4);
    x.fillStyle = '#ffffff';
    for (const [px, py] of [[60, 18], [80, 36], [90, 22], [100, 44]]) x.fillRect(px, py, 3, 4);
    x.fillStyle = '#101010';
    x.fillRect(0, 0, 40, 9);
    x.fillStyle = '#ffffff';
    x.font = `bold 8px ${FONT}`;
    x.fillText('1 : 1  87′', 3, 7);
  });
}

/** Green emergency exit sign with a running figure and an arrow (generic pictogram). */
export function exitTex(): THREE.CanvasTexture {
  const tex = canvasTex(256, 96, (x, w, h) => {
    x.fillStyle = '#18b85a';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#ffffff';
    x.fillRect(12, 12, 64, 72);
    x.fillStyle = '#18b85a';
    x.fillRect(30, 20, 28, 64);
    x.fillStyle = '#ffffff';
    // Stick figure running to the door.
    x.beginPath();
    x.arc(118, 26, 8, 0, Math.PI * 2);
    x.fill();
    x.lineWidth = 8;
    x.strokeStyle = '#ffffff';
    x.lineCap = 'round';
    x.beginPath();
    x.moveTo(112, 38);
    x.lineTo(104, 60);
    x.moveTo(104, 60);
    x.lineTo(90, 80);
    x.moveTo(104, 60);
    x.lineTo(122, 80);
    x.moveTo(110, 44);
    x.lineTo(126, 54);
    x.moveTo(110, 44);
    x.lineTo(94, 48);
    x.stroke();
    x.beginPath();
    x.moveTo(170, 48);
    x.lineTo(230, 48);
    x.moveTo(212, 30);
    x.lineTo(232, 48);
    x.lineTo(212, 66);
    x.stroke();
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** "OFFEN" neon tube lettering on transparent ground; hangs in the window facing the street. */
export function neonTex(): THREE.CanvasTexture {
  const tex = canvasTex(512, 160, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.save();
    x.translate(w, 0);
    x.scale(-1, 1);
    x.font = `bold 108px ${FONT}`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineWidth = 9;
    x.strokeStyle = '#ffffff';
    x.strokeText('OFFEN', w / 2, h / 2 + 4);
    x.restore();
    x.strokeStyle = '#ffffff';
    x.lineWidth = 6;
    roundRect(x, 8, 8, w - 16, h - 16, 26);
    x.stroke();
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
