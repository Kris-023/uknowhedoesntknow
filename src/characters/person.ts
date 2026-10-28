import * as THREE from 'three';
import { HEAD, MOUTH } from '../config';
import { ITEMS, SLOTS, type ItemDef, type ItemId } from './accessories';
import { rigHuman, type BodyPose } from './human';
import { warpMeshes } from './face';
import { mergeStatic } from './merge';
import type { Look } from './look';
import { ARMPOSE, type ArmPoseName, type ArmSide, type Rig, type Slot } from './rig';

/** What gets synced per person in M3: only IDs and numbers, never geometry. */
export interface PersonState {
  /** Display name, shown above the head (players only; NPCs leave it empty). */
  name: string;
  look: Look;
  items: Partial<Record<Slot, ItemId>>;
}

/**
 * Free GPU buffers that belong to this one figure (merged and face-warped geometry, per-figure
 * materials). Shared unit primitives and cached materials/textures carry no `owned` flag and stay.
 */
function disposeOwned(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.geometry.userData.owned) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) if (mat.userData.owned) mat.dispose();
  });
}

/**
 * A character in the coach (player now, NPC in M5). Owns the rig, equipped items and the smoothed
 * head/torso state. Head yaw comes from outside (mouse, network, script); torso follow-through,
 * arm poses and mouth are computed locally and never sent.
 */
export class Person {
  rig!: Rig;
  readonly items: Partial<Record<Slot, ItemId>> = {};
  private itemObjs: Partial<Record<Slot, THREE.Group>> = {};
  /** Hand that holds hand items; null when both hands are busy (newspaper). */
  handSide: ArmSide | null = 'R';
  /** Forced arm poses, e.g. an NPC holding a phone. */
  armOverride: Partial<Record<ArmSide, ArmPoseName>> = {};
  /** Smoothed total yaw (head + torso), torso share, pitch (positive = looking down), lean. */
  yaw = 0;
  private torsoYaw = 0;
  pitch = 0;
  lean = 0;
  /** Smoothed mouth opening 0..1. */
  private open = 0;
  name = '';
  /** The body was built with hair styled for a hat. */
  private hatHair = false;

  constructor(
    readonly root: THREE.Group,
    public look: Look,
    readonly pose: BodyPose,
  ) {
    this.rebuild();
  }

  /** Rebuild the body (after a look change) and re-attach items to the new anchors. */
  rebuild(): void {
    for (const c of [...this.root.children]) {
      if (c.userData.keep) continue;
      this.root.remove(c);
      disposeOwned(c);
    }
    const head = this.items.head;
    this.hatHair = !!head && !!(ITEMS[head] as ItemDef).underHat;
    this.rig = rigHuman(this.root, this.look, this.pose, this.hatHair);
    mergeStatic(this.root);
    this.itemObjs = {};
    for (const s of SLOTS) {
      const id = this.items[s];
      delete this.items[s];
      if (id) this.equip(id);
    }
  }

  setLook(look: Look): void {
    this.look = look;
    this.rebuild();
  }

  equip(id: ItemId): void {
    const def = ITEMS[id] as ItemDef | undefined;
    // Callers that roll from an empty slot list (no hip items any more) hand in undefined.
    if (!def) return;
    // Hats need the hair styled to fit under them (and back when the hat comes off): rebuild then.
    if (def.slot === 'head' && !!def.underHat !== this.hatHair) {
      this.removeObj('head');
      this.items.head = id;
      this.rebuild();
      return;
    }
    this.removeObj(def.slot);
    const anchor = this.anchorFor(def.slot);
    if (!anchor) return;
    const obj = def.build({ look: this.look, fit: this.rig.fit });
    mergeStatic(obj);
    anchor.add(obj);
    if (def.underHat) this.fitHat(obj);
    this.items[def.slot] = id;
    this.itemObjs[def.slot] = obj;
  }

  unequip(slot: Slot): void {
    this.removeObj(slot);
    delete this.items[slot];
    if (slot === 'head' && this.hatHair) this.rebuild();
  }

  /**
   * Bend a hat with the face-shape warp, exactly like the hair under it. Hats are modelled on the
   * base head, so the item is first moved to the base anchor; the skull is closed meanwhile.
   */
  private fitHat(obj: THREE.Object3D): void {
    const { warp, hatBase, head, mouth } = this.rig;
    if (!warp || !hatBase) return;
    const parent = obj.parent!;
    obj.position.copy(hatBase).sub(parent.position);
    const open = mouth.rotation.x;
    mouth.rotation.x = 0;
    warpMeshes(obj, warp, head);
    mouth.rotation.x = open;
  }

  private removeObj(slot: Slot): void {
    const obj = this.itemObjs[slot];
    if (obj) disposeOwned(obj);
    obj?.removeFromParent();
    delete this.itemObjs[slot];
  }

  toggle(id: ItemId): void {
    const slot = ITEMS[id].slot;
    if (this.items[slot] === id) this.unequip(slot);
    else this.equip(id);
  }

  private anchorFor(slot: Slot): THREE.Object3D | null {
    const A = this.rig.anchors;
    if (slot === 'hand') return this.handSide === 'L' ? A.handL : this.handSide === 'R' ? A.handR : null;
    return A[slot];
  }

  private armPose(n: ArmSide): ArmPoseName {
    const o = this.armOverride[n];
    if (o) return o;
    // Holding something pulls the arm up into the holding pose automatically.
    if (this.items.hand && this.handSide === n) return 'hold';
    return this.pose === 'stand' ? 'hang' : 'lap';
  }

  /**
   * Advance pose by dt. `targetYaw`/`targetPitch` are where the head should point; `rate` is how
   * fast it gets there (slow for the comic look-to-neighbour, fast for the local POV);
   * `level` is the voice level 0..1 for the mouth.
   */
  update(dt: number, t: number, targetYaw: number, targetPitch: number, rate: number, level: number): void {
    const k = 1 - Math.exp(-dt * rate);
    this.yaw += (targetYaw - this.yaw) * k;
    this.yaw = Math.max(-HEAD.maxYaw, Math.min(HEAD.maxYaw, this.yaw));
    this.pitch += (targetPitch - this.pitch) * k;

    // Torso follows only beyond the comfortable head range, and lags behind.
    const excess = Math.max(0, Math.abs(this.yaw) - HEAD.torsoFollowFrom) * HEAD.torsoShare;
    const torsoTarget = Math.sign(this.yaw) * Math.min(HEAD.torsoMax, excess);
    this.torsoYaw += (torsoTarget - this.torsoYaw) * (1 - Math.exp(-dt * HEAD.torsoRate));

    const { torso, head, mouth } = this.rig;
    torso.rotation.y = this.torsoYaw;
    torso.rotation.x = 0.1 * Math.min(1, Math.abs(this.yaw) / 1.2) + this.lean;
    head.rotation.order = 'YXZ';
    head.rotation.y = this.yaw - this.torsoYaw;
    head.rotation.x = this.pitch;
    const target = Math.pow(Math.max(0, Math.min(1, level)), MOUTH.curve);
    const mouthRate = target > this.open ? MOUTH.attack : MOUTH.release;
    this.open += (target - this.open) * (1 - Math.exp(-dt * mouthRate));
    mouth.rotation.x = -this.open * MOUTH.maxOpen;

    this.animateArms(dt);
    for (const s of SLOTS) {
      const tick = this.itemObjs[s]?.userData.tick as ((t: number) => void) | undefined;
      tick?.(t);
    }
  }

  private animateArms(dt: number): void {
    const arms = this.rig.arms;
    if (!arms) return;
    const k = 1 - Math.exp(-dt * 6);
    const tx = this.rig.torso.rotation.x;
    for (const n of ['L', 'R'] as const) {
      const a = arms[n];
      const P = ARMPOSE[this.armPose(n)];
      a.s += (P.s - a.s) * k;
      a.e += (P.e - a.e) * k;
      a.z += (P.z - a.z) * k;
      a.shoulder.rotation.x = a.s;
      a.shoulder.rotation.z = a.sd * (a.z + a.spread);
      a.elbow.rotation.x = a.e + a.bob;
      // Counter-rotate so held items stay upright regardless of the arm angle.
      const level = -(tx + a.s + a.e + a.bob);
      a.bag.rotation.x = level;
      a.hand.rotation.x = a.mode === 'fixed' ? a.base : level;
    }
  }

  /** Snap straight to the target pose (no smoothing), e.g. right after spawning. */
  settle(): void {
    for (let i = 0; i < 6; i++) this.update(0.5, 0, this.yaw, this.pitch, 6, 0);
  }

  state(): PersonState {
    return { name: this.name, look: { ...this.look }, items: { ...this.items } };
  }
}
