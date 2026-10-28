import * as THREE from 'three';
import { SPEED, TUNNEL } from '../config';
import { hash01, mulberry32 } from '../core/rng';
import { group, tag } from './build';
import { canvasTex } from './textures';

export interface Tunnel {
  /** `distance` is the travelled distance in scene units; `kmh` only stretches the streaks. */
  update(t: number, distance: number, kmh: number): void;
}

/**
 * Two crossed unit planes (horizontal + vertical), length along z. Seen from any angle inside the
 * coach at least one plane faces the camera, so a flat textured streak never vanishes edge-on.
 */
function crossedPlanes(): THREE.BufferGeometry {
  const h = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const v = h.clone().rotateZ(Math.PI / 2);
  const g = new THREE.BufferGeometry();
  const merge = (a: THREE.BufferGeometry, b: THREE.BufferGeometry, name: string) =>
    new THREE.Float32BufferAttribute([...(a.getAttribute(name).array as Float32Array), ...(b.getAttribute(name).array as Float32Array)], a.getAttribute(name).itemSize);
  g.setAttribute('position', merge(h, v, 'position'));
  g.setAttribute('uv', merge(h, v, 'uv'));
  const idx = [...h.index!.array];
  g.setIndex([...idx, ...idx.map((i) => i + 4)]);
  return g;
}

/**
 * Light streak texture: bright head at the front (+z, canvas bottom), long fading tail, soft edges.
 * The tail is what makes the streaks read as motion blur instead of rigid sticks.
 */
function streakTex(edge: number): THREE.CanvasTexture {
  return canvasTex(32, 256, (x, w, h) => {
    const along = x.createLinearGradient(0, 0, 0, h);
    along.addColorStop(0, 'rgba(255,255,255,0)');
    along.addColorStop(0.75, 'rgba(255,255,255,0.55)');
    along.addColorStop(0.97, 'rgba(255,255,255,1)');
    along.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = along;
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'destination-in';
    const across = x.createLinearGradient(0, 0, w, 0);
    across.addColorStop(0, 'rgba(0,0,0,0)');
    across.addColorStop(0.5 - edge, 'rgba(0,0,0,1)');
    across.addColorStop(0.5 + edge, 'rgba(0,0,0,1)');
    across.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = across;
    x.fillRect(0, 0, w, h);
  });
}

function streakMat(map: THREE.Texture, opacity: number): THREE.MeshBasicMaterial {
  const tex = map;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Light streaks rushing past the windows: a core layer and a wide, faint glow layer, each one
 * InstancedMesh (= one draw call). Position is a pure function of (seed, index, distance): after
 * each wrap a streak re-rolls its x/y from a hash of the lap, so peers that agree on the distance
 * agree on the picture. Brightness pulses per streak so the field never looks frozen.
 */
export function buildTunnel(scene: THREE.Scene, seed: number): Tunnel {
  const root = group('tunnel', scene);
  const N = TUNNEL.count;
  const back = TUNNEL.front - TUNNEL.wrap;
  const rows = TUNNEL.regular / 4;
  const rand = mulberry32(seed ^ 0x7e11);

  const z0 = new Float32Array(N);
  const len = new Float32Array(N);
  const thick = new Float32Array(N);
  const fixedX = new Float32Array(N);
  const fixedY = new Float32Array(N);
  const speedMul = new Float32Array(N);
  const pulseF = new Float32Array(N);
  const base: THREE.Color[] = [];

  const geo = crossedPlanes();
  const core = new THREE.InstancedMesh(geo, streakMat(streakTex(0.12), 0.95), N);
  const glow = new THREE.InstancedMesh(geo, streakMat(streakTex(0.02), TUNNEL.glowOpacity), N);
  core.name = 'streaks';
  glow.name = 'glow';
  for (const m of [core, glow]) {
    m.frustumCulled = false;
    tag(m, 'outside');
    root.add(m);
  }
  tag(glow, 'fx');

  for (let i = 0; i < N; i++) {
    const c = new THREE.Color();
    if (i < TUNNEL.regular) {
      // Rails: rows of 4 (left/right x top/bottom), evenly spaced along the wrap.
      const k = i >> 2;
      const side = i & 1 ? 1 : -1;
      const row = (i >> 1) & 1;
      fixedX[i] = side * 2.5;
      fixedY[i] = row ? 2.35 : 0.35;
      z0[i] = k * (TUNNEL.wrap / rows);
      len[i] = 0.9;
      thick[i] = 0.08;
      speedMul[i] = 1;
      c.setHex(TUNNEL.colors[row ? 1 : 2]);
    } else {
      z0[i] = rand() * TUNNEL.wrap;
      len[i] = 0.4 + rand() * 2.2;
      thick[i] = 0.015 + rand() * 0.05;
      // Slight speed spread fakes parallax depth between debris layers.
      speedMul[i] = 0.85 + rand() * 0.4;
      c.setHex(TUNNEL.colors[Math.floor(rand() * TUNNEL.colors.length)]);
    }
    pulseF[i] = 2 + rand() * 9;
    base.push(c);
    core.setColorAt(i, c);
    glow.setColorAt(i, c);
  }

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  return {
    update(t, distance, kmh) {
      const v = (kmh / 3.6) * SPEED.visualScale;
      const stretch = 1 + v * SPEED.stretchPerUnit;
      for (let i = 0; i < N; i++) {
        const s = z0[i] + distance * speedMul[i];
        const lap = Math.floor(s / TUNNEL.wrap);
        const z = back + (s - lap * TUNNEL.wrap);
        let x = fixedX[i];
        let y = fixedY[i];
        if (i >= TUNNEL.regular) {
          const side = hash01(seed, i, lap, 1) < 0.5 ? -1 : 1;
          x = side * (2.0 + hash01(seed, i, lap, 2) * 3.5);
          y = hash01(seed, i, lap, 3) * 2.8 - 0.1;
        }
        const l = len[i] * stretch;
        // Fade in/out near the wrap ends so streaks don't pop into existence.
        const edge = Math.min(1, (z - back) / 6, (TUNNEL.front - z) / 6);
        const pulse = (0.65 + 0.35 * Math.sin(t * pulseF[i] + i)) * Math.max(0, edge);

        dummy.position.set(x, y, z - l / 2);
        dummy.scale.set(thick[i] * TUNNEL.coreWidth, thick[i] * TUNNEL.coreWidth, l);
        dummy.updateMatrix();
        core.setMatrixAt(i, dummy.matrix);
        dummy.scale.set(thick[i] * TUNNEL.glowWidth, thick[i] * TUNNEL.glowWidth, l * 1.15);
        dummy.updateMatrix();
        glow.setMatrixAt(i, dummy.matrix);

        col.copy(base[i]).multiplyScalar(pulse);
        core.setColorAt(i, col);
        glow.setColorAt(i, col);
      }
      core.instanceMatrix.needsUpdate = true;
      glow.instanceMatrix.needsUpdate = true;
      core.instanceColor!.needsUpdate = true;
      glow.instanceColor!.needsUpdate = true;
    },
  };
}
