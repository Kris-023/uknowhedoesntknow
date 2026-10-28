import { NET } from '../config';
import { formatRoomCode, newRoomCode, normalizeRoomCode } from '../net/roomCode';

export type LobbyChoice = { kind: 'create'; code: string } | { kind: 'join'; code: string } | { kind: 'solo' };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/**
 * Start screen: create a room, join one by code (or via a shared link with #code), or test solo
 * with fake players. Afterwards it shows the connection state until the host has welcomed us.
 */
export class Lobby {
  private root = el('section', 'lobby');
  private card = el('div', 'lobby-card');
  private orphanTimer = 0;

  constructor(host: HTMLElement) {
    this.root.setAttribute('aria-label', 'Lobby');
    this.root.append(this.card);
    host.append(this.root);
  }

  choose(): Promise<LobbyChoice> {
    return new Promise((resolve) => {
      this.card.replaceChildren();
      this.head();
      const create = el('button', 'btn big', 'Raum erstellen');
      create.type = 'button';
      create.addEventListener('click', () => (online() ? resolve({ kind: 'create', code: newRoomCode() }) : undefined));

      const form = el('form', 'lobby-join');
      const label = el('label', 'ctl-label', 'Raumcode');
      const input = el('input');
      Object.assign(input, { id: 'room-code', placeholder: 'ABCD-EFGH', autocomplete: 'off', spellcheck: false, maxLength: 64 });
      label.htmlFor = input.id;
      const join = el('button', 'btn', 'Beitreten');
      join.type = 'submit';
      const err = el('p', 'lobby-err');
      err.setAttribute('role', 'alert');
      form.append(label, input, join);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const code = normalizeRoomCode(input.value);
        if (!online()) return;
        if (code) resolve({ kind: 'join', code });
        else err.textContent = `Der Code hat ${NET.codeLength} Zeichen, z. B. ABCD-EFGH.`;
      });

      // Trystero encrypts the handshake with WebCrypto, which only exists on https or localhost.
      const online = () => {
        if (window.isSecureContext) return true;
        err.textContent = 'Räume brauchen eine sichere Verbindung (https oder localhost). Im LAN: npm run dev:lan.';
        return false;
      };

      const solo = el('button', 'btn ghost', 'Allein testen');
      solo.type = 'button';
      solo.addEventListener('click', () => resolve({ kind: 'solo' }));
      const soloRow = el('div', 'lobby-solo');
      soloRow.append(solo, el('span', 'lobby-note', 'mit drei simulierten Mitreisenden'));

      this.card.append(create, el('div', 'lobby-or', 'oder'), form, err, soloRow, this.footnote());

      // A shared link carries the code after #: prefill it, so joining is one click.
      const linked = normalizeRoomCode(location.hash);
      if (linked) {
        input.value = formatRoomCode(linked);
        join.focus();
      } else create.focus();
    });
  }

  /** Waiting for the host. After a while without anyone, offer to open the room yourself. */
  connecting(code: string, onTakeOver: () => void): void {
    this.card.replaceChildren();
    this.head();
    const status = el('p', 'lobby-status', `Verbinde mit Raum ${formatRoomCode(code)} …`);
    status.setAttribute('role', 'status');
    const actions = el('div', 'lobby-solo');
    actions.append(this.backButton());
    this.card.append(status, actions, this.footnote());
    clearTimeout(this.orphanTimer);
    this.orphanTimer = window.setTimeout(() => {
      status.textContent = `Noch niemand im Raum ${formatRoomCode(code)}. Vielleicht ist der Host weg, oder der Code stimmt nicht.`;
      const take = el('button', 'btn', 'Raum selbst eröffnen');
      take.type = 'button';
      take.addEventListener('click', onTakeOver);
      actions.prepend(take);
    }, NET.orphanMs);
  }

  message(text: string): void {
    clearTimeout(this.orphanTimer);
    this.card.replaceChildren();
    this.head();
    const p = el('p', 'lobby-status', text);
    p.setAttribute('role', 'alert');
    this.card.append(p, this.backButton());
  }

  hide(): void {
    clearTimeout(this.orphanTimer);
    this.root.remove();
  }

  private head(): void {
    this.card.append(el('span', 'eyebrow', 'Linie 7 · Hypertrain'), el('h1', 'lobby-title', 'uKnowHeDoesntKnow'));
  }

  private footnote(): HTMLElement {
    return el(
      'p',
      'lobby-foot',
      'Nur für Freunde: Wer den Raumcode kennt, kommt rein. Ihr seid direkt zwischen euren Browsern verbunden, ohne eigenen Server.',
    );
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

/** In-game corner badge: room code, copy link, players, role and ping. */
export class RoomBadge {
  private root = el('div', 'room');
  private info = el('span', 'room-info');

  constructor(host: HTMLElement, code: string) {
    const label = el('span', 'room-code', formatRoomCode(code));
    const copy = el('button', 'btn', 'Link kopieren');
    copy.type = 'button';
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(location.href).then(
        () => this.flash(copy, 'Kopiert'),
        () => this.flash(copy, 'Geht nicht'),
      );
    });
    this.root.append(el('span', 'ctl-label', 'Raum'), label, copy, this.info);
    host.append(this.root);
  }

  update(players: number, role: 'host' | 'client', rttMs: number): void {
    const parts = [`${players}/${NET.maxPlayers}`, role === 'host' ? 'Host' : 'Gast'];
    if (role === 'client' && Number.isFinite(rttMs)) parts.push(`${Math.round(rttMs)} ms`);
    this.info.textContent = parts.join(' · ');
  }

  private flash(b: HTMLButtonElement, text: string): void {
    const old = b.textContent;
    b.textContent = text;
    setTimeout(() => (b.textContent = old), 1400);
  }
}
