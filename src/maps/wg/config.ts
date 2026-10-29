// WG living room: every map-specific number lives here, so tuning never touches src/config.ts.

/**
 * Room box in metres. Altbau: the ceiling is high, the sofa wall is the left wall (x = minX), pushed
 * out far enough that the wider seat ring still leaves the sofa its full depth.
 */
export const ROOM = {
  minX: -1.5,
  maxX: 2.5,
  minZ: -3.0,
  maxZ: 3.0,
  height: 3.3,
  /** Door to the hallway in the right wall (z range, height). */
  doorZ: [-2.25, -1.3] as const,
  doorH: 2.35,
  /** Tall window in the back wall (x centre, width, sill and lintel height). */
  winX: 0.55,
  winW: 1.2,
  winY0: 0.85,
  winY1: 2.95,
} as const;

/**
 * Seat surfaces. A worn sofa and a bean bag sit lower than a chair (0.525); the seated rig reaches
 * 0.49 below its root, so much lower would push the feet through the floor.
 */
export const SEAT = {
  sofaY: 0.46,
  armchairY: 0.5,
  beanY: 0.41,
  /** Hip joints this far from the table centre: 1.76 m across the table, 1.0 m between neighbours. */
  x: 0.88,
  z: 0.5,
} as const;

export const TABLE = { w: 0.65, d: 1.3, h: 0.42 } as const;

export const COL = {
  background: 0x07080d,
  fog: 0x07080d,
  wallpaper: 0xb9ab92,
  ceiling: 0xd8d2c4,
  stucco: 0xe4ded0,
  skirting: 0xe8e2d4,
  floorTint: 0xffffff,
  sofa: 0x8a4a22,
  sofaDark: 0x6b3518,
  armchair: 0x2f5a46,
  bean: 0x7a2b3c,
  teak: 0x5a3418,
  frame: 0xe9e4d8,
  radiator: 0xd9d4c6,
  mattress: 0xc9c1ae,
  blanket: 0x3c4f78,
  tvCase: 0x2a2622,
  metal: 0x9a9890,
  black: 0x141414,
  plant: 0x2f6b34,
  pot: 0xa0522d,
  candle: 0xf0e6cc,
  hallway: 0x6d6456,
  cat: 0x8a5a32,
} as const;

/** Values in the same prototype units as LIGHTS (scaled by LIGHT_SCALE / POINT_LIGHT_SCALE). */
export const WG_LIGHT = {
  hemiSky: 0x8a7468,
  hemiGround: 0x1c140f,
  /** The paper-ball lamp's light lives in the hemisphere fill (one real light fewer). */
  hemi: 0.05,
  candle: 0.55,
  candleDist: 4.5,
  tv: 0.7,
  tvDist: 5,
  street: 1.4,
  streetDist: 7,
  fairy: 0.9,
  fairyDist: 4.5,
  /** HDR multipliers for things that should cross the bloom threshold. */
  fairyHdr: 3.2,
  lavaHdr: 2.6,
  paperHdr: 0.6,
  flameHdr: 5,
  streetLampHdr: 6,
  tvHdr: 1.35,
} as const;

/** The fuse ("Sicherung fliegt raus"): same shape as BLACKOUT, but rarer than in the train. */
export const FUSE = { windowS: 53, chance: 0.3, minS: 1.5, maxS: 4 } as const;

/**
 * The downstairs neighbour knocks: each window of `windowS` has `chance` of one knock, starting at
 * least `leadS` in. Timeline (seconds after the first thud) below.
 */
export const KNOCK = {
  windowS: 61,
  chance: 0.6,
  leadS: 6,
  /** Whole event, thuds to the bass being back at full volume. */
  durationS: 22,
  thuds: [0, 0.42, 0.84] as const,
  shoutAt: 1.35,
  /** Everyone holds still between these (eased). */
  freeze: [0.25, 7.5] as const,
  /** Fairy lights out (loose contact gives up) and back. */
  lightsOff: [0.35, 9.5] as const,
  /** Bass cut, then fading back in. */
  bassOff: 1.9,
  bassBack: [12, 19] as const,
} as const;

/** A lava blob tears off the bottom and drifts to the top. */
export const LAVA = { windowS: 47, chance: 0.6, durationS: 16, blobs: 4 } as const;

/** Neighbour's party: four-on-the-floor through two walls. */
export const MUSIC = { bpm: 122, gain: 0.16, wallCutoff: 190 } as const;
