import * as THREE from 'three';
import { COLORS, LIGHT_SCALE, LIGHTS, ONCOMING, POINT_LIGHT_SCALE } from '../config';
import { flick, oncoming, windowFlash } from '../core/motion';
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
  /** An oncoming train is sweeping past right now (for the benchmark's stutter log). */
  readonly passing: boolean;
  /** The fill light; the baked crowds copy it into their unlit material. */
  readonly hemi: THREE.HemisphereLight;
}

/**
 * Night lighting. The dark-blue neon strips (ceiling and floor, 5 per side) carry the room, each
 * flickering on its own schedule; every even ceiling segment drives a blue point light so the room
 * actually darkens when it stutters. Hemisphere and white lights are only a faint fill.
 */
export function buildLighting(scene: THREE.Scene, coach: THREE.Object3D, tex: CoachTextures, lobbySeed: number): Lighting {
  const lean = leanLights();
  const neonColor = new THREE.Color(COLORS.neon);
  const hemi = new THREE.HemisphereLight(0x7088d0, 0x1a1c24, LIGHTS.hemi * LIGHT_SCALE);
  scene.add(hemi);
  const whites = [2.5, -2.5].map((z) => at(new THREE.PointLight(0xbcd0ff, LIGHTS.ceilingWhite * POINT_LIGHT_SCALE, 6, 1), 0, 2.0, z));
  scene.add(...whites);

  const winL = at(new THREE.PointLight(0x6f8cff, 0, 7, 2), -2.6, 1.4, 0.5);
  const winR = at(new THREE.PointLight(0xbcd0ff, 0, 7, 2), 2.6, 1.4, 0.5);
  scene.add(winL, winR);
  // Oncoming train: its lit windows race past ours, a cold light sweeping along one side of the coach.
  const passLight = at(new THREE.PointLight(0xdfe8ff, 0, 5, 1.6), 0, 1.45, 0);
  scene.add(passLight);

  const neonGroup = group('neon', coach);
  const segments: NeonSegment[] = [];
  const blue: { light: THREE.PointLight; segs: NeonSegment[]; gain: number }[] = [];
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
          blue.push({ light, segs: [seg], gain: 1 });
        }
      }
    }
  }

  if (lean) {
    // 4 point lights instead of 11 (every point light costs every lit pixel; ~-24 % GPU). The white fill goes into the
    // hemisphere, each side's three blue lights become one longer-reaching light in the middle that
    // follows the average of their segments, and the oncoming train borrows the window light of its side.
    scene.remove(...whites, passLight);
    whites.length = 0;
    for (const side of [0, 1]) {
      const three = blue.slice(side * 3, side * 3 + 3);
      for (const b of three) if (b !== three[1]) scene.remove(b.light);
      three[1].segs = three.flatMap((b) => b.segs);
      three[1].gain = LEAN.blueGain;
      three[1].light.distance = LEAN.blueDistance;
    }
    const kept = [blue[1], blue[4]];
    blue.length = 0;
    blue.push(...kept);
  }
  const hemiScale = lean ? LEAN.hemiGain : 1;

  let passing = false;
  return {
    hemi,
    get passing() {
      return passing;
    },
    update(t, sf, power) {
      winL.intensity = windowFlash(t, sf, 0) * LIGHTS.window * POINT_LIGHT_SCALE;
      winR.intensity = windowFlash(t, sf, 1) * LIGHTS.window * POINT_LIGHT_SCALE;
      if (lean) {
        winL.position.z = winR.position.z = 0.5;
        winL.color.setHex(0x6f8cff);
        winR.color.setHex(0xbcd0ff);
      }
      const on = oncoming(t, lobbySeed, ONCOMING);
      passing = !!on;
      if (on) {
        // Strobing (window, gap, window …) and sweeping front to back while the train passes.
        const strobe = Math.sin(t * 70) > -0.3 ? 1 : 0.15;
        passLight.position.set(on.side * 1.35, 1.45, -6 + 12 * on.phase);
        passLight.intensity = 9 * Math.sin(on.phase * Math.PI) * strobe * POINT_LIGHT_SCALE;
        if (lean) {
          const w = on.side < 0 ? winL : winR;
          w.position.z = passLight.position.z;
          w.color.setHex(0xdfe8ff);
          w.intensity = Math.max(w.intensity, passLight.intensity);
        }
      } else passLight.intensity = 0;
      // Hemisphere keeps a sliver during blackout: the tunnel and neighbour coaches still glow in.
      hemi.intensity = LIGHTS.hemi * LIGHT_SCALE * (0.35 + 0.65 * power) * (lean ? 1 + (hemiScale - 1) * power : 1);
      for (const w of whites) w.intensity = LIGHTS.ceilingWhite * POINT_LIGHT_SCALE * power;
      for (const seg of segments) {
        seg.k = flick(t, seg.seed) * power;
        seg.tube.color.copy(neonColor).multiplyScalar((0.04 + 0.96 * seg.k) * LIGHTS.neonTubeHdr);
        seg.halo.opacity = 0.55 * seg.k;
      }
      for (const b of blue) {
        let k = 0;
        for (const seg of b.segs) k += seg.k;
        b.light.intensity = LIGHTS.neonBlue * POINT_LIGHT_SCALE * b.gain * (k / b.segs.length);
      }
    },
  };
}

/** Gains of the lean light set, tuned so the coach keeps roughly the same brightness. */
const LEAN = { hemiGain: 1.15, blueGain: 1.7, blueDistance: 11 } as const;

/** The lean 4-light set is the default; `?lights=full` (dev only) brings back the old 11 for comparison. */
function leanLights(): boolean {
  if (!import.meta.env.DEV || typeof location === 'undefined') return true;
  return new URLSearchParams(location.search).get('lights') !== 'full';
}
