import { getVoice, type MicState } from '../audio/voice';
import { el } from './dom';
import { GLOW_LEVELS, onSettings, settings, updateSettings, type Settings } from './store';

type Section = 'voice' | 'sound' | 'gfx' | 'input';

/** Sub-tabs in this order: voice first (has to work before anything else), then sound, graphics, controls. */
const SECTIONS: readonly { id: Section; label: string }[] = [
  { id: 'voice', label: 'Stimme' },
  { id: 'sound', label: 'Ton' },
  { id: 'gfx', label: 'Grafik' },
  { id: 'input', label: 'Steuerung' },
];
/** The last sub-tab you looked at, for the next time the settings open (this page load only). */
let lastSection: Section = 'voice';

type SliderKey = 'renderScale' | 'renderBrightness' | 'ambientVolume' | 'musicVolume' | 'announceVolume' | 'voiceVolume' | 'micGain' | 'vadLevel' | 'mouseSens';
type ToggleKey = 'vignette' | 'uiBlur' | 'reduceMotion' | 'reduceFlicker' | 'fadeBlackouts' | 'quietAmbience' | 'echoCancel' | 'autoGain' | 'invertY' | 'mouseRaw';

/** A hint under a control: fixed text, text that follows the settings, or ready-made markup. */
type Hint = string | (() => string) | HTMLElement;
interface RowOpts {
  hint?: Hint;
  /** Row that does not apply right now: dimmed, its controls disabled. */
  enabled?: () => boolean;
  /** Row that is not shown at all while this is false. */
  visible?: () => boolean;
  /** Which element the label points at, when it is not the content itself (a range inside `.slider`). */
  control?: HTMLElement;
  /** Tall content (the mic test): the label sits at the top instead of the middle. */
  top?: boolean;
}

/** Mouth/meter level range that normal speech should reach: loud enough to open the mouth, not clipping. */
const TARGET = { from: 0.5, to: 0.85 };

const pct = (v: number) => `${Math.round(v * 100)} %`;

/**
 * Gecko-based browser (Firefox, Floorp, Zen …) on desktop Linux. Chromium and Safari put "like Gecko"
 * in their user agent and have no `Gecko/<digits>` token; Android is left out on purpose.
 */
export function isGeckoLinux(ua: string): boolean {
  return /\bGecko\/\d/.test(ua) && !/like Gecko/i.test(ua) && /Linux/.test(ua) && !/Android/i.test(ua);
}

/** The blur behind menus and HUD panels is a body class (see `.ui-blur` in style.css), kept in step with the setting. */
function applyUiBlur(): void {
  if (typeof document !== 'undefined') document.body?.classList.toggle('ui-blur', settings.uiBlur);
}
onSettings(applyUiBlur);
if (typeof document !== 'undefined') {
  if (document.body) applyUiBlur();
  else addEventListener('DOMContentLoaded', applyUiBlur, { once: true });
}

/**
 * Settings, the same in the main menu, the Esc menu and (graphics + controls only) the benchmark
 * panel. Changes apply at once and are remembered.
 */
export class SettingsView {
  readonly root = el('div', 'settings');
  private syncs: (() => void)[] = [];
  private off: () => void;
  private raf = 0;

  constructor(extra: HTMLElement | null = null, sections: Section[] = SECTIONS.map((x) => x.id)) {
    const panes = new Map<Section, HTMLElement[]>();
    // A short list (benchmark panel) stays one column and leaves out the key list.
    const tabbed = sections.length >= 3;
    if (sections.includes('voice')) panes.set('voice', this.voice());
    if (sections.includes('sound')) panes.set('sound', this.sound());
    if (sections.includes('gfx')) {
      // The benchmark entry sits with the graphics: it's where you go to tune the fps.
      const gfx = this.gfx();
      panes.set('gfx', extra ? [...gfx, extra] : gfx);
    }
    if (sections.includes('input')) panes.set('input', this.input(tabbed));
    if (tabbed) this.tabbed(panes);
    else for (const els of panes.values()) this.root.append(...els);
    this.off = onSettings(() => this.sync());
    this.sync();
  }

  dispose(): void {
    this.off();
    cancelAnimationFrame(this.raf);
  }

  /** One sub-tab per section; all panes stay built (the mic meter keeps running), only one shows. */
  private tabbed(panes: Map<Section, HTMLElement[]>): void {
    this.root.classList.add('tabbed');
    const nav = el('div', 'tabs sub');
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Einstellungen');
    const tabs = new Map<Section, HTMLButtonElement>();
    const boxes = new Map<Section, HTMLElement>();
    const show = (id: Section) => {
      lastSection = id;
      for (const [k, b] of tabs) {
        b.setAttribute('aria-selected', String(k === id));
        b.tabIndex = k === id ? 0 : -1;
        boxes.get(k)!.hidden = k !== id;
      }
    };
    for (const { id, label } of SECTIONS) {
      const els = panes.get(id);
      if (!els) continue;
      const b = el('button', 'tab', label);
      b.type = 'button';
      b.id = `set-tab-${id}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', `set-pane-${id}`);
      b.addEventListener('click', () => show(id));
      nav.append(b);
      tabs.set(id, b);
      const box = el('div', 'settings-pane');
      box.id = `set-pane-${id}`;
      box.setAttribute('role', 'tabpanel');
      box.setAttribute('aria-labelledby', b.id);
      box.append(...els);
      boxes.set(id, box);
    }
    nav.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const ids = [...tabs.keys()];
      const next = ids[(ids.indexOf(lastSection) + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
      show(next);
      tabs.get(next)!.focus();
    });
    this.root.append(nav, ...boxes.values());
    show(tabs.has(lastSection) ? lastSection : [...tabs.keys()][0]);
  }

  private sync(): void {
    for (const f of this.syncs) f();
  }

  // ---------- GRAFIK ----------
  private gfx(): HTMLElement[] {
    return [
      group(
        'Darstellung',
        this.slider('Auflösung', 'renderScale', 0.5, 1, 0.05, pct, { hint: 'Weniger rechnet schneller, vor allem auf 4K.' }),
        this.slider('Renderhelligkeit', 'renderBrightness', 0.5, 2, 0.05, pct, { hint: 'Macht die Szene heller oder dunkler.' }),
      ),
      group(
        'Effekte',
        this.seg(
          'Leuchten',
          [['Standard', 'standard'], ['Mittel', 'mittel'], ['Niedrig', 'niedrig'], ['Aus', 'aus']] as const,
          'glow',
          () => `Glühen um Lampen, Neon und Schilder: ${Math.round(GLOW_LEVELS[settings.glow] * 100)} %.`,
        ),
        this.toggle('Vignette', 'vignette', 'Dunklere Bildränder.'),
        this.toggle('Unschärfe hinter Fenstern', 'uiBlur', 'Menüs, Karten und Anzeigen zeichnen das Bild dahinter weich.'),
      ),
      group(
        'Komfort',
        this.toggle('Weniger Bewegung', 'reduceMotion', 'Weniger Kamerawackeln und ruhigere Bewegung im Hintergrund.'),
        this.toggle('Weniger Flackern', 'reduceFlicker', 'Lichter flackern nicht mehr.'),
        this.toggle('Stromausfälle überblenden', 'fadeBlackouts', 'Licht blendet bei Stromausfällen weich aus und wieder ein, statt hart aus/an.', {
          visible: () => settings.reduceFlicker,
        }),
      ),
    ];
  }

  // ---------- TON ----------
  private sound(): HTMLElement[] {
    const tone = el('button', 'btn ghost', 'Testton');
    tone.type = 'button';
    tone.addEventListener('click', () => getVoice(true)?.testTone());
    return [
      group(
        'Lautstärke',
        this.slider('Umgebung', 'ambientVolume', 0, 1.5, 0.05, pct, { hint: 'Geräusche der Map: Dröhnen, Fritteuse, Regen, Kühlschrank.' }),
        this.slider('Musik', 'musicVolume', 0, 1.5, 0.05, pct, { hint: 'Jukebox im Diner, Party nebenan in der WG.' }),
        this.slider('Durchsagen', 'announceVolume', 0, 1.5, 0.05, pct, { hint: 'Der Schaffner spricht immer.' }),
        this.slider('Stimmen', 'voiceVolume', 0, 1.5, 0.05, pct, { extra: tone, hint: 'Lautstärke der anderen, mit dem Testton prüfen.' }),
      ),
      group('Umgebung', this.toggle('Ruhige Umgebung', 'quietAmbience', 'Dämpft das Dauerrauschen stark. Klingel und Klopfen bleiben.')),
    ];
  }

  // ---------- STIMME ----------
  private voice(): HTMLElement[] {
    // Starting audio needs a click, so the voice engine is created here if the menu is the first place.
    const mic = el('button', 'btn toggle');
    mic.type = 'button';
    mic.addEventListener('click', () => {
      getVoice(true)?.resume();
      updateSettings({ micOn: !settings.micOn });
    });
    this.syncs.push(() => {
      mic.textContent = settings.micOn ? 'An' : 'Aus';
      mic.setAttribute('aria-pressed', String(settings.micOn));
    });

    const select = el('select', 'select');
    const fill = async () => {
      const devs = (await navigator.mediaDevices?.enumerateDevices().catch(() => [])) ?? [];
      const inputs = devs.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default');
      select.replaceChildren(new Option('Standard des Browsers', ''));
      // Without permission browsers hide device names; numbered entries are still usable.
      inputs.forEach((d, i) => select.append(new Option(d.label || `Mikrofon ${i + 1}`, d.deviceId)));
      select.value = settings.micDevice;
      if (select.value !== settings.micDevice) select.value = '';
    };
    void fill();
    navigator.mediaDevices?.addEventListener?.('devicechange', () => void fill());
    select.addEventListener('change', () => updateSettings({ micDevice: select.value }));

    // Test meter: live level after the mic gain, the target band, and a peak marker that lingers.
    const test = el('div', 'meter-wrap');
    const meter = el('span', 'meter');
    const zone = el('span', 'meter-zone');
    zone.style.left = `${TARGET.from * 100}%`;
    zone.style.width = `${(TARGET.to - TARGET.from) * 100}%`;
    const fillBar = el('i');
    const peak = el('span', 'meter-peak');
    const threshold = el('span', 'meter-threshold');
    meter.append(zone, fillBar, peak, threshold);
    // The threshold is for the two modes that have one: mouth and automatic.
    const hasThreshold = () => settings.voiceMode === 'auto' || settings.voiceMode === 'mouth';
    this.syncs.push(() => {
      threshold.hidden = !hasThreshold();
      threshold.style.left = `${settings.vadLevel * 100}%`;
    });
    const status = el('span', 'note');
    const start = el('button', 'btn ghost', 'Mikro testen');
    start.type = 'button';
    start.addEventListener('click', () => {
      const v = getVoice(true);
      if (!v) return;
      v.resume();
      if (!settings.micOn) updateSettings({ micOn: true });
      else if (v.micState !== 'on') void v.startMic();
    });
    const row = el('div', 'row');
    row.append(meter, start);
    test.append(row, status);
    const STATUS: Record<MicState, string> = {
      off: 'Mikro ist aus.',
      starting: 'Warte auf Freigabe …',
      on: 'Sprich normal: Die Spitze sollte im grünen Bereich landen. Sonst Mikro-Pegel anpassen. Bei Automatisch und Nur Mundbewegung wird der Balken grau, solange du unter der Schwelle bleibst.',
      blocked: 'Nicht erlaubt. Über das Symbol links neben der Adresse erlauben, dann startet es von selbst, sonst „Mikro testen“.',
      missing: 'Kein Mikrofon gefunden.',
      error: 'Mikrofon konnte nicht gestartet werden, vielleicht nutzt es gerade ein anderes Programm.',
    };
    // The voice engine may appear (first click) or change state any time; the meter loop watches it.
    let lastState: MicState | null | undefined;
    let held = 0;
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      if (!this.root.isConnected) return;
      const v = getVoice();
      const st = v?.micState ?? null;
      if (st !== lastState) {
        lastState = st;
        status.textContent = st ? STATUS[st] : 'Noch nicht getestet.';
        // The browser's own reason helps when something odd blocks the mic (device busy, policy, …).
        if (v?.micError && st !== 'on') status.textContent += ` (${v.micError})`;
        if (st === 'on' && settings.micFilter === 'ki' && v?.micFilter !== 'ki') status.textContent += ' KI-Filter läuft hier nicht, der Browser-Filter springt ein.';
        start.hidden = st === 'on';
        // Device names only become visible after the mic permission.
        if (st === 'on') void fill();
      }
      const l = v?.micLevel(true) ?? 0;
      held = Math.max(l, held - 0.006);
      fillBar.style.setProperty('--l', l.toFixed(3));
      peak.style.left = `${(held * 100).toFixed(1)}%`;
      peak.classList.toggle('ok', held >= TARGET.from && held <= TARGET.to);
      // Automatic: whether you'd be heard right now. Mouth: whether the mouth would move (the engine's gate is not involved).
      const gated = settings.voiceMode === 'auto' ? !v?.gateIsOpen : settings.voiceMode === 'mouth' && l < settings.vadLevel;
      meter.classList.toggle('gated', gated);
    };
    this.raf = requestAnimationFrame(tick);

    const advanced = el('fieldset', 'group');
    const disclosure = el('button', 'disclosure', 'Erweitert');
    disclosure.type = 'button';
    disclosure.setAttribute('aria-expanded', 'false');
    const body = el('div', 'group-body');
    body.hidden = true;
    body.id = `set-adv-${Math.random().toString(36).slice(2, 8)}`;
    disclosure.setAttribute('aria-controls', body.id);
    disclosure.addEventListener('click', () => {
      const open = disclosure.getAttribute('aria-expanded') !== 'true';
      disclosure.setAttribute('aria-expanded', String(open));
      body.hidden = !open;
    });
    const legend = el('legend', 'group-title');
    legend.append(disclosure);
    body.append(
      this.seg('Rauschfilter', [['KI', 'ki'], ['Browser', 'browser'], ['Aus', 'off']] as const, 'micFilter', 'KI filtert auch Tippen und Lüfter, Browser nur gleichmäßiges Rauschen.'),
      this.toggle('Echofilter', 'echoCancel', 'Rechnet heraus, was aus deinen Lautsprechern kommt. Mit Kopfhörern egal.'),
      this.toggle('Auto-Pegel', 'autoGain', 'Gleicht den Abstand zum Mikro aus, hebt in Pausen aber Rauschen an.'),
    );
    advanced.append(legend, body);

    return [
      group(
        'Mikrofon',
        this.field('Mikrofon', mic, { hint: 'Kopfhörer sind am besten, sonst hören die anderen sich selbst.' }),
        this.field('Gerät', select, { enabled: () => settings.micOn }),
        this.slider('Mikro-Pegel', 'micGain', 0.25, 3, 0.05, pct, { enabled: () => settings.micOn }),
        this.field('Test', test, { top: true }),
      ),
      group(
        'Sprechen',
        this.seg(
          'Modus',
          [['Nur Mundbewegung', 'mouth'], ['Offen', 'open'], ['Automatisch', 'auto'], ['Push-to-talk (V)', 'ptt']] as const,
          'voiceMode',
          () =>
            settings.voiceMode === 'mouth'
              ? 'Deine Stimme wird nicht gesendet – nur dein Mund bewegt sich, wenn du sprichst. Praktisch, wenn ihr z. B. über Discord redet.'
              : 'Automatisch sendet erst ab der Schwelle. M schaltet im Spiel stumm.',
        ),
        this.slider('Schwelle', 'vadLevel', 0.05, 0.95, 0.01, pct, {
          hint: () => (settings.voiceMode === 'mouth' ? 'Ab diesem Pegel bewegt sich dein Mund; im Test die weiße Linie.' : 'Ab diesem Pegel wirst du gehört; im Test die weiße Linie.'),
          visible: hasThreshold,
        }),
      ),
      advanced,
    ];
  }

  // ---------- STEUERUNG ----------
  private input(withKeys: boolean): HTMLElement[] {
    // Only Gecko on Linux gets the tip about slow mouse moves.
    let gecko: HTMLElement | undefined;
    if (typeof navigator !== 'undefined' && isGeckoLinux(navigator.userAgent)) {
      gecko = el('span', 'field-hint');
      gecko.append('Langsame Mausbewegungen kommen kaum an? In Gecko-Browsern (Firefox, Floorp, Zen …) unter Wayland kann es helfen, den Browser mit ', el('code', '', 'MOZ_ENABLE_WAYLAND=0'), ' zu starten.');
    }
    const mouse = group('Maus', this.slider('Empfindlichkeit', 'mouseSens', 0.2, 3, 0.1, (v) => `${v.toFixed(1)}×`, { hint: gecko }), this.toggle('Maus Y umkehren', 'invertY'));
    // Only browsers that have the raw event get the switch.
    if ('onpointerrawupdate' in window) mouse.append(this.toggle('Direkte Mauseingabe', 'mouseRaw', 'Nur Chromium. Schalte es aus, wenn sich die Maus komisch verhält.'));
    const out = [mouse];
    if (withKeys) {
      const keys = el('dl', 'keys');
      for (const [k, v] of [
        ['Maus', 'umsehen (erst ins Bild klicken)'],
        ['Rechte Maustaste', 'heranzoomen'],
        ['Mittlere Maustaste', 'Maus freigeben'],
        ['M', 'Mikro stumm an/aus'],
        ['V', 'halten zum Sprechen (bei Push-to-talk)'],
        ['Esc', 'Menü'],
      ]) keys.append(el('dt', '', k), el('dd', '', v));
      out.push(group('Tasten', keys));
    }
    return out;
  }

  // ---------- rows ----------
  private field(label: string, content: HTMLElement, o: RowOpts = {}): HTMLElement {
    const row = el('div', o.top ? 'field top' : 'field');
    const id = `set-${Math.random().toString(36).slice(2, 8)}`;
    const lab = el('label', 'field-label', label);
    lab.id = id;
    const ctl = o.control ?? content;
    if (ctl instanceof HTMLInputElement || ctl instanceof HTMLSelectElement) {
      ctl.id = `${id}-in`;
      lab.htmlFor = ctl.id;
    } else ctl.setAttribute('aria-labelledby', id);
    row.append(lab, content);
    const hint = o.hint;
    if (hint instanceof HTMLElement) row.append(hint);
    else if (hint) {
      const h = el('span', 'field-hint');
      row.append(h);
      this.syncs.push(() => {
        h.textContent = typeof hint === 'function' ? hint() : hint;
      });
    }
    const enabled = o.enabled;
    if (enabled) {
      this.syncs.push(() => {
        const on = enabled();
        row.classList.toggle('off', !on);
        row.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button').forEach((c) => {
          c.disabled = !on;
        });
      });
    }
    const visible = o.visible;
    if (visible) {
      this.syncs.push(() => {
        row.hidden = !visible();
      });
    }
    return row;
  }

  private seg<K extends keyof Settings>(label: string, opts: readonly (readonly [string, Settings[K]])[], key: K, hint?: Hint): HTMLElement {
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'group');
    for (const [text, v] of opts) {
      const b = el('button', '', text);
      b.type = 'button';
      b.addEventListener('click', () => updateSettings({ [key]: v } as Partial<Settings>));
      this.syncs.push(() => b.setAttribute('aria-pressed', String(settings[key] === v)));
      seg.append(b);
    }
    return this.field(label, seg, { hint });
  }

  private toggle(label: string, key: ToggleKey, hint?: Hint, o: RowOpts = {}): HTMLElement {
    const b = el('button', 'btn toggle');
    b.type = 'button';
    b.addEventListener('click', () => updateSettings({ [key]: !settings[key] }));
    this.syncs.push(() => {
      b.textContent = settings[key] ? 'An' : 'Aus';
      b.setAttribute('aria-pressed', String(settings[key]));
    });
    return this.field(label, b, { hint, ...o });
  }

  private slider(label: string, key: SliderKey, min: number, max: number, step: number, show: (v: number) => string, o: RowOpts & { extra?: HTMLElement } = {}): HTMLElement {
    const wrap = el('div', 'slider');
    const input = el('input');
    Object.assign(input, { type: 'range', min: String(min), max: String(max), step: String(step) });
    const out = el('output');
    input.addEventListener('input', () => updateSettings({ [key]: +input.value }));
    this.syncs.push(() => {
      input.value = String(settings[key]);
      out.textContent = show(settings[key]);
    });
    wrap.append(input, out);
    if (o.extra) wrap.append(o.extra);
    return this.field(label, wrap, { ...o, control: input });
  }
}

function group(title: string, ...rows: HTMLElement[]): HTMLElement {
  const g = el('fieldset', 'group');
  g.append(el('legend', 'group-title', title), ...rows);
  return g;
}
