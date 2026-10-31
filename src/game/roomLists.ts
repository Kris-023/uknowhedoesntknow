import type { TextKind } from '../words/lists';
import { parseShared, uniqueTexts, type SharedLists } from '../words/lists';
import type { WordCard } from '../words/types';
import type { GameNet } from './minigame';

/**
 * Everyone's own lists in the room, for every game. Each client sends its enabled lists of all
 * kinds straight to each member once (again to newcomers and rejoiners, who have new ids, and to
 * everyone after a change), and only while the room plays with the deck "Eigene". Nothing goes
 * through the host, and no UI lists what others sent: word cards must stay unseen until played.
 */
export class RoomLists {
  private shared = new Map<string, SharedLists>();
  private sentTo = new Set<string>();
  private sentKey = '';

  constructor(
    private net: GameNet,
    /** What I bring, fresh from my lists. */
    private mine: () => SharedLists,
    /** The room plays with the deck "Eigene". */
    private on: () => boolean,
    /** Changes whenever my lists change, so they go out again. */
    private version: () => number = () => 0,
  ) {
    net.onMessage((t, d, f) => this.onMessage(t, d, f));
  }

  /** Per frame: send to whoever doesn't have my current lists yet. */
  tick(): void {
    if (!this.on()) {
      // Switched on again later: everyone gets them anew.
      this.sentKey = '';
      return;
    }
    const key = String(this.version());
    if (key !== this.sentKey) {
      this.sentKey = key;
      this.sentTo.clear();
    }
    let src: SharedLists | null = null;
    for (const m of this.net.members()) {
      if (m.id === this.net.selfId || this.sentTo.has(m.id)) continue;
      this.sentTo.add(m.id);
      src ??= this.mine();
      this.net.send('cl:lists', src, m.id);
    }
  }

  onMessage(type: string, data: unknown, from: string): void {
    if (type === 'cl:lists') {
      const s = parseShared(data);
      if (s) this.shared.set(from, s);
    } else if (type === 'sa:words') {
      // Peers from before the lists sent only their word cards, from inside "Sag's anders".
      const d = data as { pid?: unknown; cards?: unknown } | null;
      const s = parseShared({ pid: d?.pid, words: d?.cards });
      if (s) this.shared.set(from, s);
    }
  }

  /** Lists of members still here (someone who left takes theirs along), mine fresh from storage. */
  private sources(): SharedLists[] {
    const here = new Set(this.net.members().map((m) => m.id));
    const out = [this.mine()];
    for (const [id, s] of this.shared) if (id !== this.net.selfId && here.has(id)) out.push(s);
    return out;
  }

  /** Every word card in the room. */
  cards(): WordCard[] {
    return this.sources().flatMap((s) => s.words);
  }

  /** Every entry of a text kind in the room, without duplicates. */
  texts(kind: TextKind): string[] {
    return uniqueTexts(this.sources().flatMap((s) => s[kind]));
  }

  /** Profile id of a member, as far as their lists have arrived (a player's own words are kept away from them). */
  pidOf(id: string): string | undefined {
    return id === this.net.selfId ? this.mine().pid : this.shared.get(id)?.pid;
  }
}
