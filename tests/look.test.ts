import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CUT_Y, faceWarp } from '../src/characters/face';
import { BEARDS, FACES, makeLook } from '../src/characters/look';
import { Person } from '../src/characters/person';
import { mulberry32 } from '../src/core/rng';
import { ITEM_IDS, ITEMS, OUTFITS } from '../src/characters/accessories';
import { parseLook, parseState } from '../src/net/protocol';

const old = {
  female: false,
  skin: 0xf0c9a5,
  hair: 'kurz',
  hairCol: 0x2b2118,
  top: 0x333a52,
  pants: 0x1b2030,
  shoes: 0xf1f1f1,
  hat: 0xe0782a,
  glasses: false,
  short: false,
};

describe('Look parsing', () => {
  it('maps the old beard flag to styles and defaults missing fields', () => {
    expect(parseLook({ ...old, beard: true })).toMatchObject({ beard: 'vollbart', face: 'oval', build: 'normal', topStyle: 'shirt', footwear: 'sneaker', acc: old.hat });
    expect(parseLook({ ...old, beard: false })?.beard).toBe('none');
    // Profiles from before the beard existed at all.
    expect(parseLook(old)?.beard).toBe('none');
  });

  it('keeps valid styles and drops unknown ones', () => {
    expect(parseLook({ ...old, beard: 'zwirbel', face: 'dorito' })).toMatchObject({ beard: 'zwirbel', face: 'dorito' });
    expect(parseLook({ ...old, beard: '<b>', face: 42 })).toMatchObject({ beard: 'none', face: 'oval' });
  });

  it('random looks round-trip and women get no beard', () => {
    for (let i = 0; i < 200; i++) {
      const L = makeLook(mulberry32(i));
      expect(parseLook(JSON.parse(JSON.stringify(L)))).toEqual(L);
      if (L.female) expect(L.beard).toBe('none');
    }
  });
});

describe('Face shapes', () => {
  it('keep the mouth plane flat, so skull and jaw still close seamlessly', () => {
    for (const face of FACES) {
      for (const female of [false, true]) {
        const w = faceWarp({ face, female });
        for (let a = 0; a < 12; a++) {
          const p = w(new THREE.Vector3(Math.sin(a) * 0.12, CUT_Y, Math.cos(a) * 0.13));
          expect(p.y).toBeCloseTo(CUT_Y, 6);
        }
      }
    }
  });

  it('every face and beard builds, and the skull still flips open', () => {
    for (const face of FACES) {
      for (const beard of BEARDS) {
        const p = new Person(new THREE.Group(), { ...makeLook(mulberry32(5)), female: false, face, beard }, 'sit');
        for (let i = 0; i < 12; i++) p.update(1 / 60, i / 60, 0, 0, 6, 1);
        expect(p.rig.mouth.rotation.x).toBeLessThan(-0.5);
      }
    }
  });
});

describe('Items and outfits', () => {
  it('old states without the new slots still load; unknown or misplaced items are dropped', () => {
    const s = parseState({ look: old, items: { head: 'gurke', hand: 'doener' } });
    expect(s?.items).toEqual({ head: 'gurke', hand: 'doener' });
    const t = parseState({ look: old, items: { floor: 'hund', neck: 'kette', body: 'gurke', head: 'laserschwert' } });
    expect(t?.items).toEqual({ floor: 'hund', neck: 'kette' });
  });

  it('the removed baseball bat is dropped from old saves and peers', () => {
    expect(parseState({ look: old, items: { hip: 'schlaeger', head: 'gurke' } })?.items).toEqual({ head: 'gurke' });
    expect('schlaeger' in ITEMS).toBe(false);
  });

  it('putting a hat on and off restyles the hair and keeps the other items', () => {
    const p = new Person(new THREE.Group(), { ...makeLook(mulberry32(4)), hair: 'irokese' }, 'stand');
    p.equip('kasten');
    p.equip('basecap');
    expect(p.items).toMatchObject({ head: 'basecap', floor: 'kasten' });
    p.unequip('head');
    expect(p.items).toEqual({ floor: 'kasten' });
  });

  it('validates the new clothing fields', () => {
    expect(parseLook({ ...old, topStyle: 'monogramm', footwear: 'sandalen', acc: 0xc2362f })).toMatchObject({ topStyle: 'monogramm', footwear: 'sandalen', acc: 0xc2362f });
    expect(parseLook({ ...old, topStyle: 'gucci', footwear: 1, acc: -5 })).toMatchObject({ topStyle: 'shirt', footwear: 'sneaker', acc: old.hat });
  });

  it('outfits only use known items in their own slots', () => {
    for (const o of OUTFITS) for (const [slot, id] of Object.entries(o.items)) expect(ITEMS[id!].slot).toBe(slot);
  });

  it('every item can be worn by every build, sitting and standing', () => {
    for (const build of ['duenn', 'xxl'] as const) {
      for (const pose of ['sit', 'stand'] as const) {
        const p = new Person(new THREE.Group(), { ...makeLook(mulberry32(9)), build }, pose);
        for (const id of ITEM_IDS) {
          p.equip(id);
          expect(p.items[ITEMS[id].slot]).toBe(id);
        }
        p.update(1 / 60, 1, 0, 0, 6, 0);
      }
    }
  });
});
