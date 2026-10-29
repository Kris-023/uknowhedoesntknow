import * as THREE from 'three';
import { mulberry32 } from '../../core/rng';
import { canvasTex } from '../../scene/textures';
import { COLORS, NUMBERS } from './config';

// Every texture is drawn here at runtime. Décor uses a fixed seed: it is the same hall in every room.

export type Rect = readonly [number, number, number, number];

/** Pixel rects in the 1024² sign atlas; one material for all posters, signs and the clock face. */
export const SIGNS = {
  ziehen: [0, 0, 256, 360],
  formular: [256, 0, 256, 360],
  handy: [512, 0, 256, 360],
  wartezeit: [768, 0, 256, 360],
  schalter1: [0, 380, 256, 96],
  schalter2: [256, 380, 256, 96],
  schalter3: [512, 380, 256, 96],
  geschlossen: [768, 380, 256, 128],
  clock: [0, 520, 256, 256],
  personal: [256, 520, 256, 80],
  leitung: [256, 610, 256, 80],
  nummer: [512, 520, 256, 96],
  form: [512, 640, 128, 160],
} as const satisfies Record<string, Rect>;
export const SIGN_SIZE = 1024;

/** Rects in the 512×256 screen atlas (counter monitors and the ticket dispenser). */
export const SCREENS = { monitor: [0, 0, 256, 192], ticket: [256, 0, 256, 128] } as const satisfies Record<string, Rect>;
export const SCREEN_SIZE: readonly [number, number] = [512, 256];

const FONT = 'Arial, Helvetica, sans-serif';

function speckle(x: CanvasRenderingContext2D, w: number, h: number, n: number, rand: () => number, a: number): void {
  for (let i = 0; i < n; i++) {
    x.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.6})`;
    x.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

export interface HallTextures {
  floor: THREE.CanvasTexture;
  wall: THREE.CanvasTexture;
  ceiling: THREE.CanvasTexture;
  signs: THREE.CanvasTexture;
  screenOk: THREE.CanvasTexture;
  screenErr: THREE.CanvasTexture;
  exit: THREE.CanvasTexture;
  night: THREE.CanvasTexture;
}

export function makeHallTextures(): HallTextures {
  const rand = mulberry32(0x5b17a);

  // Linoleum tiles, 2×2 per texture repeat (one repeat = 1 m), worn in the middle.
  const floor = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = COLORS.floor;
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const v = 0.03 + rand() * 0.05;
      x.fillStyle = `rgba(${rand() < 0.5 ? '255,250,230' : '0,0,0'},${v})`;
      x.fillRect((i % 2) * 128, Math.floor(i / 2) * 128, 128, 128);
    }
    speckle(x, w, h, 3000, rand, 0.05);
    x.fillStyle = 'rgba(0,0,0,.35)';
    x.fillRect(0, 0, w, 2);
    x.fillRect(0, 0, 2, h);
    x.fillRect(0, 127, w, 2);
    x.fillRect(127, 0, 2, h);
  });

  // One repeat spans the full wall height (v) and 2 m across (u): green gloss paint below a rail, nicotine beige above.
  const wall = canvasTex(256, 384, (x, w, h) => {
    x.fillStyle = COLORS.wallHigh;
    x.fillRect(0, 0, w, h);
    const rail = h * (1 - 1.25 / 3);
    x.fillStyle = COLORS.wallLow;
    x.fillRect(0, rail, w, h - rail);
    x.fillStyle = 'rgba(0,0,0,.35)';
    x.fillRect(0, rail - 4, w, 6);
    x.fillStyle = 'rgba(255,255,255,.08)';
    x.fillRect(0, rail - 6, w, 2);
    speckle(x, w, h, 2200, rand, 0.03);
    // Chair-back scuffs on the lower paint.
    x.fillStyle = 'rgba(0,0,0,.12)';
    for (let i = 0; i < 6; i++) x.fillRect(rand() * w, h * 0.78 + rand() * 20, 20 + rand() * 40, 3);
  });

  // Suspended ceiling, 0.6 m tiles; four per repeat.
  const ceiling = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = COLORS.ceiling;
    x.fillRect(0, 0, w, h);
    speckle(x, w, h, 4000, rand, 0.06);
    x.fillStyle = '#4a4943';
    for (let i = 0; i < 2; i++) {
      x.fillRect(i * 128, 0, 4, h);
      x.fillRect(0, i * 128, w, 4);
    }
    // One water stain, every hall has one.
    const g = x.createRadialGradient(190, 70, 4, 190, 70, 40);
    g.addColorStop(0, 'rgba(120,90,40,.0)');
    g.addColorStop(0.8, 'rgba(120,90,40,.25)');
    g.addColorStop(1, 'rgba(120,90,40,0)');
    x.fillStyle = g;
    x.fillRect(140, 20, 100, 100);
  });

  const signs = canvasTex(SIGN_SIZE, SIGN_SIZE, (x) => {
    x.fillStyle = '#222';
    x.fillRect(0, 0, SIGN_SIZE, SIGN_SIZE);
    const poster = (r: Rect, bg: string, head: string, headCol: string, lines: string[], foot: string) => {
      const [px, py, w, h] = r;
      x.fillStyle = bg;
      x.fillRect(px, py, w, h);
      x.fillStyle = headCol;
      x.fillRect(px, py, w, 70);
      x.fillStyle = '#fff';
      x.font = `bold 26px ${FONT}`;
      x.textAlign = 'center';
      x.fillText(head, px + w / 2, py + 46);
      x.fillStyle = '#1b1b1b';
      x.font = `bold 25px ${FONT}`;
      lines.forEach((l, i) => x.fillText(l, px + w / 2, py + 120 + i * 34));
      x.font = `14px ${FONT}`;
      x.fillStyle = '#555';
      x.fillText(foot, px + w / 2, py + h - 18);
      // Tape at the corners: nobody frames anything here.
      x.fillStyle = 'rgba(230,225,200,.7)';
      x.fillRect(px + 4, py + 2, 34, 12);
      x.fillRect(px + w - 38, py + 2, 34, 12);
    };
    poster(SIGNS.ziehen, '#efe9d6', 'HINWEIS', '#2b4f8a', ['Bitte', 'Nummer', 'ziehen.', 'Bitte warten.'], 'Ihre Verwaltung');
    poster(SIGNS.formular, '#e6e2cf', 'NEU', '#8a2b2b', ['Formular 12', 'ersetzt', 'Formular 12.', '(siehe Formular 12)'], 'gültig ab sofort, rückwirkend');
    poster(SIGNS.handy, '#efe9d6', 'ACHTUNG', '#2b4f8a', ['Kein', 'Handyempfang', 'erwünscht.', ''], 'Danke für Ihr Verständnis');
    poster(SIGNS.wartezeit, '#ece4c8', 'SERVICE', '#3b6b3b', ['Aktuelle', 'Wartezeit:', 'ca. 4–7', 'Werktage'], 'Wir sind gern für Sie da');
    // A sad smiley drawn on the handy poster by someone in the queue.
    {
      const [px, py] = SIGNS.handy;
      x.strokeStyle = '#2a2a90';
      x.lineWidth = 3;
      x.beginPath();
      x.arc(px + 200, py + 290, 18, 0, Math.PI * 2);
      x.moveTo(px + 190, py + 302);
      x.quadraticCurveTo(px + 200, py + 292, px + 210, py + 302);
      x.stroke();
      x.fillStyle = '#2a2a90';
      x.fillRect(px + 192, py + 282, 4, 4);
      x.fillRect(px + 204, py + 282, 4, 4);
    }
    const plate = (r: Rect, bg: string, fg: string, text: string, size: number) => {
      const [px, py, w, h] = r;
      x.fillStyle = bg;
      x.fillRect(px, py, w, h);
      x.fillStyle = fg;
      x.font = `bold ${size}px ${FONT}`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(text, px + w / 2, py + h / 2 + 2);
      x.textBaseline = 'alphabetic';
    };
    plate(SIGNS.schalter1, '#1d3d6e', '#e8eef8', 'Schalter 1', 40);
    plate(SIGNS.schalter2, '#1d3d6e', '#e8eef8', 'Schalter 2', 40);
    plate(SIGNS.schalter3, '#1d3d6e', '#e8eef8', 'Schalter 3', 40);
    {
      const [px, py, w, h] = SIGNS.geschlossen;
      x.fillStyle = '#f2f0e8';
      x.fillRect(px, py, w, h);
      x.strokeStyle = '#b02020';
      x.lineWidth = 8;
      x.strokeRect(px + 6, py + 6, w - 12, h - 12);
      x.fillStyle = '#b02020';
      x.font = `bold 34px ${FONT}`;
      x.textAlign = 'center';
      x.fillText('GESCHLOSSEN', px + w / 2, py + 62);
      x.font = `16px ${FONT}`;
      x.fillStyle = '#333';
      x.fillText('Bitte nächsten Schalter nutzen', px + w / 2, py + 98);
    }
    {
      const [px, py, w] = SIGNS.clock;
      const cx = px + w / 2;
      const cy = py + w / 2;
      x.fillStyle = '#ece9df';
      x.beginPath();
      x.arc(cx, cy, 124, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = '#1a1a1a';
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2;
        const big = i % 5 === 0;
        x.save();
        x.translate(cx + Math.sin(a) * 108, cy - Math.cos(a) * 108);
        x.rotate(a);
        x.fillRect(-(big ? 4 : 1.5), -(big ? 12 : 5), big ? 8 : 3, big ? 24 : 10);
        x.restore();
      }
    }
    plate(SIGNS.personal, '#e8e4d8', '#222', 'Nur Personal', 30);
    plate(SIGNS.leitung, '#e8e4d8', '#222', 'Büro 0.17 · Leitung', 26);
    plate(SIGNS.nummer, '#c41f1f', '#fff', 'Bitte Nummer ziehen', 26);
    {
      const [px, py, w, h] = SIGNS.form;
      x.fillStyle = '#f4f2ea';
      x.fillRect(px, py, w, h);
      x.fillStyle = '#222';
      x.font = `bold 12px ${FONT}`;
      x.textAlign = 'left';
      x.fillText('Formular 12', px + 8, py + 18);
      x.fillStyle = '#999';
      for (let i = 0; i < 9; i++) {
        x.fillRect(px + 8, py + 34 + i * 13, w - 16, 1);
        x.strokeStyle = '#999';
        x.strokeRect(px + w - 20, py + 26 + i * 13, 7, 7);
      }
    }
  });

  const screen = (err: boolean) =>
    canvasTex(SCREEN_SIZE[0], SCREEN_SIZE[1], (x) => {
      const [mx, my, mw, mh] = SCREENS.monitor;
      const [tx, ty, tw, th] = SCREENS.ticket;
      x.textAlign = 'left';
      if (err) {
        // Generic system blue with an error text; no real operating system's screen.
        for (const [px, py, w, h] of [SCREENS.monitor, SCREENS.ticket]) {
          x.fillStyle = '#1238b4';
          x.fillRect(px, py, w, h);
        }
        x.fillStyle = '#e6ecff';
        x.font = `bold 20px ${FONT}`;
        x.fillText('SYSTEMAUSFALL', mx + 14, my + 34);
        x.font = `13px ui-monospace, Consolas, monospace`;
        ['Fehler 0x0000F12:', 'Formular 12 nicht gefunden', '(ersetzt durch Formular 12).', '', 'Bitte ziehen Sie eine', 'neue Nummer.', '', 'Neustart in ∞ Sekunden …'].forEach((l, i) =>
          x.fillText(l, mx + 14, my + 62 + i * 16),
        );
        x.font = `bold 18px ${FONT}`;
        x.fillText('STÖRUNG', tx + 14, ty + 34);
        x.font = `14px ${FONT}`;
        x.fillText('Nummernvergabe neu', tx + 14, ty + 64);
        x.fillText('gestartet: 0001', tx + 14, ty + 84);
        return;
      }
      // Late-shift desktop: grey-blue, a form window that never finishes loading.
      x.fillStyle = '#26394c';
      x.fillRect(mx, my, mw, mh);
      x.fillStyle = '#c9d3dc';
      x.fillRect(mx + 18, my + 22, mw - 36, mh - 56);
      x.fillStyle = '#3f5c7a';
      x.fillRect(mx + 18, my + 22, mw - 36, 16);
      x.fillStyle = '#fff';
      x.font = `bold 11px ${FONT}`;
      x.fillText('Vorgang 12 – Bearbeitung', mx + 24, my + 34);
      x.fillStyle = '#7d8a96';
      for (let i = 0; i < 5; i++) x.fillRect(mx + 28, my + 52 + i * 16, 90 + ((i * 37) % 80), 6);
      x.fillStyle = '#4a6e94';
      x.fillRect(mx + 28, my + 136, (mw - 56) * 0.97, 8);
      x.fillStyle = '#9aa6b2';
      x.fillRect(mx, my + mh - 22, mw, 22);
      // Dispenser: a cheap LCD that knows the players' number.
      x.fillStyle = '#20302a';
      x.fillRect(tx, ty, tw, th);
      x.fillStyle = '#9ff0c0';
      x.font = `bold 18px ${FONT}`;
      x.fillText('Ihre Nummer:', tx + 14, ty + 34);
      x.font = `bold 44px ui-monospace, Consolas, monospace`;
      x.fillText(NUMBERS.mine, tx + 14, ty + 84);
      x.font = `14px ${FONT}`;
      x.fillText('Wartezeit: unbekannt', tx + 14, ty + 112);
    });

  const exit = canvasTex(256, 96, (x, w, h) => {
    x.fillStyle = '#0f7a3c';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#e8fff0';
    x.font = `bold 34px ${FONT}`;
    x.textAlign = 'center';
    x.fillText('NOTAUSGANG', w / 2 + 22, h / 2 + 12);
    // A plain arrow; deliberately not the standard pictogram.
    x.beginPath();
    x.moveTo(14, h / 2);
    x.lineTo(40, h / 2 - 20);
    x.lineTo(40, h / 2 - 8);
    x.lineTo(58, h / 2 - 8);
    x.lineTo(58, h / 2 + 8);
    x.lineTo(40, h / 2 + 8);
    x.lineTo(40, h / 2 + 20);
    x.fill();
  });

  // Windows: night outside, half-closed blinds, a sodium street lamp somewhere down the road.
  const night = canvasTex(256, 256, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#05070e');
    g.addColorStop(0.7, '#0c1424');
    g.addColorStop(1, '#1a1a1e');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    const lamp = x.createRadialGradient(170, 120, 2, 170, 120, 70);
    lamp.addColorStop(0, 'rgba(255,170,70,.9)');
    lamp.addColorStop(0.2, 'rgba(255,140,50,.35)');
    lamp.addColorStop(1, 'rgba(255,120,40,0)');
    x.fillStyle = lamp;
    x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(150,145,130,.85)';
    for (let i = 0; i < 9; i++) x.fillRect(0, i * 14, w, 9);
    x.fillStyle = '#2a2b2e';
    x.fillRect(0, 0, w, 6);
    x.fillRect(0, h - 6, w, 6);
    x.fillRect(0, 0, 6, h);
    x.fillRect(w - 6, 0, 6, h);
    x.fillRect(w / 2 - 3, 0, 6, h);
  });

  return { floor, wall, ceiling, signs, screenOk: screen(false), screenErr: screen(true), exit, night };
}

/**
 * Red LED number display. Redraws only when its text changes; the dots fake a matrix display
 * without a font file.
 */
export class LedDisplay {
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private shown = '';
  private mask: HTMLCanvasElement;

  constructor() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 192;
    this.ctx = c.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    // Pixel grid laid over the text; dark gaps between the LEDs.
    this.mask = document.createElement('canvas');
    this.mask.width = 512;
    this.mask.height = 192;
    const m = this.mask.getContext('2d')!;
    m.fillStyle = 'rgba(0,0,0,.55)';
    for (let i = 0; i < 512; i += 6) m.fillRect(i, 0, 2, 192);
    for (let j = 0; j < 192; j += 6) m.fillRect(0, j, 512, 2);
  }

  draw(num: string, desk: number | null, lit: boolean): void {
    const key = `${num}|${desk}|${lit}`;
    if (key === this.shown) return;
    this.shown = key;
    const x = this.ctx;
    x.fillStyle = '#120404';
    x.fillRect(0, 0, 512, 192);
    if (lit) {
      x.fillStyle = '#ff3a1a';
      x.textBaseline = 'middle';
      x.textAlign = 'left';
      x.font = `bold 120px ui-monospace, Consolas, monospace`;
      x.fillText(num, 22, 100);
      x.font = `bold 34px ${FONT}`;
      x.fillText(desk === null ? '' : '→ Schalter', 310, 62);
      x.font = `bold 92px ${FONT}`;
      x.fillText(desk === null ? '' : String(desk), 400, 132);
    }
    x.drawImage(this.mask, 0, 0);
    this.texture.needsUpdate = true;
  }
}
