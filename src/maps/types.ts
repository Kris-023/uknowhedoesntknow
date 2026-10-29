import type * as THREE from 'three';

// A map is the place the players sit in: its geometry, light, extras and sounds. Everything in it
// is a pure function of the shared clock and the room seed, like the hypertrain before it, so
// maps never need network traffic. People (players, NPCs, the Schaffner) are placed by the world
// on the spots a map hands out.

export const MAP_IDS = ['hypertrain', 'waschsalon', 'buergeramt', 'spaeti', 'wg', 'diner'] as const;
export type MapId = (typeof MAP_IDS)[number];

/** Where a person's root goes. Seated: y = seat height (0.525 for a normal chair), facing +z of `yaw`. */
export interface Spot {
  x: number;
  y: number;
  z: number;
  /** Rotation about y; 0 faces +z. */
  yaw: number;
}

/** What an NPC does, all driven by the clock: phone, newspaper, drinking, sleeping. */
export type NpcAct = 'phone' | 'paper' | 'beer' | 'sleep';

export interface NpcSpot {
  act: NpcAct;
  /** Beer from a can instead of a bottle. */
  can?: boolean;
  /** Seated on this spot, or standing (feet on the floor at y = 0). */
  pose: 'sit' | 'stand';
  at: Spot;
}

/** Per-frame inputs from the world; maps use what they need. */
export interface FrameCtx {
  /** Clock time in seconds (shared by all clients). */
  t: number;
  dt: number;
  /** Hypertrain speed (km/h) and distance; other maps may read it as "how busy". */
  kmh: number;
  distance: number;
  /** Room setting: random power failures; and a forced one (debug/host) at this clock time. */
  blackouts: boolean;
  forcedBlackoutAt: number;
  camera: THREE.Camera;
}

export interface MapScene {
  /** Parent of everything the world adds (people sit in this space). */
  readonly root: THREE.Object3D;
  /** The four player seats, in seat-index order (0 and 1 face each other). */
  readonly seats: readonly Spot[];
  readonly npcs: readonly NpcSpot[];
  /** Where the Schaffner (or the map's equivalent) stands to tell seat `i` off; feet on the floor. */
  scoldSpot(i: number): Spot;
  /** Overview camera when not in first person. */
  readonly overview: { pos: readonly [number, number, number]; look: readonly [number, number, number]; fov: number };
  /** Supply 0..1 after the last update: drives the relay clunk and the frame tracer's "Stromausfall". */
  power: number;
  /** Labels of what's going on this frame for the stutter recorder (e.g. "Gegenzug"). */
  events(): string[];
  /** Camera shake amplitude factor (the coach rattles, a laundromat barely does). */
  readonly shake: number;
  /** Degrees the field of view widens at full train speed; only for maps that move (default 0). */
  readonly speedFov?: number;
  update(f: FrameCtx): void;
}

/**
 * Map sounds: three channels the player can set apart (ambience, music, announcements), a noise
 * buffer and a speaker for gong + announcements.
 */
export interface SoundKit {
  readonly ctx: AudioContext;
  /** One-off noises of the map (bell, knocking, beeps, the fuse); follows the "Umgebung" volume. */
  readonly out: AudioNode;
  /** Steady layers that run all the time (rumble, fryer, rain, hum); "Ruhige Umgebung" turns it down. */
  readonly bed: AudioNode;
  /** Music (jukebox, the party next door); own volume and switch. */
  readonly music: AudioNode;
  /** Two seconds of white noise to loop or slice. */
  readonly noise: AudioBuffer;
  /** Short noise burst starting at `at` (seconds, AudioContext time). */
  burst(at: number, dur: number): AudioBufferSourceNode;
  /** Ceiling-speaker chime, then a spoken line (browser speech). `important` speaks even with announcements off. */
  announce(text: string, important?: boolean): void;
  /** Relay/fuse clunk. */
  clunk(gain: number): void;
}

export interface MapSound {
  /** Per frame while the room is open. */
  update(t: number, power: number, kmh: number): void;
}

export interface MapDef {
  id: MapId;
  name: string;
  /** One line for the map picker. */
  blurb: string;
  build(scene: THREE.Scene, seed: number): MapScene;
  sound(kit: SoundKit, seed: number): MapSound;
}
