import * as THREE from 'three';
import { Batch, vcMat } from './batch';
import { COL, ROOM, SEAT, TABLE } from './config';
import { ATLAS, atlasUV, type Rect, type WgTextures } from './textures';

// The static room: walls, stucco, furniture and clutter. All of it lands in the shared batch and
// is merged into one mesh per material.

export const BOX = new THREE.BoxGeometry(1, 1, 1);
export const CYL = new THREE.CylinderGeometry(1, 1, 1, 14);
export const SPH = new THREE.SphereGeometry(1, 16, 12);
const PLANE = new THREE.PlaneGeometry(1, 1);

export interface RoomMats {
  matte: THREE.MeshStandardMaterial;
  satin: THREE.MeshStandardMaterial;
  shiny: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  tiles: THREE.MeshStandardMaterial;
  atlas: THREE.MeshStandardMaterial;
}

export function roomMats(tex: WgTextures): RoomMats {
  return {
    matte: vcMat({ roughness: 0.9 }),
    satin: vcMat({ roughness: 0.5, metalness: 0.05 }),
    shiny: vcMat({ roughness: 0.16, metalness: 0.15 }),
    floor: vcMat({ map: tex.floor, roughness: 0.55 }),
    wall: vcMat({ map: tex.wall, roughness: 0.95 }),
    tiles: vcMat({ map: tex.tiles, roughness: 0.2, metalness: 0.05 }),
    atlas: vcMat({ map: tex.atlas, roughness: 0.75 }),
  };
}

/** Plane with its uv scaled so the texture tiles every `tile` metres, whatever the plane's size. */
function tiledPlane(w: number, h: number, tile: readonly [number, number]): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile[0], (uv.getY(i) * h) / tile[1]);
  return g;
}

function atlasPlane(r: Rect): THREE.BufferGeometry {
  return atlasUV(new THREE.PlaneGeometry(1, 1), r);
}

export function buildRoom(b: Batch, M: RoomMats): void {
  /** Axis-aligned box from min to max corner. */
  const bx = (mat: THREE.Material, color: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
    b.add(BOX, mat, color, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [0, 0, 0], [x1 - x0, y1 - y0, z1 - z0]);
  const WALL_TILE = [1.2, 1.2] as const;
  const wall = (w: number, h: number, pos: [number, number, number], ry: number, color: number = COL.wallpaper) =>
    b.add(tiledPlane(w, h, WALL_TILE), M.wall, color, pos, [0, ry, 0]);
  const { minX, maxX, minZ, maxZ, height: H } = ROOM;
  const W = maxX - minX;
  const D = maxZ - minZ;
  const cx = (minX + maxX) / 2;

  // Floor and ceiling.
  b.add(tiledPlane(W, D, [1.28, 2.5]), M.floor, 0xffffff, [cx, 0, 0], [-Math.PI / 2, 0, 0]);
  b.add(tiledPlane(W, D, WALL_TILE), M.wall, COL.ceiling, [cx, H, 0], [Math.PI / 2, 0, 0]);

  // Walls. Left and front are solid; the back has the window, the right the hallway door.
  wall(D, H, [minX, H / 2, 0], Math.PI / 2);
  wall(W, H, [cx, H / 2, maxZ], Math.PI);
  const { winX, winW, winY0, winY1 } = ROOM;
  const wl = winX - winW / 2;
  const wr = winX + winW / 2;
  wall(wl - minX, H, [(minX + wl) / 2, H / 2, minZ], 0);
  wall(maxX - wr, H, [(maxX + wr) / 2, H / 2, minZ], 0);
  wall(winW, winY0, [winX, winY0 / 2, minZ], 0);
  wall(winW, H - winY1, [winX, (H + winY1) / 2, minZ], 0);
  // Deep Altbau window niche.
  const nd = 0.34;
  wall(nd, winY1 - winY0, [wl, (winY0 + winY1) / 2, minZ - nd / 2], Math.PI / 2);
  wall(nd, winY1 - winY0, [wr, (winY0 + winY1) / 2, minZ - nd / 2], -Math.PI / 2);
  b.add(tiledPlane(winW, nd, WALL_TILE), M.wall, COL.wallpaper, [winX, winY1, minZ - nd / 2], [Math.PI / 2, 0, 0]);
  const [dz0, dz1] = ROOM.doorZ;
  const dh = ROOM.doorH;
  wall(dz0 - minZ, H, [maxX, H / 2, (minZ + dz0) / 2], -Math.PI / 2);
  wall(maxZ - dz1, H, [maxX, H / 2, (maxZ + dz1) / 2], -Math.PI / 2);
  wall(dz1 - dz0, H - dh, [maxX, (H + dh) / 2, (dz0 + dz1) / 2], -Math.PI / 2);

  buildStucco(b, M, bx);
  buildWindow(b, M, bx);
  buildDoorAndHallway(b, M, bx, wall);
  buildSeating(b, M, bx);
  buildTable(b, M, bx);
  buildBack(b, M, bx);
  buildWallDecor(b, M);
}

type BX = (mat: THREE.Material, color: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void;

function buildStucco(b: Batch, M: RoomMats, bx: BX): void {
  const { minX, maxX, minZ, maxZ, height: H } = ROOM;
  // Stepped cornice along all four walls, high skirting below.
  const steps = [
    [0.07, 0.2],
    [0.06, 0.13],
    [0.05, 0.07],
  ] as const;
  let y = H;
  for (const [h, d] of steps) {
    bx(M.matte, COL.stucco, minX, y - h, minZ, minX + d, y, maxZ);
    bx(M.matte, COL.stucco, maxX - d, y - h, minZ, maxX, y, maxZ);
    bx(M.matte, COL.stucco, minX, y - h, minZ, maxX, y, minZ + d);
    bx(M.matte, COL.stucco, minX, y - h, maxZ - d, maxX, y, maxZ);
    y -= h;
  }
  // Inset moulding frame on the ceiling.
  const i = 0.45;
  const t = 0.05;
  for (const [x0, z0, x1, z1] of [
    [minX + i, minZ + i, maxX - i, minZ + i + t],
    [minX + i, maxZ - i - t, maxX - i, maxZ - i],
    [minX + i, minZ + i, minX + i + t, maxZ - i],
    [maxX - i - t, minZ + i, maxX - i, maxZ - i],
  ])
    bx(M.matte, COL.stucco, x0, H - 0.03, z0, x1, H, z1);
  // Rosette above the lamp.
  b.add(CYL, M.matte, COL.stucco, [0, H - 0.015, 0], [0, 0, 0], [0.34, 0.03, 0.34]);
  b.add(new THREE.TorusGeometry(0.26, 0.025, 6, 28), M.matte, COL.stucco, [0, H - 0.03, 0], [Math.PI / 2, 0, 0]);
  b.add(CYL, M.matte, COL.stucco, [0, H - 0.05, 0], [0, 0, 0], [0.14, 0.04, 0.14]);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.add(SPH, M.matte, COL.stucco, [Math.cos(a) * 0.2, H - 0.02, Math.sin(a) * 0.2], [0, a, 0], [0.06, 0.02, 0.03]);
  }
  // Skirting (Altbau: tall, painted).
  const sk = 0.17;
  bx(M.satin, COL.skirting, minX, 0, minZ, minX + 0.025, sk, maxZ);
  bx(M.satin, COL.skirting, minX, 0, maxZ - 0.025, maxX, sk, maxZ);
  bx(M.satin, COL.skirting, minX, 0, minZ, maxX, sk, minZ + 0.025);
  bx(M.satin, COL.skirting, maxX - 0.025, 0, minZ, maxX, sk, ROOM.doorZ[0]);
  bx(M.satin, COL.skirting, maxX - 0.025, 0, ROOM.doorZ[1], maxX, sk, maxZ);
}

function buildWindow(b: Batch, M: RoomMats, bx: BX): void {
  const { winX, winW, winY0, winY1, minZ } = ROOM;
  const wl = winX - winW / 2;
  const wr = winX + winW / 2;
  const fz = minZ - 0.3;
  const f = 0.06;
  // Sill board sticking out into the room (the cat walks on it), radiator below.
  bx(M.satin, COL.frame, wl - 0.06, winY0 - 0.03, fz, wr + 0.06, winY0, minZ + 0.08);
  bx(M.satin, COL.frame, wl, winY0, fz - 0.02, wr, winY0 + 0.02, fz + 0.02);
  // Frame, Kreuzstock (mullion + transom), sash bars.
  bx(M.satin, COL.frame, wl, winY0, fz - 0.03, wl + f, winY1, fz + 0.03);
  bx(M.satin, COL.frame, wr - f, winY0, fz - 0.03, wr, winY1, fz + 0.03);
  bx(M.satin, COL.frame, wl, winY1 - f, fz - 0.03, wr, winY1, fz + 0.03);
  bx(M.satin, COL.frame, winX - 0.04, winY0, fz - 0.03, winX + 0.04, winY1, fz + 0.03);
  const tr = winY1 - 0.62;
  bx(M.satin, COL.frame, wl, tr - 0.04, fz - 0.03, wr, tr + 0.04, fz + 0.03);
  for (const x of [wl + f, winX + 0.04]) {
    const w = winX - 0.04 - (wl + f);
    bx(M.satin, COL.frame, x, (winY0 + tr) / 2 - 0.015, fz, x + w, (winY0 + tr) / 2 + 0.015, fz + 0.02);
  }
  // Handles.
  for (const s of [-1, 1]) bx(M.shiny, COL.metal, winX + s * 0.07 - 0.01, 1.55, fz + 0.03, winX + s * 0.07 + 0.01, 1.68, fz + 0.06);
  // Rippled radiator under the sill.
  for (let k = 0; k < 14; k++) {
    const x = wl + 0.12 + k * 0.069;
    bx(M.satin, COL.radiator, x, 0.14, minZ + 0.02, x + 0.045, 0.72, minZ + 0.12);
  }
  bx(M.satin, COL.radiator, wl + 0.12, 0.1, minZ + 0.06, wl + 0.12 + 14 * 0.069, 0.14, minZ + 0.08);
  b.add(CYL, M.shiny, COL.metal, [wl + 0.08, 0.6, minZ + 0.07], [0, 0, 0], [0.025, 0.06, 0.025]);
  // A small plant on the sill, at the end the cat never walks to.
  b.add(CYL, M.matte, COL.pot, [wr - 0.1, winY0 + 0.06, minZ - 0.1], [0, 0, 0], [0.06, 0.12, 0.06]);
  for (let k = 0; k < 9; k++) {
    const a = k * 2.4;
    b.add(SPH, M.matte, k % 2 ? 0x3d7a3a : 0x5a9a48, [wr - 0.1 + Math.cos(a) * 0.06, winY0 + 0.16 + (k % 3) * 0.03, minZ - 0.1 + Math.sin(a) * 0.06], [0.4, a, 0.9], [0.015, 0.11, 0.008]);
  }
}

type WallFn = (w: number, h: number, pos: [number, number, number], ry: number, color?: number) => void;

function buildDoorAndHallway(b: Batch, M: RoomMats, bx: BX, wall: WallFn): void {
  const { maxX } = ROOM;
  const [z0, z1] = ROOM.doorZ;
  const dh = ROOM.doorH;
  const t = 0.18;
  const hx = maxX + t;
  // Reveal of the door opening, casing on the room side.
  wall(t, dh, [maxX + t / 2, dh / 2, z0], 0);
  wall(t, dh, [maxX + t / 2, dh / 2, z1], Math.PI);
  b.add(tiledPlane(t, z1 - z0, [1.2, 1.2]), M.wall, COL.wallpaper, [maxX + t / 2, dh, (z0 + z1) / 2], [Math.PI / 2, 0, 0]);
  bx(M.satin, COL.frame, maxX - 0.03, 0, z0 - 0.1, maxX + 0.005, dh + 0.1, z0);
  bx(M.satin, COL.frame, maxX - 0.03, 0, z1, maxX + 0.005, dh + 0.1, z1 + 0.1);
  bx(M.satin, COL.frame, maxX - 0.03, dh, z0 - 0.1, maxX + 0.005, dh + 0.12, z1 + 0.1);
  bx(M.satin, COL.frame, maxX - 0.04, dh + 0.12, z0 - 0.14, maxX + 0.005, dh + 0.16, z1 + 0.14);

  // Hallway: narrow, long, darker; the door leaf stands open against its wall.
  const hw = 1.25;
  const hz0 = -4.6;
  const hz1 = 0.2;
  const hc = 0x8a8070;
  b.add(tiledPlane(hw, hz1 - hz0, [1.28, 2.5]), M.floor, 0xb0a090, [hx + hw / 2, 0, (hz0 + hz1) / 2], [-Math.PI / 2, 0, 0]);
  b.add(tiledPlane(hw, hz1 - hz0, [1.2, 1.2]), M.wall, COL.ceiling, [hx + hw / 2, ROOM.height, (hz0 + hz1) / 2], [Math.PI / 2, 0, 0]);
  wall(hz1 - hz0, ROOM.height, [hx + hw, ROOM.height / 2, (hz0 + hz1) / 2], -Math.PI / 2, hc);
  wall(hw, ROOM.height, [hx + hw / 2, ROOM.height / 2, hz0], 0, hc);
  wall(hw, ROOM.height, [hx + hw / 2, ROOM.height / 2, hz1], Math.PI, hc);
  // Back of the room wall, seen from the hallway side.
  wall(z0 - hz0, ROOM.height, [hx, ROOM.height / 2, (hz0 + z0) / 2], Math.PI / 2, hc);
  wall(hz1 - z1, ROOM.height, [hx, ROOM.height / 2, (hz1 + z1) / 2], Math.PI / 2, hc);
  bx(M.satin, COL.frame, hx + hw - 0.05, 0, z1 + 0.02, hx + hw - 0.01, dh, z1 + 0.88);
  bx(M.satin, 0xd8d2c4, hx + hw - 0.06, 0.25, z1 + 0.12, hx + hw - 0.05, 1.0, z1 + 0.78);
  bx(M.satin, 0xd8d2c4, hx + hw - 0.06, 1.2, z1 + 0.12, hx + hw - 0.05, 2.15, z1 + 0.78);
  // Coats on hooks and a pile of shoes.
  bx(M.satin, COL.teak, hx + hw - 0.04, 1.75, -3.9, hx + hw, 1.8, -2.9);
  for (const [z, c] of [
    [-3.75, 0x3a3f52],
    [-3.45, 0x6b2a2a],
    [-3.1, 0x2f4a35],
  ] as const)
    b.add(BOX, M.matte, c, [hx + hw - 0.13, 1.35, z], [0, 0, 0.05], [0.16, 0.85, 0.32]);
  for (let k = 0; k < 6; k++) b.add(BOX, M.matte, [0x1a1a1a, 0xe0e0e0, 0x8a3a2a][k % 3], [hx + 0.25 + (k % 3) * 0.2, 0.05, -1.0 + Math.floor(k / 3) * 0.25], [0, k * 0.9, 0], [0.11, 0.09, 0.27]);

  buildBike(b, M, hx + 0.35, -3.0);
}

/** A city bike leaning against the hallway wall, frame along z. */
function buildBike(b: Batch, M: RoomMats, x: number, z: number): void {
  const lean = 0.16;
  const r = 0.33;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.z = lean;
  g.updateMatrixWorld();
  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, color: number, p: THREE.Vector3, q: THREE.Quaternion, s: THREE.Vector3) => {
    const m = new THREE.Matrix4().compose(p, q, s).premultiply(g.matrixWorld);
    b.addMatrix(geo, mat, color, m);
  };
  const wheel = new THREE.TorusGeometry(r, 0.022, 6, 32);
  const rim = new THREE.TorusGeometry(r - 0.03, 0.006, 4, 32);
  const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const one = new THREE.Vector3(1, 1, 1);
  const rear = new THREE.Vector3(0, r + 0.02, -0.52);
  const front = new THREE.Vector3(0, r + 0.02, 0.52);
  for (const c of [rear, front]) {
    part(wheel, M.matte, COL.black, c, qY, one);
    part(rim, M.shiny, COL.metal, c, qY, one);
  }
  const tube = (a: THREE.Vector3, bb: THREE.Vector3, rad: number, color: number) => {
    const d = bb.clone().sub(a);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    part(CYL, M.shiny, color, a.clone().add(bb).multiplyScalar(0.5), q, new THREE.Vector3(rad, d.length(), rad));
  };
  const bb = new THREE.Vector3(0, 0.3, -0.05);
  const seat = new THREE.Vector3(0, 0.82, -0.2);
  const head = new THREE.Vector3(0, 0.85, 0.36);
  const teal = 0x2a8a8a;
  tube(bb, seat, 0.018, teal);
  tube(bb, head, 0.02, teal);
  tube(seat.clone().add(new THREE.Vector3(0, -0.06, 0)), head.clone().add(new THREE.Vector3(0, -0.05, 0)), 0.016, teal);
  tube(bb, rear, 0.012, teal);
  tube(seat, rear, 0.012, teal);
  tube(head, front, 0.016, COL.metal);
  tube(head, head.clone().add(new THREE.Vector3(0, 0.12, -0.05)), 0.014, COL.metal);
  tube(new THREE.Vector3(-0.25, 0.97, 0.32), new THREE.Vector3(0.25, 0.97, 0.32), 0.012, COL.metal);
  part(BOX, M.matte, COL.black, seat.clone().add(new THREE.Vector3(0, 0.05, 0)), new THREE.Quaternion(), new THREE.Vector3(0.12, 0.05, 0.25));
  // Basket on the front, a lock on the frame.
  part(BOX, M.matte, 0x6a4a2a, front.clone().add(new THREE.Vector3(0, 0.5, 0.08)), new THREE.Quaternion(), new THREE.Vector3(0.3, 0.2, 0.25));
}

function buildSeating(b: Batch, M: RoomMats, bx: BX): void {
  const x = SEAT.x;
  const sy = SEAT.sofaY;
  // Sofa against the left wall: corduroy in rust, the seat cushions sagging where people sit.
  const sx0 = ROOM.minX + 0.02;
  // Half-length: both seat cushions (0.92 wide, SEAT.z off-centre) fit between the armrests.
  const sz = 1.18;
  bx(M.matte, COL.sofaDark, sx0, 0.1, -sz, -x + 0.24, 0.3, sz);
  for (const s of [-1, 1]) {
    bx(M.matte, COL.sofa, sx0, 0.1, s > 0 ? sz - 0.17 : -sz, -x + 0.26, 0.66, s > 0 ? sz : -sz + 0.17);
    b.add(CYL, M.matte, COL.sofa, [(sx0 - x + 0.26) / 2, 0.66, s * (sz - 0.085)], [0, 0, Math.PI / 2], [0.085, -x + 0.26 - sx0, 0.085]);
    // Seat cushion, sagging in the middle.
    b.add(BOX, M.matte, COL.sofa, [-x + 0.02, sy - 0.08, s * SEAT.z], [0, 0, 0], [0.5, 0.15, 0.92]);
    b.add(SPH, M.matte, COL.sofa, [-x + 0.02, sy - 0.02, s * SEAT.z], [0, 0, 0], [0.25, 0.04, 0.44]);
    // Back cushion, leaning.
    b.add(BOX, M.matte, COL.sofa, [-x - 0.31, 0.72, s * SEAT.z], [0, 0, -0.14], [0.18, 0.46, 0.9]);
    b.add(SPH, M.matte, COL.sofa, [-x - 0.27, 0.74, s * SEAT.z], [0, 0, -0.14], [0.09, 0.22, 0.43]);
    // Stubby legs.
    for (const fx of [sx0 + 0.06, -x + 0.18]) b.add(CYL, M.satin, COL.teak, [fx, 0.05, s * (sz - 0.08)], [0, 0, 0], [0.03, 0.1, 0.03]);
  }
  bx(M.matte, COL.sofaDark, sx0, 0.3, -sz + 0.17, sx0 + 0.18, 0.98, sz - 0.17);
  // A crumpled throw on the back and an extra pillow.
  b.add(BOX, M.matte, 0xc9b06a, [sx0 + 0.12, 0.92, 0.6], [0.2, 0.3, -0.25], [0.3, 0.06, 0.55]);
  b.add(SPH, M.matte, 0x2f6a8a, [-x - 0.15, sy + 0.13, SEAT.z + 0.33], [0.3, 0.6, 0.2], [0.15, 0.13, 0.06]);

  // Worn armchair (seat 1), green velvet, facing the sofa.
  const ay = SEAT.armchairY;
  const az = -SEAT.z;
  const ax = x;
  bx(M.matte, COL.armchair, ax - 0.22, 0.12, az - 0.37, ax + 0.32, ay - 0.1, az + 0.37);
  b.add(BOX, M.matte, COL.armchair, [ax + 0.0, ay - 0.06, az], [0, 0, 0], [0.5, 0.12, 0.6]);
  bx(M.matte, COL.armchair, ax + 0.22, 0.12, az - 0.4, ax + 0.4, 1.05, az + 0.4);
  b.add(CYL, M.matte, COL.armchair, [ax + 0.31, 1.05, az], [Math.PI / 2, 0, 0], [0.09, 0.8, 0.09]);
  for (const s of [-1, 1]) {
    bx(M.matte, COL.armchair, ax - 0.24, 0.12, az + s * 0.3 - 0.07, ax + 0.36, ay + 0.17, az + s * 0.3 + 0.07);
    b.add(CYL, M.matte, COL.armchair, [ax + 0.06, ay + 0.17, az + s * 0.3], [0, 0, Math.PI / 2], [0.075, 0.6, 0.075]);
    for (const fx of [ax - 0.18, ax + 0.32]) b.add(CYL, M.satin, COL.teak, [fx, 0.06, az + s * 0.32], [0, 0, 0], [0.025, 0.12, 0.025]);
  }
  // Worn patches on the armrests.
  for (const s of [-1, 1]) b.add(SPH, M.matte, 0x4a7a62, [ax - 0.05, ay + 0.245, az + s * 0.3], [0, 0, 0], [0.12, 0.01, 0.05]);

  // Bean bag (seat 3): a squashed sack with a raised back.
  const by = SEAT.beanY;
  const bz = SEAT.z;
  b.add(SPH, M.matte, COL.bean, [x + 0.05, by * 0.5, bz], [0, 0, 0], [0.44, by * 0.52, 0.44]);
  b.add(SPH, M.matte, COL.bean, [x + 0.3, by + 0.05, bz], [0, 0, 0.35], [0.24, 0.36, 0.4]);
  b.add(SPH, M.matte, 0x6a2232, [x + 0.12, by * 0.2, bz], [0, 0, 0], [0.48, by * 0.24, 0.48]);
}

function buildTable(b: Batch, M: RoomMats, bx: BX): void {
  const { w, d, h } = TABLE;
  const x0 = -w / 2;
  const z0 = -d / 2;
  // Rug under the table.
  b.add(atlasUV(new THREE.PlaneGeometry(3.3, 2.2), ATLAS.rug), M.atlas, 0xffffff, [0, 0.004, 0], [-Math.PI / 2, 0, Math.PI / 2]);
  // Tiled top: 10 cm tiles, the texture holds 8 of them.
  const top = new THREE.PlaneGeometry(w, d);
  const uv = top.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 0.8, (uv.getY(i) * d) / 0.8);
  b.add(top, M.tiles, 0xffffff, [0, h, 0], [-Math.PI / 2, 0, 0]);
  // Teak frame slightly above the tiles, apron, tapered legs, a shelf with magazines.
  const f = 0.035;
  bx(M.satin, COL.teak, x0 - f, h - 0.06, z0 - f, x0, h + 0.012, -z0 + f);
  bx(M.satin, COL.teak, -x0, h - 0.06, z0 - f, -x0 + f, h + 0.012, -z0 + f);
  bx(M.satin, COL.teak, x0, h - 0.06, z0 - f, -x0, h + 0.012, z0);
  bx(M.satin, COL.teak, x0, h - 0.06, -z0, -x0, h + 0.012, -z0 + f);
  bx(M.satin, COL.teak, x0, h - 0.07, z0, -x0, h - 0.01, -z0);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) b.add(CYL, M.satin, COL.teak, [sx * (w / 2 - 0.02), (h - 0.06) / 2, sz * (d / 2 - 0.02)], [0, 0, 0], [0.022, h - 0.06, 0.022]);
  bx(M.satin, COL.teak, x0 + 0.02, 0.1, z0 + 0.02, -x0 - 0.02, 0.12, -z0 - 0.02);
  for (let k = 0; k < 4; k++) b.add(BOX, M.matte, [0xd8d0c0, 0xc0392b, 0x2a4a7a, 0xe8e0c8][k], [0.02 * k - 0.03, 0.125 + k * 0.006, -0.2 + k * 0.03], [0, k * 0.3, 0], [0.21, 0.006, 0.29]);
  buildClutter(b, M);
}

/** Beer bottle, standing at (x, z) on surface y. */
function bottle(b: Batch, M: RoomMats, x: number, y: number, z: number, color = 0x5a2e0e, label = true): void {
  b.add(CYL, M.shiny, color, [x, y + 0.085, z], [0, 0, 0], [0.032, 0.17, 0.032]);
  b.add(SPH, M.shiny, color, [x, y + 0.17, z], [0, 0, 0], [0.032, 0.035, 0.032]);
  b.add(CYL, M.shiny, color, [x, y + 0.225, z], [0, 0, 0], [0.013, 0.08, 0.013]);
  b.add(CYL, M.shiny, 0xb8a040, [x, y + 0.268, z], [0, 0, 0], [0.015, 0.01, 0.015]);
  if (label) b.add(atlasUV(new THREE.CylinderGeometry(1, 1, 1, 14, 1, true), ATLAS.label), M.atlas, 0xffffff, [x, y + 0.08, z], [0, 0, 0], [0.0335, 0.07, 0.0335]);
}

function buildClutter(b: Batch, M: RoomMats): void {
  const y = TABLE.h;
  // Wine bottle with the candle: generations of wax running down the neck.
  const cx = 0.1;
  const cz = 0.16;
  b.add(CYL, M.shiny, 0x1f3a22, [cx, y + 0.11, cz], [0, 0, 0], [0.038, 0.22, 0.038]);
  b.add(SPH, M.shiny, 0x1f3a22, [cx, y + 0.22, cz], [0, 0, 0], [0.038, 0.05, 0.038]);
  b.add(CYL, M.shiny, 0x1f3a22, [cx, y + 0.29, cz], [0, 0, 0], [0.015, 0.1, 0.015]);
  b.add(CYL, M.satin, COL.candle, [cx, y + 0.375, cz], [0, 0, 0], [0.012, 0.09, 0.012]);
  const wax = [COL.candle, 0xc0392b, 0x2a5a9a, 0xe8c040, COL.candle];
  for (let k = 0; k < 16; k++) {
    const a = k * 2.399;
    const lvl = (k % 5) / 5;
    const r = 0.016 + 0.02 * (1 - lvl) * (k > 8 ? 1 : 0.3);
    const yy = y + 0.33 - lvl * 0.2;
    b.add(SPH, M.satin, wax[k % wax.length], [cx + Math.cos(a) * r, yy, cz + Math.sin(a) * r], [0, 0, 0], [0.008, 0.03 + (k % 3) * 0.015, 0.008]);
  }
  b.add(CYL, M.satin, COL.candle, [cx, y + 0.335, cz], [0, 0, 0], [0.02, 0.012, 0.02]);
  // Ashtray with butts.
  b.add(CYL, M.shiny, 0x6a7a80, [0.13, y + 0.012, -0.46], [0, 0, 0], [0.06, 0.024, 0.06]);
  b.add(CYL, M.matte, 0x2a2a2a, [0.13, y + 0.025, -0.46], [0, 0, 0], [0.045, 0.004, 0.045]);
  for (let k = 0; k < 6; k++) {
    const a = k * 1.7;
    b.add(CYL, M.matte, k % 2 ? 0xe8e0d0 : 0xc88a40, [0.13 + Math.cos(a) * 0.025, y + 0.03, -0.46 + Math.sin(a) * 0.025], [Math.PI / 2, a, 0.2], [0.004, 0.03, 0.004]);
  }
  // Beer bottles, one emptied on its side.
  bottle(b, M, -0.17, y, 0.44);
  bottle(b, M, 0.19, y, 0.52, 0x2a5a2a);
  bottle(b, M, -0.19, y, -0.54);
  const g = new THREE.Group();
  g.position.set(0.17, y + 0.033, -0.13);
  g.rotation.set(Math.PI / 2, 0, 0.3);
  g.updateMatrixWorld();
  b.addMatrix(CYL, M.shiny, 0x5a2e0e, new THREE.Matrix4().makeScale(0.032, 0.17, 0.032).premultiply(g.matrixWorld));
  b.addMatrix(CYL, M.shiny, 0x5a2e0e, new THREE.Matrix4().makeScale(0.013, 0.1, 0.013).premultiply(new THREE.Matrix4().makeTranslation(0, 0.12, 0)).premultiply(g.matrixWorld));
  // Board game box, a couple of cards.
  b.add(atlasUV(BOX.clone(), ATLAS.game), M.atlas, 0xffffff, [-0.08, y + 0.025, -0.2], [0, 0.25, 0], [0.25, 0.05, 0.25]);
  for (let k = 0; k < 5; k++) b.add(BOX, M.satin, k % 2 ? 0xf0ece0 : 0xc0392b, [-0.15 + k * 0.04, y + 0.003 + k * 0.001, 0.05 + (k % 3) * 0.04], [0, k * 0.7, 0], [0.056, 0.002, 0.086]);
  // Chip bags: one open and slumped, one flat.
  b.add(atlasUV(BOX.clone(), ATLAS.chipsA), M.atlas, 0xffffff, [-0.03, y + 0.04, 0.5], [0.1, -0.4, 0.15], [0.16, 0.07, 0.22]);
  b.add(atlasUV(PLANE.clone(), ATLAS.chipsB), M.atlas, 0xffffff, [0.02, y + 0.006, -0.02], [-Math.PI / 2, 0, 0.9], [0.15, 0.2, 1]);
  for (let k = 0; k < 7; k++) b.add(SPH, M.matte, 0xe0b050, [-0.02 + Math.sin(k * 3) * 0.08, y + 0.005, 0.38 + Math.cos(k * 2) * 0.05], [0, k, 0], [0.018, 0.004, 0.014]);
}

function buildBack(b: Batch, M: RoomMats, bx: BX): void {
  const { minX, minZ } = ROOM;
  // Mattress in the back left corner, the flatmate's bed when he gave up on his own room.
  const mx0 = minX + 0.02;
  const mx1 = minX + 1.1;
  const mz0 = minZ + 0.02;
  const mz1 = -1.45;
  bx(M.matte, COL.mattress, mx0, 0, mz0, mx1, 0.17, mz1);
  b.add(SPH, M.matte, 0xe8e0d0, [(mx0 + mx1) / 2, 0.22, mz0 + 0.22], [0, 0.1, 0], [0.3, 0.07, 0.15]);
  // Blanket over the sleeper's legs, bunched up.
  b.add(SPH, M.matte, COL.blanket, [-0.55, 0.33, -1.8], [0, 0.15, 0], [0.45, 0.25, 0.44]);
  b.add(SPH, M.matte, 0x34466c, [mx0 + 0.5, 0.26, -1.95], [0, -0.3, 0], [0.3, 0.13, 0.32]);
  b.add(BOX, M.matte, COL.blanket, [mx0 + 0.6, 0.19, -1.7], [0, 0.1, 0], [0.95, 0.05, 0.65]);

  // Big plant between window and sideboard.
  const px = 1.05;
  const pz = minZ + 0.28;
  b.add(CYL, M.matte, COL.pot, [px, 0.18, pz], [0, 0, 0], [0.17, 0.36, 0.17]);
  b.add(CYL, M.matte, 0x2a1a10, [px, 0.36, pz], [0, 0, 0], [0.155, 0.01, 0.155]);
  for (let k = 0; k < 11; k++) {
    const a = k * 2.399;
    const hgt = 0.7 + (k % 4) * 0.22;
    const r = 0.12 + (k % 3) * 0.08;
    const lx = px + Math.cos(a) * r;
    const lz = pz + Math.sin(a) * r;
    b.add(CYL, M.matte, 0x3a5a2a, [(px + lx) / 2, 0.36 + hgt / 2, (pz + lz) / 2], [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3], [0.008, hgt, 0.008]);
    b.add(SPH, M.matte, k % 2 ? COL.plant : 0x3d7a3a, [lx + Math.cos(a) * 0.08, 0.36 + hgt, lz + Math.sin(a) * 0.08], [0.5, -a, 0.3], [0.17, 0.015, 0.12]);
  }

  // Sideboard with the CRT and the lava lamp (back right).
  const sx0 = 1.3;
  const sx1 = 2.47;
  const sz0 = minZ + 0.02;
  const sz1 = minZ + 0.46;
  bx(M.satin, COL.teak, sx0, 0.08, sz0, sx1, 0.55, sz1);
  for (const x of [sx0 + 0.05, sx1 - 0.05]) for (const z of [sz0 + 0.05, sz1 - 0.05]) b.add(CYL, M.satin, COL.teak, [x, 0.04, z], [0, 0, 0], [0.02, 0.08, 0.02]);
  bx(M.satin, 0x4a2a12, sx0 + 0.03, 0.12, sz1, (sx0 + sx1) / 2 - 0.01, 0.5, sz1 + 0.005);
  bx(M.satin, 0x4a2a12, (sx0 + sx1) / 2 + 0.01, 0.12, sz1, sx1 - 0.03, 0.5, sz1 + 0.005);
  for (const x of [(sx0 + sx1) / 2 - 0.06, (sx0 + sx1) / 2 + 0.06]) b.add(SPH, M.shiny, COL.metal, [x, 0.33, sz1 + 0.012], [0, 0, 0], [0.012, 0.012, 0.012]);
  // CRT: deep case, bezel; the screen itself is a live mesh (fx).
  const tx = 1.78;
  const tz = minZ + 0.25;
  b.add(BOX, M.satin, COL.tvCase, [tx, 0.55 + 0.23, tz], [0, 0, 0], [0.56, 0.46, 0.42]);
  b.add(BOX, M.satin, COL.tvCase, [tx, 0.55 + 0.23, tz - 0.25], [0, 0, 0], [0.4, 0.34, 0.2]);
  b.add(BOX, M.satin, 0x3a3530, [tx + 0.22, 0.6, tz + 0.212], [0, 0, 0], [0.08, 0.06, 0.01]);
  b.add(CYL, M.shiny, COL.metal, [tx - 0.08, 1.08, tz - 0.1], [0, 0, 0.5], [0.004, 0.35, 0.004]);
  b.add(CYL, M.shiny, COL.metal, [tx + 0.06, 1.08, tz - 0.1], [0, 0, -0.6], [0.004, 0.35, 0.004]);
  // Game console cable and a remote.
  b.add(BOX, M.satin, 0x1a1a1a, [tx - 0.4, 0.565, tz + 0.12], [0, 0.4, 0], [0.05, 0.02, 0.17]);
}

function buildWallDecor(b: Batch, M: RoomMats): void {
  const { minX, maxX, minZ } = ROOM;
  const poster = (r: Rect, w: number, pos: [number, number, number], ry: number, tilt: number) =>
    b.add(atlasPlane(r), M.atlas, 0xe8e0d0, pos, [0, ry, tilt], [w, (w * r.h) / r.w, 1]);
  // Posters above the sofa, slightly crooked; the third beside the window.
  poster(ATLAS.posterA, 0.62, [minX + 0.012, 1.72, -0.5], Math.PI / 2, 0.03);
  poster(ATLAS.posterB, 0.62, [minX + 0.012, 1.68, 0.48], Math.PI / 2, -0.02);
  poster(ATLAS.posterC, 0.55, [-0.75, 1.75, minZ + 0.012], 0, 0.04);
  // Putzplan on the right wall by the door, held by tape.
  poster(ATLAS.putzplan, 0.42, [maxX - 0.012, 1.5, -0.85], -Math.PI / 2, 0);

  // Record player on two wine crates against the right wall, sleeves leaning in front.
  const cx = maxX - 0.3;
  const cz = 0.55;
  for (const [y0, rot] of [
    [0, 0],
    [0.33, 0.04],
  ] as const) {
    const c = 0x9a7a4a;
    b.add(BOX, M.matte, c, [cx, y0 + 0.165, cz], [0, rot, 0], [0.4, 0.33, 0.5]);
    for (let k = 0; k < 9; k++) b.add(BOX, M.satin, [0x1a1a1a, 0xc0392b, 0xe0d8c0, 0x2a4a7a, 0x8a6a2a][k % 5], [cx - 0.205, y0 + 0.165, cz - 0.2 + k * 0.05], [0, rot, 0], [0.01, 0.3, 0.04]);
  }
  b.add(BOX, M.satin, 0x3a2a1a, [cx, 0.71, cz], [0, 0.04, 0], [0.38, 0.1, 0.44]);
  b.add(CYL, M.satin, 0x111111, [cx, 0.765, cz + 0.02], [0, 0, 0], [0.15, 0.01, 0.15]);
  b.add(CYL, M.satin, 0xc0392b, [cx, 0.771, cz + 0.02], [0, 0, 0], [0.04, 0.002, 0.04]);
  b.add(CYL, M.shiny, COL.metal, [cx - 0.06, 0.79, cz - 0.15], [Math.PI / 2, 0.4, 0], [0.006, 0.22, 0.006]);
  for (const [k, ry] of [
    [0, -0.08],
    [1, 0.05],
    [2, -0.02],
  ] as const) {
    const r = ATLAS.sleeve[k];
    b.add(atlasPlane(r), M.atlas, 0xffffff, [cx - 0.24 - k * 0.012, 0.16, cz - 0.1 + k * 0.08], [0, -Math.PI / 2 + ry, -0.2], [0.31, 0.31, 1]);
  }
  // A crate of empties by the mattress.
  b.add(BOX, M.matte, 0x1f3a6a, [-0.2, 0.15, minZ + 0.3], [0, 0.2, 0], [0.3, 0.3, 0.4]);
  for (let k = 0; k < 6; k++) b.add(CYL, M.shiny, 0x3a1a08, [-0.2 - 0.08 + (k % 2) * 0.16, 0.36, minZ + 0.17 + Math.floor(k / 2) * 0.13], [0, 0, 0], [0.013, 0.1, 0.013]);
}
