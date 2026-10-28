import * as THREE from 'three';
import { Person, type PersonState } from '../characters/person';

/**
 * Small turntable with your own character for the menus. Its own renderer, so it works before the
 * game world exists; `dispose()` frees the WebGL context when the menu closes.
 */
export class CharacterPreview {
  readonly canvas = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
  private turn = new THREE.Group();
  private person: Person;
  private raf = 0;
  private last = 0;
  private spin = 0;
  private drag: { x: number; spin: number } | null = null;

  constructor(state: PersonState) {
    this.canvas.className = 'preview-canvas';
    this.canvas.setAttribute('aria-label', 'Vorschau deiner Figur, zum Drehen ziehen');
    this.canvas.setAttribute('role', 'img');
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    } catch {
      this.renderer = null;
    }
    // Night-coach mood: cool fill from above, warm amber rim from behind, like the menu.
    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x10131c, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(1.5, 2.5, 3);
    const rim = new THREE.DirectionalLight(0xffb224, 2.2);
    rim.position.set(-2, 1.6, -2.5);
    this.scene.add(key, rim, this.turn);
    const root = new THREE.Group();
    // Standing pose: feet at y = 0.
    root.position.y = 0.9;
    this.turn.add(root);
    this.person = new Person(root, state.look, 'stand');
    this.set(state);
    // Framed with room above the head for tall items (pineapple, cone).
    this.camera.position.set(0, 1.2, 5.3);
    this.camera.lookAt(0, 1.05, 0);

    this.canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, spin: this.spin };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.drag) this.spin = this.drag.spin + (e.clientX - this.drag.x) * 0.012;
    });
    const end = () => (this.drag = null);
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  set(state: PersonState): void {
    const p = this.person;
    p.name = state.name;
    if (JSON.stringify(p.look) !== JSON.stringify(state.look)) p.setLook(state.look);
    for (const s of ['head', 'hand', 'arm', 'hip'] as const) {
      const id = state.items[s];
      if (p.items[s] !== id) id ? p.equip(id) : p.unequip(s);
    }
    p.settle();
  }

  private frame(now: number): void {
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const r = this.renderer;
    if (!r || !this.canvas.isConnected) return;
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * r.getPixelRatio()) || this.canvas.height !== Math.round(h * r.getPixelRatio())) {
      r.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (!this.drag) this.spin += dt * 0.35;
    this.turn.rotation.y = this.spin;
    const t = now / 1000;
    // Idle: look around a little, so the head reads as alive.
    this.person.update(dt, t, 0.35 * Math.sin(t * 0.7), 0.05 * Math.sin(t * 0.5), 3, 0);
    r.render(this.scene, this.camera);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
    this.canvas.remove();
  }
}
