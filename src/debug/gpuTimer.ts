/** GPU time of one frame, filled in a few frames later when the query result arrives (null until then, or if lost). */
export interface GpuCell {
  ms: number | null;
}

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/**
 * GPU time per frame via EXT_disjoint_timer_query_webgl2 (Chrome/Edge on most desktop GPUs;
 * Firefox and Safari don't expose it). Tells a slow GPU frame from a slow main thread: a stutter
 * with normal work time and normal GPU time happened in the compositor or the browser.
 */
export class GpuTimer {
  private pending: { q: WebGLQuery; cell: GpuCell }[] = [];
  private free: WebGLQuery[] = [];
  private open: WebGLQuery | null = null;

  private constructor(
    private gl: WebGL2RenderingContext,
    private ext: TimerExt,
  ) {}

  /** null where the extension is missing; the benchmark then simply shows no GPU times. */
  static create(gl: WebGLRenderingContext | WebGL2RenderingContext): GpuTimer | null {
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return null;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
    return ext ? new GpuTimer(gl, ext) : null;
  }

  begin(): void {
    if (this.open) return;
    // Results lag a few frames; more than that in flight means the GPU is far behind anyway.
    if (this.pending.length > 16) return;
    const q = this.free.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.open = q;
  }

  /** Close the frame's query; the returned cell gets its time once the GPU is done. */
  end(): GpuCell | null {
    const q = this.open;
    if (!q) return null;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.open = null;
    const cell: GpuCell = { ms: null };
    this.pending.push({ q, cell });
    return cell;
  }

  /** Collect finished results; call once per frame. */
  poll(): void {
    const gl = this.gl;
    // A disjoint event (clock change, context switch) makes every result in flight meaningless.
    const disjoint = !!gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const { q, cell } = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      if (!disjoint) cell.ms = ns / 1e6;
      this.pending.shift();
      this.free.push(q);
    }
  }
}

/**
 * Garbage collection as seen from the frame loop: the JS heap shrank since the last frame (Chrome
 * only, `performance.memory`). Returns the freed megabytes, 0 if none, null where unavailable.
 * Small drops are noise from the heap counter's granularity.
 */
export class HeapWatch {
  private last = 0;
  private changes = 0;
  // performance.memory returns a fresh snapshot on every read; holding on to one would never change.
  private readonly perf = performance as Performance & { memory?: { usedJSHeapSize: number } };

  /**
   * The counter moves from frame to frame. Normal Chrome rounds it and refreshes it rarely (privacy),
   * so drops only mean something when Chrome runs with --enable-precise-memory-info.
   */
  get precise(): boolean {
    return this.changes > 10;
  }

  sample(): number | null {
    const mem = this.perf.memory;
    if (!mem) return null;
    const now = mem.usedJSHeapSize;
    const freed = this.last - now;
    if (now !== this.last) this.changes++;
    this.last = now;
    return freed > 256 * 1024 ? freed / (1024 * 1024) : 0;
  }
}
