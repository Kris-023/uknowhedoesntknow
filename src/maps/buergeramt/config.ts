// Bürgeramt constants. Kept here, not in src/config.ts: every map owns its own numbers.

/** Hall: x from -W/2 to W/2, z from back wall (counters) to front wall (entrance). */
/** Number display, hanging in front of the counters. */
export const LED = { y: 2.38, z: -3.3 } as const;

/** Yucca pot position. */
export const YUCCA = { x: 3.95, z: -0.95 } as const;

export const HALL = { w: 10, back: -5, front: 4.5, h: 3 } as const;

export const COLORS = {
  background: 0x07080b,
  floor: '#6d6a60',
  wallLow: '#56645c',
  wallHigh: '#a39f8e',
  ceiling: '#8f8c82',
  chair: 0x3d6f73,
  chairMetal: 0x6c7076,
  counter: 0x8a7a5c,
  counterTop: 0x5d564a,
  darkPlastic: 0x1d1f23,
  door: 0x6f675a,
  /** Fluorescent tube: slightly green like old ballast tubes. */
  tube: 0xe8fff2,
  tubeLight: 0xd6ecdf,
  counterLight: 0xcfe6d6,
  led: 0xff2a10,
  ledLight: 0xff3018,
  emergency: 0x7dffb0,
  exit: 0x19e36a,
} as const;

/** Light gains in prototype units; scaled by LIGHT_SCALE / POINT_LIGHT_SCALE like the coach. */
export const LIGHT = {
  hemi: 0.08,
  /** Over the waiting chairs and over the counters. */
  waiting: 0.55,
  counter: 0.45,
  /** Red spill from the number display. */
  led: 0.35,
  /** The flickering tube's own light. */
  flicker: 0.35,
  /** Emergency light during the system failure. */
  emergency: 1.1,
  /** Multiplier on LIGHTS.neonTubeHdr: tubes and LED cross the bloom threshold, walls don't. */
  tubeHdr: 0.45,
  ledHdr: 2.2,
  screenHdr: 0.6,
  exitHdr: 1.6,
} as const;

/** Fixture grid (x, z); `off` are dead tubes, `flicker` is the one that can't decide. */
export const FIXTURES: readonly { x: number; z: number; state: 'on' | 'off' | 'flicker' }[] = [
  { x: -3, z: -3.2, state: 'on' },
  { x: 0, z: -3.2, state: 'on' },
  { x: 3, z: -3.2, state: 'off' },
  { x: -3, z: -0.2, state: 'flicker' },
  { x: 0, z: -0.2, state: 'on' },
  { x: 3, z: -0.2, state: 'on' },
  { x: -3, z: 2.6, state: 'off' },
  { x: 0, z: 2.6, state: 'off' },
  { x: 3, z: 2.6, state: 'off' },
];

/** Counters along the back wall; Schalter 1 is closed, 3 has a clerk, 2 is staffed by nobody. */
export const COUNTERS = { x: [-2.9, 0, 2.9], z: -4.2, closed: 0 } as const;

/**
 * Waiting chairs: two bolted rows facing each other across x (1.8 m apart), 0.6 m chair pitch.
 * Players take chairs `seats` (one empty chair between them, 1.2 m), the rest stay empty.
 */
export const ROWS = { x: 0.9, chairZ: [-1.2, -0.6, 0, 0.6, 1.2], seats: [1, 3], seatTop: 0.525 } as const;

/** Queue in front of Schalter 3; the back two shuffle on a clock cycle. */
export const QUEUE = {
  x: 2.9,
  z: [-3.25, -2.5, -1.8],
  cycleS: 26,
  /** Step forward early in the cycle, back again later (personal space wins). */
  step: 0.32,
} as const;

/** Number display: a new number every `stepS`, announced on some of them (never more than every 40 s). */
export const NUMBERS = {
  stepS: 17,
  /** Absurd call order. The players' own number (`mine`) is never in it. */
  pool: ['0815', '4711', '0003', '9999', '0042', '0007', '1001', '0123', '2000', '0404', '5555', '0012', '3333', '1234', '0099', '7777', '0110', '8080'],
  mine: '4712',
  announceEvery: 3,
  announceChance: 0.55,
} as const;

/** Systemausfall: power windows like the coach blackout, but longer; screens stay blue after it. */
export const FAILURE = {
  /** About one failure every four to five minutes: a signature event, not the weather. */
  windowS: 120,
  chance: 0.45,
  minS: 3,
  maxS: 6,
  /** Screens blue and display at 0001 for this long after the power stuttered. */
  holdS: 9,
} as const;

/** Official with the mug: walks between two doors and turns away from each one. */
export const OFFICIAL = { x: -4.15, z: [-2.3, 2.5], walkS: 7, pauseS: 4 } as const;

/** Form filler: one form, forever; starts over every `cycleS`. */
export const FORM = { x: -2.6, z: 1.3, cycleS: 21 } as const;

export const CAMERA = { pos: [2.1, 2.35, 4.1], look: [0.2, 1.0, -1.4], fov: 62 } as const;

/** Ambient one-offs: [window s, chance, duration s, hash salt]. Window lengths are coprime-ish so they rarely stack. */
export const ONE_OFFS = {
  printer: [23, 0.6, 1.4, 70],
  glug: [31, 0.75, 1.2, 40],
  ticket: [19, 0.5, 0.6, 60],
} as const;
