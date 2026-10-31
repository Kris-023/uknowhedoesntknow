import { getVoice, type MicState } from '../audio/voice';
import { SHAKE } from '../config';
import { el } from './dom';
import { onSettings, settings, updateSettings, type Settings } from './store';

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
type SliderKey = 'shakeMm' | 'mouseSens' | 'voiceVolume' | 'micGain' | 'bloomStrength' | 'renderScale' | 'vadLevel' | 'ambientVolume' | 'musicVolume' | 'announceVolume' | 'cardScale';

/** Mouth/meter level range that normal speech should reach: loud enough to open the mouth, not clipping. */
const TARGET = { from: 0.5, to: 0.85 };

const pct = (v: number) => `${Math.round(v * 100)} %`;

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
    if (sections.includes('voice')) panes.set('voice', [this.voice()]);
    if (sections.includes('sound')) {
      const sound = el('fieldset', 'group');
      sound.append(
        el('legend', 'group-title', 'Ton'),
        this.slider('Umgebung', 'ambientVolume', 0, 1.5, 0.05, pct, undefined, 'Geräusche der Map: Dröhnen, Fritteuse, Regen, Kühlschrank, Klopfen.'),
        this.toggle('Ruhige Umgebung', 'quietAmbience', 'Dämpft das Dauerrauschen stark. Einzelne Geräusche wie Klingel oder Klopfen bleiben.'),
        this.toggle('Musik', 'musicOn', 'Jukebox im Diner, Party nebenan in der WG.'),
        this.slider('Lautstärke', 'musicVolume', 0, 1.5, 0.05, pct, () => settings.musicOn),
        this.toggle('Durchsagen', 'announcements', 'Halte im Hypertrain, Aufrufe im Bürgeramt; per Sprachausgabe des Browsers. Der Schaffner spricht immer.'),
        this.slider('Lautstärke', 'announceVolume', 0, 1.5, 0.05, pct, undefined, 'Gong und Sprache, auch für den Schaffner. Ganz links ist auch die Sprache stumm, manche Browser regeln sie sonst nicht mit.'),
      );
      panes.set('sound', [sound]);
    }
    if (sections.includes('gfx')) {
      const gfx = el('fieldset', 'group');
      gfx.append(
        el('legend', 'group-title', 'Grafik'),
        this.slider('Auflösung', 'renderScale', 0.5, 1, 0.05, pct, undefined, 'Weniger rechnet schneller, vor allem auf 4K.'),
        this.toggle('Leuchten', 'bloom', 'Glühen um Lampen, Neon und Leuchtschilder (Bloom).'),
        this.slider('Stärke', 'bloomStrength', 0, 2, 0.05, pct, () => settings.bloom),
        this.slider('Karten', 'cardScale', 0.5, 2, 0.05, pct, undefined, 'Größe der Bilder über den Köpfen bei „Wer bin ich?“.'),
        this.seg('Licht', [['Nacht', 'nacht'], ['Hell', 'hell']] as const, 'light', 'Nacht ist die gedachte Stimmung, Hell zeigt mehr.'),
        this.toggle('Wackeln', 'shakeOn', 'Die Kamera wackelt mit, vor allem im Hypertrain.'),
        this.slider('Stärke', 'shakeMm', 0, SHAKE.maxMm, 1, (v) => `${v} mm`, () => settings.shakeOn),
      );
      // The benchmark entry sits with the graphics: it's where you go to tune the fps.
      panes.set('gfx', extra ? [gfx, extra] : [gfx]);
    }
    if (sections.includes('input')) {
      const input = el('fieldset', 'group');
      input.append(el('legend', 'group-title', 'Steuerung'), this.slider('Maus', 'mouseSens', 0.2, 3, 0.1, (v) => `${v.toFixed(1)}×`));
      // Only browsers that have the raw event get the switch.
      if ('onpointerrawupdate' in window) input.append(this.toggle('Direkte Mauseingabe', 'mouseRaw', 'Liest die Maus ohne Umweg, reagiert direkter. Nur ausschalten, wenn die Maus damit spinnt.'));
      input.append(this.toggle('Maus Y umkehren', 'invertY'));
      panes.set('input', [input]);
    }
    // A short list (benchmark panel) stays one column; the full settings got too long for that.
    if (panes.size < 3) for (const els of panes.values()) this.root.append(...els);
    else this.tabbed(panes);
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

  private voice(): HTMLElement {
    const box = el('fieldset', 'group');
    box.append(el('legend', 'group-title', 'Stimme'));
    // Order: get the mic going and the level right first; how you talk and the filters come after.
    const later: HTMLElement[] = [];

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
    box.append(this.field('Mikrofon', mic, 'Kopfhörer sind am besten, sonst hören die anderen sich selbst.'));

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
    box.append(this.field('Gerät', select, undefined, () => settings.micOn));
    later.push(
      this.seg(
        'Sprechen',
        [['Offen', 'open'], ['Automatisch', 'auto'], ['Push-to-talk (V)', 'ptt']] as const,
        'voiceMode',
        'Automatisch sendet erst ab der Schwelle. M schaltet im Spiel stumm.',
      ),
    );
    later.push(this.slider('Schwelle', 'vadLevel', 0.05, 0.95, 0.01, pct, () => settings.voiceMode === 'auto', 'Ab diesem Pegel wirst du gehört; im Test die weiße Linie.'));
    const gainRow = this.slider('Mikro-Pegel', 'micGain', 0.25, 3, 0.05, pct, () => settings.micOn);
    later.push(
      this.seg(
        'Rauschfilter',
        [['KI', 'ki'], ['Browser', 'browser'], ['Aus', 'off']] as const,
        'micFilter',
        'KI filtert auch Tippen, Lüfter und Straßenlärm heraus, Browser nur gleichmäßiges Rauschen.',
      ),
    );
    later.push(this.toggle('Echofilter', 'echoCancel', 'Rechnet heraus, was aus deinen Lautsprechern kommt. Mit Kopfhörern egal.'));
    later.push(this.toggle('Auto-Pegel', 'autoGain', 'Gleicht den Abstand zum Mikro aus, hebt in Pausen aber Rauschen an. Bei „Automatisch“ eher aus.'));

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
    this.syncs.push(() => {
      threshold.hidden = settings.voiceMode !== 'auto';
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
      on: 'Sprich normal: Die Spitze sollte im grünen Bereich landen. Sonst Mikro-Pegel anpassen. Bei Automatisch wird der Balken grau, solange du nicht gehört wirst.',
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
      // In automatic mode the bar shows whether you'd be heard right now.
      meter.classList.toggle('gated', settings.voiceMode === 'auto' && !v?.gateIsOpen);
    };
    this.raf = requestAnimationFrame(tick);
    box.append(this.field('Test', test), gainRow);

    const tone = el('button', 'btn ghost', 'Testton');
    tone.type = 'button';
    tone.addEventListener('click', () => getVoice(true)?.testTone());
    const vol = this.slider('Stimmen', 'voiceVolume', 0, 1.5, 0.05, pct, undefined, 'Lautstärke der anderen, mit dem Testton prüfen.');
    vol.querySelector('.slider')!.append(tone);
    box.append(vol, ...later);
    return box;
  }

  private field(label: string, content: HTMLElement, hint?: string, enabled?: () => boolean): HTMLElement {
    const row = el('div', 'field');
    const id = `set-${Math.random().toString(36).slice(2, 8)}`;
    const lab = el('label', 'field-label', label);
    lab.id = id;
    if (content instanceof HTMLInputElement || content instanceof HTMLSelectElement) {
      content.id = `${id}-in`;
      lab.htmlFor = content.id;
    } else content.setAttribute('aria-labelledby', id);
    row.append(lab, content);
    if (hint) row.append(el('span', 'field-hint', hint));
    if (enabled) this.syncs.push(() => row.classList.toggle('off', !enabled()));
    return row;
  }

  private seg<K extends keyof Settings>(label: string, opts: readonly (readonly [string, Settings[K]])[], key: K, hint?: string): HTMLElement {
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'group');
    for (const [text, v] of opts) {
      const b = el('button', '', text);
      b.type = 'button';
      b.addEventListener('click', () => updateSettings({ [key]: v } as Partial<Settings>));
      this.syncs.push(() => b.setAttribute('aria-pressed', String(settings[key] === v)));
      seg.append(b);
    }
    return this.field(label, seg, hint);
  }

  private toggle(label: string, key: 'bloom' | 'shakeOn' | 'invertY' | 'announcements' | 'quietAmbience' | 'musicOn' | 'echoCancel' | 'autoGain' | 'mouseRaw', hint?: string): HTMLElement {
    const b = el('button', 'btn toggle');
    b.type = 'button';
    b.addEventListener('click', () => updateSettings({ [key]: !settings[key] }));
    this.syncs.push(() => {
      b.textContent = settings[key] ? 'An' : 'Aus';
      b.setAttribute('aria-pressed', String(settings[key]));
    });
    return this.field(label, b, hint);
  }

  private slider(label: string, key: SliderKey, min: number, max: number, step: number, show: (v: number) => string, enabled?: () => boolean, hint?: string): HTMLElement {
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
    const row = this.field(label, wrap, hint, enabled);
    // The label points at the range input itself.
    const lab = row.querySelector('label')!;
    input.id = `${lab.id}-in`;
    lab.htmlFor = input.id;
    wrap.removeAttribute('aria-labelledby');
    return row;
  }
}
