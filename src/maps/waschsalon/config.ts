// Every number of the laundromat in one place. Units: metres, seconds, radians; light values in the
// same prototype units as src/config.ts (scaled by LIGHT_SCALE / POINT_LIGHT_SCALE).

export const WS = {
  room: {
    /** Inner walls: shop window on the left (x−), machines on the right (x+), back wall z−. */
    left: -2.8,
    right: 2.8,
    back: -3.2,
    front: 3.7,
    height: 2.7,
  },
  colors: {
    background: 0x05070b,
    floorA: '#3c4148',
    floorB: '#2c3036',
    tileWall: '#9aa4a1',
    paint: 0x4c5a58,
    ceiling: 0x6a6f72,
    enamel: 0xb4b9b8,
    panel: 0x9aa0a4,
    chrome: 0xb9c0c6,
    drum: 0x24282c,
    glass: 0x9fc4d8,
    chair: 0xd0632a,
    chairAlt: 0x2f7f86,
    table: 0xc8c4b8,
    frame: 0x2a2e33,
    coin: 0x3a4a3e,
    tube: 0xd6f0ff,
    sign: 0xff3d8b,
    sodium: 0xff9248,
    led: 0x47ff9a,
    ledIdle: 0xff3020,
  },
  /** Seats: plastic chairs on both long sides of the folding table, seat 0 faces seat 1, 2 faces 3. */
  seat: { x: 0.85, z: 0.5, y: 0.525 },
  table: { w: 1.1, l: 1.9, h: 0.72 },
  /** Right wall: stacked washer (bottom) + dryer (top) columns along z; `eventCol` holds the lone imbalance washer. */
  stack: { z: [-1.95, -1.2, -0.45, 0.3, 1.05, 1.8, 2.55], eventCol: 3, depth: 0.62, w: 0.68, washerH: 0.86, dryerH: 0.8 },
  /** Back wall, from left to right: coin changer, notice board, two washers, two big dryers. */
  back: { coinX: -2.2, boardX: -1.25, washerX: -0.35, eventX: 0.4, dryerX: [1.2, 1.95], bigDryerH: 1.0 },
  /** Folding counter under the front part of the shop window. */
  counter: { x: -2.42, z0: 0.9, z1: 2.9, h: 0.9, d: 0.55 },
  windowZ: [-2.7, 2.95] as const,
  /** Laundry porthole radius (glass) and rim. */
  porthole: { r: 0.2, rim: 0.035 },
  /** Washer program: tumble one way, pause, the other way. Dryer just turns. */
  tumble: { washS: 7, pauseS: 2.2, washRate: 2.4, dryRate: 3.1, cycleS: 260, busy: 0.72 },
  /** The imbalance: one per window with `chance`; ramp, rage, settle, then the fuse goes. */
  imbalance: { windowS: 64, chance: 0.6, rampS: 3, rageS: 6.5, settleS: 4, fuseDelayS: 0.9, creep: 0.28, minStart: 9 },
  /** Light: ≤ 4 point lights + hemisphere; prototype units, multiplied like the coach's. */
  light: {
    hemi: 0.03,
    table: 0.75,
    machines: 0.6,
    street: 0.7,
    coin: 0.35,
    tubeHdr: 1.0,
    signHdr: 2.2,
    ledHdr: 1.6,
    lampHdr: 2.6,
  },
  /** Camera shake factor: barely anything, except while the machine rages. */
  shake: { base: 0.06, rage: 0.6 },
  /** The ceiling tube that hums and flickers (index into the tube list). */
  badTube: 3,
  clock: { startMin: 3 * 60 + 7 },
  overview: { pos: [0.55, 2.15, 3.45] as const, look: [-0.15, 0.8, -0.7] as const, fov: 64 },
  sound: {
    hum: 0.012,
    slosh: 0.03,
    buzz: 0.006,
    rain: 0.035,
    beep: 0.03,
    rumble: 0.22,
    /** Dryer button beeps: one chance per window. */
    beepWindowS: 19,
    beepChance: 0.55,
  },
} as const;
