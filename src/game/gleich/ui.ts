import { COLORS, GLEICH } from '../../config';
import { el, releaseMouse } from '../../ui/dom';
import type { Member } from '../minigame';
import { pts } from '../whoami/ui';
import { wordBoard } from './boardImage';
import type { GleichGame } from './game';
import type { GleichState } from './logic';

/** Keys once the words are shown, so nobody has to let go of the mouse look. */
const KEYS = { call: 'KeyF', yes: 'Digit1', no: 'Digit2', next: 'Enter' } as const;
/** The end screen waits this long after a win, so the green boards over the heads get their moment. */
const DONE_DELAY_MS = 3000;

const hex = (seat: number) => `#${(COLORS.players[seat] ?? 0x888888).toString(16).padStart(6, '0')}`;
const num = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n)}`;
const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} und ${names.at(-1)}`);

export interface GleichUiInfo {
  hostName(): string;
  start(): void;
  /** Result echo in the middle, shared with the other games and the Schaffner. */
  flash(title: string, big: string, tone?: 'good' | 'bad' | 'plain', sub?: string): void;
  /** Why the others might not hear you (mic off, muted), or null. */
  micWarning(): string | null;
}

/**
 * Screens of "Gleich gedacht": the bar with question or last words and the input, the words in a
 * row once they are revealed (with the vote and "Weiter"), the scoreboard and the end of round.
 */
export class GleichUi {
  private bar = el('div', 'wi-bar gg-bar');
  private board = el('aside', 'wi-board');
  private done = el('section', 'wi-done gg-done');
  private head = el('div', 'sa-head');
  private eyebrow = el('span', 'eyebrow');
  private timer = el('span', 'sa-timer');
  private body = el('div', 'gg-body');
  private form = el('form', 'gg-form');
  private input = el('input', 'text-input gg-input');
  private send = el('button', 'btn big', 'Festlegen [Enter]');
  private actions = el('div', 'wi-actions');
  private visible = true;
  /** Writing again after locking ("Ändern"). */
  private editing = false;
  private tryKey = '';
  private closedRound = -1;
  /** Round of the end screen that is waiting for its delay, and when it may open. */
  private doneRound = -1;
  private doneAt = 0;
  private lastVoteKey = '';

  constructor(
    host: HTMLElement,
    private game: GleichGame,
    private members: () => Member[],
    private info: GleichUiInfo,
  ) {
    this.input.type = 'text';
    this.input.maxLength = GLEICH.maxWordLen;
    this.input.placeholder = 'Dein Wort';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.setAttribute('aria-label', 'Dein Wort');
    this.send.type = 'submit';
    this.form.append(this.input, this.send);
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.lock();
    });
    this.head.append(this.eyebrow, this.timer);
    this.bar.append(this.head, this.body, this.form, this.actions);
    for (const e of [this.bar, this.board, this.done]) {
      e.hidden = true;
      host.append(e);
    }
    this.bar.setAttribute('role', 'status');
    game.onChange(() => this.render());
    addEventListener('keydown', (e) => this.key(e));
  }

  /** The end screen is open or about to open (the lobby waits until it's closed). */
  get doneOpen(): boolean {
    return !this.done.hidden || this.donePending;
  }

  private get donePending(): boolean {
    const s = this.game.state;
    return !!s && s.phase === 'done' && this.closedRound !== s.round && !!this.done.hidden;
  }

  /** Only the game played last shows its screens; the others step aside. */
  set shown(on: boolean) {
    this.visible = on;
    this.render();
  }

  private seatOf(id: string | null): number {
    return this.members().find((m) => m.id === id)?.seat ?? -1;
  }

  private name(id: string | null): string {
    return id === this.game.selfId ? 'Du' : this.game.nameOf(id);
  }

  /**
   * What the cards layer shows over a head: a question mark for someone who has locked, then each
   * player's word (the matching group in green, nothing valid as a dash). Null = no board.
   */
  boardOf(id: string): string | '?' | null {
    const s = this.game.state;
    if (!s || !s.players.includes(id)) return null;
    const words = this.game.wordsView();
    if (words) {
      const w = words[id];
      if (w === undefined) return null;
      return w ? wordBoard(w, s.group.length >= 2 && s.group.includes(id) ? 'match' : 'word') : wordBoard('—', 'none');
    }
    return s.phase !== 'done' && s.commits[id] ? '?' : null;
  }

  /** Per frame: countdowns and the delayed end screen. */
  tick(): void {
    const s = this.game.state;
    if (!s || !this.visible) return;
    if (s.phase === 'done' && this.doneRound === s.round && this.done.hidden && this.closedRound !== s.round && performance.now() >= this.doneAt) this.renderDone();
    if (s.phase === 'done') return;
    const text = s.deadline ? `${Math.ceil(this.game.leftS)} s` : '';
    if (this.timer.textContent !== text) this.timer.textContent = text;
    const cd = this.actions.querySelector('.wi-countdown');
    if (cd && s.vote) {
      const t = `noch ${Math.ceil(this.game.voteLeftS)} s`;
      if (cd.textContent !== t) cd.textContent = t;
    }
  }

  private render(): void {
    const s = this.game.state;
    if (!this.visible || !s) {
      for (const e of [this.bar, this.board, this.done]) e.hidden = true;
      this.syncDialog();
      return;
    }
    this.board.hidden = false;
    this.renderBar(s);
    this.renderBoard(s);
    if (s.phase === 'done') {
      if (this.doneRound !== s.round) {
        this.doneRound = s.round;
        // A win gets a moment on the boards; a failed round opens the screen at once.
        this.doneAt = performance.now() + (s.solved ? DONE_DELAY_MS : 0);
        if (s.solved) this.info.flash(`Versuch ${s.solvedTry}`, 'Gleich gedacht!', 'good', `+${pts(GLEICH.points[(s.solvedTry ?? 1) - 1] ?? GLEICH.points.at(-1)!)} für alle`);
      }
      this.renderDone();
    } else {
      this.done.hidden = true;
      this.echoVote(s);
    }
    this.syncDialog();
  }

  /** The vote's outcome, once. */
  private echoVote(s: GleichState): void {
    if (!s.last) return;
    const key = `${s.round}|${s.tryNo}|${s.last.yes}|${s.last.no}`;
    if (key === this.lastVoteKey) return;
    this.lastVoteKey = key;
    this.info.flash('Abstimmung', 'Zählt nicht', 'bad', `${s.last.yes} Ja, ${s.last.no} Nein. Ihr braucht eine Mehrheit.`);
  }

  /** Typing needs the mouse and the whole attention: the bottom hint steps aside, a click doesn't grab the mouse back. */
  private syncDialog(): void {
    document.body.classList.toggle('wi-dialog', this.visible && (!this.form.hidden || !this.done.hidden));
  }

  private chip(id: string, word: string | null, hit = false): HTMLElement {
    const c = el('span', 'gg-chip');
    c.style.setProperty('--c', hex(this.seatOf(id)));
    c.classList.toggle('hit', hit);
    c.classList.toggle('none', !word);
    c.append(el('i', '', this.name(id)), el('b', '', word ?? '—'));
    return c;
  }

  private renderBar(s: GleichState): void {
    const b = this.bar;
    if (s.phase === 'done') {
      b.hidden = true;
      this.form.hidden = true;
      return;
    }
    b.hidden = false;
    const me = this.game.selfId;
    const playing = s.players.includes(me);
    this.eyebrow.textContent = `Gleich gedacht · Versuch ${s.tryNo}/${GLEICH.maxTries}`;
    this.body.replaceChildren();
    this.actions.replaceChildren();

    if (s.phase === 'write') {
      const mine = this.game.myWord;
      // After a reload the commitment is still there but its word isn't: write again.
      const typing = playing && (!mine || this.editing);
      const key = `${s.round}|${s.tryNo}`;
      if (key !== this.tryKey) {
        this.tryKey = key;
        this.editing = false;
        this.input.value = '';
        // The input needs the mouse.
        if (playing && !mine) {
          releaseMouse();
          requestAnimationFrame(() => this.input.focus());
        }
      }
      const wasHidden = this.form.hidden;
      this.form.hidden = !typing;
      if (typing && wasHidden && this.editing) requestAnimationFrame(() => this.input.focus());
      this.timer.hidden = false;
      const prev = s.history.at(-1);
      if (s.tryNo === 1) {
        const q = s.questions[me];
        if (q) this.body.append(el('span', 'note', 'Deine Frage, eine Antwort, ein Wort:'), el('strong', 'gg-question', q));
      } else if (prev) {
        this.body.append(el('span', 'note', 'Schreibt ein Wort, das diese Wörter verbindet:'));
        const row = el('div', 'gg-chips');
        for (const p of s.players) row.append(this.chip(p, prev[p] ?? null));
        this.body.append(row);
      }
      if (!playing) this.actions.append(el('span', 'note', 'Du schaust zu, bis die nächste Runde beginnt.'));
      if (mine && !this.editing) {
        this.actions.append(el('span', 'wi-ok', `✓ Gesperrt: ${mine}`), this.btn('Ändern', () => this.edit(), 'ghost'));
      }
      const missing = s.players.filter((p) => !s.commits[p] && p !== me).map((p) => this.game.nameOf(p));
      if (playing && mine && missing.length) this.actions.append(el('span', 'note', `Es fehlen noch: ${list(missing)}`));
      this.actions.append(el('span', 'note', 'Nicht reden: das Wort bleibt geheim, bis alle gesperrt haben.'));
      const warn = this.info.micWarning();
      if (typing && warn) this.actions.append(el('span', 'wi-warn', warn));
      return;
    }

    // reveal
    this.form.hidden = true;
    const words = this.game.wordsView();
    if (!words) {
      this.timer.hidden = true;
      this.body.append(el('span', 'wi-ask', 'Die Wörter werden aufgedeckt …'));
      return;
    }
    this.timer.hidden = false;
    const hits = s.group.length;
    this.body.append(el('strong', 'gg-head', hits >= 2 ? `${hits} von ${s.of} gleich!` : 'Kein Treffer'));
    const row = el('div', 'gg-chips');
    for (const p of s.players) row.append(this.chip(p, words[p] ?? null, hits >= 2 && s.group.includes(p)));
    this.body.append(row);
    if (!playing) return;

    const v = s.vote;
    if (v) {
      if (!this.game.iVoted) {
        this.actions.append(el('span', 'wi-ask', 'Zählt das als gleich?'));
        this.actions.append(this.btn(`Ja [1]`, () => this.game.vote(true), 'big'), this.btn(`Nein [2]`, () => this.game.vote(false)));
      } else this.actions.append(el('span', 'wi-ok', '✓ Deine Stimme ist drin'));
      const missing = s.players.filter((p) => !v.voters.includes(p) && p !== me).map((p) => this.game.nameOf(p));
      if (missing.length) this.actions.append(el('span', 'note', `Warte auf ${list(missing)}`));
      this.actions.append(el('span', 'wi-countdown note'));
      return;
    }
    const isReady = s.ready.includes(me);
    if (isReady) this.actions.append(el('span', 'wi-ok', `✓ Bereit (${s.ready.length}/${s.players.length})`));
    else this.actions.append(this.btn('Weiter [Enter]', () => this.game.ready(), 'big'));
    if (!s.voted) this.actions.append(this.btn('Zählt als gleich? [F]', () => this.game.call(), 'ghost'));
    else if (s.last) this.actions.append(el('span', 'note', `Abstimmung: ${s.last.yes} Ja, ${s.last.no} Nein`));
    const missing = s.players.filter((p) => !s.ready.includes(p) && p !== me).map((p) => this.game.nameOf(p));
    if (isReady && missing.length) this.actions.append(el('span', 'note', `Es fehlen noch: ${list(missing)}`));
  }

  private renderBoard(s: GleichState): void {
    const b = this.board;
    const phase = s.phase === 'write' ? 'Wort schreiben' : s.phase === 'reveal' ? 'Aufgedeckt' : 'Runde vorbei';
    b.replaceChildren(el('span', 'eyebrow', `Gleich gedacht · Runde ${s.round}`), el('strong', 'wi-phase', phase));
    const ol = el('ol', 'wi-scores');
    for (const id of s.players) {
      const li = el('li');
      li.style.setProperty('--c', hex(this.seatOf(id)));
      li.append(el('span', 'pname', id === this.game.selfId ? `${this.game.nameOf(id)} (du)` : this.game.nameOf(id)));
      if (s.phase === 'write') li.append(el('span', s.commits[id] ? 'tag ok' : 'tag', s.commits[id] ? '✓ fertig' : 'schreibt'));
      else if (s.phase === 'reveal' && s.words) {
        if (s.vote) li.append(el('span', 'tag', s.vote.voters.includes(id) ? '✓' : '…'));
        else if (s.ready.includes(id)) li.append(el('span', 'tag ok', '✓ bereit'));
      }
      li.append(el('b', '', num(s.scores[id] ?? 0)));
      ol.append(li);
    }
    b.append(ol);
  }

  private renderDone(): void {
    const s = this.game.state!;
    const open = s.phase === 'done' && this.closedRound !== s.round && performance.now() >= this.doneAt;
    if (!open) {
      this.done.hidden = true;
      return;
    }
    const wasHidden = this.done.hidden;
    this.done.hidden = false;
    if (wasHidden) releaseMouse();
    const d = this.done;
    const gain = GLEICH.points[(s.solvedTry ?? 1) - 1] ?? GLEICH.points.at(-1)!;
    d.replaceChildren(
      el('span', 'eyebrow', `Gleich gedacht · Runde ${s.round} vorbei`),
      el('h2', '', s.solved ? `Gleich gedacht in Versuch ${s.solvedTry}!` : s.players.length < 2 ? 'Zu wenige Spieler' : `Nicht geschafft nach ${s.history.length} ${s.history.length === 1 ? 'Versuch' : 'Versuchen'}`),
      el('p', 'note', s.solved ? `Alle in der Runde bekommen ${pts(gain)}.` : 'Diesmal gibt es keine Punkte.'),
    );
    const log = el('ol', 'gg-history');
    s.history.forEach((w, i) => {
      const li = el('li');
      const hit = s.solved && i === s.history.length - 1;
      li.classList.toggle('hit', hit);
      li.append(el('span', 'gg-try', `Versuch ${i + 1}`));
      const row = el('div', 'gg-chips');
      const groupIds = hit ? s.players : [];
      for (const p of s.players) if (p in w || hit) row.append(this.chip(p, w[p] ?? null, hit && groupIds.includes(p)));
      li.append(row);
      log.append(li);
    });
    d.append(log);
    const qs = Object.entries(s.questions);
    if (qs.length) {
      const det = el('details', 'gg-questions');
      det.append(el('summary', '', 'Die Fragen aus Versuch 1'));
      for (const [id, q] of qs) det.append(el('p', 'note', `${this.name(id)}: ${q}`));
      d.append(det);
    }
    const row = el('div', 'row');
    if (this.game.isHost) row.append(this.btn('Neue Runde [G]', () => this.info.start(), 'big'));
    else row.append(el('span', 'note', `${this.info.hostName()} kann eine neue Runde starten.`));
    row.append(this.btn('Schließen', () => this.close(), 'ghost'));
    d.append(row);
  }

  close(): void {
    const s = this.game.state;
    if (s) this.closedRound = s.round;
    this.done.hidden = true;
    document.body.classList.remove('wi-dialog');
  }

  private edit(): void {
    this.editing = true;
    this.input.value = this.game.myWord ?? '';
    this.render();
    requestAnimationFrame(() => this.input.select());
  }

  private async lock(): Promise<void> {
    if (!this.input.value.trim()) return;
    const ok = await this.game.lock(this.input.value);
    if (!ok) return;
    this.editing = false;
    this.input.value = '';
    this.render();
  }

  private btn(text: string, onClick: () => void, cls = ''): HTMLButtonElement {
    const b = el('button', `btn ${cls}`.trim(), text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  private key(e: KeyboardEvent): void {
    const s = this.game.state;
    if (e.repeat || !this.visible || !s || s.phase !== 'reveal' || !s.words || !s.players.includes(this.game.selfId)) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (s.vote) {
      if (e.code === KEYS.yes) this.game.vote(true);
      else if (e.code === KEYS.no) this.game.vote(false);
    } else if (e.code === KEYS.call && !s.voted) this.game.call();
    else if (e.code === KEYS.next) this.game.ready();
  }
}
