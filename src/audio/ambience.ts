import { AMBIENCE, HALT_CYCLE_S, SPEED, STATIONS } from '../config';
import { haltCountdown, nextStopIndex } from '../core/motion';
import { hash01 } from '../core/rng';
import { onSettings, settings } from '../ui/store';
import { impulse, type Voice } from './voice';

/** Announcement texts per stop; the cycle index picks one, so all clients hear the same. */
const LINES: Record<(typeof STATIONS)[number], string[]> = {
  Offenbach: ['Nächster Halt: Offenbach.', 'Nächster Halt: Offenbach. Bitte nicht an den Türen lehnen.'],
  Kaiserslautern: ['Nächster Halt: Kaiserslautern.', 'Nächster Halt: Kaiserslautern. Ausstieg in Fahrtrichtung rechts.'],
  Oranienburg: ['Nächster Halt: Oranienburg.', 'Nächster Halt: Oranienburg. Zurückbleiben bitte.'],
  'Alt Schauerberg': ['Nächster Halt: Alt Schauerberg.', 'Nächster Halt: Alt Schauerberg. Ausstieg in Fahrtrichtung links.'],
  KitKat: ['Nächster Halt: KitKat.', 'Nächster Halt: KitKat. Bitte achten Sie auf Ihr Gepäck. Und auf Ihre Gurke.'],
  Kreuzberg: ['Nächster Halt: Kreuzberg.', 'Nächster Halt: Kreuzberg. Ausstieg in Fahrtrichtung links.'],
  Alfteller: ['Nächster Halt: Alfteller.', 'Nächster Halt: Alfteller. Bitte nicht an den Türen lehnen.'],
  Gutach: ['Nächster Halt: Gutach. Endstation, bitte alle aussteigen.', 'Nächster Halt: Gutach. Dieser Zug endet dort. Wirklich.'],
};

/**
 * Synthetic train sounds, all from Web Audio and the shared clock: low rumble and motor hum with
 * the speed, a relay clunk when the power drops, and a gong before each stop's announcement.
 * No audio files. Rail-joint clicks and the oncoming-train whoosh were tried and dropped on
 * request (too present); the oncoming train is light only.
 */
export class Ambience {
  private ctx: AudioContext;
  private out: GainNode;
  private noise: AudioBuffer;
  private rumble: GainNode;
  private rumbleLp: BiquadFilterNode;
  private hum: GainNode;
  private humOsc: OscillatorNode;
  /** Gong chain: band-limited like a cheap ceiling speaker, plus a bit of tiled-coach echo. */
  private speaker: GainNode;
  private lastAnnounce = -1;
  private lastPower = 1;
  /** Relay: one quiet clunk per outage, not one per flicker of the stuttering start. */
  private lastClunk = -Infinity;
  private restoreSince: number | null = null;

  constructor(
    voice: Voice,
    private seed: number,
  ) {
    const ctx = (this.ctx = voice.ctx);
    this.out = new GainNode(ctx, { gain: settings.ambientVolume });
    this.out.connect(voice.bus);
    onSettings(() => this.out.gain.setTargetAtTime(settings.ambientVolume, ctx.currentTime, 0.05));

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const src = new AudioBufferSourceNode(ctx, { buffer: this.noise, loop: true });
    this.rumbleLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 150, Q: 0.7 });
    this.rumble = new GainNode(ctx, { gain: 0 });
    src.connect(this.rumbleLp).connect(this.rumble).connect(this.out);
    src.start();
    this.humOsc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 40 });
    const humLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 220 });
    this.hum = new GainNode(ctx, { gain: 0 });
    this.humOsc.connect(humLp).connect(this.hum).connect(this.out);
    this.humOsc.start();

    this.speaker = new GainNode(ctx, { gain: 0.5 });
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 380 });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3200 });
    const room = new ConvolverNode(ctx, { buffer: impulse(ctx, 0.9) });
    const wet = new GainNode(ctx, { gain: 0.35 });
    this.speaker.connect(hp).connect(lp);
    lp.connect(this.out);
    lp.connect(room).connect(wet).connect(this.out);
  }

  /** Per frame. `power` 0..1 coach supply. */
  update(t: number, kmh: number, power: number): void {
    if (this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const sf = Math.min(1, kmh / SPEED.maxKmh);
    this.rumble.gain.setTargetAtTime(0.02 + 0.22 * Math.sqrt(sf), now, 0.3);
    this.rumbleLp.frequency.setTargetAtTime(110 + 260 * sf, now, 0.3);
    // The motor sings with the speed; it stops with the power, the rumble doesn't (the train rolls on).
    this.hum.gain.setTargetAtTime(0.035 * sf * power, now, 0.15);
    this.humOsc.frequency.setTargetAtTime(32 + 60 * sf, now, 0.3);

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

    const cycle = Math.floor(t / HALT_CYCLE_S);
    if (haltCountdown(t, HALT_CYCLE_S) === AMBIENCE.announceAt && cycle !== this.lastAnnounce) {
      this.lastAnnounce = cycle;
      const station = STATIONS[nextStopIndex(t, HALT_CYCLE_S, STATIONS.length)];
      const lines = LINES[station];
      this.gong();
      const text = lines[Math.floor(hash01(this.seed, cycle, 5) * lines.length) % lines.length];
      setTimeout(() => this.speak(text), 1700);
    }
  }

  /** Gong, then a spoken announcement (the Schaffner uses this too). */
  announce(text: string): void {
    this.gong();
    setTimeout(() => this.speak(text, true), 1700);
  }

  private burst(at: number, dur: number): AudioBufferSourceNode {
    const s = new AudioBufferSourceNode(this.ctx, { buffer: this.noise });
    s.start(at, Math.random() * 1.5, dur);
    return s;
  }

  /** Relay in the ceiling when the coach power drops or comes back. */
  private clunk(gain: number): void {
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
    u.volume = Math.min(1, settings.ambientVolume);
    speechSynthesis.speak(u);
  }
}
