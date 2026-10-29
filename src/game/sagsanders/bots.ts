import type { LocalGameRoom } from '../minigame';
import type { SagsRoom } from './game';
import { SagsGame } from './game';
import { guessersOf } from './logic';

/**
 * Test bots for the solo round: they start their turn after a moment, then "explain" (a random
 * hit or skip every few seconds), and now and then call a foul. Enough to click through every screen.
 */
export class SagsBots {
  private bots: { game: SagsGame; wait: number; key: string }[] = [];

  constructor(
    private room: LocalGameRoom,
    ids: string[],
    opts: SagsRoom,
  ) {
    for (const id of ids) this.bots.push({ game: new SagsGame(room.net(id), opts, () => ({ pid: `bot-${id}`, cards: [] })), wait: 0, key: '' });
  }

  tick(now: number): void {
    this.room.pump();
    for (const b of this.bots) {
      b.game.tick(now);
      const s = b.game.state;
      if (!s || s.phase === 'done') continue;
      const me = b.game.selfId;
      const key = `${s.round}|${s.phase}|${s.explainer}|${s.cardNo}`;
      if (key !== b.key) {
        b.key = key;
        b.wait = now + (s.phase === 'turn' ? 3500 + Math.random() * 5000 : 1200 + Math.random() * 1500);
      }
      if (now < b.wait) continue;
      b.wait = Infinity;
      if (s.explainer === me && s.phase === 'ready') b.game.begin();
      else if (s.explainer === me && s.phase === 'turn') {
        if (Math.random() < 0.3) b.game.skip();
        else {
          const g = s.mode === 'ffa' ? guessersOf(s, me) : [];
          b.game.got(g.length ? g[Math.floor(Math.random() * g.length)] : null);
        }
      } else if (b.game.seen && Math.random() < 0.15) b.game.foul();
    }
  }
}
