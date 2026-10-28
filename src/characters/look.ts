import { pick, type Rand } from '../core/rng';

export const HAIRSTYLES = ['kurz', 'lang', 'dutt', 'irokese', 'locken', 'muetze'] as const;
export type HairStyle = (typeof HAIRSTYLES)[number];

/** Body build, independent of male/female. 'xxl' spills over the seat on purpose. */
export const BUILDS = ['duenn', 'normal', 'kraeftig', 'xxl'] as const;
export type Build = (typeof BUILDS)[number];

export const SKIN = [0xf0c9a5, 0xc68f63, 0x8d5a3b, 0xe6b894] as const;
export const HAIRCOL = [0x2b2118, 0x111111, 0x5a3a1e, 0x8c6a2f, 0xb5532a, 0xcfcfcf, 0x2c5fd6, 0xd24c9a];
export const TOPCOL = [0x7a3f6b, 0x2f5d3a, 0x333a52, 0xb5532a, 0x2a4a7a, 0x5b4a36, 0x181818, 0xd9d4c4, 0xc2362f, 0x3a6f78];
export const PANTCOL = [0x1b2030, 0x20263a, 0x2b2b30, 0x181818, 0x3b3226];
export const SHOECOL = [0xf1f1f1, 0x1a1a1a, 0xc2362f, 0x8a6a3a];
export const HATCOL = [0xe0782a, 0x2c5fd6, 0x1a1a1a, 0xc2362f];

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
  beard: boolean;
  /** Short sleeves: forearms show skin. */
  short: boolean;
}

export function makeLook(r: Rand): Look {
  return {
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
    beard: r() < 0.25,
    short: r() < 0.3,
  };
}
