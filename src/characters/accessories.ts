import * as THREE from 'three';
import { canvasTex } from '../scene/textures';
import { am, pp, texOnce } from './itemkit';
import type { Footwear, TopStyle } from './look';
import * as M from './memes';
import type { ItemCtx } from './memes';
import { part, UBOX, UCYL, USPH } from './parts';
import type { Slot } from './rig';

// Accessories: each one is a build() for one anchor slot. A new item is a new entry, nothing else.
// No brands, no real logos, no protected characters.

/** Per-frame animation hook, stored on the item's root (the chicken bobs its head). */
export type { ItemTick } from './memes';
import type { ItemTick } from './memes';

function gurke(): THREE.Group {
  // Modelled upright along +y, then laid flat across the head, slightly askew so it reads from the
  // front and from the side.
  const c = new THREE.Group();
  const m = am(0x3e8a2c, { roughness: 0.4 });
  pp(c, UCYL, m, 0, 0, 0, 0.055, 0.3, 0.055);
  pp(c, USPH, m, 0, 0, 0, 0.052, 0.04, 0.052);
  pp(c, USPH, m, 0, 0.3, 0, 0.047, 0.04, 0.047);
  pp(c, UCYL, am(0x244f1b), 0, 0.32, 0, 0.012, 0.035, 0.012);
  [0.07, 0.15, 0.23].forEach((y, i) => pp(c, USPH, am(0xa9d36a), i % 2 ? 0.05 : -0.045, y, 0.02, 0.01, 0.01, 0.01));
  c.position.y = -0.15;
  const g = new THREE.Group();
  const lie = new THREE.Group();
  lie.add(c);
  lie.rotation.set(0, 0.45, Math.PI / 2 + 0.06);
  // Its radius above the anchor (top of the hair), so it rests on the head instead of sinking in.
  lie.position.y = 0.045;
  g.add(lie);
  return g;
}

const coneGeo = new THREE.ConeGeometry(0.12, 0.3, 14).translate(0, 0.15, 0);
const coneBand = new THREE.CylinderGeometry(0.063, 0.087, 0.06, 14);
function pylone(): THREE.Group {
  const g = new THREE.Group();
  pp(g, coneGeo, am(0xff6a1a, { emissive: 0x2a0e00, roughness: 0.5 }), 0, 0, 0);
  pp(g, coneBand, am(0xf2f2f2, { emissive: 0x222222 }), 0, 0.13, 0);
  g.rotation.z = -0.08;
  return g;
}

const leafGeo = new THREE.ConeGeometry(0.022, 0.17, 5).translate(0, 0.085, 0);
function ananas(): THREE.Group {
  const g = new THREE.Group();
  const tex = texOnce('ananas', () =>
    canvasTex(64, 64, (x, w, h) => {
      x.fillStyle = '#d9a521';
      x.fillRect(0, 0, w, h);
      x.strokeStyle = '#8a5a12';
      x.lineWidth = 3;
      for (let i = -64; i < 128; i += 16) {
        x.beginPath();
        x.moveTo(i, 0);
        x.lineTo(i + 64, 64);
        x.stroke();
        x.beginPath();
        x.moveTo(i + 64, 0);
        x.lineTo(i, 64);
        x.stroke();
      }
    }),
  );
  pp(g, USPH, am(0xffffff, { map: tex, roughness: 0.6 }), 0, 0.12, 0, 0.1, 0.13, 0.1);
  for (let k = 0; k < 7; k++) {
    const l = pp(g, leafGeo, am(0x2f8a3a), 0, 0.24, 0);
    l.rotation.order = 'YXZ';
    l.rotation.y = (k / 7) * Math.PI * 2;
    l.rotation.x = k === 0 ? 0 : 0.5;
  }
  return g;
}

const beakGeo = new THREE.ConeGeometry(0.014, 0.04, 6);
const tailGeo = new THREE.ConeGeometry(0.03, 0.09, 5);
function huhn(): THREE.Group {
  const g = new THREE.Group();
  const w = am(0xf2f0ea, { roughness: 0.9 });
  const w2 = am(0xdedad0, { roughness: 0.9 });
  const red = am(0xd0322a);
  const orange = am(0xe8a23a);
  const eye = am(0x111111);
  pp(g, USPH, w, 0, 0.075, 0, 0.075, 0.07, 0.1);
  pp(g, UCYL, w, 0, 0.11, 0.07, 0.022, 0.08, 0.022);
  const hd = new THREE.Group();
  hd.position.set(0, 0.2, 0.085);
  g.add(hd);
  pp(hd, USPH, w, 0, 0, 0, 0.034, 0.034, 0.038);
  pp(hd, beakGeo, orange, 0, -0.004, 0.05).rotation.x = Math.PI / 2;
  pp(hd, USPH, red, 0, 0.035, -0.005, 0.012, 0.022, 0.03);
  pp(hd, USPH, red, 0, 0.03, 0.02, 0.012, 0.018, 0.012);
  pp(hd, USPH, red, 0, -0.025, 0.035, 0.01, 0.02, 0.01);
  for (const sx of [-1, 1]) {
    pp(hd, USPH, eye, sx * 0.03, 0.006, 0.02, 0.007, 0.007, 0.007);
    pp(g, USPH, w2, sx * 0.072, 0.08, -0.005, 0.018, 0.05, 0.075);
    pp(g, UCYL, orange, sx * 0.03, -0.065, 0.01, 0.007, 0.07, 0.007);
  }
  pp(g, tailGeo, w, 0, 0.115, -0.1).rotation.x = -0.9;
  const tick: ItemTick = (t) => {
    hd.position.z = 0.085 + 0.012 * Math.sin(t * 9);
    hd.position.y = 0.2 + 0.006 * Math.sin(t * 4.3);
    hd.rotation.y = 0.5 * Math.sin(t * 1.3);
  };
  g.userData.tick = tick;
  return g;
}

function doener(): THREE.Group {
  const g = new THREE.Group();
  pp(g, UCYL, am(0xb8bcc4, { metalness: 0.8, roughness: 0.3 }), 0, -0.04, 0, 0.05, 0.15, 0.045);
  pp(g, UCYL, am(0xd9b27a, { roughness: 0.8 }), 0, 0.11, 0, 0.056, 0.07, 0.05);
  for (const [c, x, y] of [[0x6bbf3a, -0.02, 0.19], [0xc2362f, 0.02, 0.2], [0xe8e2c8, 0, 0.185], [0x7a4a2a, 0, 0.215]]) {
    pp(g, USPH, am(c, { roughness: 0.8 }), x, y, 0.005, 0.03, 0.022, 0.026);
  }
  g.rotation.x = -0.25;
  return g;
}

function ente(): THREE.Group {
  const g = new THREE.Group();
  const y = am(0xffd21f, { emissive: 0x3a2e00, roughness: 0.4 });
  pp(g, USPH, y, 0, 0.05, 0, 0.06, 0.05, 0.075);
  pp(g, USPH, y, 0, 0.11, 0.05, 0.04, 0.04, 0.04);
  pp(g, UBOX, am(0xff8a1f), 0, 0.105, 0.095, 0.032, 0.012, 0.03);
  for (const sx of [-1, 1]) pp(g, USPH, am(0x111111), sx * 0.02, 0.122, 0.082, 0.007, 0.007, 0.007);
  return g;
}

const handleGeo = new THREE.TorusGeometry(0.075, 0.009, 6, 14, Math.PI);
function jute(): THREE.Group {
  const g = new THREE.Group();
  const tex = texOnce('jute', () =>
    canvasTex(128, 128, (x, w, h) => {
      x.fillStyle = '#c9a46a';
      x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(120,85,40,.35)';
      x.lineWidth = 1;
      for (let i = 0; i < w; i += 4) {
        x.beginPath();
        x.moveTo(i, 0);
        x.lineTo(i, h);
        x.stroke();
        x.beginPath();
        x.moveTo(0, i);
        x.lineTo(w, i);
        x.stroke();
      }
      x.fillStyle = '#2a2018';
      x.font = 'bold 22px sans-serif';
      x.textAlign = 'center';
      x.fillText('KOTTI', 64, 62);
      x.fillStyle = '#c2362f';
      x.beginPath();
      x.arc(54, 84, 9, 0, Math.PI * 2);
      x.arc(74, 84, 9, 0, Math.PI * 2);
      x.fill();
      x.beginPath();
      x.moveTo(45, 89);
      x.lineTo(64, 108);
      x.lineTo(83, 89);
      x.fill();
    }),
  );
  pp(g, UBOX, am(0xffffff, { map: tex, roughness: 0.95 }), 0, -0.22, 0, 0.25, 0.3, 0.08);
  for (const sz of [-1, 1]) pp(g, handleGeo, am(0x8a6a3a), 0, -0.07, sz * 0.03);
  return g;
}

const bagHandle = new THREE.TorusGeometry(0.07, 0.007, 5, 12, Math.PI);
function spaeti(): THREE.Group {
  const g = new THREE.Group();
  pp(g, UBOX, am(0xf4f6ff, { transparent: true, opacity: 0.45, roughness: 0.3 }), 0, -0.2, 0, 0.22, 0.3, 0.09);
  const glass = am(0x2f7a3c, { roughness: 0.2 });
  for (const sx of [-1, 1]) {
    pp(g, UCYL, glass, sx * 0.05, -0.33, 0, 0.032, 0.2, 0.032);
    pp(g, UCYL, glass, sx * 0.05, -0.14, 0, 0.013, 0.08, 0.013);
    pp(g, bagHandle, am(0xf4f6ff), sx * 0.04, -0.05, 0);
  }
  return g;
}

export interface ItemDef {
  slot: Slot;
  label: string;
  build: (c: ItemCtx) => THREE.Group;
  /** Which of the player's colours the item takes (shown in the editor while it is worn). */
  tint?: 'hat' | 'acc';
  /** A real hat: the hair is styled to fit under it (curls flattened, crest and beanie off). */
  underHat?: boolean;
}

export const ITEMS = {
  gurke: { slot: 'head', label: 'Gurke', build: gurke },
  pylone: { slot: 'head', label: 'Hütchen', build: pylone },
  ananas: { slot: 'head', label: 'Ananas', build: ananas },
  basecap: { slot: 'head', label: 'Basecap', build: M.basecap, tint: 'hat', underHat: true },
  aluhut: { slot: 'head', label: 'Aluhut', build: M.aluhut, underHat: true },
  uschanka: { slot: 'head', label: 'Uschanka', build: M.uschanka, tint: 'hat', underHat: true },
  barett: { slot: 'head', label: 'Baskenmütze', build: M.barett, tint: 'hat', underHat: true },
  rollerhelm: { slot: 'head', label: 'Rollerhelm', build: M.rollerhelm, tint: 'hat', underHat: true },
  zipfel: { slot: 'head', label: 'Zipfelmütze', build: M.zipfelmuetze, tint: 'hat', underHat: true },
  huhn: { slot: 'hand', label: 'Huhn', build: huhn },
  doener: { slot: 'hand', label: 'Döner', build: doener },
  ente: { slot: 'hand', label: 'Quietscheente', build: ente },
  baguette: { slot: 'hand', label: 'Baguette', build: M.baguette },
  espresso: { slot: 'hand', label: 'Espresso', build: M.espresso },
  pizza: { slot: 'hand', label: 'Pizzakarton', build: M.pizza },
  thermos: { slot: 'hand', label: 'Thermoskanne', build: M.thermos, tint: 'acc' },
  mate: { slot: 'hand', label: 'Mate', build: M.mate },
  energy: { slot: 'hand', label: 'Energydose', build: M.energy },
  wurst: { slot: 'hand', label: 'Bratwurst', build: M.bratwurst },
  lauch: { slot: 'hand', label: 'Lauch', build: M.lauch },
  kartoffel: { slot: 'hand', label: 'Kartoffel', build: M.kartoffel },
  sparschwein: { slot: 'hand', label: 'Sparschwein', build: M.sparschwein },
  pfand: { slot: 'hand', label: 'Pfandflasche', build: () => buildBottle() },
  jute: { slot: 'arm', label: 'Jutebeutel', build: jute },
  spaeti: { slot: 'arm', label: 'Späti-Tüte', build: spaeti },
  gelbersack: { slot: 'arm', label: 'Gelber Sack', build: M.gelberSack },
  kette: { slot: 'neck', label: 'Goldkette', build: M.goldkette },
  schal: { slot: 'neck', label: 'Fanschal', build: M.schal, tint: 'acc' },
  bauchtasche: { slot: 'body', label: 'Bauchtasche', build: M.bauchtasche, tint: 'acc' },
  umhaenge: { slot: 'body', label: 'Bauchtasche quer', build: M.umhaengetasche, tint: 'acc' },
  kasten: { slot: 'floor', label: 'Kasten Bier', build: M.kasten, tint: 'acc' },
  hund: { slot: 'floor', label: 'Golden Retriever', build: M.hund, tint: 'acc' },
  zwerg: { slot: 'floor', label: 'Gartenzwerg', build: M.gartenzwerg, tint: 'acc' },
  muell: { slot: 'floor', label: 'Mülltrennung', build: M.muell },
} satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
// 'hip' stays as an anchor and type (the bat used it) but has no items any more, so it is not offered,
// synced or rolled; old saves and peers that still send the bat simply lose it in parseState.
export const SLOTS: Slot[] = ['head', 'hand', 'arm', 'neck', 'body', 'floor'];
export const SLOT_LABEL: Record<Slot, string> = { head: 'Kopf', hand: 'Hand', arm: 'Arm', hip: 'Hose', neck: 'Hals', body: 'Bauch', floor: 'Boden' };
/** Chance per slot when rolling random items: the big costume pieces stay rare. */
export const SLOT_CHANCE: Record<Slot, number> = { head: 0.45, hand: 0.45, arm: 0.35, hip: 0.2, neck: 0.12, body: 0.12, floor: 0.12 };

/**
 * Outfit presets: set the clothing style and a set of items in one click. They never touch
 * colours, face or body, so the player's own choices stay.
 */
export interface Outfit {
  label: string;
  topStyle: TopStyle;
  footwear: Footwear;
  items: Partial<Record<Slot, ItemId>>;
}
export const OUTFITS: Outfit[] = [
  { label: 'Alltag', topStyle: 'shirt', footwear: 'sneaker', items: {} },
  { label: 'Talahon', topStyle: 'monogramm', footwear: 'sneaker', items: { head: 'basecap', neck: 'kette', body: 'umhaenge', hand: 'energy' } },
  { label: 'Genosse', topStyle: 'trainingsjacke', footwear: 'schlappen', items: { head: 'uschanka', hand: 'kartoffel' } },
  { label: 'Deutsch in a Nutshell', topStyle: 'funktion', footwear: 'sandalen', items: { body: 'bauchtasche', hand: 'thermos', floor: 'muell' } },
  { label: 'Italienisch', topStyle: 'shirt', footwear: 'sneaker', items: { head: 'rollerhelm', hand: 'espresso' } },
  { label: 'Französisch', topStyle: 'ringel', footwear: 'sneaker', items: { head: 'barett', hand: 'baguette' } },
  { label: 'Feierabend', topStyle: 'shirt', footwear: 'schlappen', items: { hand: 'mate', floor: 'kasten' } },
  { label: 'Schrebergarten', topStyle: 'funktion', footwear: 'hausschuhe', items: { head: 'zipfel', hand: 'lauch', floor: 'zwerg' } },
  { label: 'Gassi', topStyle: 'funktion', footwear: 'sneaker', items: { head: 'basecap', floor: 'hund' } },
  { label: 'Aluhut', topStyle: 'shirt', footwear: 'sandalen', items: { head: 'aluhut' } },
];

// Props for the passengers' activities. Not items: nobody picks them, the NPC's behaviour brings them.

/** Beer bottle (or can), held upright; also lies on the floor as a deposit bottle. */
export function buildBottle(can = false): THREE.Group {
  const g = new THREE.Group();
  if (can) {
    pp(g, UCYL, am(0xb8bcc4, { metalness: 0.7, roughness: 0.3 }), 0, -0.06, 0, 0.032, 0.13, 0.032);
    pp(g, UCYL, am(0xc2362f, { roughness: 0.5 }), 0, -0.02, 0, 0.0335, 0.045, 0.0335);
    return g;
  }
  const glass = am(0x5b3213, { roughness: 0.2, metalness: 0.1 });
  pp(g, UCYL, glass, 0, -0.06, 0, 0.032, 0.13, 0.032);
  pp(g, USPH, glass, 0, 0.07, 0, 0.027, 0.03, 0.027);
  pp(g, UCYL, glass, 0, 0.075, 0, 0.012, 0.09, 0.012);
  pp(g, UCYL, am(0xd4a82a, { metalness: 0.6, roughness: 0.3 }), 0, 0.163, 0, 0.015, 0.012, 0.015);
  // Plain label, no brand.
  pp(g, UCYL, am(0xe8dcb0, { roughness: 0.8 }), 0, -0.04, 0, 0.0335, 0.05, 0.0335);
  return g;
}

const screenGeo = new THREE.PlaneGeometry(0.06, 0.128);
/** Phone with a lit screen facing the holder; in the dark coach the screen glow lights the face a little. */
export function buildPhone(): THREE.Group {
  const g = new THREE.Group();
  pp(g, UBOX, am(0x101216, { roughness: 0.3 }), 0, 0.06, 0, 0.07, 0.145, 0.012);
  const sc = part(g, screenGeo, new THREE.MeshBasicMaterial({ color: 0x5f8fb8 }), 0, 0.06, -0.0075, undefined, undefined, undefined, 'light');
  sc.rotation.y = Math.PI;
  return g;
}

/** Newspaper held open in front of the chest. Fake columns, no masthead. */
export function buildNewspaper(): THREE.Group {
  const tex = texOnce('news', () =>
    canvasTex(128, 96, (x, w, h) => {
      x.fillStyle = '#d8d3c3';
      x.fillRect(0, 0, w, h);
      x.fillStyle = '#26262a';
      x.fillRect(6, 6, w - 12, 14);
      x.fillStyle = '#8c8878';
      x.fillRect(6, 24, 52, 38);
      x.fillStyle = '#3a3a40';
      for (let i = 0; i < 9; i++) x.fillRect(62, 26 + i * 4.2, 58, 1.6);
      for (let j = 0; j < 7; j++) x.fillRect(6, 66 + j * 3.8, w - 12, 1.4);
    }),
  );
  const g = new THREE.Group();
  pp(g, UBOX, am(0xffffff, { map: tex, roughness: 0.95, metalness: 0 }), 0, 0, 0, 0.5, 0.36, 0.008);
  g.position.set(0, 0.66, 0.5);
  g.rotation.x = -0.12;
  return g;
}
