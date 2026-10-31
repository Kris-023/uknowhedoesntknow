import * as THREE from 'three';
import { COLORS } from '../config';
import type { Players } from '../game/players';
import { el } from './dom';
import { Placer, trackSize, type Size } from './stageSize';

/**
 * Names above the heads as HTML, projected each frame. HTML stays sharp at any zoom, needs no
 * font texture and never catches bloom, unlike a sprite in the scene.
 */
export class NameTags {
  private root = el('div', 'nametags');
  private tags: HTMLElement[] = [];
  private placers: Placer[] = [];
  private v = new THREE.Vector3();
  private size: Size;

  constructor(
    host: HTMLElement,
    private players: Players,
    private camera: THREE.PerspectiveCamera,
    stage: HTMLElement,
  ) {
    this.size = trackSize(stage);
    this.root.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < players.people.length; i++) {
      const t = el('span', 'nametag');
      t.style.setProperty('--c', `#${COLORS.players[i].toString(16).padStart(6, '0')}`);
      this.root.append(t);
      this.tags.push(t);
      this.placers.push(new Placer(t));
    }
    host.append(this.root);
  }

  /** Another world (map change): same seats, new people and camera. */
  setView(players: Players, camera: THREE.PerspectiveCamera): void {
    this.players = players;
    this.camera = camera;
  }

  /** `level(i)`: current voice level of seat i, to highlight who is speaking. */
  update(pov: boolean, level: (i: number) => number, hide: (i: number) => boolean = () => false): void {
    const { w, h } = this.size;
    this.players.people.forEach((p, i) => {
      const t = this.tags[i];
      const self = pov && i === this.players.active;
      const name = p.name;
      if (!this.players.occupied[i] || self || !name || hide(i)) {
        if (!t.hidden) t.hidden = true;
        return;
      }
      this.players.labelPos(i, this.v).project(this.camera);
      // Behind the camera, or off screen.
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1) {
        if (!t.hidden) t.hidden = true;
        return;
      }
      if (t.hidden) t.hidden = false;
      const talking = level(i) > 0.12;
      if (t.classList.contains('talking') !== talking) t.classList.toggle('talking', talking);
      if (t.textContent !== name) t.textContent = name;
      this.placers[i].place(((this.v.x + 1) / 2) * w, ((1 - this.v.y) / 2) * h);
    });
  }
}
