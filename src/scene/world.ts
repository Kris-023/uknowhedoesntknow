import * as THREE from 'three';
import { CAMERA, SPEED } from '../config';
import type { SharedClock } from '../core/clock';
import { noise1, shake } from '../core/motion';
import { Npcs } from '../game/npcs';
import { Players } from '../game/players';
import { mapDef } from '../maps';
import type { MapDef, MapId, MapScene } from '../maps/types';
import { trainDistance, type Train } from '../net/protocol';

/** Overview of the map, or first person from the head of the local player. */
export type CamMode = 'wagon' | 'pov';

export interface WorldParams {
  shakeMm: number;
  shakeOn: boolean;
}

const FORWARD = new THREE.Vector3(0, 0, 1);

/** The scene: one map plus the people in it. Everything ambient is derived from the shared clock. */
export class World {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAMERA.wagonFov, 16 / 9, 0.05, 120);
  readonly def: MapDef;
  readonly map: MapScene;
  /** Clock time of a debug-triggered blackout; -Infinity = none. */
  forcedBlackoutAt = -Infinity;
  /** Room setting: random power failures (a forced one from the debug panel still works). */
  blackouts = true;

  readonly players: Players;
  readonly npcs: Npcs;
  cam: CamMode = 'wagon';
  /** Speed profile from the host (or the local slider when solo); distance is its integral over the clock. */
  train: Train = { kmh: 0, t0: 0, d0: 0 };
  distance = 0;
  /** Right-mouse zoom in POV: target 0/1 and its smoothed value. */
  zoom = 0;
  private zoomK = 0;
  private eye = new THREE.Vector3();
  private aim = new THREE.Vector3();
  private lookEuler = new THREE.Euler();
  private seatQ = new THREE.Quaternion();

  constructor(
    readonly clock: SharedClock,
    mapId: MapId = 'hypertrain',
  ) {
    this.def = mapDef(mapId);
    this.map = this.def.build(this.scene, clock.seed);
    // People come after the map: baked copies (the hypertrain's neighbour coaches) must not contain them.
    this.players = new Players(this.map.root, clock.seed, this.map.seats);
    this.npcs = new Npcs(this.map.root, clock.seed, this.map.npcs);
    this.update(0, 0, { shakeMm: 0, shakeOn: false });
  }

  /** Supply of the map right now (1 normal, 0 blackout). */
  get power(): number {
    return this.map.power;
  }

  update(t: number, dt: number, p: WorldParams): void {
    const kmh = this.train.kmh;
    const sf = kmh / SPEED.maxKmh;
    this.distance = trainDistance(this.train, t) * SPEED.visualScale;
    const amp = p.shakeOn ? (p.shakeMm / 1000) * this.map.shake : 0;
    this.map.update({ t, dt, kmh, distance: this.distance, blackouts: this.blackouts, forcedBlackoutAt: this.forcedBlackoutAt, camera: this.camera });
    this.players.update(t, dt, this.cam === 'pov');
    this.npcs.update(t, dt, amp);
    this.zoomK += ((this.cam === 'pov' ? this.zoom : 0) - this.zoomK) * (1 - Math.exp(-dt * CAMERA.zoomRate));
    // Only moving maps widen the view with speed.
    this.updateCamera(t, amp, sf * (this.map.speedFov ?? 0));
  }

  /** Current POV field-of-view factor (1 = normal); mouse sensitivity scales with it. */
  get fovFactor(): number {
    return 1 - (1 - CAMERA.zoomFovFactor) * this.zoomK;
  }

  private updateCamera(t: number, amp: number, sf: number): void {
    const cam = this.camera;
    const sh = shake(t, amp, (this.clock.seed % 101) * 0.37);
    if (this.cam === 'pov') {
      // Eyes for position (the camera rides along with the body), but the direction comes straight
      // from the mouse target and the seat. Taking it from the head bone made the view trail behind:
      // head smoothing, the lagging torso turn and its lean kept it drifting after the mouse stopped.
      const me = this.players.me;
      me.rig.head.updateWorldMatrix(true, false);
      me.rig.head.localToWorld(this.eye.copy(me.rig.eye));
      const { yaw, pitch } = this.players.look;
      this.lookEuler.set(pitch, yaw, 0, 'YXZ');
      me.root.getWorldQuaternion(this.seatQ);
      this.aim.copy(FORWARD).applyEuler(this.lookEuler).applyQuaternion(this.seatQ).add(this.eye);
      cam.position.set(this.eye.x + sh.x * 0.6, this.eye.y + sh.y * 0.6, this.eye.z);
      cam.lookAt(this.aim.x + sh.x * 0.6, this.aim.y + sh.y * 0.6, this.aim.z);
      cam.rotateZ(amp * 1.2 * noise1(t * 3.1 + 2));
      cam.fov = (CAMERA.seatFov + sf) * this.fovFactor;
    } else {
      const o = this.map.overview;
      const [x, y, z] = o.pos;
      cam.position.set(x + sh.x, y + sh.y, z);
      cam.lookAt(...o.look);
      cam.rotateZ(sh.roll);
      cam.fov = o.fov + sf + 1.5 * Math.sin(t * 0.4);
    }
    cam.updateProjectionMatrix();
  }
}
