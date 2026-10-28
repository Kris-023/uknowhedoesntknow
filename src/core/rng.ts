export type Rand = () => number;

/** mulberry32: tiny, fast and identical on every browser, so a lobby seed yields the same world everywhere. */
export function mulberry32(seed: number): Rand {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One FNV/murmur-style mixing step of `hash01`. */
function mix(h: number, n: number): number {
  h = Math.imul(h ^ (n | 0), 0x01000193);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return h ^ (h >>> 15);
}

/**
 * Stateless hash of integers to [0, 1). Used where a value must be derivable from
 * (seed, index, lap) alone, without replaying a random sequence. Fixed arity instead of rest
 * arguments: it runs thousands of times per frame (tunnel, flicker), and a rest array per call
 * was measurable garbage. Omitted arguments are skipped, so results match the old variadic form.
 */
export function hash01(a: number, b?: number, c?: number, d?: number): number {
  let h = mix(0x811c9dc5, a);
  if (b !== undefined) {
    h = mix(h, b);
    if (c !== undefined) {
      h = mix(h, c);
      if (d !== undefined) h = mix(h, d);
    }
  }
  return (h >>> 0) / 4294967296;
}

export function pick<T>(arr: readonly T[], r: Rand): T {
  return arr[Math.floor(r() * arr.length) % arr.length];
}
