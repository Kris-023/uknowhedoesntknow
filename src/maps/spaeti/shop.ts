import * as THREE from 'three';
import { mulberry32 } from '../../core/rng';
import { at, basic, group, std, tag } from '../../scene/build';
import { canvasTex } from '../../scene/textures';
import { ACCENT, COUNTER, FRIDGE, ROOM, SEATING, SPAETI_LIGHT, STREET } from './config';
import { Merger, metricBox } from './merge';
import * as T from './textures';

/** Materials and meshes the map animates every frame. */
export interface ShopParts {
  /** Ceiling tubes that burn steadily, and the one fixture that stutters. */
  tubes: THREE.MeshBasicMaterial;
  badTube: THREE.MeshBasicMaterial;
  fridgePanel: THREE.MeshBasicMaterial;
  fridgeLed: THREE.MeshBasicMaterial;
  /** Lit signs and machines that die with the block power. */
  signs: THREE.MeshBasicMaterial[];
  slush: THREE.CanvasTexture[];
  slushMats: THREE.MeshBasicMaterial[];
  sausages: THREE.InstancedMesh;
  sausageBase: THREE.Matrix4[];
  heatLamp: THREE.MeshBasicMaterial;
  neon: THREE.MeshBasicMaterial;
  exit: THREE.MeshBasicMaterial;
  phone: THREE.MeshBasicMaterial;
  lampHead: THREE.MeshBasicMaterial;
  lampPool: THREE.MeshBasicMaterial;
  facade: THREE.MeshBasicMaterial;
  tv: THREE.MeshBasicMaterial;
  till: THREE.MeshBasicMaterial;
}

const W = ROOM.right - ROOM.left;
const D = ROOM.front - ROOM.back;

/** Basic material with a colour multiplier; above ~0.3 per channel it crosses the bloom threshold. */
function glow(color: number, k: number, o: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  const m = basic(color, o);
  m.color.multiplyScalar(k);
  m.userData.base = m.color.clone();
  return m;
}

/** Plane facing a direction: 'x+' etc. (PlaneGeometry faces +z by default). */
function plane(w: number, h: number, face: 'x+' | 'x-' | 'z+' | 'z-' | 'y+' | 'y-'): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  if (face === 'x+') g.rotateY(Math.PI / 2);
  else if (face === 'x-') g.rotateY(-Math.PI / 2);
  else if (face === 'z-') g.rotateY(Math.PI);
  else if (face === 'y+') g.rotateX(-Math.PI / 2);
  else if (face === 'y-') g.rotateX(Math.PI / 2);
  return g;
}

export function buildShop(root: THREE.Object3D): ShopParts {
  const shop = group('spaeti_shop', root);
  const M = new Merger();
  const L = SPAETI_LIGHT;

  // --- Shell: floor, walls, ceiling --------------------------------------------------------
  const floorMap = T.floorTex();
  floorMap.repeat.set(W / 1.6, D / 1.6);
  const floor = tag(new THREE.Mesh(plane(W, D, 'y+'), std(0xffffff, { map: floorMap, roughness: 0.32, metalness: 0.05 })), 'struct');
  shop.add(at(floor, 0, 0, (ROOM.front + ROOM.back) / 2));
  const ceilMap = T.ceilingTex();
  ceilMap.repeat.set(W / 0.6, D / 0.6);
  const ceil = tag(new THREE.Mesh(plane(W, D, 'y-'), std(0xffffff, { map: ceilMap, roughness: 0.9, metalness: 0 })), 'struct');
  shop.add(at(ceil, 0, ROOM.height, (ROOM.front + ROOM.back) / 2));

  const wallMat = std(0xffffff, { map: T.wallTex(), roughness: 0.85, metalness: 0 });
  const H = ROOM.height;
  const wb = (w: number, h: number, d: number, x: number, y: number, z: number) => M.add(wallMat, metricBox(w, h, d, 0.6), x, y, z);
  wb(W + 0.2, H, 0.1, 0, H / 2, ROOM.back - 0.05);
  wb(0.1, H, D, ROOM.left - 0.05, H / 2, (ROOM.front + ROOM.back) / 2);
  wb(0.1, H, D, ROOM.right + 0.05, H / 2, (ROOM.front + ROOM.back) / 2);
  // Front: low sill under the window, header above window and door, pillar right of the door.
  const fz = ROOM.front + 0.06;
  wb(ROOM.doorX0 - ROOM.left, ROOM.windowSill, 0.12, (ROOM.left + ROOM.doorX0) / 2, ROOM.windowSill / 2, fz);
  wb(W, H - ROOM.windowTop, 0.12, 0, (H + ROOM.windowTop) / 2, fz);
  wb(ROOM.right - ROOM.doorX1, ROOM.windowTop, 0.12, (ROOM.right + ROOM.doorX1) / 2, ROOM.windowTop / 2, fz);

  // Accent band around the walls: the shop's own colours.
  const teal = std(ACCENT.teal, { roughness: 0.45, metalness: 0.1 });
  const pink = std(ACCENT.pink, { roughness: 0.45, metalness: 0.1 });
  M.box(teal, W, 0.12, 0.02, 0, 2.3, ROOM.back + 0.01);
  M.box(pink, W, 0.04, 0.02, 0, 2.2, ROOM.back + 0.01);
  M.box(teal, 0.02, 0.12, D, ROOM.right - 0.01, 2.3, (ROOM.front + ROOM.back) / 2);
  M.box(pink, 0.02, 0.04, D, ROOM.right - 0.01, 2.2, (ROOM.front + ROOM.back) / 2);
  const skirting = std(0x2a2d33, { roughness: 0.6 });
  M.box(skirting, W, 0.1, 0.02, 0, 0.05, ROOM.back + 0.01);
  M.box(skirting, 0.02, 0.1, D, ROOM.left + 0.01, 0.05, (ROOM.front + ROOM.back) / 2);

  // --- Ceiling fluorescents ----------------------------------------------------------------
  const housing = std(0xe8eaec, { roughness: 0.5, metalness: 0.3 });
  const tubes = glow(0xeef6ff, L.tubeHdr);
  const badTube = glow(0xeef6ff, L.tubeHdr);
  const fixtures: [number, number][] = [];
  for (const x of [-1.7, 0.3, 2.15]) for (const z of [-2.3, -0.5, 1.3]) fixtures.push([x, z]);
  for (const [x, z] of fixtures) {
    M.box(housing, 0.34, 0.04, 1.32, x, H - 0.02, z);
    const bad = x === 0.3 && z === -0.5;
    for (const dx of [-0.08, 0.08]) M.box(bad ? badTube : tubes, 0.035, 0.035, 1.22, x + dx, H - 0.06, z, 0, 'light');
  }

  // --- Fridge wall (left) -----------------------------------------------------------------
  const F = FRIDGE;
  const fx = ROOM.left + 0.55;
  const fLen = F.doors * F.doorW;
  const fzMid = F.z0 + fLen / 2;
  const steel = std(0x1c1f24, { roughness: 0.35, metalness: 0.6 });
  const chrome = std(0xc8ccd2, { roughness: 0.2, metalness: 0.9 });
  M.box(steel, 0.55, 0.15, fLen + 0.1, ROOM.left + 0.275, 0.075, fzMid);
  M.box(steel, 0.55, 0.12, fLen + 0.1, ROOM.left + 0.275, 0.15 + F.doorH + 0.06, fzMid);
  M.box(steel, 0.55, H - 2.17, fLen + 0.1, ROOM.left + 0.275, (H + 2.17) / 2 + 0.33, fzMid);
  const fridgeMap = T.fridgeTex();
  const fridgePanel = glow(0xffffff, F.panelGlow, { map: fridgeMap });
  const fridgeLed = glow(0xdff0ff, F.ledHdr);
  const cols = [0, 1, 2, 3, 1];
  for (let i = 0; i < F.doors; i++) {
    const zc = F.z0 + (i + 0.5) * F.doorW;
    const g = plane(F.doorW - 0.07, F.doorH - 0.06, 'x+');
    // Each door shows one column of the shelf sheet.
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setX(k, (cols[i] + uv.getX(k)) / 4);
    M.add(fridgePanel, g, fx, 0.15 + F.doorH / 2, zc, 0, 0, 0, 'light');
    // Handle on the side away from the hinge.
    M.box(chrome, 0.03, 0.9, 0.025, fx + 0.04, 1.15, zc + (i % 2 ? -1 : 1) * (F.doorW / 2 - 0.08));
  }
  for (let i = 0; i <= F.doors; i++) {
    const zc = F.z0 + i * F.doorW;
    M.box(steel, 0.06, F.doorH, 0.06, fx, 0.15 + F.doorH / 2, zc);
    if (i > 0 && i < F.doors) M.box(fridgeLed, 0.012, F.doorH - 0.1, 0.014, fx + 0.035, 0.15 + F.doorH / 2, zc, 0, 'light');
  }
  M.box(fridgeLed, 0.012, 0.014, fLen - 0.1, fx + 0.035, 0.15 + F.doorH - 0.04, fzMid, 0, 'light');
  // Header lightbox above the doors.
  const header = glow(0xffffff, L.signGlow, { map: T.signTex('EISKALT', 'BIER · MATE · LIMO · ENERGY · WASSER', '#0e8f82', '#f4fffd', 1024, 128) });
  M.add(header, plane(fLen, 0.3, 'x+'), fx + 0.01, 2.33, fzMid, 0, 0, 0, 'light');

  // --- Shelves with products (instanced) ----------------------------------------------------
  const rnd = mulberry32(0x5e1f);
  const shelfMat = std(0xd7dade, { roughness: 0.5, metalness: 0.4 });
  const shelfBack = std(0x3a3f47, { roughness: 0.8, metalness: 0.1 });
  const products: { x: number; y: number; z: number; w: number; h: number; d: number; ry: number; c: number }[] = [];
  const palette = [0xe0262c, 0xf5c21b, 0x1f6fd6, 0x2fb34a, 0xff8a1f, 0x7a3fd6, 0xffffff, 0x1a1a1a, 0xff3d8b, 0x14c8b4, 0xc8a46a, 0x8a2a1a];
  /** Fill a shelf board (length along `axis`) with product facings, front facing `face` (yaw). */
  const fill = (x0: number, z0: number, len: number, axis: 'x' | 'z', y: number, depth: number, ry: number, maxH: number) => {
    let s = 0.02;
    while (s < len - 0.08) {
      const w = 0.06 + rnd() * 0.12;
      const h = Math.min(maxH, 0.1 + rnd() * 0.22);
      const d = Math.min(depth, 0.1 + rnd() * 0.15);
      const c = palette[Math.floor(rnd() * palette.length)];
      const run = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < run && s + w < len; k++) {
        const along = s + w / 2;
        products.push({ x: axis === 'x' ? x0 + along : x0, y: y + h / 2, z: axis === 'z' ? z0 + along : z0, w, h, d, ry, c });
        s += w + 0.008;
      }
      s += 0.01;
    }
  };
  // Gondola island behind the crate corner: shelves on both long sides.
  const gx = SEATING.cx - 0.1;
  const gz0 = -2.75;
  const gLen = 1.9;
  M.box(shelfBack, 0.06, 1.35, gLen, gx, 0.675, gz0 + gLen / 2);
  M.box(steel, 0.8, 0.12, gLen, gx, 0.06, gz0 + gLen / 2);
  M.box(teal, 0.82, 0.16, 0.04, gx, 1.48, gz0 - 0.01);
  M.box(teal, 0.82, 0.16, 0.04, gx, 1.48, gz0 + gLen + 0.01);
  for (const side of [-1, 1]) {
    for (let s = 0; s < 4; s++) {
      const y = 0.12 + s * 0.33;
      M.box(shelfMat, 0.36, 0.02, gLen, gx + side * 0.21, y, gz0 + gLen / 2);
      fill(gx + side * 0.21, gz0, gLen, 'z', y + 0.01, 0.3, side * (Math.PI / 2), 0.28);
    }
  }
  // Back wall shelving.
  const bx0 = -2.3;
  const bLen = 3.6;
  const bz = ROOM.back + 0.2;
  M.box(shelfBack, bLen, 1.9, 0.04, bx0 + bLen / 2, 0.95, ROOM.back + 0.02);
  for (let s = 0; s < 5; s++) {
    const y = 0.12 + s * 0.38;
    M.box(shelfMat, bLen, 0.02, 0.36, bx0 + bLen / 2, y, bz);
    fill(bx0, bz, bLen, 'x', y + 0.01, 0.3, 0, 0.32);
  }
  // Candy stand on the counter.
  for (let s = 0; s < 3; s++) {
    const y = COUNTER.height + 0.04 + s * 0.12;
    M.box(shelfMat, 0.22 - s * 0.05, 0.015, 0.5, COUNTER.x + 0.15 + s * 0.04, y, 0.85);
    fill(COUNTER.x + 0.15 + s * 0.04, 0.6, 0.5, 'z', y + 0.008, 0.1, -Math.PI / 2, 0.09);
  }
  const prodMat = std(0xffffff, { map: T.productTex(), roughness: 0.55, metalness: 0.05 });
  const inst = tag(new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), prodMat, products.length), 'prop');
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  products.forEach((p, i) => {
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.ry);
    m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.w, p.h, p.d));
    inst.setMatrixAt(i, m4);
    inst.setColorAt(i, col.setHex(p.c));
  });
  shop.add(inst);

  // --- Counter -------------------------------------------------------------------------------
  const C = COUNTER;
  const cLen = C.z1 - C.z0;
  const czMid = (C.z0 + C.z1) / 2;
  const body = std(0x24272d, { roughness: 0.55, metalness: 0.2 });
  const top = std(0xaab0b6, { roughness: 0.3, metalness: 0.25 });
  M.box(body, C.depth, C.height - 0.04, cLen, C.x + C.depth / 2, (C.height - 0.04) / 2, czMid);
  M.box(top, C.depth + 0.06, 0.04, cLen + 0.06, C.x + C.depth / 2 - 0.03, C.height - 0.02, czMid);
  M.box(teal, 0.02, 0.5, cLen, C.x - 0.005, 0.55, czMid);
  M.box(pink, 0.022, 0.05, cLen, C.x - 0.006, 0.27, czMid);
  // Till, card terminal, coin tray.
  const dark = std(0x15171b, { roughness: 0.4, metalness: 0.3 });
  M.box(dark, 0.32, 0.1, 0.36, C.x + 0.36, C.height + 0.05, C.ownerZ + 0.35);
  M.box(dark, 0.06, 0.18, 0.26, C.x + 0.44, C.height + 0.19, C.ownerZ + 0.35);
  const till = glow(ACCENT.teal, 0.5);
  M.add(till, plane(0.22, 0.12, 'x-'), C.x + 0.405, C.height + 0.21, C.ownerZ + 0.35, 0, 0, 0, 'light');
  M.box(dark, 0.08, 0.04, 0.14, C.x + 0.1, C.height + 0.02, C.ownerZ - 0.35);
  M.box(chrome, 0.16, 0.02, 0.22, C.x + 0.25, C.height + 0.01, C.ownerZ - 0.3);
  // Owner's phone, propped up facing him (+x side): football at 3 a.m.
  const phone = glow(0xffffff, 0.6, { map: T.pitchTex() });
  M.box(dark, 0.012, 0.075, 0.15, C.x + 0.3, C.height + 0.045, C.ownerZ - 0.55, 0.0);
  M.add(phone, plane(0.14, 0.065, 'x+'), C.x + 0.307, C.height + 0.045, C.ownerZ - 0.55, 0, 0, 0, 'light');
  // Wall behind the owner: tobacco and scratch cards, price board, the shop sign.
  const rack = glow(0xffffff, 0.2, { map: T.rackTex() });
  M.add(rack, plane(1.7, 1.25, 'x-'), ROOM.right - 0.02, 1.62, -1.0, 0, 0, 0, 'prop');
  M.box(steel, 0.06, 1.33, 1.78, ROOM.right - 0.04, 1.62, -1.0);
  const price = glow(0xffffff, 0.22, { map: T.priceTex() });
  M.add(price, plane(0.9, 0.45, 'x-'), ROOM.right - 0.02, 1.75, 0.55, 0, 0, 0, 'prop');
  const sign = glow(0xffffff, L.signGlow, { map: T.signTex('SPÄTI', 'RUND UM DIE UHR · 24/7', '#ff3d8b', '#fff6fa', 512, 160) });
  M.add(sign, plane(1.3, 0.4, 'x-'), ROOM.right - 0.05, 2.45, -1.0, 0, 0, 0, 'light');
  M.box(dark, 0.08, 0.44, 1.34, ROOM.right - 0.09, 2.45, -1.0);

  // --- Slush machine (counter, back end) ----------------------------------------------------
  const slushZ = [C.z0 + 0.3, C.z0 + 0.66];
  const sx = C.x + 0.3;
  M.box(chrome, 0.42, 0.3, 0.8, sx, C.height + 0.15, (slushZ[0] + slushZ[1]) / 2);
  M.box(dark, 0.02, 0.12, 0.7, sx - 0.21, C.height + 0.12, (slushZ[0] + slushZ[1]) / 2);
  const glassMat = std(0xd8f0ff, { roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.25, depthWrite: false });
  const lid = std(0xf2f2f2, { roughness: 0.35, metalness: 0.1 });
  const slushTexA = T.slushTex('#1a6dff', '#7fb8ff');
  const slushTexB = T.slushTex('#ff2a5a', '#ff9ab0');
  const slush = [slushTexA, slushTexB];
  const slushMats = slush.map((tx) => glow(0xffffff, 0.75, { map: tx }));
  slushZ.forEach((z, i) => {
    const inner = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.125, 0.34, 20, 1, true), slushMats[i]), 'light');
    shop.add(at(inner, sx + 0.02, C.height + 0.49, z));
    M.add(glassMat, new THREE.CylinderGeometry(0.155, 0.145, 0.44, 20), sx + 0.02, C.height + 0.52, z, 0, 0, 0, 'fx');
    M.add(lid, new THREE.CylinderGeometry(0.16, 0.16, 0.06, 20), sx + 0.02, C.height + 0.77, z);
    M.box(dark, 0.06, 0.08, 0.05, sx - 0.17, C.height + 0.3, z);
  });
  const slushSign = glow(0xffffff, L.signGlow, { map: T.signTex('SLUSH', '', '#1a6dff', '#ffffff', 256, 80) });
  M.add(slushSign, plane(0.5, 0.15, 'x-'), sx - 0.13, C.height + 0.88, (slushZ[0] + slushZ[1]) / 2, 0, 0, 0, 'light');
  M.box(dark, 0.06, 0.17, 0.52, sx - 0.09, C.height + 0.88, (slushZ[0] + slushZ[1]) / 2);

  // --- Hot-dog roller (counter, middle) ------------------------------------------------------
  // Between till and candy stand, where every seat can see it past the heads.
  const hz = 0.0;
  const hx = C.x + 0.25;
  M.box(chrome, 0.42, 0.1, 0.4, hx, C.height + 0.05, hz);
  const roller = new THREE.CylinderGeometry(0.014, 0.014, 0.34, 10).rotateX(Math.PI / 2);
  const rollerX: number[] = [];
  for (let i = 0; i < 8; i++) {
    const x = hx - 0.17 + i * 0.048;
    rollerX.push(x);
    M.add(chrome, roller, x, C.height + 0.115, hz);
  }
  // Sneeze guard and heat lamp hood.
  M.add(glassMat, new THREE.BoxGeometry(0.01, 0.22, 0.4), hx - 0.22, C.height + 0.2, hz, 0, 0, -0.3, 'fx');
  M.box(chrome, 0.44, 0.03, 0.42, hx, C.height + 0.38, hz);
  M.box(chrome, 0.02, 0.27, 0.02, hx + 0.2, C.height + 0.24, hz - 0.19);
  M.box(chrome, 0.02, 0.27, 0.02, hx + 0.2, C.height + 0.24, hz + 0.19);
  const heatLamp = glow(0xff8a2a, 1.7);
  M.box(heatLamp, 0.36, 0.01, 0.32, hx, C.height + 0.36, hz, 0, 'light');
  const sausGeo = new THREE.CapsuleGeometry(0.017, 0.15, 4, 10).rotateX(Math.PI / 2);
  const sausMat = std(0xffffff, { map: T.sausageTex(), roughness: 0.35, metalness: 0.05, emissive: 0x401406 });
  const sausX = rollerX.slice(0, 7).map((x) => x + 0.024);
  const sausages = tag(new THREE.InstancedMesh(sausGeo, sausMat, sausX.length - 1), 'prop');
  const sausageBase: THREE.Matrix4[] = [];
  sausX.slice(1).forEach((x, i) => {
    const m = new THREE.Matrix4().makeTranslation(x, C.height + 0.135, hz);
    sausageBase.push(m);
    sausages.setMatrixAt(i, m);
  });
  shop.add(sausages);

  // --- Crate corner (players) --------------------------------------------------------------
  const S = SEATING;
  const crateMap = T.crateTex();
  const crateCols = [0x1f5a2f, 0x8a1f1f, 0x1f3a7a, 0x2a2a2a];
  const crateMats = crateCols.map((c) => std(c, { map: crateMap, roughness: 0.6, metalness: 0.05 }));
  const card = std(0xa8865a, { roughness: 0.95, metalness: 0 });
  const crate = (x: number, z: number, y: number, ry: number, ci: number) => M.add(crateMats[ci % crateMats.length], new THREE.BoxGeometry(0.4, S.crateH, 0.3), x, y + S.crateH / 2, z, ry);
  let ci = 0;
  for (const sx2 of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = S.cx + sx2 * S.halfX;
      const z = S.cz + sz * S.halfZ;
      crate(x - sx2 * 0.03, z, 0, Math.PI / 2, ci++);
      crate(x - sx2 * 0.03, z, S.crateH, Math.PI / 2 + 0.06 * sx2 * sz, ci++);
      // Flattened box as a cushion: that's the 2.5 cm to the seat height.
      M.box(card, 0.36, S.seatY - 2 * S.crateH, 0.42, x - sx2 * 0.03, 2 * S.crateH + (S.seatY - 2 * S.crateH) / 2, z, 0.04 * sx2);
    }
  // Table: three crate stacks in a row (grown with the seat spacing), a board on top, a candle-less
  // ashtray-free pizza box of snacks.
  const tableCrates = [-0.3, 0, 0.3];
  tableCrates.forEach((dz, i) => {
    crate(S.cx, S.cz + dz, 0, 0, 1 + i);
    crate(S.cx, S.cz + dz, S.crateH, 0, (i * 3) % 4);
  });
  const board = std(0x8a6a44, { roughness: 0.8, metalness: 0 });
  M.box(board, 0.55, 0.03, 1.15, S.cx, 2 * S.crateH + 0.015, S.cz);
  M.box(std(0xd8cbb0, { roughness: 0.9 }), 0.3, 0.04, 0.3, S.cx + 0.02, 2 * S.crateH + 0.05, S.cz + 0.25, 0.3);
  // A few bottles on the table: the night has been going for a while.
  const bottle = std(0x4a2a10, { roughness: 0.15, metalness: 0.2 });
  const green = std(0x1f6a2a, { roughness: 0.15, metalness: 0.2 });
  for (const [dx, dz, g] of [[-0.12, -0.38, 0], [0.1, -0.26, 1], [0.05, 0.47, 0], [-0.13, 0.05, 1], [0.12, -0.02, 0]] as const) {
    const m = g ? green : bottle;
    M.add(m, new THREE.CylinderGeometry(0.032, 0.032, 0.18, 10), S.cx + dx, 2 * S.crateH + 0.12, S.cz + dz);
    M.add(m, new THREE.CylinderGeometry(0.012, 0.03, 0.09, 10), S.cx + dx, 2 * S.crateH + 0.255, S.cz + dz);
  }
  // Door wedge crate and a crate of empties by the counter.
  crate(ROOM.doorX1 - 0.25, ROOM.front - 0.8, 0, 0.3, 0);
  crate(COUNTER.x - 0.28, COUNTER.z0 + 0.25, 0, 0.1, 1);

  // --- Front: window, door, stickers, neon ------------------------------------------------
  const alu = std(0x3a3e44, { roughness: 0.4, metalness: 0.7 });
  const winW = ROOM.doorX0 - ROOM.left;
  const winH = ROOM.windowTop - ROOM.windowSill;
  const wz = ROOM.front;
  for (const x of [ROOM.left + 0.03, -1.4, 0.15, ROOM.doorX0, ROOM.doorX1]) M.box(alu, 0.06, ROOM.windowTop, 0.08, x, ROOM.windowTop / 2, wz);
  M.box(alu, W, 0.06, 0.08, 0, ROOM.windowTop, wz);
  M.box(alu, winW, 0.06, 0.08, (ROOM.left + ROOM.doorX0) / 2, ROOM.windowSill, wz);
  M.add(glassMat, plane(winW, winH, 'z+'), (ROOM.left + ROOM.doorX0) / 2, ROOM.windowSill + winH / 2, wz, 0, 0, 0, 'fx');
  // Door, open inwards against the pillar.
  const dw = ROOM.doorX1 - ROOM.doorX0 - 0.06;
  const dzc = wz - dw / 2;
  const dxc = ROOM.doorX1 - 0.08;
  M.box(alu, 0.05, 2.25, 0.06, dxc, 1.125, wz - dw + 0.03);
  M.box(alu, 0.05, 0.08, dw, dxc, 2.21, dzc);
  M.box(alu, 0.05, 0.14, dw, dxc, 0.07, dzc);
  M.add(glassMat, plane(dw, 2.1, 'x-'), dxc, 1.12, dzc, 0, 0, 0, 'fx');
  M.box(chrome, 0.04, 0.03, 0.4, dxc - 0.05, 1.05, wz - dw + 0.1);
  // Lit, not glowing: they go dark with the shop in a blackout.
  const stickers = std(0xffffff, { map: T.stickerTex(), transparent: true, depthWrite: false, roughness: 0.6, metalness: 0 });
  M.add(stickers, plane(winW - 0.1, (winW - 0.1) / 4, 'z-'), (ROOM.left + ROOM.doorX0) / 2, ROOM.windowTop - (winW - 0.1) / 8 - 0.05, wz - 0.015, 0, 0, 0, 'prop');
  const neon = glow(ACCENT.pink, L.neonHdr, { map: T.neonTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  M.add(neon, plane(0.8, 0.25, 'z-'), -0.65, 1.0, wz - 0.06, 0, 0, 0, 'light');
  M.box(dark, 0.004, 0.4, 0.004, -0.95, 1.33, wz - 0.06);
  M.box(dark, 0.004, 0.4, 0.004, -0.35, 1.33, wz - 0.06);
  const exit = glow(0xffffff, L.exitHdr, { map: T.exitTex() });
  M.box(dark, 0.4, 0.16, 0.05, (ROOM.doorX0 + ROOM.doorX1) / 2, ROOM.windowTop + 0.16, wz - 0.03);
  M.add(exit, plane(0.36, 0.135, 'z-'), (ROOM.doorX0 + ROOM.doorX1) / 2, ROOM.windowTop + 0.16, wz - 0.06, 0, 0, 0, 'light');

  // --- Street ----------------------------------------------------------------------------------
  const St = STREET;
  const pave = std(0x55565a, { roughness: 0.75, metalness: 0.05 });
  M.add(pave, plane(60, St.curbZ - ROOM.front, 'y+'), 0, -0.01, (ROOM.front + St.curbZ) / 2, 0, 0, 0, 'outside');
  M.add(pave, plane(60, St.facadeZ - St.roadZ1, 'y+'), 0, 0.1, (St.roadZ1 + St.facadeZ) / 2, 0, 0, 0, 'outside');
  const curb = std(0x8a8a86, { roughness: 0.7 });
  M.box(curb, 60, 0.12, 0.18, 0, 0.0, St.curbZ, 0, 'outside');
  M.box(curb, 60, 0.12, 0.18, 0, 0.0, St.roadZ1, 0, 'outside');
  const roadMap = T.roadTex();
  roadMap.repeat.set(60 / 4, 1);
  const road = std(0xffffff, { map: roadMap, roughness: 0.35, metalness: 0.25 });
  M.add(road, plane(60, St.roadZ1 - St.curbZ, 'y+'), 0, -0.05, (St.curbZ + St.roadZ1) / 2, 0, 0, 0, 'outside');
  const facadeMap = T.facadeTex();
  facadeMap.repeat.set(60 / 16, 1);
  const facade = glow(0xffffff, 0.3, { map: facadeMap });
  M.add(facade, plane(60, 8, 'z-'), 0, 4, St.facadeZ, 0, 0, 0, 'outside');
  // One window across the street where somebody's TV is still on.
  const tv = glow(0x6a8ad8, 0.5);
  M.add(tv, plane(0.9, 0.9, 'z-'), 3.3, 4.2, St.facadeZ - 0.02, 0, 0, 0, 'outside');
  // Street lamp.
  const pole = std(0x2a2c30, { roughness: 0.5, metalness: 0.6 });
  M.add(pole, new THREE.CylinderGeometry(0.06, 0.08, St.lampY, 10), St.lampX, St.lampY / 2, St.lampZ, 0, 0, 0, 'outside');
  M.box(pole, 0.08, 0.08, 1.2, St.lampX, St.lampY, St.lampZ + 0.6, 0, 'outside');
  M.box(pole, 0.36, 0.12, 0.6, St.lampX, St.lampY - 0.04, St.lampZ + 1.2, 0, 'outside');
  const lampHead = glow(0xffb060, 3.2);
  M.box(lampHead, 0.3, 0.02, 0.52, St.lampX, St.lampY - 0.11, St.lampZ + 1.2, 0, 'outside');
  // Pool of lamp light on the pavement (cheaper than a shadowed spot light).
  const poolTex = canvasTex(128, 128, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,170,90,0.55)');
    g.addColorStop(1, 'rgba(255,170,90,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
  const lampPool = glow(0xffffff, 0.6, { map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  M.add(lampPool, plane(6, 6, 'y+'), St.lampX, 0.02, St.lampZ + 1.2, 0, 0, 0, 'fx');
  // Crates outside where the regular sits, and a bin.
  crate(0.9, 3.55, 0, Math.PI / 2, 2);
  crate(0.9, 3.55, S.crateH, Math.PI / 2, 3);
  M.box(card, 0.36, S.seatY - 2 * S.crateH, 0.42, 0.9, 2 * S.crateH + 0.0125, 3.55);
  M.add(std(0x3a4a3a, { roughness: 0.6 }), new THREE.CylinderGeometry(0.22, 0.2, 0.75, 14), 3.6, 0.375, 5.4, 0, 0, 0, 'outside');

  M.build(shop);
  return {
    tubes,
    badTube,
    fridgePanel,
    fridgeLed,
    signs: [header, sign, slushSign, rack, price],
    slush,
    slushMats,
    sausages,
    sausageBase,
    heatLamp,
    neon,
    exit,
    phone,
    lampHead,
    lampPool,
    facade,
    tv,
    till,
  };
}

/** Scale a glow material from its built colour (0 = off). */
export function dim(m: THREE.MeshBasicMaterial, k: number): void {
  m.color.copy(m.userData.base as THREE.Color).multiplyScalar(k);
}
