import { el } from '../ui/dom';

export type GameId = 'whoami' | 'sags';

export const GAMES: readonly { id: GameId; title: string; blurb: string }[] = [
  { id: 'whoami', title: 'Wer bin ich?', blurb: 'Bild über dem Kopf, Ja/Nein-Fragen, geheime Abstimmung.' },
  { id: 'sags', title: "Sag's anders", blurb: 'Wort erklären, ohne die verbotenen Wörter.' },
];

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

  private get canStart(): boolean {
    return this.room.players() >= 2;
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
    const game = GAMES.find((g) => g.id === this.selected)!;
    const row = el('div', 'wi-actions');
    if (this.canStart) {
      row.append(el('span', 'note', r.solo ? `Testrunde gegen Bots · ${game.blurb}` : `${r.players()} im Raum · ${game.blurb}`));
      const b = el('button', 'btn big', 'Runde starten [G]');
      b.type = 'button';
      b.addEventListener('click', () => r.start(this.selected));
      row.append(b, el('span', 'note', 'T wechselt das Spiel'));
    } else row.append(el('span', '', 'Warte auf Mitspieler …'), el('span', 'note', 'Link teilen: Esc → Link kopieren'));
    l.append(row);
  }
}
