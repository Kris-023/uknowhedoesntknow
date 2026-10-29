import * as THREE from 'three';
import { LIGHT_SCALE, LIGHTS, POINT_LIGHT_SCALE } from '../../config';
import { flick } from '../../core/motion';
import { at, group } from '../../scene/build';
import type { MapDef, MapScene, NpcSpot, Spot } from '../types';
import { CAMERA, COLORS, COUNTERS, FIXTURES, HALL, LED, LIGHT, NUMBERS, ONE_OFFS, QUEUE, ROWS } from './config';
import { buildExtras } from './figures';
import { buildHall } from './hall';
import { callIndex, callNumber, clockHands, failureAge, oneOff, power, queueStep } from './logic';
import { hallSound } from './sound';
import { LedDisplay, makeHallTextures } from './textures';

/** Rows face each other across x: seats 0/2 on the left row look at 1/3 on the right row. */
const seat = (side: -1 | 1, z: number): Spot => ({ x: side * ROWS.x, y: ROWS.seatTop, z, yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2 });
const [SEAT_A, SEAT_B] = ROWS.seats.map((i) => ROWS.chairZ[i]);
const SEATS: Spot[] = [seat(-1, SEAT_A), seat(1, SEAT_A), seat(-1, SEAT_B), seat(1, SEAT_B)];

const NPCS: NpcSpot[] = [
  ...QUEUE.z.map((z, i): NpcSpot => ({ act: i === 1 ? 'paper' : 'phone', pose: 'stand', at: { x: QUEUE.x + (i === 2 ? 0.06 : 0), y: 0, z, yaw: Math.PI } })),
  // The clerk at Schalter 3, asleep behind the glass.
  { act: 'sleep', pose: 'sit', at: { x: COUNTERS.x[2], y: 0.525, z: COUNTERS.z - 0.42, yaw: 0 } },
];

/** Bürgeramt waiting hall on the late shift: dim tubes, a red number display, a queue that never moves. */
function build(scene: THREE.Scene, seed: number): MapScene {
  scene.background = new THREE.Color(COLORS.background);
  scene.fog = new THREE.Fog(COLORS.background, 9, 24);
  const root = group('buergeramt', scene);
  const tex = makeHallTextures();
  const display = new LedDisplay();
  const hall = buildHall(root, tex, display.texture);
  const extras = buildExtras(root, seed);

  const hemi = new THREE.HemisphereLight(0xc8d4d0, 0x2a2620, 0);
  const waiting = at(new THREE.PointLight(COLORS.tubeLight, 0, 9, 1.3), 0, 2.3, -0.2);
  const counter = at(new THREE.PointLight(COLORS.counterLight, 0, 8, 1.3), 0, 2.3, -3.0);
  const led = at(new THREE.PointLight(COLORS.ledLight, 0, 4, 1.6), 0, LED.y - 0.2, LED.z + 0.5);
  const flickFix = FIXTURES.find((f) => f.state === 'flicker')!;
  const flicker = at(new THREE.PointLight(COLORS.tubeLight, 0, 10, 1.4), flickFix.x, 2.3, flickFix.z);
  scene.add(hemi, waiting, counter, led, flicker);
  const hemiSky = new THREE.Color(0xc8d4d0);
  const hemiFail = new THREE.Color(0x4a66b0);
  const tubeCol = new THREE.Color(COLORS.tube);
  const flickSeed = 3.7 + (seed % 997) * 0.013;
  const emergencyCol = new THREE.Color(COLORS.emergency);
  const flickerCol = new THREE.Color(COLORS.tubeLight);

  // The world names its NPC roots npc_1… in spot order; the queue shuffles them along z.
  let queue: THREE.Object3D[] | null = null;
  let failing = false;
  let calling = false;

  const map: MapScene = {
    root,
    seats: SEATS,
    npcs: NPCS,
    scoldSpot(i) {
      const s = SEATS[i];
      // Between the rows, at the end of the player's chair, turned towards them.
      const x = s.x * 0.2;
      const z = s.z + (s.z < 0 ? -0.6 : 0.6);
      return { x, y: 0, z, yaw: Math.atan2(s.x - x, s.z - z) };
    },
    overview: { pos: CAMERA.pos, look: CAMERA.look, fov: CAMERA.fov },
    power: 1,
    // A building doesn't rattle; only the standing NPCs sway a little with this.
    shake: 0.08,
    events: () => [...(failing ? ['Systemausfall'] : []), ...(calling ? ['Nummernaufruf'] : [])],
    update(f) {
      const { t } = f;
      const p = (map.power = power(t, seed, f.blackouts, f.forcedBlackoutAt));
      const age = failureAge(t, seed, f.blackouts, f.forcedBlackoutAt);
      failing = age > 0;
      calling = !failing && t - callIndex(t) * NUMBERS.stepS < 1;

      // Number display runs on its own battery: blinks 0001 while the power is out.
      if (failing) display.draw('0001', null, p >= 0.5 || Math.sin(t * 7) > 0);
      else {
        const c = callNumber(seed, callIndex(t));
        display.draw(c.num, c.desk, true);
      }
      hall.led.color.setScalar(LIGHT.ledHdr * LIGHTS.neonTubeHdr * 0.5);
      hall.screens.map = failing ? tex.screenErr : tex.screenOk;
      hall.screens.color.setScalar((failing ? 2 : 0.8) * LIGHT.screenHdr);

      const tubeK = (0.03 + 0.97 * p) * LIGHTS.neonTubeHdr * LIGHT.tubeHdr;
      hall.tubeOn.color.copy(tubeCol).multiplyScalar(tubeK);
      const fk = flick(t, flickSeed) * p;
      hall.tubeFlicker.color.copy(tubeCol).multiplyScalar((0.03 + 0.97 * fk) * LIGHTS.neonTubeHdr * LIGHT.tubeHdr);
      hall.exit.color.setScalar(LIGHT.exitHdr * (1 + 0.5 * (1 - p)));

      hemi.intensity = LIGHT.hemi * LIGHT_SCALE * (0.4 + 0.6 * p);
      hemi.color.copy(hemiSky).lerp(hemiFail, failing ? 0.7 * (1 - p) + 0.3 : 0);
      waiting.intensity = LIGHT.waiting * POINT_LIGHT_SCALE * p;
      counter.intensity = LIGHT.counter * POINT_LIGHT_SCALE * p;
      led.intensity = LIGHT.led * POINT_LIGHT_SCALE;
      // The flickering tube's light doubles as the emergency light by the exit when the power is gone.
      if (p >= 0.5) {
        flicker.position.set(flickFix.x, 2.3, flickFix.z);
        flicker.color.copy(flickerCol);
        flicker.intensity = LIGHT.flicker * POINT_LIGHT_SCALE * fk;
      } else {
        flicker.position.set(HALL.w / 2 - 1.2, 2.4, -2.0);
        flicker.color.copy(emergencyCol);
        flicker.intensity = LIGHT.emergency * POINT_LIGHT_SCALE;
      }

      const h = clockHands(t, seed);
      hall.clock.h.rotation.z = -h.h;
      hall.clock.m.rotation.z = -h.m;
      hall.clock.s.rotation.z = -h.s;

      const [gw, gc, gd, gs] = ONE_OFFS.glug;
      const g = oneOff(t, seed, gw, gc, gd, gs);
      hall.bubble.visible = !!g;
      if (g) hall.bubble.position.y = 1.04 + 0.36 * g.ph;

      queue ??= root.getObjectByName('npc_1') ? QUEUE.z.map((_, i) => root.getObjectByName(`npc_${i + 1}`)!) : null;
      if (queue) queue.forEach((o, i) => (o.position.z = QUEUE.z[i] - queueStep(t, i)));
      extras.update(t, f.dt);
    },
  };
  return map;
}

export const BUERGERAMT: MapDef = {
  id: 'buergeramt',
  name: 'Bürgeramt',
  blurb: 'Spätschicht im Wartesaal. Ihre Nummer: 4712. Aufgerufen wird 0815.',
  build,
  sound: hallSound,
};
