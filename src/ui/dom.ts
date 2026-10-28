/** Tiny DOM helper shared by the menus. */
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/**
 * Free the mouse for a game dialog. A plain exitPointerLock would look like Esc to the game and
 * open the pause menu on top of the dialog; this event tells the game it was intentional.
 */
export function releaseMouse(): void {
  if (document.pointerLockElement) dispatchEvent(new Event('ukhdk:release-mouse'));
}
