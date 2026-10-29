import { hash01 } from '../../core/rng';
import type { MapSound, SoundKit } from '../types';
import { KNOCK, MUSIC } from './config';
import { bassLevel, knock, tvSnow } from './events';

// The WG at night, all synthesized: the party behind the wall, the fridge in the kitchen, the TV,
// a bottle now and then, and the neighbour's three thuds plus a muffled "Ruhe!".

/** Bass line roots per bar (Hz), picked by the seed: A, F, C, G and friends. */
const ROOTS = [55, 43.65, 65.41, 49, 41.2, 58.27];
const CLINK_SLOT = 7;
const FRIDGE = { period: 70, onS: 46 } as const;

export function wgSound(kit: SoundKit, seed: number): MapSound {
  const { ctx } = kit;

  // Two walls between us and the party: only the low end makes it through.
  const wall = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: MUSIC.wallCutoff, Q: 0.8 });
  const music = new GainNode(ctx, { gain: MUSIC.gain });
  music.connect(wall).connect(kit.music);

  // Fridge in the kitchen: mains hum with its first harmonic, cycling on and off.
  const fridgeOsc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 50 });
  const fridge = new GainNode(ctx, { gain: 0 });
  fridgeOsc.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 130 })).connect(fridge).connect(kit.bed);
  fridgeOsc.start();

  // TV: hiss for snow, a thin test tone for the test card.
  const hissSrc = new AudioBufferSourceNode(ctx, { buffer: kit.noise, loop: true });
  const hiss = new GainNode(ctx, { gain: 0 });
  hissSrc.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 3800, Q: 0.5 })).connect(hiss).connect(kit.bed);
  hissSrc.start();
  const toneOsc = new OscillatorNode(ctx, { type: 'sine', frequency: 1000 });
  const tone = new GainNode(ctx, { gain: 0 });
  toneOsc.connect(tone).connect(kit.bed);
  toneOsc.start();

  // Through the ceiling: knocks and the shout lose their highs.
  const ceiling = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 900, Q: 0.6 });
  ceiling.connect(kit.out);

  const progression = [0, 1, 2, 3].map((i) => ROOTS[Math.floor(hash01(seed, i, 7) * ROOTS.length) % ROOTS.length]);

  const kick = (at: number) => {
    const o = new OscillatorNode(ctx, { type: 'sine', frequency: 120 });
    o.frequency.setValueAtTime(120, at);
    o.frequency.exponentialRampToValueAtTime(42, at + 0.12);
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(1, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.32);
    o.connect(g).connect(music);
    o.start(at);
    o.stop(at + 0.35);
  };
  const bass = (at: number, f: number, len: number) => {
    const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency: f });
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.55, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.01, at + len);
    o.connect(g).connect(music);
    o.start(at);
    o.stop(at + len + 0.02);
  };
  const thud = (at: number) => {
    const o = new OscillatorNode(ctx, { type: 'sine', frequency: 75 });
    o.frequency.setValueAtTime(75, at);
    o.frequency.exponentialRampToValueAtTime(40, at + 0.2);
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.9, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
    o.connect(g).connect(ceiling);
    o.start(at);
    o.stop(at + 0.32);
    const n = kit.burst(at, 0.1);
    const ng = new GainNode(ctx, { gain: 0.5 });
    n.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 320 })).connect(ng).connect(ceiling);
  };
  /** "Ru-he!": a sawtooth voice through two moving formant filters, muffled by the floor. */
  const shout = (at: number) => {
    const src = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 190 });
    src.frequency.setValueAtTime(175, at);
    src.frequency.linearRampToValueAtTime(215, at + 0.25);
    src.frequency.linearRampToValueAtTime(230, at + 0.42);
    src.frequency.linearRampToValueAtTime(160, at + 0.85);
    const f1 = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 320, Q: 6 });
    const f2 = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 750, Q: 8 });
    for (const [f, a, bb] of [
      [f1, 320, 500],
      [f2, 760, 1850],
    ] as const) {
      f.frequency.setValueAtTime(a, at);
      f.frequency.setValueAtTime(a, at + 0.3);
      f.frequency.linearRampToValueAtTime(bb, at + 0.42);
    }
    const env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(0.9, at + 0.06);
    env.gain.setValueAtTime(0.9, at + 0.26);
    env.gain.linearRampToValueAtTime(0.15, at + 0.34);
    env.gain.linearRampToValueAtTime(1, at + 0.44);
    env.gain.setValueAtTime(1, at + 0.7);
    env.gain.exponentialRampToValueAtTime(0.001, at + 0.95);
    const out = new GainNode(ctx, { gain: 2.4 });
    src.connect(f1).connect(env);
    src.connect(f2).connect(env);
    env.connect(out).connect(ceiling);
    src.start(at);
    src.stop(at + 1);
    // The breathy "h" between the syllables.
    const h = kit.burst(at + 0.3, 0.1);
    const hg = new GainNode(ctx, { gain: 0.25 });
    h.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1400, Q: 1 })).connect(hg).connect(ceiling);
  };
  const clink = (at: number) => {
    for (const [f, d, v] of [
      [2950, 0, 0.03],
      [4420, 0, 0.018],
      [3100, 0.085, 0.014],
    ] as const) {
      const o = new OscillatorNode(ctx, { type: 'sine', frequency: f });
      const g = new GainNode(ctx, { gain: 0 });
      g.gain.setValueAtTime(0.0001, at + d);
      g.gain.linearRampToValueAtTime(v, at + d + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0005, at + d + 0.22);
      o.connect(g).connect(kit.out);
      o.start(at + d);
      o.stop(at + d + 0.25);
    }
  };

  const beatLen = 60 / MUSIC.bpm;
  let lastBeat = -Infinity;
  let lastKnock = -1;
  let lastClink = -1;
  let fridgeWasOn = true;

  return {
    update(t, power) {
      const now = ctx.currentTime;
      const k = knock(t, seed);
      const level = bassLevel(k);
      music.gain.setTargetAtTime(MUSIC.gain * level, now, level < 0.05 ? 0.04 : 0.4);

      // Schedule the beats of the next quarter second; a clock jump starts over.
      const firstDue = Math.ceil(t / beatLen);
      if (lastBeat < firstDue - 8 || lastBeat > firstDue + 8) lastBeat = firstDue - 1;
      for (let b = lastBeat + 1; b * beatLen < t + 0.25; b++) {
        const at = now + Math.max(0, b * beatLen - t);
        lastBeat = b;
        if (level < 0.02) continue;
        kick(at);
        const root = progression[Math.floor(b / 16) % 4];
        // Off-beat bass, an octave jump on the last eighth of each bar.
        bass(at + beatLen / 2, b % 4 === 3 ? root * 2 : root, beatLen * 0.45);
      }

      if (k && k.id !== lastKnock && k.ph < KNOCK.shoutAt) {
        lastKnock = k.id;
        for (const th of KNOCK.thuds) if (th >= k.ph - 0.05) thud(now + Math.max(0, th - k.ph));
        shout(now + KNOCK.shoutAt - k.ph);
      }

      // Kitchen fridge on the same fuse as everything else.
      const fridgeOn = (t + (seed % FRIDGE.period)) % FRIDGE.period < FRIDGE.onS && power > 0.5;
      fridge.gain.setTargetAtTime(fridgeOn ? 0.014 : 0, now, fridgeOn ? 0.8 : 0.08);
      if (fridgeWasOn && !fridgeOn) {
        // Compressor stops with a shudder.
        const n = kit.burst(now, 0.25);
        const g = new GainNode(ctx, { gain: 0.06 });
        n.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 180 })).connect(g).connect(kit.out);
      }
      fridgeWasOn = fridgeOn;

      const snow = tvSnow(t, seed);
      hiss.gain.setTargetAtTime(snow ? 0.006 * power : 0, now, 0.05);
      tone.gain.setTargetAtTime(snow ? 0 : 0.0018 * power, now, 0.05);

      const slot = Math.floor(t / CLINK_SLOT);
      const clinkAt = slot * CLINK_SLOT + 0.5 + hash01(seed, slot, 82) * 5.5;
      if (slot !== lastClink && t >= clinkAt && t < clinkAt + 0.5) {
        lastClink = slot;
        if (hash01(seed, slot, 81) < 0.3) clink(now);
      }
    },
  };
}
