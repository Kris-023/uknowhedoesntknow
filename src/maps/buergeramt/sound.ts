import type { MapSound, SoundKit } from '../types';
import { ONE_OFFS } from './config';
import { announces, callIndex, callNumber, oneOff } from './logic';

/**
 * Hall sounds, all quiet (they play under voice chat): tube hum, a printer stuttering somewhere
 * behind the counters, the water dispenser's glug, a ticket being pulled, a soft ding per new
 * number with a rare spoken call, and the collective sigh when the system fails.
 */
export function hallSound(kit: SoundKit, seed: number): MapSound {
  const { ctx } = kit;
  const hum = new GainNode(ctx, { gain: 0 });
  const mains = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 100 });
  mains.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 200, Q: 1.2 })).connect(hum);
  const low = new OscillatorNode(ctx, { type: 'sine', frequency: 50 });
  low.connect(new GainNode(ctx, { gain: 0.6 })).connect(hum);
  hum.connect(kit.bed);
  mains.start();
  low.start();
  // A breath of room tone, so the hall isn't digital silence when the tubes die.
  const air = new AudioBufferSourceNode(ctx, { buffer: kit.noise, loop: true });
  const airGain = new GainNode(ctx, { gain: 0.008 });
  air.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 500 })).connect(airGain).connect(kit.bed);
  air.start();

  const env = (g: GainNode, t0: number, peak: number, attack: number, decay: number) => {
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + attack + decay);
  };

  const printer = () => {
    const t0 = ctx.currentTime + 0.02;
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1700, Q: 2.5 });
    const g = new GainNode(ctx, { gain: 0.02 });
    bp.connect(g).connect(kit.out);
    // Line feeds that don't come at a steady pace: the printer is thinking about it.
    let at = t0;
    for (let i = 0; i < 9; i++) {
      kit.burst(at, 0.05).connect(bp);
      at += i % 3 === 2 ? 0.26 : 0.1;
    }
  };

  const glug = () => {
    const t0 = ctx.currentTime + 0.02;
    for (let i = 0; i < 3; i++) {
      const at = t0 + i * 0.22 + (i === 2 ? 0.15 : 0);
      const o = new OscillatorNode(ctx, { type: 'sine', frequency: 180 });
      o.frequency.setValueAtTime(180 + i * 30, at);
      o.frequency.exponentialRampToValueAtTime(520 + i * 60, at + 0.08);
      const g = new GainNode(ctx, { gain: 0 });
      env(g, at, 0.05, 0.008, 0.12);
      o.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 900 })).connect(g).connect(kit.out);
      o.start(at);
      o.stop(at + 0.2);
    }
  };

  const ticket = () => {
    const t0 = ctx.currentTime + 0.02;
    // Motor whirr, then the paper tearing off.
    const m = new OscillatorNode(ctx, { type: 'square', frequency: 38 });
    const mg = new GainNode(ctx, { gain: 0 });
    env(mg, t0, 0.012, 0.02, 0.35);
    m.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 400 })).connect(mg).connect(kit.out);
    m.start(t0);
    m.stop(t0 + 0.45);
    const g = new GainNode(ctx, { gain: 0 });
    env(g, t0 + 0.38, 0.03, 0.01, 0.14);
    kit.burst(t0 + 0.38, 0.2).connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 2600 })).connect(g).connect(kit.out);
  };

  const ding = () => {
    const t0 = ctx.currentTime + 0.03;
    [988, 740].forEach((f, i) => {
      const o = new OscillatorNode(ctx, { type: 'sine', frequency: f });
      const g = new GainNode(ctx, { gain: 0 });
      env(g, t0 + i * 0.32, 0.045, 0.01, 1.3);
      o.connect(g).connect(kit.out);
      o.start(t0 + i * 0.32);
      o.stop(t0 + i * 0.32 + 1.4);
    });
  };

  const sigh = () => {
    // Twenty people exhaling at once: band-passed noise that swells, then sinks in pitch as it fades.
    const t0 = ctx.currentTime + 0.5;
    const src = new AudioBufferSourceNode(ctx, { buffer: kit.noise, loop: true });
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 900, Q: 0.9 });
    bp.frequency.setValueAtTime(900, t0);
    bp.frequency.exponentialRampToValueAtTime(320, t0 + 3.6);
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1600 });
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.14, t0 + 1.1);
    g.gain.linearRampToValueAtTime(0.09, t0 + 2.0);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + 4.2);
    src.connect(bp).connect(lp).connect(g).connect(kit.out);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + 4.4);
    // The PCs and the hum winding down.
    const o = new OscillatorNode(ctx, { type: 'triangle', frequency: 420 });
    o.frequency.setValueAtTime(420, t0 - 0.5);
    o.frequency.exponentialRampToValueAtTime(45, t0 + 0.6);
    const og = new GainNode(ctx, { gain: 0 });
    env(og, t0 - 0.5, 0.025, 0.02, 1.0);
    o.connect(og).connect(kit.out);
    o.start(t0 - 0.5);
    o.stop(t0 + 0.7);
  };

  const fired = { printer: -1, glug: -1, ticket: -1 };
  let lastCall = Number.NaN;
  let lastLow = -Infinity;
  return {
    update(t, power) {
      const now = ctx.currentTime;
      hum.gain.setTargetAtTime(0.01 * power, now, 0.08);
      for (const [name, fire] of [
        ['printer', printer],
        ['glug', glug],
        ['ticket', ticket],
      ] as const) {
        const [w, c, d, salt] = ONE_OFFS[name];
        const ev = oneOff(t, seed, w, c, d, salt);
        if (ev && ev.id !== fired[name]) {
          fired[name] = ev.id;
          // Joining mid-event: don't play a half-gone one-off from its start.
          if (ev.ph < 0.3) fire();
        }
      }
      if (power < 0.5) {
        if (t - lastLow > 6) sigh();
        lastLow = t;
      }
      const k = callIndex(t);
      if (k !== lastCall) {
        const first = Number.isNaN(lastCall);
        lastCall = k;
        // No calls while the system is down or just rebooting; nothing on the very first frame.
        if (first || t - lastLow < 9) return;
        const c = callNumber(seed, k);
        if (announces(seed, k)) kit.announce(`Nummer ${c.num.split('').join(' ')} bitte zu Schalter ${c.desk}.`);
        else ding();
      }
    },
  };
}
