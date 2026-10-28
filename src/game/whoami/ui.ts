import { COLORS, WHOAMI } from '../../config';
import { el, releaseMouse } from '../../ui/dom';
import type { Member } from '../minigame';
import { cardFromBlob, cardFromUrl } from './cardImage';
import type { WhoamiGame } from './game';
import type { Result, Vote } from './logic';

const RESULT_TEXT: Record<Result, string> = { yes: 'Ja', no: 'Nein', idk: 'Weiß nicht', right: 'Richtig!', wrong: 'Falsch' };
const RESULT_SHOW_MS = 3200;

/** Keys while playing, so nobody has to let go of the mouse look to vote. */
const KEYS = { ask: 'KeyF', guess: 'KeyR', pass: 'KeyP', yes: 'Digit1', no: 'Digit2', idk: 'Digit3', start: 'KeyG' } as const;

/** What the round-start prompt needs to know about the room. */
export interface LobbyInfo {
  isHost(): boolean;
  hostName(): string;
  canStart(): boolean;
  start(): void;
  /** Solo benchmark: the round is against bots. */
  solo: boolean;
  /** Why the others might not hear your question (mic off, muted), or null. */
  micWarning(): string | null;
}

/** "1 Punkt", "−1 Punkt", "3 Punkte" with a real minus sign. */
export const pts = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n)} ${Math.abs(n) === 1 ? 'Punkt' : 'Punkte'}`;
const num = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n)}`;
const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} und ${names.at(-1)}`);

const hex = (seat: number) => `#${(COLORS.players[seat] ?? 0x888888).toString(16).padStart(6, '0')}`;

/**
 * Screens of "Wer bin ich?": the card maker, the turn/vote bar at the top, a result banner,
 * the scoreboard and the end of round. Everything reacts to the public game state.
 */
export class WhoamiUi {
  private maker = el('section', 'wi-maker');
  /** Before a round (and after one): who can start, and with which key. */
  private lobby = el('div', 'wi-bar wi-lobby');
  private bar = el('div', 'wi-bar');
  private banner = el('div', 'wi-banner');
  private board = el('aside', 'wi-board');
  private done = el('section', 'wi-done');
  private pending: string | null = null;
  private makerFor: string | null = null;
  private lastResultKey = '';
  private bannerUntil = 0;
  /** Round whose end screen was closed, so the heartbeat doesn't reopen it. */
  private closedRound = -1;

  constructor(
    host: HTMLElement,
    private game: WhoamiGame,
    private members: () => Member[],
    private info: LobbyInfo,
  ) {
    for (const e of [this.maker, this.bar, this.lobby, this.banner, this.board, this.done]) {
      e.hidden = true;
      host.append(e);
    }
    this.bar.setAttribute('role', 'status');
    this.banner.setAttribute('aria-live', 'assertive');
    game.onChange(() => this.render());
    addEventListener('keydown', (e) => this.key(e));
    addEventListener('paste', (e) => this.paste(e));
  }

  private seatOf(id: string | null): number {
    return this.members().find((m) => m.id === id)?.seat ?? -1;
  }

  private name(id: string | null): string {
    return this.game.nameOf(id);
  }

  /** Short message in the middle that rises and fades like an echo (results, the Schaffner). */
  flash(title: string, big: string, tone: 'good' | 'bad' | 'plain' = 'plain', sub = ''): void {
    this.banner.replaceChildren(el('span', 'wi-banner-who', title), el('strong', '', big));
    if (sub) this.banner.append(el('span', 'wi-banner-sub', sub));
    this.banner.dataset.tone = tone;
    this.banner.hidden = false;
    // Restart the animation even if the previous echo is still fading.
    this.banner.classList.remove('echo');
    void this.banner.offsetWidth;
    this.banner.classList.add('echo');
    this.bannerUntil = performance.now() + RESULT_SHOW_MS;
  }

  /** Per frame: countdown, banner timing, round-start prompt. */
  tick(): void {
    const s = this.game.state;
    if (!this.banner.hidden && performance.now() > this.bannerUntil) this.banner.hidden = true;
    this.renderLobby();
    const cd = this.bar.querySelector('.wi-countdown');
    if (cd && s?.vote) cd.textContent = `noch ${Math.ceil(this.game.voteLeftS)} s`;
  }

  private render(): void {
    const s = this.game.state;
    const active = !!s && s.players.length > 0;
    this.board.hidden = !active;
    if (!s) {
      for (const e of [this.maker, this.bar, this.done]) e.hidden = true;
      return;
    }
    this.renderMaker();
    this.renderBar();
    this.renderBoard();
    this.renderDone();
    // Dialogs need the whole attention: the bottom hint steps aside.
    document.body.classList.toggle('wi-dialog', !this.maker.hidden || !this.done.hidden);
    // Result banner, once per new result, with what follows from it.
    const key = s.last ? `${s.round}|${s.last.guesser}|${s.last.kind}|${s.questions[s.last.guesser]}|${s.solved.length}|${s.last.result}` : '';
    if (s.last && key !== this.lastResultKey) {
      this.lastResultKey = key;
      const l = s.last;
      const who = l.guesser === this.game.selfId ? 'Du' : this.name(l.guesser);
      const r = l.result;
      const tone = r === 'yes' || r === 'right' ? 'good' : r === 'no' || r === 'wrong' ? 'bad' : 'plain';
      const title = l.kind === 'guess' ? `${who} ${who === 'Du' ? 'hast' : 'hat'} geraten` : `Frage von ${who}`;
      if (l.timedOut && l.votes === 0) this.flash(title, 'Zeit um', 'plain', `Keiner hat abgestimmt. ${this.after(l.guesser)}`);
      else if (l.kind === 'guess' && r === 'right') {
        const gain = WHOAMI.points[s.solved.indexOf(l.guesser)] ?? WHOAMI.points.at(-1)!;
        this.flash(title, 'Richtig!', 'good', `+${pts(gain)} · ${this.after(l.guesser)}`);
      }
      else this.flash(`${title} · Mehrheit`, RESULT_TEXT[r], tone, this.after(l.guesser));
    }
  }

  /** What happens next after a result: same player again, or whose turn it is now. */
  private after(guesser: string): string {
    const s = this.game.state!;
    if (s.phase === 'done') return 'Die Runde ist vorbei.';
    if (s.turn === guesser) return `${guesser === this.game.selfId ? 'Du darfst' : `${this.name(guesser)} darf`} weiterfragen.`;
    return s.turn === this.game.selfId ? 'Jetzt bist du dran.' : `Jetzt ist ${this.name(s.turn)} dran.`;
  }

  /** The next unsolved player after the one on turn. */
  private nextUp(): string | null {
    const s = this.game.state!;
    if (!s.turn) return null;
    const i = s.players.indexOf(s.turn);
    for (let k = 1; k < s.players.length; k++) {
      const p = s.players[(i + k) % s.players.length];
      if (!s.solved.includes(p)) return p === s.turn ? null : p;
    }
    return null;
  }

  private lobbyKey = '';

  /** "Waiting for players" / "round can start (G)" / "waiting for the host", top centre. */
  private renderLobby(): void {
    const s = this.game.state;
    const idle = !s || (s.phase === 'done' && this.done.hidden);
    const n = this.members().length;
    const host = this.info.isHost();
    const can = this.info.canStart();
    const key = `${idle}|${n}|${host}|${can}|${this.info.hostName()}|${s?.round ?? 0}`;
    if (key === this.lobbyKey) return;
    this.lobbyKey = key;
    this.lobby.hidden = !idle;
    if (!idle) return;
    const l = this.lobby;
    l.replaceChildren(el('strong', '', 'Wer bin ich?'));
    const again = !!s;
    if (host && can) {
      l.append(el('span', '', this.info.solo ? 'Testrunde gegen Bots' : again ? `Noch eine Runde? ${n} im Wagen` : `${n} im Wagen, es kann losgehen`));
      l.append(this.btn(again ? 'Neue Runde [G]' : 'Runde starten [G]', () => this.info.start(), 'big'));
    } else if (host) {
      l.append(el('span', '', 'Warte auf Mitspieler …'), el('span', 'note', 'Link teilen: Esc → Link kopieren'));
    } else {
      l.append(el('span', '', `Warte, bis ${this.info.hostName()} die Runde startet …`));
    }
  }

  private renderMaker(): void {
    const s = this.game.state!;
    const target = this.game.myTarget;
    const open = s.phase === 'cards' && !!target && !this.game.myCardSent;
    this.maker.hidden = !open;
    if (!open) {
      this.makerFor = null;
      return;
    }
    if (this.makerFor === target) return;
    this.makerFor = target;
    this.pending = null;
    // The card maker needs the mouse.
    releaseMouse();
    const m = this.maker;
    m.replaceChildren();
    const head = el('header', 'wi-maker-head');
    const who = el('strong', '', this.name(target));
    who.style.color = hex(this.seatOf(target));
    head.append(el('span', 'eyebrow', 'Wer bin ich? · Karte machen'), el('h2', '', 'Such ein Bild für '), who);
    const drop = el('div', 'wi-drop');
    drop.tabIndex = 0;
    const preview = el('img', 'wi-preview');
    preview.alt = 'Vorschau der Karte';
    preview.hidden = true;
    const hint = el('p', 'wi-drop-hint', 'Bild hierher ziehen oder mit Strg+V einfügen');
    const how = el('p', 'note', `${this.name(target)} sieht das Bild nicht, alle anderen schon. Danach fragt ihr reihum, bis jeder errät, wer oder was er ist.`);
    drop.append(preview, hint);
    const err = el('p', 'err');
    err.setAttribute('role', 'alert');
    const setImage = async (p: Promise<string>) => {
      err.textContent = '';
      hint.textContent = 'Lädt …';
      try {
        this.pending = await p;
        preview.src = this.pending;
        preview.hidden = false;
        hint.hidden = true;
        send.disabled = false;
      } catch (e) {
        hint.textContent = 'Bild hierher ziehen oder mit Strg+V einfügen';
        err.textContent = (e as Error).message;
      }
    };
    this.setImage = setImage;
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
      const url = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
      if (file) void setImage(cardFromBlob(file));
      else if (url) void setImage(cardFromUrl(url));
    });

    const linkRow = el('form', 'row');
    const link = el('input', 'text-input');
    Object.assign(link, { type: 'url', placeholder: 'oder Bild-Link einfügen', id: 'wi-link' });
    link.setAttribute('aria-label', 'Bild-Link');
    const load = el('button', 'btn', 'Laden');
    load.type = 'submit';
    linkRow.addEventListener('submit', (e) => {
      e.preventDefault();
      if (link.value) void setImage(cardFromUrl(link.value));
    });
    const file = el('input');
    Object.assign(file, { type: 'file', accept: 'image/*', id: 'wi-file' });
    file.className = 'sr-only';
    const fileBtn = el('label', 'btn ghost', 'Datei wählen');
    fileBtn.htmlFor = file.id;
    file.addEventListener('change', () => {
      if (file.files?.[0]) void setImage(cardFromBlob(file.files[0]));
    });
    linkRow.append(link, load, fileBtn, file);

    const send = el('button', 'btn big', 'Karte abschicken');
    send.type = 'button';
    send.disabled = true;
    send.addEventListener('click', () => {
      if (this.pending) this.game.submitCard(this.pending);
    });
    m.append(head, how, drop, linkRow, err, el('p', 'note', 'Das Bild bleibt im Speicher und geht direkt an die Mitspieler, nie an die Person selbst und nirgendwo sonst hin.'), send);
    drop.focus();
  }

  private setImage: ((p: Promise<string>) => Promise<void>) | null = null;

  private paste(e: ClipboardEvent): void {
    if (this.maker.hidden || !this.setImage) return;
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    const blob = item?.getAsFile();
    if (blob) {
      e.preventDefault();
      void this.setImage(cardFromBlob(blob));
      return;
    }
    const text = e.clipboardData?.getData('text/plain')?.trim();
    // A pasted link outside the link field loads right away.
    if (text && /^https?:\/\//.test(text) && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      void this.setImage(cardFromUrl(text));
    }
  }

  private renderBar(): void {
    const s = this.game.state!;
    const me = this.game.selfId;
    const b = this.bar;
    b.replaceChildren();
    if (s.phase === 'cards') {
      b.hidden = !this.maker.hidden;
      const missing = s.players.filter((p) => !s.ready.includes(p)).map((p) => this.name(p));
      b.append(el('strong', '', 'Karten machen'), el('span', 'note', `${s.ready.length}/${s.players.length} fertig`));
      const row = el('div', 'wi-actions');
      const target = this.game.myTarget;
      if (this.game.myCardSent && target) row.append(el('span', 'wi-ok', `✓ Deine Karte für ${this.name(target)} ist raus`));
      if (missing.length) row.append(el('span', '', `Es fehlen noch: ${list(missing)}`));
      row.append(el('span', 'note', 'Danach geht die Fragerunde los.'));
      b.append(row);
      return;
    }
    if (s.phase !== 'play') {
      b.hidden = true;
      return;
    }
    b.hidden = false;
    const mine = s.turn === me;
    const title = el('strong', '', mine ? 'Du bist dran' : `${this.name(s.turn)} ist dran`);
    title.style.color = hex(this.seatOf(s.turn));
    b.append(title, el('span', 'note', `${(s.questions[s.turn ?? ''] ?? 0) + 1}. Frage`));
    const row = el('div', 'wi-actions');
    const v = s.vote;
    const voted = !!v && this.game.myVote?.key === this.game.voteKey;
    const missing = v ? s.players.filter((p) => p !== v.guesser && !v.voters.includes(p)).map((p) => (p === me ? 'dir' : this.name(p))) : [];
    if (v && v.guesser !== me && !voted && !v.voters.includes(me) && s.players.includes(me)) {
      // My vote is needed: the most important moment, so the clearest prompt.
      const q = v.kind === 'guess' ? `${this.name(v.guesser)} rät, wer er ist. Stimmt das?` : `${this.name(v.guesser)} hat gefragt. Deine Antwort:`;
      row.append(el('span', 'wi-ask', q));
      const opts: [Vote, string, string][] = v.kind === 'guess' ? [['yes', 'Richtig', '1'], ['no', 'Falsch', '2']] : [['yes', 'Ja', '1'], ['no', 'Nein', '2'], ['idk', 'Weiß nicht', '3']];
      for (const [vote, label, k] of opts) row.append(this.btn(`${label} [${k}]`, () => this.game.vote(vote), 'big'));
      row.append(el('span', 'wi-countdown note'));
    } else if (v) {
      if (v.guesser === me) row.append(el('span', '', v.kind === 'guess' ? 'Die anderen prüfen deinen Tipp …' : 'Die anderen stimmen ab …'));
      else if (this.game.myVote && voted) row.append(el('span', 'wi-ok', `✓ Deine Stimme: ${RESULT_TEXT[this.game.myVote.v === 'yes' && v.kind === 'guess' ? 'right' : this.game.myVote.v === 'no' && v.kind === 'guess' ? 'wrong' : this.game.myVote.v]}`));
      if (missing.length) row.append(el('span', 'note', `Warte auf ${list(missing)}`));
      row.append(el('span', 'wi-countdown note'));
    } else if (mine) {
      row.append(
        this.btn('Frage gestellt [F]', () => this.game.toHost({ a: 'ask' }), 'big'),
        this.btn('Ich rate! [R]', () => this.game.toHost({ a: 'guess' })),
        this.btn('Weitergeben [P]', () => this.game.toHost({ a: 'pass' }), 'ghost'),
      );
      row.append(el('span', 'note', 'Stell laut eine Ja/Nein-Frage über deine Karte, dann F. Oder sag „Ich bin …“ und drück R.'));
      const warn = this.info.micWarning();
      if (warn) row.append(el('span', 'wi-warn', warn));
    } else {
      row.append(el('span', 'note', `${this.name(s.turn)} stellt gleich eine Frage. Du stimmst danach mit 1/2/3 ab.`));
    }
    b.append(row);
    // The last result stays readable after the echo has faded.
    if (!v && s.last) {
      const l = s.last;
      const who = l.guesser === me ? 'Du' : this.name(l.guesser);
      const what = l.timedOut && l.votes === 0 ? 'Zeit um, keiner hat abgestimmt' : `${l.kind === 'guess' ? 'Tipp' : 'Antwort'}: ${RESULT_TEXT[l.result]}`;
      b.append(el('span', 'wi-last', `Zuletzt ${who}: ${what}`));
    }
  }

  private renderBoard(): void {
    const s = this.game.state!;
    const b = this.board;
    const phase = s.phase === 'cards' ? 'Karten machen' : s.phase === 'play' ? 'Fragerunde' : 'Runde vorbei';
    b.replaceChildren(el('span', 'eyebrow', `Wer bin ich? · Runde ${s.round}`), el('strong', 'wi-phase', phase));
    const ol = el('ol', 'wi-scores');
    const next = s.phase === 'play' ? this.nextUp() : null;
    // Turn order, not ranking: you see who's on and who comes next.
    for (const id of s.players) {
      const li = el('li');
      li.classList.toggle('turn', s.turn === id && s.phase === 'play');
      li.style.setProperty('--c', hex(this.seatOf(id)));
      li.append(el('span', 'pname', id === this.game.selfId ? `${this.name(id)} (du)` : this.name(id)));
      if (s.phase === 'cards') li.append(el('span', 'tag', s.ready.includes(id) ? '✓ Karte' : 'macht Karte'));
      else if (s.solved.includes(id)) li.append(el('span', 'tag ok', '✓ gelöst'));
      else if (s.turn === id) li.append(el('span', 'tag hot', 'dran'));
      else if (next === id) li.append(el('span', 'tag', 'als Nächstes'));
      if (s.vote && id !== s.vote.guesser) li.append(el('span', 'tag', s.vote.voters.includes(id) ? '✓' : '…'));
      li.append(el('b', '', num(s.scores[id] ?? 0)));
      ol.append(li);
    }
    b.append(ol);
    // After solving: see what you were.
    const own = this.game.cards.get(this.game.selfId);
    if (own && s.phase !== 'done') {
      const img = el('img', 'wi-own');
      img.src = own;
      img.alt = 'Deine Karte';
      b.append(el('span', 'note', 'Du warst:'), img);
    }
  }

  private renderDone(): void {
    const s = this.game.state!;
    const open = s.phase === 'done' && this.closedRound !== s.round;
    this.done.hidden = !open;
    if (!open) return;
    releaseMouse();
    const d = this.done;
    const ranked = [...s.players].sort((a, b) => (s.scores[b] ?? 0) - (s.scores[a] ?? 0));
    const best = s.scores[ranked[0]] ?? 0;
    const winners = ranked.filter((p) => (s.scores[p] ?? 0) === best);
    const headline = best <= 0 ? 'Keiner hat Punkte geholt' : winners.length > 1 ? `Gleichstand: ${list(winners.map((p) => this.name(p)))}` : `${winners[0] === this.game.selfId ? 'Du gewinnst' : `${this.name(winners[0])} gewinnt`} mit ${best} ${best === 1 ? 'Punkt' : 'Punkten'}`;
    d.replaceChildren(el('span', 'eyebrow', `Wer bin ich? · Runde ${s.round} vorbei`), el('h2', '', headline));
    const grid = el('div', 'wi-reveal');
    for (const id of ranked) {
      const fig = el('figure');
      fig.classList.toggle('me', id === this.game.selfId);
      const card = this.game.cards.get(id);
      if (card) {
        const img = el('img');
        img.src = card;
        img.alt = `Karte von ${this.name(id)}`;
        fig.append(img);
      }
      const cap = el('figcaption', '', `${id === this.game.selfId ? 'Du' : this.name(id)} · ${pts(s.scores[id] ?? 0)}${s.solved.includes(id) ? ' · gelöst' : ''}`);
      cap.style.borderColor = hex(this.seatOf(id));
      fig.append(cap);
      grid.append(fig);
    }
    const row = el('div', 'row');
    if (this.game.isHost) row.append(this.btn('Neue Runde [G]', () => this.info.start(), 'big'));
    else row.append(el('span', 'note', `${this.info.hostName()} kann eine neue Runde starten.`));
    row.append(
      this.btn(
        'Schließen',
        () => {
          this.closedRound = s.round;
          d.hidden = true;
          document.body.classList.remove('wi-dialog');
        },
        'ghost',
      ),
    );
    d.append(el('p', 'note', 'Unter jeder Karte steht, wer sie über dem Kopf hatte.'), grid, row);
  }

  private btn(text: string, onClick: () => void, cls = ''): HTMLButtonElement {
    const b = el('button', `btn ${cls}`.trim(), text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  private key(e: KeyboardEvent): void {
    const s = this.game.state;
    if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === KEYS.start && (!s || s.phase === 'done') && this.info.isHost() && this.info.canStart()) {
      this.closedRound = s?.round ?? -1;
      this.info.start();
      return;
    }
    if (!s || s.phase !== 'play') return;
    const me = this.game.selfId;
    const v = s.vote;
    if (v && v.guesser !== me && !v.voters.includes(me)) {
      const vote: Vote | null = e.code === KEYS.yes ? 'yes' : e.code === KEYS.no ? 'no' : e.code === KEYS.idk && v.kind === 'question' ? 'idk' : null;
      if (vote) this.game.vote(vote);
    } else if (!v && s.turn === me) {
      if (e.code === KEYS.ask) this.game.toHost({ a: 'ask' });
      else if (e.code === KEYS.guess) this.game.toHost({ a: 'guess' });
      else if (e.code === KEYS.pass) this.game.toHost({ a: 'pass' });
    }
  }
}
