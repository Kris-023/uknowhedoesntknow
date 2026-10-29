import { ITEMS, SLOTS, type ItemId } from '../characters/accessories';
import { BEARDS, BUILDS, FACES, FOOTWEAR, HAIRSTYLES, TOPSTYLES, type Beard, type Look } from '../characters/look';
import type { PersonState } from '../characters/person';
import type { Slot } from '../characters/rig';
import { HEAD, NET, ROOM, SAGS } from '../config';
import { DECK_IDS, type DeckId } from '../words/types';

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

export const SCHAFFNER_MODES = ['off', 'warn', 'fine'] as const;
export type SchaffnerMode = (typeof SCHAFFNER_MODES)[number];

/** Room settings the host decides for everyone. */
export interface RoomOpts {
  /** Voice chat in this room; off for groups already sitting in TeamSpeak/Discord. */
  voice: boolean;
  /** The conductor: never, only a telling-off, or a telling-off plus a point off during a round. */
  schaffner: SchaffnerMode;
  /** Seconds a "Wer bin ich?" vote stays open. */
  voteS: number;
  /** Random power failures in the coach (the lights going out). */
  blackouts: boolean;
  /** Word decks in play for word games ("Sag's anders"). */
  decks: DeckId[];
  /** Seconds per turn in "Sag's anders". */
  turnS: number;
  /** "Sag's anders" with four players: two teams, or everyone against everyone (fewer always play alone). */
  sagsTeams: boolean;
}

/** Anything missing or broken falls back to the default, so older peers and saves still work. */
export function parseOpts(v: unknown): RoomOpts {
  const o = isObj(v) ? v : {};
  return {
    voice: o.voice !== false,
    schaffner: SCHAFFNER_MODES.includes(o.schaffner as SchaffnerMode) ? (o.schaffner as SchaffnerMode) : 'fine',
    voteS: (ROOM.voteChoices as readonly number[]).includes(o.voteS as number) ? (o.voteS as number) : ROOM.voteDefault,
    blackouts: o.blackouts !== false,
    decks: Array.isArray(o.decks) ? DECK_IDS.filter((d) => (o.decks as unknown[]).includes(d)) : ['normal', 'custom'],
    turnS: (ROOM.turnChoices as readonly number[]).includes(o.turnS as number) ? (o.turnS as number) : SAGS.turnS,
    sagsTeams: o.sagsTeams !== false,
  };
}

export interface Welcome {
  seed: number;
  startMs: number;
  /** Host clock (ms) at send time, for a first rough offset. */
  hostMs: number;
  roster: RosterEntry[];
  train: Train;
  blackoutAt: number | null;
  opts: RoomOpts;
}

export const trainDistance = (t: Train, now: number): number => t.d0 + (t.kmh / 3.6) * (now - t.t0);

export const NAME_MAX = 16;

/** Trimmed, no control characters, at most NAME_MAX characters; null if nothing is left. */
export function parseName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const clean = v.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim();
  // Spread counts code points, so an emoji is never cut in half.
  const s = [...clean].slice(0, NAME_MAX).join('').trim();
  return s || null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
const color = (v: unknown) => num(v, 0, 0xffffff);

/** Beard was a plain flag before the styles: `true` becomes the full beard it used to draw. */
function parseBeard(v: unknown): Beard {
  if (v === true) return 'vollbart';
  return BEARDS.find((b) => b === v) ?? 'none';
}

export function parseLook(v: unknown): Look | null {
  if (!isObj(v)) return null;
  const hair = HAIRSTYLES.find((h) => h === v.hair);
  const cols = [v.skin, v.hairCol, v.top, v.pants, v.shoes, v.hat].map(color);
  const flags = [v.female, v.glasses, v.short];
  if (!hair || cols.some((c) => c === null) || flags.some((f) => typeof f !== 'boolean')) return null;
  const [skin, hairCol, top, pants, shoes, hat] = cols as number[];
  const [female, glasses, short] = flags as boolean[];
  // Fields added later fall back to the old look, so saved profiles and older peers still load.
  const build = BUILDS.find((b) => b === v.build) ?? 'normal';
  const face = FACES.find((f) => f === v.face) ?? 'oval';
  const beard = parseBeard(v.beard);
  const topStyle = TOPSTYLES.find((t) => t === v.topStyle) ?? 'shirt';
  const footwear = FOOTWEAR.find((f) => f === v.footwear) ?? 'sneaker';
  const acc = color(v.acc) ?? hat;
  return { female, build, skin, hair, hairCol, top, pants, shoes, hat, glasses, beard, short, face, topStyle, footwear, acc };
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
  // A missing or broken name doesn't drop the player, they just show up unnamed.
  return { name: parseName(v.name) ?? '', look, items };
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
  return { seed: seed | 0, startMs, hostMs, roster, train, blackoutAt, opts: parseOpts(v.opts) };
}

/** Pose on the wire: [yaw, pitch], rounded to keep packets tiny. */
export const encodePose = (yaw: number, pitch: number): [number, number] => [Math.round(yaw * 1000) / 1000, Math.round(pitch * 1000) / 1000];

export function parsePose(v: unknown): { yaw: number; pitch: number } | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const yaw = num(v[0], -HEAD.maxYaw, HEAD.maxYaw);
  const pitch = num(v[1], HEAD.minPitch, HEAD.maxPitch);
  return yaw === null || pitch === null ? null : { yaw, pitch };
}
