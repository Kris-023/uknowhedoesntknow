import { COLORS } from '../../config';
import { el, releaseMouse } from '../../ui/dom';
import { adoptCard, hasWord } from '../../words/custom';
import { DECK_NAMES } from '../../words';
import type { WordCard } from '../../words/types';
import type { Member } from '../minigame';
import { pts } from '../whoami/ui';
import type { SagsGame } from './game';
import { guessersOf, teamOf, teamScore, watchersOf, type Played, type SagsState } from './logic';

/** Keys while playing, so nobody has to let go of the mouse look. Digits pick who guessed (free for all). */
const KEYS = { go: 'Space', skip: 'KeyP', foul: 'KeyB' } as const;
const DIGITS = ['Digit1', 'Digit2', 'Digit3'];
const TEAM_NAMES = ['Team Blau', 'Team Gelb'] as const;
const TEAM_COLORS = ['#4fd8ff', '#ffb224'] as const;

const hex = (seat: number) => `#${(COLORS.players[seat] ?? 0x888888).toString(16).padStart(6, '0')}`;
const num = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n)}`;

export interface SagsUiInfo {
  hostName(): string;
  start(): void;
  /** Result echo in the middle, shared with the other game and the Schaffner. */
  flash(title: string, big: string, tone?: 'good' | 'bad' | 'plain', sub?: string): void;
  /** Why the others might not hear you (mic off, muted), or null. */
  micWarning(): string | null;
}

/**
 * Screens of "Sag's anders": the turn bar with the card at the top, the scoreboard, a result echo
 * per card, the challenge window (free for all) and the end of round with every played card.
 */
export class SagsUi {
  private bar = el('div', 'wi-bar sa-bar');
  private board = el('aside', 'wi-board');
  private done = el('section', 'wi-done sa-done');
  /** Card number → result already echoed. */
  private echoed = new Map<number, string>();
  private lastRound = -1;
  private closedRound = -1;
  private barKey = '';

  constructor(
    host: HTMLElement,
    private game: SagsGame,
    private members: () => Member[],
    private info: SagsUiInfo,
  ) {
    for (const e of [this.bar, this.board, this.done]) {
      e.hidden = true;
      host.append(e);
    }
    this.bar.setAttribute('role', 'status');
    game.onChange(() => this.render());
    addEventListener('keydown', (e) => this.key(e));
  }

  /** End-of-round screen is open (the lobby waits until it's closed). */
  get doneOpen(): boolean {
    return !this.done.hidden;
  }

  private seatOf(id: string | null): number {
    return this.members().find((m) => m.id === id)?.seat ?? -1;
  }

  private name(id: string | null): string {
    return id === this.game.selfId ? 'Du' : this.game.nameOf(id);
  }

  private colored(id: string | null, text = this.name(id)): HTMLElement {
    const s = el('strong', '', text);
    s.style.color = hex(this.seatOf(id));
    return s;
  }

  /** Per frame: countdowns. The rest follows the game state. */
  tick(): void {
    const s = this.game.state;
    if (!s || s.phase === 'done' || !this.visible) return;
    const key = `${Math.ceil(this.game.turnLeftS)}|${this.challengeable()?.no ?? ''}|${Math.ceil(this.challengeLeft())}`;
    if (key !== this.barKey) this.renderBar();
  }

  private visible = true;

  /** Only the game played last shows its screens; the other one steps aside. */
  set shown(on: boolean) {
    this.visible = on;
    this.render();
  }

  private render(): void {
    const s = this.game.state;
    if (!this.visible) {
      for (const e of [this.bar, this.board, this.done]) e.hidden = true;
      return;
    }
    this.board.hidden = !s;
    if (!s) {
      this.bar.hidden = this.done.hidden = true;
      return;
    }
    if (s.round !== this.lastRound) {
      this.lastRound = s.round;
      this.echoed.clear();
    }
    // One echo per played card, and again when a challenge turns it into a foul.
    let news: Played | null = null;
    for (const p of s.log) {
      if (this.echoed.get(p.no) === p.result) continue;
      this.echoed.set(p.no, p.result);
      news = p;
    }
    if (news) this.echo(news);
    this.renderBar();
    this.renderBoard();
    this.renderDone();
    document.body.classList.toggle('wi-dialog', !this.done.hidden);
  }

  private echo(p: Played): void {
    const w = p.card.word;
    if (p.result === 'got') this.info.flash(`${w} · erklärt von ${this.name(p.explainer)}`, 'Erraten!', 'good', p.guesser ? `${this.name(p.guesser)} ${p.guesser === this.game.selfId ? 'hast' : 'hat'} es` : '');
    else if (p.result === 'skip') this.info.flash(`${w} · ${this.name(p.explainer)}`, 'Übersprungen', 'plain');
    else this.info.flash(`${w} · ${this.name(p.explainer)}`, 'Verbotenes Wort!', 'bad', `angefochten von ${this.name(p.foulBy)}`);
  }

  /** Free for all: the last played card, while anyone but its explainer may still challenge it. */
  private challengeable(): Played | null {
    const s = this.game.state;
    const p = s?.log.at(-1);
    if (!s || s.mode !== 'ffa' || !p || p.result === 'foul' || p.explainer === this.game.selfId || !s.players.includes(this.game.selfId)) return null;
    return this.game.challengeLeftS(p.at) > 0 ? p : null;
  }

  private challengeLeft(): number {
    const p = this.challengeable();
    return p ? this.game.challengeLeftS(p.at) : 0;
  }

  private cardView(card: WordCard, small = false): HTMLElement {
    const c = el('div', small ? 'sa-card small' : 'sa-card');
    c.append(el('strong', 'sa-word', card.word));
    const ul = el('ul', 'sa-taboo');
    for (const t of card.taboo) ul.append(el('li', '', t));
    c.append(ul);
    const from = card.by ? `${DECK_NAMES.custom} · von ${card.by.name}` : DECK_NAMES[card.deck];
    c.append(el('span', 'sa-deck', from));
    return c;
  }

  private renderBar(): void {
    const s = this.game.state;
    const b = this.bar;
    this.barKey = `${Math.ceil(this.game.turnLeftS)}|${this.challengeable()?.no ?? ''}|${Math.ceil(this.challengeLeft())}`;
    if (!s || s.phase === 'done') {
      b.hidden = true;
      return;
    }
    b.hidden = false;
    b.replaceChildren();
    const me = this.game.selfId;
    const ex = s.explainer;
    const mine = ex === me;
    const playing = s.players.includes(me);
    const head = el('div', 'sa-head');
    head.append(el('span', 'eyebrow', `Sag's anders · Zug ${Math.min(s.turnNo + 1, s.turns)}/${s.turns}`));
    if (s.phase === 'turn') head.append(el('span', 'sa-timer', `${Math.ceil(this.game.turnLeftS)} s`));
    b.append(head);
    const row = el('div', 'wi-actions');
    const role = !ex || !playing ? 'watch' : mine ? 'explain' : watchersOf(s, ex).includes(me) ? 'guard' : 'guess';

    if (s.phase === 'ready') {
      if (mine) {
        row.append(el('span', 'wi-ask', `Du erklärst. ${s.mode === 'teams' ? `${this.list(guessersOf(s, me))} rät.` : 'Alle anderen raten.'}`));
        row.append(this.btn('Los geht’s [Leertaste]', () => this.game.begin(), 'big'));
        const warn = this.info.micWarning();
        if (warn) row.append(el('span', 'wi-warn', warn));
      } else {
        row.append(this.colored(ex), el('span', '', 'erklärt als Nächstes.'));
        row.append(el('span', 'note', role === 'guard' ? 'Du siehst die Karte und passt auf verbotene Wörter auf.' : role === 'guess' ? 'Du rätst laut mit.' : ''));
      }
    } else if (role === 'explain') {
      if (this.game.hand) b.append(this.cardView(this.game.hand.card));
      if (s.mode === 'teams') row.append(this.btn('Erraten [Leertaste]', () => this.game.got(null), 'big'));
      else guessersOf(s, me).forEach((g, i) => {
        const btn = this.btn(`${this.game.nameOf(g)} hat’s [${i + 1}]`, () => this.game.got(g), 'big');
        btn.style.borderColor = hex(this.seatOf(g));
        row.append(btn);
      });
      row.append(this.btn('Überspringen [P]', () => this.game.skip(), 'ghost'));
      row.append(el('span', 'note', 'Erklär das Wort, ohne es oder die roten Wörter zu sagen.'));
    } else if (role === 'guard') {
      if (this.game.seen) b.append(this.cardView(this.game.seen.card));
      row.append(this.colored(ex), el('span', '', 'erklärt.'));
      row.append(this.btn('Verbotenes Wort! [B]', () => this.game.foul(), 'big danger'));
    } else {
      row.append(this.colored(ex), el('span', '', role === 'guess' ? 'erklärt. Rate laut!' : 'erklärt.'));
    }
    b.append(row);

    // Free for all: the card that was just played, for everyone to check.
    const p = this.challengeable();
    if (p) {
      const ch = el('div', 'sa-challenge');
      ch.append(el('span', 'note', `Die Karte von ${this.name(p.explainer)} war:`), this.cardView(p.card, true));
      ch.append(this.btn(`Anfechten [B] · noch ${Math.ceil(this.challengeLeft())} s`, () => this.game.challenge(p.no), 'danger'));
      b.append(ch);
    }
  }

  private list(ids: string[]): string {
    return ids.map((i) => this.game.nameOf(i)).join(' und ');
  }

  private renderBoard(): void {
    const s = this.game.state!;
    const b = this.board;
    b.replaceChildren(el('span', 'eyebrow', `Sag's anders · Runde ${s.round}`), el('strong', 'wi-phase', s.phase === 'done' ? 'Runde vorbei' : s.mode === 'teams' ? 'Zwei Teams' : 'Jeder gegen jeden'));
    const groups: { title: string | null; color: string | null; ids: string[] }[] = s.teams
      ? s.teams.map((ids, t) => ({ title: `${TEAM_NAMES[t]} · ${num(teamScore(s, t as 0 | 1))}`, color: TEAM_COLORS[t], ids }))
      : [{ title: null, color: null, ids: s.players }];
    for (const g of groups) {
      if (g.title) {
        const h = el('span', 'sa-team', g.title);
        h.style.color = g.color!;
        b.append(h);
      }
      const ol = el('ol', 'wi-scores');
      for (const id of g.ids) {
        const li = el('li');
        li.classList.toggle('turn', s.explainer === id);
        li.style.setProperty('--c', hex(this.seatOf(id)));
        li.append(el('span', 'pname', id === this.game.selfId ? `${this.game.nameOf(id)} (du)` : this.game.nameOf(id)));
        if (s.explainer === id) li.append(el('span', 'tag hot', 'erklärt'));
        li.append(el('b', '', num(s.scores[id] ?? 0)));
        ol.append(li);
      }
      b.append(ol);
    }
  }

  private renderDone(): void {
    const s = this.game.state!;
    const open = s.phase === 'done' && this.closedRound !== s.round;
    this.done.hidden = !open;
    if (!open) return;
    releaseMouse();
    const d = this.done;
    d.replaceChildren(el('span', 'eyebrow', `Sag's anders · Runde ${s.round} vorbei`), el('h2', '', this.headline(s)));
    const list = el('ol', 'sa-log');
    for (const p of s.log) {
      const li = el('li');
      li.dataset.result = p.result;
      const what = p.result === 'got' ? (p.guesser ? `erraten von ${this.name(p.guesser)}` : 'erraten') : p.result === 'skip' ? 'übersprungen' : `verbotenes Wort (${this.name(p.foulBy)})`;
      li.append(el('strong', '', p.card.word), el('span', 'note', `${this.name(p.explainer)} · ${what}`));
      li.title = `Verboten: ${p.card.taboo.join(', ')}`;
      // Someone else's submission: keep it for later games.
      if (p.card.deck === 'custom' && p.card.by) {
        const have = hasWord(p.card.word);
        const btn = this.btn(have ? '✓ In deiner Liste' : 'Übernehmen', () => {
          if (adoptCard(p.card)) {
            btn.textContent = '✓ Übernommen';
            btn.disabled = true;
          }
        }, 'ghost small');
        btn.disabled = have;
        li.append(btn);
      }
      list.append(li);
    }
    if (!s.log.length) list.append(el('li', 'note', 'Keine Karte gespielt.'));
    const row = el('div', 'row');
    if (this.game.isHost) row.append(this.btn('Neue Runde [G]', () => this.info.start(), 'big'));
    else row.append(el('span', 'note', `${this.info.hostName()} kann eine neue Runde starten.`));
    row.append(this.btn('Schließen', () => this.close(), 'ghost'));
    d.append(list, row);
  }

  close(): void {
    const s = this.game.state;
    if (s) this.closedRound = s.round;
    this.done.hidden = true;
    document.body.classList.remove('wi-dialog');
  }

  private headline(s: SagsState): string {
    if (s.teams) {
      const [a, b] = [teamScore(s, 0), teamScore(s, 1)];
      if (a === b) return `Unentschieden, ${pts(a)} je Team`;
      const t = a > b ? 0 : 1;
      const mineT = teamOf(s, this.game.selfId);
      return `${mineT === t ? 'Dein Team gewinnt' : `${TEAM_NAMES[t]} gewinnt`} ${Math.max(a, b)} zu ${Math.min(a, b)}`;
    }
    const ranked = [...s.players].sort((x, y) => (s.scores[y] ?? 0) - (s.scores[x] ?? 0));
    const best = s.scores[ranked[0]] ?? 0;
    const winners = ranked.filter((p) => (s.scores[p] ?? 0) === best);
    if (best <= 0) return 'Keiner hat Punkte geholt';
    if (winners.length > 1) return `Gleichstand mit ${pts(best)}`;
    return `${winners[0] === this.game.selfId ? 'Du gewinnst' : `${this.game.nameOf(winners[0])} gewinnt`} mit ${pts(best)}`;
  }

  private btn(text: string, onClick: () => void, cls = ''): HTMLButtonElement {
    const b = el('button', `btn ${cls}`.trim(), text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  private key(e: KeyboardEvent): void {
    const s = this.game.state;
    if (e.repeat || !s || s.phase === 'done' || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const me = this.game.selfId;
    if (e.code === KEYS.foul) {
      const p = this.challengeable();
      if (s.phase === 'turn' && this.game.seen) this.game.foul();
      else if (p) this.game.challenge(p.no);
      return;
    }
    if (s.explainer !== me) return;
    if (e.code === KEYS.go) {
      e.preventDefault();
      if (s.phase === 'ready') this.game.begin();
      else if (s.mode === 'teams') this.game.got(null);
    } else if (s.phase === 'turn' && e.code === KEYS.skip) this.game.skip();
    else if (s.phase === 'turn' && s.mode === 'ffa') {
      const i = DIGITS.indexOf(e.code);
      const g = guessersOf(s, me)[i];
      if (g) this.game.got(g);
    }
  }
}
