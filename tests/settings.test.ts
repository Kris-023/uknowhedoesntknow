import { afterEach, describe, expect, it, vi } from 'vitest';
import { GLOW_LEVELS, SETTINGS_VERSION, parseSettings, persistedSettings, upgradeSettings } from '../src/ui/store';

const load = (raw: Record<string, unknown>) => parseSettings(upgradeSettings(raw));

describe('settings defaults', () => {
  it('start with Nur Mundbewegung, standard glow, neutral brightness and the new toggles off', () => {
    const s = parseSettings({});
    expect(s.voiceMode).toBe('mouth');
    expect(s.glow).toBe('standard');
    expect(s.renderBrightness).toBe(1);
    expect([s.reduceFlicker, s.fadeBlackouts, s.vignette, s.uiBlur]).toEqual([false, false, false, false]);
    expect(persistedSettings(s).version).toBe(SETTINGS_VERSION);
  });

  it('reduceMotion follows prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(parseSettings({}).reduceMotion).toBe(true);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(parseSettings({}).reduceMotion).toBe(false);
  });

  it('has no legacy fields, neither live nor stored', () => {
    const s = parseSettings({});
    for (const k of ['light', 'bloom', 'bloomStrength', 'shakeOn', 'shakeMm', 'musicOn', 'announcements', 'sharpen', 'imageBrightness']) {
      expect(s).not.toHaveProperty(k);
      expect(persistedSettings(s)).not.toHaveProperty(k);
    }
  });
});

describe('upgrade 0 -> 1', () => {
  it('turns off toggles into zero volumes and keeps the volume otherwise', () => {
    expect(load({ musicOn: false, musicVolume: 0.6 }).musicVolume).toBe(0);
    expect(load({ musicOn: true, musicVolume: 0.6 }).musicVolume).toBe(0.6);
    expect(load({ announcements: false, announceVolume: 0.9 }).announceVolume).toBe(0);
    expect(load({ announcements: true, announceVolume: 0.9 }).announceVolume).toBe(0.9);
  });

  it('maps bloom and bloomStrength to the nearest glow level', () => {
    expect(load({ bloom: false, bloomStrength: 1 }).glow).toBe('aus');
    expect(load({ bloom: true, bloomStrength: 0.4 }).glow).toBe('mittel');
    expect(load({ bloom: true, bloomStrength: 0.1 }).glow).toBe('niedrig');
    expect(load({ bloom: true, bloomStrength: 1.8 }).glow).toBe('standard');
    expect(load({ bloom: true, bloomStrength: 0 }).glow).toBe('aus');
    expect(load({}).glow).toBe('standard');
    expect(GLOW_LEVELS).toEqual({ standard: 1, mittel: 0.5, niedrig: 0.15, aus: 0 });
  });

  it('drops light, shakeOn, shakeMm and the converted toggles', () => {
    const up = upgradeSettings({ light: 'tag', shakeOn: false, shakeMm: 12, musicOn: false, announcements: false, bloom: true, bloomStrength: 1 });
    for (const k of ['light', 'shakeOn', 'shakeMm', 'musicOn', 'announcements', 'bloom', 'bloomStrength']) expect(up).not.toHaveProperty(k);
    expect(up.version).toBe(SETTINGS_VERSION);
  });

  it('keeps everything else and lands on the current version', () => {
    const s = load({ mouseSens: 1.7, renderScale: 0.8, voiceMode: 'ptt', micDevice: 'abc' });
    expect(s.mouseSens).toBe(1.7);
    expect(s.renderScale).toBe(0.8);
    expect(s.voiceMode).toBe('ptt');
    expect(s.micDevice).toBe('abc');
    expect(upgradeSettings({ mouseSens: 1.7 }).version).toBe(SETTINGS_VERSION);
    expect(persistedSettings(s).version).toBe(SETTINGS_VERSION);
  });

  it('a saved voice mode "open" stays open', () => {
    expect(load({ voiceMode: 'open' }).voiceMode).toBe('open');
  });
});

describe('upgrade 1 -> 2', () => {
  it('drops sharpen and imageBrightness, keeps renderBrightness', () => {
    const up = upgradeSettings({ version: 1, sharpen: true, imageBrightness: 1.3, renderBrightness: 1.2, vignette: true });
    expect(up).not.toHaveProperty('sharpen');
    expect(up).not.toHaveProperty('imageBrightness');
    expect(up.version).toBe(SETTINGS_VERSION);
    const s = parseSettings(up);
    expect(s.renderBrightness).toBe(1.2);
    expect(s.vignette).toBe(true);
  });

  it('an unversioned save runs 0 -> 1 -> 2 in order', () => {
    const up = upgradeSettings({ musicOn: false, bloom: false, sharpen: true, imageBrightness: 0.8, renderBrightness: 1.4 });
    for (const k of ['musicOn', 'bloom', 'sharpen', 'imageBrightness']) expect(up).not.toHaveProperty(k);
    expect(up.version).toBe(SETTINGS_VERSION);
    const s = parseSettings(up);
    expect(s.musicVolume).toBe(0);
    expect(s.glow).toBe('aus');
    expect(s.renderBrightness).toBe(1.4);
  });

  it('renderBrightness accepts up to 2 and falls back above', () => {
    expect(load({ renderBrightness: 1.8 }).renderBrightness).toBe(1.8);
    expect(load({ renderBrightness: 2 }).renderBrightness).toBe(2);
    expect(load({ renderBrightness: 2.5 }).renderBrightness).toBe(1);
    expect(load({ renderBrightness: 0.4 }).renderBrightness).toBe(1);
  });
});

describe('versions', () => {
  it('a current save is not changed by upgrading', () => {
    const raw = { version: SETTINGS_VERSION, glow: 'niedrig', musicVolume: 0.3 };
    expect(upgradeSettings(raw)).toBe(raw);
    expect(parseSettings(raw).glow).toBe('niedrig');
  });

  it('a save from a newer version is only validated, not stepped', () => {
    const s = parseSettings(upgradeSettings({ version: 99, glow: 'mittel', musicOn: false, musicVolume: 0.6, future: 1 }));
    expect(s.glow).toBe('mittel');
    expect(s.musicVolume).toBe(0.6);
  });
});

describe('safety net', () => {
  it('a corrupted version number counts as 0 instead of throwing', () => {
    for (const version of [-1, 0.5]) {
      const o = upgradeSettings({ version, musicOn: false });
      expect(o.version).toBe(SETTINGS_VERSION);
      expect(parseSettings(o).musicVolume).toBe(0);
    }
  });

  it('broken values fall back to the defaults', () => {
    const d = parseSettings({});
    const s = load({ mouseSens: 'x', renderBrightness: 9, glow: 'laut', voiceMode: 'shout', reduceFlicker: 'yes', room: 5 });
    expect(s.mouseSens).toBe(d.mouseSens);
    expect(s.renderBrightness).toBe(1);
    expect(s.glow).toBe('standard');
    expect(s.voiceMode).toBe('mouth');
    expect(s.reduceFlicker).toBe(false);
    expect(s.room).toEqual(d.room);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('upgrade 2 -> 3', () => {
  it('drops cardScale and keeps the other values', () => {
    const up = upgradeSettings({ version: 2, cardScale: 1.4, mouseSens: 1.7 });
    expect(up).not.toHaveProperty('cardScale');
    expect(up.version).toBe(3);
    expect(parseSettings(up).mouseSens).toBe(1.7);
    expect(parseSettings(up)).not.toHaveProperty('cardScale');
  });

  it('an unversioned save runs 0 -> 1 -> 2 -> 3', () => {
    const up = upgradeSettings({ cardScale: 1.4, sharpen: true, musicOn: false });
    expect(up).not.toHaveProperty('cardScale');
    expect(up).not.toHaveProperty('sharpen');
    expect(up).not.toHaveProperty('musicOn');
    expect(up.version).toBe(3);
  });
});
