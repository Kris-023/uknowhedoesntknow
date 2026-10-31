import { ROOM } from '../config';
import { mapDef, mapList } from '../maps';
import type { RoomOpts, SchaffnerMode } from '../net/protocol';
import { DECK_NAMES } from '../words';
import { deckLock } from '../words/content';
import { DECK_IDS, type DeckId } from '../words/types';
import { DeckLockView } from './deckLockView';
import { el } from './dom';

/** A deck's name, with the lock where it applies (NSFW is only in the sealed decks). */
const deckLabel = (d: DeckId) => (d === 'nsfw' && !deckLock.unlocked ? `${DECK_NAMES[d]} (gesperrt)` : DECK_NAMES[d]);

/** One-line summary for guests, who see the host's settings but can't change them. */
export function roomSummary(o: RoomOpts): string {
  const sf: Record<SchaffnerMode, string> = { off: 'Schaffner aus', warn: 'Schaffner ermahnt nur', fine: 'Schaffner mit Punktabzug' };
  const decks = (o.decks.length ? o.decks.map((d) => DECK_NAMES[d]).join('/') : DECK_NAMES.normal) + (deckLock.unlocked ? ' (freigeschaltet)' : ' (gesperrt)');
  return [o.voice ? 'Sprachchat an' : 'ohne Sprachchat', sf[o.schaffner], `Abstimmung ${o.voteS} s`, o.blackouts ? 'mit Stromausfällen' : 'ohne Stromausfälle', `Stapel ${decks}, ${o.turnS} s Erklärzeit`, o.sagsTeams ? 'zu viert in Teams' : 'jeder gegen jeden', o.slfMode === 'bild' ? 'Stadt, Land, Fluss mit Bildern' : 'Stadt, Land, Fluss geschrieben'].join(' · ');
}

/**
 * Room settings as a modal dialog: before creating a room (saved for next time) and for the host
 * in the Esc menu (applies to everyone at once). Every click is applied immediately.
 * `withMap`: the map choice too (in a running room; the main menu has its own map row).
 */
export function openRoomDialog(host: HTMLElement, current: RoomOpts, onChange: (o: RoomOpts) => void, title = 'Raum-Einstellungen', withMap = false): void {
  let opts = { ...current };
  const dlg = el('dialog', 'room-dialog');
  dlg.setAttribute('aria-label', title);
  const syncs: (() => void)[] = [];
  const lockView = new DeckLockView(true);
  // A key may arrive from the room while the dialog is open.
  const offLock = deckLock.onChange(() => {
    for (const f of syncs) f();
  });
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
  // Several decks at once; the last one can't be switched off. NSFW can't be switched on while the
  // decks are locked (it would be empty), but stays on if it was, for when someone unlocks them.
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
        if (!on && d === 'nsfw' && !deckLock.unlocked) return;
        set({ decks: on ? opts.decks.filter((x) => x !== d) : DECK_IDS.filter((x: DeckId) => x === d || opts.decks.includes(x)) });
      });
      syncs.push(() => {
        const on = opts.decks.includes(d);
        b.setAttribute('aria-pressed', String(on));
        b.textContent = deckLabel(d);
        b.disabled = d === 'nsfw' && !deckLock.unlocked && !on;
      });
      group.append(b);
    }
    row.append(el('span', 'field-label', label), group, el('span', 'field-hint', hint), lockView.root);
    return row;
  };
  // Same names and blurbs as the main menu's map row; the hint follows the choice.
  const map = () => {
    const row = seg('Map', 'map', mapList().map((m) => [m.name, m.id] as const), '');
    const hint = row.querySelector('.field-hint')!;
    syncs.push(() => (hint.textContent = `${mapDef(opts.map).blurb} Runde und Punkte bleiben beim Wechsel.`));
    return row;
  };
  const done = el('button', 'btn big', 'Fertig');
  done.type = 'button';
  done.addEventListener('click', () => dlg.close());
  dlg.append(
    el('h2', 'room-dialog-title', title),
    ...(withMap ? [map()] : []),
    seg('Sprachchat', 'voice', [['An', true], ['Aus', false]], 'Aus, wenn ihr schon im TeamSpeak oder Discord seid.'),
    seg('Schaffner', 'schaffner', [['Aus', 'off'], ['Nur ermahnen', 'warn'], ['Mit Punktabzug', 'fine']], 'Kommt, wenn jemand zu lange zu laut ist. Punktabzug nur während einer Runde.'),
    seg('Abstimmung', 'voteS', ROOM.voteChoices.map((s) => [`${s} s`, s] as const), 'So lange bleibt eine Abstimmung bei „Wer bin ich?“ offen.'),
    seg('Stromausfälle', 'blackouts', [['An', true], ['Aus', false]], 'Ab und zu geht kurz das Licht aus, jede Map auf ihre Art.'),
    decks('Stapel', 'Woraus Wörter, Fragen und Kategorien kommen. NSFW ist richtig derb (auch die Fragen in „Gleich gedacht“ und „Zeig drauf“ und Extra-Kategorien in „Stadt, Land, Fluss“). Eigene = die eingeschalteten Listen aller im Raum (Menü → Eigene Listen), gemischt mit dem Rest; nur Eigene an heißt nur eure, wenn es genug sind.'),
    seg('Modus', 'sagsTeams', [['Teams', true], ['Jeder gegen jeden', false]], 'Für „Sag’s anders“. Teams gehen nur zu viert (2 gegen 2); mit 2–3 Spielern spielt immer jeder gegen jeden.'),
    seg('Erklärzeit', 'turnS', ROOM.turnChoices.map((s) => [`${s} s`, s] as const), 'So lange erklärt jemand bei „Sag’s anders“, bevor der Nächste dran ist.'),
    seg('Stadt, Land, Fluss', 'slfMode', [['Schreiben', 'text'], ['Bilder', 'bild']], 'Schreiben: sechs Kategorien, wer fertig ist, ruft Stopp. Bilder: drei Kategorien, zu jeder ein Bild suchen (Link, Strg+V, Datei).'),
    done,
  );
  // Esc closes the dialog natively; it must not also reach the game's Esc handler (pause menu).
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') e.stopPropagation();
  });
  // Gone once closed.
  dlg.addEventListener('close', () => {
    offLock();
    lockView.dispose();
    dlg.remove();
  });
  host.append(dlg);
  for (const f of syncs) f();
  dlg.showModal();
}
