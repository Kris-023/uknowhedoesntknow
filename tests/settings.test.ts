import { afterEach, describe, expect, it, vi } from 'vitest';
import { GLOW_LEVELS, SETTINGS_VERSION, parseSettings, persistedSettings, upgradeSettings } from '../src/ui/store';

const load = (raw: Record<string, unknown>) => parseSettings(upgradeSettings(raw));

describe('settings defaults', () => {
  it('start with Nur Mundbewegung, standard glow, neutral brightness and the new toggles off', () => {
    const s = parseSettings({});
    expect(s.voiceMode).toBe('mouth');
    expect(s.glow).toBe('standard');
    expect(s.imageBrightness).toBe(1);
    expect(s.renderBrightness).toBe(1);
    expect([s.reduceFlicker, s.fadeBlackouts, s.sharpen, s.vignette, s.uiBlur]).toEqual([false, false, false, false, false]);
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
    for (const k of ['light', 'bloom', 'bloomStrength', 'shakeOn', 'shakeMm', 'musicOn', 'announcements']) {
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
    expect(up.version).toBe(1);
  });

  it('keeps everything else and lands on the current version', () => {
    const s = load({ mouseSens: 1.7, cardScale: 1.4, voiceMode: 'ptt', micDevice: 'abc' });
    expect(s.mouseSens).toBe(1.7);
    expect(s.cardScale).toBe(1.4);
    expect(s.voiceMode).toBe('ptt');
    expect(s.micDevice).toBe('abc');
    expect(upgradeSettings({ mouseSens: 1.7 }).version).toBe(SETTINGS_VERSION);
    expect(persistedSettings(s).version).toBe(1);
  });

  it('a saved voice mode "open" stays open', () => {
    expect(load({ voiceMode: 'open' }).voiceMode).toBe('open');
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
    const s = load({ mouseSens: 'x', imageBrightness: 9, glow: 'laut', voiceMode: 'shout', reduceFlicker: 'yes', room: 5 });
    expect(s.mouseSens).toBe(d.mouseSens);
    expect(s.imageBrightness).toBe(1);
    expect(s.glow).toBe('standard');
    expect(s.voiceMode).toBe('mouth');
    expect(s.reduceFlicker).toBe(false);
    expect(s.room).toEqual(d.room);
  });
});

afterEach(() => vi.unstubAllGlobals());
