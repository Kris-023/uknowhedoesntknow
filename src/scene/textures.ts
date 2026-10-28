import * as THREE from 'three';
import { TEXTURE_SEED } from '../config';
import { mulberry32 } from '../core/rng';

// All textures are drawn at runtime: zero image files, nothing to license or host.

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

export function canvasTex(w: number, h: number, draw: Draw): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function tiled(tex: THREE.Texture, rx: number, ry: number): THREE.Texture {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(rx, ry);
  return t;
}

export interface CoachTextures {
  grain: THREE.CanvasTexture;
  floor: THREE.CanvasTexture;
  wall: THREE.CanvasTexture;
  vent: THREE.CanvasTexture;
  frame: THREE.CanvasTexture;
  glow: THREE.CanvasTexture;
  line: THREE.CanvasTexture;
}

export function makeCoachTextures(): CoachTextures {
  // Fixed seed: wall scratches are décor, not lobby state, and should look the same in every lobby.
  const rand = mulberry32(TEXTURE_SEED);

  const grain = canvasTex(128, 128, (x, w, h) => {
    for (let i = 0; i < 4000; i++) {
      const v = Math.floor(90 + rand() * 120);
      x.fillStyle = `rgb(${v},${v},${v})`;
      x.fillRect(rand() * w, rand() * h, 2, 2);
    }
  });

  const panel = (base: string, seam: boolean) =>
    canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = base;
      x.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        x.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.06)';
        x.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
      }
      x.strokeStyle = 'rgba(0,0,0,.08)';
      for (let i = 0; i < 14; i++) {
        x.beginPath();
        x.moveTo(rand() * w, rand() * h);
        x.lineTo(rand() * w, rand() * h);
        x.stroke();
      }
      if (seam) {
        x.fillStyle = 'rgba(0,0,0,.4)';
        x.fillRect(0, 0, 2, h);
        x.fillRect(0, 0, w, 2);
      }
    });

  const vent = canvasTex(100, 256, (x, w, h) => {
    x.fillStyle = '#25282d';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#8f96a0';
    for (let i = 6; i < w - 4; i += 5) x.fillRect(i, 8, 2, h - 16);
    x.strokeStyle = '#a9afb8';
    x.lineWidth = 4;
    x.strokeRect(2, 2, w - 4, h - 4);
  });

  const frame = canvasTex(128, 160, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.strokeStyle = '#cfe0ff';
    x.lineWidth = 7;
    x.shadowColor = '#8fb0ff';
    x.shadowBlur = 14;
    x.strokeRect(18, 18, w - 36, h - 36);
  });

  // Soft falloff across and along the neon tube; additive planes with this map fake bloom cheaply.
  const glow = canvasTex(32, 128, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(60,90,255,0)');
    g.addColorStop(0.5, 'rgba(60,90,255,0.9)');
    g.addColorStop(1, 'rgba(60,90,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'destination-in';
    const g2 = x.createLinearGradient(0, 0, 0, h);
    g2.addColorStop(0, 'rgba(0,0,0,0)');
    g2.addColorStop(0.15, 'rgba(0,0,0,1)');
    g2.addColorStop(0.85, 'rgba(0,0,0,1)');
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g2;
    x.fillRect(0, 0, w, h);
  });

  const line = canvasTex(280, 80, (x, w) => {
    x.fillStyle = '#08142e';
    x.fillRect(0, 0, w, 80);
    x.fillStyle = '#3a7bff';
    x.fillRect(14, 38, w - 28, 5);
    const names = ['Nordtor', 'Kreuzung', 'Kotti', 'Ring', 'Süd'];
    x.font = 'bold 12px Arial, sans-serif';
    x.textAlign = 'center';
    names.forEach((name, i) => {
      const px = 30 + i * 55;
      x.fillStyle = '#08142e';
      x.beginPath();
      x.arc(px, 40.5, 8, 0, Math.PI * 2);
      x.fill();
      x.lineWidth = 3;
      x.strokeStyle = '#bcd0ff';
      x.stroke();
      x.fillStyle = '#bcd0ff';
      x.fillText(name, px, 66);
    });
    x.textAlign = 'left';
    x.font = 'bold 16px Arial, sans-serif';
    x.fillStyle = '#ffffff';
    x.fillText('LINIE 7', 14, 22);
  });

  return { grain, floor: panel('#5b5f67', false), wall: panel('#30353c', true), vent, frame, glow, line };
}

/** Halt countdown screen. Redraws only when the displayed second changes. */
export class HaltDisplay {
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private shown = -1;

  constructor() {
    const c = document.createElement('canvas');
    c.width = 280;
    c.height = 80;
    this.ctx = c.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  draw(secondsLeft: number): void {
    if (secondsLeft === this.shown) return;
    this.shown = secondsLeft;
    const x = this.ctx;
    const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
    const ss = String(secondsLeft % 60).padStart(2, '0');
    x.fillStyle = '#08142e';
    x.fillRect(0, 0, 280, 80);
    x.fillStyle = '#6f8cff';
    x.font = 'bold 13px Arial, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'alphabetic';
    x.fillText('NÄCHSTER HALT', 140, 24);
    x.fillStyle = '#ffffff';
    x.font = 'bold 34px ui-monospace, Menlo, Consolas, monospace';
    x.textBaseline = 'middle';
    x.fillText(`${mm}:${ss}`, 140, 52);
    this.texture.needsUpdate = true;
  }
}
