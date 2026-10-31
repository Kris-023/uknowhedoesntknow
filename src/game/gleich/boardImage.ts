import { GLEICH, WHOAMI } from '../../config';

export type BoardTone = 'word' | 'match' | 'none';

const TONES: Record<BoardTone, { bg: string; fg: string }> = {
  word: { bg: '#f2f2ee', fg: '#111418' },
  // The group that matches (so far): green like the "right" colour elsewhere in the UI.
  match: { bg: '#9bff7a', fg: '#0b1a06' },
  none: { bg: '#2a3141', fg: '#8a93a6' },
};

const cache = new Map<string, string>();

/** Biggest font that fits `text` into `width` px, between `min` and `max`. */
function fit(x: CanvasRenderingContext2D, text: string, width: number, max: number, min: number): number {
  let size = max;
  for (; size > min; size -= 4) {
    x.font = `800 ${size}px system-ui, sans-serif`;
    if (x.measureText(text).width <= width) break;
  }
  return size;
}

/**
 * A word on a board for the cards layer, which shows any image over a head. Words are drawn big
 * and bold; long ones shrink, and two-word terms break onto two lines before they get tiny.
 */
export function wordBoard(word: string, tone: BoardTone): string {
  const key = `${tone}|${word}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { w, h } = GLEICH.boardPx;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  const t = TONES[tone];
  x.fillStyle = t.bg;
  x.fillRect(0, 0, w, h);
  x.fillStyle = t.fg;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const room = w - 36;
  let lines = [word];
  if (fit(x, word, room, 120, 56) <= 56 && word.includes(' ')) {
    // Break at the blank closest to the middle.
    const at = [...word.matchAll(/ /g)].map((m) => m.index!).sort((a, b) => Math.abs(a - word.length / 2) - Math.abs(b - word.length / 2))[0];
    lines = [word.slice(0, at), word.slice(at + 1)];
  }
  const size = Math.min(...lines.map((l) => fit(x, l, room, lines.length > 1 ? 84 : 120, 20)));
  x.font = `800 ${size}px system-ui, sans-serif`;
  lines.forEach((l, i) => x.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05));
  const url = c.toDataURL('image/jpeg', WHOAMI.cardQuality);
  // A handful of words per round, but the cache must not grow forever in a long evening.
  if (cache.size > 200) cache.clear();
  cache.set(key, url);
  return url;
}
