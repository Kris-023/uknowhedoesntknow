import { ROOM } from '../config';
import type { RoomOpts, SchaffnerMode } from '../net/protocol';
import { el } from './dom';

/** One-line summary for guests, who see the host's settings but can't change them. */
export function roomSummary(o: RoomOpts): string {
  const sf: Record<SchaffnerMode, string> = { off: 'Schaffner aus', warn: 'Schaffner ermahnt nur', fine: 'Schaffner mit Punktabzug' };
  return [o.voice ? 'Sprachchat an' : 'ohne Sprachchat', sf[o.schaffner], `Abstimmung ${o.voteS} s`, o.blackouts ? 'mit Stromausfällen' : 'ohne Stromausfälle'].join(' · ');
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
  const done = el('button', 'btn big', 'Fertig');
  done.type = 'button';
  done.addEventListener('click', () => dlg.close());
  dlg.append(
    el('h2', 'room-dialog-title', title),
    seg('Sprachchat', 'voice', [['An', true], ['Aus', false]], 'Aus, wenn ihr schon im TeamSpeak oder Discord seid.'),
    seg('Schaffner', 'schaffner', [['Aus', 'off'], ['Nur ermahnen', 'warn'], ['Mit Punktabzug', 'fine']], 'Kommt, wenn jemand zu lange zu laut ist. Punktabzug nur während einer Runde.'),
    seg('Abstimmung', 'voteS', ROOM.voteChoices.map((s) => [`${s} s`, s] as const), 'So lange bleibt eine Abstimmung bei „Wer bin ich?“ offen.'),
    seg('Stromausfälle', 'blackouts', [['An', true], ['Aus', false]], 'Ab und zu geht im Wagen kurz das Licht aus.'),
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
