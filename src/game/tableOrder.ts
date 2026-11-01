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
