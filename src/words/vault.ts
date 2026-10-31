import vaultFile from './vault.json';
import type { Content, DeckEntry } from './types';

// The built-in decks travel only sealed (AES-256-GCM, key from PBKDF2-SHA256 over a password), so
// neither the public repo nor the deployed bundle carries them in plain text. scripts/seal-content.mjs
// writes vault.json from the local private/content/; this side opens it with WebCrypto. What is kept
// and shared is the derived key, never the password.

export interface Vault {
  format: 'ukhdk-vault';
  v: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number };
  cipher: 'AES-256-GCM';
  /** Base64. The salt also names the vault: a key only fits the vault with the same salt. */
  salt: string;
  iv: string;
  data: string;
}

/** Same as the seal script; tests seal with fewer to stay fast. */
export const KDF_ITERATIONS = 600_000;
export const KEY_BYTES = 32;

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Null for anything that isn't base64. */
export function fromB64(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function parseVault(v: unknown): Vault | null {
  if (!isObj(v) || v.format !== 'ukhdk-vault' || v.v !== 1 || v.cipher !== 'AES-256-GCM') return null;
  const k = v.kdf;
  if (!isObj(k) || k.name !== 'PBKDF2' || k.hash !== 'SHA-256' || typeof k.iterations !== 'number' || !(k.iterations >= 1)) return null;
  if (typeof v.salt !== 'string' || typeof v.iv !== 'string' || typeof v.data !== 'string') return null;
  if (!fromB64(v.salt) || fromB64(v.iv)?.length !== 12 || !fromB64(v.data)) return null;
  return v as unknown as Vault;
}

/** The vault in this build; null if the file is broken (the game then just keeps the fallback). */
export const VAULT: Vault | null = parseVault(vaultFile);

/** Password to raw AES key. Slow on purpose (PBKDF2); done once per browser, the key is kept. */
export async function deriveKey(password: string, vault: Pick<Vault, 'salt' | 'kdf'>): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(vault.salt)!, iterations: vault.kdf.iterations }, base, KEY_BYTES * 8);
  return new Uint8Array(bits);
}

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');
const pair = (v: unknown, a: string, b: string) => isObj(v) && strings(v[a]) && strings(v[b]);
const entries = (v: unknown): v is DeckEntry[] => Array.isArray(v) && v.every((e) => strings(e) && e.length >= 1);

/** Shape check of decrypted content (it was authenticated, but may come from an older script). */
export function parseContent(v: unknown): Content | null {
  if (!isObj(v) || v.v !== 1 || !isObj(v.words) || !entries(v.words.normal) || !entries(v.words.nsfw)) return null;
  if (!pair(v.gleich, 'normal', 'nsfw') || !pair(v.zeig, 'normal', 'nsfw')) return null;
  if (!isObj(v.slf) || !strings(v.slf.text) || !strings(v.slf.image) || !strings(v.slf.nsfw)) return null;
  return v as unknown as Content;
}

/** Decrypt with a raw key. Null for a wrong key (GCM authentication fails) or a broken vault. */
export async function openVault(vault: Vault, raw: Uint8Array<ArrayBuffer>): Promise<Content | null> {
  if (raw.length !== KEY_BYTES) return null;
  try {
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(vault.iv)! }, key, fromB64(vault.data)!);
    return parseContent(JSON.parse(new TextDecoder().decode(plain)));
  } catch {
    return null;
  }
}

/** Seal content like the script does (tests seal fixtures in memory with it). */
export async function sealContent(content: Content, password: string, iterations = KDF_ITERATIONS): Promise<Vault> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kdf = { name: 'PBKDF2', hash: 'SHA-256', iterations } as const;
  const raw = await deriveKey(password, { salt: toB64(salt), kdf });
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(content))));
  return { format: 'ukhdk-vault', v: 1, kdf, cipher: 'AES-256-GCM', salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
}
