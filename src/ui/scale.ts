/**
 * UI scale for the window size: 1 at 1440×900, bigger on Full HD and 4K, a bit smaller on small
 * laptops. Games scale their UI with the resolution; plain CSS pixels would make menus tiny on a
 * 4K screen at 100 % and cramped on 1366×768. The exponent keeps big screens from going cartoonish.
 */
export const UI_BASE = { w: 1440, h: 900 };

export function uiScale(w: number, h: number): number {
  const r = Math.min(w / UI_BASE.w, h / UI_BASE.h);
  return Math.max(0.92, Math.min(2.2, r ** 0.85));
}

export function initUiScale(): void {
  const apply = () => document.documentElement.style.setProperty('--ui', uiScale(innerWidth, innerHeight).toFixed(3));
  apply();
  addEventListener('resize', apply);
}
