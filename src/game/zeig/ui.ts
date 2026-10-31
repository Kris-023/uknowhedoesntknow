import { COLORS, ZEIG } from '../../config';
import { el, releaseMouse } from '../../ui/dom';
import { noteBoard } from '../gleich/boardImage';
import type { GleichUiInfo } from '../gleich/ui';
import type { GameUi, Member } from '../minigame';
import { pts } from '../whoami/ui';
import type { ZeigGame } from './game';
import { tally, type ZeigRecord, type ZeigState } from './logic';

/** Keys, so nobody has to let go of the mouse look: lock the pick, go on after the reveal. */
const KEYS = { lock: ['Enter', 'Space'], next: ['Enter', 'Space'] } as const;

const hex = (seat: number) => `#${(COLORS.players[seat] ?? 0x888888).toString(16).padStart(6, '0')}`;
const num = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n)}`;
const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} und ${names.at(-1)}`);
const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;

/**
 * Screens of "Zeig drauf": the question on top with whom you're pointing at, the vote counts over
 * the heads after the reveal, the scoreboard and the round's results at the end.
 */
export class ZeigUi implements GameUi {
  private bar = el('div', 'wi-bar gg-bar zd-bar');
  private board = el('aside', 'wi-board');
  private done = el('section', 'wi-done zd-done');
  private head = el('div', 'sa-head');
  private eyebrow = el('span', 'eyebrow');
  private timer = el('span', 'sa-timer');
  private body = el('div', 'gg-body');
  /** Bottom dock: whom you point at and the buttons, so the top stays clear for the names over the heads. */
  private dock = el('div', 'wi-bar zd-dock');
  private actions = el('div', 'wi-actions');
  private visible = true;
  private closedRound = -1;
  private flashed = '';
  /** Names of everyone seen in the round, for the end screen after someone left. */
  private known = new Map<string, string>();

  constructor(
    host: HTMLElement,
    private game: ZeigGame,
    private members: () => Member[],
    private info: GleichUiInfo,
  ) {
    this.head.append(this.eyebrow, this.timer);
    this.bar.append(this.head, this.body);
    this.dock.append(this.actions);
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

  /** Over each head after the reveal: how many pointed at them, and who. */
  boardOf(id: string): string | '?' | null {
    const s = this.game.state;
    const r = this.game.shown;
    if (!s || !r || !s.players.includes(id)) return null;
    const { votes } = tally(r.picks, s.players);
    const by = votes[id] ?? [];
    const top = r.top.includes(id);
    return noteBoard(String(by.length), by.length ? by.map((p) => this.name(p)).join(', ') : 'keiner', top ? 'top' : by.length ? 'word' : 'none');
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
    document.body.classList.toggle('wi-dialog', this.visible && !this.done.hidden);
  }

  /** Once per reveal: who it was, in the middle of the screen. */
  private echo(s: ZeigState): void {
    const r = this.game.shown;
    if (!r) return;
    const key = `${s.round}|${s.qNo}`;
    if (key === this.flashed) return;
    this.flashed = key;
    const mine = r.picks[this.game.selfId];
    const scored = r.count >= ZEIG.minAgree && !!mine && r.top.includes(mine);
    const big = !r.top.length ? 'Keiner' : r.top.length === 1 ? this.name(r.top[0]) : 'Gleichstand';
    const sub = scored ? `+${pts(ZEIG.majorityPoints)} für dich` : r.top.length > 1 ? list(r.top.map((p) => this.name(p))) : '';
    this.info.flash('Am ehesten', big, scored ? 'good' : 'plain', sub);
  }

  private questionLine(q: string): HTMLElement[] {
    return [el('span', 'zd-lead', 'Wer würde am ehesten …'), el('strong', 'gg-question zd-question', `${q}?`)];
  }

  private renderBar(s: ZeigState): void {
    const b = this.bar;
    if (s.phase === 'done') {
      b.hidden = true;
      this.dock.hidden = true;
      return;
    }
    b.hidden = false;
    this.dock.hidden = false;
    const me = this.game.selfId;
    const playing = s.players.includes(me);
    this.eyebrow.textContent = `Zeig drauf · Frage ${s.qNo}/${s.questions.length}`;
    // While the boards are up the top stays a slim line (they reach up there); the question moves down with the result.
    this.body.replaceChildren(...(s.phase === 'look' ? this.questionLine(this.game.question) : []));
    this.actions.replaceChildren();
    if (s.phase === 'look') {
      if (!playing) {
        this.actions.append(el('span', 'note', 'Du schaust zu, bis die nächste Runde beginnt.'));
        return;
      }
      const pick = this.game.myPick;
      const aim = el('div', 'zd-aim');
      if (this.game.iLocked) aim.append(el('span', 'wi-ok', '✓ Festgelegt:'), pick ? this.colored(pick) : el('span', 'note', 'niemand'));
      else if (pick) aim.append(el('span', '', 'Du zeigst auf'), this.colored(pick));
      else aim.append(el('span', 'note zd-hint', 'Schau die Person an, die es am ehesten tun würde'));
      this.actions.append(aim);
      if (!this.game.iLocked) {
        const lock = this.btn('Festlegen [Enter]', () => this.game.lock(), 'big');
        lock.disabled = !pick;
        this.actions.append(lock);
        // Without the mouse look (menu open, or no pointer lock): pick by click instead.
        const row = el('div', 'zd-pick');
        row.append(el('span', 'note', 'oder anklicken:'));
        for (const p of s.players) if (p !== me) row.append(this.nameBtn(p, () => this.game.lock(p)));
        this.actions.append(row);
        this.actions.append(el('span', 'note', 'Wen du anschaust, wenn die Zeit um ist, der zählt.'));
      } else {
        const missing = s.players.filter((p) => p !== me && !s.locked.includes(p)).map((p) => this.nameOf(p));
        if (missing.length) this.actions.append(el('span', 'note', `Es schauen noch: ${list(missing)}`));
      }
      return;
    }
    // reveal
    const r = this.game.shown;
    if (!r) return;
    const head = el('div', 'zd-result');
    head.append(el('span', 'note zd-ask', `Wer würde am ehesten ${r.question}?`));
    if (!r.top.length) head.append(el('strong', 'gg-head', 'Keiner wurde gewählt'));
    else {
      head.append(el('span', 'zd-lead', r.top.length > 1 ? 'Gleichstand' : 'Am ehesten'));
      const names = el('div', 'zd-top');
      for (const p of r.top) names.append(this.colored(p, this.name(p)));
      head.append(names, el('span', 'note', `${r.count} ${r.count === 1 ? 'Stimme' : 'Stimmen'}${r.top.length > 1 ? ' je' : ''}`));
    }
    this.actions.append(head);
    if (!playing) return;
    const mine = r.picks[me];
    const scored = r.count >= ZEIG.minAgree && !!mine && r.top.includes(mine);
    this.actions.append(
      el('span', scored ? 'wi-ok' : 'note', mine ? `Du hast auf ${this.nameOf(mine)} gezeigt${scored ? ` · +${pts(ZEIG.majorityPoints)}` : ''}` : 'Du hast auf niemanden gezeigt'),
    );
    if (r.count > 0 && r.count < ZEIG.minAgree) this.actions.append(el('span', 'note', 'Jeder eine Stimme: keine Punkte.'));
    if (s.ready.includes(me)) this.actions.append(el('span', 'wi-ok', `✓ Bereit (${s.ready.length}/${s.players.length})`));
    else this.actions.append(this.btn('Weiter [Enter]', () => this.game.ready(), 'big'));
  }

  private renderBoard(s: ZeigState): void {
    const b = this.board;
    const phase = s.phase === 'look' ? 'Zeigen' : s.phase === 'reveal' ? 'Aufgedeckt' : 'Runde vorbei';
    b.replaceChildren(el('span', 'eyebrow', `Zeig drauf · Runde ${s.round}`), el('strong', 'wi-phase', phase));
    const ol = el('ol', 'wi-scores');
    for (const id of s.players) {
      const li = el('li');
      li.style.setProperty('--c', hex(this.seatOf(id)));
      li.append(el('span', 'pname', id === this.game.selfId ? `${this.nameOf(id)} (du)` : this.nameOf(id)));
      if (s.phase === 'look') li.append(el('span', s.locked.includes(id) ? 'tag ok' : 'tag', s.locked.includes(id) ? '✓ fertig' : 'schaut'));
      else if (s.phase === 'reveal' && s.ready.includes(id)) li.append(el('span', 'tag ok', '✓ bereit'));
      li.append(el('b', '', num(s.scores[id] ?? 0)));
      ol.append(li);
    }
    b.append(ol);
  }

  private renderDone(s: ZeigState): void {
    const open = s.phase === 'done' && this.closedRound !== s.round;
    if (!open) {
      this.done.hidden = true;
      return;
    }
    const wasHidden = this.done.hidden;
    this.done.hidden = false;
    if (wasHidden) releaseMouse();
    const d = this.done;
    d.replaceChildren(
      el('span', 'eyebrow', `Zeig drauf · Runde ${s.round} vorbei`),
      el('h2', '', s.short ? 'Zu wenige Spieler' : 'Wer würde am ehesten …'),
    );
    const ol = el('ol', 'zd-history');
    for (const h of s.history) ol.append(this.record(h));
    if (s.history.length) d.append(ol);
    else d.append(el('p', 'note', 'Keine Frage wurde fertig gespielt.'));
    const ranked = [...s.players].sort((a, b) => (s.scores[b] ?? 0) - (s.scores[a] ?? 0));
    const sc = el('ol', 'wi-scores zd-final');
    for (const id of ranked) {
      const li = el('li');
      li.style.setProperty('--c', hex(this.seatOf(id)));
      li.append(el('span', 'pname', id === this.game.selfId ? `${this.nameOf(id)} (du)` : this.nameOf(id)), el('b', '', num(s.scores[id] ?? 0)));
      sc.append(li);
    }
    d.append(el('p', 'note', `Wer mit der Mehrheit gezeigt hat, bekam ${pts(ZEIG.majorityPoints)} pro Frage.`), sc);
    const row = el('div', 'row');
    if (this.game.isHost) row.append(this.btn('Neue Runde [G]', () => this.info.start(), 'big'));
    else row.append(el('span', 'note', `${this.info.hostName()} kann eine neue Runde starten.`));
    row.append(this.btn('Schließen', () => this.close(), 'ghost'));
    d.append(row);
  }

  private record(h: ZeigRecord): HTMLElement {
    const li = el('li');
    li.append(el('span', 'zd-q', `… ${h.question}?`));
    const who = el('span', 'zd-who');
    if (!h.top.length) who.append(el('span', 'note', 'keiner'));
    else h.top.forEach((p, i) => {
      if (i) who.append(el('span', 'note', i === h.top.length - 1 ? ' und ' : ', '));
      who.append(this.colored(p));
    });
    if (h.count) who.append(el('span', 'note', ` · ${h.count}`));
    li.append(who);
    return li;
  }

  close(): void {
    const s = this.game.state;
    if (s) this.closedRound = s.round;
    this.done.hidden = true;
    document.body.classList.remove('wi-dialog');
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
    if (e.repeat || !this.visible || !s || typing(e) || !s.players.includes(this.game.selfId)) return;
    if (s.phase === 'look' && (KEYS.lock as readonly string[]).includes(e.code) && !this.game.iLocked && this.game.myPick) {
      e.preventDefault();
      this.game.lock();
    } else if (s.phase === 'reveal' && (KEYS.next as readonly string[]).includes(e.code) && !s.ready.includes(this.game.selfId)) {
      e.preventDefault();
      this.game.ready();
    }
  }
}
