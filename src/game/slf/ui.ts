import { COLORS, SLF } from '../../config';
import { el, releaseMouse } from '../../ui/dom';
import { normWord } from '../../words/custom';
import { myLists } from '../../words/lists';
import { noteBoard, wordBoard, type BoardTone } from '../gleich/boardImage';
import type { GleichUiInfo } from '../gleich/ui';
import type { GameUi, Member } from '../minigame';
import { stepKey } from '../undo';
import { cardFromBlob, cardFromUrl } from '../whoami/cardImage';
import type { SlfGame } from './game';
import { cleanCategory, liveText, pickBounds, type CatResult, type Edit, type Flag, type SlfState } from './logic';

/** Keys once the answers are out, so the mouse look can stay. */
const KEYS = { yes: 'Digit1', no: 'Digit2', next: 'Enter' } as const;

const hex = (seat: number) => `#${(COLORS.players[seat] ?? 0x888888).toString(16).padStart(6, '0')}`;
const num = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n)}`;
const plus = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} und ${names.at(-1)}`);
const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;

/** Where "in eigene Liste übernehmen" puts a typed category if the player has no list of that kind yet. */
const NEW_LIST = 'Meine Kategorien';
const HOW: Record<string, string> = { free: ' (eingetippt)', roll: ' (gewürfelt)', pool: '' };

/**
 * Screens of "Stadt, Land, Fluss": the step "Kategorien" before a round, the sheet to write on (or
 * to collect pictures in), the bar with letter and category, the dock to rate a category (flags and
 * votes, or judging pictures), the scoreboard and the table at the end.
 */
export class SlfUi implements GameUi {
  private bar = el('div', 'wi-bar gg-bar slf-bar');
  private head = el('div', 'sa-head');
  private eyebrow = el('span', 'eyebrow');
  private timer = el('span', 'sa-timer');
  private body = el('div', 'gg-body');
  private sheet = el('section', 'wi-maker slf-sheet');
  private dock = el('div', 'wi-bar zd-dock slf-dock');
  private board = el('aside', 'wi-board');
  private done = el('section', 'wi-done slf-done');
  /** The step "Kategorien": list, editor, proposals, host controls. Only the parts that change are rebuilt. */
  private pick = el('section', 'wi-maker slf-pick');
  private pickHead = el('header', 'slf-sheet-head');
  private pickCount = el('span', 'tag');
  private pickRole = el('p', 'note');
  private pickList = el('ol', 'slf-cats');
  private pickAdd = el('div', 'row');
  private pickMsg = el('p', 'note slf-pick-msg');
  private pickProps = el('div', 'slf-props');
  private pickFoot = el('div', 'row slf-pick-foot');
  private pickView = '';
  /** The editor stays across rebuilds, so typing is never interrupted by someone else's change. */
  private ed = {
    box: el('form', 'slf-edit'),
    title: el('span', 'field-label'),
    input: el('input', 'text-input'),
    submit: el('button', 'btn small', 'Übernehmen'),
    save: el('select', 'select'),
    err: el('p', 'err'),
    pool: el('div', 'slf-pool'),
  };
  /** Category being replaced; null = a new one; undefined = editor closed. */
  private editing: string | null | undefined = undefined;
  /** Last list chosen for "in eigene Liste übernehmen" ('' = don't save). */
  private saveTo = '';
  private visible = true;
  private closedRound = '';
  /** Round the sheet was built for. */
  private sheetRound = -1;
  private stopBtn: HTMLButtonElement | null = null;
  private inputs: HTMLInputElement[] = [];
  /** Picture rounds: the slot that gets a pasted picture. */
  private activeSlot = 0;
  private slotEls: { drop: HTMLElement; img: HTMLImageElement; hint: HTMLElement; err: HTMLElement }[] = [];
  /** Text rating: the answer picked for a flag. */
  private picked: string | null = null;
  /** Picture judging: my verdicts and best pick for the running category. */
  private verdict: { key: string; ok: Record<string, boolean>; best: string | null } = { key: '', ok: {}, best: null };
  private flashed = new Set<string>();
  /** Keys of the vote outcomes echoed so far, and the round and undo count they were last checked at. */
  private flagEchoes = new Set<string>();
  private echoStep = '';
  private mouseKey = '';
  private dockView = '';
  /** Names of everyone seen in the round, for the end screen after someone left. */
  private known = new Map<string, string>();

  constructor(
    host: HTMLElement,
    private game: SlfGame,
    private members: () => Member[],
    private info: GleichUiInfo,
  ) {
    this.head.append(this.eyebrow, this.timer);
    this.bar.append(this.head, this.body);
    for (const e of [this.bar, this.sheet, this.pick, this.dock, this.board, this.done]) {
      e.hidden = true;
      host.append(e);
    }
    this.buildPick();
    this.bar.setAttribute('role', 'status');
    this.sheet.setAttribute('aria-label', 'Stadt, Land, Fluss');
    game.onChange(() => this.render());
    addEventListener('keydown', (e) => this.key(e));
    addEventListener('paste', (e) => this.paste(e));
  }

  get doneOpen(): boolean {
    const s = this.game.state;
    return !this.done.hidden || (!!s && s.phase === 'done' && this.closedRound !== stepKey(s) && this.visible);
  }

  set shown(on: boolean) {
    this.visible = on;
    this.render();
  }

  private seatOf(id: string | null): number {
    return this.members().find((m) => m.id === id)?.seat ?? -1;
  }

  private nameOf(id: string | null): string {
    if (id && this.members().some((m) => m.id === id)) return this.game.nameOf(id);
    return (id && this.known.get(id)) || 'Jemand';
  }

  private name(id: string | null): string {
    return id === this.game.selfId ? 'Du' : this.nameOf(id);
  }

  private answer(id: string, cat: number): string | null {
    return this.game.answersView()?.[id]?.[cat] ?? null;
  }

  /** Live result of the running text category, or the stored one of a finished category. */
  private result(s: SlfState, cat = s.cat): CatResult | null {
    if (cat < s.results.length) return s.results[cat];
    if (s.mode === 'text' && s.phase === 'rate' && cat === s.cat) return liveText(s);
    return null;
  }

  /**
   * Over a head: '?' for someone who has handed in; while rating the answer (coloured by what it
   * scores: green unique, amber shared, red invalid) or the picture.
   */
  boardOf(id: string): string | '?' | null {
    const s = this.game.state;
    if (!s || !s.players.includes(id)) return null;
    if (s.phase === 'write' || s.phase === 'lock' || s.phase === 'reveal') return s.commits[id] ? '?' : null;
    if (s.phase !== 'rate') return null;
    if (s.mode === 'bild') return this.game.picOf(id, s.cat)?.img ?? wordBoard('—', 'none');
    const a = this.answer(id, s.cat);
    const r = this.result(s);
    if (!a) return wordBoard('—', 'none');
    const tone: BoardTone = !r?.valid[id] ? 'bad' : r.groups.some((g) => g.includes(id)) ? 'top' : 'match';
    return noteBoard(a, plus(r?.points[id] ?? 0), tone);
  }

  tick(): void {
    const s = this.game.state;
    if (!s || !this.visible || s.phase === 'done') return;
    const text = s.deadline ? `${Math.ceil(this.game.leftS)} s` : '';
    if (this.timer.textContent !== text) this.timer.textContent = text;
    this.timer.classList.toggle('slf-hurry', !!s.stopBy && s.phase === 'write');
    for (const t of [this.sheet.querySelector('.slf-sheet-timer'), this.dock.querySelector('.slf-dock-timer')]) if (t && t.textContent !== text) t.textContent = text;
    const cd = this.dock.querySelector('.wi-countdown');
    if (cd && s.vote) {
      const t = `noch ${Math.ceil(this.game.voteLeftS)} s`;
      if (cd.textContent !== t) cd.textContent = t;
    }
    // "Stopp!" lights up as soon as everything is filled in.
    if (this.stopBtn) this.stopBtn.disabled = !this.game.canEdit || !this.game.filled;
  }

  private render(): void {
    const s = this.game.state;
    if (!this.visible || !s) {
      for (const e of [this.bar, this.sheet, this.pick, this.dock, this.board, this.done]) e.hidden = true;
      this.syncDialog();
      return;
    }
    for (const id of s.players) if (this.members().some((m) => m.id === id)) this.known.set(id, this.game.nameOf(id));
    this.board.hidden = false;
    this.echo(s);
    this.renderPick(s);
    this.renderSheet(s);
    this.renderBar(s);
    this.renderDock(s);
    this.renderBoard(s);
    this.renderDone(s);
    this.syncDialog();
  }

  /** Writing needs the mouse and the whole attention: the bottom hint steps aside, a click doesn't grab the mouse back. */
  private syncDialog(): void {
    document.body.classList.toggle('wi-dialog', this.visible && (!this.sheet.hidden || !this.pick.hidden || !this.done.hidden));
  }

  /** One-off echoes: a stop, the outcome of a vote. The best picture shows in the dock (an echo would cover it). */
  private echo(s: SlfState): void {
    const once = (key: string, f: () => void) => {
      if (this.flashed.has(key)) return;
      this.flashed.add(key);
      f();
    };
    if (s.stopBy && s.phase === 'write' && s.stopBy !== this.game.selfId) {
      once(`${s.round}|stop`, () => this.info.flash('Stopp!', this.nameOf(s.stopBy), 'bad', `ist fertig. Noch ${s.mode === 'text' ? SLF.stopS : SLF.imageStopS} Sekunden.`));
    }
    // After an undo, flags that are gone may come back with the same key and have to be told again.
    const now = new Set(s.flags.flatMap((f, i) => (f.result === null ? [] : [`${s.round}|${s.cat}|${i}|${f.target}`])));
    if (stepKey(s) !== this.echoStep) {
      this.echoStep = stepKey(s);
      for (const k of this.flagEchoes) if (!now.has(k)) this.flashed.delete(k);
      this.flagEchoes = now;
    }
    s.flags.forEach((f, i) => {
      if (f.result === null) return;
      this.flagEchoes.add(`${s.round}|${s.cat}|${i}|${f.target}`);
      once(`${s.round}|${s.cat}|${i}|${f.target}`, () => this.info.flash('Abstimmung', this.flagOutcome(f), f.result === 'yes' ? 'bad' : 'plain', `${f.yes} Ja, ${f.no} Nein`));
    });
  }

  private flagOutcome(f: Flag): string {
    if (f.kind === 'bad') return f.result === 'yes' ? 'Ungültig' : 'Zählt doch';
    return f.result === 'yes' ? 'Gleich' : 'Nicht gleich';
  }

  // ---------- the step "Kategorien" ----------

  private buildPick(): void {
    const p = this.pick;
    p.setAttribute('aria-label', 'Kategorien wählen');
    const title = el('div');
    title.append(el('span', 'eyebrow'), el('h2', '', 'Kategorien'));
    this.pickHead.append(title, this.pickCount);
    const ed = this.ed;
    Object.assign(ed.input, { type: 'text', maxLength: SLF.pick.maxTyped, autocomplete: 'off', spellcheck: false, placeholder: 'Eintippen oder unten auswählen' });
    ed.input.setAttribute('aria-label', 'Kategorie');
    ed.submit.type = 'submit';
    const cancel = this.btn('Abbrechen', () => this.closeEditor(), 'ghost small');
    const line = el('div', 'row');
    line.append(ed.input, ed.submit, cancel);
    const save = el('label', 'row slf-save');
    save.append(el('span', 'note', 'Eingetipptes in eigene Liste:'), ed.save);
    ed.box.append(ed.title, line, save, ed.err, ed.pool);
    ed.box.hidden = true;
    ed.box.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitTyped();
    });
    ed.input.addEventListener('input', () => {
      ed.err.textContent = '';
      this.fillPool();
    });
    ed.input.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.closeEditor();
    });
    ed.save.addEventListener('change', () => (this.saveTo = ed.save.value));
    p.append(this.pickHead, this.pickRole, this.pickList, this.pickAdd, ed.box, this.pickMsg, this.pickProps, this.pickFoot);
  }

  private renderPick(s: SlfState): void {
    if (s.phase !== 'pick') {
      this.pick.hidden = true;
      this.editing = undefined;
      this.pickView = '';
      return;
    }
    const wasHidden = this.pick.hidden;
    this.pick.hidden = false;
    if (wasHidden) {
      releaseMouse();
      this.pickMsg.textContent = '';
    }
    const g = this.game;
    const names = [...s.proposals.map((p) => this.name(p.by)), this.info.hostName(), g.myProposals];
    // Rebuild only when something shown changed: the heartbeat must not swap a button under the cursor.
    const view = JSON.stringify([stepKey(s), s.mode, s.categories, s.proposals, s.keep, g.isHost, names, this.editing, g.poolGroups()]);
    if (view === this.pickView) return;
    this.pickView = view;
    if (this.editing && !s.categories.includes(this.editing)) this.closeEditor(false);
    const host = g.isHost;
    const { min, max } = pickBounds(s.mode);
    const n = s.categories.length;
    const full = !host && g.myProposals >= SLF.pick.maxProposals;
    // Nothing left in the pool: rolling would do nothing (the host draws from its own pool, which is the same here).
    const inList = new Set(s.categories.map(normWord));
    const dry = !g.poolGroups().some((x) => x.items.some((c) => !inList.has(normWord(c))));
    const dryTip = 'Der Pool ist ausgeschöpft: eintippen oder Stapel freischalten';
    (this.pickHead.querySelector('.eyebrow') as HTMLElement).textContent = `Stadt, Land, Fluss · Runde ${s.round} · ${s.mode === 'text' ? 'Schreiben' : 'Bilder'}`;
    this.pickCount.textContent = `${n} · erlaubt ${min}–${max}`;
    this.pickRole.textContent = host
      ? 'Ändere die Liste, nimm Vorschläge an oder lehne sie ab. Der Buchstabe kommt erst mit „Los geht’s“.'
      : full
        ? `Du hast ${SLF.pick.maxProposals} offene Vorschläge. Warte, bis ${this.info.hostName()} sie annimmt oder ablehnt.`
        : `Deine Änderungen gehen als Vorschlag an ${this.info.hostName()}. Der Buchstabe kommt erst, wenn es losgeht.`;
    this.pickList.replaceChildren(
      ...s.categories.map((cat, k) => {
        const li = el('li');
        li.classList.toggle('editing', this.editing === cat);
        const roll = this.btn('Würfeln', () => g.roll(cat), 'ghost small');
        roll.title = 'Neu würfeln: eine zufällige aus dem Pool';
        const swap = this.btn('Ersetzen', () => this.openEditor(cat), 'ghost small');
        const del = this.btn('✕', () => g.removeCat(cat), 'ghost small danger');
        del.title = 'Entfernen';
        del.setAttribute('aria-label', `${cat} entfernen`);
        roll.disabled = full || dry;
        if (dry) roll.title = dryTip;
        swap.disabled = full;
        del.disabled = full || n <= min;
        li.append(el('span', 'slf-cat-n', String(k + 1)), el('b', '', cat), roll, swap, del);
        return li;
      }),
    );
    const add = this.btn('+ Hinzufügen', () => this.openEditor(null), 'ghost small');
    const rnd = this.btn('+ Zufällige', () => g.addCat(null), 'ghost small');
    add.disabled = full || n >= max;
    rnd.disabled = add.disabled || dry;
    if (dry) rnd.title = dryTip;
    this.pickAdd.replaceChildren(add, rnd);
    this.renderEditor(s, full);
    this.renderProposals(s);
    const foot: HTMLElement[] = [];
    const classic = this.btn('Klassisch', () => g.preset('klassisch'), 'ghost small');
    classic.title = 'Stadt, Land, Fluss und die klassischen';
    const random = this.btn('Zufall', () => g.preset('zufall'), 'ghost small');
    random.title = 'Alle neu ziehen';
    classic.disabled = random.disabled = full;
    foot.push(classic, random);
    if (host) {
      const keep = this.btn('Für nächste Runden behalten', () => g.setKeep(!s.keep), 'small toggle');
      keep.setAttribute('aria-pressed', String(s.keep));
      const go = this.btn('Los geht’s', () => void g.go(), 'big');
      go.disabled = n < min || n > max;
      foot.push(keep, go);
    } else if (s.keep) foot.push(el('span', 'note', 'Die Liste bleibt für die nächsten Runden.'));
    this.pickFoot.replaceChildren(...foot);
  }

  private describe(e: Edit): string {
    switch (e.op) {
      case 'set':
        return `„${e.at}“ → „${e.text}“${HOW[e.how]}`;
      case 'add':
        return `+ „${e.text}“${HOW[e.how]}`;
      case 'remove':
        return `„${e.at}“ entfernen`;
      case 'preset':
        return `${e.name === 'klassisch' ? 'Klassisch' : 'Zufall'}: ${e.list.join(', ')}`;
    }
  }

  private renderProposals(s: SlfState): void {
    const g = this.game;
    if (!s.proposals.length) {
      this.pickProps.replaceChildren();
      return;
    }
    const rows = s.proposals.map((p) => {
      const row = el('div', 'slf-prop');
      row.style.setProperty('--c', hex(this.seatOf(p.by)));
      row.append(el('i', '', this.name(p.by)), el('span', 'slf-prop-what', this.describe(p.edit)));
      if (g.isHost) {
        const ok = this.btn('Annehmen', () => g.accept(p.id), 'small');
        ok.disabled = !g.applies(p);
        if (ok.disabled) ok.title = 'Passt gerade nicht (zu viele oder zu wenige Kategorien)';
        row.append(ok, this.btn('Ablehnen', () => g.reject(p.id), 'ghost small'));
      } else if (p.by === g.selfId) row.append(el('span', 'note', 'wartet'), this.btn('Zurückziehen', () => g.withdraw(p.id), 'ghost small'));
      else row.append(el('span', 'note', `wartet auf ${this.info.hostName()}`));
      return row;
    });
    this.pickProps.replaceChildren(el('span', 'eyebrow', 'Vorschläge'), ...rows);
  }

  private openEditor(at: string | null): void {
    this.editing = at;
    this.ed.input.value = '';
    this.ed.err.textContent = '';
    this.pickView = '';
    this.render();
    requestAnimationFrame(() => this.ed.input.focus());
  }

  private closeEditor(render = true): void {
    this.editing = undefined;
    this.ed.box.hidden = true;
    this.pickView = '';
    if (render) this.render();
  }

  private renderEditor(s: SlfState, full: boolean): void {
    const ed = this.ed;
    ed.box.hidden = this.editing === undefined || full;
    if (ed.box.hidden) return;
    ed.title.textContent = this.editing === null ? 'Neue Kategorie' : `„${this.editing}“ ersetzen durch`;
    ed.submit.textContent = this.game.isHost ? 'Übernehmen' : 'Vorschlagen';
    // The player's own lists of categories, to keep a typed one.
    const lists = myLists.ofKind('kategorien');
    const opts: [string, string][] = [['', 'nicht speichern'], ...lists.map((l) => [l.id, l.name] as [string, string])];
    if (!lists.some((l) => l.name === NEW_LIST)) opts.push(['+', `Neue Liste „${NEW_LIST}“`]);
    if (!opts.some(([v]) => v === this.saveTo)) this.saveTo = '';
    ed.save.replaceChildren(
      ...opts.map(([v, t]) => {
        const o = el('option', '', t);
        o.value = v;
        return o;
      }),
    );
    ed.save.value = this.saveTo;
    this.fillPool(s);
  }

  /** The pool as buttons, filtered by what is typed; categories already in the list are left out. */
  private fillPool(s = this.game.state): void {
    if (!s) return;
    const q = normWord(this.ed.input.value);
    const inList = new Set(s.categories.map(normWord));
    const parts: HTMLElement[] = [];
    for (const g of this.game.poolGroups()) {
      const items = g.items.filter((c) => !inList.has(normWord(c)) && (!q || normWord(c).includes(q)));
      if (!items.length) continue;
      parts.push(el('span', 'eyebrow', g.label), ...items.map((c) => this.btn(c, () => this.choose(c, 'pool'), 'ghost small')));
    }
    if (!parts.length) parts.push(el('span', 'note', q ? 'Nichts davon im Pool: mit Enter so übernehmen.' : 'Der Pool ist ausgeschöpft: eintippen.'));
    this.ed.pool.replaceChildren(...parts);
  }

  private submitTyped(): void {
    const ed = this.ed;
    const text = cleanCategory(ed.input.value, SLF.pick.maxTyped);
    if (!text) {
      ed.err.textContent = `Leer oder länger als ${SLF.pick.maxTyped} Zeichen.`;
      return;
    }
    if (this.game.state?.categories.some((c) => normWord(c) === normWord(text))) {
      ed.err.textContent = `„${text}“ ist schon dabei.`;
      return;
    }
    this.pickMsg.textContent = this.keepTyped(text);
    this.choose(text, 'free');
  }

  /** "In eigene Liste übernehmen": into the list the player chose, made on demand. Returns a note for the player. */
  private keepTyped(text: string): string {
    let id = this.saveTo;
    if (!id) return '';
    if (id === '+') {
      const made = myLists.create('kategorien', NEW_LIST);
      if (typeof made === 'string') return made;
      id = this.saveTo = made.id;
    }
    const err = myLists.add(id, text);
    return err ?? `„${text}“ steht jetzt in „${myLists.get(id)?.name ?? NEW_LIST}“.`;
  }

  private choose(text: string, how: 'free' | 'pool'): void {
    const at = this.editing;
    if (at === undefined) return;
    if (at === null) this.game.addCat(text, how);
    else this.game.replaceCat(at, text, how);
    this.closeEditor();
  }

  // ---------- writing ----------

  private renderSheet(s: SlfState): void {
    const open = s.phase === 'write' && this.game.playing && this.game.canEdit;
    if (!open) {
      this.sheet.hidden = true;
      this.stopBtn = null;
      return;
    }
    const wasHidden = this.sheet.hidden;
    this.sheet.hidden = false;
    if (this.sheetRound !== s.round) {
      this.sheetRound = s.round;
      this.buildSheet(s);
    }
    if (wasHidden) {
      releaseMouse();
      requestAnimationFrame(() => (this.inputs.find((i) => !i.value) ?? this.inputs[0])?.focus());
    }
  }

  private buildSheet(s: SlfState): void {
    const sh = this.sheet;
    sh.classList.toggle('bild', s.mode === 'bild');
    sh.replaceChildren();
    this.inputs = [];
    this.slotEls = [];
    this.activeSlot = 0;
    const head = el('header', 'slf-sheet-head');
    const title = el('div');
    title.append(el('span', 'eyebrow', `Stadt, Land, Fluss · Runde ${s.round}`), el('h2', '', s.mode === 'text' ? 'Alles mit' : 'Bilder mit'));
    head.append(title, el('span', 'slf-letter', s.letter), el('span', 'sa-timer slf-sheet-timer'));
    sh.append(head);
    const draft = this.game.draft;
    if (s.mode === 'text') {
      const grid = el('div', 'slf-grid');
      s.categories.forEach((cat, c) => {
        const box = el('label', 'slf-field');
        const input = el('input', 'text-input');
        Object.assign(input, { type: 'text', maxLength: SLF.maxAnswerLen, autocomplete: 'off', spellcheck: false, value: draft.texts[c] ?? '' });
        input.placeholder = `${s.letter} …`;
        input.addEventListener('input', () => this.game.setText(c, input.value));
        input.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const next = this.inputs[c + 1];
          if (next) next.focus();
          else void this.game.stop();
        });
        box.append(el('span', 'field-label', cat), input);
        grid.append(box);
        this.inputs.push(input);
      });
      sh.append(grid);
    } else {
      const grid = el('div', 'slf-slots');
      s.categories.forEach((cat, c) => grid.append(this.slot(s, cat, c)));
      const linkRow = el('form', 'row');
      const link = el('input', 'text-input');
      Object.assign(link, { type: 'url', placeholder: 'Bild-Link für das gewählte Feld', id: 'slf-link' });
      link.setAttribute('aria-label', 'Bild-Link');
      const load = el('button', 'btn', 'Laden');
      load.type = 'submit';
      linkRow.addEventListener('submit', (e) => {
        e.preventDefault();
        if (link.value) void this.setImage(this.activeSlot, cardFromUrl(link.value)).then(() => (link.value = ''));
      });
      const file = el('input');
      Object.assign(file, { type: 'file', accept: 'image/*', id: 'slf-file' });
      file.className = 'sr-only';
      const fileBtn = el('label', 'btn ghost', 'Datei wählen');
      fileBtn.htmlFor = file.id;
      file.addEventListener('change', () => {
        if (file.files?.[0]) void this.setImage(this.activeSlot, cardFromBlob(file.files[0]));
        file.value = '';
      });
      linkRow.append(link, load, fileBtn, file);
      sh.append(grid, linkRow, el('p', 'note', 'Feld anklicken, dann Bild hineinziehen, mit Strg+V einfügen, Link laden oder Datei wählen. Die Bilder gehen erst nach dem Ende an die anderen.'));
      this.markSlot();
    }
    const row = el('div', 'row slf-stop');
    const stop = el('button', 'btn big', 'Stopp! [Enter]');
    stop.type = 'button';
    stop.disabled = true;
    stop.addEventListener('click', () => void this.game.stop());
    this.stopBtn = stop;
    row.append(
      stop,
      el('span', 'note', s.mode === 'text' ? `Geht, wenn alles ausgefüllt ist: dann bleiben den anderen ${SLF.stopS} s. Nicht reden, nicht abschreiben.` : `Geht, wenn jedes Feld ein Bild hat: dann bleiben den anderen ${SLF.imageStopS} s.`),
    );
    sh.append(row);
    const warn = this.info.micWarning();
    if (warn) sh.append(el('p', 'wi-warn', warn));
  }

  private slot(s: SlfState, cat: string, c: number): HTMLElement {
    const box = el('div', 'slf-slot');
    const drop = el('div', 'wi-drop slf-drop');
    drop.tabIndex = 0;
    drop.setAttribute('aria-label', `Bild für ${cat}`);
    const img = el('img', 'wi-preview');
    img.alt = `Bild für ${cat}`;
    const pic = this.game.draft.pics[c];
    img.hidden = !pic?.img;
    if (pic?.img) img.src = pic.img;
    const hint = el('p', 'wi-drop-hint', 'Bild hierher');
    hint.hidden = !!pic?.img;
    const err = el('p', 'err');
    drop.append(img, hint);
    const pick = () => {
      this.activeSlot = c;
      this.markSlot();
    };
    drop.addEventListener('click', pick);
    drop.addEventListener('focus', pick);
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      pick();
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
      const url = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
      if (file) void this.setImage(c, cardFromBlob(file));
      else if (url) void this.setImage(c, cardFromUrl(url));
    });
    const cap = el('input', 'text-input slf-cap');
    Object.assign(cap, { type: 'text', maxLength: SLF.maxCaptionLen, autocomplete: 'off', placeholder: `Was ist das? (${s.letter} …)`, value: pic?.cap ?? '' });
    cap.setAttribute('aria-label', `Bildunterschrift für ${cat}`);
    cap.addEventListener('input', () => this.game.setCaption(c, cap.value));
    cap.addEventListener('focus', pick);
    this.inputs.push(cap);
    box.append(el('span', 'field-label', cat), drop, cap, err);
    this.slotEls.push({ drop, img, hint, err });
    return box;
  }

  private markSlot(): void {
    this.slotEls.forEach((x, i) => x.drop.classList.toggle('active', i === this.activeSlot));
  }

  private async setImage(c: number, p: Promise<string>): Promise<void> {
    const slot = this.slotEls[c];
    if (!slot) return;
    slot.err.textContent = '';
    slot.hint.textContent = 'Lädt …';
    try {
      const img = await p;
      this.game.setPic(c, img);
      slot.img.src = img;
      slot.img.hidden = false;
      slot.hint.hidden = true;
      // The next empty field is where the next picture goes.
      const next = this.game.draft.pics.findIndex((x) => !x.img);
      if (next >= 0) {
        this.activeSlot = next;
        this.markSlot();
      }
    } catch (e) {
      slot.hint.textContent = 'Bild hierher';
      slot.err.textContent = (e as Error).message;
    }
  }

  private paste(e: ClipboardEvent): void {
    const s = this.game.state;
    if (this.sheet.hidden || !s || s.mode !== 'bild' || !this.game.canEdit) return;
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    const blob = item?.getAsFile();
    if (blob) {
      e.preventDefault();
      void this.setImage(this.activeSlot, cardFromBlob(blob));
      return;
    }
    const text = e.clipboardData?.getData('text/plain')?.trim();
    // A pasted link outside a text field loads right away.
    if (text && /^https?:\/\//.test(text) && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      void this.setImage(this.activeSlot, cardFromUrl(text));
    }
  }

  // ---------- bar ----------

  private renderBar(s: SlfState): void {
    // While rating, the boards over the heads own the top of the view; the dock carries letter and category.
    if (s.phase === 'done' || s.phase === 'rate' || s.phase === 'pick' || !this.sheet.hidden) {
      this.bar.hidden = true;
      return;
    }
    this.bar.hidden = false;
    this.body.replaceChildren();
    const letter = el('span', 'slf-letter small', s.letter);
    this.eyebrow.textContent = `Stadt, Land, Fluss · Runde ${s.round}`;
    const line = el('div', 'slf-line');
    line.append(letter);
    this.timer.hidden = s.phase !== 'write';
    if (s.phase === 'write') {
      const missing = s.players.filter((p) => !s.commits[p] && p !== this.game.selfId).map((p) => this.nameOf(p));
      line.append(el('span', 'wi-ok', this.game.playing ? '✓ Abgegeben' : 'Du schaust zu'));
      this.body.append(line);
      if (missing.length) this.body.append(el('span', 'note', `Es schreiben noch: ${list(missing)}`));
    } else {
      line.append(el('strong', 'gg-head', s.phase === 'lock' ? 'Zeit um!' : s.mode === 'text' ? 'Die Antworten werden aufgedeckt …' : 'Die Bilder kommen …'));
      this.body.append(line);
    }
  }

  // ---------- rating ----------

  private renderDock(s: SlfState): void {
    const d = this.dock;
    if (s.phase !== 'rate') {
      d.hidden = true;
      this.picked = null;
      return;
    }
    d.hidden = false;
    // Rebuild only when something shown changed: the host's heartbeat must not swap a button under the cursor.
    const g = this.game;
    const view = JSON.stringify([
      stepKey(s), s.cat, s.step, s.flags, s.vote && { ...s.vote, deadline: 0 }, s.ready, s.judged, s.voteNo, s.results.length, s.players,
      this.picked, this.verdict, g.iVoted, g.iJudged, g.playing, s.players.map((p) => (s.mode === 'text' ? this.answer(p, s.cat) : !!g.picOf(p, s.cat))),
    ]);
    if (view === this.dockView && d.childElementCount) return;
    this.dockView = view;
    d.replaceChildren();
    const head = el('div', 'slf-dock-head');
    head.append(
      el('span', 'slf-letter small', s.letter),
      el('strong', 'gg-question', s.categories[s.cat]),
      el('span', 'eyebrow', `Kategorie ${s.cat + 1}/${s.categories.length}`),
      el('span', 'sa-timer slf-dock-timer'),
    );
    d.append(head);
    // Flags, votes and picture verdicts need the mouse: free it once per category.
    const key = `${stepKey(s)}|${s.cat}|${s.step}`;
    if (key !== this.mouseKey) {
      this.mouseKey = key;
      this.picked = null;
      if (this.game.playing && (s.mode === 'text' || s.step === 'vote')) releaseMouse();
    }
    if (s.mode === 'text') this.textDock(s, d);
    else if (s.step === 'vote') this.judgeDock(s, d);
    else this.resultDock(s, d);
  }

  private chip(id: string, word: string | null, r: CatResult | null, cat: number): HTMLButtonElement {
    const c = el('button', 'gg-chip slf-chip');
    c.type = 'button';
    c.style.setProperty('--c', hex(this.seatOf(id)));
    const valid = !!r?.valid[id];
    const shared = !!r?.groups.some((g) => g.includes(id));
    c.classList.toggle('hit', valid && !shared);
    c.classList.toggle('shared', valid && shared);
    c.classList.toggle('bad', !valid && !!word);
    c.classList.toggle('none', !word);
    c.classList.toggle('picked', this.picked === id);
    c.append(el('i', '', this.name(id)), el('b', '', word ?? '—'), el('span', 'slf-pts', r ? plus(r.points[id] ?? 0) : ''));
    c.dataset.cat = String(cat);
    return c;
  }

  private textDock(s: SlfState, d: HTMLElement): void {
    const me = this.game.selfId;
    const r = this.result(s);
    const row = el('div', 'gg-chips');
    for (const p of s.players) {
      const a = this.answer(p, s.cat);
      const c = this.chip(p, a, r, s.cat);
      // Only answers that count can be flagged ("ungültig", or "gleich wie" another one).
      if (this.game.playing && !s.vote && r?.valid[p]) {
        c.title = 'Anklicken: ungültig melden oder als gleich markieren';
        c.addEventListener('click', () => {
          this.picked = this.picked === p ? null : p;
          this.render();
        });
      } else c.disabled = true;
      row.append(c);
    }
    d.append(row);
    const actions = el('div', 'wi-actions');
    const v = s.vote;
    if (v) {
      const f = s.flags[v.flag];
      const what = f ? this.flagText(f, s) : '';
      actions.append(el('span', 'wi-ask', what));
      if (v.eligible.includes(me) && !this.game.iVoted) actions.append(this.btn('Ja [1]', () => this.game.vote(true), 'big'), this.btn('Nein [2]', () => this.game.vote(false)));
      else if (v.eligible.includes(me)) actions.append(el('span', 'wi-ok', '✓ Deine Stimme ist drin'));
      else actions.append(el('span', 'note', 'Die anderen stimmen ab.'));
      const missing = v.eligible.filter((p) => !v.voters.includes(p) && p !== me).map((p) => this.nameOf(p));
      if (missing.length) actions.append(el('span', 'note', `Warte auf ${list(missing)}`));
      actions.append(el('span', 'wi-countdown note'));
      d.append(actions);
      return;
    }
    const p = this.picked;
    if (p && r?.valid[p]) {
      const a = this.answer(p, s.cat) ?? '';
      const pick = el('div', 'wi-actions slf-flagrow');
      pick.append(el('span', 'note', `„${a}“ von ${this.name(p)}:`));
      if (!s.flags.some((f) => f.kind === 'bad' && f.target === p)) pick.append(this.btn('Ungültig melden', () => this.game.flagBad(p), 'small'));
      const others = s.players.filter((q) => q !== p && r.valid[q] && !r.groups.some((g) => g.includes(p) && g.includes(q)) && !s.flags.some((f) => f.kind === 'same' && ((f.target === p && f.other === q) || (f.target === q && f.other === p))));
      if (others.length) {
        pick.append(el('span', 'note', 'gleich wie'));
        for (const q of others) pick.append(this.btn(`„${this.answer(q, s.cat)}“`, () => this.game.flagSame(p, q), 'ghost small'));
      }
      pick.append(this.btn('Abbrechen', () => {
        this.picked = null;
        this.render();
      }, 'ghost small'));
      d.append(pick);
    }
    const done = s.flags.filter((f) => f.result !== null);
    if (done.length) d.append(el('span', 'note', done.map((f) => `${this.flagText(f, s, true)} → ${this.flagOutcome(f).toLowerCase()}`).join(' · ')));
    if (this.game.playing) {
      if (s.ready.includes(me)) actions.append(el('span', 'wi-ok', `✓ Bereit (${s.ready.length}/${s.players.length})`));
      else actions.append(this.btn('Weiter [Enter]', () => this.game.ready(), 'big'));
      actions.append(el('span', 'note', 'Antwort anklicken: ungültig melden oder „gleich wie“ eine andere.'));
    }
    d.append(actions);
  }

  private flagText(f: Flag, s: SlfState, short = false): string {
    const a = `„${this.answer(f.target, s.cat) ?? '—'}“`;
    if (f.kind === 'bad') return short ? `${a} ungültig?` : `${this.name(f.by)} ${f.by === this.game.selfId ? 'meinst' : 'meint'}: ${a} von ${this.name(f.target)} zählt nicht. Stimmt das?`;
    const b = `„${(f.other && this.answer(f.other, s.cat)) ?? '—'}“`;
    return short ? `${a} = ${b}?` : `${this.name(f.by)} ${f.by === this.game.selfId ? 'meinst' : 'meint'}: ${a} und ${b} sind gleich. Stimmt das?`;
  }

  private judgeDock(s: SlfState, d: HTMLElement): void {
    const me = this.game.selfId;
    const key = `${stepKey(s)}|${s.cat}|${s.voteNo}`;
    if (this.verdict.key !== key) this.verdict = { key, ok: {}, best: null };
    const v = this.verdict;
    const grid = el('div', 'slf-thumbs');
    const judged = this.game.iJudged;
    for (const p of s.players) {
      const pic = this.game.picOf(p, s.cat);
      const card = el('div', 'slf-thumb');
      card.style.setProperty('--c', hex(this.seatOf(p)));
      const ok = v.ok[p] !== false;
      card.classList.toggle('off', !ok && p !== me);
      card.classList.toggle('best', v.best === p);
      card.append(this.thumb(pic?.img ?? null), el('b', '', pic?.cap || (pic ? '' : 'kein Bild')), el('i', '', this.name(p)));
      if (p !== me && pic && this.game.playing && !judged) {
        const t = this.btn(ok ? '✓ Zählt' : '✗ Zählt nicht', () => {
          v.ok[p] = !ok;
          if (!v.ok[p] && v.best === p) v.best = null;
          this.render();
        }, `small toggle${ok ? '' : ' no'}`);
        t.setAttribute('aria-pressed', String(ok));
        const b = this.btn(v.best === p ? '★ Bestes' : '☆ Bestes', () => {
          v.best = v.best === p ? null : p;
          if (v.best) v.ok[p] = true;
          this.render();
        }, 'ghost small');
        b.setAttribute('aria-pressed', String(v.best === p));
        card.append(t, b);
      } else if (p === me) card.append(el('span', 'note', 'Deins'));
      grid.append(card);
    }
    d.append(grid);
    const actions = el('div', 'wi-actions');
    if (this.game.playing && !judged) {
      actions.append(
        this.btn('Abstimmen [Enter]', () => this.submitJudge(), 'big'),
        el('span', 'note', `Passt das Bild zu „${s.categories[s.cat]}“ mit ${s.letter}? Und welches ist das beste (nicht deins)?`),
      );
    } else if (this.game.playing) {
      const missing = s.players.filter((p) => !s.judged.includes(p) && p !== me).map((p) => this.nameOf(p));
      actions.append(el('span', 'wi-ok', '✓ Abgestimmt'), el('span', 'note', missing.length ? `Warte auf ${list(missing)}` : ''));
    }
    d.append(actions);
  }

  private submitJudge(): void {
    const s = this.game.state;
    if (!s) return;
    const ok: Record<string, boolean> = {};
    for (const p of s.players) if (p !== this.game.selfId && this.game.picOf(p, s.cat)) ok[p] = this.verdict.ok[p] !== false;
    this.game.judge(ok, this.verdict.best);
  }

  private resultDock(s: SlfState, d: HTMLElement): void {
    const r = s.results[s.cat];
    const grid = el('div', 'slf-thumbs');
    for (const p of s.players) {
      const pic = this.game.picOf(p, s.cat);
      const card = el('div', 'slf-thumb');
      card.style.setProperty('--c', hex(this.seatOf(p)));
      card.classList.toggle('off', !r?.valid[p]);
      card.classList.toggle('best', !!r?.best.includes(p));
      const t = r?.tally?.[p];
      card.append(this.thumb(pic?.img ?? null), el('b', '', pic?.cap || (pic ? '' : 'kein Bild')), el('i', '', this.name(p)));
      card.append(el('span', 'slf-pts', `${r?.best.includes(p) ? '★ ' : ''}${plus(r?.points[p] ?? 0)}`));
      if (t && pic) card.append(el('span', 'note', `${t[0]} zählt · ${t[1]} nicht`));
      grid.append(card);
    }
    d.append(grid);
    const actions = el('div', 'wi-actions');
    if (this.game.playing) {
      if (s.ready.includes(this.game.selfId)) actions.append(el('span', 'wi-ok', `✓ Bereit (${s.ready.length}/${s.players.length})`));
      else actions.append(this.btn(s.cat + 1 < s.categories.length ? 'Weiter [Enter]' : 'Zum Ergebnis [Enter]', () => this.game.ready(), 'big'));
    }
    d.append(actions);
  }

  private thumb(src: string | null): HTMLElement {
    const box = el('div', 'slf-pic');
    if (src) {
      const img = el('img');
      img.alt = '';
      img.src = src;
      box.append(img);
    } else box.append(el('span', '', '—'));
    return box;
  }

  // ---------- scoreboard, end ----------

  private renderBoard(s: SlfState): void {
    const b = this.board;
    const phase = s.phase === 'write' ? (s.mode === 'text' ? 'Schreiben' : 'Bilder suchen') : s.phase === 'rate' ? s.categories[s.cat] : s.phase === 'done' ? 'Runde vorbei' : 'Aufdecken';
    b.replaceChildren(el('span', 'eyebrow', `Stadt, Land, Fluss · Runde ${s.round}`), el('strong', 'wi-phase', s.phase === 'pick' ? 'Kategorien wählen' : `${s.letter} · ${phase}`));
    const ol = el('ol', 'wi-scores');
    for (const id of s.players) {
      const li = el('li');
      li.style.setProperty('--c', hex(this.seatOf(id)));
      li.append(el('span', 'pname', id === this.game.selfId ? `${this.nameOf(id)} (du)` : this.nameOf(id)));
      if (s.phase === 'write' || s.phase === 'lock') li.append(el('span', s.commits[id] ? 'tag ok' : 'tag', s.commits[id] ? '✓ fertig' : 'schreibt'));
      else if (s.phase === 'rate' && s.mode === 'bild' && s.step === 'vote') li.append(el('span', 'tag', s.judged.includes(id) ? '✓' : '…'));
      else if (s.phase === 'rate' && s.ready.includes(id)) li.append(el('span', 'tag ok', '✓ bereit'));
      li.append(el('b', '', num(s.scores[id] ?? 0)));
      ol.append(li);
    }
    b.append(ol);
  }

  private renderDone(s: SlfState): void {
    const open = s.phase === 'done' && this.closedRound !== stepKey(s);
    if (!open) {
      this.done.hidden = true;
      return;
    }
    const wasHidden = this.done.hidden;
    this.done.hidden = false;
    if (wasHidden) releaseMouse();
    const d = this.done;
    const gain = (p: string) => s.results.reduce((sum, r) => sum + (r.points[p] ?? 0), 0);
    const order = [...s.players].sort((a, b) => gain(b) - gain(a));
    const top = order.length ? gain(order[0]) : 0;
    const winners = order.filter((p) => gain(p) === top && top > 0);
    d.replaceChildren(
      el('span', 'eyebrow', `Stadt, Land, Fluss · ${s.letter} · Runde ${s.round} vorbei`),
      el('h2', '', s.players.length < 2 ? 'Zu wenige Spieler' : winners.length ? `${list(winners.map((p) => this.name(p)))} ${winners.length > 1 ? 'holen' : winners[0] === this.game.selfId ? 'holst' : 'holt'} die meisten Punkte` : 'Keine Punkte diesmal'),
    );
    const table = el('table', 'slf-table');
    const thead = el('thead');
    const hr = el('tr');
    hr.append(el('th', '', s.letter));
    for (const p of order) {
      const th = el('th', '', this.name(p));
      th.style.setProperty('--c', hex(this.seatOf(p)));
      hr.append(th);
    }
    thead.append(hr);
    const tbody = el('tbody');
    s.categories.forEach((cat, c) => {
      const tr = el('tr');
      tr.append(el('th', '', cat));
      const r = s.results[c];
      for (const p of order) {
        const td = el('td');
        if (!r) td.append(el('span', 'note', '—'));
        else {
          if (s.mode === 'text') td.append(el('span', 'slf-ans', this.answer(p, c) ?? '—'));
          else {
            const pic = this.game.picOf(p, c);
            td.append(this.thumb(pic?.img ?? null));
            if (pic?.cap) td.append(el('span', 'slf-ans', pic.cap));
          }
          td.append(el('b', 'slf-pts', `${r.best.includes(p) ? '★ ' : ''}${plus(r.points[p] ?? 0)}`));
          td.classList.toggle('bad', !r.valid[p]);
          td.classList.toggle('shared', !!r.groups.some((g) => g.includes(p)));
        }
        tr.append(td);
      }
      tbody.append(tr);
    });
    const foot = el('tr', 'slf-sum');
    foot.append(el('th', '', 'Runde'));
    for (const p of order) foot.append(el('td', '', plus(gain(p))));
    tbody.append(foot);
    const total = el('tr', 'slf-sum');
    total.append(el('th', '', 'Gesamt'));
    for (const p of order) total.append(el('td', '', num(s.scores[p] ?? 0)));
    tbody.append(total);
    table.append(thead, tbody);
    const wrap = el('div', 'slf-table-wrap');
    wrap.append(table);
    d.append(wrap);
    d.append(
      el(
        'p',
        'note',
        s.mode === 'text'
          ? `${SLF.points.unique} für eine eigene Antwort, ${SLF.points.same} wenn jemand dasselbe hat, ${SLF.points.only} wenn nur du etwas Gültiges hast.`
          : `${SLF.imagePoints} für jedes Bild, das zählt, ${SLF.bestBonus} extra für das beste.`,
      ),
    );
    const row = el('div', 'row');
    if (this.game.isHost) {
      const keep = this.btn('Kategorien behalten', () => this.game.setKeep(!s.keep), 'small toggle');
      keep.title = 'Die nächste Runde beginnt mit denselben Kategorien (noch änderbar)';
      keep.setAttribute('aria-pressed', String(s.keep));
      row.append(keep, this.btn('Neue Runde [G]', () => this.info.start(), 'big'));
    }
    else row.append(el('span', 'note', `${this.info.hostName()} kann eine neue Runde starten.`));
    row.append(this.btn('Schließen', () => this.close(), 'ghost'));
    d.append(row);
  }

  close(): void {
    const s = this.game.state;
    if (s) this.closedRound = stepKey(s);
    this.done.hidden = true;
    document.body.classList.remove('wi-dialog');
  }

  private btn(text: string, onClick: () => void, cls = ''): HTMLButtonElement {
    const b = el('button', `btn ${cls}`.trim(), text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  private key(e: KeyboardEvent): void {
    const s = this.game.state;
    if (e.repeat || !this.visible || !s || s.phase !== 'rate' || !this.game.playing || typing(e)) return;
    if (s.vote) {
      if (e.code === KEYS.yes) this.game.vote(true);
      else if (e.code === KEYS.no) this.game.vote(false);
      return;
    }
    if (e.code !== KEYS.next) return;
    // A focused button takes Enter itself.
    if (e.target instanceof HTMLButtonElement) return;
    if (s.mode === 'bild' && s.step === 'vote') {
      if (!this.game.iJudged) this.submitJudge();
    } else this.game.ready();
  }
}
