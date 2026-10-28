// Central tuning constants. Everything that defines the look or the feel lives here,
// so the group can tweak the train in one place instead of hunting through scene code.

/** Coach dimensions in metres. The coach stays at the origin; only the tunnel moves. */
export const COACH = {
  width: 3.0,
  length: 10.6,
  height: 2.5,
  wallX: 1.55,
  /** Ceiling side panels tilt by this angle (rad) to form the chamfered roof. */
  ceilingSlope: 0.364,
} as const;

/** Wall seats: 8 per side, 0.9 m apart. Seat index 4..5 on each side are the player seats. */
export const SEAT_Z = [-3.15, -2.25, -1.35, -0.45, 0.45, 1.35, 2.25, 3.15] as const;
export const SEAT_X = 1.17;

/** The four player seats (two facing pairs across the aisle). */
export const PLAYER_SEATS = [
  { side: -1, z: -0.45 },
  { side: -1, z: 0.45 },
  { side: 1, z: -0.45 },
  { side: 1, z: 0.45 },
] as const;

export const COLORS = {
  /** Near-black with a hint of blue, so the fog swallows the neighbouring coaches into night. */
  background: 0x010208,
  backgroundSight: 0x04101a,
  neon: 0x1c38f0,
  neonLight: 0x2a46ff,
  pale: 0xaab3bd,
  bulkhead: 0x9aa3ad,
  gangway: 0x24272d,
  seat: 0x8f8878,
  seatFoot: 0x6e695c,
  players: [0xffb224, 0x4fd8ff, 0xff5fa8, 0x9bff7a],
} as const;

/**
 * three.js r155+ uses physical light units. The prototype ran on r128 legacy lights, whose shaders
 * multiplied direct light by PI. Scaling here keeps the prototype's numbers readable.
 * Point lights get less: physical falloff (1/d^decay) explodes within 1 m, and the neon lights hang
 * 10 to 30 cm below the ceiling, which legacy falloff (capped at 1) never did.
 */
export const LIGHT_SCALE = Math.PI;
export const POINT_LIGHT_SCALE = 0.9;

/**
 * Night-train lighting: the neon strips carry the room, everything else is a faint fill.
 * Values are in prototype units (scaled by LIGHT_SCALE / POINT_LIGHT_SCALE).
 */
export const LIGHTS = {
  hemi: 0.04,
  ceilingWhite: 0.06,
  neonBlue: 0.9,
  /** Tube colour multiplier above 1 (HDR): only the tubes cross the bloom threshold, not the walls they light. */
  neonTubeHdr: 1.9,
  window: 0.8,
  /** Leuchtrahmen in the ceiling: dimmed so they read as night lighting, not as daylight panels. */
  frameOpacity: 0.28,
} as const;

export const RENDER = {
  exposure: 0.85,
  maxPixelRatio: 2,
  fogNear: 4,
  fogFar: 40,
} as const;

/** Real bloom (post-processing). The fake halos stay for the case it is switched off. */
export const BLOOM = {
  strength: 0.8,
  radius: 0.45,
  /** Luminance threshold in linear HDR. Lit walls stay below it; HDR tubes, screens and streaks exceed it. */
  threshold: 0.28,
} as const;

export const SPEED = {
  maxKmh: 1200,
  defaultKmh: 1200,
  /** Real speed would turn streaks into a blur at 60 fps; this compresses it into readable motion. */
  visualScale: 0.12,
  /** Streak length grows with speed by this factor per scene-unit/s. */
  stretchPerUnit: 0.09,
} as const;

export const SHAKE = {
  maxMm: 30,
  defaultMm: 5,
} as const;

/**
 * Neighbouring coaches repeat in both directions; fog fades them out, which reads as infinity.
 * One period = coach (10.8 m incl. bulkheads) + gangway.
 */
export const TRAIN = {
  period: 11.6,
  gangwayLength: 0.8,
  neighboursPerSide: 3,
} as const;

/** Rare total power failure of the player coach only (neighbours and tunnel keep going). */
export const BLACKOUT = {
  /** Each window of this length has `chance` of containing one outage. */
  windowS: 37,
  chance: 0.45,
  minS: 1.2,
  maxS: 4.5,
} as const;

export const TUNNEL = {
  count: 380,
  /** The first streaks are evenly spaced rails along the window line (4 per row), the rest random debris. */
  regular: 96,
  /** Spans both directions, so streaks also pass the windows of the neighbouring coaches. */
  wrap: 96,
  front: 48,
  colors: [0x3a5bff, 0xbcd0ff, 0x6f8cff, 0xffb224, 0xbcd0ff],
  /** Visible streak core is this many times wider than the old box, because the texture fades at the edges. */
  coreWidth: 3,
  glowWidth: 7,
  glowOpacity: 0.1,
} as const;

export const CAMERA = {
  wagonPos: [0, 1.35, 4.95] as const,
  wagonLook: [0, 1.3, -3] as const,
  wagonFov: 62,
  seatFov: 74,
  /** Eye height above floor for a seated player (seat 0.525 + torso 0.62 + head 0.2). */
  seatEyeY: 1.345,
  /** Head yaw limit; slightly beyond 90 degrees so both coach ends are fully visible from a seat. */
  maxYaw: 1.75,
  mouseSensitivity: 0.0025,
} as const;

/** Halt countdown cycles with the shared clock so every peer shows the same number. */
export const HALT_CYCLE_S = 90;

export const TEXTURE_SEED = 7311;
