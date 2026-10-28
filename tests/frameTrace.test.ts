import { describe, expect, it } from 'vitest';
import { droppedFrames, FrameTrace, lowFps } from '../src/debug/frameTrace';

describe('frame stats', () => {
  it('counts skipped refresh intervals', () => {
    // 144 Hz: one frame took two intervals, one three, one only a little late.
    const i = 1000 / 144;
    expect(droppedFrames([i, i, 2 * i, i, 3 * i, 1.3 * i], i)).toBe(3);
  });

  it('averages the slowest frames for the lows', () => {
    const ms = [...Array(99).fill(10), 40];
    expect(lowFps(ms, 0.01)).toBeCloseTo(25);
    expect(lowFps(ms, 0.5)).toBeCloseTo(1000 / ((49 * 10 + 40) / 50));
  });

  it('reports GPU times per spike and says when GC or GPU timing is unavailable', () => {
    // The report header reads the screen density; Node has none.
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio ??= 1;
    const tr = new FrameTrace();
    tr.start();
    for (let i = 0; i < 50; i++) tr.add(7, 3, 300, [], { ms: 4 });
    tr.add(42, 4, 300, ['GC'], { ms: 30 });
    tr.add(7, 3, 300, [], { ms: null });
    tr.stop();
    const rep = tr.report({ render: { w: 1920, h: 1080 }, settings: 'x', gpuTimer: true, heapPrecise: true });
    expect(rep).toContain('GPU-Zeit pro Frame: Median 4.0 ms · max 30.0 ms (51 von 52 Frames gemessen)');
    expect(rep).toMatch(/42\.0 \| {2}6\.0 \| {3}4\.0 \| {2}30\.0 \| GC/);
    const bare = tr.report({ render: { w: 1, h: 1 }, settings: 'x' });
    expect(bare).toContain('GPU-Zeit: nicht verfügbar');
    expect(bare).toContain('GC: nicht messbar');
  });
});
