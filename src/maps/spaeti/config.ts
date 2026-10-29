// Späti map constants. Kept here instead of src/config.ts: every map owns its own numbers.
// Coordinates: x across the shop (fridges at -x, counter at +x), z towards the street (+z),
// y up, metres. The front window is the plane z = ROOM.front.

export const ROOM = {
  left: -3,
  right: 3,
  back: -3.4,
  front: 3,
  height: 2.7,
  /** Door gap in the front wall; the rest of the front is shop window. */
  doorX0: 1.7,
  doorX1: 2.7,
  /** Window glass from this height up to `windowTop`; below is a low wall. */
  windowSill: 0.45,
  windowTop: 2.35,
} as const;

/** The crate corner the players sit in: two facing pairs around a crate table. */
export const SEATING = {
  cx: -0.5,
  cz: 1.3,
  /** Half the distance between facing seats (1.8 m): knees need ~0.55 each plus the crate table. */
  halfX: 0.9,
  /** Half the distance between neighbours (1.0 m): shoulder room without shouting across a gap. */
  halfZ: 0.5,
  /** Two stacked crates plus a flattened box: the same 0.525 surface as a chair. */
  crateH: 0.25,
  seatY: 0.525,
} as const;

export const COUNTER = {
  /** Customer side of the counter (faces -x) and its depth towards the wall. */
  x: 1.75,
  depth: 0.6,
  z0: -2.2,
  z1: 1.2,
  height: 1.0,
  ownerX: 2.62,
  ownerZ: -0.75,
} as const;

export const FRIDGE = {
  doors: 5,
  doorW: 0.74,
  doorH: 1.9,
  z0: -3.2,
  /** Glow multiplier of the bottle panels: the backlight peaks just above the bloom threshold. */
  panelGlow: 0.32,
  ledHdr: 1.6,
} as const;

export const STREET = {
  curbZ: 6,
  roadZ1: 13,
  facadeZ: 15.5,
  laneZ: [7.6, 10.6] as const,
  lampX: -2.4,
  lampZ: 5.6,
  lampY: 4.6,
} as const;

/** Shop accent: night teal and a hot pink, nobody's trade dress. */
export const ACCENT = {
  teal: 0x14c8b4,
  pink: 0xff3d8b,
  exit: 0x22e070,
} as const;

/** Light levels before LIGHT_SCALE / POINT_LIGHT_SCALE, tuned against the "nacht" preset. */
export const SPAETI_LIGHT = {
  hemi: 0.085,
  hemiBlackout: 0.01,
  main: 0.75,
  fridge: 0.5,
  lamp: 2.5,
  car: 5,
  police: 30,
  /** Fluorescent tube colour multiplier (HDR, blooms). */
  tubeHdr: 2.2,
  /** Lit signs (header boxes) sit at the bloom threshold, so only their brightest letters glow. */
  signGlow: 0.42,
  exitHdr: 2.2,
  neonHdr: 3,
} as const;

/** Block power cuts (fuse equivalent); a bit rarer than the coach's. */
export const SPAETI_BLACKOUT = { windowS: 53, chance: 0.32, minS: 2.5, maxS: 6 } as const;

/** Slow police patrol outside: blue light, no siren. */
export const PATROL = { windowS: 47, chance: 0.5, durationS: 15, fromX: -16, toX: 16 } as const;
/** Ordinary cars sweeping their headlights through the window. */
export const CARS = { windowS: 9, chance: 0.6, durationS: 3.6, fromX: -18, toX: 18 } as const;
/** Delivery cyclist passing on the road. */
export const CYCLIST = { windowS: 31, chance: 0.55, durationS: 6, fromX: -14, toX: 14 } as const;

/** Bottle collector: walks in, returns bottles at the counter, leaves. Times within his cycle (s). */
export const COLLECTOR = {
  cycleS: 70,
  /** Shown for this long per cycle; the rest he is somewhere else in the Kiez. */
  arriveS: 7,
  enterS: 10,
  atCounterS: 13,
  leaveS: 27,
  exitS: 30,
  goneS: 37,
} as const;

/** Owner routine: counting coins, then football on the phone. */
export const OWNER = { cycleS: 23, countS: 12 } as const;
