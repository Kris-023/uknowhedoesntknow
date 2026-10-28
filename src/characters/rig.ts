import type * as THREE from 'three';

/** Anchor slots where accessories attach. Hand items go to the hand on `Person.handSide`. */
export type Slot = 'head' | 'hand' | 'arm' | 'hip';
export type AnchorName = 'head' | 'handL' | 'handR' | 'arm' | 'hip';

export type ArmSide = 'L' | 'R';
export type ArmPoseName = 'hang' | 'lap' | 'hold' | 'phone' | 'paper' | 'beer' | 'drink';

/**
 * Arm angles: s = shoulder pitch (negative = forward), e = elbow bend (negative = bend),
 * z = abduction away from the body.
 */
export const ARMPOSE: Record<ArmPoseName, { s: number; e: number; z: number }> = {
  hang: { s: 0.04, e: -0.14, z: 0.1 },
  lap: { s: -0.35, e: -0.7, z: 0.1 },
  hold: { s: -0.8, e: -1.3, z: 0.1 },
  phone: { s: -0.95, e: -1.6, z: 0.05 },
  paper: { s: -1.25, e: -0.95, z: 0.0 },
  beer: { s: -0.55, e: -1.45, z: 0.08 },
  drink: { s: -0.9, e: -2.35, z: 0.05 },
};

export interface Arm {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  hand: THREE.Group;
  /** Mid-forearm point where bags hang from. */
  bag: THREE.Group;
  /** +1 left, -1 right (mirrors abduction). */
  sd: number;
  s: number;
  e: number;
  z: number;
  /** Extra elbow offset for small motions (thumb scrolling). */
  bob: number;
  /** Extra abduction from the body build, so heavy arms clear the belly. */
  spread: number;
  /** 'free' keeps the hand level with gravity; 'fixed' holds `base` (bottles tilt with the arm). */
  mode: 'free' | 'fixed';
  base: number;
}

/**
 * The shared skeleton every character style provides: root > torso > head, a mouth that opens with
 * the voice level (rotation.x, negative = open), and named anchors. Gameplay code only ever talks to
 * this interface, so a glTF model can replace the procedural body later by mapping its bones to the
 * same names.
 */
export interface Rig {
  torso: THREE.Group;
  head: THREE.Group;
  mouth: THREE.Object3D;
  arms: Record<ArmSide, Arm> | null;
  anchors: Record<AnchorName, THREE.Object3D>;
  /** Hidden for the local player in POV, so the camera can sit inside the head. */
  povHide: THREE.Object3D;
  /** Eye position in head space, for the POV camera. */
  eye: THREE.Vector3;
}
