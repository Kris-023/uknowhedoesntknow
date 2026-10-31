import { LISTS, WORDS } from '../config';
import { builtinDeck } from '../words';
import { deckLock } from '../words/content';
import { KIND_INFO, LIST_KINDS, myLists, type CustomList, type ListKind } from '../words/lists';
import { playerId } from '../words/custom';
import { DeckLockView } from './deckLockView';
import { el } from './dom';

/** What each kind is for, under the sub-tabs. */
const ABOUT: Record<ListKind, () => string> = {
  words: () =>
    `Begriffe mit verbotenen Wörtern für „Sag’s anders“; „Ahnungslos“ zieht daraus auch. Keiner sieht sie, bevor sie gespielt werden, und wer ein Wort eingereicht hat, bekommt es nicht zum Raten, solange andere übrig sind. Eingebaut: ${
      deckLock.unlocked ? `Normal ${builtinDeck('normal').length} · NSFW ${builtinDeck('nsfw').length}` : `Ersatzstapel ${builtinDeck('normal').length} · NSFW gesperrt`
    }.`,
  zeig: () => 'Enden für „Wer würde am ehesten …?“ in „Zeig drauf“. Nur das Ende eintragen, den Anfang setzt das Spiel davor.',
  fragen: () => 'Startfragen für „Gleich gedacht“: jeder bekommt eine und antwortet mit einem Wort. Offen fragen, damit verschiedene Wörter kommen.',
  kategorien: () => 'Kategorien für „Stadt, Land, Fluss“, gemischt mit Stadt, Land, Fluss, Name, Tier, Beruf. Kurz halten, sie stehen über den Köpfen.',
};

/** Sub-tab and open list of the last visit (this page load only). */
let lastKind: ListKind = 'words';
const lastOpen: Partial<Record<ListKind, string>> = {};

/**
 * Menu tab "Eigene Listen": your own named lists per kind (words, questions, categories). They stay
 * in this browser; lists that are on join the deck "Eigene" in a room.
 */
export class ListsView {
  readonly root = el('div', 'words lists');
  private panes = new Map<ListKind, HTMLElement>();
  private off: () => void;
  private lockView = new DeckLockView();

  constructor() {
    const nav = el('div', 'tabs sub');
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Eigene Listen');
    const tabs = new Map<ListKind, HTMLButtonElement>();
    const show = (k: ListKind) => {
      lastKind = k;
      for (const [id, b] of tabs) {
        b.setAttribute('aria-selected', String(id === k));
        b.tabIndex = id === k ? 0 : -1;
        this.panes.get(id)!.hidden = id !== k;
      }
    };
    for (const k of LIST_KINDS) {
      const b = el('button', 'tab', KIND_INFO[k].label);
      b.type = 'button';
      b.id = `lists-tab-${k}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', `lists-pane-${k}`);
      b.addEventListener('click', () => show(k));
      nav.append(b);
      tabs.set(k, b);
      const pane = el('div', 'lists-pane');
      pane.id = `lists-pane-${k}`;
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', b.id);
      this.panes.set(k, pane);
    }
    nav.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = LIST_KINDS.indexOf(lastKind);
      const next = LIST_KINDS[(i + (e.key === 'ArrowRight' ? 1 : LIST_KINDS.length - 1)) % LIST_KINDS.length];
      show(next);
      tabs.get(next)!.focus();
    });
    // The built-in decks' password sits here too: it's where the menu talks about decks.
    this.root.append(el('h2', 'words-title', 'Eigene Listen'), this.lockView.root, nav, ...this.panes.values());
    for (const k of LIST_KINDS) this.render(k);
    show(lastKind);
    // Only the lists part changes; forms keep what is typed in them.
    const offLists = myLists.onChange(() => {
      for (const k of LIST_KINDS) this.renderLists(k);
    });
    // Unlocked (here or by a key from the room): the built-in counts change.
    const offLock = deckLock.onChange(() => {
      for (const k of LIST_KINDS) this.panes.get(k)!.querySelector('.lists-about')!.textContent = ABOUT[k]();
    });
    this.off = () => {
      offLists();
      offLock();
    };
  }

  dispose(): void {
    this.off();
    this.lockView.dispose();
  }

  private render(kind: ListKind): void {
    const pane = this.panes.get(kind)!;
    const info = KIND_INFO[kind];
    const create = el('form', 'row lists-new');
    const name = el('input', 'text-input');
    Object.assign(name, { placeholder: 'Name, z. B. Büro-Insider', maxLength: LISTS.maxNameChars, autocomplete: 'off', id: `lists-name-${kind}` });
    name.setAttribute('aria-label', 'Name der neuen Liste');
    const make = el('button', 'btn', 'Neue Liste');
    make.type = 'submit';
    const err = el('p', 'err');
    err.setAttribute('role', 'alert');
    create.addEventListener('submit', (e) => {
      e.preventDefault();
      const made = myLists.create(kind, name.value);
      if (typeof made === 'string') err.textContent = made;
      else {
        err.textContent = '';
        name.value = '';
        lastOpen[kind] = made.id;
        this.renderLists(kind);
        requestAnimationFrame(() => pane.querySelector<HTMLInputElement>('.lists-entry')?.focus());
      }
    });
    create.append(name, make);

    const lists = el('div', 'lists-body');
    const io = this.importBox(kind);
    pane.append(el('p', 'note lists-about', ABOUT[kind]()), el('div', 'words-head'), create, err, lists, el('h3', 'words-sub', 'Liste laden'), io);
    pane.querySelector('.words-head')!.append(el('h3', 'words-sub', `Deine Listen · ${info.label}`));
    this.renderLists(kind);
  }

  /** The list overview and the open list with its entries. */
  private renderLists(kind: ListKind): void {
    const pane = this.panes.get(kind)!;
    const box = pane.querySelector('.lists-body')!;
    const all = myLists.ofKind(kind);
    // Keep focus and text of the add form when the list re-renders after adding.
    const typed = box.querySelector<HTMLInputElement>('.lists-entry')?.value ?? '';
    const typedTaboo = box.querySelector<HTMLInputElement>('.lists-taboo')?.value ?? '';
    box.replaceChildren();
    if (!all.length) {
      box.append(el('p', 'note', `Noch keine Liste. Gib ihr oben einen Namen, dann trägst du ${KIND_INFO[kind].many} ein.`));
      return;
    }
    if (!all.some((l) => l.id === lastOpen[kind])) lastOpen[kind] = all[0].id;
    const ul = el('ul', 'lists-list');
    for (const l of all) {
      const li = el('li');
      li.classList.toggle('open', l.id === lastOpen[kind]);
      const pick = el('button', 'lists-pick');
      pick.type = 'button';
      pick.append(el('strong', '', l.name), el('span', 'note', `${l.items.length} ${l.items.length === 1 ? KIND_INFO[kind].one : KIND_INFO[kind].many}`));
      pick.setAttribute('aria-expanded', String(l.id === lastOpen[kind]));
      pick.addEventListener('click', () => {
        lastOpen[kind] = l.id;
        this.renderLists(kind);
      });
      const on = el('button', 'btn toggle small', l.on ? 'Im Raum: an' : 'Im Raum: aus');
      on.type = 'button';
      on.setAttribute('aria-pressed', String(l.on));
      on.title = 'Nur eingeschaltete Listen kommen in den Raum (Stapel „Eigene“).';
      on.addEventListener('click', () => myLists.setOn(l.id, !l.on));
      li.append(pick, on);
      ul.append(li);
    }
    box.append(ul);
    const open = all.find((l) => l.id === lastOpen[kind])!;
    box.append(this.editor(open, typed, typedTaboo));
  }

  private editor(l: CustomList, typed: string, typedTaboo: string): HTMLElement {
    const info = KIND_INFO[l.kind];
    const box = el('fieldset', 'group lists-edit');
    const head = el('div', 'row lists-edit-head');
    const rename = el('input', 'text-input lists-rename');
    Object.assign(rename, { value: l.name, maxLength: LISTS.maxNameChars, autocomplete: 'off' });
    rename.setAttribute('aria-label', 'Name der Liste');
    rename.addEventListener('change', () => myLists.rename(l.id, rename.value));
    let armed = 0;
    const del = this.btn('Liste löschen', () => {
      if (!armed) {
        del.textContent = 'Wirklich löschen?';
        armed = window.setTimeout(() => {
          armed = 0;
          del.textContent = 'Liste löschen';
        }, 3000);
        return;
      }
      clearTimeout(armed);
      myLists.remove(l.id);
    }, 'ghost small');
    head.append(rename, del);

    const form = el('form', 'words-form');
    const entry = el('input', 'text-input lists-entry');
    Object.assign(entry, { placeholder: info.example, maxLength: LISTS.maxChars[l.kind] + (l.kind === 'zeig' ? 30 : 0), autocomplete: 'off', value: typed });
    entry.setAttribute('aria-label', info.one);
    const taboo = el('input', 'text-input lists-taboo');
    Object.assign(taboo, { placeholder: 'Seil, Hüpfen, Aufwärmen, Gym', autocomplete: 'off', value: typedTaboo });
    const err = el('p', 'err');
    err.setAttribute('role', 'alert');
    const add = el('button', 'btn big', 'Hinzufügen');
    add.type = 'submit';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const forbidden = taboo.value.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
      const msg = myLists.add(l.id, entry.value, forbidden);
      if (msg) {
        err.textContent = msg;
        return;
      }
      // Re-rendered by the change event; start the next one empty.
      entry.value = taboo.value = '';
      const ed = this.panes.get(l.kind)!.querySelector<HTMLInputElement>('.lists-entry');
      if (ed) {
        ed.value = '';
        ed.focus();
      }
      const tb = this.panes.get(l.kind)!.querySelector<HTMLInputElement>('.lists-taboo');
      if (tb) tb.value = '';
    });
    if (l.kind === 'words') {
      form.append(
        this.field('Wort', entry, 'Das muss erraten werden.'),
        this.field('Verbotene Wörter', taboo, `Mit Komma getrennt, höchstens ${WORDS.maxTaboo}. Das Wort selbst ist immer verboten.`),
      );
    } else {
      const hint = l.kind === 'zeig' ? 'Wer würde am ehesten … ?' : l.kind === 'fragen' ? 'Eine Antwort, ein Wort.' : `Höchstens ${LISTS.maxChars.kategorien} Zeichen.`;
      form.append(this.field(info.one, entry, hint));
    }
    form.append(err, add);

    const items = el('ul', 'words-list');
    if (!l.items.length) items.append(el('li', 'note', `Noch leer. Oben ${l.kind === 'kategorien' || l.kind === 'zeig' || l.kind === 'fragen' ? 'die erste' : 'das erste'} ${info.one} eintragen.`));
    const me = playerId();
    for (const it of l.items) {
      const li = el('li');
      const text = el('div', 'words-card');
      text.append(el('strong', '', l.kind === 'zeig' ? `… ${it.text}?` : it.text));
      if (l.kind === 'words') text.append(el('span', 'note', it.taboo.length ? it.taboo.join(', ') : 'ohne verbotene Wörter'));
      if (it.by && it.by.id !== me) text.append(el('span', 'words-by', `von ${it.by.name}`));
      const rm = this.btn('Löschen', () => myLists.removeItem(l.id, it.id), 'ghost small');
      rm.setAttribute('aria-label', `${it.text} löschen`);
      li.append(text, rm);
      items.append(li);
    }

    const share = el('div', 'row');
    const note = el('p', 'note');
    note.setAttribute('role', 'status');
    share.append(
      this.btn('Liste kopieren', async () => {
        try {
          await navigator.clipboard.writeText(myLists.exportList(l.id));
          note.textContent = 'Kopiert. Schick den Text an Freunde, sie fügen ihn unter „Liste laden“ ein.';
        } catch {
          note.textContent = 'Kopieren hat nicht geklappt. Nimm „Als Datei speichern“.';
        }
      }),
      this.btn('Als Datei speichern', () => {
        const a = el('a');
        a.href = URL.createObjectURL(new Blob([myLists.exportList(l.id)], { type: 'application/json' }));
        a.download = `${l.name.replace(/[^\p{L}\p{N}-]+/gu, '-').toLowerCase() || 'liste'}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }),
    );
    box.append(head, form, items, share, note);
    return box;
  }

  /** Paste or load a list: an export from a friend, or simply one entry per line. */
  private importBox(kind: ListKind): HTMLElement {
    const box = el('div', 'lists-io');
    const note = el('p', 'note');
    note.setAttribute('role', 'status');
    const run = (text: string) => {
      try {
        const { added, name } = myLists.importText(kind, text);
        note.textContent = added ? `${added} ${added === 1 ? KIND_INFO[kind].one : KIND_INFO[kind].many} in „${name}“ übernommen.` : `Nichts Neues, „${name}“ hatte schon alles.`;
      } catch (e) {
        note.textContent = (e as Error).message;
      }
    };
    const file = el('input');
    Object.assign(file, { type: 'file', accept: '.json,.txt,application/json,text/plain', id: `lists-file-${kind}` });
    file.className = 'sr-only';
    const load = el('label', 'btn ghost', 'Datei laden');
    load.htmlFor = file.id;
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (f) run(await f.text());
      file.value = '';
    });
    const paste = el('textarea', 'text-input words-paste');
    Object.assign(paste, { placeholder: kind === 'words' ? 'Kopierte Liste einfügen, oder eine pro Zeile: Wort: verboten, verboten' : 'Kopierte Liste einfügen, oder eine pro Zeile', rows: 2 });
    paste.setAttribute('aria-label', 'Liste einfügen');
    const go = this.btn('Übernehmen', () => {
      if (!paste.value.trim()) return;
      run(paste.value);
      paste.value = '';
    });
    const row = el('div', 'row');
    row.append(go, load, file);
    box.append(paste, row, note);
    return box;
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
