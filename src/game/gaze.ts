import * as THREE from 'three';
import { GAZE } from '../config';
import type { Players } from './players';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Whom the view ray points at: the target with the smallest angle between `dir` and the direction
 * from `origin` to it, if that angle is at most `maxAngle` (radians). `prefer` (the current pick)
 * gets `stick` extra radians, so a pick doesn't flicker between two heads close together.
 */
export function gazePick<K>(origin: Vec3, dir: Vec3, targets: readonly { key: K; pos: Vec3 }[], maxAngle: number, prefer: K | null = null, stick = 0): K | null {
  const dl = Math.hypot(dir.x, dir.y, dir.z);
  if (!dl) return null;
  let best: K | null = null;
  let bestScore = Infinity;
  for (const t of targets) {
    const vx = t.pos.x - origin.x;
    const vy = t.pos.y - origin.y;
    const vz = t.pos.z - origin.z;
    const vl = Math.hypot(vx, vy, vz);
    if (!vl) continue;
    const cos = (vx * dir.x + vy * dir.y + vz * dir.z) / (vl * dl);
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    const bonus = prefer !== null && t.key === prefer ? stick : 0;
    if (angle > maxAngle + bonus) continue;
    const score = angle - bonus;
    if (score < bestScore) {
      bestScore = score;
      best = t.key;
    }
  }
  return best;
}

/** What a game that picks people by looking at them offers main.ts each frame. */
export interface GazeTarget {
  /** Ids I may point at right now; empty while not picking (or after locking). */
  pickable(): readonly string[];
  /** The person I'm looking at now (null: nobody). */
  aim(id: string | null): void;
  /** Locked pick to keep highlighted after picking is over, or null. */
  readonly lockedPick: string | null;
}

/**
 * The scene side of picking: reads camera and heads of the current world at call time (the world
 * is rebuilt on a map change), and a small reticle in the middle of the screen while picking.
 */
export class Gaze {
  private origin = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private heads: { key: number; pos: THREE.Vector3 }[] = [0, 1, 2, 3].map((key) => ({ key, pos: new THREE.Vector3() }));
  private targets: { key: number; pos: THREE.Vector3 }[] = [];
  private last = -1;
  readonly reticle: HTMLElement | null = null;

  /** `host` null: no reticle (tests). */
  constructor(
    private view: () => { camera: THREE.Camera; players: Players },
    host: HTMLElement | null,
  ) {
    if (!host) return;
    this.reticle = document.createElement('div');
    this.reticle.className = 'gaze-reticle';
    this.reticle.setAttribute('aria-hidden', 'true');
    this.reticle.hidden = true;
    host.append(this.reticle);
  }

  /** Seat of the head I'm looking at among `seats` (occupied ones only, never my own), or -1. */
  pick(seats: readonly number[]): number {
    const { camera, players } = this.view();
    camera.getWorldPosition(this.origin);
    camera.getWorldDirection(this.dir);
    this.targets.length = 0;
    for (const s of seats) {
      if (s === players.active || !players.occupied[s] || !this.heads[s]) continue;
      players.headPos(s, this.heads[s].pos);
      this.targets.push(this.heads[s]);
    }
    const max = THREE.MathUtils.degToRad(GAZE.maxAngleDeg);
    const got = gazePick(this.origin, this.dir, this.targets, max, this.last >= 0 ? this.last : null, THREE.MathUtils.degToRad(GAZE.stickDeg));
    this.last = got ?? -1;
    return this.last;
  }

  set aiming(on: boolean) {
    if (this.reticle && this.reticle.hidden === on) this.reticle.hidden = !on;
    if (!on) this.last = -1;
  }
}

/**
 * My pick for one question/vote on a client: what I'm looking at, whether I locked it, and what
 * the host already has. Sends only changes (throttled), and everything again to a new host.
 */
export class PickState {
  id: string | null = null;
  locked = false;
  private key = '';
  private sent: { key: string; host: string | null; id: string | null; locked: boolean } | null = null;
  private sentAt = -Infinity;

  /** A new question or vote: start over. */
  reset(key: string): void {
    if (key === this.key) return;
    this.key = key;
    this.id = null;
    this.locked = false;
  }

  /** Send to `host` if anything changed since the last send (or the host is someone else now). */
  flush(host: string | null, send: (id: string | null, locked: boolean) => void, now = performance.now()): void {
    if (!host || !this.key) return;
    const s = this.sent;
    if (s && s.key === this.key && s.host === host && s.id === this.id && s.locked === this.locked) return;
    // Locking goes out at once; plain looking around may wait for the next frame.
    if (!this.locked && s && s.key === this.key && s.host === host && now - this.sentAt < GAZE.sendMs) return;
    this.sent = { key: this.key, host, id: this.id, locked: this.locked };
    this.sentAt = now;
    send(this.id, this.locked);
  }

  /** The host may have lost it (it left): send again on the next flush. */
  forget(): void {
    this.sent = null;
  }
}
