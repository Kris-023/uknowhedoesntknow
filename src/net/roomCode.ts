import { NET } from '../config';

// No 0/o, 1/l/i: codes get read out over voice chat and typed by hand.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newRoomCode(rand: (n: number) => Uint32Array = (n) => crypto.getRandomValues(new Uint32Array(n))): string {
  return [...rand(NET.codeLength)].map((v) => ALPHABET[v % ALPHABET.length]).join('');
}

/** Accepts what people paste: case, spaces, dashes, a full link with #code. Null if invalid. */
export function normalizeRoomCode(input: string): string | null {
  const raw = input.includes('#') ? input.slice(input.lastIndexOf('#') + 1) : input;
  const code = raw.toLowerCase().replace(/[\s-]/g, '');
  if (code.length !== NET.codeLength) return null;
  return [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

/** "abcd-efgh": easier to read out loud. */
export const formatRoomCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`.toUpperCase();
