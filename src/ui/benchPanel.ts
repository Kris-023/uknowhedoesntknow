import { droppedFrames, FrameTrace } from '../debug/frameTrace';
import type { GpuCell } from '../debug/gpuTimer';
import type { MouseTrace } from '../debug/mouseTrace';
import { el } from './dom';
import { settings } from './store';
import { SettingsView } from './settingsView';

export interface BenchSample {
  /** Frame time in ms. */
  ms: number;
  calls: number;
  render: { w: number; h: number };
  /** Main-thread time spent in our frame callback. */
  work: number;
  /** What was going on in the scene (blackout, oncoming train, announcement, GC …). */
  tags: string[];
  /** GPU time of this frame, filled in later; null without timer queries. */
  gpu?: GpuCell | null;
}

/** What the diagnostics can see in this browser (for the report header). */
export interface BenchDiag {
  gpuTimer: boolean;
  heapPrecise: () => boolean;
}

/** Rolling window of frame times: average fps and the slowest 1 % (what stutter feels like). */
class FrameStats {
  private times: number[] = [];
  constructor(private windowMs = 5000) {}

  add(ms: number): void {
    this.times.push(ms);
    let sum = 0;
    for (const t of this.times) sum += t;
    while (sum > this.windowMs && this.times.length > 1) sum -= this.times.shift()!;
  }

  get avgFps(): number {
    if (!this.times.length) return 0;
    return (1000 * this.times.length) / this.times.reduce((a, b) => a + b, 0);
  }

  /** Median frame time: the baseline a stutter stands out from. */
  get medianMs(): number {
    if (!this.times.length) return 0;
    const sorted = [...this.times].sort((a, b) => a - b);
    return sorted[sorted.length >> 1];
  }

  /** Average fps over the last `ms`, steadier to read than a single frame. */
  recentFps(ms: number): number {
    let sum = 0;
    let n = 0;
    for (let i = this.times.length - 1; i >= 0 && sum < ms; i--, n++) sum += this.times[i];
    return sum ? (1000 * n) / sum : 0;
  }

  get minFps(): number {
    return this.times.length ? 1000 / Math.max(...this.times) : 0;
  }

  get dropped(): number {
    return droppedFrames(this.times, this.medianMs);
  }

  get lowFps(): number {
    if (!this.times.length) return 0;
    const sorted = [...this.times].sort((a, b) => b - a);
    const worst = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.01)));
    return 1000 / (worst.reduce((a, b) => a + b, 0) / worst.length);
  }
}

/**
 * Benchmark mode: the game runs solo with simulated passengers, this panel shows performance and
 * lets you change graphics and controls live, so you see right away what each setting costs.
 * Two recorders (frames, mouse) write reports to paste into a chat.
 */
export class BenchPanel {
  private root = el('aside', 'bench');
  private stats = new FrameStats();
  private out: Record<'fps' | 'avg' | 'low' | 'min' | 'dropped' | 'res' | 'calls' | 'gpu', HTMLElement>;
  /** Recent GPU cells for the live readout (median over the last ~2 s). */
  private gpuCells: GpuCell[] = [];
  diag: BenchDiag = { gpuTimer: false, heapPrecise: () => false };
  private settings = new SettingsView(null, ['gfx', 'input']);
  private lastShow = 0;
  private frames = new FrameTrace();
  private lastSample: BenchSample | null = null;

  constructor(host: HTMLElement, onMenu: () => void, trace: MouseTrace | null = null, mouseK: () => number = () => 0) {
    this.root.setAttribute('aria-label', 'Benchmark');
    const head = el('div', 'bench-head');
    head.append(el('h2', 'bench-title', 'Benchmark'));
    const menu = el('button', 'btn ghost', 'Beenden');
    menu.type = 'button';
    menu.addEventListener('click', onMenu);
    head.append(menu);
    const dl = el('dl', 'stats');
    const stat = (label: string) => {
      const d = el('div');
      const dd = el('dd', '', '–');
      d.append(el('dt', '', label), dd);
      dl.append(d);
      return dd;
    };
    this.out = {
      fps: stat('FPS jetzt'),
      avg: stat('Ø 5 s'),
      low: stat('1 % Low'),
      min: stat('Min 5 s'),
      dropped: stat('Verworfen 5 s'),
      calls: stat('Draw-Calls'),
      gpu: stat('GPU ms'),
      res: stat('Auflösung'),
    };
    this.root.append(head, dl, el('p', 'note', 'Ins Bild klicken zum Umsehen, Esc lässt die Maus los.'));
    this.root.append(
      this.recorder('Ruckler', 'Ruckler aufzeichnen (60 s)', 60, 'Läuft im Hintergrund weiter. Am besten bis Stromausfall, Gegenzug und Durchsage dabei waren.', {
        start: () => this.frames.start(),
        stop: () => {
          this.frames.stop();
          const r = this.lastSample?.render ?? { w: 0, h: 0 };
          return this.frames.report({
            render: r,
            gpuTimer: this.diag.gpuTimer,
            heapPrecise: this.diag.heapPrecise(),
            settings: `Licht ${settings.light} · Leuchten ${settings.bloom ? `an (${Math.round(settings.bloomStrength * 100)} %)` : 'aus'} · Auflösung ${Math.round(settings.renderScale * 100)} %`,
          });
        },
      }),
    );
    if (trace)
      this.root.append(
        this.recorder('Maus-Diagnose', 'Maus aufzeichnen (15 s)', 15, 'Danach ins Bild klicken: erst ganz langsam bewegen, dann normal, dann ruckartig.', {
          start: () => trace.start(),
          stop: () => {
            trace.stop();
            return trace.report(mouseK(), settings.mouseRaw && 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'mousemove');
          },
        }),
      );
    this.root.append(this.settings.root);
    host.append(this.root);
  }

  /** Record for `seconds`, then show the report with a copy button. */
  private recorder(title: string, label: string, seconds: number, hint: string, r: { start: () => void; stop: () => string }): HTMLElement {
    const box = el('section', 'stutter');
    const rec = el('button', 'btn ghost', label);
    rec.type = 'button';
    const out = el('textarea', 'trace-out');
    out.readOnly = true;
    out.hidden = true;
    const copy = el('button', 'btn ghost', 'Bericht kopieren');
    copy.type = 'button';
    copy.hidden = true;
    copy.addEventListener('click', () => {
      out.select();
      void navigator.clipboard?.writeText(out.value).then(() => (copy.textContent = 'Kopiert ✓'));
    });
    rec.addEventListener('click', () => {
      r.start();
      rec.disabled = true;
      out.hidden = copy.hidden = true;
      let left = seconds;
      rec.textContent = `Läuft … ${left} s`;
      const iv = setInterval(() => {
        left--;
        rec.textContent = `Läuft … ${left} s`;
        if (left > 0) return;
        clearInterval(iv);
        out.value = r.stop();
        out.hidden = copy.hidden = false;
        copy.textContent = 'Bericht kopieren';
        rec.disabled = false;
        rec.textContent = 'Nochmal aufzeichnen';
      }, 1000);
    });
    box.append(el('h3', 'eyebrow', title), el('p', 'note', hint), rec, out, copy);
    return box;
  }

  update(s: BenchSample): void {
    this.lastSample = s;
    this.frames.add(s.ms, s.work, s.calls, s.tags, s.gpu ?? null);
    this.stats.add(s.ms);
    if (s.gpu) {
      this.gpuCells.push(s.gpu);
      if (this.gpuCells.length > 240) this.gpuCells.shift();
    }
    const now = performance.now();
    if (now - this.lastShow < 250) return;
    this.lastShow = now;
    this.out.fps.textContent = String(Math.round(this.stats.recentFps(500)));
    this.out.avg.textContent = String(Math.round(this.stats.avgFps));
    this.out.low.textContent = String(Math.round(this.stats.lowFps));
    this.out.min.textContent = String(Math.round(this.stats.minFps));
    this.out.dropped.textContent = String(this.stats.dropped);
    this.out.calls.textContent = String(s.calls);
    this.out.gpu.textContent = this.gpuText();
    this.out.res.textContent = `${s.render.w}×${s.render.h}`;
  }

  /** Median GPU time of the recent frames, or why there is none. */
  private gpuText(): string {
    if (!this.diag.gpuTimer) return 'n. v.';
    const ms = this.gpuCells.map((c) => c.ms).filter((v): v is number => v != null).sort((a, b) => a - b);
    return ms.length ? ms[ms.length >> 1].toFixed(1) : '–';
  }
}
