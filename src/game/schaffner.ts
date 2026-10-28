import * as THREE from 'three';
import { Person } from '../characters/person';
import { PLAYER_SEATS, SCHAFFNER, SEAT_X } from '../config';
import { group } from '../scene/build';

/**
 * Loudness bookkeeping per player: shouting fills a bucket, quiet drains it. Full bucket = the
 * Schaffner comes. The drain rate makes "loudS of shouting within windowS" the trigger.
 */
export class LoudTracker {
  private bucket = new Map<string, number>();
  private lastCall = new Map<string, number>();

  /** Feed one frame; returns the id to call the Schaffner for, if any. */
  feed(levels: Map<string, number>, dt: number, nowS: number): string | null {
    const drain = SCHAFFNER.loudS / Math.max(0.1, SCHAFFNER.windowS - SCHAFFNER.loudS);
    let caught: string | null = null;
    for (const [id, level] of levels) {
      let b = this.bucket.get(id) ?? 0;
      b = Math.max(0, Math.min(SCHAFFNER.loudS, b + (level >= SCHAFFNER.loudLevel ? dt : -dt * drain)));
      this.bucket.set(id, b);
      if (b >= SCHAFFNER.loudS && nowS - (this.lastCall.get(id) ?? -Infinity) > SCHAFFNER.cooldownS) {
        this.lastCall.set(id, nowS);
        this.bucket.set(id, 0);
        caught ??= id;
      }
    }
    return caught;
  }
}

/** The conductor himself: a figure in uniform who appears in the aisle next to the loud one. */
export class SchaffnerFigure {
  private root: THREE.Group;
  private person: Person;
  private until = 0;
  private faceYaw = 0;

  constructor(coach: THREE.Object3D) {
    this.root = group('schaffner', coach);
    this.root.position.y = 0.9;
    this.person = new Person(
      this.root,
      {
        female: false,
        build: 'kraeftig',
        skin: 0xc68f63,
        hair: 'muetze',
        hairCol: 0x2b2118,
        top: 0x1b2a4a,
        pants: 0x15171d,
        shoes: 0x1a1a1a,
        hat: 0x1b2a4a,
        glasses: true,
        beard: true,
        short: false,
      },
      'stand',
    );
    // Raised forearm: the admonishing finger.
    this.person.armOverride = { R: 'phone' };
    this.person.handSide = null;
    this.person.settle();
    this.root.traverse((o) => {
      if (o.userData.role === 'player') o.userData.role = 'npc';
    });
    this.root.visible = false;
  }

  /** Stand in the aisle beside `seat`, turned towards it. */
  show(seat: number, nowS: number): void {
    const s = PLAYER_SEATS[seat];
    if (!s) return;
    this.root.position.set(s.side * 0.42, 0.9, s.z + (s.z < 0 ? -0.55 : 0.55));
    const target = new THREE.Vector3(s.side * SEAT_X, 0, s.z);
    this.faceYaw = Math.atan2(target.x - this.root.position.x, target.z - this.root.position.z);
    this.root.rotation.y = this.faceYaw;
    this.until = nowS + SCHAFFNER.showS;
    this.root.visible = true;
  }

  update(nowS: number, dt: number): void {
    if (!this.root.visible) return;
    if (nowS > this.until) {
      this.root.visible = false;
      return;
    }
    // Looks down at the seated player, shaking his head a little.
    this.person.update(dt, nowS, 0.25 * Math.sin(nowS * 5), 0.35, 4, 0);
  }
}
