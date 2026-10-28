import * as THREE from 'three';
import { COLORS } from '../config';
import type { Players } from '../game/players';
import { el } from './dom';

/**
 * Names above the heads as HTML, projected each frame. HTML stays sharp at any zoom, needs no
 * font texture and never catches bloom, unlike a sprite in the scene.
 */
export class NameTags {
  private root = el('div', 'nametags');
  private tags: HTMLElement[] = [];
  private v = new THREE.Vector3();

  constructor(
    host: HTMLElement,
    private players: Players,
    private camera: THREE.PerspectiveCamera,
    private stage: HTMLElement,
  ) {
    this.root.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < players.people.length; i++) {
      const t = el('span', 'nametag');
      t.style.setProperty('--c', `#${COLORS.players[i].toString(16).padStart(6, '0')}`);
      this.root.append(t);
      this.tags.push(t);
    }
    host.append(this.root);
  }

  /** `level(i)`: current voice level of seat i, to highlight who is speaking. */
  update(pov: boolean, level: (i: number) => number, hide: (i: number) => boolean = () => false): void {
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    this.players.people.forEach((p, i) => {
      const t = this.tags[i];
      const self = pov && i === this.players.active;
      const name = p.name;
      if (!this.players.occupied[i] || self || !name || hide(i)) {
        t.hidden = true;
        return;
      }
      this.players.labelPos(i, this.v).project(this.camera);
      // Behind the camera, or off screen.
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1) {
        t.hidden = true;
        return;
      }
      t.hidden = false;
      t.classList.toggle('talking', level(i) > 0.12);
      if (t.textContent !== name) t.textContent = name;
      t.style.transform = `translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * h}px) translate(-50%, -100%)`;
    });
  }
}
