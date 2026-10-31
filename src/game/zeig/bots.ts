import type { LocalGameRoom } from '../minigame';
import { ZeigGame, type ZeigRoom } from './game';
import type { ZeigRecord } from './logic';

/** How likely a bot goes with the person the table picked most so far. */
export const STICKY = 0.35;

/**
 * A bot's pick: anyone but itself, with a lean towards whoever was "most likely" most often so
 * far, so solo rounds have majorities now and then.
 */
export function botPick(me: string, players: readonly string[], history: readonly ZeigRecord[], rand: () => number): string | null {
  const others = players.filter((p) => p !== me);
  if (!others.length) return null;
  const wins = new Map<string, number>();
  for (const h of history) for (const t of h.top) if (t !== me && others.includes(t)) wins.set(t, (wins.get(t) ?? 0) + 1);
  const best = Math.max(0, ...wins.values());
  const leaders = others.filter((p) => best > 0 && wins.get(p) === best);
  if (leaders.length && rand() < STICKY) return leaders[Math.floor(rand() * leaders.length)];
  return others[Math.floor(rand() * others.length)];
}

/**
 * Test bots for the solo round. They have no heads to look with, so they pick directly: a lock
 * after a few seconds, and "Weiter" a moment after the reveal.
 */
export class ZeigBots {
  private bots: { game: ZeigGame; wait: number; key: string }[] = [];

  constructor(
    private room: LocalGameRoom,
    ids: string[],
    opts: ZeigRoom,
  ) {
    for (const id of ids) this.bots.push({ game: new ZeigGame(room.net(id), opts), wait: 0, key: '' });
  }

  tick(now: number): void {
    this.room.pump();
    for (const b of this.bots) {
      b.game.tick(now);
      const s = b.game.state;
      if (!s || s.phase === 'done') continue;
      const key = `${s.round}|${s.qNo}|${s.phase}`;
      if (key !== b.key) {
        b.key = key;
        b.wait = now + (s.phase === 'look' ? 2000 + Math.random() * 5000 : 2500 + Math.random() * 3000);
      }
      if (now < b.wait) continue;
      b.wait = Infinity;
      if (s.phase === 'look') b.game.lock(botPick(b.game.selfId, s.players, s.history, Math.random));
      else b.game.ready();
    }
  }
}
