import { GLEICH, WHOAMI } from '../../config';

export type BoardTone = 'word' | 'match' | 'none' | 'top' | 'bad';

const TONES: Record<BoardTone, { bg: string; fg: string }> = {
  word: { bg: '#f2f2ee', fg: '#111418' },
  // The group that matches (so far): green like the "right" colour elsewhere in the UI.
  match: { bg: '#9bff7a', fg: '#0b1a06' },
  none: { bg: '#2a3141', fg: '#8a93a6' },
  // "Am ehesten" in "Zeig drauf": the amber of the timers.
  top: { bg: '#ffb224', fg: '#1a1204' },
  // Found out ("Ahnungslos"): the red of fouls and wrong answers.
  bad: { bg: '#ff8a7a', fg: '#1d0805' },
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

/**
 * A big line with a small one under it (a vote count and who voted, for example). The small line
 * wraps onto a second line before it shrinks.
 */
export function noteBoard(big: string, small: string, tone: BoardTone): string {
  const key = `note|${tone}|${big}|${small}`;
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
  const bigSize = fit(x, big, room, small ? 110 : 120, 28);
  let lines = small ? [small] : [];
  let smallSize = small ? fit(x, small, room, 40, 28) : 0;
  if (small && smallSize <= 28 && small.includes(' ')) {
    const at = [...small.matchAll(/ /g)].map((m) => m.index!).sort((a, b) => Math.abs(a - small.length / 2) - Math.abs(b - small.length / 2))[0];
    lines = [small.slice(0, at), small.slice(at + 1)];
    smallSize = Math.min(...lines.map((l) => fit(x, l, room, 36, 18)));
  } else if (small) smallSize = fit(x, small, room, 40, 16);
  const block = bigSize + lines.length * smallSize * 1.15 + (lines.length ? 10 : 0);
  let y = (h - block) / 2 + bigSize / 2;
  x.font = `800 ${bigSize}px system-ui, sans-serif`;
  x.fillText(big, w / 2, y);
  y += bigSize / 2 + 10 + (smallSize * 1.15) / 2;
  x.font = `700 ${smallSize}px system-ui, sans-serif`;
  for (const l of lines) {
    x.fillText(l, w / 2, y);
    y += smallSize * 1.15;
  }
  const url = c.toDataURL('image/jpeg', WHOAMI.cardQuality);
  if (cache.size > 200) cache.clear();
  cache.set(key, url);
  return url;
}
