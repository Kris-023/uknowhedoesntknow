import { el } from './dom';
import { SettingsView } from './settingsView';

export interface BenchSample {
  /** Frame time in ms. */
  ms: number;
  calls: number;
  render: { w: number; h: number };
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
 */
export class BenchPanel {
  private root = el('aside', 'bench');
  private stats = new FrameStats();
  private out: Record<'fps' | 'avg' | 'low' | 'res' | 'calls', HTMLElement>;
  private settings = new SettingsView(null, ['gfx', 'input']);
  private lastShow = 0;

  constructor(host: HTMLElement, onMenu: () => void) {
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
    this.out = { fps: stat('FPS jetzt'), avg: stat('Ø 5 s'), low: stat('1 % Low'), calls: stat('Draw-Calls'), res: stat('Auflösung') };
    this.root.append(head, dl, el('p', 'note', 'Ins Bild klicken zum Umsehen, Esc lässt die Maus los.'), this.settings.root);
    host.append(this.root);
  }

  update(s: BenchSample): void {
    this.stats.add(s.ms);
    const now = performance.now();
    if (now - this.lastShow < 250) return;
    this.lastShow = now;
    this.out.fps.textContent = String(Math.round(1000 / s.ms));
    this.out.avg.textContent = String(Math.round(this.stats.avgFps));
    this.out.low.textContent = String(Math.round(this.stats.lowFps));
    this.out.calls.textContent = String(s.calls);
    this.out.res.textContent = `${s.render.w}×${s.render.h}`;
  }
}
