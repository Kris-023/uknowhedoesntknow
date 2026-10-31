import { el, releaseMouse } from './dom';

/** The game the host could take a move back in, as the coach sees it right now. */
export interface UndoTarget {
  /** Show the control at all: host, and a round running or just over. */
  readonly offered: boolean;
  readonly canUndo: boolean;
  undo(): void;
}

/**
 * "Zug zurück" for the host: a small button in the corner (Backspace works too) that always asks
 * first, since one stray key would otherwise undo a vote the whole table agreed on. Shared by all
 * games, so no game screen needs its own copy.
 */
export class UndoButton {
  private box = el('div', 'undo-host');
  private btn = el('button', 'btn small ghost', 'Zug zurück [⌫]');
  private ask = el('div', 'undo-ask');
  private yes = el('button', 'btn small', 'Zurücknehmen [Enter]');
  private no = el('button', 'btn small ghost', 'Abbrechen');
  /** Grab the mouse back after answering: it was locked (or the menu was open) when asked. */
  private resumeAfter = false;

  constructor(
    host: HTMLElement,
    private target: () => UndoTarget | null,
    /** Back to looking around (pointer lock) after the question was answered. */
    private resume: () => void,
  ) {
    for (const b of [this.btn, this.yes, this.no]) b.type = 'button';
    this.btn.title = 'Den letzten Zug dieser Runde zurücknehmen (nur der Host)';
    this.ask.setAttribute('role', 'alertdialog');
    const row = el('div', 'row');
    row.append(this.yes, this.no);
    this.ask.append(el('span', '', 'Letzten Zug zurücknehmen?'), row);
    this.ask.hidden = true;
    this.box.append(this.ask, this.btn);
    this.box.hidden = true;
    host.append(this.box);
    this.btn.addEventListener('click', () => this.open());
    this.yes.addEventListener('click', () => this.answer(true));
    this.no.addEventListener('click', () => this.answer(false));
    // Capture, so Enter/Esc/Backspace answer the question instead of reaching the game or the menu.
    addEventListener('keydown', (e) => this.key(e), true);
  }

  get asking(): boolean {
    return !this.ask.hidden;
  }

  /** Ask whether to take the last move back. `fromMenu`: the Esc menu was open, so look around again afterwards. */
  open(fromMenu = false): void {
    const t = this.target();
    if (!t?.offered || !t.canUndo) return;
    this.resumeAfter = fromMenu || !!document.pointerLockElement;
    releaseMouse();
    this.ask.hidden = false;
    this.sync();
    this.yes.focus();
  }

  private answer(ok: boolean): void {
    if (this.ask.hidden) return;
    this.ask.hidden = true;
    const t = this.target();
    if (ok && t?.offered && t.canUndo) t.undo();
    this.sync();
    if (this.resumeAfter) this.resume();
  }

  /** Per frame and on game changes: shown only to the host, disabled with nothing to take back. */
  sync(): void {
    const t = this.target();
    const shown = !!t?.offered;
    if (this.box.hidden !== !shown) this.box.hidden = !shown;
    if (!shown && !this.ask.hidden) this.ask.hidden = true;
    const off = !t?.canUndo;
    if (this.btn.disabled !== off) this.btn.disabled = off;
    // The question stays only while there is still something to take back.
    if (off && !this.ask.hidden) this.ask.hidden = true;
    this.btn.hidden = !this.ask.hidden;
  }

  private key(e: KeyboardEvent): void {
    if (e.repeat) return;
    if (this.asking) {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.answer(e.key === 'Enter');
      }
      return;
    }
    const tgt = e.target;
    if (e.key !== 'Backspace' || tgt instanceof HTMLInputElement || tgt instanceof HTMLTextAreaElement || tgt instanceof HTMLSelectElement) return;
    if ((tgt as HTMLElement | null)?.isContentEditable) return;
    const t = this.target();
    if (!t?.offered || !t.canUndo) return;
    e.preventDefault();
    this.open();
  }
}
