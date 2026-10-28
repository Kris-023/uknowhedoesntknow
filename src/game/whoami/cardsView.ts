import * as THREE from 'three';
import { COLORS, WHOAMI } from '../../config';
import { el } from '../../ui/dom';
import { Placer, trackSize, type Size } from '../../ui/stageSize';
import { settings } from '../../ui/store';
import type { Players } from '../players';

/** Very wide or tall pictures are clamped, so a card never turns into a strip. */
const ASPECT = { min: 0.6, max: 1.7 };

/**
 * Cards above the heads (backlog B1): HTML on top of the canvas, so they are sharp, never glow,
 * ignore night light and blackouts, and grow with the right-mouse zoom like the scene does. They
 * always face you, which helps reading them from the side. The card takes the picture's aspect
 * ratio (no white bars) and carries the player's name, which replaces the name tag meanwhile.
 */
export class CardsView {
  private root = el('div', 'cards-layer');
  private tags: {
    box: HTMLElement;
    img: HTMLImageElement;
    name: HTMLElement;
    src: string;
    aspect: number;
    placer: Placer;
    /** Last written width, font size and stacking, so unchanged styles aren't rewritten (width means layout). */
    px: number;
    font: number;
    z: number;
  }[] = [];
  private size: Size;
  private v = new THREE.Vector3();
  private cam = new THREE.Vector3();
  /** Seats whose card is on screen right now (their name tag steps aside). */
  readonly shown = new Set<number>();

  constructor(
    host: HTMLElement,
    private players: Players,
    private camera: THREE.PerspectiveCamera,
    stage: HTMLElement,
  ) {
    this.size = trackSize(stage);
    this.root.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < players.people.length; i++) {
      const box = el('div', 'card-tag');
      box.style.setProperty('--c', `#${COLORS.players[i].toString(16).padStart(6, '0')}`);
      // Picture on top with its own aspect ratio, the name in a strip below it (never over the picture).
      const pic = el('div', 'card-pic');
      const img = el('img');
      img.alt = '';
      pic.append(img);
      const name = el('span', 'card-name');
      box.append(pic, name);
      box.hidden = true;
      this.root.append(box);
      const tag = { box, img, name, src: '', aspect: 1, placer: new Placer(box), px: NaN, font: NaN, z: NaN };
      img.addEventListener('load', () => {
        tag.aspect = Math.min(ASPECT.max, Math.max(ASPECT.min, img.naturalWidth / Math.max(1, img.naturalHeight)));
        pic.style.aspectRatio = String(tag.aspect);
      });
      this.tags.push(tag);
    }
    host.append(this.root);
  }

  /** `cardOf(seat)`: image for that seat, '?' for a hidden own card, null for none. */
  update(cardOf: (seat: number) => string | '?' | null, nameOf: (seat: number) => string, pov: boolean): void {
    const { w, h } = this.size;
    this.camera.getWorldPosition(this.cam);
    const focal = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    this.shown.clear();
    this.tags.forEach((t, seat) => {
      const card = this.players.occupied[seat] ? cardOf(seat) : null;
      // Your own head is the camera in POV: nothing to see there.
      if (!card || (pov && seat === this.players.active)) {
        if (!t.box.hidden) t.box.hidden = true;
        return;
      }
      this.players.cardPos(seat, this.v);
      const dist = this.v.distanceTo(this.cam);
      this.v.project(this.camera);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.3 || Math.abs(this.v.y) > 1.3) {
        if (!t.box.hidden) t.box.hidden = true;
        return;
      }
      this.shown.add(seat);
      if (t.box.hidden) t.box.hidden = false;
      t.box.classList.toggle('back', card === '?');
      const src = card === '?' ? '' : card;
      if (t.src !== src) {
        t.src = src;
        if (src) t.img.src = src;
        else {
          t.img.removeAttribute('src');
          t.aspect = 1;
          (t.box.firstElementChild as HTMLElement).style.aspectRatio = '1';
        }
      }
      const name = nameOf(seat);
      if (t.name.textContent !== name) t.name.textContent = name;
      // Same area for every aspect ratio, so no card looks more important than another.
      const px = Math.max(28, (WHOAMI.cardSizeM * settings.cardScale * focal) / dist) * Math.sqrt(t.aspect);
      // Negated so the first frame (t.px still NaN) writes too.
      if (!(Math.abs(px - t.px) <= 0.5)) {
        t.px = px;
        t.box.style.width = `${px.toFixed(1)}px`;
      }
      const font = Math.round(Math.max(9, Math.min(16, px / 9)) * 2) / 2;
      if (font !== t.font) {
        t.font = font;
        t.box.style.fontSize = `${font}px`;
      }
      const z = Math.round(1000 - dist * 50);
      if (z !== t.z) {
        t.z = z;
        t.box.style.zIndex = String(z);
      }
      // The anchor is the card's bottom edge, just above the head.
      t.placer.place(((this.v.x + 1) / 2) * w, ((1 - this.v.y) / 2) * h);
    });
  }
}
