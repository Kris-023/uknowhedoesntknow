import { getVoice, type MicState } from '../audio/voice';
import { SHAKE } from '../config';
import { el } from './dom';
import { onSettings, settings, updateSettings, type Settings } from './store';

type Section = 'voice' | 'gfx' | 'input';
type SliderKey = 'shakeMm' | 'mouseSens' | 'voiceVolume' | 'micGain' | 'bloomStrength' | 'renderScale' | 'vadLevel';

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

  constructor(extra: HTMLElement | null = null, sections: Section[] = ['voice', 'gfx', 'input']) {
    if (sections.includes('voice')) this.root.append(this.voice());
    if (sections.includes('gfx')) {
      const gfx = el('fieldset', 'group');
      gfx.append(
        el('legend', 'group-title', 'Grafik'),
        this.seg('Licht', [['Nacht', 'nacht'], ['Hell', 'hell']] as const, 'light', 'Nacht ist die gedachte Stimmung, Hell zeigt mehr.'),
        this.toggle('Leuchten', 'bloom', 'Glühen um Neon und Streifen (Bloom).'),
        this.slider('Stärke', 'bloomStrength', 0, 2, 0.05, pct, () => settings.bloom),
        this.slider('Auflösung', 'renderScale', 0.5, 1, 0.05, pct, undefined, 'Weniger rechnet schneller, vor allem auf 4K.'),
        this.toggle('Wackeln', 'shakeOn'),
        this.slider('Stärke', 'shakeMm', 0, SHAKE.maxMm, 1, (v) => `${v} mm`, () => settings.shakeOn),
      );
      this.root.append(gfx);
    }
    if (sections.includes('input')) {
      const input = el('fieldset', 'group');
      input.append(
        el('legend', 'group-title', 'Steuerung'),
        this.slider('Maus', 'mouseSens', 0.2, 3, 0.1, (v) => `${v.toFixed(1)}×`),
        this.toggle('Maus Y umkehren', 'invertY'),
      );
      this.root.append(input);
    }
    if (extra) this.root.append(extra);
    this.off = onSettings(() => this.sync());
    this.sync();
  }

  dispose(): void {
    this.off();
    cancelAnimationFrame(this.raf);
  }

  private sync(): void {
    for (const f of this.syncs) f();
  }

  private voice(): HTMLElement {
    const box = el('fieldset', 'group');
    box.append(el('legend', 'group-title', 'Stimme'));

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
    box.append(
      this.seg(
        'Sprechen',
        [['Offen', 'open'], ['Automatisch', 'auto'], ['Push-to-talk (V)', 'ptt']] as const,
        'voiceMode',
        'Automatisch sendet erst ab der Schwelle. M schaltet im Spiel stumm.',
      ),
    );
    box.append(this.slider('Schwelle', 'vadLevel', 0.05, 0.95, 0.01, pct, () => settings.voiceMode === 'auto', 'Ab diesem Pegel wirst du gehört; im Test die weiße Linie.'));
    box.append(this.slider('Mikro-Pegel', 'micGain', 0.25, 3, 0.05, pct, () => settings.micOn));

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
      blocked: 'Blockiert. Im Browser über das Schloss neben der Adresse erlauben.',
      missing: 'Kein Mikrofon gefunden.',
      error: 'Mikrofon konnte nicht gestartet werden.',
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
    box.append(this.field('Test', test));

    const tone = el('button', 'btn ghost', 'Testton');
    tone.type = 'button';
    tone.addEventListener('click', () => getVoice(true)?.testTone());
    const vol = this.slider('Stimmen', 'voiceVolume', 0, 1.5, 0.05, pct, undefined, 'Lautstärke der anderen, mit dem Testton prüfen.');
    vol.querySelector('.slider')!.append(tone);
    box.append(vol);
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

  private toggle(label: string, key: 'bloom' | 'shakeOn' | 'invertY', hint?: string): HTMLElement {
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
