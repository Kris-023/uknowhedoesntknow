/** Live size of an element in CSS pixels, kept by a ResizeObserver. */
export interface Size {
  w: number;
  h: number;
}

const sizes = new WeakMap<HTMLElement, Size>();

/**
 * Element size without reading layout in the frame loop. Reading clientWidth after the overlays
 * wrote their transforms forced a style recalculation every frame; the observer reports changes
 * once, between frames. One observer per element, shared by all callers.
 */
export function trackSize(el: HTMLElement): Size {
  let s = sizes.get(el);
  if (s) return s;
  const size: Size = { w: el.clientWidth, h: el.clientHeight };
  sizes.set(el, size);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver((entries) => {
      const box = entries[entries.length - 1].contentRect;
      // clientWidth includes padding, contentRect doesn't; the stage has none, but stay exact.
      size.w = el.clientWidth || box.width;
      size.h = el.clientHeight || box.height;
    }).observe(el);
  }
  s = size;
  return s;
}

/** Last written screen position per overlay element; writes only when it moved by more than half a pixel. */
export class Placer {
  private x = NaN;
  private y = NaN;

  constructor(private el: HTMLElement) {}

  /** Anchor at (x, y), centred horizontally above that point. */
  place(x: number, y: number): void {
    if (Math.abs(x - this.x) <= 0.5 && Math.abs(y - this.y) <= 0.5) return;
    this.x = x;
    this.y = y;
    this.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }
}
