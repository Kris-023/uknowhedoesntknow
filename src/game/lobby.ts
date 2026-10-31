import { AHNUNG, ZEIG } from '../config';
import { el } from '../ui/dom';

export type GameId = 'whoami' | 'sags' | 'gleich' | 'zeig' | 'ahnungslos';

export interface GameInfo {
  id: GameId;
  title: string;
  blurb: string;
  /** Fewest players a round can start with. */
  min: number;
}

export const GAMES: readonly GameInfo[] = [
  { id: 'whoami', title: 'Wer bin ich?', blurb: 'Bild über dem Kopf, Ja/Nein-Fragen, geheime Abstimmung.', min: 2 },
  { id: 'sags', title: "Sag's anders", blurb: 'Wort erklären, ohne die verbotenen Wörter.', min: 2 },
  { id: 'gleich', title: 'Gleich gedacht', blurb: 'Alle schreiben ein Wort, bis alle dasselbe denken. Ohne Absprache.', min: 2 },
  { id: 'zeig', title: 'Zeig drauf', blurb: 'Wer würde am ehesten …? Alle zeigen gleichzeitig, mit dem Blick.', min: ZEIG.minPlayers },
  { id: 'ahnungslos', title: 'Ahnungslos', blurb: 'Alle kennen das Wort, nur einer nicht. Reihum ein Wort dazu, dann: Wer ist ahnungslos?', min: AHNUNG.minPlayers },
];

/** "zwei", "drei" … for "Mindestens drei Spieler." */
export const countWord = (n: number) => ['null', 'ein', 'zwei', 'drei', 'vier'][n] ?? String(n);

export interface LobbyRoom {
  isHost(): boolean;
  hostName(): string;
  players(): number;
  /** No round running and no end screen open. */
  idle(): boolean;
  /** Solo benchmark: rounds are against bots. */
  solo: boolean;
  start(id: GameId): void;
}

/** Keys: G starts the chosen game, T switches it (the host keeps the mouse look). */
const KEYS = { start: 'KeyG', next: 'KeyT' } as const;

/**
 * Top bar between rounds: which minigame is next and who can start it. The host picks the game;
 * the others just see whom they're waiting for.
 */
export class GameLobby {
  private root = el('div', 'wi-bar wi-lobby');
  private key = '';
  selected: GameId = 'whoami';

  constructor(
    host: HTMLElement,
    private room: LobbyRoom,
  ) {
    this.root.hidden = true;
    host.append(this.root);
    addEventListener('keydown', (e) => {
      if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (!this.room.idle() || !this.room.isHost()) return;
      if (e.code === KEYS.next) this.pick(GAMES[(GAMES.findIndex((g) => g.id === this.selected) + 1) % GAMES.length].id);
      else if (e.code === KEYS.start && this.canStart) this.room.start(this.selected);
    });
  }

  private get game(): GameInfo {
    return GAMES.find((g) => g.id === this.selected)!;
  }

  private get canStart(): boolean {
    return this.room.players() >= this.game.min;
  }

  pick(id: GameId): void {
    this.selected = id;
    this.key = '';
    this.update();
  }

  /** Per frame; rebuilds only when something it shows changed. */
  update(): void {
    const r = this.room;
    const idle = r.idle();
    const key = `${idle}|${r.players()}|${r.isHost()}|${r.hostName()}|${this.selected}`;
    if (key === this.key) return;
    this.key = key;
    this.root.hidden = !idle;
    if (!idle) return;
    const l = this.root;
    l.replaceChildren();
    if (!r.isHost()) {
      l.append(el('strong', '', 'Minigame'), el('span', '', `Warte, bis ${r.hostName()} ein Spiel startet …`));
      return;
    }
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Minigame');
    for (const g of GAMES) {
      const b = el('button', '', g.title);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(g.id === this.selected));
      b.addEventListener('click', () => this.pick(g.id));
      seg.append(b);
    }
    l.append(seg);
    const game = this.game;
    const row = el('div', 'wi-actions');
    if (this.canStart) {
      row.append(el('span', 'note', r.solo ? `Testrunde gegen Bots · ${game.blurb}` : `${r.players()} im Raum · ${game.blurb}`));
      const b = el('button', 'btn big', 'Runde starten [G]');
      b.type = 'button';
      b.addEventListener('click', () => r.start(this.selected));
      row.append(b, el('span', 'note', 'T wechselt das Spiel'));
    } else if (r.players() >= 2) row.append(el('span', '', `${game.title}: mindestens ${countWord(game.min)} Spieler.`), el('span', 'note', 'T wechselt das Spiel · Link teilen: Esc → Link kopieren'));
    else row.append(el('span', '', 'Warte auf Mitspieler …'), el('span', 'note', 'Link teilen: Esc → Link kopieren'));
    l.append(row);
  }
}
