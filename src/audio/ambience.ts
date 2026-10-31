import type { MapDef, MapSound, SoundKit } from '../maps/types';
import { AMBIENCE } from '../config';
import { onSettings, settings } from '../ui/store';
import { impulse, type Voice } from './voice';

/**
 * Map ambience from Web Audio and the shared clock, no audio files. This class owns the shared
 * parts (volume, noise, the ceiling-speaker gong, browser speech, the relay clunk when the power
 * drops); each map plays its own bed through the kit (see MapDef.sound).
 */
export class Ambience implements SoundKit {
  readonly ctx: AudioContext;
  readonly out: GainNode;
  readonly bed: GainNode;
  readonly music: GainNode;
  readonly noise: AudioBuffer;
  /** Gong chain: band-limited like a cheap ceiling speaker, plus a bit of room echo. */
  private speaker: GainNode;
  private map: MapSound;
  private lastPower = 1;
  /** Relay: one quiet clunk per outage, not one per flicker of the stuttering start. */
  private lastClunk = -Infinity;
  private restoreSince: number | null = null;
  /**
   * All three channels pass through here on their way to the bus: one switch to hold this map's
   * sound while a new map settles in, and one plug to pull when the map goes away (voices share the
   * bus and must keep playing through a map change).
   */
  private level: GainNode;
  private unsubscribe: () => void;
  /** Endless sources the map started when it was built; stopped when the map goes away. */
  private loops: AudioScheduledSourceNode[];
  private disposed = false;

  /** `held`: start silent until `release()` (a map change while the room keeps running). */
  constructor(voice: Voice, seed: number, map: MapDef, held = false) {
    const ctx = (this.ctx = voice.ctx);
    this.level = new GainNode(ctx, { gain: held ? 0 : 1 });
    this.level.connect(voice.bus);
    // Three channels, so each has its own volume; the bed sits under the ambience.
    const bedLevel = () => (settings.quietAmbience ? AMBIENCE.quietBed : 1);
    const musicLevel = () => (settings.musicOn ? settings.musicVolume : 0);
    this.out = new GainNode(ctx, { gain: settings.ambientVolume });
    this.out.connect(this.level);
    this.bed = new GainNode(ctx, { gain: bedLevel() });
    this.bed.connect(this.out);
    this.music = new GainNode(ctx, { gain: musicLevel() });
    this.music.connect(this.level);
    const announceOut = new GainNode(ctx, { gain: settings.announceVolume });
    announceOut.connect(this.level);
    this.unsubscribe = onSettings(() => {
      const now = ctx.currentTime;
      this.out.gain.setTargetAtTime(settings.ambientVolume, now, 0.05);
      this.bed.gain.setTargetAtTime(bedLevel(), now, 0.15);
      this.music.gain.setTargetAtTime(musicLevel(), now, 0.15);
      announceOut.gain.setTargetAtTime(settings.announceVolume, now, 0.05);
    });

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.speaker = new GainNode(ctx, { gain: AMBIENCE.gong });
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 380 });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3200 });
    const room = new ConvolverNode(ctx, { buffer: impulse(ctx, 0.9) });
    const wet = new GainNode(ctx, { gain: 0.35 });
    this.speaker.connect(hp).connect(lp);
    lp.connect(announceOut);
    lp.connect(room).connect(wet).connect(announceOut);
    const built = startedDuring(() => map.sound(this, seed));
    this.map = built.value;
    this.loops = built.sources;
  }

  /** Fade in after a held start. */
  release(fadeS = 1.5): void {
    const t = this.ctx.currentTime;
    this.level.gain.cancelScheduledValues(t);
    this.level.gain.setValueAtTime(this.level.gain.value, t);
    this.level.gain.linearRampToValueAtTime(1, t + fadeS);
  }

  /**
   * The map is gone: quick fade (no click), then unplug and stop the endless sources. One-off
   * noises already scheduled end by themselves; unplugged, nobody hears them.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    const t = this.ctx.currentTime;
    const g = this.level.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + 0.08);
    for (const s of this.loops) {
      try {
        s.stop(t + 0.1);
      } catch {
        // Never started or already stopped: nothing to do.
      }
    }
    setTimeout(() => this.level.disconnect(), 150);
  }

  /** Per frame. `power` 0..1 supply of the map (coach, laundromat fuse, …). */
  update(t: number, kmh: number, power: number): void {
    if (this.disposed || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    this.map.update(t, power, kmh);
    if (power < 0.5 && this.lastPower >= 0.5 && now - this.lastClunk > 3) {
      this.clunk(0.14);
      this.lastClunk = now;
    }
    // Back on only once the light has stayed on for a moment (the restore also stutters).
    if (power < 0.5) this.restoreSince = null;
    else if (this.lastPower < 0.5) this.restoreSince = now;
    if (this.restoreSince !== null && now - this.restoreSince > 0.8) {
      this.clunk(0.07);
      this.restoreSince = null;
    }
    this.lastPower = power;
  }

  /** Gong, then a spoken announcement (the Schaffner uses this too). */
  announce(text: string, important = false): void {
    this.gong();
    setTimeout(() => this.speak(text, important), 1700);
  }

  burst(at: number, dur: number): AudioBufferSourceNode {
    const s = new AudioBufferSourceNode(this.ctx, { buffer: this.noise });
    s.start(at, Math.random() * 1.5, dur);
    return s;
  }

  /** Relay in the ceiling when the coach power drops or comes back. */
  clunk(gain: number): void {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.01;
    const o = new OscillatorNode(ctx, { type: 'square', frequency: 55 });
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(gain * 0.4, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
    o.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 300 })).connect(g).connect(this.out);
    o.start(t0);
    o.stop(t0 + 0.2);
    const n = new GainNode(ctx, { gain: 0 });
    n.gain.setValueAtTime(gain, t0);
    n.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
    this.burst(t0, 0.06).connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 2000 })).connect(n).connect(this.out);
  }

  /** Three-tone chime before an announcement, through the speaker filter. */
  private gong(): void {
    const ctx = this.ctx;
    [784, 659, 523].forEach((f, i) => {
      const t0 = ctx.currentTime + 0.05 + i * 0.42;
      for (const [mul, amp] of [[1, 0.35], [2.76, 0.08]] as const) {
        const o = new OscillatorNode(ctx, { frequency: f * mul });
        const g = new GainNode(ctx, { gain: 0 });
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(amp, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.4);
        o.connect(g).connect(this.speaker);
        o.start(t0);
        o.stop(t0 + 1.5);
      }
    });
  }

  /**
   * Placeholder voice: the browser's speech synthesis. It can't be routed through Web Audio, so it
   * plays without the speaker filter; recorded or generated lines can replace it later (see F5).
   */
  private speak(text: string, important = false): void {
    // Stop announcements can be switched off; a Schaffner call is part of the game and always speaks.
    // A map change between gong and speech: the old map's line no longer fits.
    if (this.disposed) return;
    if ((!settings.announcements && !important) || settings.announceVolume <= 0 || typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    const de = speechSynthesis.getVoices().find((v) => v.lang.startsWith('de'));
    if (de) u.voice = de;
    u.rate = 0.95;
    u.pitch = 0.85;
    // Browser speech starts at full loudness and sits on top of everything; squared, so the slider
    // the default lands well below half. Some engines ignore it; at 0 there is no speech at all.
    u.volume = Math.min(1, (settings.announceVolume / 1.5) ** 2 * 1.5);
    speechSynthesis.speak(u);
  }
}

/**
 * Runs `f` and records every Web Audio source started meanwhile. Map sounds start their endless
 * layers (hum, rumble, jukebox noise) while being built and keep no handle on them; this way every
 * map gets stopped on a map change without each one having to list its nodes. Only the build is
 * watched, not the per-frame update: patching prototypes every frame would cost more than it saves,
 * and sources started later always come with their own stop time.
 */
function startedDuring<T>(f: () => T): { value: T; sources: AudioScheduledSourceNode[] } {
  const sources: AudioScheduledSourceNode[] = [];
  // AudioBufferSourceNode has its own start (offset, duration); the others inherit the base one.
  const protos = [AudioScheduledSourceNode.prototype, AudioBufferSourceNode.prototype].filter((p) => Object.prototype.hasOwnProperty.call(p, 'start'));
  const saved = protos.map((p) => Object.getOwnPropertyDescriptor(p, 'start')!);
  protos.forEach((p, i) => {
    const orig = saved[i].value as (this: AudioScheduledSourceNode, ...a: unknown[]) => void;
    Object.defineProperty(p, 'start', {
      ...saved[i],
      value(this: AudioScheduledSourceNode, ...a: unknown[]) {
        sources.push(this);
        return orig.apply(this, a);
      },
    });
  });
  try {
    return { value: f(), sources };
  } finally {
    protos.forEach((p, i) => Object.defineProperty(p, 'start', saved[i]));
  }
}
