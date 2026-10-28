import * as THREE from 'three';
import { COLORS, LIGHT_SCALE, LIGHTS, POINT_LIGHT_SCALE } from '../config';
import { flick, windowFlash } from '../core/motion';
import { at, basic, boxGeo, group, tag } from './build';
import type { CoachTextures } from './textures';

interface NeonSegment {
  tube: THREE.MeshBasicMaterial;
  halo: THREE.MeshBasicMaterial;
  seed: number;
  k: number;
}

export interface Lighting {
  /** `power` is the coach supply (1 normal, 0 blackout); the tunnel light through the windows ignores it. */
  update(t: number, speedFactor: number, power: number): void;
}

/**
 * Night lighting. The dark-blue neon strips (ceiling and floor, 5 per side) carry the room, each
 * flickering on its own schedule; every even ceiling segment drives a blue point light so the room
 * actually darkens when it stutters. Hemisphere and white lights are only a faint fill.
 */
export function buildLighting(scene: THREE.Scene, coach: THREE.Object3D, tex: CoachTextures, lobbySeed: number): Lighting {
  const neonColor = new THREE.Color(COLORS.neon);
  const hemi = new THREE.HemisphereLight(0x7088d0, 0x1a1c24, LIGHTS.hemi * LIGHT_SCALE);
  scene.add(hemi);
  const whites = [2.5, -2.5].map((z) => at(new THREE.PointLight(0xbcd0ff, LIGHTS.ceilingWhite * POINT_LIGHT_SCALE, 6, 1), 0, 2.0, z));
  scene.add(...whites);

  const winL = at(new THREE.PointLight(0x6f8cff, 0, 7, 2), -2.6, 1.4, 0.5);
  const winR = at(new THREE.PointLight(0xbcd0ff, 0, 7, 2), 2.6, 1.4, 0.5);
  scene.add(winL, winR);

  const neonGroup = group('neon', coach);
  const segments: NeonSegment[] = [];
  const blue: { light: THREE.PointLight; seg: NeonSegment }[] = [];
  // Lobby seed shifts every segment's phase, so two lobbies don't flicker in lockstep.
  const seedShift = (lobbySeed % 997) * 0.013;
  const tubeGeo = boxGeo(0.05, 0.025, 1.9);
  const haloCeil = new THREE.PlaneGeometry(0.8, 2.1).rotateX(Math.PI / 2);
  const haloFloor = new THREE.PlaneGeometry(0.8, 2.1).rotateX(-Math.PI / 2);

  for (const s of [-1, 1]) {
    for (const kind of ['ceiling', 'floor'] as const) {
      for (let idx = 0; idx < 5; idx++) {
        const z = -4 + idx * 2;
        const x = kind === 'ceiling' ? s * 0.46 : s * 0.96;
        const y = kind === 'ceiling' ? 2.372 : 0.014;
        const tube = basic(neonColor.getHex());
        const tubeMesh = tag(new THREE.Mesh(tubeGeo, tube), 'light');
        tubeMesh.userData.neon = 'tube';
        neonGroup.add(at(tubeMesh, x, y, z));
        const halo = new THREE.MeshBasicMaterial({
          map: tex.glow,
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const haloMesh = tag(new THREE.Mesh(kind === 'ceiling' ? haloCeil : haloFloor, halo), 'fx');
        haloMesh.userData.neon = 'halo';
        neonGroup.add(at(haloMesh, x, y + (kind === 'ceiling' ? -0.012 : 0.012), z));
        const seg: NeonSegment = { tube, halo, seed: segments.length * 1.37 + 0.5 + seedShift, k: 1 };
        segments.push(seg);
        if (kind === 'ceiling' && idx % 2 === 0) {
          const light = at(new THREE.PointLight(COLORS.neonLight, 0, 7, 1.4), s * 0.6, 2.1, z);
          scene.add(light);
          blue.push({ light, seg });
        }
      }
    }
  }

  return {
    update(t, sf, power) {
      winL.intensity = windowFlash(t, sf, 0) * LIGHTS.window * POINT_LIGHT_SCALE;
      winR.intensity = windowFlash(t, sf, 1) * LIGHTS.window * POINT_LIGHT_SCALE;
      // Hemisphere keeps a sliver during blackout: the tunnel and neighbour coaches still glow in.
      hemi.intensity = LIGHTS.hemi * LIGHT_SCALE * (0.35 + 0.65 * power);
      for (const w of whites) w.intensity = LIGHTS.ceilingWhite * POINT_LIGHT_SCALE * power;
      for (const seg of segments) {
        seg.k = flick(t, seg.seed) * power;
        seg.tube.color.copy(neonColor).multiplyScalar((0.04 + 0.96 * seg.k) * LIGHTS.neonTubeHdr);
        seg.halo.opacity = 0.55 * seg.k;
      }
      for (const b of blue) b.light.intensity = LIGHTS.neonBlue * POINT_LIGHT_SCALE * b.seg.k;
    },
  };
}
