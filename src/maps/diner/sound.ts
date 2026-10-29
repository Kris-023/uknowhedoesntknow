import { hash01 } from '../../core/rng';
import type { MapSound, SoundKit } from '../types';
import { COOK_BELL_AT, COOK_LOOP_S, FRYER, SIGN } from './config';
import { bellIndex, debugFlare, fryerFlare, signLetters, waitressPose } from './events';

/** I–vi–IV–V in 12/8: chord tones (semitones from the key root) and the bass root. */
const CHORDS = [
  { tones: [0, 4, 7, 12], bass: 0 },
  { tones: [-3, 0, 4, 9], bass: -3 },
  { tones: [-7, -3, 0, 5], bass: -7 },
  { tones: [-5, -1, 2, 7], bass: -5 },
] as const;
const ARP = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1] as const;
const BAR_S = (60 / 66) * 4;
const STEP_S = BAR_S / 12;
/** Sixteen bars per song, then a few seconds while the next record drops. */
const SONG_BARS = 16;
const GAP_S = 4;
const SONG_S = SONG_BARS * BAR_S + GAP_S;
const KEYS = [0, 3, 5, -2, 7] as const;
const LETTERS = [...SIGN.name].length;

const hz = (semi: number, base: number) => base * Math.pow(2, semi / 12);

/**
 * The diner at 4 a.m.: fryer sizzle, the old fridge, a jukebox far across the room, the coffee
 * machine, the order bell, and the neon transformer buzzing when a letter dies. All timing comes
 * from the shared clock, so the bell rings for everyone at once.
 */
export function dinerSound(kit: SoundKit, seed: number): MapSound {
  const { ctx } = kit;
  const src = new AudioBufferSourceNode(ctx, { buffer: kit.noise, loop: true });
  src.start();

  const sizzle = new GainNode(ctx, { gain: 0 });
  src.connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 2600 })).connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 9000 })).connect(sizzle).connect(kit.bed);

  const gurgleBp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 420, Q: 5 });
  const gurgle = new GainNode(ctx, { gain: 0 });
  src.connect(gurgleBp).connect(gurgle).connect(kit.bed);

  // Fridge: mains hum with its harmonics, through a lowpass like a cabinet across the room.
  const fridge = new GainNode(ctx, { gain: 0 });
  const fridgeLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 320 });
  fridgeLp.connect(fridge).connect(kit.bed);
  for (const [f, g, type] of [
    [50, 1, 'sine'],
    [100, 0.5, 'sine'],
    [150, 0.25, 'triangle'],
  ] as const) {
    const o = new OscillatorNode(ctx, { type, frequency: f });
    o.connect(new GainNode(ctx, { gain: g })).connect(fridgeLp);
    o.start();
  }

  // Neon transformer: a thin 100 Hz buzz that only shows up while a letter fights for its life.
  const buzz = new GainNode(ctx, { gain: 0 });
  const buzzOsc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 100 });
  buzzOsc.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1200, Q: 1.2 })).connect(buzz).connect(kit.bed);
  buzzOsc.start();

  // Jukebox: everything goes through a lowpass, it plays from the far corner.
  const music = new GainNode(ctx, { gain: 0 });
  const musicLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1100, Q: 0.5 });
  music.connect(musicLp).connect(kit.music);

  const note = (at: number, freq: number, dur: number, gain: number, type: OscillatorType, attack = 0.01) => {
    const o = new OscillatorNode(ctx, { type, frequency: freq });
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(music);
    o.start(at);
    o.stop(at + dur + 0.05);
  };

  const playStep = (step: number, at: number) => {
    const songT = step * STEP_S;
    const song = Math.floor(songT / SONG_S);
    const inSong = songT - song * SONG_S;
    if (inSong >= SONG_BARS * BAR_S) return;
    const local = Math.round(inSong / STEP_S);
    const bar = Math.floor(local / 12);
    const k = local % 12;
    const key = KEYS[Math.floor(hash01(seed, song, 501) * KEYS.length) % KEYS.length];
    const chord = CHORDS[bar % 4];
    const root = hz(key, 261.63);
    note(at, hz(chord.tones[ARP[k]], root), STEP_S * 2.2, 0.05, 'triangle');
    if (k === 0 || k === 6) note(at, hz(chord.bass + (k === 6 ? 7 : 0), root / 2), STEP_S * 5, 0.09, 'sine');
    // Backing "ooh": the chord held over the bar, soft attack.
    if (k === 0) for (const t of chord.tones.slice(0, 3)) note(at, hz(t, root), BAR_S * 0.95, 0.018, 'sine', 0.4);
    if (k === 3 || k === 9) kit.burst(at, 0.05).connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 5000 })).connect(new GainNode(ctx, { gain: 0.05 })).connect(music);
  };

  const ding = (at: number) => {
    for (const [f, g, d] of [
      [1760, 0.05, 1.6],
      [4860, 0.018, 0.7],
      [9500, 0.006, 0.3],
    ] as const) {
      const o = new OscillatorNode(ctx, { type: 'sine', frequency: f });
      const e = new GainNode(ctx, { gain: 0 });
      e.gain.setValueAtTime(g, at);
      e.gain.exponentialRampToValueAtTime(0.0001, at + d);
      o.connect(e).connect(kit.out);
      o.start(at);
      o.stop(at + d + 0.05);
    }
  };

  const whoosh = (at: number) => {
    // Whoomp of the oil catching, then a long angry hiss.
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 180 });
    lp.frequency.setValueAtTime(180, at);
    lp.frequency.exponentialRampToValueAtTime(1800, at + 0.25);
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.22, at + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.9);
    kit.burst(at, 0.95).connect(lp).connect(g).connect(kit.out);
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 3000 });
    const h = new GainNode(ctx, { gain: 0 });
    h.gain.setValueAtTime(0, at);
    h.gain.linearRampToValueAtTime(0.07, at + 0.1);
    h.gain.exponentialRampToValueAtTime(0.001, at + 1.9);
    kit.burst(at, 1.95).connect(hp).connect(h).connect(kit.out);
  };

  const beep = (at: number) => {
    const o = new OscillatorNode(ctx, { type: 'square', frequency: 3150 });
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(0.02, at);
    g.gain.setValueAtTime(0, at + FRYER.beepS);
    o.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 3150, Q: 3 })).connect(g).connect(kit.out);
    o.start(at);
    o.stop(at + FRYER.beepS + 0.02);
  };

  let nextStep = -1;
  let lastBell = bellIndex(0);
  let lastFlare: number | null = null;
  const letters: number[] = [];

  return {
    update(t, power) {
      const now = ctx.currentTime;
      const on = power > 0.5 ? 1 : 0;

      // Music: schedule a quarter second ahead; a clock jump simply restarts from now.
      const first = Math.ceil(t / STEP_S);
      if (nextStep < first || nextStep > first + 8) nextStep = first;
      while (nextStep * STEP_S < t + 0.25) {
        playStep(nextStep, now + Math.max(0, nextStep * STEP_S - t));
        nextStep++;
      }
      music.gain.setTargetAtTime(0.35 * on, now, on ? 0.4 : 0.05);

      const flare = fryerFlare(t, seed, debugFlare.at);
      const fire = flare ? Math.max(0, 1 - flare.ph / 3.5) : 0;
      const crackle = hash01(seed, Math.floor(t * 14), 7) > 0.82 ? 1 : 0;
      // The idle hiss stays low: it never stops and wears on you over an evening; the fire is loud.
      sizzle.gain.setTargetAtTime(0.002 + 0.0045 * crackle + 0.06 * fire * (0.5 + crackle), now, 0.015);

      // Compressor cycle: 55 s on, 25 s off, with power.
      const cyc = (t + (seed % 37)) % 80;
      fridge.gain.setTargetAtTime(cyc < 55 ? 0.018 * power : 0, now, cyc < 55 ? 1.5 : 0.2);

      const w = waitressPose(t, seed);
      const brewing = w.act === 'fetch' && w.ph < 4.6;
      const bubble = hash01(seed, Math.floor(t * 9), 11);
      gurgle.gain.setTargetAtTime(brewing && power > 0.5 ? 0.05 * bubble * bubble : 0, now, 0.03);
      gurgleBp.frequency.setTargetAtTime(280 + 500 * hash01(seed, Math.floor(t * 9), 12), now, 0.02);

      const dying = signLetters(t, seed, LETTERS, letters);
      const flick = dying >= 0 && letters[dying] > 0.05 && letters[dying] < 1 ? 1 : 0;
      buzz.gain.setTargetAtTime(power > 0.5 ? 0.0015 + 0.012 * flick : 0, now, 0.01);

      const bi = bellIndex(t);
      if (bi !== lastBell) {
        lastBell = bi;
        // Only when the moment is fresh (not after a tab was asleep) and the cook isn't busy with flames.
        if (!flare && t - (bi * COOK_LOOP_S + COOK_BELL_AT) < 0.5) ding(now);
      }

      if (flare && flare.id !== lastFlare) {
        lastFlare = flare.id;
        if (flare.ph < 0.5) {
          whoosh(now);
          for (const b of FRYER.beeps) if (b > flare.ph) beep(now + b - flare.ph);
        }
      }
    },
  };
}
