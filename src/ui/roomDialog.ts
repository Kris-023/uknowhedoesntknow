import { ROOM } from '../config';
import type { RoomOpts, SchaffnerMode } from '../net/protocol';
import { DECK_NAMES } from '../words';
import { DECK_IDS, type DeckId } from '../words/types';
import { el } from './dom';

/** One-line summary for guests, who see the host's settings but can't change them. */
export function roomSummary(o: RoomOpts): string {
  const sf: Record<SchaffnerMode, string> = { off: 'Schaffner aus', warn: 'Schaffner ermahnt nur', fine: 'Schaffner mit Punktabzug' };
  const decks = o.decks.length ? o.decks.map((d) => DECK_NAMES[d]).join('/') : DECK_NAMES.normal;
  return [o.voice ? 'Sprachchat an' : 'ohne Sprachchat', sf[o.schaffner], `Abstimmung ${o.voteS} s`, o.blackouts ? 'mit Stromausfällen' : 'ohne Stromausfälle', `Wörter ${decks}, ${o.turnS} s pro Zug`, o.sagsTeams ? 'zu viert in Teams' : 'jeder gegen jeden'].join(' · ');
}

/**
 * Room settings as a modal dialog: before creating a room (saved for next time) and for the host
 * in the Esc menu (applies to everyone at once). Every click is applied immediately.
 */
export function openRoomDialog(host: HTMLElement, current: RoomOpts, onChange: (o: RoomOpts) => void, title = 'Raum-Einstellungen'): void {
  let opts = { ...current };
  const dlg = el('dialog', 'room-dialog');
  dlg.setAttribute('aria-label', title);
  const syncs: (() => void)[] = [];
  const set = (patch: Partial<RoomOpts>) => {
    opts = { ...opts, ...patch };
    onChange(opts);
    for (const f of syncs) f();
  };
  const seg = <K extends keyof RoomOpts>(label: string, key: K, choices: readonly (readonly [string, RoomOpts[K]])[], hint: string) => {
    const row = el('div', 'field');
    const lab = el('span', 'field-label', label);
    const group = el('div', 'seg');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    for (const [text, v] of choices) {
      const b = el('button', '', text);
      b.type = 'button';
      b.addEventListener('click', () => set({ [key]: v } as Partial<RoomOpts>));
      syncs.push(() => b.setAttribute('aria-pressed', String(opts[key] === v)));
      group.append(b);
    }
    row.append(lab, group, el('span', 'field-hint', hint));
    return row;
  };
  // Several decks at once; the last one can't be switched off.
  const decks = (label: string, hint: string) => {
    const row = el('div', 'field');
    const group = el('div', 'seg');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    for (const d of DECK_IDS) {
      const b = el('button', '', DECK_NAMES[d]);
      b.type = 'button';
      b.addEventListener('click', () => {
        const on = opts.decks.includes(d);
        if (on && opts.decks.length === 1) return;
        set({ decks: on ? opts.decks.filter((x) => x !== d) : DECK_IDS.filter((x: DeckId) => x === d || opts.decks.includes(x)) });
      });
      syncs.push(() => b.setAttribute('aria-pressed', String(opts.decks.includes(d))));
      group.append(b);
    }
    row.append(el('span', 'field-label', label), group, el('span', 'field-hint', hint));
    return row;
  };
  const done = el('button', 'btn big', 'Fertig');
  done.type = 'button';
  done.addEventListener('click', () => dlg.close());
  dlg.append(
    el('h2', 'room-dialog-title', title),
    seg('Sprachchat', 'voice', [['An', true], ['Aus', false]], 'Aus, wenn ihr schon im TeamSpeak oder Discord seid.'),
    seg('Schaffner', 'schaffner', [['Aus', 'off'], ['Nur ermahnen', 'warn'], ['Mit Punktabzug', 'fine']], 'Kommt, wenn jemand zu lange zu laut ist. Punktabzug nur während einer Runde.'),
    seg('Abstimmung', 'voteS', ROOM.voteChoices.map((s) => [`${s} s`, s] as const), 'So lange bleibt eine Abstimmung bei „Wer bin ich?“ offen.'),
    seg('Stromausfälle', 'blackouts', [['An', true], ['Aus', false]], 'Ab und zu geht im Wagen kurz das Licht aus.'),
    decks('Wörter', 'Für „Sag’s anders“. NSFW ist richtig derb. Eigene = die Listen aller im Raum (Menü → Wörter).'),
    seg('Modus', 'sagsTeams', [['Teams', true], ['Jeder gegen jeden', false]], 'Für „Sag’s anders“. Teams gehen nur zu viert (2 gegen 2); mit 2–3 Spielern spielt immer jeder gegen jeden.'),
    seg('Zeit pro Zug', 'turnS', ROOM.turnChoices.map((s) => [`${s} s`, s] as const), 'So lange erklärt jemand bei „Sag’s anders“, bevor der Nächste dran ist.'),
    done,
  );
  // Esc closes the dialog natively; it must not also reach the game's Esc handler (pause menu).
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') e.stopPropagation();
  });
  // Gone once closed.
  dlg.addEventListener('close', () => dlg.remove());
  host.append(dlg);
  for (const f of syncs) f();
  dlg.showModal();
}
