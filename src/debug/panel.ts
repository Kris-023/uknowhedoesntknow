import { COLORS, HALT_CYCLE_S, LIGHT_PRESETS, LIGHTS, SHAKE, SPEED, type LightPresetName } from '../config';
import { ITEMS, ITEM_IDS, SLOT_LABEL, SLOTS } from '../characters/accessories';
import { haltCountdown, smoothstep } from '../core/motion';
import type { Players } from '../game/players';
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

/** Slider units -> head yaw in rad; ±100 maps to ±1.5 rad. */
const YAW_PER_UNIT = 0.015;

/** "Seitenblick": slow look to one side, hold, sweep to the other, hold, back to centre. */
function sideGlance(dt: number): number | null {
  if (dt < 3) return 100 * smoothstep(0, 3, dt);
  if (dt < 4) return 100;
  if (dt < 8) return 100 - 200 * smoothstep(4, 8, dt);
  if (dt < 9) return -100;
  if (dt < 12) return -100 + 100 * smoothstep(9, 12, dt);
  return null;
}

/**
 * Debug overlay: camera, who-am-I, "Meine Sicht", tuning sliders, head turn test tools,
 * accessories, scene graph and render stats. Toggle with ^ / `.
 */
export class DebugPanel {
  readonly state: PanelState;
  private root: HTMLElement;
  private treeEl: HTMLPreElement;
  private statEls: Record<'calls' | 'tris' | 'fps' | 'clock' | 'halt' | 'power', HTMLElement>;
  private camBtns: HTMLButtonElement[] = [];
  private sightBtns: HTMLButtonElement[] = [];
  private playerBtns: HTMLButtonElement[] = [];
  private itemBtns = new Map<string, HTMLButtonElement>();
  private accWho!: HTMLElement;
  private yawInput!: HTMLInputElement;
  private yawOut!: HTMLOutputElement;
  private demoStart: number | null = null;

  constructor(
    host: HTMLElement,
    private players: Players,
    private hooks: PanelHooks,
  ) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.state = {
      kmh: reduce ? 300 : SPEED.defaultKmh,
      shakeMm: SHAKE.defaultMm,
      shakeOn: !reduce,
      sight: false,
      bloom: true,
      cam: 'wagon',
    };

    this.root = el('aside', 'panel');
    this.root.setAttribute('aria-label', 'Debug');
    const head = el('header', 'panel-head');
    head.append(el('h2', '', 'Debug'), el('span', 'kbd', '^'));
    this.root.append(head);

    // Camera and who am I
    const camSeg = el('div', 'seg');
    for (const [label, cam] of [['Wagen', 'wagon'], ['POV', 'pov']] as const) {
      const b = this.segButton(label, () => this.setCam(cam));
      b.dataset.cam = cam;
      camSeg.append(b);
      this.camBtns.push(b);
    }
    this.root.append(this.row('Kamera', camSeg));
    const meSeg = el('div', 'seg');
    COLORS.players.forEach((c, i) => {
      const b = this.segButton(String(i + 1), () => this.setActive(i));
      b.classList.add('swatch');
      b.style.setProperty('--c', `#${c.toString(16).padStart(6, '0')}`);
      meSeg.append(b);
      this.playerBtns.push(b);
    });
    this.root.append(this.row('Ich bin', meSeg));

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

    // Train
    this.root.append(this.slider('Tempo', 0, SPEED.maxKmh, 10, this.state.kmh, (v) => `${v} km/h`, (v) => (this.state.kmh = v)).row);
    const shake = this.slider('Wackeln', 0, SHAKE.maxMm, 1, this.state.shakeMm, (v) => `${v} mm`, (v) => (this.state.shakeMm = v));
    shake.row.append(this.toggle(() => this.state.shakeOn, (on) => (this.state.shakeOn = on)));
    this.root.append(shake.row);
    const fx = el('div', 'ctl');
    fx.append(
      el('span', 'ctl-label', 'Effekte'),
      this.toggle(
        () => this.state.bloom,
        (on) => {
          this.state.bloom = on;
          this.hooks.onBloom(on);
        },
        'Bloom',
      ),
      this.button('Ausfall testen', () => this.hooks.onBlackout()),
    );
    this.root.append(fx);
    const lightSeg = el('div', 'seg');
    const lightBtns: HTMLButtonElement[] = [];
    for (const [label, name] of [['Nacht', 'nacht'], ['Hell', 'hell']] as const satisfies readonly (readonly [string, LightPresetName])[]) {
      const b = this.segButton(label, () => {
        Object.assign(LIGHTS, LIGHT_PRESETS[name]);
        lightBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      });
      b.setAttribute('aria-pressed', String(name === 'nacht'));
      lightBtns.push(b);
      lightSeg.append(b);
    }
    this.root.append(this.row('Licht', lightSeg));

    // Head turn test tools
    const yaw = this.slider('Kopf', -100, 100, 1, 0, (v) => `${Math.round(v * YAW_PER_UNIT * 57.3)}°`, (v) => {
      this.demoStart = null;
      this.players.look.yaw = v * YAW_PER_UNIT;
    });
    this.yawInput = yaw.input;
    this.yawOut = yaw.out;
    yaw.row.append(
      this.button('Seitenblick', () => (this.demoStart = performance.now() / 1000)),
      this.toggle(() => this.players.talkTest, (on) => (this.players.talkTest = on), 'Alle reden'),
    );
    this.root.append(yaw.row);

    // Accessories for the local player
    const acc = el('section', 'acc');
    const accHead = el('div', 'treehead');
    accHead.append('Accessoires für ');
    this.accWho = el('b');
    accHead.append(this.accWho);
    acc.append(accHead);
    for (const slot of SLOTS) {
      const seg = el('div', 'seg');
      for (const id of ITEM_IDS.filter((i) => ITEMS[i].slot === slot)) {
        const b = this.segButton(ITEMS[id].label, () => {
          this.players.me.toggle(id);
          this.afterChange();
        });
        seg.append(b);
        this.itemBtns.set(id, b);
      }
      acc.append(this.row(SLOT_LABEL[slot], seg));
    }
    const dice = el('div', 'ctl');
    dice.append(
      this.button('Würfeln', () => this.players.randomItems(this.players.me, Math.random, true)),
      this.button('Ablegen', () => SLOTS.forEach((s) => this.players.me.unequip(s))),
      this.button('Look würfeln', () => this.players.randomLook(this.players.active, Math.random)),
      this.button('Alle würfeln', () => this.players.people.forEach((p) => this.players.randomItems(p, Math.random, true))),
    );
    for (const b of dice.querySelectorAll('button')) b.addEventListener('click', () => this.afterChange());
    acc.append(dice);
    this.root.append(acc);

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

  /** Per frame: drives the side-glance demo. */
  tick(): void {
    if (this.demoStart === null) return;
    const v = sideGlance(performance.now() / 1000 - this.demoStart);
    if (v === null) this.demoStart = null;
    this.players.look.yaw = (v ?? 0) * YAW_PER_UNIT;
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

  setActive(i: number): void {
    this.players.active = i;
    this.players.look.yaw = 0;
    this.afterChange();
  }

  showStats(s: PanelStats): void {
    if (this.root.hidden) return;
    this.statEls.calls.textContent = String(s.calls);
    this.statEls.tris.textContent = Math.round(s.tris).toLocaleString('de-DE');
    this.statEls.fps.textContent = String(Math.round(s.fps));
    this.statEls.halt.textContent = `${haltCountdown(s.t, HALT_CYCLE_S)} s`;
    this.statEls.power.textContent = s.power > 0.5 ? 'an' : 'AUSFALL';
    this.statEls.clock.textContent = `${s.t.toFixed(1)} · ${s.seed}`;
    // Mouse and demo move the head too; keep the slider honest.
    this.yawInput.value = String(Math.round(this.players.look.yaw / YAW_PER_UNIT));
    this.yawOut.textContent = `${Math.round(this.players.look.yaw * 57.3)}°`;
  }

  private afterChange(): void {
    this.syncButtons();
    this.refreshTree();
  }

  private syncButtons(): void {
    for (const b of this.camBtns) b.setAttribute('aria-pressed', String(b.dataset.cam === this.state.cam));
    for (const b of this.sightBtns) b.setAttribute('aria-pressed', String(b.dataset.sight === String(this.state.sight)));
    this.playerBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === this.players.active)));
    const me = this.players.me;
    for (const id of ITEM_IDS) this.itemBtns.get(id)!.setAttribute('aria-pressed', String(me.items[ITEMS[id].slot] === id));
    this.accWho.textContent = `Spieler ${this.players.active + 1}`;
  }

  private segButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', '', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'btn', label);
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
  ): { row: HTMLElement; input: HTMLInputElement; out: HTMLOutputElement } {
    const row = el('div', 'ctl');
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
    row.append(lab, input, out);
    return { row, input, out };
  }
}
