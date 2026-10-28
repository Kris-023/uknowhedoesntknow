import { parseOpts, type RoomOpts } from '../net/protocol';
import type { PersonState } from '../characters/person';
import { LIGHT_PRESETS, SHAKE, VOICE, type LightPresetName } from '../config';
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

export interface Settings {
  light: LightPresetName;
  bloom: boolean;
  /** Multiplier on the bloom strength. */
  bloomStrength: number;
  /** Share of the native resolution that gets rendered (lower = faster on 4K and weak GPUs). */
  renderScale: number;
  shakeOn: boolean;
  shakeMm: number;
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
  voiceMode: 'open' | 'auto' | 'ptt';
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
  /** Train sounds (rumble, rail joints, oncoming trains, gong). */
  ambientVolume: number;
  /** Spoken stop announcements (browser speech). */
  announcements: boolean;
}

function defaults(): Settings {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    light: 'nacht',
    bloom: true,
    bloomStrength: 1,
    renderScale: 1,
    shakeOn: !reduce,
    shakeMm: SHAKE.defaultMm,
    mouseSens: 1,
    invertY: false,
    mouseRaw: true,
    cardScale: 1,
    room: parseOpts(undefined),
    micOn: true,
    micDevice: '',
    voiceMode: 'open',
    vadLevel: VOICE.vadDefault,
    micGain: 1,
    voiceVolume: 1,
    micFilter: 'ki',
    echoCancel: true,
    autoGain: true,
    ambientVolume: 0.7,
    announcements: true,
  };
}

function loadSettings(): Settings {
  const d = defaults();
  const v = read(SETTINGS_KEY);
  if (typeof v !== 'object' || v === null) return d;
  const o = v as Record<string, unknown>;
  const num = (x: unknown, min: number, max: number, fb: number) => (typeof x === 'number' && x >= min && x <= max ? x : fb);
  const bool = (x: unknown, fb: boolean) => (typeof x === 'boolean' ? x : fb);
  return {
    light: typeof o.light === 'string' && o.light in LIGHT_PRESETS ? (o.light as LightPresetName) : d.light,
    bloom: bool(o.bloom, d.bloom),
    bloomStrength: num(o.bloomStrength, 0, 2, d.bloomStrength),
    renderScale: num(o.renderScale, 0.5, 1, d.renderScale),
    shakeOn: bool(o.shakeOn, d.shakeOn),
    shakeMm: num(o.shakeMm, 0, SHAKE.maxMm, d.shakeMm),
    mouseSens: num(o.mouseSens, 0.2, 3, d.mouseSens),
    invertY: bool(o.invertY, d.invertY),
    mouseRaw: bool(o.mouseRaw, d.mouseRaw),
    cardScale: num(o.cardScale, 0.5, 2, d.cardScale),
    room: parseOpts(o.room),
    micOn: bool(o.micOn, d.micOn),
    micDevice: typeof o.micDevice === 'string' && o.micDevice.length < 300 ? o.micDevice : d.micDevice,
    voiceMode: o.voiceMode === 'ptt' || o.voiceMode === 'auto' ? o.voiceMode : 'open',
    vadLevel: num(o.vadLevel, 0.05, 0.95, d.vadLevel),
    micGain: num(o.micGain, 0.25, 3, d.micGain),
    voiceVolume: num(o.voiceVolume, 0, 1.5, d.voiceVolume),
    micFilter: o.micFilter === 'browser' || o.micFilter === 'off' ? o.micFilter : d.micFilter,
    echoCancel: bool(o.echoCancel, d.echoCancel),
    autoGain: bool(o.autoGain, d.autoGain),
    ambientVolume: num(o.ambientVolume, 0, 1.5, d.ambientVolume),
    announcements: bool(o.announcements, d.announcements),
  };
}

/** Live settings object; change it only through `updateSettings` so listeners and storage follow. */
export const settings: Settings = loadSettings();
const listeners = new Set<() => void>();

export function updateSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  write(SETTINGS_KEY, settings);
  for (const f of listeners) f();
}

export function onSettings(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
