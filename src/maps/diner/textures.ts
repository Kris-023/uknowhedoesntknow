import * as THREE from 'three';
import { mulberry32 } from '../../core/rng';
import { canvasTex } from '../../scene/textures';
import { SIGN } from './config';

// Diner textures, all drawn at runtime. Fixed seeds: décor looks the same in every room.

export function checkerTex(): THREE.CanvasTexture {
  const rand = mulberry32(0xd1e2);
  return canvasTex(256, 256, (x, w, h) => {
    const t = w / 2;
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        x.fillStyle = (i + j) % 2 ? '#141416' : '#ddd3bd';
        x.fillRect(i * t, j * t, t, t);
      }
    // Forty years of mopping: grey scuffs, darker grout.
    for (let k = 0; k < 1800; k++) {
      x.fillStyle = rand() < 0.5 ? 'rgba(90,80,70,.07)' : 'rgba(255,255,255,.03)';
      x.fillRect(rand() * w, rand() * h, 1 + rand() * 4, 1 + rand() * 2);
    }
    x.fillStyle = 'rgba(30,26,22,.55)';
    for (const g of [0, t]) {
      x.fillRect(g, 0, 2, h);
      x.fillRect(0, g, w, 2);
    }
  });
}

/** Soft round blob: halos, reflections of lamps, smoke puffs. */
export function blobTex(): THREE.CanvasTexture {
  return canvasTex(64, 64, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
}

/** Lumpy smoke puff (lighter in the middle, ragged edge). */
export function smokeTex(): THREE.CanvasTexture {
  const rand = mulberry32(0x5303e);
  return canvasTex(128, 128, (x, w, h) => {
    for (let i = 0; i < 26; i++) {
      const r = 14 + rand() * 26;
      const cx = w / 2 + (rand() - 0.5) * 50;
      const cy = h / 2 + (rand() - 0.5) * 50;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(255,255,255,.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    }
  });
}

export function menuBoardTex(): THREE.CanvasTexture {
  return canvasTex(512, 256, (x, w, h) => {
    x.fillStyle = '#121214';
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#c9ced6';
    x.lineWidth = 6;
    x.strokeRect(4, 4, w - 8, h - 8);
    x.fillStyle = '#ff6d8f';
    x.font = 'bold 34px Georgia, serif';
    x.textAlign = 'center';
    x.fillText('Speisekarte', w / 2, 46);
    const items: [string, string][] = [
      ['Brätling klassisch', '6,90'],
      ['Doppelbrätling „Nachtschicht“', '8,90'],
      ['Pommes rot-weiß', '3,50'],
      ['Milchshake (Vanille/Erdbeer)', '4,20'],
      ['Kirschkuchen, Stück', '3,80'],
      ['Kaffee – Nachschenken gratis', '2,00'],
    ];
    x.font = '22px Georgia, serif';
    items.forEach(([name, price], i) => {
      const y = 86 + i * 29;
      x.fillStyle = '#efe6d0';
      x.textAlign = 'left';
      x.fillText(name, 26, y);
      x.textAlign = 'right';
      x.fillStyle = '#ffd36b';
      x.fillText(price, w - 26, y);
    });
  });
}

/** Folded table menu cover. */
export function tableMenuTex(): THREE.CanvasTexture {
  return canvasTex(128, 160, (x, w, h) => {
    x.fillStyle = '#9e1a22';
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#efe6d0';
    x.lineWidth = 4;
    x.strokeRect(8, 8, w - 16, h - 16);
    x.fillStyle = '#efe6d0';
    x.font = 'bold 22px Georgia, serif';
    x.textAlign = 'center';
    x.fillText('MENÜ', w / 2, 70);
    x.font = 'italic 13px Georgia, serif';
    x.fillText('seit 1961', w / 2, 96);
  });
}

export function clockTex(): THREE.CanvasTexture {
  return canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = '#f2ecdc';
    x.beginPath();
    x.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#1a1a1a';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r0 = i % 3 ? 50 : 44;
      x.save();
      x.translate(w / 2 + Math.sin(a) * r0, h / 2 - Math.cos(a) * r0);
      x.rotate(a);
      x.fillRect(-2, 0, 4, i % 3 ? 7 : 12);
      x.restore();
    }
  });
}

/**
 * The neon sign. Each letter is drawn on its own, so one can die without the rest: redraws only
 * when a letter's brightness step changes (a few times per flicker, never per frame).
 */
export class SignCanvas {
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private letters: { ch: string; x: number }[] = [];
  private shown = '';
  readonly count: number;

  constructor() {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 256;
    this.ctx = c.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const x = this.ctx;
    x.font = 'italic bold 112px Georgia, serif';
    const widths = [...SIGN.name].map((ch) => x.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + 6 * (widths.length - 1);
    let px = (c.width - total) / 2;
    for (let i = 0; i < widths.length; i++) {
      this.letters.push({ ch: SIGN.name[i], x: px });
      px += widths[i] + 6;
    }
    this.count = this.letters.length;
    this.draw(this.letters.map(() => 1), 1);
  }

  /** `k[i]` brightness of letter i (0..1), `sub` brightness of the "24h" line. */
  draw(k: readonly number[], sub: number): void {
    const key = k.map((v) => Math.round(v * 4)).join('') + Math.round(sub * 4);
    if (key === this.shown) return;
    this.shown = key;
    const x = this.ctx;
    const { width: w, height: h } = x.canvas;
    x.clearRect(0, 0, w, h);
    x.fillStyle = '#000';
    x.fillRect(0, 0, w, h);
    x.font = 'italic bold 112px Georgia, serif';
    x.textBaseline = 'alphabetic';
    this.letters.forEach((l, i) => {
      const v = k[i];
      // A dead tube still shows as dark glass, so the gap reads as a letter that is off.
      x.shadowColor = '#ff2f6a';
      x.shadowBlur = 26 * v;
      x.fillStyle = v > 0.05 ? `rgba(255,${Math.round(90 + 120 * v)},${Math.round(150 + 60 * v)},${0.25 + 0.75 * v})` : 'rgba(90,30,45,.6)';
      x.fillText(l.ch, l.x, 150);
    });
    x.font = 'bold 54px Arial, sans-serif';
    x.textAlign = 'center';
    x.shadowColor = '#34e6ff';
    x.shadowBlur = 18 * sub;
    x.fillStyle = sub > 0.05 ? `rgba(160,245,255,${0.3 + 0.7 * sub})` : 'rgba(30,60,70,.6)';
    x.fillText(SIGN.sub, w / 2, 225);
    x.textAlign = 'left';
    x.shadowBlur = 0;
    this.texture.needsUpdate = true;
  }
}

/** Mint Formica with the obligatory boomerangs and gold flecks. */
export function formicaTex(): THREE.CanvasTexture {
  const rand = mulberry32(0xf03a1c);
  return canvasTex(256, 128, (x, w, h) => {
    x.fillStyle = '#a7dccf';
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) {
      x.save();
      x.translate(rand() * w, rand() * h);
      x.rotate(rand() * Math.PI * 2);
      x.strokeStyle = rand() < 0.5 ? 'rgba(40,90,90,.45)' : 'rgba(230,120,120,.45)';
      x.lineWidth = 2.5;
      x.beginPath();
      x.moveTo(-9, 4);
      x.quadraticCurveTo(0, -6, 9, 4);
      x.stroke();
      x.restore();
    }
    for (let i = 0; i < 260; i++) {
      x.fillStyle = rand() < 0.6 ? 'rgba(200,160,60,.7)' : 'rgba(255,255,255,.5)';
      x.fillRect(rand() * w, rand() * h, 1.5, 1.5);
    }
  });
}
