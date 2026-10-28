import * as THREE from 'three';
import { BLACKOUT, CAMERA, COLORS, HALT_CYCLE_S, RENDER, SPEED } from '../config';
import type { SharedClock } from '../core/clock';
import { coachPower, haltCountdown, noise1, shake } from '../core/motion';
import { Players } from '../game/players';
import { buildCoach, type Coach } from './coach';
import { buildLighting, type Lighting } from './lighting';
import { buildNeighbours, type Neighbours } from './neighbours';
import { makeCoachTextures } from './textures';
import { buildTunnel, type Tunnel } from './tunnel';

/** Overview of the coach, or first person from the head of the local player. */
export type CamMode = 'wagon' | 'pov';

export interface WorldParams {
  kmh: number;
  shakeMm: number;
  shakeOn: boolean;
}

const FORWARD = new THREE.Vector3(0, 0, 1);

/** The whole hypertrain scene. Everything ambient is derived from the shared clock. */
export class World {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAMERA.wagonFov, 16 / 9, 0.05, 120);
  readonly coach: Coach;
  private lighting: Lighting;
  private tunnel: Tunnel;
  private neighbours: Neighbours;
  /** Clock time of a debug-triggered blackout; -Infinity = none. */
  forcedBlackoutAt = -Infinity;
  power = 1;

  readonly players: Players;
  cam: CamMode = 'wagon';
  /**
   * Distance travelled, integrated locally from the speed slider. Once speed comes from the
   * host (M3) this becomes a function of the shared clock as well.
   */
  distance = 0;
  /** Right-mouse zoom in POV: target 0/1 and its smoothed value. */
  zoom = 0;
  private zoomK = 0;
  private eye = new THREE.Vector3();
  private aim = new THREE.Vector3();

  constructor(readonly clock: SharedClock) {
    this.scene.background = new THREE.Color(COLORS.background);
    this.scene.fog = new THREE.Fog(COLORS.background, RENDER.fogNear, RENDER.fogFar);
    const tex = makeCoachTextures();
    this.coach = buildCoach(this.scene, tex);
    this.lighting = buildLighting(this.scene, this.coach.root, tex, clock.seed);
    this.tunnel = buildTunnel(this.scene, clock.seed);
    // Baked after lighting, so the neon tubes are part of every neighbour copy.
    this.neighbours = buildNeighbours(this.scene, this.coach.root, this.coach.poweredMaterials);
    // Players come after the bake: people are not part of the neighbour copies.
    this.players = new Players(this.coach.root, clock.seed);
    this.update(0, 0, { kmh: 0, shakeMm: 0, shakeOn: false });
  }

  update(t: number, dt: number, p: WorldParams): void {
    const sf = p.kmh / SPEED.maxKmh;
    this.distance += (p.kmh / 3.6) * SPEED.visualScale * dt;
    this.power = coachPower(t, this.clock.seed, BLACKOUT, this.forcedBlackoutAt);
    this.tunnel.update(t, this.distance, p.kmh);
    this.lighting.update(t, sf, this.power);
    this.coach.setPower(this.power);
    this.neighbours.update(t);
    this.coach.halt.draw(haltCountdown(t, HALT_CYCLE_S));
    this.players.update(t, dt, this.cam === 'pov');
    this.zoomK += ((this.cam === 'pov' ? this.zoom : 0) - this.zoomK) * (1 - Math.exp(-dt * CAMERA.zoomRate));
    this.updateCamera(t, p.shakeOn ? p.shakeMm / 1000 : 0, sf);
  }

  /** Current POV field-of-view factor (1 = normal); mouse sensitivity scales with it. */
  get fovFactor(): number {
    return 1 - (1 - CAMERA.zoomFovFactor) * this.zoomK;
  }

  private updateCamera(t: number, amp: number, sf: number): void {
    const cam = this.camera;
    const sh = shake(t, amp, (this.clock.seed % 101) * 0.37);
    if (this.cam === 'pov') {
      // Camera rides in the head: eyes for position, the head's facing (+z) for direction. Only the
      // direction is taken, not the full orientation, so torso lean never tilts the horizon.
      const rig = this.players.me.rig;
      rig.head.updateWorldMatrix(true, false);
      rig.head.localToWorld(this.eye.copy(rig.eye));
      rig.head.localToWorld(this.aim.copy(rig.eye).add(FORWARD));
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
