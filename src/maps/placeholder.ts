import * as THREE from 'three';
import { at, box, group } from '../scene/build';
import type { MapDef, MapId, MapScene } from './types';

/**
 * Bare room with four chairs, so a map can be registered (and picked) before it is built.
 * Each real map replaces its use of this.
 */
export function placeholderMap(id: MapId, name: string, blurb: string): MapDef {
  return {
    id,
    name,
    blurb,
    build(scene: THREE.Scene): MapScene {
      scene.background = new THREE.Color(0x0b0d12);
      scene.fog = new THREE.Fog(0x0b0d12, 6, 18);
      const root = group(id, scene);
      root.add(at(box(6, 0.1, 6, 0x30343c), 0, -0.05, 0));
      root.add(new THREE.HemisphereLight(0xdde4ff, 0x202020, 2.5));
      const seats = [
        { x: -0.8, y: 0.525, z: -0.45, yaw: Math.PI / 2 },
        { x: 0.8, y: 0.525, z: -0.45, yaw: -Math.PI / 2 },
        { x: -0.8, y: 0.525, z: 0.45, yaw: Math.PI / 2 },
        { x: 0.8, y: 0.525, z: 0.45, yaw: -Math.PI / 2 },
      ];
      for (const s of seats) root.add(at(box(0.45, 0.06, 0.45, 0x6a5040), s.x, 0.45, s.z));
      return {
        root,
        seats,
        npcs: [],
        scoldSpot: (i) => ({ x: 0, y: 0, z: seats[i].z + 0.6, yaw: Math.PI }),
        overview: { pos: [0, 1.8, 3.4], look: [0, 0.9, 0], fov: 60 },
        power: 1,
        shake: 0,
        events: () => [],
        update() {},
      };
    },
    sound: () => ({ update() {} }),
  };
}
