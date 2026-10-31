import { FALLBACK } from './fallback';
import type { Content } from './types';
import { fromB64, openVault, deriveKey, toB64, VAULT, KEY_BYTES, type Vault } from './vault';

/** Where the derived key is kept, with the salt of the vault it belongs to. */
export const DECK_KEY_STORAGE = 'ukhdk.deckkey.v1';

type KeyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A key as it is kept and as it travels to peers. */
export interface SharedKey {
  /** Salt of the vault it opens (keys of another build's vault are ignored). */
  salt: string;
  key: string;
}

export function parseSharedKey(v: unknown): SharedKey | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.salt !== 'string' || o.salt.length > 64 || typeof o.key !== 'string' || o.key.length > 64) return null;
  return fromB64(o.key)?.length === KEY_BYTES ? { salt: o.salt, key: o.key } : null;
}

/**
 * The built-in decks of this browser: the fallback until the vault is opened, by password or by a
 * key from a peer. Games read `content` when they draw, so a key arriving mid-round only changes
 * what the next draw sees.
 */
export class DeckLock {
  content: Content = FALLBACK;
  private raw: Uint8Array<ArrayBuffer> | null = null;
  private listeners = new Set<() => void>();
  /** Keys that didn't fit, so a peer repeating one costs nothing. */
  private failed = new Set<string>();

  constructor(
    readonly vault: Vault | null,
    private storage: KeyStorage | null = null,
  ) {}

  get unlocked(): boolean {
    return this.raw !== null;
  }

  /** The key to hand to peers; null while locked. */
  get shared(): SharedKey | null {
    return this.raw && this.vault ? { salt: this.vault.salt, key: toB64(this.raw) } : null;
  }

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  /** Startup: the key kept from an earlier visit. A key for an older vault is dropped. */
  async restore(): Promise<void> {
    let kept: SharedKey | null = null;
    try {
      kept = parseSharedKey(JSON.parse(this.storage?.getItem(DECK_KEY_STORAGE) ?? 'null'));
    } catch {
      kept = null;
    }
    if (!kept) return;
    if (!(await this.offer(kept))) this.drop();
  }

  /** The password, typed in the menu. False for a wrong one. */
  async unlock(password: string): Promise<boolean> {
    if (!this.vault || !password) return false;
    const raw = await deriveKey(password, this.vault);
    return this.apply(raw);
  }

  /** A key from storage or a peer; it counts only if it opens this vault. */
  async offer(k: SharedKey): Promise<boolean> {
    if (this.unlocked) return true;
    if (!this.vault || k.salt !== this.vault.salt || this.failed.has(k.key)) return false;
    const raw = fromB64(k.key);
    if (raw && (await this.apply(raw))) return true;
    if (this.failed.size < 64) this.failed.add(k.key);
    return false;
  }

  /** Back to the fallback; the key is no longer kept. */
  forget(): void {
    this.drop();
    if (!this.raw) return;
    this.raw = null;
    this.content = FALLBACK;
    this.emit();
  }

  private async apply(raw: Uint8Array<ArrayBuffer>): Promise<boolean> {
    const c = this.vault ? await openVault(this.vault, raw) : null;
    if (!c) return false;
    if (this.unlocked) return true;
    this.raw = raw;
    this.content = c;
    try {
      this.storage?.setItem(DECK_KEY_STORAGE, JSON.stringify(this.shared));
    } catch {
      // No storage: unlocked for this tab only.
    }
    this.emit();
    return true;
  }

  private drop(): void {
    try {
      this.storage?.removeItem(DECK_KEY_STORAGE);
    } catch {
      // Nothing kept anyway.
    }
  }

  private emit(): void {
    for (const f of this.listeners) f();
  }
}

function browserStorage(): KeyStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** This browser's decks. */
export const deckLock = new DeckLock(VAULT, browserStorage());
void deckLock.restore();

/** What the games draw from right now. */
export const content = (): Content => deckLock.content;
