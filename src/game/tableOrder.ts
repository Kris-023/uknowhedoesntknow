// Turn order at the table: counter-clockwise seen from above, starting top right. The maps do not
// share one seat layout (seat 1 is top right on most, bottom left on the hypertrain and the diner),
// so the order comes from where the seats really are, not from the seat numbers.
//
// "From above" is the x/z plane with x to the right and z towards the bottom of the picture (looking
// down -y, three.js is right-handed with y up). Counter-clockwise there means the angle
// atan2(-dz, dx) around the table centre grows; it starts at the +x axis, so top right comes first,
// then top left, bottom left, bottom right.

interface Pos {
  x: number;
  z: number;
}

/** Seat indices in turn order for these seat positions (index = seat number). */
export function tableOrder(seats: readonly Pos[]): number[] {
  if (!seats.length) return [];
  const cx = seats.reduce((s, p) => s + p.x, 0) / seats.length;
  const cz = seats.reduce((s, p) => s + p.z, 0) / seats.length;
  const turn = (p: Pos) => (Math.atan2(-(p.z - cz), p.x - cx) + 2 * Math.PI) % (2 * Math.PI);
  return seats.map((_, i) => i).sort((a, b) => turn(seats[a]) - turn(seats[b]));
}

/**
 * The order seats fill in as players join: seat 0, the seat across the table from it, then the seat
 * next to seat 0 and the one across from that. So the first two players face each other on every
 * map, and the second pair does too. "Across" comes from where the seats really are and which way
 * they look (`yaw`, 0 faces +z): the seat in front of seat 0 that looks back at it, the least off to
 * the side. Distance alone would pick the diagonal on a rectangular table. The maps number their
 * seats differently (hypertrain: 0 faces 2; the laundromat and others: 0 faces 1; the diner booth:
 * 0 faces 1 as well), so a fixed list of numbers cannot be right on all of them.
 */
export function fillOrder(seats: readonly (Pos & { yaw: number })[]): number[] {
  if (seats.length < 2) return seats.map((_, i) => i);
  const [first, ...others] = seats.map((s, i) => ({ s, i }));
  const fx = Math.sin(first.s.yaw);
  const fz = Math.cos(first.s.yaw);
  const view = (o: { s: Pos & { yaw: number } }) => {
    const dx = o.s.x - first.s.x;
    const dz = o.s.z - first.s.z;
    const along = dx * fx + dz * fz;
    const side = Math.abs(dx * fz - dz * fx);
    const facing = Math.sin(o.s.yaw) * fx + Math.cos(o.s.yaw) * fz < 0;
    return { along, side, facing, dist: Math.hypot(dx, dz) };
  };
  // In front of seat 0 and looking back at it, least to the side; failing that, simply the farthest.
  const across = [...others].sort((a, b) => {
    const va = view(a);
    const vb = view(b);
    const ok = (v: ReturnType<typeof view>) => (v.facing && v.along > 0 ? 0 : 1);
    return ok(va) - ok(vb) || (ok(va) === 0 ? va.side - vb.side : vb.dist - va.dist);
  })[0];
  // The rest: whoever sits nearer to seat 0 first, then its counterpart.
  const rest = others.filter((o) => o !== across).sort((a, b) => view(a).dist - view(b).dist);
  return [first, across, ...rest].map((o) => o.i);
}

// Until the world says otherwise: the hypertrain's seats, the default map.
let order = tableOrder([
  { x: -1.17, z: -0.45 },
  { x: -1.17, z: 0.45 },
  { x: 1.17, z: -0.45 },
  { x: 1.17, z: 0.45 },
]);

/** The world calls this with the map's seats whenever it builds a map (start and map change). */
export function setTableSeats(seats: readonly Pos[]): void {
  order = tableOrder(seats);
}

/** Comparator over seat indices: `players.sort((a, b) => byTableOrder(a.seat, b.seat))`. Unknown seats go last. */
export function byTableOrder(a: number, b: number): number {
  const rank = (s: number) => {
    const i = order.indexOf(s);
    return i < 0 ? order.length : i;
  };
  return rank(a) - rank(b);
}
