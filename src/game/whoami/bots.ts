import { LocalGameRoom } from '../minigame';
import { botCard } from './cardImage';
import { WhoamiGame } from './game';
import type { Vote } from './logic';

/**
 * Test bots for the solo round: they make a card, vote at random after a moment, and on their turn
 * ask a few questions before they guess. Enough to click through every screen alone.
 */
export class WhoamiBots {
  private bots: { game: WhoamiGame; wait: number; key: string }[] = [];

  constructor(
    private room: LocalGameRoom,
    ids: string[],
  ) {
    for (const id of ids) this.bots.push({ game: new WhoamiGame(room.net(id)), wait: 0, key: '' });
  }

  tick(now: number): void {
    this.room.pump();
    this.bots.forEach((b, i) => {
      const s = b.game.state;
      if (!s) return;
      // One pending action per situation; the key tells when the situation changed.
      const key = `${s.round}|${s.phase}|${s.turn}|${s.vote?.guesser}|${s.vote?.kind}|${s.last?.result}|${s.questions[b.game.selfId]}`;
      if (key !== b.key) {
        b.key = key;
        b.wait = now + 900 + Math.random() * 1600;
      }
      if (now < b.wait) return;
      b.wait = Infinity;
      const me = b.game.selfId;
      if (s.phase === 'cards' && !b.game.myCardSent) b.game.submitCard(botCard(i + s.round * 3));
      else if (s.phase === 'play' && s.vote && s.vote.guesser !== me && !s.vote.voters.includes(me)) {
        const pool: Vote[] = s.vote.kind === 'guess' ? ['yes', 'no'] : ['yes', 'no', 'idk'];
        b.game.toHost({ a: 'vote', v: pool[Math.floor(Math.random() * pool.length)] });
      } else if (s.phase === 'play' && !s.vote && s.turn === me) {
        const asked = s.questions[me] ?? 0;
        b.game.toHost(asked >= 2 && Math.random() < 0.5 ? { a: 'guess' } : { a: 'ask' });
      }
    });
  }
}
