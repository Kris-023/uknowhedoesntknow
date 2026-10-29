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

  constructor(voice: Voice, seed: number, map: MapDef) {
    const ctx = (this.ctx = voice.ctx);
    // Three channels straight to the bus, so each has its own volume; the bed sits under the ambience.
    const bedLevel = () => (settings.quietAmbience ? AMBIENCE.quietBed : 1);
    const musicLevel = () => (settings.musicOn ? settings.musicVolume : 0);
    this.out = new GainNode(ctx, { gain: settings.ambientVolume });
    this.out.connect(voice.bus);
    this.bed = new GainNode(ctx, { gain: bedLevel() });
    this.bed.connect(this.out);
    this.music = new GainNode(ctx, { gain: musicLevel() });
    this.music.connect(voice.bus);
    const announceOut = new GainNode(ctx, { gain: settings.announceVolume });
    announceOut.connect(voice.bus);
    onSettings(() => {
      const now = ctx.currentTime;
      this.out.gain.setTargetAtTime(settings.ambientVolume, now, 0.05);
      this.bed.gain.setTargetAtTime(bedLevel(), now, 0.15);
      this.music.gain.setTargetAtTime(musicLevel(), now, 0.15);
      announceOut.gain.setTargetAtTime(settings.announceVolume, now, 0.05);
    });

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.speaker = new GainNode(ctx, { gain: 0.5 });
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 380 });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3200 });
    const room = new ConvolverNode(ctx, { buffer: impulse(ctx, 0.9) });
    const wet = new GainNode(ctx, { gain: 0.35 });
    this.speaker.connect(hp).connect(lp);
    lp.connect(announceOut);
    lp.connect(room).connect(wet).connect(announceOut);
    this.map = map.sound(this, seed);
  }

  /** Per frame. `power` 0..1 supply of the map (coach, laundromat fuse, …). */
  update(t: number, kmh: number, power: number): void {
    if (this.ctx.state !== 'running') return;
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
    if ((!settings.announcements && !important) || typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    const de = speechSynthesis.getVoices().find((v) => v.lang.startsWith('de'));
    if (de) u.voice = de;
    u.rate = 0.95;
    u.pitch = 0.85;
    u.volume = Math.min(1, settings.announceVolume);
    speechSynthesis.speak(u);
  }
}
