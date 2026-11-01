import { parseOpts, type RoomOpts } from '../net/protocol';
import type { PersonState } from '../characters/person';
import { VOICE } from '../config';
import { parseName, parseState } from '../net/protocol';

// Per-browser memory: the player's own profile and settings. Storage can be missing or throw
// (private window, blocked site data); then everything still works, it just isn't remembered.

const PROFILE_KEY = 'ukhdk.profile.v1';
const SETTINGS_KEY = 'ukhdk.settings.v1';

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered, but nothing breaks.
  }
}

/** Saved profile, or null on the first visit (that's what starts the onboarding). */
export function loadProfile(): PersonState | null {
  const v = read(PROFILE_KEY);
  const s = parseState(v);
  return s && parseName(s.name) ? s : null;
}

export function saveProfile(p: PersonState): void {
  write(PROFILE_KEY, p);
}

/** Leuchten (bloom) levels: label key -> strength multiplier (STANDARD 100 %, MITTEL 50 %, NIEDRIG 15 %, AUS 0 %). */
export const GLOW_LEVELS = { standard: 1, mittel: 0.5, niedrig: 0.15, aus: 0 } as const;
export type GlowLevel = keyof typeof GLOW_LEVELS;

export interface Settings {
  /** "Leuchten": strength of the glow (bloom) around bright lights. */
  glow: GlowLevel;
  /** "Renderhelligkeit": exposure of the renderer, i.e. how bright the lit scene is. Multiplier, 0.5..2. */
  renderBrightness: number;
  /** "Weniger Bewegung": removes the Hypertrain's shaking. Default follows prefers-reduced-motion. */
  reduceMotion: boolean;
  /** "Weniger Flackern": calms flickering lights. */
  reduceFlicker: boolean;
  /** "Stromausfälle überblenden": blackouts fade instead of cutting (shown only with reduceFlicker, stored independently). */
  fadeBlackouts: boolean;
  /** "Vignette": darkened picture corners. */
  vignette: boolean;
  /** "Unschärfe hinter Fenstern": blur behind the UI panels. */
  uiBlur: boolean;
  /** Share of the native resolution that gets rendered (lower = faster on 4K and weak GPUs). */
  renderScale: number;
  /** Multiplier on the base mouse sensitivity. */
  mouseSens: number;
  invertY: boolean;
  /** Read the mouse from pointerrawupdate instead of mousemove (device events, not one per frame). */
  mouseRaw: boolean;
  /** Size of the "Wer bin ich?" cards over the heads, relative to WHOAMI.cardSizeM. */
  cardScale: number;
  /** Room settings for the next room you create (the dialog next to "Raum erstellen"). */
  room: RoomOpts;
  /** Use the microphone in rooms (asked for when joining). */
  micOn: boolean;
  /** Input device id, '' = browser default. */
  micDevice: string;
  /** "Nur Mundbewegung" (mouth, the default: no voice is sent, only the mouth moves), open mic, voice activation, push to talk. */
  voiceMode: 'mouth' | 'open' | 'auto' | 'ptt';
  /** Voice activation threshold, on the same 0..1 scale as the test meter. */
  vadLevel: number;
  /** Gain on the own microphone before sending (and in the test meter). */
  micGain: number;
  /** Volume of all voices. */
  voiceVolume: number;
  /** Noise filter on the own mic: neural (RNNoise, also catches typing), the browser's own, or none. */
  micFilter: 'ki' | 'browser' | 'off';
  /** Browser echo cancellation (removes what comes out of your speakers). */
  echoCancel: boolean;
  /** Browser auto gain: evens out distance to the mic, but also lifts room noise in pauses. */
  autoGain: boolean;
  /** The map's own sounds: steady bed (rumble, fryer, rain, hum) and one-off noises. */
  ambientVolume: number;
  /** Turns the steady bed down a lot; one-off noises (bell, knocking, beeps) stay. */
  quietAmbience: boolean;
  /** "Musik" in the map (diner jukebox, the party next door), separate from the ambience. 0 = off. */
  musicVolume: number;
  /** "Durchsagen": gong and spoken lines (stops, number calls). 0 = off, except the Schaffner, who keeps `SCHAFFNER.minVolume`. */
  announceVolume: number;
}

type Stored = Record<string, unknown>;

function defaults(): Settings {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    glow: 'standard',
    renderBrightness: 1,
    reduceMotion: reduce,
    reduceFlicker: false,
    fadeBlackouts: false,
    vignette: false,
    uiBlur: false,
    renderScale: 1,
    mouseSens: 1,
    invertY: false,
    mouseRaw: true,
    cardScale: 1,
    room: parseOpts(undefined),
    micOn: true,
    micDevice: '',
    voiceMode: 'mouth',
    vadLevel: VOICE.vadDefault,
    micGain: 1,
    voiceVolume: 1,
    micFilter: 'ki',
    echoCancel: true,
    autoGain: true,
    ambientVolume: 0.7,
    quietAmbience: false,
    musicVolume: 0.7,
    announceVolume: 0.8,
  };
}

// Settings versions. Saved settings carry `version`; a save without one is version 0.
// RULE: change the settings shape (rename, remove, re-scale a field) -> bump SETTINGS_VERSION by one,
// append ONE step to UPGRADES (UPGRADES[n] turns an n save into an n+1 save), add a test in tests/settings.test.ts.
// On load an old save runs every step in order, then is saved again at the current version.
// The per-field checks in `parseSettings` stay as the safety net for broken values.
export const SETTINGS_VERSION = 2;

const UPGRADES: Array<(o: Stored) => Stored> = [
  // 0 -> 1 (phase B): toggles become sliders/levels; shake and light preset are fixed (dropped).
  (o) => {
    const { light, shakeOn, shakeMm, musicOn, announcements, bloom, bloomStrength, ...rest } = o;
    if (musicOn === false) rest.musicVolume = 0;
    if (announcements === false) rest.announceVolume = 0;
    if (bloom === false) rest.glow = 'aus';
    else if (typeof bloomStrength === 'number') {
      let best: GlowLevel = 'standard';
      for (const k of Object.keys(GLOW_LEVELS) as GlowLevel[]) {
        if (Math.abs(GLOW_LEVELS[k] - bloomStrength) < Math.abs(GLOW_LEVELS[best] - bloomStrength)) best = k;
      }
      rest.glow = best;
    }
    return rest;
  },
  // 1 -> 2: "Nachschärfen" and "Bildhelligkeit" were removed. (Renderhelligkeit widened to 0.5..2; old values still fit.)
  (o) => {
    const { sharpen, imageBrightness, ...rest } = o;
    return rest;
  },
];

const versionOf = (o: Stored): number => (typeof o.version === 'number' && Number.isInteger(o.version) && o.version >= 0 ? o.version : 0);

/** Runs every upgrade step from the save's version up to the current one. A newer, unknown version passes through untouched. */
export function upgradeSettings(raw: Stored): Stored {
  const from = versionOf(raw);
  if (from >= SETTINGS_VERSION) return raw;
  let o = raw;
  for (let n = from; n < SETTINGS_VERSION; n++) o = UPGRADES[n](o);
  return { ...o, version: SETTINGS_VERSION };
}

/** Validates an (already upgraded) stored object field by field; whatever is broken or missing falls back to the default. */
export function parseSettings(o: Stored): Settings {
  const d = defaults();
  const num = (x: unknown, min: number, max: number, fb: number) => (typeof x === 'number' && x >= min && x <= max ? x : fb);
  const bool = (x: unknown, fb: boolean) => (typeof x === 'boolean' ? x : fb);
  return {
    glow: typeof o.glow === 'string' && Object.hasOwn(GLOW_LEVELS, o.glow) ? (o.glow as GlowLevel) : d.glow,
    renderBrightness: num(o.renderBrightness, 0.5, 2, d.renderBrightness),
    reduceMotion: bool(o.reduceMotion, d.reduceMotion),
    reduceFlicker: bool(o.reduceFlicker, d.reduceFlicker),
    fadeBlackouts: bool(o.fadeBlackouts, d.fadeBlackouts),
    vignette: bool(o.vignette, d.vignette),
    uiBlur: bool(o.uiBlur, d.uiBlur),
    renderScale: num(o.renderScale, 0.5, 1, d.renderScale),
    mouseSens: num(o.mouseSens, 0.2, 3, d.mouseSens),
    invertY: bool(o.invertY, d.invertY),
    mouseRaw: bool(o.mouseRaw, d.mouseRaw),
    cardScale: num(o.cardScale, 0.5, 2, d.cardScale),
    room: parseOpts(o.room),
    micOn: bool(o.micOn, d.micOn),
    micDevice: typeof o.micDevice === 'string' && o.micDevice.length < 300 ? o.micDevice : d.micDevice,
    voiceMode: o.voiceMode === 'mouth' || o.voiceMode === 'open' || o.voiceMode === 'auto' || o.voiceMode === 'ptt' ? o.voiceMode : d.voiceMode,
    vadLevel: num(o.vadLevel, 0.05, 0.95, d.vadLevel),
    micGain: num(o.micGain, 0.25, 3, d.micGain),
    voiceVolume: num(o.voiceVolume, 0, 1.5, d.voiceVolume),
    micFilter: o.micFilter === 'browser' || o.micFilter === 'off' ? o.micFilter : d.micFilter,
    echoCancel: bool(o.echoCancel, d.echoCancel),
    autoGain: bool(o.autoGain, d.autoGain),
    ambientVolume: num(o.ambientVolume, 0, 1.5, d.ambientVolume),
    quietAmbience: bool(o.quietAmbience, d.quietAmbience),
    musicVolume: num(o.musicVolume, 0, 1.5, d.musicVolume),
    announceVolume: num(o.announceVolume, 0, 1.5, d.announceVolume),
  };
}

/** What goes into storage: the version plus every setting. */
export function persistedSettings(s: Settings): Stored {
  return { ...s, version: SETTINGS_VERSION };
}

function loadSettings(): Settings {
  const v = read(SETTINGS_KEY);
  if (typeof v !== 'object' || v === null) return defaults();
  const old = v as Stored;
  const s = parseSettings(upgradeSettings(old));
  // An older save is written back at once, so the next load needs no steps and the dropped fields are gone.
  if (versionOf(old) < SETTINGS_VERSION) write(SETTINGS_KEY, persistedSettings(s));
  return s;
}

/** Live settings object; change it only through `updateSettings` so listeners and storage follow. */
export const settings: Settings = loadSettings();
const listeners = new Set<() => void>();

export function updateSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  write(SETTINGS_KEY, persistedSettings(settings));
  for (const f of listeners) f();
}

export function onSettings(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
