import type { PersonState } from '../characters/person';
import { COLORS, NET } from '../config';
import { parseName, NAME_MAX } from '../net/protocol';
import { formatRoomCode, newRoomCode, normalizeRoomCode } from '../net/roomCode';
import { el } from './dom';
import { CharacterEditor } from './editor';
import { randomName } from './names';
import { CharacterPreview } from './preview';
import { SettingsView } from './settingsView';

export type LobbyChoice = { kind: 'create'; code: string } | { kind: 'join'; code: string } | { kind: 'bench' };

/** The one map so far. Kept as data so the menu already separates map, game and character. */
export const MAP = { name: 'Hypertrain', line: 'Linie 7' };

type TabId = 'play' | 'character' | 'settings';

/**
 * Shared frame of main menu and in-game menu: tabs on top, one panel below. The character tab adds
 * the live preview on the side; the other tabs stay a single calm column.
 */
abstract class MenuShell {
  protected root = el('section', 'menu');
  protected panel = el('div', 'menu-panel');
  protected tabs = new Map<TabId, HTMLButtonElement>();
  protected tab: TabId = 'play';
  private body = el('div', 'menu-body');
  private frame!: HTMLElement;
  private me = el('aside', 'menu-me');
  private preview: CharacterPreview | null = null;
  private previewBox = el('div', 'me-preview');
  protected editor: CharacterEditor;
  private settingsView: SettingsView | null = null;
  /** Used when the name field stays empty. */
  protected readonly fallbackName = randomName();

  constructor(
    protected profile: PersonState,
    private onProfile: (p: PersonState) => void,
    playLabel: string,
    title: HTMLElement,
  ) {
    this.root.setAttribute('aria-label', 'Menü');
    const frame = el('div', 'menu-frame');
    this.frame = frame;
    const head = el('header', 'menu-head');
    const nav = el('div', 'tabs');
    nav.setAttribute('role', 'tablist');
    for (const [id, label] of [['play', playLabel], ['character', 'Charakter'], ['settings', 'Einstellungen']] as const) {
      const b = el('button', 'tab', label);
      b.type = 'button';
      b.id = `tab-${id}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', 'menu-panel');
      b.addEventListener('click', () => this.show(id));
      nav.append(b);
      this.tabs.set(id, b);
    }
    nav.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const ids = [...this.tabs.keys()];
      const next = ids[(ids.indexOf(this.tab) + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
      this.show(next);
      this.tabs.get(next)!.focus();
    });
    head.append(title, nav);

    this.panel.id = 'menu-panel';
    this.panel.setAttribute('role', 'tabpanel');
    this.me.append(el('span', 'eyebrow', 'Vorschau · zum Drehen ziehen'), this.previewBox);
    this.body.append(this.panel, this.me);
    frame.append(head, this.body);
    this.root.append(frame);

    this.editor = new CharacterEditor(profile, (p) => this.setProfile(p));
    this.editor.setFallbackName(this.fallbackName);
  }

  protected abstract renderPlay(): void;

  protected setProfile(p: PersonState): void {
    this.profile = p;
    this.preview?.set(p);
    this.onProfile(p);
  }

  /** Name typed in the play tab: same value as the character tab's field. */
  protected setName(name: string): void {
    this.editor.setName(name);
    this.setProfile({ ...this.profile, name });
  }

  protected mount(host: HTMLElement): void {
    host.append(this.root);
  }

  protected unmount(): void {
    this.showPreview(false);
    this.settingsView?.dispose();
    this.settingsView = null;
    this.root.remove();
  }

  get isOpen(): boolean {
    return this.root.isConnected;
  }

  /** The preview has its own WebGL context, so it only exists while the character tab is open. */
  private showPreview(on: boolean): void {
    this.body.classList.toggle('with-me', on);
    this.me.hidden = !on;
    if (on && !this.preview) {
      this.preview = new CharacterPreview(this.profile);
      this.previewBox.append(this.preview.canvas);
    } else if (!on && this.preview) {
      this.preview.dispose();
      this.preview = null;
    }
  }

  show(id: TabId): void {
    this.tab = id;
    this.frame.dataset.tab = id;
    for (const [t, b] of this.tabs) {
      b.setAttribute('aria-selected', String(t === id));
      b.tabIndex = t === id ? 0 : -1;
    }
    this.panel.setAttribute('aria-labelledby', `tab-${id}`);
    this.settingsView?.dispose();
    this.settingsView = null;
    this.panel.replaceChildren();
    this.showPreview(id === 'character');
    if (id === 'play') this.renderPlay();
    else if (id === 'character') this.panel.append(this.editor.root);
    else {
      this.settingsView = new SettingsView(this.settingsExtra());
      this.panel.append(this.settingsView.root);
    }
  }

  /** Extra block at the end of the settings tab (the benchmark in the main menu). */
  protected settingsExtra(): HTMLElement | null {
    return null;
  }

  protected get named(): boolean {
    return parseName(this.profile.name) !== null;
  }
}

/** Start screen: name, create a room or join one by code. Character and settings have their own tabs. */
export class MainMenu extends MenuShell {
  private resolve: ((c: LobbyChoice) => void) | null = null;
  private status: { text: string; actions: HTMLElement[] } | null = null;
  private orphanTimer = 0;

  constructor(host: HTMLElement, profile: PersonState, onProfile: (p: PersonState) => void) {
    super(profile, onProfile, 'Spielen', el('h1', 'brand-name', 'uKnowHeDoesntKnow'));
    this.mount(host);
    this.show('play');
  }

  choose(): Promise<LobbyChoice> {
    return new Promise((r) => (this.resolve = r));
  }

  private pick(c: LobbyChoice): void {
    // Nobody is held up by an empty name field: they get a random one.
    if (!this.named) this.setName(this.fallbackName);
    if (c.kind !== 'bench' && !window.isSecureContext) {
      this.setStatus('Räume brauchen eine sichere Verbindung (https oder localhost). Im LAN: npm run dev:lan.', [this.backButton()]);
      return;
    }
    this.resolve?.(c);
  }

  protected settingsExtra(): HTMLElement {
    const box = el('fieldset', 'group');
    const start = el('button', 'btn', 'Benchmark starten');
    start.type = 'button';
    start.addEventListener('click', () => this.pick({ kind: 'bench' }));
    const row = el('div', 'row');
    row.append(start, el('span', 'note', 'Allein im Wagen mit drei simulierten Mitreisenden. FPS und Grafik live anpassen.'));
    box.append(el('legend', 'group-title', 'Testfahrt'), row);
    return box;
  }

  protected renderPlay(): void {
    const col = el('div', 'play');
    if (this.status) {
      const p = el('p', 'status', this.status.text);
      p.setAttribute('role', 'status');
      const row = el('div', 'row');
      row.append(...this.status.actions);
      col.append(p, row);
      this.panel.append(col);
      return;
    }
    const invite = normalizeRoomCode(location.hash);

    const nameRow = el('div', 'field');
    const nameLabel = el('label', 'field-label', 'Dein Name');
    const name = el('input', 'text-input');
    Object.assign(name, { id: 'play-name', maxLength: NAME_MAX, placeholder: this.fallbackName, autocomplete: 'nickname', spellcheck: false });
    name.value = this.profile.name;
    nameLabel.htmlFor = name.id;
    name.addEventListener('input', () => this.setName(name.value));
    nameRow.append(nameLabel, name);

    const create = el('button', invite ? 'btn ghost' : 'btn big', 'Raum erstellen');
    create.type = 'button';
    create.addEventListener('click', () => this.pick({ kind: 'create', code: newRoomCode() }));

    const form = el('form', 'join');
    // Placeholder shows the format; the label stays for screen readers only, the row is tight.
    const label = el('label', 'sr-only', 'Raumcode');
    const code = el('input', 'text-input code');
    Object.assign(code, { id: 'room-code', placeholder: 'ABCD-EFGH', autocomplete: 'off', spellcheck: false, maxLength: 64 });
    if (invite) code.value = formatRoomCode(invite);
    label.htmlFor = code.id;
    const join = el('button', invite ? 'btn big' : 'btn', 'Beitreten');
    join.type = 'submit';
    const err = el('p', 'err');
    err.setAttribute('role', 'alert');
    form.append(label, code, join);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const c = normalizeRoomCode(code.value);
      if (c) this.pick({ kind: 'join', code: c });
      else err.textContent = `Der Code hat ${NET.codeLength} Zeichen, z. B. ABCD-EFGH.`;
    });

    const map = el('p', 'map-row');
    map.append(el('span', 'field-label', 'Map'), el('span', 'map-name', MAP.name));

    // Create on the left, join by code on the right. With an invite link, joining is the highlighted one.
    const actions = el('div', 'play-actions');
    actions.append(create, el('span', 'or', 'oder'), form);
    if (invite) col.append(nameRow, el('p', 'note', 'Du wurdest eingeladen, der Code ist schon eingetragen.'), actions, err, map);
    else col.append(nameRow, actions, err, map);
    this.panel.append(col);
  }

  /** Waiting for the host. After a while without anyone, offer to open the room yourself. */
  connecting(code: string, onTakeOver: () => void): void {
    this.setStatus(`Verbinde mit Raum ${formatRoomCode(code)} …`, [this.backButton()]);
    clearTimeout(this.orphanTimer);
    this.orphanTimer = window.setTimeout(() => {
      const take = el('button', 'btn', 'Raum selbst eröffnen');
      take.type = 'button';
      take.addEventListener('click', onTakeOver);
      this.setStatus(`Noch niemand im Raum ${formatRoomCode(code)}. Vielleicht ist der Host weg, oder der Code stimmt nicht.`, [take, this.backButton()]);
    }, NET.orphanMs);
  }

  message(text: string): void {
    clearTimeout(this.orphanTimer);
    this.setStatus(text, [this.backButton()]);
  }

  close(): void {
    clearTimeout(this.orphanTimer);
    this.unmount();
  }

  private setStatus(text: string, actions: HTMLElement[]): void {
    this.status = { text, actions };
    this.show('play');
  }

  /** Leaving a Trystero room cleanly and starting over is simplest as a fresh page. */
  private backButton(): HTMLButtonElement {
    const b = el('button', 'btn ghost', 'Zurück');
    b.type = 'button';
    b.addEventListener('click', () => {
      history.replaceState(null, '', location.pathname + location.search);
      location.reload();
    });
    return b;
  }
}

export interface RoomInfo {
  code: string;
  role: 'host' | 'client';
  rttMs: number;
  players: { id: string; name: string; seat: number; me: boolean; host: boolean }[];
}

/** Per-player voice volume, from the voice engine. */
export interface VolumeControl {
  get(id: string): number;
  set(id: string, v: number): void;
}

/** Esc menu in the game, like in Minecraft: the game keeps running behind it (it's multiplayer). */
export class PauseMenu extends MenuShell {
  private room: RoomInfo | null = null;
  onResume: () => void = () => {};
  volume: VolumeControl | null = null;

  constructor(
    private host: HTMLElement,
    profile: PersonState,
    onProfile: (p: PersonState) => void,
    private bench = false,
  ) {
    const title = el('div', 'brand');
    title.append(el('span', 'brand-kicker', `Map · ${MAP.name}`), el('h1', 'brand-name small', 'Menü'));
    super(profile, onProfile, 'Spiel', title);
    this.root.classList.add('pause');
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    });
  }

  open(): void {
    if (this.isOpen) return;
    this.mount(this.host);
    this.show('play');
    this.tabs.get('play')!.focus();
  }

  close(): void {
    if (this.isOpen) this.unmount();
  }

  setRoom(info: RoomInfo | null): void {
    this.room = info;
    // Don't rebuild while someone drags a volume slider.
    if (this.isOpen && this.tab === 'play' && !this.panel.contains(document.activeElement)) this.show('play');
  }

  private volSlider(id: string, name: string): HTMLElement {
    const box = el('label', 'vol');
    const input = el('input');
    Object.assign(input, { type: 'range', min: '0', max: '1.5', step: '0.05' });
    input.value = String(this.volume!.get(id));
    input.setAttribute('aria-label', `Lautstärke ${name || 'Mitspieler'}`);
    const out = el('output', 'note', `${Math.round(+input.value * 100)} %`);
    input.addEventListener('input', () => {
      this.volume!.set(id, +input.value);
      out.textContent = `${Math.round(+input.value * 100)} %`;
    });
    box.append(input, out);
    return box;
  }

  protected renderPlay(): void {
    const resume = el('button', 'btn big', 'Zurück ins Spiel');
    resume.type = 'button';
    resume.addEventListener('click', () => this.onResume());
    const top = el('div', 'row');
    top.append(resume);
    this.panel.append(top);

    const r = this.room;
    const sec = el('div', 'room-box');
    if (r) {
      const copy = el('button', 'btn', 'Link kopieren');
      copy.type = 'button';
      copy.addEventListener('click', () => {
        void navigator.clipboard?.writeText(location.href).then(
          () => flash(copy, 'Kopiert'),
          () => flash(copy, 'Geht nicht'),
        );
      });
      const codeRow = el('div', 'row');
      codeRow.append(el('span', 'room-code', formatRoomCode(r.code)), copy);
      const list = el('ul', 'players');
      for (const p of [...r.players].sort((a, b) => NET.seatOrder.indexOf(a.seat) - NET.seatOrder.indexOf(b.seat))) {
        const li = el('li');
        li.style.setProperty('--c', `#${COLORS.players[p.seat].toString(16).padStart(6, '0')}`);
        li.append(el('span', 'pname', p.name || 'Ohne Namen'));
        if (p.me) li.append(el('span', 'tag', 'Du'));
        if (p.host) li.append(el('span', 'tag', 'Host'));
        if (!p.me && this.volume) li.append(this.volSlider(p.id, p.name));
        list.append(li);
      }
      const meta = [`${r.players.length}/${NET.maxPlayers} im Wagen`, r.role === 'host' ? 'du bist Host' : 'du bist Gast'];
      if (r.role === 'client' && Number.isFinite(r.rttMs)) meta.push(`Ping ${Math.round(r.rttMs)} ms`);
      sec.append(el('span', 'eyebrow', 'Raum'), codeRow, list, el('p', 'note', meta.join(' · ')));
    } else {
      sec.append(el('span', 'eyebrow', this.bench ? 'Benchmark' : 'Allein'), el('p', 'note', 'Ohne Netzwerk, die drei Mitreisenden sind simuliert.'));
    }
    this.panel.append(sec);

    const help = el('dl', 'keys');
    const keys = [
      ['Maus', 'umsehen (erst ins Bild klicken)'],
      ['Rechte Maustaste', 'heranzoomen'],
      ['M', 'Mikro stumm an/aus'],
      ['V', 'halten zum Sprechen (bei Push-to-talk)'],
      ['Esc', 'dieses Menü'],
    ];
    for (const [k, v] of keys) help.append(el('dt', '', k), el('dd', '', v));
    this.panel.append(help);

    const leave = el('button', 'btn ghost danger', r ? 'Raum verlassen' : 'Zum Hauptmenü');
    leave.type = 'button';
    leave.addEventListener('click', () => {
      history.replaceState(null, '', location.pathname + location.search);
      location.reload();
    });
    const bottom = el('div', 'row end');
    bottom.append(leave);
    this.panel.append(bottom);
  }
}

function flash(b: HTMLButtonElement, text: string): void {
  const old = b.textContent;
  b.textContent = text;
  setTimeout(() => (b.textContent = old), 1400);
}
