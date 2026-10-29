// Diner tuning. Map-local on purpose: src/config.ts belongs to the hypertrain and the shared parts.

/** Room layout in metres. Window wall on -x, counter and kitchen on +x, booths along the windows. */
export const ROOM = {
  winX: -3.6,
  backX: 3.0,
  kitchenX: 4.9,
  zMin: -3.6,
  zMax: 3.6,
  height: 2.9,
  /** Window glass between these heights. */
  sillY: 0.8,
  lintelY: 2.6,
} as const;

/** Booth rows: centres along z. The players sit in the middle one. */
const BOOTH_PITCH = 2.35;
const TABLE_X0 = -3.56;
const TABLE_X1 = -1.9;
export const BOOTH = {
  centres: [-BOOTH_PITCH, 0, BOOTH_PITCH],
  /** Distance between booth centres; the backrests of neighbouring booths meet halfway. */
  pitch: BOOTH_PITCH,
  /** Bench rows sit this far from the booth centre (facing players 2 x this apart). */
  benchOff: 0.8,
  /** Bench cushion and backrest extents in z, measured from the booth centre. */
  seatFront: 0.55,
  seatBack: 1.04,
  backOut: BOOTH_PITCH / 2,
  /** Seat x positions along each bench, window side first (neighbours 0.85 m apart). */
  seatX: [-3.25, -2.4],
  tableX0: TABLE_X0,
  tableX1: TABLE_X1,
  /** Table centre along x: pole, pendant lamp and the plate sit here. */
  tableCx: (TABLE_X0 + TABLE_X1) / 2,
  tableHalfZ: 0.45,
  tableTop: 0.76,
  seatTop: 0.525,
} as const;

export const COUNTER = {
  frontX: 1.0,
  backX: 1.45,
  /** The top overhangs the body towards the stools and the walkway. */
  topX0: 0.76,
  topX1: 1.56,
  top: 1.05,
  z0: -2.7,
  z1: 2.5,
  stoolX: 0.4,
  stoolTop: 0.75,
  stoolZ: [-2.0, -1.2, -0.4, 0.4, 1.2, 2.0],
  /** Back counter against the kitchen wall. */
  backCounterX: 2.4,
  backCounterTop: 0.92,
  /** Pass-through window in the kitchen wall. */
  passZ0: -1.0,
  passZ1: 0.7,
  passY0: 1.1,
  passY1: 1.9,
} as const;

/** The sill under the hatch, where the cook slams plates and the bell sits. */
export const SILL = { x: 3.0, y: COUNTER.passY0, bellZ: 0.45 } as const;

export const COLORS_DINER = {
  background: 0x04060c,
  vinyl: 0xb3141e,
  vinylDark: 0x6e0b12,
  formica: 0x9fd6c9,
  chrome: 0xc9ced6,
  wallLow: 0x2f8f8a,
  wallHigh: 0xb8a684,
  ceiling: 0x857c6c,
  kitchenWall: 0xc9d2cf,
  asphalt: 0x14161a,
  signPink: 0xff2f6a,
  signCyan: 0x34e6ff,
  jukeboxAmber: 0xffa335,
} as const;

/**
 * Lights in the prototype's units (see LIGHTS in src/config.ts); four point lights and the
 * hemisphere, scaled by the global preset so "hell" still brightens the diner.
 */
export const DINER_LIGHT = {
  hemi: 0.03,
  pendant: 1.2,
  counter: 0.7,
  kitchen: 1.0,
  street: 3,
  /** HDR factor on the glowing parts (relative to LIGHTS.neonTubeHdr). */
  glow: 1.0,
} as const;

export const SIGN = {
  name: 'BRÄTLINGSHOF',
  sub: '24h · DINER',
  /** Each window may contain one dying letter. */
  windowS: 23,
  chance: 0.7,
  /** The letter is dark for this long after its stutter. */
  minOffS: 2.5,
  maxOffS: 7,
} as const;

/** The deep-fryer flare: one per window with this chance, lasting `durS`. */
export const FRYER = {
  windowS: 64,
  chance: 0.75,
  durS: 7,
  /** Smoke-detector beeps (seconds after the flare starts). */
  beeps: [2.2, 2.75, 3.3],
  beepS: 0.28,
} as const;

/** Seconds per cook routine; the bell rings once per routine. */
export const COOK_LOOP_S = 19;
/** Within the cook loop, the moment the bell is hit. */
export const COOK_BELL_AT = 14.2;

export const CAMERA_DINER = {
  pos: [-0.55, 2.0, 1.6] as const,
  look: [-2.95, 1.2, -0.25] as const,
  fov: 62,
};

/** Shake factor: a static room; only the fridge compressor hums. */
export const DINER_SHAKE = 0.08;
