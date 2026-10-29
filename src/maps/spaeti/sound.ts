import { hash01 } from '../../core/rng';
import type { MapSound, SoundKit } from '../types';
import { CARS, CYCLIST, ROOM } from './config';
import { collectorAt, pass, patrolAt } from './events';

/** Fridge compressor duty cycle: runs for a while, clicks off, comes back. Pure function of the clock. */
export function compressorOn(t: number, seed: number): boolean {
  const period = 47;
  const idx = Math.floor(t / period);
  const off = 12 + hash01(seed, idx, 61) * 14;
  return t - idx * period > off;
}

/**
 * Night shop bed, all synthesized and quiet (it plays under voice chat): fridge compressor hum
 * that cycles, mains buzz of the tubes, the slush machine churning, distant traffic with the odd
 * car passing, the patrol's engine (no siren) and the door chime when the collector comes and goes.
 */
export function spaetiSound(kit: SoundKit, seed: number): MapSound {
  const { ctx } = kit;
  const g = (v = 0) => new GainNode(ctx, { gain: v });

  // Compressor: low saw through a lowpass, slightly detuned pair for the wobble.
  const comp = g();
  const compLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 160, Q: 2 });
  for (const f of [49.5, 50.4]) {
    const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency: f });
    o.connect(compLp);
    o.start();
  }
  compLp.connect(comp).connect(kit.bed);

  // Fluorescent buzz: 100 Hz harmonics, band-passed thin.
  const buzz = g();
  const buzzOsc = new OscillatorNode(ctx, { type: 'square', frequency: 100 });
  buzzOsc.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 300, Q: 6 })).connect(buzz).connect(kit.bed);
  buzzOsc.start();

  // Slush churn: band-passed noise, amplitude pulsing with the auger.
  const noise = new AudioBufferSourceNode(ctx, { buffer: kit.noise, loop: true });
  noise.start();
  const churn = g();
  noise.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 520, Q: 1.4 })).connect(churn).connect(kit.bed);

  // Traffic: low rumble that swells when a car (or the patrol) passes.
  const trafficLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 260 });
  const traffic = g();
  noise.connect(trafficLp).connect(traffic).connect(kit.bed);
  const engine = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 38 });
  const engineGain = g();
  engine.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 140 })).connect(engineGain).connect(kit.out);
  engine.start();

  /** Two-tone shop door chime. */
  const chime = (at: number) => {
    [1318.5, 1046.5].forEach((f, i) => {
      const o = new OscillatorNode(ctx, { type: 'sine', frequency: f });
      const e = g();
      const s = at + i * 0.32;
      e.gain.setValueAtTime(0, s);
      e.gain.linearRampToValueAtTime(0.05, s + 0.01);
      e.gain.exponentialRampToValueAtTime(0.0005, s + 1.1);
      o.connect(e).connect(kit.out);
      o.start(s);
      o.stop(s + 1.2);
    });
  };

  let inside: boolean | null = null;
  return {
    update(t, power) {
      const now = ctx.currentTime;
      const on = compressorOn(t, seed);
      comp.gain.setTargetAtTime(on ? 0.028 : 0, now, on ? 0.6 : 0.15);
      buzz.gain.setTargetAtTime(0.0035 * power, now, 0.05);
      churn.gain.setTargetAtTime(power * (0.006 + 0.005 * Math.max(0, Math.sin(t * 3.9))), now, 0.08);
      // Car loudness from distance to the window.
      const car = pass(t, seed, CARS, 11);
      const cyc = pass(t, seed, CYCLIST, 21);
      const pol = patrolAt(t, seed);
      const near = (x: number) => Math.max(0, 1 - Math.abs(x) / 14);
      const carK = car ? near(car.x) : 0;
      const polK = pol ? near(pol.x) : 0;
      traffic.gain.setTargetAtTime(0.012 + 0.06 * carK * carK + 0.01 * (cyc ? near(cyc.x) : 0), now, 0.15);
      trafficLp.frequency.setTargetAtTime(220 + 500 * carK, now, 0.15);
      engineGain.gain.setTargetAtTime(0.03 * polK, now, 0.2);
      engine.frequency.setTargetAtTime(34 + 6 * polK, now, 0.2);
      // Chime whenever the collector crosses the door line.
      const c = collectorAt(t, seed);
      const isIn = !!c && c.z < ROOM.front;
      if (inside !== null && isIn !== inside) chime(now);
      inside = isIn;
    },
  };
}
