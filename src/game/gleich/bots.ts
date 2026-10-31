import type { LocalGameRoom } from '../minigame';
import { GleichGame, type GleichRoom } from './game';
import { matches, type Words } from './logic';

/** First-try answers of the bots: ordinary things everybody might say. */
const FIRST = ['Katze', 'Pizza', 'Mond', 'Kaffee', 'Banane', 'Hund', 'Auto', 'Eis', 'Regen', 'Buch', 'Schuh', 'Sonne'];

/** How likely a bot is to follow the group on the given try; rises, so a solo round converges in a few tries. */
export const followChance = (tryNo: number) => Math.min(0.95, 0.4 + 0.18 * (tryNo - 1));

/** The word a bot writes: the most common earlier word, or any earlier one, or something of its own. */
export function botWord(history: readonly Words[], tryNo: number, rand: () => number): string {
  const seen: string[] = [];
  for (const w of history) for (const v of Object.values(w)) if (v) seen.push(v);
  if (!seen.length || rand() >= followChance(tryNo)) return FIRST[Math.floor(rand() * FIRST.length)];
  // Count words that match as one, so "Katze" and "Katzen" add up.
  const counts = seen.map((w) => ({ w, n: seen.filter((x) => matches(w, x)).length }));
  const top = Math.max(...counts.map((c) => c.n));
  const best = counts.filter((c) => c.n === top);
  return rand() < 0.75 ? best[Math.floor(rand() * best.length)].w : seen[Math.floor(rand() * seen.length)];
}

/**
 * Test bots for the solo round: they write after a moment (through the real commit and reveal
 * path), press "Weiter" and vote at random. With every try they lean more to the words so far.
 */
export class GleichBots {
  private bots: { game: GleichGame; wait: number; key: string }[] = [];

  constructor(
    private room: LocalGameRoom,
    ids: string[],
    opts: GleichRoom,
  ) {
    for (const id of ids) this.bots.push({ game: new GleichGame(room.net(id), opts), wait: 0, key: '' });
  }

  tick(now: number): void {
    this.room.pump();
    for (const b of this.bots) {
      b.game.tick(now);
      const s = b.game.state;
      if (!s || s.phase === 'done') continue;
      const me = b.game.selfId;
      // One pending action per situation; the key tells when the situation changed.
      const key = `${s.round}|${s.tryNo}|${s.phase}|${!!s.words}|${!!s.vote}`;
      if (key !== b.key) {
        b.key = key;
        b.wait = now + (s.phase === 'write' ? 2500 + Math.random() * 6000 : 1200 + Math.random() * 3000);
      }
      if (now < b.wait) continue;
      b.wait = Infinity;
      if (s.phase === 'write' && !s.commits[me]) void b.game.lock(botWord(s.history, s.tryNo, Math.random));
      else if (s.phase === 'reveal' && s.words) {
        if (s.vote) {
          if (!b.game.iVoted) b.game.vote(Math.random() < 0.6);
        } else b.game.ready();
      }
    }
  }
}
