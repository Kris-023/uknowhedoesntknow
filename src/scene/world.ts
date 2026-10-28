import * as THREE from 'three';
import { BLACKOUT, CAMERA, COLORS, HALT_CYCLE_S, RENDER, SPEED, STATIONS, TRAIN } from '../config';
import type { SharedClock } from '../core/clock';
import { coachPower, haltCountdown, nextStopIndex, noise1, shake } from '../core/motion';
import { bakeCrowd, crowdMaterial } from '../game/crowd';
import { Npcs } from '../game/npcs';
import { Players } from '../game/players';
import { trainDistance, type Train } from '../net/protocol';
import { buildCoach, type Coach } from './coach';
import { buildJunk, type Junk } from './junk';
import { buildLighting, type Lighting } from './lighting';
import { buildNeighbours, type Neighbours } from './neighbours';
import { makeCoachTextures } from './textures';
import { buildTunnel, type Tunnel } from './tunnel';

/** Overview of the coach, or first person from the head of the local player. */
export type CamMode = 'wagon' | 'pov';

export interface WorldParams {
  shakeMm: number;
  shakeOn: boolean;
}

const FORWARD = new THREE.Vector3(0, 0, 1);

/** The whole hypertrain scene. Everything ambient is derived from the shared clock. */
const NO_BLACKOUTS = { ...BLACKOUT, chance: -1 };

export class World {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAMERA.wagonFov, 16 / 9, 0.05, 120);
  readonly coach: Coach;
  readonly lighting: Lighting;
  private tunnel: Tunnel;
  private neighbours: Neighbours;
  /** Clock time of a debug-triggered blackout; -Infinity = none. */
  forcedBlackoutAt = -Infinity;
  power = 1;
  /** Room setting: random power failures (a forced one from the debug panel still works). */
  blackouts = true;

  readonly players: Players;
  readonly npcs: Npcs;
  private junk: Junk;
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

  constructor(readonly clock: SharedClock) {
    this.scene.background = new THREE.Color(COLORS.background);
    this.scene.fog = new THREE.Fog(COLORS.background, RENDER.fogNear, RENDER.fogFar);
    const tex = makeCoachTextures();
    this.coach = buildCoach(this.scene, tex);
    this.lighting = buildLighting(this.scene, this.coach.root, tex, clock.seed);
    this.tunnel = buildTunnel(this.scene, clock.seed);
    // Baked after lighting, so the neon tubes are part of every neighbour copy.
    const crowds = Array.from({ length: TRAIN.crowdVariants }, (_, i) => bakeCrowd(clock.seed + i * 101));
    this.neighbours = buildNeighbours(this.scene, this.coach.root, this.coach.poweredMaterials, {
      geos: crowds,
      material: crowdMaterial,
      upTo: TRAIN.crowdedPerSide,
    }, this.lighting.hemi);
    // Players come after the bake: people are not part of the neighbour copies.
    this.players = new Players(this.coach.root, clock.seed);
    this.npcs = new Npcs(this.coach.root, clock.seed);
    this.junk = buildJunk(this.coach.root, clock.seed);
    this.update(0, 0, { shakeMm: 0, shakeOn: false });
  }

  update(t: number, dt: number, p: WorldParams): void {
    const kmh = this.train.kmh;
    const sf = kmh / SPEED.maxKmh;
    this.distance = trainDistance(this.train, t) * SPEED.visualScale;
    this.power = coachPower(t, this.clock.seed, this.blackouts ? BLACKOUT : NO_BLACKOUTS, this.forcedBlackoutAt);
    this.tunnel.update(t, this.distance, kmh);
    this.lighting.update(t, sf, this.power);
    this.coach.setPower(this.power);
    this.neighbours.update(t);
    this.coach.halt.draw(haltCountdown(t, HALT_CYCLE_S), STATIONS[nextStopIndex(t, HALT_CYCLE_S, STATIONS.length)]);
    this.players.update(t, dt, this.cam === 'pov');
    this.npcs.update(t, dt, p.shakeOn ? p.shakeMm / 1000 : 0);
    this.junk.update(t);
    this.zoomK += ((this.cam === 'pov' ? this.zoom : 0) - this.zoomK) * (1 - Math.exp(-dt * CAMERA.zoomRate));
    this.updateCamera(t, p.shakeOn ? p.shakeMm / 1000 : 0, sf);
    this.neighbours.cull(this.camera);
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
      cam.fov = (CAMERA.seatFov + 6 * sf) * this.fovFactor;
    } else {
      const [x, y, z] = CAMERA.wagonPos;
      cam.position.set(x + sh.x, y + sh.y, z);
      cam.lookAt(...CAMERA.wagonLook);
      cam.rotateZ(sh.roll);
      cam.fov = CAMERA.wagonFov + 6 * sf + 1.5 * Math.sin(t * 0.4);
    }
    cam.updateProjectionMatrix();
  }
}
