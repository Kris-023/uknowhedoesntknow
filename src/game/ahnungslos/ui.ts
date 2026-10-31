import { AHNUNG, COLORS } from '../../config';
import { el, releaseMouse } from '../../ui/dom';
import { wordBoard } from '../gleich/boardImage';
import type { GleichUiInfo } from '../gleich/ui';
import type { GameUi, Member } from '../minigame';
import { pts } from '../whoami/ui';
import { tally } from '../zeig/logic';
import type { AhnungGame, ClueProblem } from './game';
import type { AhnState } from './logic';

const KEYS = { lock: ['Enter', 'Space'] } as const;

const hex = (seat: number) => `#${(COLORS.players[seat] ?? 0x888888).toString(16).padStart(6, '0')}`;
const num = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n)}`;
const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} und ${names.at(-1)}`);
const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;

const PROBLEM: Record<ClueProblem, string> = {
  empty: 'Schreib ein Wort.',
  words: 'Nur ein einziges Wort, ohne Leerzeichen.',
  word: 'Das ist (fast) das Wort selbst: das verrät zu viel.',
  turn: 'Du bist gerade nicht dran.',
};

/**
 * Screens of "Ahnungslos": your word (or that you have none) on top with the clues so far and the
 * input on your turn, the clues over the heads, the vote by looking, the guess and the reveal.
 */
export class AhnungUi implements GameUi {
  private bar = el('div', 'wi-bar gg-bar ah-bar');
  private board = el('aside', 'wi-board');
  private done = el('section', 'wi-done ah-done');
  private head = el('div', 'sa-head');
  private eyebrow = el('span', 'eyebrow');
  private timer = el('span', 'sa-timer');
  private role = el('div', 'ah-role');
  private body = el('div', 'gg-body');
  private form = el('form', 'gg-form');
  private input = el('input', 'text-input gg-input');
  private send = el('button', 'btn big', 'Sagen [Enter]');
  private problem = el('span', 'wi-warn');
  /** Bottom dock: the clues so far, the input and the vote, so the top stays clear for the boards over the heads. */
  private dock = el('div', 'wi-bar zd-dock ah-dock');
  private list = el('div', 'gg-body');
  private actions = el('div', 'wi-actions');
  private visible = true;
  private closedRound = -1;
  /** What the input is for right now ("round|phase|turn"), so it is cleared and focused once. */
  private formKey = '';
  private flashed = '';
  private known = new Map<string, string>();

  constructor(
    host: HTMLElement,
    private game: AhnungGame,
    private members: () => Member[],
    private info: GleichUiInfo,
  ) {
    this.input.type = 'text';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.send.type = 'submit';
    this.problem.hidden = true;
    this.form.append(this.input, this.send);
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    // One slim line on top (the boards over the heads reach up there): phase, your word, the timer.
    this.head.append(this.eyebrow, this.role, this.timer);
    this.bar.append(this.head);
    this.dock.append(this.body, this.list, this.form, this.problem, this.actions);
    for (const e of [this.bar, this.dock, this.board, this.done]) {
      e.hidden = true;
      host.append(e);
    }
    this.bar.setAttribute('role', 'status');
    game.onChange(() => this.render());
    addEventListener('keydown', (e) => this.key(e));
  }

  get doneOpen(): boolean {
    const s = this.game.state;
    return !this.done.hidden || (!!s && s.phase === 'done' && this.closedRound !== s.round && this.visible);
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

  private colored(id: string | null, text = this.nameOf(id)): HTMLElement {
    const b = el('strong', 'zd-name', text);
    b.style.color = hex(this.seatOf(id));
    return b;
  }

  /** Over each head: that player's clues so far; the clueless one in red once it's out. */
  boardOf(id: string): string | '?' | null {
    const s = this.game.state;
    if (!s || !s.players.includes(id)) return null;
    const words = s.clues.filter((c) => c.by === id).map((c) => c.word ?? '—');
    if (!words.length) return this.game.onTurn === id ? '?' : null;
    const out = s.clueless === id && (s.phase === 'done' || s.phase === 'guess');
    return wordBoard(words.join(' · '), out ? 'bad' : words.every((w) => w === '—') ? 'none' : 'word');
  }

  tick(): void {
    const s = this.game.state;
    if (!s || !this.visible || s.phase === 'done') return;
    const text = s.deadline ? `${Math.ceil(this.game.leftS)} s` : '';
    if (this.timer.textContent !== text) this.timer.textContent = text;
  }

  private render(): void {
    const s = this.game.state;
    if (!this.visible || !s) {
      for (const e of [this.bar, this.dock, this.board, this.done]) e.hidden = true;
      this.syncDialog();
      return;
    }
    for (const m of this.members()) if (s.players.includes(m.id)) this.known.set(m.id, m.name || 'Jemand');
    this.board.hidden = false;
    this.renderBar(s);
    this.renderBoard(s);
    this.renderDone(s);
    this.echo(s);
    this.syncDialog();
  }

  private syncDialog(): void {
    document.body.classList.toggle('wi-dialog', this.visible && (!this.form.hidden || !this.done.hidden));
  }

  /** Once per vote result: who was accused and what that means. */
  private echo(s: AhnState): void {
    if (!s.votes) return;
    const key = `${s.round}|${s.phase}`;
    if (key === this.flashed || (s.phase !== 'guess' && s.phase !== 'done')) return;
    this.flashed = key;
    if (s.phase === 'guess') this.info.flash('Erwischt', this.name(s.clueless), 'good', s.clueless === this.game.selfId ? 'Rate jetzt das Wort!' : 'Kann es das Wort noch erraten?');
  }

  private chips(s: AhnState): HTMLElement {
    const row = el('div', 'gg-chips ah-clues');
    for (const c of s.clues) {
      const chip = el('span', 'gg-chip');
      chip.style.setProperty('--c', hex(this.seatOf(c.by)));
      chip.classList.toggle('none', !c.word);
      chip.append(el('i', '', this.name(c.by)), el('b', '', c.word ?? '—'));
      row.append(chip);
    }
    return row;
  }

  private renderRole(s: AhnState, playing: boolean): void {
    const r = this.role;
    r.replaceChildren();
    if (!playing) {
      r.append(el('span', 'note', 'Du schaust zu, bis die nächste Runde beginnt.'));
      return;
    }
    const word = this.game.myWord;
    if (word) r.append(el('span', 'ah-lead', 'Das Wort'), el('strong', 'ah-word', word));
    else if (this.game.iAmClueless) r.append(el('strong', 'ah-word ah-none', 'Du bist ahnungslos'));
    else if (s.phase !== 'done') r.append(el('span', 'note', 'Dein Wort kommt gleich …'));
  }

  private renderBar(s: AhnState): void {
    const b = this.bar;
    const me = this.game.selfId;
    const playing = s.players.includes(me);
    if (s.phase === 'done') {
      b.hidden = true;
      this.dock.hidden = true;
      this.form.hidden = true;
      return;
    }
    b.hidden = false;
    this.dock.hidden = false;
    this.renderRole(s, playing);
    this.body.replaceChildren();
    this.list.replaceChildren();
    this.actions.replaceChildren();
    let inputFor: 'clue' | 'guess' | null = null;
    if (s.phase === 'clues') {
      this.eyebrow.textContent = `Ahnungslos · Hinweis ${Math.min(s.turn + 1, s.seq.length)}/${s.seq.length}`;
      const turn = this.game.onTurn;
      if (turn === me) {
        this.body.append(el('strong', 'wi-ask', 'Du bist dran: ein Wort dazu'));
        inputFor = 'clue';
      } else {
        const line = el('div', 'zd-aim');
        line.append(this.colored(turn), el('span', 'note', 'sagt ein Wort …'));
        this.body.append(line);
      }
      if (s.clues.length) this.list.append(this.chips(s));
      if (this.game.iAmClueless) this.actions.append(el('span', 'note', 'Du kennst das Wort nicht: hör gut zu und bluffe mit.'));
      else if (inputFor) this.actions.append(el('span', 'note', 'Laut sagen geht auch, aber nur ein Wort.'));
    } else if (s.phase === 'vote') {
      this.eyebrow.textContent = 'Ahnungslos · Abstimmung';
      this.list.append(this.chips(s));
      if (playing) this.vote(s);
    } else {
      this.eyebrow.textContent = 'Ahnungslos · Erwischt';
      if (s.clueless === me) {
        this.body.append(el('strong', 'wi-ask', 'Erwischt! Welches Wort war es?'));
        inputFor = 'guess';
      } else {
        const line = el('div', 'zd-aim');
        line.append(this.colored(s.clueless), el('span', '', 'wurde erwischt und rät das Wort …'));
        this.body.append(line);
      }
      this.list.append(this.chips(s));
    }
    this.syncForm(s, inputFor);
  }

  /** The input: once per turn/guess cleared, the mouse freed and the cursor in it. */
  private syncForm(s: AhnState, mode: 'clue' | 'guess' | null): void {
    const key = mode ? `${s.round}|${s.phase}|${s.turn}` : '';
    this.form.hidden = !mode;
    if (!mode) this.problem.hidden = true;
    if (key === this.formKey) return;
    this.formKey = key;
    if (!mode) return;
    this.input.value = '';
    this.problem.hidden = true;
    this.input.maxLength = mode === 'clue' ? AHNUNG.maxClueLen : AHNUNG.maxGuessLen;
    this.input.placeholder = mode === 'clue' ? 'Ein Wort' : 'Das Wort war …';
    this.input.setAttribute('aria-label', this.input.placeholder);
    this.send.textContent = mode === 'clue' ? 'Sagen [Enter]' : 'Raten [Enter]';
    releaseMouse();
    requestAnimationFrame(() => this.input.focus());
  }

  private vote(s: AhnState): void {
    const me = this.game.selfId;
    const pick = this.game.myPick;
    const aim = el('div', 'zd-aim');
    if (this.game.iLocked) aim.append(el('span', 'wi-ok', '✓ Verdächtigt:'), pick ? this.colored(pick) : el('span', 'note', 'niemand'));
    else if (pick) aim.append(el('span', '', 'Du verdächtigst'), this.colored(pick));
    else aim.append(el('span', 'wi-ask', 'Wer ist ahnungslos?'), el('span', 'note zd-hint', 'Schau die Person an.'));
    this.actions.append(aim);
    if (!this.game.iLocked) {
      const lock = this.btn('Festlegen [Enter]', () => this.game.lock(), 'big');
      lock.disabled = !pick;
      this.actions.append(lock);
      const row = el('div', 'zd-pick');
      row.append(el('span', 'note', 'oder anklicken:'));
      for (const p of s.players) if (p !== me) row.append(this.nameBtn(p, () => this.game.lock(p)));
      this.actions.append(row);
    } else {
      const missing = s.players.filter((p) => p !== me && !s.locked.includes(p)).map((p) => this.nameOf(p));
      if (missing.length) this.actions.append(el('span', 'note', `Es fehlen noch: ${list(missing)}`));
    }
  }

  private renderBoard(s: AhnState): void {
    const b = this.board;
    const phase = s.phase === 'clues' ? 'Hinweise' : s.phase === 'vote' ? 'Abstimmung' : s.phase === 'guess' ? 'Raten' : 'Runde vorbei';
    b.replaceChildren(el('span', 'eyebrow', `Ahnungslos · Runde ${s.round}`), el('strong', 'wi-phase', phase));
    const ol = el('ol', 'wi-scores');
    const turn = this.game.onTurn;
    for (const id of s.players) {
      const li = el('li');
      li.style.setProperty('--c', hex(this.seatOf(id)));
      li.classList.toggle('turn', id === turn);
      li.append(el('span', 'pname', id === this.game.selfId ? `${this.nameOf(id)} (du)` : this.nameOf(id)));
      if (id === turn) li.append(el('span', 'tag hot', 'ist dran'));
      else if (s.phase === 'vote') li.append(el('span', s.locked.includes(id) ? 'tag ok' : 'tag', s.locked.includes(id) ? '✓ fertig' : 'schaut'));
      li.append(el('b', '', num(s.scores[id] ?? 0)));
      ol.append(li);
    }
    b.append(ol);
  }

  private headline(s: AhnState): string {
    const who = this.name(s.clueless);
    const me = s.clueless === this.game.selfId;
    switch (s.outcome) {
      case 'escaped':
        return me ? 'Du warst ahnungslos und bist davongekommen!' : `${who} war ahnungslos und kam davon!`;
      case 'guessed':
        return me ? 'Erwischt, aber du hast das Wort erraten!' : `Erwischt, aber ${who} hat das Wort erraten!`;
      case 'caught':
        return me ? 'Erwischt, und das Wort war es nicht.' : `${who} wurde erwischt!`;
      default:
        return 'Runde abgebrochen';
    }
  }

  private why(s: AhnState): string {
    if (s.outcome === 'escaped') return `${s.accused ? `Die meisten haben ${this.name(s.accused)} verdächtigt.` : 'Keine eindeutige Mehrheit.'} +${pts(AHNUNG.escapePoints)} für ${this.name(s.clueless)}.`;
    if (s.outcome === 'guessed') return `Geraten: „${s.guess}“. +${pts(AHNUNG.guessPoints)} für ${this.name(s.clueless)}.`;
    if (s.outcome === 'caught') return `${s.guess ? `Geraten: „${s.guess}“.` : 'Nichts geraten.'} +${pts(AHNUNG.catchPoints)} für alle anderen.`;
    if (s.why === 'host') return 'Der Host ist weg, und nur er wusste, wer ahnungslos ist. Keine Punkte.';
    if (s.why === 'gone') return 'Wer ahnungslos war, hat den Raum verlassen. Keine Punkte.';
    if (s.why === 'few') return 'Zu wenige Spieler. Keine Punkte.';
    return 'Der Host hat die Runde beendet. Keine Punkte.';
  }

  private renderDone(s: AhnState): void {
    const open = s.phase === 'done' && this.closedRound !== s.round;
    if (!open) {
      this.done.hidden = true;
      return;
    }
    const wasHidden = this.done.hidden;
    this.done.hidden = false;
    if (wasHidden) releaseMouse();
    const d = this.done;
    d.replaceChildren(el('span', 'eyebrow', `Ahnungslos · Runde ${s.round} vorbei`), el('h2', '', this.headline(s)), el('p', 'note', this.why(s)));
    const facts = el('div', 'ah-facts');
    // An aborted round may not know the word any more; whoever knew it still does.
    const word = s.word ?? this.game.myWord;
    if (word) facts.append(el('span', 'ah-lead', 'Das Wort'), el('strong', 'ah-word', word));
    if (s.clueless) {
      const who = el('div', 'zd-aim');
      const me = s.clueless === this.game.selfId;
      who.append(el('span', 'ah-lead', me ? 'Ahnungslos warst' : 'Ahnungslos war'), this.colored(s.clueless, me ? 'du' : this.nameOf(s.clueless)));
      facts.append(who);
    }
    d.append(facts);
    if (s.clues.length) d.append(el('span', 'eyebrow', 'Hinweise'), this.chips(s));
    if (s.votes) {
      const { votes } = tally(s.votes, s.players);
      const ol = el('ol', 'zd-history ah-votes');
      for (const p of s.players) {
        const by = votes[p] ?? [];
        if (!by.length) continue;
        const li = el('li');
        const who = el('span', 'zd-who');
        who.append(this.colored(p, this.name(p)), el('span', 'note', ` · ${by.length} ${by.length === 1 ? 'Stimme' : 'Stimmen'}`));
        li.append(who, el('span', 'note', `von ${list(by.map((v) => this.name(v)))}`));
        li.classList.toggle('hit', p === s.clueless);
        ol.append(li);
      }
      d.append(el('span', 'eyebrow', 'Verdächtigt'));
      if (ol.childElementCount) d.append(ol);
      else d.append(el('p', 'note', 'Niemand hat jemanden verdächtigt.'));
    }
    const ranked = [...s.players].sort((a, b) => (s.scores[b] ?? 0) - (s.scores[a] ?? 0));
    const sc = el('ol', 'wi-scores zd-final');
    for (const id of ranked) {
      const li = el('li');
      li.style.setProperty('--c', hex(this.seatOf(id)));
      li.append(el('span', 'pname', id === this.game.selfId ? `${this.nameOf(id)} (du)` : this.nameOf(id)), el('b', '', num(s.scores[id] ?? 0)));
      sc.append(li);
    }
    d.append(sc);
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

  private submit(): void {
    const s = this.game.state;
    if (!s) return;
    if (s.phase === 'guess') {
      if (this.game.guess(this.input.value)) this.input.value = '';
      return;
    }
    const why = this.game.clue(this.input.value);
    this.problem.hidden = !why;
    if (why) this.problem.textContent = PROBLEM[why];
    else this.input.value = '';
  }

  private btn(text: string, onClick: () => void, cls = ''): HTMLButtonElement {
    const b = el('button', `btn ${cls}`.trim(), text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  private nameBtn(id: string, onClick: () => void): HTMLButtonElement {
    const b = this.btn(this.nameOf(id), onClick, 'small ghost zd-pickbtn');
    b.style.setProperty('--c', hex(this.seatOf(id)));
    return b;
  }

  private key(e: KeyboardEvent): void {
    const s = this.game.state;
    if (e.repeat || !this.visible || !s || typing(e) || s.phase !== 'vote' || !s.players.includes(this.game.selfId)) return;
    if ((KEYS.lock as readonly string[]).includes(e.code) && !this.game.iLocked && this.game.myPick) {
      e.preventDefault();
      this.game.lock();
    }
  }
}
