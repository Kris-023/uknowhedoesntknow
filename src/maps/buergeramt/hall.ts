import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boxGeo, std, tag, type Role } from '../../scene/build';
import { COLORS, COUNTERS, FIXTURES, FORM, HALL, LED, OFFICIAL, QUEUE, ROWS, YUCCA } from './config';
import { SCREEN_SIZE, SCREENS, SIGN_SIZE, SIGNS, type HallTextures, type Rect } from './textures';

/**
 * Collects static parts per material and merges them into one mesh each: the whole hall costs a
 * few dozen draw calls instead of hundreds of boxes.
 */
class Batch {
  private parts = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; role: Role }>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);

  add(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, role: Role = 'struct'): void {
    this.e.set(rx, ry, rz, 'YXZ');
    this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e), this.s);
    const g = geo.clone();
    g.applyMatrix4(this.m);
    let b = this.parts.get(mat);
    if (!b) this.parts.set(mat, (b = { geos: [], role }));
    b.geos.push(g);
  }

  box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): void {
    this.add(boxGeo(w, h, d), mat, x, y, z, ry, rx, rz);
  }

  flush(parent: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, b] of this.parts) {
      const mesh = tag(new THREE.Mesh(mergeGeometries(b.geos)!, mat), b.role);
      for (const g of b.geos) g.dispose();
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

/** Plane whose UVs repeat every `uw` × `uh` metres (texture set to RepeatWrapping). */
function tiledPlane(w: number, h: number, uw: number, uh: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / uw, (uv.getY(i) * h) / uh);
  return g;
}

/** Plane showing one pixel rect of a canvas atlas (canvas y down, texture v up). */
function atlasPlane(w: number, h: number, r: Rect, sw: number, sh = sw): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const [px, py, pw, ph] = r;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (px + uv.getX(i) * pw) / sw, 1 - (py + (1 - uv.getY(i)) * ph) / sh);
  }
  return g;
}

export interface Hall {
  /** Tube materials: lit ones share one, the flickering one has its own; the LED display face. */
  tubeOn: THREE.MeshBasicMaterial;
  tubeFlicker: THREE.MeshBasicMaterial;
  led: THREE.MeshBasicMaterial;
  screens: THREE.MeshBasicMaterial;
  exit: THREE.MeshBasicMaterial;
  /** Lit-by-the-room materials that also get a touch of self light, dimmed with the power. */
  night: THREE.MeshBasicMaterial;
  clock: { h: THREE.Object3D; m: THREE.Object3D; s: THREE.Object3D };
  bubble: THREE.Mesh;
}

export function buildHall(root: THREE.Object3D, tex: HallTextures, ledTex: THREE.Texture): Hall {
  const B = new Batch();
  const W = HALL.w / 2;
  const D = HALL.front - HALL.back;
  const midZ = (HALL.front + HALL.back) / 2;
  const mat = {
    floor: std(0xffffff, { map: tex.floor, roughness: 0.55, metalness: 0.05 }),
    wall: std(0xffffff, { map: tex.wall, roughness: 0.85, metalness: 0 }),
    ceiling: std(0x9a9a9a, { map: tex.ceiling, roughness: 0.95, metalness: 0 }),
    signs: std(0xffffff, { map: tex.signs, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }),
    chair: std(COLORS.chair, { roughness: 0.45, metalness: 0.05 }),
    metal: std(COLORS.chairMetal, { roughness: 0.4, metalness: 0.6 }),
    counter: std(COLORS.counter, { roughness: 0.6, metalness: 0.05 }),
    top: std(COLORS.counterTop, { roughness: 0.5, metalness: 0.05 }),
    dark: std(COLORS.darkPlastic, { roughness: 0.5, metalness: 0.1 }),
    door: std(COLORS.door, { roughness: 0.7, metalness: 0.05 }),
    white: std(0xcfccc2, { roughness: 0.5, metalness: 0.05 }),
    red: std(0x9c2018, { roughness: 0.45, metalness: 0.1 }),
    paper: std(0xe9e6dc, { roughness: 0.9, metalness: 0 }),
    leaf: std(0x3f6a2a, { roughness: 0.8, metalness: 0, side: THREE.DoubleSide }),
    leafDead: std(0x8a6a34, { roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
    trunk: std(0x6b5236, { roughness: 0.9, metalness: 0 }),
    belt: std(0x22305a, { roughness: 0.6, metalness: 0 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xb8d0d0, roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.18, depthWrite: false }),
    water: new THREE.MeshStandardMaterial({ color: 0x5a9ad8, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55, depthWrite: false }),
  };

  // --- Shell -------------------------------------------------------------------------------
  B.add(tiledPlane(HALL.w, D, 1, 1), mat.floor, 0, 0, midZ, 0, -Math.PI / 2);
  B.add(tiledPlane(HALL.w, D, 1.2, 1.2), mat.ceiling, 0, HALL.h, midZ, 0, Math.PI / 2);
  B.add(tiledPlane(HALL.w, HALL.h, 2, HALL.h), mat.wall, 0, HALL.h / 2, HALL.back);
  B.add(tiledPlane(HALL.w, HALL.h, 2, HALL.h), mat.wall, 0, HALL.h / 2, HALL.front, Math.PI);
  B.add(tiledPlane(D, HALL.h, 2, HALL.h), mat.wall, -W, HALL.h / 2, midZ, Math.PI / 2);
  B.add(tiledPlane(D, HALL.h, 2, HALL.h), mat.wall, W, HALL.h / 2, midZ, -Math.PI / 2);
  for (const s of [-1, 1]) B.box(0.02, 0.1, D, mat.dark, s * (W - 0.01), 0.05, midZ);
  B.box(HALL.w, 0.1, 0.02, mat.dark, 0, 0.05, HALL.front - 0.01);

  // --- Counters ------------------------------------------------------------------------------
  const cz = COUNTERS.z;
  const front = cz + 0.38;
  for (const [i, x] of COUNTERS.x.entries()) {
    B.box(2.2, 0.05, 0.8, mat.top, x, 0.76, cz);
    B.box(2.2, 1.05, 0.05, mat.counter, x, 0.525, front);
    B.box(2.2, 0.04, 0.28, mat.top, x, 1.07, front - 0.04);
    B.box(2.0, 0.8, 0.012, mat.glass, x, 1.55, front - 0.06);
    B.box(2.2, 0.06, 0.06, mat.metal, x, 1.98, front - 0.06);
    for (const s of [-1, 1]) B.box(0.05, 2.0, 0.95, mat.counter, x + s * 1.12, 1.0, cz - 0.1);
    B.add(atlasPlane(0.62, 0.23, SIGNS[`schalter${i + 1}` as 'schalter1'], SIGN_SIZE), mat.signs, x, 2.13, front - 0.02);
    B.box(0.66, 0.27, 0.02, mat.dark, x, 2.13, front - 0.04);
    // Monitor turned half towards the hall, so the waiting room sees its screen.
    const mx = x + (i === 2 ? -0.55 : 0.55);
    const my = i === 2 ? -0.9 : 0.9;
    B.box(0.06, 0.12, 0.06, mat.dark, mx, 0.84, cz - 0.05);
    B.box(0.52, 0.34, 0.04, mat.dark, mx, 1.07, cz - 0.05, my);
    // Clerk chair and a binder stack.
    B.box(0.44, 0.05, 0.42, mat.dark, x, 0.5, cz - 0.42);
    B.box(0.42, 0.45, 0.04, mat.dark, x, 0.8, cz - 0.64);
    B.box(0.06, 0.45, 0.06, mat.metal, x, 0.25, cz - 0.42);
    for (let k = 0; k < 3; k++) B.box(0.07, 0.3, 0.26, k === 1 ? mat.red : mat.belt, x - 0.85 + k * 0.08, 0.93, cz - 0.15);
  }
  // Closed: sign on the glass, roller blind halfway down.
  B.add(atlasPlane(0.5, 0.25, SIGNS.geschlossen, SIGN_SIZE), mat.signs, COUNTERS.x[COUNTERS.closed], 1.45, front - 0.075);
  B.box(2.0, 0.5, 0.02, mat.white, COUNTERS.x[COUNTERS.closed], 1.7, front - 0.1);

  // --- Waiting chairs --------------------------------------------------------------------------
  const zs = ROWS.chairZ;
  const len = zs[zs.length - 1] - zs[0] + 0.5;
  for (const s of [-1, 1]) {
    const rx = s * ROWS.x;
    for (const z of zs) {
      B.box(0.44, 0.04, 0.46, mat.chair, rx - s * 0.02, ROWS.seatTop - 0.02, z, 0, 0, 0);
      B.box(0.03, 0.42, 0.46, mat.chair, rx + s * 0.19, 0.78, z, 0, 0, -s * 0.1);
      B.box(0.12, 0.14, 0.05, mat.metal, rx + s * 0.02, 0.43, z);
    }
    B.box(0.06, 0.06, len, mat.metal, rx + s * 0.02, 0.35, 0);
    for (const z of [zs[0] - 0.1, zs[zs.length - 1] + 0.1]) {
      B.box(0.05, 0.33, 0.05, mat.metal, rx + s * 0.02, 0.17, z);
      B.box(0.5, 0.03, 0.07, mat.metal, rx + s * 0.02, 0.015, z);
    }
  }
  // A forgotten ticket under the chairs.
  B.box(0.06, 0.002, 0.12, mat.paper, 0.15, 0.002, 0.55, 0.4);

  // --- Queue barrier -------------------------------------------------------------------------
  const postGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.95, 10);
  const baseGeo = new THREE.CylinderGeometry(0.16, 0.17, 0.03, 16);
  const qz = [QUEUE.z[0] + 0.15, QUEUE.z[1], QUEUE.z[2] - 0.3];
  for (const s of [-1, 1]) {
    const px = QUEUE.x + s * 0.5;
    for (const z of qz) {
      B.add(postGeo, mat.metal, px, 0.475, z);
      B.add(baseGeo, mat.metal, px, 0.015, z);
    }
    B.box(0.012, 0.05, qz[0] - qz[2], mat.belt, px, 0.9, (qz[0] + qz[2]) / 2);
  }

  // --- Ticket dispenser ----------------------------------------------------------------------
  const tx = 1.5;
  const tz = -2.5;
  B.box(0.42, 1.25, 0.32, mat.red, tx, 0.625, tz);
  B.box(0.46, 0.06, 0.36, mat.dark, tx, 1.28, tz);
  B.box(0.3, 0.2, 0.012, mat.dark, tx, 1.06, tz + 0.162);
  B.box(0.14, 0.02, 0.04, mat.dark, tx, 0.84, tz + 0.17);
  B.box(0.05, 0.002, 0.12, mat.paper, tx, 0.84, tz + 0.21, 0, 0.5);
  B.box(0.03, 0.3, 0.03, mat.metal, tx, 1.46, tz);
  B.add(atlasPlane(0.56, 0.21, SIGNS.nummer, SIGN_SIZE), mat.signs, tx, 1.7, tz);
  // Pulled-and-dropped tickets around its foot.
  for (let k = 0; k < 7; k++) B.box(0.05, 0.002, 0.1, mat.paper, tx - 0.3 + ((k * 0.37) % 0.6), 0.002, tz + 0.25 + ((k * 0.23) % 0.35), k * 1.3);

  // --- Water dispenser ------------------------------------------------------------------------
  const wx = -4.62;
  const wz = 0.6;
  B.box(0.32, 1.0, 0.32, mat.white, wx, 0.5, wz);
  B.box(0.18, 0.12, 0.05, mat.dark, wx + 0.17, 0.82, wz);
  B.box(0.04, 0.05, 0.03, mat.metal, wx + 0.2, 0.74, wz);
  B.box(0.2, 0.02, 0.2, mat.dark, wx + 0.1, 0.3, wz);
  B.add(new THREE.CylinderGeometry(0.14, 0.14, 0.4, 18), mat.water, wx, 1.22, wz);
  B.add(new THREE.CylinderGeometry(0.04, 0.035, 0.24, 10), mat.white, wx - 0.08, 0.85, wz + 0.2);
  // A stack of paper cups, one on the floor.
  B.add(new THREE.CylinderGeometry(0.035, 0.025, 0.08, 10), mat.paper, 0.3, 0.04, -1.6);

  // --- Yucca, past its best -------------------------------------------------------------------
  {
    const yx = YUCCA.x;
    const yz = YUCCA.z;
    B.add(new THREE.CylinderGeometry(0.24, 0.18, 0.45, 16), mat.red, yx, 0.225, yz);
    B.add(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 16), mat.trunk, yx, 0.44, yz);
    // Tapered blade: the plane's top edge pinched to a point.
    const leafGeo = new THREE.PlaneGeometry(0.07, 0.55).translate(0, 0.275, 0);
    const lp = leafGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) if (lp.getY(i) > 0.3) lp.setX(i, 0);
    const trunks = [
      [0, 0.9, 0.05],
      [0.08, 1.3, -0.12],
      [-0.07, 1.55, 0.18],
    ] as const;
    let n = 0;
    for (const [dx, h, lean] of trunks) {
      B.add(new THREE.CylinderGeometry(0.045, 0.06, h, 8), mat.trunk, yx + dx + lean * 0.5, 0.45 + h / 2, yz, 0, 0, -lean);
      const top = 0.45 + h;
      const ox = yx + dx + lean;
      for (let k = 0; k < 11; k++) {
        const a = k * 2.4 + n;
        // Lower leaves droop and are dead; only a tuft on top still tries.
        const dead = k < 3;
        const droop = dead ? 2.1 + (k % 3) * 0.25 : 0.35 + (k % 4) * 0.28;
        B.add(leafGeo, dead ? mat.leafDead : mat.leaf, ox, top - (k < 5 ? 0.04 : 0), yz, a, 0, droop, 'prop');
      }
      n += 1.1;
    }
    for (let k = 0; k < 4; k++) B.add(leafGeo, mat.leafDead, yx - 0.35 + k * 0.17, 0.004, yz + 0.3 - k * 0.11, k * 1.9, -Math.PI / 2, 0, 'prop');
  }

  // --- Form desk -------------------------------------------------------------------------------
  {
    const fz = FORM.z + 0.42;
    B.box(0.9, 0.04, 0.5, mat.top, FORM.x, 1.05, fz);
    B.box(0.06, 1.03, 0.06, mat.metal, FORM.x, 0.515, fz);
    B.box(0.5, 0.03, 0.4, mat.metal, FORM.x, 0.015, fz);
    B.box(0.22, 0.06, 0.3, mat.paper, FORM.x + 0.3, 1.1, fz);
    B.add(atlasPlane(0.21, 0.27, SIGNS.form, SIGN_SIZE), mat.signs, FORM.x - 0.02, 1.072, fz - 0.06, Math.PI + 0.15, -Math.PI / 2);
    // Pen on a chain: the one thing here that is secured.
    B.box(0.006, 0.006, 0.3, mat.metal, FORM.x - 0.2, 1.074, fz + 0.05, 0.6);
    // Crumpled attempts.
    for (let k = 0; k < 5; k++) B.add(boxGeo(0.06, 0.05, 0.055), mat.paper, FORM.x - 0.4 + k * 0.17, 0.025, fz + 0.35 - (k % 2) * 0.2, k * 0.9, k * 0.5, k * 0.7);
  }

  // --- Doors, the official's two targets, and the emergency exit ----------------------------
  const door = (x: number, z: number, ry: number, sign?: Rect) => {
    const nx = Math.sin(ry);
    const nz = Math.cos(ry);
    B.box(1.1, 2.2, 0.05, mat.dark, x, 1.1, z, ry);
    B.box(0.95, 2.1, 0.06, mat.door, x + nx * 0.01, 1.05, z + nz * 0.01, ry);
    B.box(0.14, 0.03, 0.05, mat.metal, x + nx * 0.06 + nz * 0.36, 1.02, z + nz * 0.06 - nx * 0.36, ry);
    if (sign) B.add(atlasPlane(0.42, 0.13, sign, SIGN_SIZE), mat.signs, x + nx * 0.045, 1.62, z + nz * 0.045, ry);
  };
  door(-W, OFFICIAL.z[0], Math.PI / 2, SIGNS.personal);
  door(-W, OFFICIAL.z[1], Math.PI / 2, SIGNS.leitung);
  door(W, -2.4, -Math.PI / 2);
  door(1.6, HALL.front, Math.PI);

  // --- Posters, clock face -------------------------------------------------------------------
  const poster = (r: Rect, x: number, z: number, ry: number, y = 1.55) => B.add(atlasPlane(0.48, 0.675, r, SIGN_SIZE), mat.signs, x, y, z, ry);
  poster(SIGNS.handy, -W + 0.01, -0.9, Math.PI / 2);
  poster(SIGNS.wartezeit, -W + 0.01, 1.35, Math.PI / 2, 1.6);
  poster(SIGNS.formular, W - 0.01, -1.15, -Math.PI / 2);
  poster(SIGNS.ziehen, -1.4, HALL.front - 0.01, Math.PI);
  const clockPos = new THREE.Vector3(-4.35, 2.35, HALL.back + 0.04);
  B.add(new THREE.CylinderGeometry(0.23, 0.23, 0.05, 32), mat.dark, clockPos.x, clockPos.y, clockPos.z - 0.015, 0, Math.PI / 2);
  B.add(atlasPlane(0.42, 0.42, SIGNS.clock, SIGN_SIZE), mat.signs, clockPos.x, clockPos.y, clockPos.z + 0.012);

  // --- Fixtures ----------------------------------------------------------------------------
  const tubeOn = new THREE.MeshBasicMaterial({ color: COLORS.tube });
  const tubeFlicker = new THREE.MeshBasicMaterial({ color: COLORS.tube });
  const tubeOff = std(0x9a9a92, { roughness: 0.5, metalness: 0.1 });
  for (const f of FIXTURES) {
    B.box(0.42, 0.05, 1.32, mat.metal, f.x, HALL.h - 0.025, f.z);
    for (const dx of [-0.09, 0.09]) {
      const m = f.state === 'on' ? tubeOn : f.state === 'flicker' ? tubeFlicker : tubeOff;
      B.add(boxGeo(0.05, 0.03, 1.22), m, f.x + dx, HALL.h - 0.065, f.z, 0, 0, 0, 'light');
    }
  }

  // --- Self-lit things ----------------------------------------------------------------------
  const screens = new THREE.MeshBasicMaterial({ map: tex.screenOk });
  for (const [i, x] of COUNTERS.x.entries()) {
    if (i === COUNTERS.closed) continue;
    const mx = x + (i === 2 ? -0.55 : 0.55);
    const my = i === 2 ? -0.9 : 0.9;
    B.add(atlasPlane(0.47, 0.3, SCREENS.monitor, SCREEN_SIZE[0], SCREEN_SIZE[1]), screens, mx + Math.sin(my) * 0.021, 1.08, cz - 0.05 + Math.cos(my) * 0.021, my, 0, 0, 'light');
  }
  B.add(atlasPlane(0.28, 0.14, SCREENS.ticket, SCREEN_SIZE[0], SCREEN_SIZE[1]), screens, tx, 1.06, tz + 0.17, 0, 0, 0, 'light');
  // Info screen on the right wall beside the queue.
  B.box(0.06, 0.5, 0.82, mat.dark, W - 0.03, 2.0, -3.4);
  B.add(atlasPlane(0.76, 0.44, SCREENS.monitor, SCREEN_SIZE[0], SCREEN_SIZE[1]), screens, W - 0.065, 2.0, -3.4, -Math.PI / 2, 0, 0, 'light');

  // Hung from the ceiling in front of the counters, so the Schalter signs never cover it from the chairs.
  const led = new THREE.MeshBasicMaterial({ map: ledTex, color: 0xffffff });
  B.box(1.72, 0.68, 0.12, mat.dark, 0, LED.y, LED.z);
  B.add(new THREE.PlaneGeometry(1.6, 0.6), led, 0, LED.y, LED.z + 0.062, 0, 0, 0, 'light');
  for (const s of [-1, 1]) B.box(0.02, HALL.h - LED.y - 0.34, 0.02, mat.metal, s * 0.6, (HALL.h + LED.y + 0.34) / 2, LED.z);

  const exit = new THREE.MeshBasicMaterial({ map: tex.exit, color: 0xffffff });
  B.box(0.06, 0.2, 0.5, mat.white, W - 0.03, 2.42, -2.4);
  B.add(new THREE.PlaneGeometry(0.46, 0.17), exit, W - 0.062, 2.42, -2.4, -Math.PI / 2, 0, 0, 'light');

  const night = new THREE.MeshBasicMaterial({ map: tex.night, color: 0xffffff });
  for (const z of [0.4, 2.2]) {
    B.box(0.08, 1.4, 1.3, mat.dark, W - 0.03, 1.65, z);
    B.add(new THREE.PlaneGeometry(1.2, 1.3), night, W - 0.072, 1.65, z, -Math.PI / 2, 0, 0, 'outside');
  }
  B.flush(root);

  // Clock hands move, so they stay separate meshes (three draw calls).
  const handMat = std(0x111111, { roughness: 0.5, metalness: 0.2 });
  const hand = (w: number, l: number, z: number, m: THREE.Material = handMat) => {
    const pivot = new THREE.Group();
    pivot.position.copy(clockPos).setZ(clockPos.z + 0.015 + z);
    const g = new THREE.Mesh(boxGeo(w, l, 0.005), m);
    g.position.y = l / 2 - 0.02;
    pivot.add(tag(g, 'prop'));
    root.add(pivot);
    return pivot;
  };
  const clock = { h: hand(0.022, 0.12, 0), m: hand(0.014, 0.17, 0.005), s: hand(0.005, 0.18, 0.01, std(0xb02020, { roughness: 0.5 })) };

  // A bubble that rises in the water bottle when it glugs.
  const bubble = tag(new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.6 })), 'fx');
  bubble.position.set(wx, 1.05, wz);
  bubble.visible = false;
  root.add(bubble);

  return { tubeOn, tubeFlicker, led, screens, exit, night, clock, bubble };
}
