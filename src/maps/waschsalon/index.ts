import * as THREE from 'three';
import { LIGHT_SCALE, LIGHTS, POINT_LIGHT_SCALE } from '../../config';
import { flick, smoothstep } from '../../core/motion';
import type { MapDef, MapScene, NpcSpot, Spot } from '../types';
import { group } from '../../scene/build';
import { WS } from './config';
import { buildExtras } from './people';
import { buildRoom } from './room';
import { badTubeSeed, imbalanceAt, laundromatPower, washAngle } from './schedule';
import { waschSound } from './sound';
import { makeWaschTextures } from './textures';

const L = WS.light;
const C = WS.colors;
const HALF_PI = Math.PI / 2;
/** The light presets were tuned for the coach's blue neon; follow their brightness ratio. */
const presetGain = () => LIGHTS.neonBlue / 0.9;

/** Laundromat at 3 a.m.: cold tubes, tumbling drums, rain on the window, and one machine with an attitude. */
function build(scene: THREE.Scene, seed: number): MapScene {
  scene.background = new THREE.Color(C.background);
  scene.fog = new THREE.Fog(C.background, 7, 16);
  const root = group('waschsalon', scene);
  const tex = makeWaschTextures(seed);
  const room = buildRoom(root, tex, seed);
  const extras = buildExtras(root, seed);

  // Few real lights: table tube, machine row (follows the bad tube), street lamp, coin changer.
  const hemi = new THREE.HemisphereLight(0x8a9cc0, 0x15161a, 0);
  const tableL = new THREE.PointLight(0xdcefff, 0, 7, 1.3);
  tableL.position.set(0, 2.35, 0);
  const machL = new THREE.PointLight(0xcfe6ff, 0, 7, 1.3);
  machL.position.copy(room.tubes.badPos).add(new THREE.Vector3(0, -0.25, 0.4));
  const streetL = new THREE.PointLight(C.sodium, 0, 8, 1.2);
  streetL.position.set(-3.4, 2.5, 1.2);
  const coinL = new THREE.PointLight(0x4dff8e, 0, 2.6, 1.6);
  coinL.position.set(WS.back.coinX, 1.3, WS.room.back + 0.7);
  scene.add(hemi, tableL, machL, streetL, coinL);

  const S = WS.seat;
  const seats: Spot[] = [
    { x: -S.x, y: S.y, z: -S.z, yaw: HALF_PI },
    { x: S.x, y: S.y, z: -S.z, yaw: -HALF_PI },
    { x: -S.x, y: S.y, z: S.z, yaw: HALF_PI },
    { x: S.x, y: S.y, z: S.z, yaw: -HALF_PI },
  ];
  const npcs: NpcSpot[] = [
    // The student, asleep on top of the big dryer: warm, and it hums.
    { act: 'sleep', pose: 'sit', at: { x: WS.back.dryerX[0], y: WS.back.bigDryerH, z: WS.room.back + 0.34, yaw: 0 } },
    // Waiting for the spin cycle under the notice board, on the phone.
    { act: 'phone', pose: 'sit', at: { x: WS.back.boardX - 0.25, y: S.y, z: WS.room.back + 0.4, yaw: 0 } },
  ];

  const eventHome = room.event.position.clone();
  const eventYaw = room.event.rotation.y;
  const stareAt = room.eventPos.clone().add(new THREE.Vector3(0, 0.4, 0));
  const tubeCol = new THREE.Color();
  let shakeK = 0;
  let labels: string[] = [];

  const map: MapScene = {
    root,
    seats,
    npcs,
    scoldSpot(i) {
      const s = seats[i];
      const x = s.x * 1.15;
      const z = s.z + Math.sign(s.z) * 0.62;
      return { x, y: 0, z, yaw: Math.atan2(s.x - x, s.z - z) };
    },
    overview: { pos: WS.overview.pos, look: WS.overview.look, fov: WS.overview.fov },
    power: 1,
    get shake() {
      return WS.shake.base + WS.shake.rage * shakeK;
    },
    events: () => labels,
    update(f) {
      const { t } = f;
      const power = (map.power = laundromatPower(t, seed, f.blackouts, f.forcedBlackoutAt));
      const pg = presetGain();
      const ev = imbalanceAt(t, seed);
      const sh = ev ? ev.shake : 0;
      shakeK = sh;
      labels = [...(sh > 0.05 ? ['Unwucht'] : []), ...(power < 0.98 ? ['Sicherung raus'] : [])];

      // Tubes: five steady ones breathing a little, one humming and stuttering.
      const steadyK = (0.96 + 0.04 * Math.sin(t * 0.7)) * power;
      const badK = flick(t, badTubeSeed(seed)) * power;
      const hdr = LIGHTS.neonTubeHdr * L.tubeHdr;
      room.tubes.steady.color.copy(tubeCol.setHex(C.tube)).multiplyScalar((0.03 + 0.97 * steadyK) * hdr);
      room.tubes.bad.color.copy(tubeCol.setHex(C.tube)).multiplyScalar((0.03 + 0.97 * badK) * hdr);
      room.tubes.steadyHalo.opacity = 0.18 * steadyK;
      room.tubes.badHalo.opacity = 0.18 * badK;
      // The window sign runs on the same fuse; it has a lazy buzz of its own.
      const signK = power * (Math.sin(t * 0.37) * Math.sin(t * 1.9) > 0.93 ? 0.4 : 1);
      room.sign.tube.color.setHex(C.sign).multiplyScalar(L.signHdr * LIGHTS.neonTubeHdr * signK);
      room.sign.halo.opacity = 0.45 * signK;
      room.coinScreen.color.setHex(C.led).multiplyScalar(L.ledHdr * power * (Math.floor(t * 1.5) % 2 ? 1 : 0.7));

      hemi.intensity = L.hemi * LIGHT_SCALE * pg * (0.45 + 0.55 * power);
      tableL.intensity = L.table * POINT_LIGHT_SCALE * pg * steadyK;
      machL.intensity = L.machines * POINT_LIGHT_SCALE * pg * (0.35 * steadyK + 0.65 * badK);
      streetL.intensity = L.street * POINT_LIGHT_SCALE * pg;
      coinL.intensity = L.coin * POINT_LIGHT_SCALE * pg * power;

      room.update(t, power, L.ledHdr);
      for (const [i, r] of room.rain.entries()) r.offset.set((t * 0.05 * (i + 1)) % 1, (t * (1.4 + i * 0.5)) % 1);
      room.drops.offset.y = (t * 0.015) % 1;
      const minutes = WS.clock.startMin + t / 60;
      room.hands.minute.rotation.z = -((minutes % 60) / 60) * Math.PI * 2;
      room.hands.hour.rotation.z = -(((minutes / 60) % 12) / 12) * Math.PI * 2;

      // The imbalance washer: rattles, hops on each turn, walks out from the wall and is back after.
      const ev2 = room.event;
      const spin = ev ? ev.spin : 0;
      const ph = ev ? Math.max(0, ev.ph) : 0;
      const creep = ev ? ev.creep : 0;
      const hz = 2 + 3 * spin;
      const hop = Math.max(0, Math.sin(t * hz * Math.PI * 2));
      // Walks straight out from the wall (its local +z), with a sideways wander and a twist.
      const out = creep * WS.imbalance.creep + sh * 0.01 * Math.sin(t * 39 + 1);
      const side = creep * 0.08 * Math.sin(ph * 0.8) + sh * 0.012 * Math.sin(t * 47);
      const c = Math.cos(eventYaw);
      const sn = Math.sin(eventYaw);
      ev2.position.set(eventHome.x + out * sn + side * c, eventHome.y + sh * 0.012 * hop * hop, eventHome.z + out * c - side * sn);
      ev2.rotation.set(sh * 0.02 * Math.sin(t * 23), eventYaw + creep * 0.16 * Math.sin(ph * 0.45 + 0.6) + sh * 0.035 * Math.sin(t * 31), sh * 0.03 * Math.sin(t * hz * Math.PI * 2), 'YXZ');
      room.spinEvent(washAngle(t, 1.3) + ph * spin * 26);
      // Its display panics in red while it rages.
      const rage = sh > 0.05;
      room.eventLed.color.setHex(rage ? C.ledIdle : C.led).multiplyScalar(L.ledHdr * power * (rage && Math.floor(t * 4) % 2 ? 0.15 : 1));

      extras.update(t, f.dt, smoothstep(0.15, 0.55, sh), stareAt);
    },
  };
  return map;
}

export const WASCHSALON: MapDef = {
  id: 'waschsalon',
  name: 'Waschsalon',
  blurb: 'Waschsalon um 3 Uhr nachts: Neonröhren, Regen und eine Maschine mit Unwucht.',
  build,
  sound: waschSound,
};
