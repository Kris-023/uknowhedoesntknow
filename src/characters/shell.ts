import * as THREE from 'three';

// Parametric surfaces for hair and beards. Everything is a grid over two parameters, so a style is a
// few functions (outline, radius) instead of a pile of spheres, and stays one mesh / one draw call.

/** Grid surface: `fn(u, v)` with u, v in [0, 1]. Outward when +u runs to the right of the viewer and +v runs down. */
export function surface(segU: number, segV: number, fn: (u: number, v: number) => THREE.Vector3): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= segV; j++) {
    for (let i = 0; i <= segU; i++) {
      const u = i / segU;
      const v = j / segV;
      const p = fn(u, v);
      pos.push(p.x, p.y, p.z);
      uv.push(u, 1 - v);
    }
  }
  const row = segU + 1;
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  weldNormals(g);
  return g;
}

/**
 * Average normals of vertices at the same spot (the wrap-around seam, the pole), otherwise a full
 * ring shows a hard shading line where it closes.
 */
function weldNormals(g: THREE.BufferGeometry): void {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const groups = new Map<string, number[]>();
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
    let a = groups.get(k);
    if (!a) groups.set(k, (a = []));
    a.push(i);
  }
  const s = new THREE.Vector3();
  for (const a of groups.values()) {
    if (a.length < 2) continue;
    s.set(0, 0, 0);
    for (const i of a) s.x += n.getX(i), s.y += n.getY(i), s.z += n.getZ(i);
    s.normalize();
    for (const i of a) n.setXYZ(i, s.x, s.y, s.z);
  }
}

/** Unit-sphere direction; phi 0 = front (+z), positive towards +x; theta 0 = top. */
export const dir = (phi: number, th: number, out = new THREE.Vector3()) =>
  out.set(Math.sin(phi) * Math.sin(th), Math.cos(th), Math.cos(phi) * Math.sin(th));

export interface ShellOpts {
  /** Azimuth range (see `dir`). */
  phi0: number;
  phi1: number;
  /** Polar range per azimuth. */
  th0: (phi: number) => number;
  th1: (phi: number) => number;
  /** Radius factor per point, 1 = on the unit sphere. */
  r?: (phi: number, th: number, d: THREE.Vector3, v: number) => number;
  /** Nothing goes below this height (unit space): keeps skull parts out of the open mouth. */
  minY?: number;
  segU: number;
  segV: number;
}

/** A patch of a (deformed) unit sphere between two outlines: hair caps, beard bands, stubble. */
export function shell(o: ShellOpts): THREE.BufferGeometry {
  const d = new THREE.Vector3();
  return surface(o.segU, o.segV, (u, v) => {
    const phi = o.phi0 + (o.phi1 - o.phi0) * u;
    const th = o.th0(phi) + (o.th1(phi) - o.th0(phi)) * v;
    dir(phi, th, d);
    const p = d.clone().multiplyScalar(o.r ? o.r(phi, th, d, v) : 1);
    if (o.minY !== undefined && p.y < o.minY) p.y = o.minY;
    return p;
  });
}

/** Smooth (cosine) interpolation through [x, y] pairs, x ascending; clamps at both ends. */
export function table(pts: readonly (readonly [number, number])[]): (x: number) => number {
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      if (x <= x1) {
        const [x0, y0] = pts[i - 1];
        const t = (1 - Math.cos(((x - x0) / (x1 - x0)) * Math.PI)) / 2;
        return y0 + (y1 - y0) * t;
      }
    }
    return pts[pts.length - 1][1];
  };
}

/** Tube along a curve whose radius follows `rad(t)`; THREE.TubeGeometry only knows one radius. */
export function taperedTube(curve: THREE.Curve<THREE.Vector3>, seg: number, radial: number, rad: (t: number) => number): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(seg, false);
  const c = new THREE.Vector3();
  return surface(radial, seg, (u, v) => {
    const i = Math.round(v * seg);
    curve.getPointAt(v, c);
    const a = -u * Math.PI * 2;
    const r = rad(v);
    return c
      .clone()
      .addScaledVector(frames.normals[i], Math.cos(a) * r)
      .addScaledVector(frames.binormals[i], Math.sin(a) * r);
  });
}
