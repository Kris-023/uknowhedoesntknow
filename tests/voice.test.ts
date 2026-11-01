import { describe, expect, it } from 'vitest';
import { announceGain } from '../src/audio/ambience';
import { distanceMix, gateStep, mouthByte, rmsToLevel, sendsAudio } from '../src/audio/voice';
import { SCHAFFNER, VOICE } from '../src/config';
import { LoudTracker } from '../src/game/schaffner';
import { encodeLevel, parseLevel } from '../src/net/protocol';

const rmsAt = (db: number) => 10 ** (db / 20);

describe('voice levels', () => {
  it('keeps the mouth shut below the gate and wide open at full level', () => {
    expect(rmsToLevel(0)).toBe(0);
    expect(rmsToLevel(rmsAt(VOICE.gateDb - 5))).toBe(0);
    expect(rmsToLevel(rmsAt(VOICE.fullDb + 5))).toBe(1);
    expect(rmsToLevel(rmsAt((VOICE.gateDb + VOICE.fullDb) / 2))).toBeCloseTo(0.5, 5);
  });

  it('voices in the coach stay dry, distant ones get dull and echoey', () => {
    const near = distanceMix(1.5);
    expect(near.lowpassHz).toBeCloseTo(VOICE.lowpassNearHz, 0);
    expect(near.wet).toBeCloseTo(VOICE.wetNear, 5);
    const mid = distanceMix((VOICE.nearM + VOICE.farM) / 2);
    expect(mid.lowpassHz).toBeLessThan(VOICE.lowpassNearHz);
    expect(mid.wet).toBeGreaterThan(VOICE.wetNear);
    const far = distanceMix(VOICE.farM + 5);
    expect(far.lowpassHz).toBeCloseTo(VOICE.lowpassFarHz, 0);
    expect(far.wet).toBeCloseTo(VOICE.wetFar, 5);
  });
});

describe('voice activation', () => {
  /** Feed levels every 15 ms, return the gate state per step. */
  const run = (levels: number[], threshold = 0.5, hang = 450) => {
    let g = { open: false, lastLoud: -Infinity };
    return levels.map((l, i) => (g = gateStep(g.open, l, threshold, i * 15, g.lastLoud, hang)).open);
  };

  it('stays closed below the threshold', () => {
    expect(run([0.1, 0.3, 0.49, 0.2]).some(Boolean)).toBe(false);
  });

  it('opens at once, holds through short pauses, closes after the hang time', () => {
    const quiet = (n: number) => Array(n).fill(0);
    const states = run([0.8, ...quiet(20), 0.7, ...quiet(40)]);
    expect(states[0]).toBe(true);
    // 300 ms pause between two words: still open.
    expect(states.slice(0, 22).every(Boolean)).toBe(true);
    // 450 ms after the last loud moment it's closed.
    expect(states[21 + 30]).toBe(false);
    expect(states.at(-1)).toBe(false);
  });
});

describe('Nur Mundbewegung', () => {
  it('never lets audio out, whatever the gate or the key do', () => {
    for (const open of [false, true]) for (const ptt of [false, true]) expect(sendsAudio('mouth', open, ptt)).toBe(false);
  });

  it('leaves the other modes as they were', () => {
    expect(sendsAudio('open', false, false)).toBe(true);
    expect(sendsAudio('auto', false, true)).toBe(false);
    expect(sendsAudio('auto', true, false)).toBe(true);
    expect(sendsAudio('ptt', true, false)).toBe(false);
    expect(sendsAudio('ptt', false, true)).toBe(true);
  });

  it('sends the level only above the threshold (gate open), 0 below', () => {
    // The gate is the same step as voice activation, with the Schwelle as threshold.
    const open = (level: number, threshold: number) => gateStep(false, level, threshold, 0, -Infinity, VOICE.vadHangMs).open;
    expect(mouthByte(0.4, open(0.4, 0.5))).toBe(0);
    expect(mouthByte(0.7, open(0.7, 0.5))).toBe(encodeLevel(0.7));
    expect(mouthByte(1, open(1, 0.95))).toBe(255);
  });

  it('level on the wire: a byte, parsed back to 0..1', () => {
    expect(encodeLevel(0)).toBe(0);
    expect(encodeLevel(1)).toBe(255);
    expect(encodeLevel(2)).toBe(255);
    expect(encodeLevel(-1)).toBe(0);
    expect(parseLevel(0)).toBe(0);
    expect(parseLevel(255)).toBe(1);
    expect(parseLevel(encodeLevel(0.5))).toBeCloseTo(0.5, 2);
  });

  it('drops garbage levels', () => {
    for (const bad of [-1, 256, 1000, 0.5, NaN, Infinity, '12', null, undefined, {}, [], [1], true]) expect(parseLevel(bad)).toBeNull();
  });

  it('a mouth-mode level is judged by the Schaffner like audio of that level', () => {
    const feed = (level: number) => {
      const t = new LoudTracker();
      let caught: string | null = null;
      // Levels as they arrive over the wire: bytes, back to 0..1.
      const lv = parseLevel(encodeLevel(level)) ?? 0;
      for (let i = 0; i < (SCHAFFNER.loudS + 1) * 60 && !caught; i++) caught = t.feed(new Map([['p', lv]]), 1 / 60, i / 60);
      return caught;
    };
    expect(feed(1)).toBe('p');
    expect(feed(0.9)).toBeNull();
  });
});

describe('Schaffner volume floor', () => {
  it('ambient announcements follow the slider down to 0 (off)', () => {
    expect(announceGain(0, false)).toBe(0);
    expect(announceGain(0.8, false)).toBe(0.8);
  });

  it('the Schaffner stays audible at 0 and above the floor follows the slider', () => {
    expect(announceGain(0, true)).toBe(SCHAFFNER.minVolume);
    expect(SCHAFFNER.minVolume).toBeGreaterThan(0);
    expect(announceGain(SCHAFFNER.minVolume / 2, true)).toBe(SCHAFFNER.minVolume);
    expect(announceGain(1.2, true)).toBe(1.2);
  });
});
