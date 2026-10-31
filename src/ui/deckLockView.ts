import { deckLock } from '../words/content';
import { el } from './dom';

/** "Stapel: freigeschaltet" / "Stapel: gesperrt", for summaries and the lobby. */
export const deckStateText = () => (deckLock.unlocked ? 'Stapel: freigeschaltet' : 'Stapel: gesperrt');

/** What locked means for play, in one line. */
export const LOCKED_HINT = 'Gesperrt spielt ihr mit einem kleinen Ersatzstapel, NSFW gibt es erst nach dem Freischalten.';

/**
 * Unlock box for the built-in decks: the state, and while locked a password field. The password
 * only derives the key here and is dropped; the browser keeps the key. Follows the lock, so a key
 * that arrives from someone in the room flips it to unlocked by itself.
 */
export class DeckLockView {
  readonly root: HTMLElement;
  private off: () => void;
  private busy = false;
  private error = '';

  /** `compact`: inside the room dialog, without its own heading. */
  constructor(private compact = false) {
    this.root = el('div', compact ? 'deck-lock compact' : 'group deck-lock');
    this.off = deckLock.onChange(() => this.render());
    this.render();
  }

  dispose(): void {
    this.off();
  }

  private render(): void {
    const r = this.root;
    const keepFocus = r.contains(document.activeElement);
    r.replaceChildren();
    const c = deckLock.content;
    const state = el('p', `deck-state ${deckLock.unlocked ? 'on' : 'off'}`, deckStateText());
    state.setAttribute('role', 'status');
    if (!this.compact) r.append(el('span', 'group-title', 'Eingebaute Stapel'));
    r.append(state);
    if (deckLock.unlocked) {
      r.append(el('p', 'note', `Normal ${c.words.normal.length} Wörter · NSFW ${c.words.nsfw.length} Wörter, dazu die Fragen und Kategorien. Dieser Browser merkt sich den Schlüssel (nicht das Passwort); im Raum bekommen ihn alle anderen automatisch.`));
      const forget = el('button', 'btn ghost', 'Schlüssel vergessen');
      forget.type = 'button';
      forget.addEventListener('click', () => deckLock.forget());
      r.append(forget);
      return;
    }
    if (!deckLock.vault) {
      r.append(el('p', 'note', 'Dieser Build hat keine versiegelten Stapel. Es gibt nur den Ersatzstapel.'));
      return;
    }
    r.append(el('p', 'note', `${LOCKED_HINT} Hat jemand im Raum sie freigeschaltet, geht es bei dir von selbst auf.`));
    const form = el('form', 'row deck-unlock');
    const pw = el('input', 'text-input');
    Object.assign(pw, { type: 'password', autocomplete: 'off', placeholder: 'Passwort', id: this.compact ? 'deck-pass-dlg' : 'deck-pass' });
    pw.setAttribute('aria-label', 'Passwort für die Stapel');
    const go = el('button', 'btn', this.busy ? 'Prüfe …' : 'Freischalten');
    go.type = 'submit';
    go.disabled = this.busy;
    pw.disabled = this.busy;
    const err = el('p', 'err', this.error);
    err.setAttribute('role', 'alert');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.busy || !pw.value) return;
      const password = pw.value;
      this.busy = true;
      this.error = '';
      this.render();
      void deckLock.unlock(password).then(
        (ok) => this.done(ok ? '' : 'Passwort falsch.'),
        () => this.done('Geht hier nicht (WebCrypto fehlt, nur über https oder localhost).'),
      );
    });
    form.append(pw, go);
    r.append(form, err);
    if (keepFocus && !this.busy) requestAnimationFrame(() => pw.focus());
  }

  private done(error: string): void {
    this.busy = false;
    this.error = error;
    this.render();
  }
}
