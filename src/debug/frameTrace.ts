/**
 * Frame recorder for the benchmark: every frame's duration, the main-thread work inside it and what
 * was happening in the scene, turned into a plain-text report to paste into a chat.
 *
 * Frame time vs. work time tells stutters apart: a long frame with little work happened outside our
 * loop (GPU, compositor, browser), a long frame full of work is our own code or garbage collection.
 */

import type { GpuCell } from './gpuTimer';

type Sample = { t: number; ms: number; work: number; calls: number; tags: string[]; gpu: GpuCell | null };

export interface FrameMeta {
  render: { w: number; h: number };
  settings: string;
  /** GPU timer queries exist in this browser. */
  gpuTimer?: boolean;
  /** The JS heap counter moves frame by frame (Chrome started with --enable-precise-memory-info). */
  heapPrecise?: boolean;
}

const fmtGpu = (c: GpuCell | null) => (c?.ms == null ? '–' : c.ms.toFixed(1));

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1] ?? 0;
};

/** Average fps of the slowest share of frames (1 % low, 0.1 % low). */
export function lowFps(ms: number[], share: number): number {
  if (!ms.length) return 0;
  const worst = [...ms].sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(ms.length * share)));
  return 1000 / (worst.reduce((a, b) => a + b, 0) / worst.length);
}

/**
 * Frames the screen had to show twice because ours wasn't ready: a frame of 2.1 refresh intervals
 * skipped one. The median frame is taken as the interval (the game runs at the refresh rate when smooth).
 */
export function droppedFrames(ms: number[], interval: number): number {
  if (!(interval > 0)) return 0;
  return ms.reduce((n, m) => n + Math.max(0, Math.round(m / interval) - 1), 0);
}

export class FrameTrace {
  active = false;
  private t0 = 0;
  private samples: Sample[] = [];

  start(): void {
    this.active = true;
    this.t0 = performance.now();
    this.samples = [];
  }

  stop(): void {
    this.active = false;
  }

  add(ms: number, work: number, calls: number, tags: string[], gpu: GpuCell | null = null): void {
    if (this.active) this.samples.push({ t: performance.now() - this.t0, ms, work, calls, tags, gpu });
  }

  report(meta: FrameMeta): string {
    const s = this.samples;
    if (!s.length) return 'Keine Frames aufgezeichnet.';
    const ms = s.map((x) => x.ms);
    const total = ms.reduce((a, b) => a + b, 0);
    const med = median(ms);
    const spikeAt = Math.max(med * 1.7, med + 6);
    const spikes = s.filter((x) => x.ms > spikeAt);
    const max = Math.max(...ms);
    const dropped = droppedFrames(ms, med);
    const share = (lo: number, hi: number) => s.filter((x) => x.ms / med >= lo && x.ms / med < hi).length;
    const lines = [
      `Ruckler-Bericht · ${new Date().toISOString()}`,
      `Browser: ${navigator.userAgent}`,
      `devicePixelRatio ${devicePixelRatio} · Auflösung ${meta.render.w}×${meta.render.h} · ${meta.settings}`,
      `Dauer ${(total / 1000).toFixed(1)} s · Frames ${s.length} · Draw-Calls Ø ${Math.round(s.reduce((a, x) => a + x.calls, 0) / s.length)}`,
      '',
      `FPS Ø ${((1000 * s.length) / total).toFixed(1)} · Median-Frame ${med.toFixed(1)} ms (≈ ${(1000 / med).toFixed(0)} Hz)`,
      `1 % Low ${lowFps(ms, 0.01).toFixed(1)} · 0,1 % Low ${lowFps(ms, 0.001).toFixed(1)} · niedrigste ${(1000 / max).toFixed(1)} FPS (längster Frame ${max.toFixed(1)} ms)`,
      `Verworfene Frames (Bildschirm zeigte ein Bild doppelt): ${dropped} · Ruckler (> ${spikeAt.toFixed(0)} ms): ${spikes.length}`,
      `Eigene Arbeit pro Frame: Median ${median(s.map((x) => x.work)).toFixed(1)} ms · max ${Math.max(...s.map((x) => x.work)).toFixed(1)} ms`,
      `Verteilung (× Median): < 1,2: ${share(0, 1.2)} · 1,2–1,7: ${share(1.2, 1.7)} · 1,7–3: ${share(1.7, 3)} · ≥ 3: ${share(3, Infinity)}`,
      gpuLine(s, meta),
      meta.heapPrecise
        ? `GC: Anlass „GC“ = JS-Heap ist seit dem letzten Frame geschrumpft (${s.filter((x) => x.tags.includes('GC')).length}× in der Aufnahme).`
        : 'GC: nicht messbar (Chrome zeigt den JS-Heap nur grob; mit --enable-precise-memory-info starten, dann gibt es den Anlass „GC“).',
      '',
      'Anlässe (Anteil der Zeit · Ruckler währenddessen · Ruckler pro Minute mit / ohne):',
    ];
    // Does a scene event make stutters more likely? Compare the rate with and without it.
    const tags = [...new Set(s.flatMap((x) => x.tags))].sort();
    for (const tag of tags) {
      const withT = s.filter((x) => x.tags.includes(tag));
      const tWith = withT.reduce((a, x) => a + x.ms, 0) / 60000;
      const tWithout = (total - tWith * 60000) / 60000;
      const kWith = withT.filter((x) => x.ms > spikeAt).length;
      const kWithout = spikes.length - kWith;
      const rate = (k: number, min: number) => (min > 0 ? (k / min).toFixed(1) : '–');
      lines.push(`  ${tag}: ${((100 * tWith * 60000) / total).toFixed(0)} % · ${kWith} · ${rate(kWith, tWith)} / ${rate(kWithout, tWithout)}`);
    }
    if (!tags.length) lines.push('  keine');
    lines.push('', 'Je Sekunde (t s | FPS | längster Frame ms | dessen Arbeit ms | verworfen | Anlässe):');
    const secs = Math.ceil(s.at(-1)!.t / 1000);
    for (let i = 0; i < secs; i++) {
      const sec = s.filter((x) => x.t >= i * 1000 && x.t < (i + 1) * 1000);
      if (!sec.length) continue;
      const worst = sec.reduce((a, x) => (x.ms > a.ms ? x : a));
      const secTags = [...new Set(sec.flatMap((x) => x.tags))].join(', ');
      lines.push(
        `${String(i).padStart(4)} | ${String(sec.length).padStart(4)} | ${worst.ms.toFixed(1).padStart(6)} | ${worst.work.toFixed(1).padStart(5)} | ${String(droppedFrames(sec.map((x) => x.ms), med)).padStart(3)} | ${secTags}`,
      );
    }
    lines.push('', 'Ruckler einzeln (t s | Frame ms | × Median | Arbeit ms | GPU ms | Anlässe):');
    for (const k of spikes.slice(0, 120)) {
      lines.push(
        `${(k.t / 1000).toFixed(2).padStart(7)} | ${k.ms.toFixed(1).padStart(6)} | ${(k.ms / med).toFixed(1).padStart(4)} | ${k.work.toFixed(1).padStart(5)} | ${fmtGpu(k.gpu).padStart(5)} | ${k.tags.join(', ') || '–'}`,
      );
    }
    if (spikes.length > 120) lines.push(`… ${spikes.length - 120} weitere`);
    return lines.join('\n');
  }
}

/** GPU time summary: median and slowest frame, and what the stutter frames cost on the GPU. */
function gpuLine(s: Sample[], meta: FrameMeta): string {
  if (!meta.gpuTimer) return 'GPU-Zeit: nicht verfügbar (Browser ohne EXT_disjoint_timer_query_webgl2).';
  const gpu = s.map((x) => x.gpu?.ms).filter((v): v is number => v != null);
  if (!gpu.length) return 'GPU-Zeit: keine Messwerte angekommen.';
  return `GPU-Zeit pro Frame: Median ${median(gpu).toFixed(1)} ms · max ${Math.max(...gpu).toFixed(1)} ms (${gpu.length} von ${s.length} Frames gemessen)`;
}
