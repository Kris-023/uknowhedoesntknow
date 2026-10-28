/**
 * Records the whole way from the mouse to the picture, to find where slow movements get lost:
 * browser events (mousemove, coalesced, pointerrawupdate) -> look target -> smoothed head -> camera.
 * Lives in the benchmark; the report is plain text to paste into a chat.
 *
 * Times come from performance.now() at the handler, not event.timeStamp: Zen/Firefox hands out
 * unusable stamps there (the first report was all -9.2e15).
 */

type Ev = { t: number; mx: number; my: number; locked: boolean };
type Frame = { t: number; dt: number; look: number; head: number; cam: number };

const deg = (r: number) => (r * 180) / Math.PI;
const BUCKET_MS = 100;

export class MouseTrace {
  active = false;
  private t0 = 0;
  private moves: (Ev & { n: number; cx: number })[] = [];
  private raws: Ev[] = [];
  private frames: Frame[] = [];

  /** How the pointer lock was taken: raw counts, fallback, or failure (set by the lock helper). */
  static lockMode = 'noch nicht gesperrt';

  start(): void {
    this.active = true;
    this.t0 = performance.now();
    this.moves = [];
    this.raws = [];
    this.frames = [];
  }

  stop(): void {
    this.active = false;
  }

  move(e: MouseEvent, locked: boolean): void {
    if (!this.active) return;
    const co = (e as PointerEvent).getCoalescedEvents?.() ?? [];
    let cx = 0;
    for (const c of co) cx += c.movementX;
    this.moves.push({ t: performance.now() - this.t0, mx: e.movementX, my: e.movementY, locked, n: co.length, cx });
  }

  raw(e: PointerEvent, locked: boolean): void {
    if (this.active) this.raws.push({ t: performance.now() - this.t0, mx: e.movementX, my: e.movementY, locked });
  }

  frame(dt: number, lookYaw: number, headYaw: number, camYaw: number): void {
    if (this.active) this.frames.push({ t: performance.now() - this.t0, dt, look: lookYaw, head: headYaw, cam: camYaw });
  }

  report(k: number, source: string): string {
    const m = this.moves.filter((x) => x.locked);
    const r = this.raws.filter((x) => x.locked);
    const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
    const f = this.frames;
    const dur = Math.max(1, (f.at(-1)?.t ?? 1) - (f[0]?.t ?? 0)) / 1000;
    const absX = m.map((x) => Math.abs(x.mx));
    const bucket = (lo: number, hi: number) => absX.filter((v) => v >= lo && v <= hi).length;
    const zero = m.filter((x) => x.mx === 0 && x.my === 0).length;
    const fractional = [...m, ...r].some((x) => x.mx % 1 !== 0 || x.my % 1 !== 0);
    const lookD = f.length ? f.at(-1)!.look - f[0].look : 0;
    const headD = f.length ? f.at(-1)!.head - f[0].head : 0;
    // Camera yaw wraps at ±180°; sum the frame-to-frame steps instead.
    let camD = 0;
    for (let i = 1; i < f.length; i++) camD += Math.atan2(Math.sin(f[i].cam - f[i - 1].cam), Math.cos(f[i].cam - f[i - 1].cam));
    const lag = f.length ? sum(f.map((x) => Math.abs(x.look - x.head))) / f.length : 0;
    const dts = f.map((x) => x.dt * 1000).sort((a, b) => a - b);
    const used = source === 'pointerrawupdate' ? r : m;
    const lines = [
      `Maus-Diagnose · ${new Date().toISOString()}`,
      `Browser: ${navigator.userAgent}`,
      `devicePixelRatio ${devicePixelRatio} · Pointer Lock: ${MouseTrace.lockMode} · Quelle: ${source} · k ${k.toExponential(2)} rad/count`,
      `Dauer ${dur.toFixed(1)} s · Frames ${f.length} (Median ${dts[dts.length >> 1]?.toFixed(1)} ms, max ${dts.at(-1)?.toFixed(1)} ms)`,
      `mousemove gesperrt: ${m.length} (${(m.length / dur).toFixed(0)}/s), 0/0: ${zero}, Summe X ${sum(m.map((x) => x.mx))} Y ${sum(m.map((x) => x.my))}, coalesced X ${sum(m.map((x) => x.cx))}`,
      `pointerrawupdate gesperrt: ${r.length} (${(r.length / dur).toFixed(0)}/s), Summe X ${sum(r.map((x) => x.mx))} Y ${sum(r.map((x) => x.my))} · ungesperrt: mousemove ${this.moves.length - m.length}, raw ${this.raws.length - r.length}`,
      `|movementX| mousemove 0: ${bucket(0, 0)} · 1: ${bucket(1, 1)} · 2–3: ${bucket(2, 3)} · 4–7: ${bucket(4, 7)} · 8+: ${bucket(8, 1e9)} · Kommazahlen: ${fractional ? 'ja' : 'nein'}`,
      `Gierwinkel: Eingabe ${deg(-sum(used.map((x) => x.mx)) * k).toFixed(1)}° · Ziel ${deg(lookD).toFixed(1)}° · Kopf ${deg(headD).toFixed(1)}° · Kamera ${deg(camD).toFixed(1)}° · Ø Kopf hinter Ziel ${deg(lag).toFixed(2)}°`,
      '',
      `Verlauf je ${BUCKET_MS} ms, nur gesperrt (t s | mousemove Anzahl:SummeX/SummeY | raw Anzahl:SummeX/SummeY | Frames | Ziel° Kamera° am Ende):`,
    ];
    // Per time slice: what the browser sent on both channels and what the game made of it.
    // Slices where raw shows movement but mousemove doesn't are the smoking gun.
    const slices = Math.ceil((dur * 1000) / BUCKET_MS);
    let shown = 0;
    for (let i = 0; i < slices && shown < 220; i++) {
      const a = (f[0]?.t ?? 0) + i * BUCKET_MS;
      const b = a + BUCKET_MS;
      const inS = <T extends { t: number }>(xs: T[]) => xs.filter((x) => x.t >= a && x.t < b);
      const mm = inS(m);
      const rr = inS(r);
      const ff = inS(f);
      if (!mm.length && !rr.length) continue;
      shown++;
      const last = ff.at(-1);
      lines.push(
        `${(a / 1000).toFixed(1).padStart(5)} | ${mm.length}:${sum(mm.map((x) => x.mx))}/${sum(mm.map((x) => x.my))}`.padEnd(22) +
          ` | ${rr.length}:${sum(rr.map((x) => x.mx))}/${sum(rr.map((x) => x.my))}`.padEnd(18) +
          ` | ${ff.length}` +
          (last ? ` | ${deg(last.look).toFixed(1)} ${deg(last.cam).toFixed(1)}` : ''),
      );
    }
    if (shown >= 220) lines.push('… gekürzt');
    return lines.join('\n');
  }
}
