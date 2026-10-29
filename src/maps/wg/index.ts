import * as THREE from 'three';
import { coachPower } from '../../core/motion';
import { group } from '../../scene/build';
import type { MapDef, MapScene, Spot } from '../types';
import { Batch } from './batch';
import { COL, FUSE, SEAT } from './config';
import { knock, lavaDetach } from './events';
import { buildFigures } from './figures';
import { buildFx } from './fx';
import { buildRoom, roomMats } from './room';
import { wgSound } from './sound';
import { makeWgTextures } from './textures';

const NO_FUSE = { ...FUSE, chance: -1 };

/**
 * Seats around the Fliesentisch: the sofa (0, 2) faces the armchair (1) and the bean bag (3), so
 * with four players it's sofa against the rest.
 */
const SEATS: Spot[] = [
  { x: -SEAT.x, y: SEAT.sofaY, z: -SEAT.z, yaw: Math.PI / 2 },
  { x: SEAT.x, y: SEAT.armchairY, z: -SEAT.z, yaw: -Math.PI / 2 },
  { x: -SEAT.x, y: SEAT.sofaY, z: SEAT.z, yaw: Math.PI / 2 },
  { x: SEAT.x, y: SEAT.beanY, z: SEAT.z, yaw: -Math.PI / 2 },
];

/** WG living room at 2 a.m.: Altbau, Fliesentisch, fairy lights on a loose contact, a neighbour who knocks. */
function build(scene: THREE.Scene, seed: number): MapScene {
  scene.background = new THREE.Color(COL.background);
  scene.fog = new THREE.Fog(COL.fog, 7, 22);
  const root = group('wg', scene);
  const tex = makeWgTextures();
  const mats = roomMats(tex);
  const batch = new Batch();
  buildRoom(batch, mats);
  const fx = buildFx(root, scene, batch, mats, tex, seed);
  batch.flush(root, 'wg_static');
  const figures = buildFigures(root, seed);

  let k = knock(0, seed);
  let lastT = 0;
  const map: MapScene = {
    root,
    seats: SEATS,
    npcs: [],
    scoldSpot(i) {
      // At the open end of the sofa / beside the chair, turned towards the seat.
      const s = SEATS[i];
      const x = s.x * 0.95;
      const z = s.z + Math.sign(s.z) * 0.85;
      return { x, y: 0, z, yaw: Math.atan2(s.x - x, s.z - z) };
    },
    overview: { pos: [1.6, 2.35, 2.75], look: [-0.05, 0.75, -0.7], fov: 60 },
    power: 1,
    shake: 0.12,
    events: () => {
      const e: string[] = [];
      if (map.power < 0.98) e.push('Sicherung raus');
      if (k) e.push('Nachbar klopft');
      if (lavaDetach(lastT, seed)) e.push('Lavablase');
      return e;
    },
    update(f) {
      lastT = f.t;
      map.power = coachPower(f.t, seed, f.blackouts ? FUSE : NO_FUSE, f.forcedBlackoutAt);
      k = knock(f.t, seed);
      fx.update(f.t, map.power, k);
      figures.update(f.t, f.dt, k);
    },
  };
  return map;
}

export const WG: MapDef = {
  id: 'wg',
  name: 'WG-Wohnzimmer',
  blurb: 'Fliesentisch, Lichterkette mit Wackelkontakt, 2 Uhr nachts – und der Nachbar klopft.',
  build,
  sound: wgSound,
};
