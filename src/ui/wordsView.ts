import { WORDS } from '../config';
import { builtinDeck } from '../words';
import { addCustom, customCards, exportCustom, importCustom, onCustom, playerId, removeCustom } from '../words/custom';
import { el } from './dom';

/**
 * Menu tab "Wörter": your own submissions for word games. They stay in this browser; in a room they
 * join the deck "Eigene" for everyone, but nobody sees them before they're played.
 */
export class WordsView {
  readonly root = el('div', 'words');
  private list = el('ul', 'words-list');
  private count = el('span', 'note');
  private off: () => void;

  constructor(private author: () => string) {
    const form = el('form', 'words-form');
    const word = el('input', 'text-input');
    Object.assign(word, { id: 'words-word', placeholder: 'z. B. Seilspringen', maxLength: WORDS.maxChars, autocomplete: 'off' });
    const taboo = el('input', 'text-input');
    Object.assign(taboo, { id: 'words-taboo', placeholder: 'Seil, Hüpfen, Aufwärmen, Gym', autocomplete: 'off' });
    const err = el('p', 'err');
    err.setAttribute('role', 'alert');
    const add = el('button', 'btn big', 'Hinzufügen');
    add.type = 'submit';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const forbidden = taboo.value.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
      const msg = addCustom(word.value, forbidden, this.author());
      err.textContent = msg ?? '';
      if (!msg) {
        word.value = taboo.value = '';
        word.focus();
      }
    });
    form.append(
      this.field('Wort', word, 'Das muss erraten werden.'),
      this.field('Verbotene Wörter', taboo, `Mit Komma getrennt, höchstens ${WORDS.maxTaboo}. Das Wort selbst ist immer verboten.`),
      err,
      add,
    );

    const io = el('div', 'row');
    const copy = this.btn('Liste kopieren', async () => {
      try {
        await navigator.clipboard.writeText(exportCustom());
        ioNote.textContent = 'Kopiert. Schick den Text an Freunde, sie fügen ihn unten ein.';
      } catch {
        ioNote.textContent = 'Kopieren hat nicht geklappt. Nimm „Als Datei speichern“.';
      }
    });
    const save = this.btn('Als Datei speichern', () => {
      const a = el('a');
      a.href = URL.createObjectURL(new Blob([exportCustom()], { type: 'application/json' }));
      a.download = 'woerter.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    const file = el('input');
    Object.assign(file, { type: 'file', accept: '.json,application/json,text/plain', id: 'words-file' });
    file.className = 'sr-only';
    const load = el('label', 'btn ghost', 'Datei laden');
    load.htmlFor = file.id;
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (f) this.importText(await f.text(), ioNote);
      file.value = '';
    });
    io.append(copy, save, load, file);
    const paste = el('textarea', 'text-input words-paste');
    Object.assign(paste, { id: 'words-paste', placeholder: 'Oder eine kopierte Liste hier einfügen', rows: 2 });
    paste.addEventListener('paste', () =>
      setTimeout(() => {
        if (paste.value.trim()) this.importText(paste.value, ioNote);
        paste.value = '';
      }),
    );
    const ioNote = el('p', 'note');
    ioNote.setAttribute('role', 'status');

    const decks = `Eingebaut: Normal ${builtinDeck('normal').length} · NSFW ${builtinDeck('nsfw').length} Wörter. Welche Stapel gespielt werden, stellt der Host in den Raum-Einstellungen ein.`;
    this.root.append(
      el('h2', 'words-title', 'Eigene Wörter'),
      el('p', 'note', 'Deine Wörter bleiben in diesem Browser. Im Raum landen sie im Stapel „Eigene“, und keiner sieht sie, bevor sie gespielt werden. Wer ein Wort eingereicht hat, bekommt es nicht zum Raten, solange andere übrig sind.'),
      form,
      el('div', 'words-head'),
      this.list,
      el('h3', 'words-sub', 'Teilen'),
      io,
      paste,
      ioNote,
      el('p', 'note', decks),
    );
    this.root.querySelector('.words-head')!.append(el('h3', 'words-sub', 'Deine Liste'), this.count);
    this.renderList();
    this.off = onCustom(() => this.renderList());
  }

  dispose(): void {
    this.off();
  }

  private importText(text: string, note: HTMLElement): void {
    try {
      const n = importCustom(text);
      note.textContent = n ? `${n} ${n === 1 ? 'Wort' : 'Wörter'} übernommen.` : 'Nichts Neues, alle Wörter hattest du schon.';
    } catch (e) {
      note.textContent = (e as Error).message;
    }
  }

  private renderList(): void {
    const cards = customCards();
    const me = playerId();
    this.count.textContent = `${cards.length} ${cards.length === 1 ? 'Wort' : 'Wörter'}`;
    this.list.replaceChildren();
    if (!cards.length) this.list.append(el('li', 'note', 'Noch keine. Das erste Wort oben eintragen.'));
    for (const c of cards) {
      const li = el('li');
      const text = el('div', 'words-card');
      text.append(el('strong', '', c.word), el('span', 'note', c.taboo.length ? c.taboo.join(', ') : 'ohne verbotene Wörter'));
      if (c.by && c.by.id !== me) text.append(el('span', 'words-by', `von ${c.by.name}`));
      const del = this.btn('Löschen', () => removeCustom(c.id), 'ghost small');
      del.setAttribute('aria-label', `${c.word} löschen`);
      li.append(text, del);
      this.list.append(li);
    }
  }

  private field(label: string, input: HTMLElement, hint: string): HTMLElement {
    const box = el('label', 'field');
    box.append(el('span', 'field-label', label), input, el('span', 'field-hint', hint));
    return box;
  }

  private btn(text: string, onClick: () => void, cls = 'ghost'): HTMLButtonElement {
    const b = el('button', `btn ${cls}`.trim(), text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
}
