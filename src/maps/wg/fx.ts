import * as THREE from 'three';
import { LIGHT_SCALE, POINT_LIGHT_SCALE } from '../../config';
import { noise1 } from '../../core/motion';
import { hash01 } from '../../core/rng';
import { tag } from '../../scene/build';
import type { Batch } from './batch';
import { KNOCK, ROOM, TABLE, WG_LIGHT } from './config';
import { fairyContact, lavaDetach, type Phase, tvSnow } from './events';
import { CYL, type RoomMats, SPH } from './room';
import type { WgTextures } from './textures';

// Everything in the room that glows or moves on its own: the light sources and their real lights.

export interface Fx {
  update(t: number, power: number, k: Phase | null): void;
}

/** Where the fairy-light bulbs hang: three sagging spans along the wall above the sofa. */
function fairyPoints(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const nails = [-1.75, -0.6, 0.6, 1.75];
  const x = ROOM.minX + 0.03;
  for (let s = 0; s < nails.length - 1; s++) {
    const n = 11;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const z = nails[s] + (nails[s + 1] - nails[s]) * u;
      const y = 2.3 - 0.22 * Math.sin(u * Math.PI) - (s === 1 ? 0.06 * Math.sin(u * Math.PI) : 0);
      pts.push(new THREE.Vector3(x, y, z));
    }
  }
  pts.push(new THREE.Vector3(x, 2.3, nails[nails.length - 1]));
  return pts;
}

const FAIRY_COLORS = [0xff4a3a, 0xffc040, 0x40c060, 0x4a7aff, 0xff7ad0];

export function buildFx(root: THREE.Object3D, scene: THREE.Scene, b: Batch, M: RoomMats, tex: WgTextures, seed: number): Fx {
  const add = <T extends THREE.Object3D>(o: T, role: 'light' | 'fx' | 'prop' = 'light'): T => {
    root.add(tag(o, role));
    return o;
  };

  // --- Real lights: candle, TV, street light through the window, fairy lights. Fill = hemisphere.
  const hemi = new THREE.HemisphereLight(WG_LIGHT.hemiSky, WG_LIGHT.hemiGround, WG_LIGHT.hemi * LIGHT_SCALE);
  scene.add(hemi);
  const candleLight = new THREE.PointLight(0xff8a3a, 0, WG_LIGHT.candleDist, 1.5);
  candleLight.position.set(0.1, TABLE.h + 0.5, 0.16);
  const tvLight = new THREE.PointLight(0x9fb6ff, 0, WG_LIGHT.tvDist, 1.4);
  tvLight.position.set(1.78, 0.85, ROOM.minZ + 0.75);
  const streetLight = new THREE.PointLight(0xff8a30, WG_LIGHT.street * POINT_LIGHT_SCALE, WG_LIGHT.streetDist, 1.2);
  streetLight.position.set(ROOM.winX, 2.3, ROOM.minZ - 0.15);
  const fairyLight = new THREE.PointLight(0xffb070, 0, WG_LIGHT.fairyDist, 1.4);
  fairyLight.position.set(ROOM.minX + 0.35, 2.05, 0);
  scene.add(candleLight, tvLight, streetLight, fairyLight);

  // --- Fairy lights: one instanced draw, the wire goes into the static batch.
  const pts = fairyPoints();
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const c = pts[i + 1];
    const d = c.clone().sub(a);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    b.addMatrix(CYL, M.matte, 0x1e3a1e, new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), q, new THREE.Vector3(0.003, d.length(), 0.003)));
  }
  const fairyMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.016, 8, 6), fairyMat, pts.length);
  const m4 = new THREE.Matrix4();
  pts.forEach((p, i) => {
    bulbs.setMatrixAt(i, m4.makeTranslation(p.x + 0.01, p.y - 0.022, p.z).multiply(new THREE.Matrix4().makeScale(1, 1.4, 1)));
    bulbs.setColorAt(i, new THREE.Color(FAIRY_COLORS[i % FAIRY_COLORS.length]));
  });
  bulbs.computeBoundingSphere();
  add(bulbs);

  // --- Lava lamp on the sideboard.
  const lava = new THREE.Group();
  lava.position.set(2.32, 0.55, ROOM.minZ + 0.2);
  root.add(lava);
  const lathe = (pts: [number, number][]) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 20);
  b.addMatrix(lathe([[0.075, 0], [0.08, 0.015], [0.06, 0.08], [0.045, 0.13], [0, 0.13]]), M.shiny, 0x8a8a90, new THREE.Matrix4().makeTranslation(lava.position.x, lava.position.y, lava.position.z));
  b.addMatrix(lathe([[0, 0], [0.034, 0], [0.018, 0.07], [0, 0.07]]), M.shiny, 0x8a8a90, new THREE.Matrix4().makeTranslation(lava.position.x, lava.position.y + 0.42, lava.position.z));
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xff6a2a, emissive: 0xff3a10, emissiveIntensity: 0.3, transparent: true, opacity: 0.55, roughness: 0.15, depthWrite: false });
  const glass = add(new THREE.Mesh(lathe([[0.045, 0], [0.058, 0.07], [0.054, 0.17], [0.034, 0.29]]), glassMat));
  glass.position.y = 0.13;
  glass.renderOrder = 2;
  lava.add(glass);
  const blobMat = new THREE.MeshBasicMaterial({ color: 0xff3a1a });
  const blobs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), blobMat, 5);
  blobs.frustumCulled = false;
  lava.add(tag(blobs, 'light'));

  // --- CRT screen.
  const screenMat = new THREE.MeshBasicMaterial({ map: tex.testcard, color: 0xffffff });
  const screen = add(new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.33), screenMat));
  screen.position.set(1.75, 0.8, ROOM.minZ + 0.25 + 0.212);
  const snowTex = tex.snow;

  // --- Paper-ball lamp hanging over the table; it swings when the neighbour knocks.
  const lampPivot = new THREE.Group();
  lampPivot.position.set(0, ROOM.height - 0.04, 0);
  root.add(lampPivot);
  const cordLen = 0.66;
  const cord = add(new THREE.Mesh(CYL, new THREE.MeshStandardMaterial({ color: 0x111111 })), 'prop');
  cord.scale.set(0.004, cordLen, 0.004);
  cord.position.y = -cordLen / 2;
  lampPivot.add(cord);
  const paperMat = new THREE.MeshBasicMaterial({ map: tex.paper, color: 0xffffff });
  const paper = add(new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 16), paperMat));
  paper.position.y = -cordLen - 0.25;
  lampPivot.add(paper);

  // --- Candle flame and the warm pool it throws on the tiles.
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb050 });
  const flame = add(new THREE.Mesh(SPH, flameMat));
  flame.position.set(0.1, TABLE.h + 0.44, 0.16);
  const poolMat = new THREE.MeshBasicMaterial({ map: tex.glow, color: 0xff8a3a, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
  const pool = add(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2), poolMat), 'fx');
  pool.position.set(0.1, TABLE.h + 0.004, 0.16);

  // --- Outside: the house across the street, the lamp post, and its light on the ceiling.
  const facade = add(new THREE.Mesh(new THREE.PlaneGeometry(18, 13), new THREE.MeshBasicMaterial({ map: tex.facade, fog: false, color: 0x9a9aa8 })), 'prop');
  facade.material.map!.repeat.set(2, 1.5);
  facade.position.set(ROOM.winX, 0.5, -13);
  const lampHead = add(new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff9a40).multiplyScalar(WG_LIGHT.streetLampHdr), fog: false })));
  lampHead.scale.set(0.16, 0.09, 0.16);
  lampHead.position.set(ROOM.winX + 0.9, 2.75, -5.6);
  const halo = add(
    new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: tex.glow, color: 0xff8a30, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })),
    'fx',
  );
  halo.position.set(ROOM.winX + 0.9, 2.75, -5.5);
  b.add(CYL, M.matte, 0x1a1a1e, [ROOM.winX + 0.9, -3, -5.6], [0, 0, 0], [0.05, 11.4, 0.05]);
  b.add(CYL, M.matte, 0x1a1a1e, [ROOM.winX + 0.9, 2.83, -5.6], [0, 0, 0], [0.18, 0.05, 0.18]);
  const winPool = add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 1.9).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tex.window, color: 0xff8a30, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }),
    ),
    'fx',
  );
  // Light from a lamp below the window lands on the ceiling, stretched into the room.
  winPool.position.set(ROOM.winX + 0.15, ROOM.height - 0.01, ROOM.minZ + 1.3);
  winPool.rotation.y = 0.12;

  const blobColor = new THREE.Color(0xff3a1a);

  return {
    update(t, power, k) {
      // Candle: on its own, the fuse can't touch it.
      const fl = 0.82 + 0.1 * noise1(t * 7.3 + seed) + 0.06 * Math.sin(t * 23 + noise1(t * 3));
      candleLight.intensity = WG_LIGHT.candle * POINT_LIGHT_SCALE * fl;
      flameMat.color.setHex(0xffb050).multiplyScalar(WG_LIGHT.flameHdr * (0.8 + 0.2 * fl));
      flame.scale.set(0.009, 0.026 * (0.85 + 0.25 * fl), 0.009);
      flame.position.x = 0.1 + 0.002 * noise1(t * 5.1);
      poolMat.opacity = 0.22 * fl;

      // Fairy lights: the loose contact, the knock, the fuse.
      const fc = fairyContact(t, seed, k) * power;
      fairyMat.color.setScalar(0.06 + (WG_LIGHT.fairyHdr - 0.06) * fc);
      fairyLight.intensity = WG_LIGHT.fairy * POINT_LIGHT_SCALE * fc;

      // TV: test card or snow, jittering brightness; dark when the fuse is out.
      const snow = tvSnow(t, seed);
      const fr = Math.floor(t * 24);
      if (snow) {
        screenMat.map = snowTex;
        snowTex.offset.set(hash01(fr, 1), hash01(fr, 2));
      } else screenMat.map = tex.testcard;
      const jitter = snow ? 0.75 + 0.25 * hash01(fr, 3) : 0.92 + 0.08 * Math.sin(t * 60);
      screenMat.color.setScalar(0.02 + (WG_LIGHT.tvHdr - 0.02) * jitter * power);
      tvLight.intensity = WG_LIGHT.tv * POINT_LIGHT_SCALE * jitter * power * (snow ? 0.8 : 1);
      tvLight.color.setHex(snow ? 0xb8c4e0 : 0x9fb6ff);

      // Paper lamp: dimmed by the fuse; it carries the hemisphere fill.
      paperMat.color.setHex(0xffc890).multiplyScalar(0.03 + (WG_LIGHT.paperHdr - 0.03) * power);
      hemi.intensity = WG_LIGHT.hemi * LIGHT_SCALE * (0.35 + 0.65 * power);
      // Three thuds through the ceiling, the lamp swings a little after each.
      let swing = 0.004 * Math.sin(t * 0.7);
      let swing2 = 0.003 * Math.sin(t * 0.53 + 1);
      if (k) {
        for (const th of KNOCK.thuds) {
          const p = k.ph - th;
          if (p > 0) {
            const e = Math.exp(-p * 0.45);
            swing += 0.035 * e * Math.sin(p * 2.9);
            swing2 += 0.02 * e * Math.sin(p * 2.6 + 0.7);
          }
        }
      }
      lampPivot.rotation.set(swing, 0, swing2);

      // Lava lamp: slow blobs, plus the occasional one that tears loose from the bottom.
      const glow = (0.08 + 0.92 * power) * (0.9 + 0.1 * Math.sin(t * 0.3));
      blobMat.color.copy(blobColor).multiplyScalar(WG_LIGHT.lavaHdr * glow);
      glassMat.emissiveIntensity = 0.35 * glow;
      const det = lavaDetach(t, seed);
      const base = 0.15;
      // Pool at the bottom, always there.
      blobs.setMatrixAt(0, m4.compose(new THREE.Vector3(0, base + 0.01, 0), new THREE.Quaternion(), new THREE.Vector3(0.045, 0.022, 0.045)));
      for (let i = 1; i < 4; i++) {
        const u = 0.5 + 0.5 * Math.sin(t * (0.07 + i * 0.025) + i * 2.1 + seed * 0.001);
        const y = base + 0.04 + u * 0.2;
        const r = 0.014 + 0.006 * i;
        const stretch = 1 + 0.25 * Math.cos(t * (0.07 + i * 0.025) + i * 2.1);
        blobs.setMatrixAt(i, m4.compose(new THREE.Vector3(0.01 * Math.sin(t * 0.2 + i), y, 0.01 * Math.cos(t * 0.17 + i)), new THREE.Quaternion(), new THREE.Vector3(r / Math.sqrt(stretch), r * stretch, r / Math.sqrt(stretch))));
      }
      if (det) {
        // Neck grows out of the pool, snaps at 0.2, the blob wobbles up, rests under the cap, sinks.
        const p = det.ph;
        let y: number;
        let sy: number;
        if (p < 0.2) {
          y = base + 0.02 + 0.06 * (p / 0.2);
          sy = 0.02 + 0.04 * (p / 0.2);
        } else if (p < 0.55) {
          const u = (p - 0.2) / 0.35;
          y = base + 0.09 + 0.17 * (u * u * (3 - 2 * u));
          sy = 0.03 * (1 + 0.15 * Math.sin(u * 20));
        } else {
          const u = (p - 0.55) / 0.45;
          y = base + 0.26 - 0.2 * u * u;
          sy = 0.03;
        }
        blobs.setMatrixAt(4, m4.compose(new THREE.Vector3(0, y, 0), new THREE.Quaternion(), new THREE.Vector3(0.028, sy, 0.028)));
      } else blobs.setMatrixAt(4, m4.makeScale(0, 0, 0));
      blobs.instanceMatrix.needsUpdate = true;
    },
  };
}
