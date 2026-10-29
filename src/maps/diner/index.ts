import * as THREE from 'three';
import { LIGHT_SCALE, LIGHTS, POINT_LIGHT_SCALE } from '../../config';
import { coachPower, noise1, type BlackoutWindow } from '../../core/motion';
import { group } from '../../scene/build';
import type { MapDef, MapScene, NpcSpot, Spot } from '../types';
import { BOOTH, CAMERA_DINER, COLORS_DINER as C, COUNTER, DINER_LIGHT as DL, DINER_SHAKE } from './config';
import { debugFlare, flareShape, fryerFlare, signLetters } from './events';
import { Cook, Waitress } from './figures';
import { buildDiner } from './scene';
import { dinerSound } from './sound';

/** The diner's fuse: rarer than the hypertrain's failures, but the old wiring does give up now and then. */
const FUSE: BlackoutWindow = { windowS: 53, chance: 0.35, minS: 1.5, maxS: 4 };
const NO_FUSE: BlackoutWindow = { ...FUSE, chance: -1 };

const kitchenCool = new THREE.Color(0xd8ecff);
const fireCol = new THREE.Color(0xff7a20);

/**
 * Roadside diner at 4 a.m.: the players share the middle booth by the windows, a waitress does her
 * rounds behind the counter, a trucker sleeps over his coffee, a couple stares at their phones and
 * the cook glowers through the hatch until the fryer flares up.
 */
function build(scene: THREE.Scene, seed: number): DinerMap {
  scene.background = new THREE.Color(C.background);
  scene.fog = new THREE.Fog(C.background, 10, 34);
  const root = group('diner', scene);
  const parts = buildDiner(root);

  const hemi = new THREE.HemisphereLight(0x5a6a9a, 0x2a1810, 1);
  scene.add(hemi);
  const pendant = new THREE.PointLight(0xffb46a, 0, 6, 1.5);
  pendant.position.set(BOOTH.tableCx, 1.75, 0);
  const counter = new THREE.PointLight(0xffc890, 0, 8, 1.4);
  counter.position.set(1.4, 2.5, -0.6);
  const kitchen = new THREE.PointLight(0xd8ecff, 0, 9, 1.3);
  kitchen.position.set(3.7, 2.2, -0.3);
  // Sodium street lamp: outside the diner's circuit, it keeps glowing through a blackout.
  const street = new THREE.PointLight(0xffa040, 0, 26, 1.2);
  street.position.set(-9.6, 4.8, 3.6);
  scene.add(pendant, counter, kitchen, street);

  const waitress = new Waitress(root);
  const cook = new Cook(root);

  const [xOut, xIn] = BOOTH.seatX;
  const zA = -BOOTH.benchOff;
  const zB = BOOTH.benchOff;
  const sit = (x: number, z: number, yaw: number): Spot => ({ x, y: BOOTH.seatTop, z, yaw });
  // 0/2 share the bench facing +z, 1/3 the one across: teams of "Sag's anders" sit side by side.
  const seats = [sit(xOut, zA, 0), sit(xOut, zB, Math.PI), sit(xIn, zA, 0), sit(xIn, zB, Math.PI)];
  const couple = BOOTH.centres[0] - BOOTH.benchOff;
  const npcs: NpcSpot[] = [
    { act: 'sleep', pose: 'sit', at: { x: COUNTER.stoolX, y: COUNTER.stoolTop, z: 1.2, yaw: Math.PI / 2 } },
    { act: 'phone', pose: 'sit', at: sit(xOut, couple, 0) },
    { act: 'phone', pose: 'sit', at: sit(xIn, couple, 0) },
  ];

  const letters: number[] = [];
  let flaring = false;
  let flicker = false;

  const map: DinerMap = {
    root,
    seats,
    npcs,
    scoldSpot(i) {
      // In the aisle at the end of the table, turned towards the seat.
      const s = seats[i];
      const x = BOOTH.tableX1 + 0.35;
      const z = s.z * 0.75;
      return { x, y: 0, z, yaw: Math.atan2(s.x - x, s.z - z) };
    },
    overview: { pos: CAMERA_DINER.pos, look: CAMERA_DINER.look, fov: CAMERA_DINER.fov },
    power: 1,
    shake: DINER_SHAKE,
    events: () => [...(map.power < 0.98 ? ['Stromausfall'] : []), ...(flaring ? ['Fritteuse brennt'] : []), ...(flicker ? ['Neonbuchstabe'] : [])],
    forceFlare(at) {
      debugFlare.at = at;
    },
    update(f) {
      const { t, dt } = f;
      const power = (map.power = coachPower(t, seed, f.blackouts ? FUSE : NO_FUSE, f.forcedBlackoutAt));
      const flare = fryerFlare(t, seed, debugFlare.at);
      const fx = flare ? flareShape(flare.ph) : null;
      flaring = !!flare;

      // Global preset (nacht/hell) scales the diner like the coach.
      const pt = POINT_LIGHT_SCALE * (LIGHTS.neonBlue / 0.9);
      const hdr = LIGHTS.neonTubeHdr * DL.glow;
      hemi.intensity = (DL.hemi + LIGHTS.hemi) * LIGHT_SCALE * (0.45 + 0.55 * power);
      const hum = 0.96 + 0.04 * Math.sin(t * 2.1 + noise1(t * 0.7));
      pendant.intensity = DL.pendant * pt * power * hum;
      counter.intensity = DL.counter * pt * power;
      street.intensity = DL.street * pt;

      // Kitchen: cold tubes, swamped by orange when the oil goes up (the flames ignore the fuse).
      const fire = fx ? fx.fire * (0.75 + 0.25 * noise1(t * 23)) + fx.flash * 2.5 : 0;
      kitchen.color.copy(kitchenCool).lerp(fireCol, Math.min(1, fire * 1.5));
      kitchen.intensity = DL.kitchen * pt * power + 3.5 * pt * fire;
      kitchen.position.z = fire > 0 ? -0.6 : -0.3;

      parts.glow.pend.color.setScalar(hdr * 0.9 * power * hum);
      parts.glow.trim.color.setScalar(hdr * 0.8 * power);
      parts.glow.juke.color.setScalar(hdr * 0.7 * power * (0.85 + 0.15 * Math.sin(t * 6.9)));
      parts.glow.kit.color.setScalar(hdr * 0.8 * power);
      parts.glow.warm.color.setScalar(hdr * 0.7 * power);
      parts.glow.street.color.setScalar(hdr * 1.4);
      parts.jukeHalo.opacity = 0.28 * power;
      parts.streetHalo.opacity = 0.16;
      parts.menuMat.color.setScalar(0.45 * power + 0.03);

      const dying = signLetters(t, seed, parts.sign.count, letters);
      flicker = dying >= 0;
      parts.sign.draw(letters, 1);
      parts.signMat.color.setScalar(hdr * 0.85 * power);
      parts.mirrorGlow.sign.color.setScalar(0.32 * power);
      parts.mirrorGlow.pend.color.setScalar(0.12 * power);
      parts.mirrorGlow.trim.color.setScalar(0.22 * power);
      parts.mirrorGlow.juke.color.setScalar(0.18 * power);

      // Flare: flames, the flash in the hatch, smoke rolling out under the ceiling.
      for (const [i, m] of parts.flame.entries()) {
        m.visible = !!fx && fx.fire > 0.01;
        if (!fx) continue;
        const k = fx.fire * (0.8 + 0.25 * noise1(t * 19 + i * 3)) + fx.flash;
        m.scale.set((i ? 0.5 : 1) * (0.9 + 0.7 * k), (i ? 0.55 : 1) * (0.4 + 1.9 * k), (i ? 0.5 : 1) * (0.9 + 0.7 * k));
      }
      parts.flash.opacity = fx ? Math.min(1, fx.flash * 1.6 + fx.fire * 0.25) : 0;
      parts.smoke.forEach((m, i) => {
        const age = fx ? flare!.ph - (0.35 + i * 0.4) : -1;
        m.visible = age > 0 && !!fx && fx.smoke > 0.01;
        if (!m.visible) return;
        const out = 1 - Math.exp(-age * 0.55);
        m.position.set(4.5 - 2.3 * out, 1.15 + 0.6 * out + 0.25 * Math.max(0, out - 0.6), -0.65 + 0.18 * (i - 2) + 0.25 * out);
        m.scale.setScalar(0.35 + 0.32 * age);
        m.quaternion.copy(f.camera.quaternion);
        (m.material as THREE.MeshBasicMaterial).opacity = 0.65 * fx!.smoke * Math.max(0, 1 - age / 6.5);
      });
      // Detector LED: a slow standby blink, solid red while it beeps.
      const standby = t % 4 < 0.08;
      parts.led.color.setHex(fx?.beep ? 0xff2020 : standby ? 0x801010 : 0x200000);
      if (fx?.beep) parts.led.color.multiplyScalar(3);

      parts.machinePot.visible = !waitress.hasPot;
      // Wall clock: just after four, running with the shared clock.
      const minutes = 4 * 60 + 7 + t / 60;
      parts.hands.minute.rotation.z = -((minutes % 60) / 60) * Math.PI * 2;
      parts.hands.hour.rotation.z = -((minutes / 60) % 12) / 12 * Math.PI * 2;

      waitress.update(t, dt, seed);
      cook.update(t, dt, flare);
    },
  };
  return map;
}

interface DinerMap extends MapScene {
  /** Dev only: flare the fryer at clock time `at` (`__hyper.world.map.forceFlare(__hyper.clock.now())`). */
  forceFlare(at: number): void;
}

export const DINER: MapDef = {
  id: 'diner',
  name: 'Diner',
  blurb: 'Brätlingshof, 4 Uhr früh: Kaffee satt, die Fritteuse hat schlechte Laune.',
  build,
  sound: dinerSound,
};
