import * as THREE from 'three';
import { mulberry32 } from '../../core/rng';
import { tag } from '../../scene/build';
import { Batch } from './batch';
import { BOOTH, COLORS_DINER as C, COUNTER, ROOM, SILL } from './config';
import { blobTex, checkerTex, clockTex, formicaTex, menuBoardTex, SignCanvas, smokeTex, tableMenuTex } from './textures';

/** Glowing material groups, each dimmed on its own (power, flicker, the flare). */
export type GlowKey = 'pend' | 'trim' | 'juke' | 'kit' | 'warm' | 'street';

export interface DinerParts {
  glow: Record<GlowKey, THREE.MeshBasicMaterial>;
  /** Dim copies of the glows behind the windows: the glass reflecting the room at night. */
  mirrorGlow: Record<'pend' | 'trim' | 'juke' | 'sign', THREE.MeshBasicMaterial>;
  sign: SignCanvas;
  signMat: THREE.MeshBasicMaterial;
  menuMat: THREE.MeshBasicMaterial;
  jukeHalo: THREE.MeshBasicMaterial;
  streetHalo: THREE.MeshBasicMaterial;
  flame: THREE.Mesh[];
  flash: THREE.MeshBasicMaterial;
  smoke: THREE.Mesh[];
  led: THREE.MeshBasicMaterial;
  machinePot: THREE.Object3D;
  hands: { hour: THREE.Object3D; minute: THREE.Object3D };
}

const H = ROOM.height;
const { winX, zMin, zMax } = ROOM;
const WHITE = 0xf4f1e6;

/** Everything static in one pass; returns the handles the update needs. */
export function buildDiner(root: THREE.Object3D): DinerParts {
  const b = new Batch();
  room(b);
  kitchen(b);
  counter(b);
  BOOTH.centres.forEach((zc) => booth(b, zc));
  tableProps(b);
  jukebox(b);
  outside(b);

  const vc = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  const glowMat = () => new THREE.MeshBasicMaterial({ vertexColors: true });
  const glow: Record<GlowKey, THREE.MeshBasicMaterial> = {
    pend: glowMat(),
    trim: glowMat(),
    juke: glowMat(),
    kit: glowMat(),
    warm: glowMat(),
    street: glowMat(),
  };
  const formica = formicaTex();
  const menuTex = tableMenuTex();
  const mats: Record<string, THREE.Material> = {
    m: vc({ roughness: 0.85, metalness: 0.02 }),
    g: vc({ roughness: 0.3, metalness: 0.05 }),
    c: vc({ roughness: 0.22, metalness: 0.8 }),
    wet: vc({ roughness: 0.22, metalness: 0.35 }),
    f: vc({ roughness: 0.42, metalness: 0.05, map: formica }),
    menu: vc({ roughness: 0.6, metalness: 0, map: menuTex }),
    ...Object.fromEntries(Object.entries(glow).map(([k, v]) => [`glow_${k}`, v])),
  };
  const meshes = b.build(root, mats);
  for (const m of meshes) if (m.name.startsWith('diner_glow')) m.userData.role = 'light';

  // Checkerboard floor, one tile pair per 0.6 m.
  const floorTex = checkerTex();
  const fw = ROOM.backX - winX;
  const fd = zMax - zMin;
  floorTex.repeat.set(fw / 0.6, fd / 0.6);
  const floor = tag(new THREE.Mesh(new THREE.PlaneGeometry(fw, fd).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.38, metalness: 0.05 })), 'struct');
  floor.position.set((winX + ROOM.backX) / 2, 0, 0);
  root.add(floor);

  // One sheet of glass along the whole window wall; transparent, so it sorts after the room.
  const glass = tag(
    new THREE.Mesh(
      new THREE.PlaneGeometry(zMax - zMin, ROOM.lintelY - ROOM.sillY).rotateY(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x0d1822, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.9, depthWrite: false }),
    ),
    'struct',
  );
  glass.position.set(winX - 0.04, (ROOM.sillY + ROOM.lintelY) / 2, 0);
  root.add(glass);

  // Neon sign above the hatch.
  const sign = new SignCanvas();
  const signMat = new THREE.MeshBasicMaterial({ map: sign.texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const signGeo = new THREE.PlaneGeometry(2.8, 0.7).rotateY(-Math.PI / 2);
  const signMesh = tag(new THREE.Mesh(signGeo, signMat), 'light');
  signMesh.position.set(ROOM.backX - 0.03, 2.33, -0.15);
  root.add(signMesh);

  const menuMat = new THREE.MeshBasicMaterial({ map: menuBoardTex() });
  const menu = tag(new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8).rotateY(-Math.PI / 2), menuMat), 'prop');
  menu.position.set(ROOM.backX - 0.015, 1.72, 1.85);
  root.add(menu);

  // Mirror images: the window wall is a plane mirror at night, so a dim copy of every glow, mirrored
  // across it, sits exactly where the reflection would appear from any viewpoint.
  const mirror = new THREE.Group();
  mirror.name = 'diner_reflection';
  mirror.position.x = 2 * winX;
  mirror.scale.x = -1;
  root.add(mirror);
  const dim = (map?: THREE.Texture) => new THREE.MeshBasicMaterial({ vertexColors: !map, ...(map ? { map } : {}), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const mirrorGlow = { pend: dim(), trim: dim(), juke: dim(), sign: dim(sign.texture) };
  for (const m of meshes) {
    const k = m.name.replace('diner_glow_', '') as keyof typeof mirrorGlow;
    if (m.name.startsWith('diner_glow_') && k in mirrorGlow) mirror.add(tag(new THREE.Mesh(m.geometry, mirrorGlow[k]), 'fx'));
  }
  const signGhost = tag(new THREE.Mesh(signGeo, mirrorGlow.sign), 'fx');
  signGhost.position.copy(signMesh.position);
  mirror.add(signGhost);

  const blob = blobTex();
  const halo = (color: number, w: number, d: number, x: number, y: number, z: number) => {
    const mat = new THREE.MeshBasicMaterial({ color, map: blob, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = tag(new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat), 'fx');
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mat;
  };
  const jukeHalo = halo(C.jukeboxAmber, 2.2, 1.6, -1.3, 0.006, 2.95);
  const streetHalo = halo(0xffa040, 9, 9, -9.6, -0.01, 4.4);

  // Fryer flames: an outer orange and an inner yellow cone, scaled by the flare.
  const coneGeo = new THREE.ConeGeometry(0.2, 0.7, 12, 1, true).translate(0, 0.35, 0);
  const flame = [0xff6a10, 0xffd040].map((c) => {
    const m = tag(new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })), 'fx');
    m.position.set(4.57, 0.9, -0.72);
    // HDR, so the flames bloom.
    (m.material as THREE.MeshBasicMaterial).color.multiplyScalar(2.2);
    m.visible = false;
    root.add(m);
    return m;
  });
  // The flash filling the hatch, seen from the room.
  const flash = new THREE.MeshBasicMaterial({ color: 0xff8a30, map: blob, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
  const flashMesh = tag(new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6).rotateY(-Math.PI / 2), flash), 'fx');
  flashMesh.position.set(ROOM.backX + 0.25, (COUNTER.passY0 + COUNTER.passY1) / 2, (COUNTER.passZ0 + COUNTER.passZ1) / 2);
  root.add(flashMesh);

  const puff = smokeTex();
  const smoke = Array.from({ length: 5 }, () => {
    const m = tag(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x8a817a, map: puff, transparent: true, depthWrite: false, opacity: 0 })), 'fx');
    m.visible = false;
    root.add(m);
    return m;
  });

  const led = new THREE.MeshBasicMaterial({ color: 0x300000 });
  const ledMesh = tag(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 0.02), led), 'light');
  ledMesh.position.set(2.2, H - 0.035, -0.15);
  root.add(ledMesh);

  // The pot that sits on the warmer whenever the waitress doesn't hold it.
  const machinePot = tag(new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), new THREE.MeshStandardMaterial({ color: 0x2a160c, roughness: 0.15, metalness: 0.1 })), 'prop');
  machinePot.scale.y = 0.85;
  machinePot.position.set(2.52, 1.0, -1.85);
  root.add(machinePot);

  const hands = wallClock(root);
  return { glow, mirrorGlow, sign, signMat, menuMat, jukeHalo, streetHalo, flame, flash, smoke, led, machinePot, hands };
}

function wallClock(root: THREE.Object3D): DinerParts['hands'] {
  const face = tag(new THREE.Mesh(new THREE.CircleGeometry(0.2, 32).rotateY(Math.PI), new THREE.MeshStandardMaterial({ map: clockTex(), roughness: 0.5 })), 'prop');
  face.position.set(0.6, 2.25, zMax - 0.02);
  root.add(face);
  const handMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 });
  const mk = (len: number, w: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.6, 2.25, zMax - 0.03);
    // Rotating about -z makes positive angles clockwise for someone facing the wall.
    pivot.rotation.order = 'XYZ';
    pivot.add(tag(new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.006).translate(0, len / 2 - 0.02, 0), handMat), 'prop'));
    root.add(pivot);
    return pivot;
  };
  return { hour: mk(0.11, 0.014), minute: mk(0.16, 0.009) };
}

function room(b: Batch): void {
  const { backX } = ROOM;
  b.span('m', winX, H, zMin, ROOM.kitchenX, H + 0.06, zMax, C.ceiling);
  // Long walls: teal below, a chrome band, cream above.
  for (const side of [-1, 1]) {
    const face = side < 0 ? zMin : zMax;
    const outer = face + side * 0.06;
    const inward = face - side * 0.012;
    const lo = (a: number, c: number) => Math.min(a, c);
    const hi = (a: number, c: number) => Math.max(a, c);
    b.span('m', winX, 0, lo(face, outer), backX, 1.0, hi(face, outer), C.wallLow);
    b.span('m', winX, 1.05, lo(face, outer), backX, H, hi(face, outer), C.wallHigh);
    b.span('c', winX, 1.0, lo(face, inward), backX, 1.05, hi(face, inward), C.chrome);
    b.span('m', winX, 0, lo(face, inward), backX, 0.1, hi(face, inward), 0x151515);
    // Neon trim under the ceiling.
    const tz = face - side * 0.03;
    b.span('glow_trim', winX + 0.1, 2.71, tz - 0.015, backX - 0.1, 2.74, tz + 0.015, C.signPink);
    b.span('glow_trim', winX + 0.1, 2.63, tz - 0.012, backX - 0.1, 2.655, tz + 0.012, C.signCyan);
  }
  // Window wall: panel below the sill, chrome sill, mullions, cream lintel.
  b.span('m', winX - 0.1, 0, zMin, winX, ROOM.sillY, zMax, C.wallLow);
  b.span('c', winX - 0.02, ROOM.sillY - 0.03, zMin, winX + 0.09, ROOM.sillY, zMax, C.chrome);
  b.span('m', winX - 0.1, ROOM.lintelY, zMin, winX, H, zMax, C.wallHigh);
  b.span('glow_trim', winX + 0.015, 2.71, zMin + 0.1, winX + 0.045, 2.74, zMax - 0.1, C.signCyan);
  b.span('c', winX - 0.07, ROOM.lintelY - 0.04, zMin, winX + 0.02, ROOM.lintelY, zMax, C.chrome);
  for (const z of [zMin + 0.05, -BOOTH.backOut, BOOTH.backOut, zMax - 0.05]) b.span('c', winX - 0.08, ROOM.sillY, z - 0.04, winX + 0.01, ROOM.lintelY, z + 0.04, C.chrome);
  b.span('c', winX - 0.08, 2.03, zMin, winX + 0.0, 2.06, zMax, C.chrome);

  // Kitchen wall with the hatch.
  const { passZ0, passZ1, passY0, passY1 } = COUNTER;
  const kx0 = backX;
  const kx1 = backX + 0.1;
  b.span('m', kx0, 0, zMin, kx1, 1.0, zMax, C.wallLow);
  b.span('m', kx0, 1.0, zMin, kx1, H, passZ0, C.wallHigh);
  b.span('m', kx0, 1.0, passZ1, kx1, H, zMax, C.wallHigh);
  b.span('m', kx0, 1.0, passZ0, kx1, passY0, passZ1, C.wallHigh);
  b.span('m', kx0, passY1, passZ0, kx1, H, passZ1, C.wallHigh);
  b.span('glow_trim', kx0 - 0.03, 2.82, zMin + 0.1, kx0 - 0.015, 2.84, zMax - 0.1, C.signPink);
  // Chrome frame and the steel sill of the hatch.
  b.span('c', kx0 - 0.03, passY1, passZ0 - 0.05, kx0, passY1 + 0.05, passZ1 + 0.05, C.chrome);
  b.span('c', kx0 - 0.03, passY0, passZ0 - 0.05, kx0, passY1, passZ0, C.chrome);
  b.span('c', kx0 - 0.03, passY0, passZ1, kx0, passY1, passZ1 + 0.05, C.chrome);
  b.span('c', backX - 0.22, passY0 - 0.03, passZ0 - 0.05, backX + 0.35, passY0, passZ1 + 0.05, C.chrome);
  // Ticket rail with a few orders clipped in.
  b.add('c', new THREE.CylinderGeometry(0.012, 0.012, passZ1 - passZ0 + 0.1, 8), C.chrome, { x: backX - 0.035, y: passY1 + 0.07, z: (passZ0 + passZ1) / 2, rx: Math.PI / 2 });
  const r = mulberry32(77);
  for (let i = 0; i < 5; i++) {
    const z = passZ0 + 0.15 + i * 0.32 + r() * 0.08;
    b.box('m', 0.003, 0.13, 0.085, WHITE, { x: backX - 0.045, y: passY1 + 0.0, z, rx: (r() - 0.5) * 0.15 });
  }
  // Bell on the sill.
  b.cyl('m', 0.045, 0.05, 0.02, 0x151515, { x: SILL.x - 0.1, y: passY0 + 0.01, z: SILL.bellZ });
  b.add('c', new THREE.SphereGeometry(0.04, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xd8c690, { x: SILL.x - 0.1, y: passY0 + 0.02, z: SILL.bellZ });
  b.cyl('c', 0.006, 0.006, 0.025, C.chrome, { x: SILL.x - 0.1, y: passY0 + 0.07, z: SILL.bellZ }, 6);
  // Two plates waiting under the heat lamp.
  for (const z of [-0.6, -0.15]) {
    b.cyl('g', 0.12, 0.11, 0.015, WHITE, { x: backX + 0.05, y: passY0 + 0.008, z }, 18);
    b.cyl('m', 0.055, 0.055, 0.025, 0xc98a3c, { x: backX + 0.05, y: passY0 + 0.028, z }, 12);
    b.cyl('m', 0.058, 0.058, 0.018, 0x4a2a18, { x: backX + 0.05, y: passY0 + 0.05, z }, 12);
    b.add('m', new THREE.SphereGeometry(0.06, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xd29a48, { x: backX + 0.05, y: passY0 + 0.058, z, sy: 0.7 });
  }
  b.span('glow_warm', backX + 0.12, passY1 - 0.07, passZ0 + 0.05, backX + 0.17, passY1 - 0.04, passZ1 - 0.05, 0xff5a20);

  // Smoke detector on the ceiling in front of the hatch.
  b.cyl('m', 0.065, 0.07, 0.03, 0xe8e6e0, { x: 2.2, y: H - 0.015, z: -0.15 }, 16);

  // Sign backing board.
  b.span('m', backX - 0.02, 2.0, -1.65, backX, 2.68, 1.35, 0x15151a);
}

function kitchen(b: Batch): void {
  const x0 = ROOM.backX + 0.1;
  const x1 = ROOM.kitchenX;
  const kz0 = -1.9;
  const kz1 = 1.6;
  b.span('m', x0, -0.02, kz0, x1, 0, kz1, 0x6b2a24);
  b.span('m', x1, 0, kz0, x1 + 0.1, H, kz1, C.kitchenWall);
  b.span('m', x0, 0, kz0 - 0.1, x1, H, kz0, C.kitchenWall);
  b.span('m', x0, 0, kz1, x1, H, kz1 + 0.1, C.kitchenWall);
  // Tile grout lines on the back wall.
  for (let y = 0.3; y < H; y += 0.3) b.span('m', x1 - 0.005, y, kz0, x1, y + 0.01, kz1, 0x9aa4a2);
  // Prep table under the hatch.
  b.span('c', x0, 0, COUNTER.passZ0, x0 + 0.4, 0.9, COUNTER.passZ1, C.chrome);
  // Fryer: steel body, two oil wells, baskets.
  b.span('c', 4.3, 0, -0.95, 4.85, 0.9, -0.25, C.chrome);
  b.span('m', 4.35, 0.9, -0.9, 4.8, 0.905, -0.63, 0x7a5414);
  b.span('m', 4.35, 0.9, -0.57, 4.8, 0.905, -0.3, 0x7a5414);
  for (const z of [-0.76, -0.43]) {
    b.span('m', 4.4, 0.86, z - 0.11, 4.7, 0.97, z + 0.11, 0x2a2a2a);
    b.span('c', 4.1, 0.99, z - 0.01, 4.42, 1.01, z + 0.01, 0x222222);
  }
  // Flat-top grill with patties.
  b.span('c', 4.3, 0, 0.0, 4.85, 0.88, 0.85, C.chrome);
  b.span('m', 4.3, 0.88, 0.02, 4.85, 0.92, 0.83, 0x121212);
  for (const [px, pz] of [
    [4.45, 0.2],
    [4.62, 0.45],
    [4.45, 0.62],
  ])
    b.cyl('m', 0.055, 0.055, 0.016, 0x4a2a18, { x: px, y: 0.928, z: pz }, 12);
  // Hood and the shelf with pans.
  b.span('c', 4.15, 1.95, -1.05, x1, 2.4, 0.95, C.chrome);
  b.span('c', 4.65, 1.5, -1.6, x1, 1.53, 1.4, C.chrome);
  for (const z of [-1.3, -0.9, 0.7, 1.1]) b.cyl('m', 0.12, 0.1, 0.07, 0x2b2b2b, { x: 4.78, y: 1.565, z }, 14);
  // Fluorescent tubes on the kitchen ceiling.
  for (const z of [-0.6, 0.6]) b.span('glow_kit', 3.6, H - 0.06, z - 0.5, 3.66, H - 0.03, z + 0.5, 0xe6f2ff);
}

function counter(b: Batch): void {
  const { frontX, backX, topX0, topX1, top, z0, z1 } = COUNTER;
  b.span('g', frontX, 0.1, z0, backX, top - 0.05, z1, 0x2a7f7a);
  b.span('m', frontX + 0.04, 0, z0 + 0.04, backX, 0.1, z1 - 0.04, 0x111111);
  for (const y of [0.32, 0.66]) b.span('c', frontX - 0.012, y, z0, frontX, y + 0.035, z1, C.chrome);
  b.span('c', topX0 - 0.012, top - 0.05, z0 - 0.07, topX1 + 0.012, top - 0.012, z1 + 0.07, C.chrome);
  b.span('g', topX0, top - 0.045, z0 - 0.06, topX1, top, z1 + 0.06, 0xe9e2d4);
  // Foot rail.
  b.add('c', new THREE.CylinderGeometry(0.022, 0.022, z1 - z0, 10), C.chrome, { x: frontX - 0.09, y: 0.2, z: (z0 + z1) / 2, rx: Math.PI / 2 });
  for (const z of [z0 + 0.2, (z0 + z1) / 2, z1 - 0.2]) b.span('c', frontX - 0.1, 0.19, z - 0.015, frontX, 0.21, z + 0.015, C.chrome);
  // Stools.
  for (const z of COUNTER.stoolZ) {
    const x = COUNTER.stoolX;
    b.cyl('c', 0.2, 0.23, 0.03, C.chrome, { x, y: 0.015, z }, 20);
    b.cyl('c', 0.035, 0.035, 0.64, C.chrome, { x, y: 0.34, z }, 10);
    b.cyl('c', 0.17, 0.12, 0.04, C.chrome, { x, y: 0.67, z }, 20);
    b.cyl('g', 0.2, 0.19, 0.07, C.vinyl, { x, y: COUNTER.stoolTop - 0.035, z }, 20);
    b.cyl('g', 0.205, 0.205, 0.012, 0xf0e8dc, { x, y: COUNTER.stoolTop - 0.02, z }, 20);
  }
  // Pie case at the south end of the counter.
  const px = 1.18;
  const pz = -1.95;
  const py = top;
  for (const [dx, dz] of [
    [-0.27, -0.25],
    [0.27, -0.25],
    [-0.27, 0.25],
    [0.27, 0.25],
  ])
    b.span('c', px + dx - 0.012, py, pz + dz - 0.012, px + dx + 0.012, py + 0.55, pz + dz + 0.012, C.chrome);
  b.span('c', px - 0.28, py + 0.55, pz - 0.26, px + 0.28, py + 0.58, pz + 0.26, C.chrome);
  b.span('c', px - 0.28, py, pz - 0.26, px + 0.28, py + 0.025, pz + 0.26, C.chrome);
  b.span('glow_warm', px - 0.2, py + 0.535, pz - 0.2, px + 0.2, py + 0.55, pz + 0.2, 0xffe2b0);
  b.span('g', px - 0.26, py + 0.27, pz - 0.24, px + 0.26, py + 0.28, pz + 0.24, 0xcfe2e6);
  for (const [sy, dz, cut, fill] of [
    [0.025, -0.11, false, 0x9b1b30],
    [0.025, 0.12, true, 0xe0b040],
    [0.28, -0.11, true, 0x9b1b30],
    [0.28, 0.12, false, 0x6a2a4a],
  ] as const) {
    const len = cut ? Math.PI * 1.6 : Math.PI * 2;
    b.add('m', new THREE.CylinderGeometry(0.105, 0.095, 0.04, 20, 1, false, 0, len), 0xd99a4e, { x: px, y: py + sy + 0.02, z: pz + dz });
    b.add('g', new THREE.CylinderGeometry(0.095, 0.095, 0.006, 20, 1, false, 0, len), fill, { x: px, y: py + sy + 0.041, z: pz + dz });
  }
  // Cake under a dome, napkins, sugar, the trucker's mug.
  b.cyl('c', 0.14, 0.14, 0.012, C.chrome, { x: 1.2, y: top + 0.11, z: 0.85 }, 20);
  b.cyl('c', 0.02, 0.05, 0.1, C.chrome, { x: 1.2, y: top + 0.05, z: 0.85 }, 10);
  b.cyl('m', 0.11, 0.11, 0.09, 0xf2d9e0, { x: 1.2, y: top + 0.16, z: 0.85 }, 20);
  b.cyl('g', 0.112, 0.112, 0.012, 0xe85f8a, { x: 1.2, y: top + 0.205, z: 0.85 }, 20);
  for (const z of [-0.8, 0.0, 1.6]) {
    b.box('c', 0.08, 0.12, 0.1, C.chrome, { x: 1.15, y: top + 0.06, z });
    b.box('m', 0.06, 0.02, 0.08, WHITE, { x: 1.15, y: top + 0.125, z });
    b.cyl('g', 0.03, 0.03, 0.1, 0xdfe9ea, { x: 1.3, y: top + 0.05, z: z + 0.1 }, 10);
    b.cyl('c', 0.031, 0.02, 0.03, C.chrome, { x: 1.3, y: top + 0.115, z: z + 0.1 }, 10);
  }
  mug(b, 1.2, top, 1.2, 0);

  // Back counter with coffee machine, milkshake mixer and a stack of mugs.
  const bx = COUNTER.backCounterX;
  const bt = COUNTER.backCounterTop;
  b.span('m', bx + 0.02, 0, zMin, ROOM.backX, bt - 0.04, zMax, 0x22302f);
  b.span('g', bx, bt - 0.04, zMin, ROOM.backX, bt, zMax, 0xe9e2d4);
  b.span('c', 2.62, bt, -2.42, 2.98, bt + 0.66, -1.68, 0x3a3d42);
  b.span('c', 2.42, bt + 0.5, -2.42, 2.62, bt + 0.6, -1.68, C.chrome);
  for (const z of [-2.25, -1.85]) b.cyl('m', 0.08, 0.08, 0.012, 0x0c0c0c, { x: 2.52, y: bt + 0.006, z }, 16);
  b.add('g', new THREE.SphereGeometry(0.075, 12, 8), 0x2a160c, { x: 2.52, y: bt + 0.08, z: -2.25, sy: 0.85 });
  for (const z of [-2.3, -1.8]) b.box('glow_warm', 0.005, 0.02, 0.02, 0xff3010, { x: 2.618, y: bt + 0.3, z });
  // Mixer: mint base, column, head, two steel cups.
  b.box('g', 0.22, 0.05, 0.3, 0x8fd8c4, { x: 2.62, y: bt + 0.025, z: 0.85 });
  b.cyl('g', 0.035, 0.04, 0.42, 0x8fd8c4, { x: 2.72, y: bt + 0.26, z: 0.85 }, 12);
  b.box('g', 0.24, 0.12, 0.32, 0x8fd8c4, { x: 2.62, y: bt + 0.5, z: 0.85 });
  for (const z of [0.76, 0.94]) {
    b.cyl('c', 0.006, 0.006, 0.2, C.chrome, { x: 2.56, y: bt + 0.34, z }, 6);
    b.cyl('c', 0.05, 0.04, 0.18, C.chrome, { x: 2.56, y: bt + 0.14, z }, 14);
  }
  for (let i = 0; i < 4; i++) b.cyl('g', 0.042, 0.036, 0.09, WHITE, { x: 2.6, y: bt + 0.045 + i * 0.085, z: 2.0 }, 12);
}

function mug(b: Batch, x: number, y: number, z: number, ry: number): void {
  b.cyl('g', 0.07, 0.07, 0.008, WHITE, { x, y: y + 0.004, z }, 16);
  b.cyl('g', 0.042, 0.036, 0.09, WHITE, { x, y: y + 0.053, z }, 14);
  b.cyl('m', 0.037, 0.037, 0.004, 0x2a160c, { x, y: y + 0.088, z }, 14);
  b.add('g', new THREE.TorusGeometry(0.024, 0.007, 6, 12), WHITE, { x: x + Math.cos(ry) * 0.045, y: y + 0.055, z: z - Math.sin(ry) * 0.045, ry });
}

function booth(b: Batch, zc: number): void {
  const { tableX0: x0, tableX1: x1 } = BOOTH;
  const bx1 = x1 - 0.05;
  for (const s of [-1, 1]) {
    const zf = zc + s * BOOTH.seatFront;
    const zb = zc + s * BOOTH.seatBack;
    const lo = Math.min(zf, zb);
    const hi = Math.max(zf, zb);
    b.span('m', x0, 0, lo + (s < 0 ? 0 : 0.03), bx1, 0.4, hi - (s < 0 ? 0.03 : 0), C.vinylDark);
    b.span('g', x0, 0.4, lo, bx1, BOOTH.seatTop, hi, C.vinyl);
    b.add('g', new THREE.CylinderGeometry(0.014, 0.014, bx1 - x0, 8), 0xf0e8dc, { x: (x0 + bx1) / 2, y: BOOTH.seatTop - 0.01, z: zf, rz: Math.PI / 2 });
    const back0 = zb;
    const back1 = zc + s * BOOTH.backOut;
    b.span('g', x0, BOOTH.seatTop, Math.min(back0, back1), bx1, 1.2, Math.max(back0, back1), C.vinyl);
    b.add('g', new THREE.CylinderGeometry(0.06, 0.06, bx1 - x0, 14), C.vinyl, { x: (x0 + bx1) / 2, y: 1.2, z: (back0 + back1) / 2, rz: Math.PI / 2 });
    // Channel tufting on the backrest.
    for (let x = x0 + 0.2; x < bx1 - 0.1; x += 0.24) b.span('g', x - 0.008, 0.58, back0 - s * 0.004 - 0.004, x + 0.008, 1.16, back0 - s * 0.004 + 0.004, C.vinylDark);
    // Aisle end panel.
    b.span('m', bx1, 0.4, Math.min(back0, back1) - 0.02, bx1 + 0.04, 1.27, Math.max(back0, back1) + 0.02, 0x3a1a12);
  }
  const t = BOOTH.tableTop;
  b.span('c', x0, t - 0.03, zc - BOOTH.tableHalfZ - 0.015, x1 + 0.01, t - 0.004, zc + BOOTH.tableHalfZ + 0.015, C.chrome);
  b.span('f', x0, t - 0.02, zc - BOOTH.tableHalfZ, x1, t, zc + BOOTH.tableHalfZ, 0xffffff);
  b.cyl('c', 0.05, 0.05, t - 0.03, C.chrome, { x: BOOTH.tableCx, y: (t - 0.03) / 2, z: zc }, 12);
  b.cyl('c', 0.08, 0.28, 0.04, C.chrome, { x: BOOTH.tableCx, y: 0.02, z: zc }, 20);
  // Pendant lamp: cord, red shade, glowing diffuser.
  const lx = BOOTH.tableCx;
  b.cyl('m', 0.006, 0.006, H - 2.15, 0x111111, { x: lx, y: (H + 2.15) / 2, z: zc }, 6);
  b.cyl('c', 0.03, 0.04, 0.05, C.chrome, { x: lx, y: 2.17, z: zc }, 12);
  b.cyl('g', 0.06, 0.21, 0.2, C.vinyl, { x: lx, y: 2.05, z: zc }, 24);
  b.add('glow_pend', new THREE.CircleGeometry(0.2, 24).rotateX(Math.PI / 2), 0xffd29a, { x: lx, y: 1.948, z: zc });
}

function tableProps(b: Batch): void {
  const t = BOOTH.tableTop;
  const r = mulberry32(4242);
  // Players' table: caddy at the window end, menus, four mugs, a plate of fries.
  const cx = BOOTH.tableX0 + 0.18;
  b.box('c', 0.1, 0.12, 0.07, C.chrome, { x: cx, y: t + 0.06, z: 0 });
  b.box('m', 0.08, 0.025, 0.05, WHITE, { x: cx, y: t + 0.125, z: 0 });
  for (const [z, col] of [
    [-0.13, 0xc0141c],
    [0.13, 0xe8b820],
  ] as const) {
    b.cyl('g', 0.028, 0.03, 0.15, col, { x: cx, y: t + 0.075, z }, 12);
    b.cyl('g', 0.007, 0.022, 0.05, col, { x: cx, y: t + 0.175, z }, 10);
  }
  for (const [dz, col] of [
    [-0.22, 0xe8eef2],
    [0.22, 0x6a6a6a],
  ] as const) {
    b.cyl('g', 0.018, 0.02, 0.06, col, { x: cx + 0.02, y: t + 0.03, z: dz }, 8);
    b.cyl('c', 0.019, 0.019, 0.015, C.chrome, { x: cx + 0.02, y: t + 0.067, z: dz }, 8);
  }
  b.box('menu', 0.22, 0.006, 0.3, 0xffffff, { x: BOOTH.tableX1 - 0.28, y: t + 0.003, z: -0.07, ry: 0.35 });
  b.box('menu', 0.22, 0.006, 0.3, 0xffffff, { x: BOOTH.tableX1 - 0.23, y: t + 0.009, z: 0.1, ry: -0.2 });
  for (const sx of BOOTH.seatX)
    for (const s of [-1, 1]) mug(b, sx + 0.12, t, s * 0.28, s > 0 ? 0.6 : -0.6);
  b.cyl('g', 0.13, 0.12, 0.015, WHITE, { x: BOOTH.tableCx, y: t + 0.008, z: 0 }, 20);
  for (let i = 0; i < 14; i++)
    b.box('m', 0.012, 0.012, 0.08, 0xe8b84a, { x: BOOTH.tableCx + (r() - 0.5) * 0.14, y: t + 0.022 + r() * 0.015, z: (r() - 0.5) * 0.14, ry: r() * 3, rx: (r() - 0.5) * 0.4 });
  b.cyl('g', 0.025, 0.025, 0.006, 0xb0101a, { x: BOOTH.tableCx + 0.06, y: t + 0.017, z: 0.07 }, 10);

  // The couple's table: two milkshakes with straws.
  const zc = BOOTH.centres[0];
  for (const [x, col] of [
    [BOOTH.seatX[0] + 0.05, 0xf2b8c8],
    [BOOTH.seatX[1] + 0.05, 0xf6efe2],
  ] as const) {
    const z = zc - 0.28;
    b.cyl('g', 0.045, 0.03, 0.2, col, { x, y: t + 0.1, z }, 12);
    b.add('m', new THREE.SphereGeometry(0.045, 10, 6), 0xfbf6ee, { x, y: t + 0.21, z, sy: 0.7 });
    b.add('g', new THREE.SphereGeometry(0.014, 8, 6), 0xc0101c, { x, y: t + 0.245, z });
    b.cyl('g', 0.004, 0.004, 0.22, 0xe02030, { x: x + 0.02, y: t + 0.26, z, rz: -0.25 }, 6);
  }
  b.cyl('g', 0.13, 0.12, 0.015, WHITE, { x: BOOTH.tableCx, y: t + 0.008, z: zc + 0.05 }, 20);
  // The empty booth: dirty plates, abandoned mugs, crumpled napkins.
  const ze = BOOTH.centres[2];
  for (let i = 0; i < 3; i++) b.cyl('g', 0.13, 0.12, 0.015, WHITE, { x: -2.55, y: t + 0.008 + i * 0.017, z: ze + 0.1 }, 20);
  mug(b, BOOTH.seatX[0], t, ze - 0.2, 0.3);
  mug(b, BOOTH.seatX[1], t, ze - 0.25, 2.5);
  for (let i = 0; i < 4; i++) b.add('m', new THREE.IcosahedronGeometry(0.03, 0), WHITE, { x: BOOTH.tableCx - 0.25 + r() * 0.5, y: t + 0.025, z: ze + (r() - 0.5) * 0.5, ry: r() * 3 });
}

function jukebox(b: Batch): void {
  const x = -1.3;
  const zf = zMax - 0.48;
  const zb = zMax - 0.05;
  const zcj = (zf + zb) / 2;
  b.span('m', x - 0.35, 0, zf, x + 0.35, 1.15, zb, 0x3a1a10);
  b.add('m', new THREE.CylinderGeometry(0.35, 0.35, zb - zf, 24, 1, false, Math.PI / 2, Math.PI), 0x3a1a10, { x, y: 1.15, z: zcj, rx: Math.PI / 2 });
  // Glowing arches, side tubes, title strip and the band at the foot.
  b.add('glow_juke', new THREE.TorusGeometry(0.31, 0.024, 8, 32, Math.PI), C.jukeboxAmber, { x, y: 1.15, z: zf - 0.01 });
  b.add('glow_juke', new THREE.TorusGeometry(0.22, 0.016, 8, 28, Math.PI), 0xff4fa0, { x, y: 1.15, z: zf - 0.012 });
  for (const sx of [-1, 1]) b.span('glow_juke', x + sx * 0.31 - 0.024, 0.12, zf - 0.035, x + sx * 0.31 + 0.024, 1.15, zf - 0.005, C.signCyan);
  b.span('glow_juke', x - 0.18, 0.84, zf - 0.012, x + 0.18, 0.95, zf - 0.002, 0x806040);
  b.span('glow_juke', x - 0.33, 0.05, zf - 0.02, x + 0.33, 0.09, zf, C.jukeboxAmber);
  b.span('g', x - 0.2, 1.0, zf - 0.008, x + 0.2, 1.3, zf, 0x0b0b10);
  b.span('m', x - 0.26, 0.2, zf - 0.006, x + 0.26, 0.72, zf, 0x150c08);
  for (let y = 0.25; y < 0.7; y += 0.07) b.span('c', x - 0.25, y, zf - 0.012, x + 0.25, y + 0.012, zf - 0.006, C.chrome);
}

function outside(b: Batch): void {
  const edge = winX - 0.1;
  b.span('wet', -45, -0.05, -40, edge, -0.02, 40, C.asphalt);
  b.span('m', edge - 1.3, -0.02, zMin - 2, edge, 0.12, zMax + 2, 0x4a4844);
  // Parking stalls perpendicular to the building, wheel stops at the curb.
  for (const z of [-4.6, -2.0, 0.6, 3.2, 5.8]) b.span('m', -10.2, -0.02, z - 0.05, edge - 1.4, -0.012, z + 0.05, 0xb8b2a0);
  for (const z of [-3.3, -0.7, 1.9, 4.5]) b.span('m', edge - 1.85, -0.02, z - 0.7, edge - 1.7, 0.1, z + 0.7, 0x5a5854);
  car(b, -7.0, -0.7);
  // Street lamp with a sodium head.
  const lx = -10.6;
  const lz = 4.4;
  b.cyl('m', 0.07, 0.09, 5.6, 0x2a2c30, { x: lx, y: 2.8, z: lz }, 10);
  b.span('m', lx, 5.45, lz - 0.05, lx + 1.2, 5.55, lz + 0.05, 0x2a2c30);
  b.span('m', lx + 0.8, 5.35, lz - 0.2, lx + 1.4, 5.5, lz + 0.2, 0x2a2c30);
  b.span('glow_street', lx + 0.85, 5.32, lz - 0.16, lx + 1.35, 5.35, lz + 0.16, 0xffb050);
  // A low hedge and the next lamp down the road, so the lot ends somewhere.
  b.span('m', -14, 0, -30, -13, 0.9, 30, 0x0c120c);
  b.cyl('m', 0.07, 0.09, 5.6, 0x2a2c30, { x: -16, y: 2.8, z: -12 }, 8);
  b.span('glow_street', -15.6, 5.32, -12.16, -15.1, 5.35, -11.84, 0xffb050);
}

function car(b: Batch, x: number, z: number): void {
  const paint = 0x5a1822;
  const L = 4.4;
  const W = 1.8;
  const xa = x - L / 2;
  const xb = x + L / 2;
  b.span('g', xa, 0.3, z - W / 2, xb, 0.82, z + W / 2, paint);
  // Tail fins, cabin with a dark glass band, roof.
  for (const s of [-1, 1]) b.span('g', xa - 0.05, 0.82, z + s * (W / 2) - (s > 0 ? 0.12 : 0), xa + 0.9, 0.95, z + s * (W / 2) + (s < 0 ? 0.12 : 0), paint);
  b.span('g', xa + 1.1, 0.82, z - 0.78, xb - 1.4, 0.88, z + 0.78, paint);
  b.span('g', xa + 1.15, 0.88, z - 0.76, xb - 1.45, 1.3, z + 0.76, 0x0a0d12);
  b.span('g', xa + 1.1, 1.3, z - 0.78, xb - 1.4, 1.38, z + 0.78, paint);
  b.span('c', xb - 0.02, 0.28, z - W / 2 + 0.05, xb + 0.08, 0.42, z + W / 2 - 0.05, C.chrome);
  b.span('c', xa - 0.08, 0.28, z - W / 2 + 0.05, xa + 0.02, 0.42, z + W / 2 - 0.05, C.chrome);
  b.span('c', xa + 0.2, 0.55, z - W / 2 - 0.01, xb - 0.2, 0.58, z + W / 2 + 0.01, C.chrome);
  for (const s of [-1, 1]) {
    b.cyl('m', 0.09, 0.09, 0.04, 0xcfcfc0, { x: xb + 0.01, y: 0.62, z: z + s * 0.6, rz: Math.PI / 2 }, 14);
    b.span('m', xa - 0.03, 0.6, z + s * 0.7 - 0.08, xa + 0.01, 0.76, z + s * 0.7 + 0.08, 0x4a0608);
    for (const wx of [xa + 0.85, xb - 0.9]) {
      b.cyl('m', 0.34, 0.34, 0.24, 0x0b0b0b, { x: wx, y: 0.34, z: z + s * (W / 2 - 0.08), rx: Math.PI / 2 }, 18);
      b.cyl('c', 0.17, 0.17, 0.02, C.chrome, { x: wx, y: 0.34, z: z + s * (W / 2 + 0.05), rx: Math.PI / 2 }, 14);
    }
  }
}
