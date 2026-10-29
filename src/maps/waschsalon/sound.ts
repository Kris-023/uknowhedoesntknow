import { flick } from '../../core/motion';
import type { MapSound, SoundKit } from '../types';
import { WS } from './config';
import { badTubeSeed, beepAt, coinRoutine, imbalanceAt, machineBusy } from './schedule';

const S = WS.sound;
/** Stacked pairs minus the lone imbalance column, plus the back wall's four. */
const MACHINES = (WS.stack.z.length - 1) * 2 + 4;

/**
 * Laundromat bed, all synthesized: mains hum of the machines, water sloshing in time with the
 * drums, the bad tube buzzing when it stutters, rain on the glass, now and then a dryer beeping.
 * The imbalance is a low rumble with a thump per drum turn. Kept quiet: it plays under voice chat.
 */
export function waschSound(kit: SoundKit, seed: number): MapSound {
  // Steady layers go to the bed ("Ruhige Umgebung" turns it down), one-offs straight to out.
  const { ctx, out, bed } = kit;
  const noise = () => {
    const n = new AudioBufferSourceNode(ctx, { buffer: kit.noise, loop: true });
    n.start(ctx.currentTime, Math.random() * 1.5);
    return n;
  };

  // Machine hum: 50 Hz mains plus its harmonic, through a low-pass.
  const humOsc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 50 });
  const hum = new GainNode(ctx, { gain: 0 });
  humOsc.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 180 })).connect(hum).connect(bed);
  humOsc.start();

  // Slosh: band-passed noise, gated by the tumble rhythm below.
  const sloshF = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 420, Q: 1.2 });
  const slosh = new GainNode(ctx, { gain: 0 });
  noise().connect(sloshF).connect(slosh).connect(bed);

  // Neon buzz: 100 Hz rich tone, only the upper harmonics heard.
  const buzzOsc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 100 });
  const buzz = new GainNode(ctx, { gain: 0 });
  buzzOsc.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1400, Q: 2 })).connect(buzz).connect(bed);
  buzzOsc.start();

  // Rain: soft hiss plus a brighter patter layer.
  const rainHiss = new GainNode(ctx, { gain: S.rain });
  noise().connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2400 })).connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 500 })).connect(rainHiss).connect(bed);
  const patter = new GainNode(ctx, { gain: S.rain * 0.5 });
  noise().connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 5200, Q: 0.8 })).connect(patter).connect(bed);

  // Imbalance: sub rumble whose level a 'thump' LFO chops into knocks, one per drum turn.
  const rumbleOsc = new OscillatorNode(ctx, { type: 'sine', frequency: 38 });
  const rumbleNoise = noise();
  const rumbleLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 140 });
  const knock = new GainNode(ctx, { gain: 0.3 });
  const thumpLfo = new OscillatorNode(ctx, { type: 'sine', frequency: 3 });
  // Shapes the sine into short positive pulses: mostly silence, a hard knock per revolution.
  const shaper = new WaveShaperNode(ctx, { curve: pulseCurve() });
  thumpLfo.connect(shaper).connect(knock.gain);
  thumpLfo.start();
  rumbleOsc.connect(knock);
  rumbleNoise.connect(rumbleLp).connect(knock);
  const rumble = new GainNode(ctx, { gain: 0 });
  knock.connect(rumble).connect(out);
  rumbleOsc.start();

  let lastBeep = -1;
  let lastCoin = -1;
  let lastSlap = -1;
  let lastPop = -1;
  return {
    update(t, power) {
      const now = ctx.currentTime;
      let busy = 0;
      for (let i = 0; i < MACHINES; i++) if (machineBusy(i, t, seed)) busy++;
      const load = busy / MACHINES;
      hum.gain.setTargetAtTime(S.hum * load * power, now, 0.2);
      // Water falls once per drum lift (~1.4 s), stronger while the drums turn.
      const tumble = Math.pow(Math.max(0, Math.sin(t * 4.4)), 3) * 0.7 + 0.3 * Math.max(0, Math.sin(t * 2.9 + 1));
      slosh.gain.setTargetAtTime(S.slosh * load * tumble * power, now, 0.08);

      // The bad tube buzzes loudest while it stutters, and not at all without power.
      const k = flick(t, badTubeSeed(seed));
      const stutter = k < 0.5 ? 1 : 0.35;
      buzz.gain.setTargetAtTime(S.buzz * stutter * power, now, 0.02);

      const ev = imbalanceAt(t, seed);
      const shake = ev ? ev.shake : 0;
      const spin = ev ? ev.spin : 0;
      rumble.gain.setTargetAtTime(S.rumble * shake, now, 0.15);
      thumpLfo.frequency.setTargetAtTime(1.5 + 3.5 * spin, now, 0.3);
      rumbleOsc.frequency.setTargetAtTime(32 + 16 * spin, now, 0.3);
      // The fuse: a sharp electric pop just before the lights die (the kit adds the relay clunk).
      if (ev && power < 0.99 && t >= ev.fuseAt - 0.65 && t < ev.fuseAt && ev.id !== lastPop) {
        lastPop = ev.id;
        pop(kit, 0.12);
      }

      const bi = Math.floor(t / S.beepWindowS);
      const at = beepAt(bi, seed);
      if (at !== null && bi !== lastBeep && t >= at && t < at + 0.5 && power > 0.5) {
        lastBeep = bi;
        beep(kit, 3);
      }

      const c = coinRoutine(t, seed);
      if (c.ph >= 1.0 && c.ph < 1.3 && c.cycle !== lastCoin) {
        lastCoin = c.cycle;
        clink(kit);
      }
      if (c.ph >= 3.45 && c.ph < 3.75 && c.cycle !== lastSlap) {
        lastSlap = c.cycle;
        thud(kit);
      }
    },
  };
}

function pulseCurve(): Float32Array<ArrayBuffer> {
  const n = 256;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.pow(Math.max(0, x), 6) * 1.6;
  }
  return c;
}

/** Dryer finished: a few short square beeps. */
function beep(kit: SoundKit, count: number): void {
  const { ctx } = kit;
  for (let i = 0; i < count; i++) {
    const t0 = ctx.currentTime + 0.02 + i * 0.32;
    const o = new OscillatorNode(ctx, { type: 'square', frequency: 2350 });
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(S.beep, t0);
    g.gain.setValueAtTime(0, t0 + 0.14);
    o.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 4000 })).connect(g).connect(kit.out);
    o.start(t0);
    o.stop(t0 + 0.16);
  }
}

/** A coin dropping into the changer: two bright metallic pings. */
function clink(kit: SoundKit): void {
  const { ctx } = kit;
  [0, 0.09, 0.2].forEach((dt, i) => {
    const t0 = ctx.currentTime + 0.01 + dt;
    const o = new OscillatorNode(ctx, { type: 'sine', frequency: 3100 + i * 640 });
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(0.025 / (i + 1), t0);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.25);
    o.connect(g).connect(kit.out);
    o.start(t0);
    o.stop(t0 + 0.3);
  });
}

/** Fist on sheet metal. */
function thud(kit: SoundKit): void {
  const { ctx } = kit;
  const t0 = ctx.currentTime + 0.01;
  const o = new OscillatorNode(ctx, { type: 'triangle', frequency: 120 });
  o.frequency.exponentialRampToValueAtTime(60, t0 + 0.2);
  const g = new GainNode(ctx, { gain: 0 });
  g.gain.setValueAtTime(0.07, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
  o.connect(g).connect(kit.out);
  o.start(t0);
  o.stop(t0 + 0.32);
  const n = new GainNode(ctx, { gain: 0 });
  n.gain.setValueAtTime(0.03, t0);
  n.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
  kit.burst(t0, 0.13).connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 900, Q: 1.5 })).connect(n).connect(kit.out);
}

/** Fuse blowing: a crackle burst. */
function pop(kit: SoundKit, gain: number): void {
  const { ctx } = kit;
  const t0 = ctx.currentTime + 0.01;
  const g = new GainNode(ctx, { gain: 0 });
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
  kit.burst(t0, 0.1).connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 1500 })).connect(g).connect(kit.out);
}
