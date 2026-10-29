import * as THREE from 'three';
import { LIGHT_SCALE, LIGHTS, POINT_LIGHT_SCALE } from '../../config';
import { coachPower, flick, noise1 } from '../../core/motion';
import { group } from '../../scene/build';
import type { MapDef, MapScene, NpcSpot, Spot } from '../types';
import { CARS, CYCLIST, SEATING, SPAETI_BLACKOUT, SPAETI_LIGHT, STREET } from './config';
import { collectorAt, pass, patrolAt } from './events';
import { buildFigures } from './figures';
import { buildShop, dim } from './shop';
import { spaetiSound } from './sound';
import { buildCar, buildCyclist } from './vehicles';

const NO_BLACKOUTS = { ...SPAETI_BLACKOUT, chance: -1 };
const SKY = 0x05070c;

/** Police light bar: the two halves alternate, each a soft rotating-mirror pulse. */
function beacon(t: number, half: 0 | 1): number {
  const s = Math.sin(t * Math.PI * 2 * 1.4);
  return Math.pow(Math.max(0, half ? -s : s), 2);
}

/** Späti at 3 a.m.: cold tubes, fridge glow, a window onto the dark street. */
function build(scene: THREE.Scene, seed: number): MapScene {
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 12, 34);
  const root = group('spaeti', scene);
  const shop = buildShop(root);
  const figures = buildFigures(root, seed);
  const patrolCar = buildCar(root, 0x1b3a8a, true);
  const cars = [buildCar(root, 0x6a1a1e, false), buildCar(root, 0x8a9096, false)];
  const cyclist = buildCyclist(root, seed);

  const L = SPAETI_LIGHT;
  const hemi = new THREE.HemisphereLight(0xeef4ff, 0x30323a, 0);
  const main = new THREE.PointLight(0xe8f2ff, 0, 10, 1.1);
  // Between the crate corner and the counter, so the owner is not a silhouette.
  main.position.set(0.4, 2.4, 0.4);
  const fridge = new THREE.PointLight(0xcfe6ff, 0, 5.5, 1.4);
  fridge.position.set(-2.1, 1.2, -1.3);
  const lamp = new THREE.PointLight(0xffa860, 0, 13, 1.3);
  lamp.position.set(STREET.lampX, STREET.lampY - 0.4, STREET.lampZ + 1.2);
  // One light shared by every passing vehicle: headlights of a car, or the patrol's blue.
  const sweep = new THREE.PointLight(0xffffff, 0, 16, 1.2);
  scene.add(hemi, main, fridge, lamp, sweep);

  const S = SEATING;
  const seat = (sx: -1 | 1, sz: -1 | 1): Spot => ({ x: S.cx + sx * S.halfX, y: S.seatY, z: S.cz + sz * S.halfZ, yaw: sx === -1 ? Math.PI / 2 : -Math.PI / 2 });
  const seats = [seat(-1, -1), seat(1, -1), seat(-1, 1), seat(1, 1)];
  // A regular on a crate outside, beer in hand: the sticker on the window says not to.
  const npcs: NpcSpot[] = [{ act: 'beer', pose: 'sit', at: { x: 0.9, y: S.seatY, z: 3.55, yaw: -Math.PI / 2 } }];

  const seedShift = (seed % 997) * 0.013;
  let police = false;
  let collector = false;
  const tmp = new THREE.Matrix4();
  const rot = new THREE.Matrix4();

  const map: MapScene = {
    root,
    seats,
    npcs,
    scoldSpot(i) {
      const s = seats[i];
      const side = s.x < S.cx ? -1 : 1;
      const x = s.x + side * 0.55;
      const z = s.z + (s.z < S.cz ? -0.35 : 0.35);
      return { x, y: 0, z, yaw: Math.atan2(s.x - x, s.z - z) };
    },
    overview: { pos: [0.35, 2.25, -1.35], look: [-0.55, 0.8, 2.0], fov: 62 },
    power: 1,
    shake: 0.12,
    events: () => [...(map.power < 0.98 ? ['Stromausfall'] : []), ...(police ? ['Polizeistreife'] : []), ...(collector ? ['Pfandsammler'] : [])],
    update(f) {
      const t = f.t;
      const power = (map.power = coachPower(t, seed, f.blackouts ? SPAETI_BLACKOUT : NO_BLACKOUTS, f.forcedBlackoutAt));
      // Brighter light presets lift the bloom threshold; the room follows so the walls never glow.
      const pk = LIGHTS.bloomThreshold / 0.28;
      const tubeK = LIGHTS.neonTubeHdr / 1.9;

      // Tubes: one fixture is dying, the rest hum along.
      const bad = flick(t, 2.1 + seedShift);
      dim(shop.tubes, power * tubeK);
      dim(shop.badTube, (0.03 + 0.97 * bad) * power * tubeK);
      hemi.intensity = LIGHT_SCALE * pk * (L.hemiBlackout + (L.hemi - L.hemiBlackout) * power);
      main.intensity = POINT_LIGHT_SCALE * pk * L.main * power * (0.88 + 0.12 * bad);
      // Fridges run on their own circuit (and the story needs them): they stay lit in a blackout.
      fridge.intensity = POINT_LIGHT_SCALE * pk * L.fridge;
      const lampK = power * (0.3 + 0.7 * flick(t * 0.6, 5.3 + seedShift));
      lamp.intensity = POINT_LIGHT_SCALE * pk * L.lamp * lampK;
      dim(shop.lampHead, 0.04 + lampK);
      dim(shop.lampPool, lampK);
      for (const m of shop.signs) dim(m, power);
      for (const m of shop.slushMats) dim(m, power);
      dim(shop.heatLamp, power);
      dim(shop.neon, power * (0.92 + 0.08 * Math.sin(t * 40)));
      dim(shop.tv, 0.35 + 0.45 * Math.abs(noise1(t * 2.7)));
      shop.tv.color.r *= 0.7 + 0.3 * Math.sin(t * 1.3);

      // Slush swirl and sausages rolling.
      shop.slush.forEach((tx, i) => {
        tx.offset.x = t * (i ? -0.12 : 0.15);
        tx.offset.y = t * 0.04;
      });
      shop.sausageBase.forEach((b, i) => {
        tmp.copy(b).multiply(rot.makeRotationZ(t * 1.3 + i * 0.7));
        shop.sausages.setMatrixAt(i, tmp);
      });
      shop.sausages.instanceMatrix.needsUpdate = true;

      // Street: patrol, cars, cyclist. The patrol owns the sweep light while it passes.
      const pol = patrolAt(t, seed);
      police = !!pol;
      patrolCar.root.visible = !!pol;
      for (const c of cars) c.root.visible = false;
      sweep.intensity = 0;
      if (pol) {
        patrolCar.root.position.set(pol.x, 0, STREET.laneZ[0]);
        patrolCar.root.rotation.y = pol.dir === 1 ? 0 : Math.PI;
        const a = beacon(t, 0);
        const b = beacon(t, 1);
        patrolCar.bar[0].color.setRGB(0.16, 0.36, 1).multiplyScalar(0.3 + 5 * a);
        patrolCar.bar[1].color.setRGB(0.16, 0.36, 1).multiplyScalar(0.3 + 5 * b);
        sweep.color.setHex(0x2a50ff);
        // Closer to the window than the car, so the blue reaches deep into the shop.
        sweep.position.set(pol.x, 1.7, STREET.laneZ[0] - 2.2);
        sweep.intensity = POINT_LIGHT_SCALE * pk * L.police * (0.3 + 0.7 * Math.max(a, b));
      } else {
        const car = pass(t, seed, CARS, 11);
        if (car) {
          const c = cars[car.id % 2];
          c.root.visible = true;
          c.root.position.set(car.x, 0, STREET.laneZ[car.lane]);
          c.root.rotation.y = car.dir === 1 ? 0 : Math.PI;
          sweep.color.setHex(0xfff0d8);
          sweep.position.set(car.x + car.dir * 3.5, 0.9, STREET.laneZ[car.lane] - 0.8);
          sweep.intensity = POINT_LIGHT_SCALE * pk * L.car;
        }
      }
      const cyc = pass(t, seed, CYCLIST, 21);
      cyclist.root.visible = !!cyc;
      if (cyc) {
        cyclist.root.position.set(cyc.x, 0, STREET.curbZ + 0.7);
        cyclist.root.rotation.y = (cyc.dir * Math.PI) / 2;
        cyclist.person.update(f.dt, t, 0.15 * Math.sin(t * 0.8), 0.05, 3, 0);
      }

      collector = !!collectorAt(t, seed);
      figures.update(t, f.dt);
    },
  };
  return map;
}

export const SPAETI: MapDef = {
  id: 'spaeti',
  name: 'Späti 3 Uhr',
  blurb: 'Neonhell, Kühlschrankbrummen, draußen fährt langsam die Streife vorbei.',
  build,
  sound: spaetiSound,
};
