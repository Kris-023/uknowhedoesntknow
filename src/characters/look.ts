import { LOOKS } from '../config';
import { pick, type Rand } from '../core/rng';

export const HAIRSTYLES = ['kurz', 'lang', 'dutt', 'irokese', 'locken', 'muetze'] as const;
export type HairStyle = (typeof HAIRSTYLES)[number];

/** Body build, independent of male/female. 'xxl' spills over the seat on purpose. */
export const BUILDS = ['duenn', 'normal', 'kraeftig', 'xxl'] as const;
export type Build = (typeof BUILDS)[number];

/** Face shapes: the first four are realistic, the rest are jokes and come up rarer when rolling. */
export const FACES = ['oval', 'rund', 'kantig', 'herz', 'gestreckt', 'laenglich', 'dorito'] as const;
export type FaceShape = (typeof FACES)[number];
const REAL_FACES = ['oval', 'rund', 'kantig', 'herz'] as const;
const JOKE_FACES = ['gestreckt', 'laenglich', 'dorito'] as const;

/** Beard styles; 'zwirbel' (handlebar moustache) is the joke one. */
export const BEARDS = ['none', 'stoppeln', 'schnurrbart', 'kinnbart', 'vollbart', 'zwirbel'] as const;
export type Beard = (typeof BEARDS)[number];

/** Cut/print of the top. Patterns are grey-scale masks tinted with the chosen top colour. */
export const TOPSTYLES = ['shirt', 'trainingsjacke', 'monogramm', 'ringel', 'funktion'] as const;
export type TopStyle = (typeof TOPSTYLES)[number];

export const FOOTWEAR = ['sneaker', 'sandalen', 'schlappen', 'hausschuhe'] as const;
export type Footwear = (typeof FOOTWEAR)[number];

export const SKIN = [0xf0c9a5, 0xc68f63, 0x8d5a3b, 0xe6b894] as const;
export const HAIRCOL = [0x2b2118, 0x111111, 0x5a3a1e, 0x8c6a2f, 0xb5532a, 0xcfcfcf, 0x2c5fd6, 0xd24c9a];
export const TOPCOL = [0x7a3f6b, 0x2f5d3a, 0x333a52, 0xb5532a, 0x2a4a7a, 0x5b4a36, 0x181818, 0xd9d4c4, 0xc2362f, 0x3a6f78];
export const PANTCOL = [0x1b2030, 0x20263a, 0x2b2b30, 0x181818, 0x3b3226];
export const SHOECOL = [0xf1f1f1, 0x1a1a1a, 0xc2362f, 0x8a6a3a];
export const HATCOL = [0xe0782a, 0x2c5fd6, 0x1a1a1a, 0xc2362f, 0x2f5d3a, 0xd9d4c4, 0x5b4a36];
/** Colour for bags, scarves, crates and the like, so costume pieces follow the player's taste. */
export const ACCCOL = [0x1a1a1a, 0xc2362f, 0x2c5fd6, 0xd9a521, 0x2f5d3a, 0xe8e2d0, 0x7a3f6b, 0x8a6a3a];

/** Everything that defines how a person looks. Plain data, so it can be synced as-is in M3. */
export interface Look {
  female: boolean;
  build: Build;
  skin: number;
  hair: HairStyle;
  hairCol: number;
  top: number;
  pants: number;
  shoes: number;
  hat: number;
  glasses: boolean;
  beard: Beard;
  face: FaceShape;
  topStyle: TopStyle;
  footwear: Footwear;
  /** Accessory colour (bags, scarf, crate, ...). */
  acc: number;
  /** Short sleeves: forearms show skin. */
  short: boolean;
}

export function makeLook(r: Rand): Look {
  const look: Look = {
    female: r() < 0.5,
    // Mostly normal; the extremes are the jokes, so they stay rarer.
    build: pick(['normal', 'normal', 'normal', 'duenn', 'kraeftig', 'kraeftig', 'xxl'] as const, r),
    skin: pick(SKIN, r),
    hair: pick(HAIRSTYLES, r),
    hairCol: pick(HAIRCOL, r),
    top: pick(TOPCOL, r),
    pants: pick(PANTCOL, r),
    shoes: pick(SHOECOL, r),
    hat: pick(HATCOL, r),
    glasses: r() < 0.25,
    beard: r() < LOOKS.beardChance ? 'vollbart' : 'none',
    short: r() < 0.3,
    face: 'oval',
    topStyle: 'shirt',
    footwear: 'sneaker',
    acc: ACCCOL[0],
  };
  // Drawn after the older fields, so a seed keeps the rest of its look from before faces/beard styles.
  look.face = r() < LOOKS.jokeFaceChance ? pick(JOKE_FACES, r) : pick(REAL_FACES, r);
  if (look.beard !== 'none') look.beard = pick(['stoppeln', 'stoppeln', 'schnurrbart', 'kinnbart', 'vollbart', 'vollbart', 'zwirbel'] as const, r);
  if (look.female) look.beard = 'none';
  // Mostly plain shirts and sneakers; the costume pieces are for the editor and the odd passenger.
  if (r() < 0.25) look.topStyle = pick(TOPSTYLES, r);
  if (r() < 0.15) look.footwear = pick(FOOTWEAR, r);
  look.acc = pick(ACCCOL, r);
  return look;
}
