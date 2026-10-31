import { parseSharedKey, type DeckLock } from '../words/content';
import type { GameNet } from './minigame';

/**
 * Hands the deck key around the room: whoever has it sends it straight to each member once (again
 * to newcomers and rejoiners, who have new ids), so everyone opens the decks locally, because cards
 * are drawn on the explaining client. Only ever addressed to one member, never in a broadcast or in
 * game state. A received key counts only if it really opens this build's vault.
 */
export class RoomKey {
  private sentTo = new Set<string>();
  private sentKey = '';
  /** The key each member sent me: who sent the one I have doesn't need it back. */
  private got = new Map<string, string>();

  constructor(
    private net: GameNet,
    private lock: DeckLock,
  ) {
    net.onMessage((t, d, f) => this.onMessage(t, d, f));
  }

  /** Per frame: send to whoever hasn't had my key yet. */
  tick(): void {
    const k = this.lock.shared;
    if (!k) {
      // Locked again ("vergessen"): a later unlock goes to everyone anew.
      this.sentKey = '';
      return;
    }
    if (k.key !== this.sentKey) {
      this.sentKey = k.key;
      this.sentTo.clear();
    }
    for (const m of this.net.members()) {
      if (m.id === this.net.selfId || this.sentTo.has(m.id) || this.got.get(m.id) === k.key) continue;
      this.sentTo.add(m.id);
      this.net.send('dk:key', k, m.id);
    }
  }

  onMessage(type: string, data: unknown, from: string): void {
    if (type !== 'dk:key') return;
    const k = parseSharedKey(data);
    if (!k) return;
    this.got.set(from, k.key);
    if (!this.lock.unlocked) void this.lock.offer(k);
  }
}
