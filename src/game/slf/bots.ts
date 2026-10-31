import { WHOAMI } from '../../config';
import type { LocalGameRoom } from '../minigame';
import { botAnswer } from './botWords';
import { SlfGame, type SlfRoom } from './game';
import { liveText } from './logic';

const BG = ['#ffd21f', '#6bbf3a', '#f2b23a', '#f06aa8', '#4f8dff', '#d9a06b', '#9bd0a0', '#c58bff'];

/** A picture for the test bots: the letter big, the word under it, on a coloured card. */
export function botPicture(letter: string, word: string, i: number): string {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 240;
  const x = c.getContext('2d')!;
  x.fillStyle = BG[i % BG.length];
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = 'rgba(0, 0, 0, .78)';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = '800 130px system-ui, sans-serif';
  x.fillText(letter, 160, 100);
  x.font = '700 30px system-ui, sans-serif';
  x.fillText(word || '???', 160, 200, 300);
  return c.toDataURL('image/jpeg', WHOAMI.cardQuality);
}

interface Bot {
  game: SlfGame;
  wait: number;
  key: string;
  /** Round the bot filled its sheet for. */
  filled: number;
}

/**
 * Test bots for the solo round: they fill their sheet right away (sometimes with a filler or a
 * gap), may call "Stopp!" after a while, flag bare letters, vote, judge pictures and go on.
 */
export class SlfBots {
  private bots: Bot[] = [];

  constructor(
    private room: LocalGameRoom,
    ids: string[],
    opts: SlfRoom,
  ) {
    for (const id of ids) this.bots.push({ game: new SlfGame(room.net(id), opts), wait: 0, key: '', filled: -1 });
  }

  tick(now: number): void {
    this.room.pump();
    this.bots.forEach((b, i) => {
      const g = b.game;
      g.tick(now);
      const s = g.state;
      if (!s || s.phase === 'done' || !g.playing) return;
      const me = g.selfId;
      if (s.phase === 'write' && b.filled !== s.round) {
        b.filled = s.round;
        s.categories.forEach((cat, c) => {
          const word = botAnswer(cat, s.letter, Math.random);
          if (s.mode === 'text') g.setText(c, word);
          else if (word) {
            g.setPic(c, botPicture(s.letter, word, i + c));
            g.setCaption(c, word);
          }
        });
      }
      const key = `${s.round}.${s.undo}|${s.phase}|${s.cat}|${s.step}|${s.flags.length}|${!!s.vote}|${s.voteNo}`;
      if (key !== b.key) {
        b.key = key;
        const write = s.mode === 'text' ? 30000 + Math.random() * 60000 : 20000 + Math.random() * 40000;
        b.wait = now + (s.phase === 'write' ? write : 1500 + Math.random() * 4000);
      }
      if (now < b.wait) return;
      b.wait = Infinity;
      if (s.phase === 'write') {
        if (Math.random() < 0.2) void g.stop();
        return;
      }
      if (s.phase !== 'rate') return;
      if (s.mode === 'text') {
        const v = s.vote;
        const answers = g.answersView();
        if (v) {
          if (v.eligible.includes(me) && !g.iVoted) {
            const f = s.flags[v.flag];
            const a = f ? (answers?.[f.target]?.[s.cat] ?? '') : '';
            g.vote(f?.kind === 'bad' ? a.length <= 2 || Math.random() < 0.2 : Math.random() < 0.5);
          }
          return;
        }
        // A bare letter is a filler: the first bot that notices flags it.
        const live = liveText(s);
        const filler = s.players.find((p) => p !== me && live?.valid[p] && (answers?.[p]?.[s.cat] ?? '').length <= 2 && !s.flags.some((f) => f.kind === 'bad' && f.target === p));
        if (filler && Math.random() < 0.8) g.flagBad(filler);
        else g.ready();
      } else if (s.step === 'vote') {
        const ok: Record<string, boolean> = {};
        const others = s.players.filter((p) => p !== me && s.shown?.[p]?.[s.cat]);
        for (const p of others) ok[p] = Math.random() < 0.9;
        g.judge(ok, others.length ? others[Math.floor(Math.random() * others.length)] : null);
      } else g.ready();
    });
  }
}
