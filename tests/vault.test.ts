import { describe, expect, it, vi } from 'vitest';
import { LocalGameRoom, type GameNet, type Member } from '../src/game/minigame';
import { RoomKey } from '../src/game/roomKey';
import { DECK_KEY_STORAGE, DeckLock, parseSharedKey } from '../src/words/content';
import { FALLBACK } from '../src/words/fallback';
import { deriveKey, openVault, parseVault, sealContent, toB64, VAULT, type Vault } from '../src/words/vault';
import { FIXTURE } from './fixtures/content';

// The sealed decks themselves never show up here: everything is sealed from the made-up fixture,
// with a test password, in memory. The seal script has its own test (seal-script.test.mjs).

const PASS = 'test-passwort-123';
/** Few iterations: the format carries the count, so the runtime follows it. */
const FAST = 1000;

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

let sealed: Promise<Vault> | null = null;
const testVault = () => (sealed ??= sealContent(FIXTURE, PASS, FAST));

describe('vault: sealing and opening', () => {
  it('opens with the key from the right password, not with a wrong one', async () => {
    const v = await testVault();
    expect(parseVault(JSON.parse(JSON.stringify(v)))).toEqual(v);
    expect(await openVault(v, await deriveKey(PASS, v))).toEqual(FIXTURE);
    expect(await openVault(v, await deriveKey('falsch', v))).toBeNull();
    expect(await openVault(v, new Uint8Array(16))).toBeNull();
  });

  it('nothing of the content is readable in the sealed file', async () => {
    const text = JSON.stringify(await testVault());
    for (const s of [FIXTURE.words.normal[0][0], FIXTURE.gleich.nsfw[0], FIXTURE.slf.nsfw[0], PASS]) expect(text).not.toContain(s);
  });

  it('a changed byte fails the authentication', async () => {
    const v = await testVault();
    const raw = await deriveKey(PASS, v);
    const bytes = Uint8Array.from(atob(v.data), (c) => c.charCodeAt(0));
    bytes[5] ^= 1;
    expect(await openVault({ ...v, data: toB64(bytes) }, raw)).toBeNull();
  });

  it('rejects broken vault files and keys', () => {
    expect(parseVault(null)).toBeNull();
    expect(parseVault({ format: 'ukhdk-vault', v: 2 })).toBeNull();
    expect(parseSharedKey({ salt: 'x', key: toB64(new Uint8Array(31)) })).toBeNull();
    expect(parseSharedKey({ salt: 'x', key: 'nicht base64!' })).toBeNull();
    expect(parseSharedKey({ salt: 'x', key: toB64(new Uint8Array(32)) })).not.toBeNull();
  });

  it('the committed vault is well-formed and sealed with a strong key derivation', () => {
    expect(VAULT).not.toBeNull();
    expect(VAULT!.kdf.iterations).toBeGreaterThanOrEqual(600_000);
  });
});

describe('vault: the deck lock', () => {
  it('locked: the fallback; a wrong password stays locked; the right one unlocks and keeps only the key', async () => {
    const storage = new MemoryStorage();
    const lock = new DeckLock(await testVault(), storage);
    const changes = vi.fn();
    lock.onChange(changes);
    expect(lock.unlocked).toBe(false);
    expect(lock.content).toBe(FALLBACK);
    expect(await lock.unlock('falsch')).toBe(false);
    expect(lock.unlocked).toBe(false);
    expect(await lock.unlock(PASS)).toBe(true);
    expect(lock.content).toEqual(FIXTURE);
    expect(changes).toHaveBeenCalledTimes(1);
    const kept = storage.getItem(DECK_KEY_STORAGE)!;
    expect(kept).not.toContain(PASS);
    expect(parseSharedKey(JSON.parse(kept))).toEqual(lock.shared);

    // Next visit: the kept key, no password.
    const again = new DeckLock(await testVault(), storage);
    await again.restore();
    expect(again.unlocked).toBe(true);
    again.forget();
    expect(again.unlocked).toBe(false);
    expect(again.content).toBe(FALLBACK);
    expect(storage.getItem(DECK_KEY_STORAGE)).toBeNull();
  });

  it('a kept key of an older vault is dropped; keys for another vault are ignored', async () => {
    const storage = new MemoryStorage();
    const old = await sealContent(FIXTURE, 'altes-passwort', FAST);
    const oldLock = new DeckLock(old, storage);
    await oldLock.unlock('altes-passwort');
    const lock = new DeckLock(await testVault(), storage);
    await lock.restore();
    expect(lock.unlocked).toBe(false);
    expect(storage.getItem(DECK_KEY_STORAGE)).toBeNull();
    expect(await lock.offer(oldLock.shared!)).toBe(false);
    // Right salt, wrong key: no.
    expect(await lock.offer({ salt: lock.vault!.salt, key: toB64(new Uint8Array(32)) })).toBe(false);
    expect(lock.unlocked).toBe(false);
  });
});

describe('vault: sharing the key in a room', () => {
  const roster: Member[] = [
    { id: 'a', seat: 0, name: 'A' },
    { id: 'b', seat: 1, name: 'B' },
    { id: 'c', seat: 2, name: 'C' },
  ];

  /** A net that records what goes out. */
  type Sent = { from: string; type: string; data: unknown; to?: string };
  function logged(net: GameNet, log: Sent[]): GameNet {
    return { ...net, send: (type, data, to) => (log.push({ from: net.selfId, type, data, to }), net.send(type, data, to)) };
  }

  it('whoever has the key sends it straight to each member; they open the decks themselves', async () => {
    const vault = await testVault();
    const room = new LocalGameRoom(roster.map((m) => ({ ...m })));
    const locks = roster.map(() => new DeckLock(vault, new MemoryStorage()));
    const log: Sent[] = [];
    // The key holder is a guest, not the host: anyone may have it.
    expect(await locks[1].unlock(PASS)).toBe(true);
    const keys = roster.map((m, i) => new RoomKey(logged(room.net(m.id), log), locks[i]));
    const tick = () => {
      for (const k of keys) k.tick();
      room.pump();
    };
    tick();
    await vi.waitFor(() => expect(locks.every((l) => l.unlocked)).toBe(true));
    for (const l of locks) expect(l.content).toEqual(FIXTURE);
    // Only addressed messages; nobody sends it twice to the same member, nobody to the one it came from.
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((m) => m.type === 'dk:key' && m.to)).toBe(true);
    tick();
    tick();
    const sent = log.map((m) => `${m.from}>${m.to}`);
    expect(new Set(sent).size).toBe(sent.length);
    expect(sent).not.toContain('a>b');
    expect(sent).not.toContain('c>b');
  });

  it('a newcomer (or someone back with a new id) gets it too; a bad key from a peer changes nothing', async () => {
    const vault = await testVault();
    const members = roster.map((m) => ({ ...m }));
    const room = new LocalGameRoom(members);
    const locks = roster.map(() => new DeckLock(vault, null));
    await locks[0].unlock(PASS);
    // c is not in the room yet.
    const c = members.pop()!;
    const keys = roster.map((m, i) => new RoomKey(room.net(m.id), locks[i]));
    const tick = () => {
      for (const k of keys) k.tick();
      room.pump();
    };
    tick();
    await vi.waitFor(() => expect(locks[1].unlocked).toBe(true));
    expect(locks[2].unlocked).toBe(false);

    // A junk key to c first: ignored.
    room.net('b').send('dk:key', { salt: vault.salt, key: toB64(new Uint8Array(32)) }, 'c');
    room.pump();
    await new Promise((r) => setTimeout(r, 20));
    expect(locks[2].unlocked).toBe(false);

    members.push(c);
    tick();
    await vi.waitFor(() => expect(locks[2].unlocked).toBe(true));
  });

  it('nobody has the key: nothing is sent', async () => {
    const vault = await testVault();
    const room = new LocalGameRoom(roster.map((m) => ({ ...m })));
    const log: Sent[] = [];
    const keys = roster.map((m) => new RoomKey(logged(room.net(m.id), log), new DeckLock(vault, null)));
    for (const k of keys) k.tick();
    room.pump();
    expect(log).toHaveLength(0);
  });
});
