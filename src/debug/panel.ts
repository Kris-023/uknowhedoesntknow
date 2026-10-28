import { HALT_CYCLE_S, PLAYER_SEATS, SHAKE, SPEED } from '../config';
import { haltCountdown } from '../core/motion';
import type { CamMode, WorldParams } from '../scene/world';
import { ROLE_COLORS } from './sight';

export interface PanelState extends WorldParams {
  sight: boolean;
  bloom: boolean;
  cam: CamMode;
}

export interface PanelStats {
  calls: number;
  tris: number;
  fps: number;
  t: number;
  seed: number;
  power: number;
}

interface PanelHooks {
  onSight(on: boolean): void;
  onCam(cam: CamMode): void;
  onBloom(on: boolean): void;
  onBlackout(): void;
  tree(): string;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** Debug overlay: tuning sliders, camera, "Meine Sicht", scene graph and render stats. Toggle with `. */
export class DebugPanel {
  readonly state: PanelState;
  private root: HTMLElement;
  private treeEl: HTMLPreElement;
  private statEls: Record<'calls' | 'tris' | 'fps' | 'clock' | 'halt' | 'power', HTMLElement>;
  private camBtns: HTMLButtonElement[] = [];
  private sightBtns: HTMLButtonElement[] = [];

  constructor(
    host: HTMLElement,
    private hooks: PanelHooks,
  ) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.state = {
      kmh: reduce ? 300 : SPEED.defaultKmh,
      shakeMm: SHAKE.defaultMm,
      shakeOn: !reduce,
      sight: false,
      bloom: true,
      cam: { kind: 'wagon' },
    };

    this.root = el('aside', 'panel');
    this.root.setAttribute('aria-label', 'Debug');
    const head = el('header', 'panel-head');
    head.append(el('h2', '', 'Debug'), el('span', 'kbd', '`'));
    this.root.append(head);

    // Camera
    const camSeg = el('div', 'seg');
    const cams: { label: string; cam: CamMode }[] = [
      { label: 'Wagen', cam: { kind: 'wagon' } },
      ...PLAYER_SEATS.map((_, i) => ({ label: `Sitz ${i + 1}`, cam: { kind: 'seat', seat: i } as CamMode })),
    ];
    for (const c of cams) {
      const b = this.segButton(c.label, () => this.setCam(c.cam));
      b.dataset.cam = c.cam.kind === 'wagon' ? 'wagon' : String(c.cam.seat);
      camSeg.append(b);
      this.camBtns.push(b);
    }
    this.root.append(this.row('Kamera', camSeg));

    // View mode
    const sightSeg = el('div', 'seg');
    for (const [label, on] of [['Bild', false], ['Meine Sicht', true]] as const) {
      const b = this.segButton(label, () => this.setSight(on));
      b.dataset.sight = String(on);
      sightSeg.append(b);
      this.sightBtns.push(b);
    }
    this.root.append(this.row('Ansicht', sightSeg));
    const legend = el('div', 'legend');
    for (const [role, color] of Object.entries(ROLE_COLORS)) {
      const s = el('span', '', role);
      s.style.setProperty('--c', color);
      legend.append(s);
    }
    this.root.append(legend);

    // Sliders
    this.root.append(this.slider('Tempo', 0, SPEED.maxKmh, 10, this.state.kmh, (v) => `${v} km/h`, (v) => (this.state.kmh = v)));
    const shakeRow = this.slider('Wackeln', 0, SHAKE.maxMm, 1, this.state.shakeMm, (v) => `${v} mm`, (v) => (this.state.shakeMm = v));
    shakeRow.append(this.toggle(() => this.state.shakeOn, (on) => (this.state.shakeOn = on)));
    this.root.append(shakeRow);

    const fx = el('div', 'ctl');
    fx.append(
      el('span', 'ctl-label', 'Effekte'),
      this.toggle(() => this.state.bloom, (on) => {
        this.state.bloom = on;
        this.hooks.onBloom(on);
      }, 'Bloom'),
    );
    const blackoutBtn = el('button', 'btn', 'Ausfall testen');
    blackoutBtn.type = 'button';
    blackoutBtn.addEventListener('click', () => this.hooks.onBlackout());
    fx.append(blackoutBtn);
    this.root.append(fx);

    // Stats
    const stats = el('dl', 'stats');
    const stat = (label: string) => {
      const d = el('div');
      const dd = el('dd', '', '–');
      d.append(el('dt', '', label), dd);
      stats.append(d);
      return dd;
    };
    this.statEls = {
      calls: stat('Draw-Calls'),
      tris: stat('Dreiecke'),
      fps: stat('FPS'),
      halt: stat('Halt in'),
      power: stat('Strom'),
      clock: stat('Uhr · Seed'),
    };
    this.root.append(stats);

    const treeHead = el('div', 'treehead', 'Szenengraph · Meshes / Dreiecke');
    this.treeEl = el('pre', 'tree');
    this.root.append(treeHead, this.treeEl);

    host.append(this.root);
    this.syncButtons();
    this.refreshTree();

    addEventListener('keydown', (e) => {
      if (e.key === '`' || e.key === '^' || e.code === 'Backquote') this.root.hidden = !this.root.hidden;
    });
  }

  refreshTree(): void {
    this.treeEl.textContent = this.hooks.tree();
  }

  setCam(cam: CamMode): void {
    this.state.cam = cam;
    this.hooks.onCam(cam);
    this.syncButtons();
  }

  setSight(on: boolean): void {
    this.state.sight = on;
    this.hooks.onSight(on);
    this.syncButtons();
  }

  showStats(s: PanelStats): void {
    if (this.root.hidden) return;
    this.statEls.calls.textContent = String(s.calls);
    this.statEls.tris.textContent = Math.round(s.tris).toLocaleString('de-DE');
    this.statEls.fps.textContent = String(Math.round(s.fps));
    const left = haltCountdown(s.t, HALT_CYCLE_S);
    this.statEls.halt.textContent = `${left} s`;
    this.statEls.clock.textContent = `${s.t.toFixed(1)} · ${s.seed}`;
    this.statEls.power.textContent = s.power > 0.5 ? 'an' : 'AUSFALL';
  }

  private syncButtons(): void {
    const camKey = this.state.cam.kind === 'wagon' ? 'wagon' : String(this.state.cam.seat);
    for (const b of this.camBtns) b.setAttribute('aria-pressed', String(b.dataset.cam === camKey));
    for (const b of this.sightBtns) b.setAttribute('aria-pressed', String(b.dataset.sight === String(this.state.sight)));
  }

  private segButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', '', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  /** On/off button; label shows the state, optionally prefixed with a name. */
  private toggle(get: () => boolean, set: (on: boolean) => void, name?: string): HTMLButtonElement {
    const b = el('button', 'btn toggle');
    b.type = 'button';
    const sync = () => {
      b.textContent = `${name ? name + ' ' : ''}${get() ? 'an' : 'aus'}`;
      b.setAttribute('aria-pressed', String(get()));
    };
    b.addEventListener('click', () => {
      set(!get());
      sync();
    });
    sync();
    return b;
  }

  private row(label: string, content: HTMLElement): HTMLElement {
    const r = el('div', 'ctl');
    r.append(el('span', 'ctl-label', label), content);
    return r;
  }

  private slider(
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    show: (v: number) => string,
    set: (v: number) => void,
  ): HTMLElement {
    const r = el('div', 'ctl');
    const id = `sl-${label.toLowerCase()}`;
    const lab = el('label', 'ctl-label', label);
    lab.htmlFor = id;
    const input = el('input');
    Object.assign(input, { type: 'range', id, min: String(min), max: String(max), step: String(step), value: String(value) });
    const out = el('output', '', show(value));
    input.addEventListener('input', () => {
      set(+input.value);
      out.textContent = show(+input.value);
    });
    r.append(lab, input, out);
    return r;
  }
}
