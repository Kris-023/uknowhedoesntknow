import { ITEMS, SLOTS, type ItemId } from '../characters/accessories';
import { HAIRSTYLES, type Look } from '../characters/look';
import type { PersonState } from '../characters/person';
import type { Slot } from '../characters/rig';
import { COLORS, HEAD, NET } from '../config';

// Wire format. Only IDs and numbers travel, never geometry. Everything received is validated,
// because a peer is just another browser that could send anything.

/** Host's speed profile: distance is the integral, so every client derives the same tunnel position. */
export interface Train {
  kmh: number;
  /** Clock time (s) of the last speed change and the distance (m) reached by then. */
  t0: number;
  d0: number;
}

export interface RosterEntry {
  id: string;
  seat: number;
  state: PersonState;
}

export interface Welcome {
  seed: number;
  startMs: number;
  /** Host clock (ms) at send time, for a first rough offset. */
  hostMs: number;
  roster: RosterEntry[];
  train: Train;
  blackoutAt: number | null;
}

export const trainDistance = (t: Train, now: number): number => t.d0 + (t.kmh / 3.6) * (now - t.t0);

/** Shirt colour follows the seat, so players are told apart by colour like their markers. */
export const withSeatColor = (s: PersonState, seat: number): PersonState => ({ ...s, look: { ...s.look, top: COLORS.players[seat] } });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
const color = (v: unknown) => num(v, 0, 0xffffff);

export function parseLook(v: unknown): Look | null {
  if (!isObj(v)) return null;
  const hair = HAIRSTYLES.find((h) => h === v.hair);
  const cols = [v.skin, v.hairCol, v.top, v.pants, v.shoes, v.hat].map(color);
  const flags = [v.female, v.glasses, v.beard, v.short];
  if (!hair || cols.some((c) => c === null) || flags.some((f) => typeof f !== 'boolean')) return null;
  const [skin, hairCol, top, pants, shoes, hat] = cols as number[];
  const [female, glasses, beard, short] = flags as boolean[];
  return { female, skin, hair, hairCol, top, pants, shoes, hat, glasses, beard, short };
}

export function parseState(v: unknown): PersonState | null {
  if (!isObj(v) || !isObj(v.items)) return null;
  const look = parseLook(v.look);
  if (!look) return null;
  const items: Partial<Record<Slot, ItemId>> = {};
  for (const s of SLOTS) {
    const id = v.items[s];
    // Only known items, and only in their own slot.
    if (typeof id === 'string' && id in ITEMS && ITEMS[id as ItemId].slot === s) items[s] = id as ItemId;
  }
  return { look, items };
}

export function parseRoster(v: unknown): RosterEntry[] | null {
  if (!Array.isArray(v) || v.length > NET.maxPlayers) return null;
  const out: RosterEntry[] = [];
  for (const e of v) {
    if (!isObj(e) || typeof e.id !== 'string') return null;
    const seat = num(e.seat, 0, NET.maxPlayers - 1);
    const state = parseState(e.state);
    if (seat === null || !Number.isInteger(seat) || !state) return null;
    out.push({ id: e.id, seat, state });
  }
  return out;
}

export function parseTrain(v: unknown): Train | null {
  if (!isObj(v)) return null;
  const kmh = num(v.kmh, 0, 100000);
  const t0 = num(v.t0, -1e9, 1e9);
  const d0 = num(v.d0, -1e12, 1e12);
  return kmh === null || t0 === null || d0 === null ? null : { kmh, t0, d0 };
}

export function parseWelcome(v: unknown): Welcome | null {
  if (!isObj(v)) return null;
  const seed = num(v.seed, -(2 ** 31), 2 ** 32);
  const startMs = num(v.startMs, 0, 1e15);
  const hostMs = num(v.hostMs, 0, 1e15);
  const roster = parseRoster(v.roster);
  const train = parseTrain(v.train);
  // A broken blackout time only loses the blackout, not the whole welcome.
  const blackoutAt = num(v.blackoutAt, -1e9, 1e9);
  if (seed === null || startMs === null || hostMs === null || !roster || !train) return null;
  return { seed: seed | 0, startMs, hostMs, roster, train, blackoutAt };
}

/** Pose on the wire: [yaw, pitch], rounded to keep packets tiny. */
export const encodePose = (yaw: number, pitch: number): [number, number] => [Math.round(yaw * 1000) / 1000, Math.round(pitch * 1000) / 1000];

export function parsePose(v: unknown): { yaw: number; pitch: number } | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const yaw = num(v[0], -HEAD.maxYaw, HEAD.maxYaw);
  const pitch = num(v[1], HEAD.minPitch, HEAD.maxPitch);
  return yaw === null || pitch === null ? null : { yaw, pitch };
}
