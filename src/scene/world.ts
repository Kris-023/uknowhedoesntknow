import * as THREE from 'three';
import { BLACKOUT, CAMERA, COLORS, HALT_CYCLE_S, PLAYER_SEATS, RENDER, SPEED } from '../config';
import type { SharedClock } from '../core/clock';
import { coachPower, haltCountdown, noise1, shake } from '../core/motion';
import { buildCoach, type Coach } from './coach';
import { buildLighting, type Lighting } from './lighting';
import { buildNeighbours, type Neighbours } from './neighbours';
import { makeCoachTextures } from './textures';
import { buildTunnel, type Tunnel } from './tunnel';

export type CamMode = { kind: 'wagon' } | { kind: 'seat'; seat: number };

export interface WorldParams {
  kmh: number;
  shakeMm: number;
  shakeOn: boolean;
}

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

  cam: CamMode = { kind: 'wagon' };
  /** Seat-camera look offsets, driven by the locked mouse. Stand-in for the head POV of M2. */
  seatYaw = 0;
  seatPitch = -0.12;
  /**
   * Distance travelled, integrated locally from the speed slider. Once speed comes from the
   * host (M3) this becomes a function of the shared clock as well.
   */
  distance = 0;

  constructor(readonly clock: SharedClock) {
    this.scene.background = new THREE.Color(COLORS.background);
    this.scene.fog = new THREE.Fog(COLORS.background, RENDER.fogNear, RENDER.fogFar);
    const tex = makeCoachTextures();
    this.coach = buildCoach(this.scene, tex);
    this.lighting = buildLighting(this.scene, this.coach.root, tex, clock.seed);
    this.tunnel = buildTunnel(this.scene, clock.seed);
    // Baked after lighting, so the neon tubes are part of every neighbour copy.
    this.neighbours = buildNeighbours(this.scene, this.coach.root, this.coach.poweredMaterials);
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
    this.updateCamera(t, p.shakeOn ? p.shakeMm / 1000 : 0, sf);
  }

  private updateCamera(t: number, amp: number, sf: number): void {
    const cam = this.camera;
    const sh = shake(t, amp, (this.clock.seed % 101) * 0.37);
    if (this.cam.kind === 'seat') {
      const seat = PLAYER_SEATS[this.cam.seat];
      // Seated players face the aisle: side -1 looks towards +x and vice versa.
      const facing = -seat.side;
      cam.position.set(seat.side * 1.1 + sh.x * 0.6, CAMERA.seatEyeY + sh.y * 0.6, seat.z);
      cam.rotation.set(0, 0, 0);
      cam.rotation.order = 'YXZ';
      cam.rotation.y = (facing > 0 ? -Math.PI / 2 : Math.PI / 2) + this.seatYaw;
      cam.rotation.x = this.seatPitch;
      cam.rotation.z = amp * 1.2 * noise1(t * 3.1 + 2);
      cam.fov = CAMERA.seatFov + 6 * sf;
    } else {
      const [x, y, z] = CAMERA.wagonPos;
      cam.position.set(x + sh.x, y + sh.y, z);
      cam.rotation.order = 'XYZ';
      cam.lookAt(...CAMERA.wagonLook);
      cam.rotateZ(sh.roll);
      cam.fov = CAMERA.wagonFov + 6 * sf + 1.5 * Math.sin(t * 0.4);
    }
    cam.updateProjectionMatrix();
  }
}
