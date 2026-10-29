import * as THREE from 'three';
import { hash01 } from '../../core/rng';
import { basic, group, std, tag } from '../../scene/build';
import { tiled } from '../../scene/textures';
import { Batch, UNIT_BOX, UNIT_CYL, UNIT_DISC, UNIT_PLANE } from './batch';
import { WS } from './config';
import { dryAngle, machineBusy, washAngle } from './schedule';
import type { WaschTextures } from './textures';

const R = WS.room;
const C = WS.colors;
const HALF_PI = Math.PI / 2;

interface Drum {
  /** Porthole centre, disc facing the room. */
  m: THREE.Matrix4;
  r: number;
  dryer: boolean;
  /** Machine number for its busy schedule and drum phase. */
  i: number;
  mesh: THREE.InstancedMesh;
  slot: number;
}

/** What the room hands back for per-frame animation. */
export interface Room {
  /** The imbalance washer; the map moves this group. */
  event: THREE.Group;
  eventDrum: THREE.Mesh;
  eventLed: THREE.MeshBasicMaterial;
  /** Where the event washer stands (front centre, on the floor), for heads turning to it. */
  eventPos: THREE.Vector3;
  tubes: { steady: THREE.MeshBasicMaterial; bad: THREE.MeshBasicMaterial; steadyHalo: THREE.MeshBasicMaterial; badHalo: THREE.MeshBasicMaterial; badPos: THREE.Vector3 };
  sign: { tube: THREE.MeshBasicMaterial; halo: THREE.MeshBasicMaterial };
  coinScreen: THREE.MeshBasicMaterial;
  rain: THREE.Texture[];
  drops: THREE.Texture;
  hands: { hour: THREE.Object3D; minute: THREE.Object3D };
  /** Per frame: drums and machine displays. */
  update(t: number, power: number, ledHdr: number): void;
  /** Turn the imbalance washer's laundry to `angle`. */
  spinEvent(angle: number): void;
}

const mats = () => ({
  enamel: std(C.enamel, { roughness: 0.35, metalness: 0.1 }),
  panel: std(C.panel, { roughness: 0.4, metalness: 0.3 }),
  chrome: std(C.chrome, { roughness: 0.25, metalness: 0.85 }),
  drum: std(C.drum, { roughness: 0.45, metalness: 0.6 }),
  kick: std(0x2a2d30, { roughness: 0.7 }),
  dark: std(C.frame, { roughness: 0.5, metalness: 0.4 }),
  chair: std(C.chair, { roughness: 0.45, metalness: 0 }),
  chairAlt: std(C.chairAlt, { roughness: 0.45, metalness: 0 }),
  table: std(C.table, { roughness: 0.5, metalness: 0 }),
  wood: std(0x7a5e40, { roughness: 0.7, metalness: 0 }),
  coin: std(C.coin, { roughness: 0.4, metalness: 0.5 }),
  basket: std(0x3d7fd0, { roughness: 0.6, metalness: 0 }),
  basketAlt: std(0xe2e2da, { roughness: 0.6, metalness: 0 }),
  towel: std(0xe9e4d8, { roughness: 0.95, metalness: 0 }),
  towelAlt: std(0x9a3b4a, { roughness: 0.95, metalness: 0 }),
  bottle: std(0x2aa59a, { roughness: 0.4, metalness: 0 }),
  glass: new THREE.MeshStandardMaterial({ color: C.glass, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.25, depthWrite: false }),
});
type Mats = ReturnType<typeof mats>;

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v = new THREE.Vector3();
const s = new THREE.Vector3();

/** base · T(p) · R(rot) · S(sc) */
function local(base: THREE.Matrix4, p: [number, number, number], sc: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0]): THREE.Matrix4 {
  m4.compose(v.set(...p), q.setFromEuler(e.set(...rot)), s.set(...sc));
  return new THREE.Matrix4().multiplyMatrices(base, m4);
}

const baseAt = (x: number, z: number, yaw: number, y = 0) => new THREE.Matrix4().compose(v.set(x, y, z), q.setFromEuler(e.set(0, yaw, 0)), s.set(1, 1, 1));

/** Plane with UVs repeating every `tile` metres, so merged walls keep their texture scale. */
function tiledPlane(w: number, h: number, tileW: number, tileH: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tileW, (uv.getY(i) * h) / tileH);
  return g;
}

const torusCache = new Map<number, THREE.TorusGeometry>();
const rimGeo = (r: number) => {
  let g = torusCache.get(r);
  if (!g) torusCache.set(r, (g = new THREE.TorusGeometry(r, WS.porthole.rim, 8, 32)));
  return g;
};

interface MachineOut {
  drum: THREE.Matrix4;
  r: number;
  led: THREE.Matrix4;
}

/**
 * One front-loader, front face at the local origin plane z = 0, body behind it. `glassB` takes the
 * transparent porthole glass (drawn after the drums).
 */
function machine(b: Batch, glassB: Batch, M: Mats, base: THREE.Matrix4, w: number, h: number, d: number, portY: number, r: number, dryer: boolean): MachineOut {
  b.addMatrix(UNIT_BOX, M.enamel, local(base, [0, h / 2, -d / 2], [w, h - 0.004, d]));
  const panelY = h - 0.07;
  b.addMatrix(UNIT_BOX, M.panel, local(base, [0, panelY, 0.006], [w - 0.02, 0.1, 0.014]));
  b.addMatrix(UNIT_BOX, M.kick, local(base, [0, 0.035, 0.004], [w - 0.02, 0.07, 0.01]));
  // Knob and a soap drawer (washers only).
  b.addMatrix(UNIT_CYL, M.chrome, local(base, [-w * 0.3, panelY, 0.02], [0.028, 0.025, 0.028], [HALF_PI, 0, 0]));
  if (!dryer) b.addMatrix(UNIT_BOX, M.panel, local(base, [w * 0.05, panelY, 0.016], [0.16, 0.06, 0.012]));
  // Recessed door: chrome ring, dark drum behind the glass, handle.
  b.addMatrix(rimGeo(r), M.chrome, local(base, [0, portY, 0.02]));
  b.addMatrix(UNIT_DISC, M.drum, local(base, [0, portY, 0.002], [r, r, 1]));
  b.addMatrix(UNIT_BOX, M.chrome, local(base, [r + 0.04, portY, 0.03], [0.03, 0.09, 0.02]));
  glassB.addMatrix(UNIT_DISC, M.glass, local(base, [0, portY, 0.026], [r, r, 1]));
  return { drum: local(base, [0, portY, 0.006]), r: r * 0.94, led: local(base, [w * 0.3, panelY, 0.0145], [0.09, 0.034, 1]) };
}

function chair(b: Batch, mat: THREE.Material, legs: THREE.Material, x: number, z: number, yaw: number): void {
  const base = baseAt(x, z, yaw);
  b.addMatrix(UNIT_BOX, mat, local(base, [0, 0.5, 0], [0.44, 0.05, 0.42]));
  b.addMatrix(UNIT_BOX, mat, local(base, [0, 0.79, -0.22], [0.42, 0.34, 0.03], [-0.14, 0, 0]));
  for (const [lx, lz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]])
    b.addMatrix(UNIT_CYL, legs, local(base, [lx, 0.24, lz], [0.013, 0.48, 0.013]));
  for (const lx of [-0.19, 0.19]) b.addMatrix(UNIT_CYL, legs, local(base, [lx, 0.63, -0.205], [0.012, 0.28, 0.012], [-0.14, 0, 0]));
}

export function buildRoom(root: THREE.Object3D, tex: WaschTextures, seed: number): Room {
  const M = mats();
  const b = new Batch();
  const glassB = new Batch();
  const W = R.right - R.left;
  const D = R.front - R.back;
  const cx = (R.left + R.right) / 2;
  const cz = (R.front + R.back) / 2;

  // --- Shell: floor, ceiling, walls (one textured material each). ---
  const floorMat = std(0xffffff, { map: tex.floor, roughness: 0.32, metalness: 0.15 });
  b.add(tiledPlane(W + 4, D, 1.2, 1.2), floorMat, [cx - 2, 0, cz], [1, 1, 1], [-HALF_PI, 0, 0]);
  const ceilMat = std(0xffffff, { map: tex.ceiling, roughness: 0.9, metalness: 0 });
  b.add(tiledPlane(W, D, 0.6, 0.6), ceilMat, [cx, R.height, cz], [1, 1, 1], [HALF_PI, 0, 0]);
  const wallMat = std(0xffffff, { map: tex.wall, roughness: 0.6, metalness: 0 });
  const H = R.height;
  b.add(tiledPlane(W, H, 1, H), wallMat, [cx, H / 2, R.back]);
  b.add(tiledPlane(W, H, 1, H), wallMat, [cx, H / 2, R.front], [1, 1, 1], [0, Math.PI, 0]);
  b.add(tiledPlane(D, H, 1, H), wallMat, [R.right, H / 2, cz], [1, 1, 1], [0, -HALF_PI, 0]);
  // Left wall: solid ends, a low sill and a lintel around the shop window.
  const [wz0, wz1] = WS.windowZ;
  for (const [z0, z1] of [[R.back, wz0], [wz1, R.front]]) b.add(tiledPlane(z1 - z0, H, 1, H), wallMat, [R.left, H / 2, (z0 + z1) / 2], [1, 1, 1], [0, HALF_PI, 0]);
  const sillH = 0.45;
  const lintel = 2.4;
  b.box(M.dark, R.left - 0.05, sillH / 2, (wz0 + wz1) / 2, 0.14, sillH, wz1 - wz0);
  b.box(M.dark, R.left - 0.05, (lintel + H) / 2, (wz0 + wz1) / 2, 0.14, H - lintel, wz1 - wz0);
  b.box(M.chrome, R.left + 0.03, sillH + 0.01, (wz0 + wz1) / 2, 0.08, 0.02, wz1 - wz0);
  for (let i = 0; i <= 4; i++) b.box(M.dark, R.left - 0.02, (sillH + lintel) / 2, wz0 + ((wz1 - wz0) * i) / 4, 0.08, lintel - sillH, 0.07);
  // Skirting boards hide the plane seams.
  b.box(M.kick, cx, 0.04, R.back + 0.01, W, 0.08, 0.02);
  b.box(M.kick, R.right - 0.01, 0.04, cz, 0.02, 0.08, D);

  // --- Window glass with drops, the vinyl lettering, outside street. ---
  const winH = lintel - sillH;
  const winMid = (wz0 + wz1) / 2;
  const glassMat = new THREE.MeshBasicMaterial({ color: 0xaac4dd, map: tex.drops, transparent: true, opacity: 0.35, depthWrite: false });
  const drops = glassMat.map!;
  drops.repeat.set(3, 1.4);
  const glass = tag(new THREE.Mesh(UNIT_PLANE, glassMat), 'fx');
  glass.scale.set(wz1 - wz0, winH, 1);
  glass.rotation.y = HALF_PI;
  root.add(Object.assign(glass, { name: 'window_glass' }));
  glass.position.set(R.left - 0.01, (sillH + lintel) / 2, winMid);
  const letters = tag(new THREE.Mesh(UNIT_PLANE, new THREE.MeshBasicMaterial({ map: tex.letters, transparent: true, depthWrite: false, color: 0x8a96a2 })), 'fx');
  letters.scale.set(3.4, 0.42, 1);
  letters.rotation.y = HALF_PI;
  letters.position.set(R.left + 0.005, 2.08, winMid + 0.4);
  root.add(letters);

  // Neon "24h", hung in the window facing the street.
  const signTube = new THREE.MeshBasicMaterial({ map: tex.sign, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: C.sign });
  const sign = tag(new THREE.Mesh(UNIT_PLANE, signTube), 'light');
  sign.scale.set(0.9, 0.45, 1);
  sign.rotation.y = HALF_PI;
  sign.position.set(R.left + 0.06, 1.62, -1.75);
  root.add(sign);
  const signHalo = new THREE.MeshBasicMaterial({ map: tex.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: C.sign, opacity: 0.5 });
  const sh = tag(new THREE.Mesh(UNIT_PLANE, signHalo), 'fx');
  sh.scale.set(1.5, 1.0, 1);
  sh.rotation.y = HALF_PI;
  sh.position.set(R.left + 0.08, 1.62, -1.75);
  root.add(sh);
  b.box(M.dark, R.left + 0.06, 2.05, -1.75, 0.01, 0.6, 0.005);

  const outside = group('outside', root);
  const street = tag(new THREE.Mesh(UNIT_PLANE, basic(0x9098a8, { map: tex.street })), 'outside');
  street.scale.set(15, 15 / (1024 / 384), 1);
  street.rotation.y = HALF_PI;
  street.position.set(-8.5, 15 / (1024 / 384) / 2 - 1.2, 0);
  outside.add(street);
  const roadMat = std(0x101216, { roughness: 0.18, metalness: 0.6 });
  b.add(UNIT_PLANE, roadMat, [-5.7, -0.12, 0], [5.8, 15, 1], [-HALF_PI, 0, 0]);
  b.add(UNIT_PLANE, std(0x2b2d31, { roughness: 0.7, metalness: 0 }), [-3.4, -0.02, 0], [1.2, 15, 1], [-HALF_PI, 0, 0]);
  // Street lamp: pole, arm, sodium head with a halo.
  b.box(M.dark, -4.3, 1.9, 1.6, 0.08, 3.8, 0.08);
  b.box(M.dark, -4.0, 3.78, 1.6, 0.6, 0.06, 0.06);
  const lampMat = basic(C.sodium);
  const lamp = tag(new THREE.Mesh(UNIT_BOX, lampMat), 'light');
  lamp.scale.set(0.34, 0.06, 0.16);
  lamp.position.set(-3.8, 3.72, 1.6);
  outside.add(lamp);
  const lampHalo = tag(new THREE.Mesh(UNIT_PLANE, new THREE.MeshBasicMaterial({ map: tex.glow, color: C.sodium, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending })), 'fx');
  lampHalo.scale.set(1.8, 1.8, 1);
  lampHalo.rotation.y = HALF_PI;
  lampHalo.position.set(-3.7, 3.55, 1.6);
  outside.add(lampHalo);
  // Lamp cone on the wet road.
  const pool = tag(new THREE.Mesh(UNIT_PLANE, new THREE.MeshBasicMaterial({ map: tex.glow, color: C.sodium, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })), 'fx');
  pool.scale.set(3.2, 4.5, 1);
  pool.rotation.x = -HALF_PI;
  pool.position.set(-4.2, -0.1, 1.6);
  outside.add(pool);

  // Rain: two layers at different depths and speeds, for parallax.
  const rain: THREE.Texture[] = [];
  for (const [x, rep, op] of [[-3.3, 3, 0.16], [-5.6, 5, 0.12]] as const) {
    const t = tiled(tex.rain, rep, rep * 0.35);
    rain.push(t);
    const m = tag(new THREE.Mesh(UNIT_PLANE, new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x9fb4d0 })), 'outside');
    m.scale.set(15, 5, 1);
    m.rotation.y = HALF_PI;
    m.position.set(x, 1.8, 0);
    outside.add(m);
  }

  // --- Machines. Right wall: washer with a dryer stacked on top, per column. ---
  const P = WS.porthole;
  const ST = WS.stack;
  const drumsRaw: { m: THREE.Matrix4; r: number; dryer: boolean }[] = [];
  const ledsRaw: THREE.Matrix4[] = [];
  const push = (o: MachineOut, dryer: boolean) => {
    drumsRaw.push({ m: o.drum, r: o.r, dryer });
    ledsRaw.push(o.led);
  };
  ST.z.forEach((z, col) => {
    // That column has only the imbalance washer (built below) and an empty slot above it.
    if (col === ST.eventCol) return;
    const base = baseAt(R.right - ST.depth, z, -HALF_PI);
    push(machine(b, glassB, M, base, ST.w, ST.washerH, ST.depth, 0.4, P.r, false), false);
    const top = baseAt(R.right - ST.depth, z, -HALF_PI, ST.washerH + 0.02);
    push(machine(b, glassB, M, top, ST.w, ST.dryerH, ST.depth, 0.37, P.r + 0.03, true), true);
  });
  // Back wall: two plain washers, two big dryers.
  const BK = WS.back;
  for (const x of [BK.washerX, BK.eventX]) push(machine(b, glassB, M, baseAt(x, R.back + ST.depth, 0), ST.w, ST.washerH, ST.depth, 0.4, P.r, false), false);
  for (const x of BK.dryerX) push(machine(b, glassB, M, baseAt(x, R.back + ST.depth, 0), 0.72, BK.bigDryerH, ST.depth, 0.52, P.r + 0.06, true), true);

  // Laundry discs: one instanced mesh per laundry texture, colours from the room seed.
  const laundryMats = tex.laundry.map((map) => new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0 }));
  const variant = drumsRaw.map((_, i) => Math.floor(hash01(seed, i, 61) * laundryMats.length) % laundryMats.length);
  const drumMeshes = laundryMats.map((mat, k) => {
    const n = variant.filter((x) => x === k).length;
    const im = tag(new THREE.InstancedMesh(UNIT_DISC, mat, Math.max(1, n)), 'prop');
    im.count = n;
    // Instances move every frame; the default bounding sphere would go stale.
    im.frustumCulled = false;
    im.name = `laundry_${k}`;
    root.add(im);
    return im;
  });
  const slots = laundryMats.map(() => 0);
  const drums: Drum[] = drumsRaw.map((d, i) => ({ ...d, i, mesh: drumMeshes[variant[i]], slot: slots[variant[i]]++ }));

  const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const leds = tag(new THREE.InstancedMesh(UNIT_PLANE, ledMat, ledsRaw.length), 'light');
  leds.frustumCulled = false;
  ledsRaw.forEach((m, i) => leds.setMatrixAt(i, m));
  const black = new THREE.Color(0);
  ledsRaw.forEach((_, i) => leds.setColorAt(i, black));
  root.add(leds);

  // The imbalance washer: its own little group so it can shake and walk.
  const evZ = ST.z[ST.eventCol];
  const evX = R.right - ST.depth;
  const event = group('event_washer', root);
  event.position.set(evX, 0, evZ);
  event.rotation.y = -HALF_PI;
  // A shelf over the gap where its dryer should be, with a forgotten bottle.
  b.box(M.wood, R.right - 0.18, 1.55, evZ, 0.32, 0.03, ST.w - 0.04);
  b.add(UNIT_CYL, M.bottle, [R.right - 0.2, 1.65, evZ + 0.12], [0.05, 0.18, 0.05]);
  const eb = new Batch();
  const eg = new Batch();
  const eo = machine(eb, eg, M, new THREE.Matrix4(), ST.w, ST.washerH, ST.depth, 0.4, P.r, false);
  eb.flush(event, 'event_body');
  const eventDrum = tag(new THREE.Mesh(UNIT_DISC, laundryMats[variant[0] ^ 1] ?? laundryMats[0]), 'prop');
  eventDrum.matrixAutoUpdate = false;
  event.add(eventDrum);
  const eventLed = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const el = tag(new THREE.Mesh(UNIT_PLANE, eventLed), 'light');
  el.matrixAutoUpdate = false;
  el.matrix.copy(eo.led);
  event.add(el);
  eg.flush(event, 'event_glass');
  const eventDrumBase = eo.drum;
  const eventR = eo.r;
  // A crumpled paper sign on top: somebody knew.
  const warn = tag(new THREE.Mesh(UNIT_BOX, std(0xf1eed8, { roughness: 0.9, metalness: 0 })), 'prop');
  warn.scale.set(0.22, 0.004, 0.16);
  warn.position.set(0.05, ST.washerH + 0.002, -0.25);
  warn.rotation.y = 0.3;
  event.add(warn);

  // --- Coin changer, notice board, wall clock. ---
  const coinZ = R.back + 0.18;
  b.box(M.coin, BK.coinX, 0.78, coinZ, 0.56, 1.56, 0.36);
  b.box(M.chrome, BK.coinX, 1.58, coinZ + 0.02, 0.58, 0.04, 0.4);
  const coinFace = tag(new THREE.Mesh(UNIT_PLANE, std(0xffffff, { map: tex.coin, roughness: 0.5, metalness: 0.2 })), 'struct');
  coinFace.scale.set(0.5, 1.0, 1);
  coinFace.position.set(BK.coinX, 0.95, coinZ + 0.181);
  root.add(coinFace);
  const coinScreen = new THREE.MeshBasicMaterial({ color: C.led });
  const cs = tag(new THREE.Mesh(UNIT_PLANE, coinScreen), 'light');
  cs.scale.set(0.22, 0.07, 1);
  cs.position.set(BK.coinX, 1.3, coinZ + 0.183);
  root.add(cs);

  const board = tag(new THREE.Mesh(UNIT_PLANE, std(0xffffff, { map: tex.board, roughness: 0.9, metalness: 0 })), 'prop');
  board.scale.set(1.12, 0.7, 1);
  board.position.set(BK.boardX, 1.78, R.back + 0.012);
  root.add(board);

  const clockGroup = group('wall_clock', root);
  clockGroup.position.set(1.05, 2.22, R.back + 0.03);
  const face = tag(new THREE.Mesh(UNIT_DISC, std(0xffffff, { map: tex.clock, roughness: 0.6, metalness: 0 })), 'prop');
  face.scale.setScalar(0.17);
  clockGroup.add(face);
  b.add(rimGeo(0.17), M.dark, [1.05, 2.22, R.back + 0.03]);
  const handMat = basic(0x111111);
  const mkHand = (len: number, wid: number) => {
    const pivot = new THREE.Group();
    const m = tag(new THREE.Mesh(UNIT_BOX, handMat), 'prop');
    m.scale.set(wid, len, 0.004);
    m.position.set(0, len / 2 - 0.01, 0.006);
    pivot.add(m);
    clockGroup.add(pivot);
    return pivot;
  };
  const hands = { hour: mkHand(0.09, 0.014), minute: mkHand(0.14, 0.009) };

  // --- Furniture: folding table, plastic chairs, folding counter, baskets. ---
  const T = WS.table;
  b.box(M.table, 0, T.h, 0, T.w, 0.035, T.l);
  b.box(M.dark, 0, T.h - 0.04, 0, T.w - 0.06, 0.04, T.l - 0.06);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) b.add(UNIT_CYL, M.chrome, [sx * (T.w / 2 - 0.06), T.h / 2, sz * (T.l / 2 - 0.08)], [0.016, T.h, 0.016]);
  // On the table: a box of washing powder, a paper cup, a stack of towels.
  b.box(std(0xe4a52b, { roughness: 0.7, metalness: 0 }), -0.12, T.h + 0.1, -0.72, 0.14, 0.18, 0.08, 0.4);
  b.add(UNIT_CYL, M.towel, [0.2, T.h + 0.06, 0.74], [0.035, 0.1, 0.035]);
  b.box(M.towelAlt, 0.12, T.h + 0.04, -0.15, 0.24, 0.05, 0.18, 0.1);
  b.box(M.towel, 0.12, T.h + 0.085, -0.15, 0.22, 0.04, 0.17, 0.15);

  const SE = WS.seat;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) chair(b, M.chair, M.chrome, sx * SE.x, sz * SE.z, sx < 0 ? HALF_PI : -HALF_PI);
  // Waiting chairs along the back wall (one taken by the phone guy) and one spare by the window.
  chair(b, M.chairAlt, M.chrome, BK.boardX - 0.25, R.back + 0.42, 0);
  chair(b, M.chair, M.chrome, BK.boardX + 0.3, R.back + 0.42, 0.15);
  chair(b, M.chairAlt, M.chrome, -1.95, -0.95, 1.2);

  const CO = WS.counter;
  const coX = R.left + CO.d / 2 + 0.05;
  const coLen = CO.z1 - CO.z0;
  b.box(M.wood, coX, CO.h - 0.02, (CO.z0 + CO.z1) / 2, CO.d, 0.04, coLen);
  b.box(M.dark, coX + 0.02, (CO.h - 0.04) / 2, (CO.z0 + CO.z1) / 2, CO.d - 0.08, CO.h - 0.04, coLen - 0.04);
  // Basket and folded piles on the counter; baskets on the floor.
  b.box(M.basket, coX - 0.02, CO.h + 0.11, CO.z1 - 0.4, 0.42, 0.22, 0.32, 0.1);
  b.box(M.towel, coX - 0.02, CO.h + 0.23, CO.z1 - 0.4, 0.36, 0.04, 0.26, 0.1);
  for (const [z, mat] of [[CO.z0 + 0.35, M.towelAlt], [CO.z0 + 0.62, M.towel]] as const)
    for (let k = 0; k < 3; k++) b.box(mat, coX, CO.h + 0.025 + k * 0.045, z, 0.3, 0.04, 0.24, 0.05 * k);
  b.box(M.basketAlt, 1.72, 0.13, 1.45, 0.45, 0.26, 0.34, 0.4);
  b.box(M.basket, -1.5, 0.13, 2.9, 0.45, 0.26, 0.34, -0.2);
  b.box(M.towelAlt, 1.72, 0.27, 1.45, 0.38, 0.04, 0.28, 0.5);
  // Detergent bottles on the big dryers (no labels, no brands).
  for (const [x, h] of [[1.7, 0.2], [1.8, 0.16]] as const) b.add(UNIT_CYL, M.bottle, [x, BK.bigDryerH + h / 2, R.back + 0.2], [0.05, h, 0.05]);

  // --- Ceiling neon: housings merged, tubes as two materials (steady and the bad one). ---
  const tubePos: [number, number][] = [[-1.5, -1.7], [-1.5, 1.5], [0, 0], [1.5, -1.6], [1.5, 1.4], [0, -2.6]];
  const steady = new THREE.MeshBasicMaterial({ color: C.tube });
  const bad = new THREE.MeshBasicMaterial({ color: C.tube });
  const tb = new Batch();
  const steadyHalo = new THREE.MeshBasicMaterial({ map: tex.glow, color: 0xcfe8ff, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending });
  const badHalo = steadyHalo.clone();
  tubePos.forEach(([x, z], i) => {
    b.box(M.panel, x, H - 0.03, z, 0.18, 0.05, 1.32);
    const isBad = i === WS.badTube;
    tb.add(UNIT_BOX, isBad ? bad : steady, [x, H - 0.075, z], [0.045, 0.045, 1.22], [0, 0, 0], 'light');
    tb.add(UNIT_PLANE, isBad ? badHalo : steadyHalo, [x, H - 0.008, z], [0.9, 1.9, 1], [HALF_PI, 0, 0], 'fx');
  });
  tb.flush(root, 'tubes');
  const [bx, bz] = tubePos[WS.badTube];

  b.flush(root, 'static');
  glassB.flush(root, 'portholes');

  const tmp = new THREE.Matrix4();
  const rot = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const col = new THREE.Color();
  const ledOn = new THREE.Color(C.led);
  const ledIdle = new THREE.Color(C.ledIdle);
  return {
    event,
    eventDrum,
    eventLed,
    eventPos: new THREE.Vector3(evX, 0.6, evZ),
    tubes: { steady, bad, steadyHalo, badHalo, badPos: new THREE.Vector3(bx, H - 0.1, bz) },
    sign: { tube: signTube, halo: signHalo },
    coinScreen,
    rain,
    drops,
    hands,
    update(t, power, ledHdr) {
      for (const d of drums) {
        if (!machineBusy(d.i, t, seed)) {
          d.mesh.setMatrixAt(d.slot, hidden);
          leds.setColorAt(d.i, col.copy(ledIdle).multiplyScalar(0.35 * power));
          continue;
        }
        const off = d.i * 3.7;
        const a = d.dryer ? dryAngle(t, off) : washAngle(t, off);
        rot.makeRotationZ(a).scale(s.set(d.r, d.r, 1));
        d.mesh.setMatrixAt(d.slot, tmp.multiplyMatrices(d.m, rot));
        // Dryers blink the display now and then; washers count down steadily.
        const blink = d.dryer && Math.sin(t * 2 + d.i) > 0.92 ? 0.3 : 1;
        leds.setColorAt(d.i, col.copy(ledOn).multiplyScalar(ledHdr * power * blink));
      }
      for (const m of drumMeshes) m.instanceMatrix.needsUpdate = true;
      leds.instanceColor!.needsUpdate = true;
    },
    spinEvent(angle) {
      rot.makeRotationZ(angle).scale(s.set(eventR, eventR, 1));
      eventDrum.matrix.multiplyMatrices(eventDrumBase, rot);
    },
  };
}
