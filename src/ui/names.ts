import { NAME_MAX } from '../net/protocol';

// Fallback names for people who skip the name field: a Kotti-ish thing plus a number, short and neutral.
const THINGS = ['Taube', 'Möwe', 'Ente', 'Eule', 'Gurke', 'Pylone', 'Brezel', 'Kiwi', 'Späti', 'Döner', 'Ratte', 'Spatz', 'Mate', 'Bambus'];

export function randomName(r: () => number = Math.random): string {
  const thing = THINGS[Math.floor(r() * THINGS.length) % THINGS.length];
  const n = String(Math.floor(r() * 90) + 10);
  return `${thing} ${n}`.slice(0, NAME_MAX);
}
