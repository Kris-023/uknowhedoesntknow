import { ITEM_IDS, ITEMS, OUTFITS, SLOT_LABEL, type ItemDef } from '../characters/accessories';
import type { Slot } from '../characters/rig';
import { ACCCOL, BEARDS, BUILDS, FACES, FOOTWEAR, HAIRCOL, HAIRSTYLES, HATCOL, makeLook, PANTCOL, SHOECOL, SKIN, TOPCOL, TOPSTYLES, type Beard, type Build, type FaceShape, type Footwear, type HairStyle, type Look, type TopStyle } from '../characters/look';
import type { PersonState } from '../characters/person';
import { randomState } from '../game/players';
import { NAME_MAX } from '../net/protocol';
import { el } from './dom';

const HAIR_LABEL: Record<HairStyle, string> = {
  kurz: 'Kurz',
  lang: 'Lang',
  dutt: 'Dutt',
  irokese: 'Irokese',
  locken: 'Locken',
  mittelscheitel: 'Mittelscheitel',
  glatze: 'Glatze',
  muetze: 'Mütze',
};

const BUILD_LABEL: Record<Build, string> = { duenn: 'Dünn', normal: 'Normal', kraeftig: 'Kräftig', xxl: 'XXL' };

const FACE_LABEL: Record<FaceShape, string> = {
  oval: 'Oval',
  rund: 'Rund',
  kantig: 'Kantig',
  herz: 'Herz',
  gestreckt: 'Gestreckt',
  laenglich: 'Länglich',
  dorito: 'Dorito',
};

const BEARD_LABEL: Record<Beard, string> = {
  none: 'Keiner',
  stoppeln: 'Stoppeln',
  schnurrbart: 'Schnurrbart',
  kinnbart: 'Kinnbart',
  vollbart: 'Vollbart',
  zwirbel: 'Zwirbel',
};

const TOPSTYLE_LABEL: Record<TopStyle, string> = {
  shirt: 'Shirt',
  trainingsjacke: 'Trainingsjacke',
  monogramm: 'Monogramm',
  ringel: 'Ringel',
  funktion: 'Funktionsjacke',
};

const FOOTWEAR_LABEL: Record<Footwear, string> = { sneaker: 'Sneaker', sandalen: 'Socken + Sandalen', schlappen: 'Badelatschen', hausschuhe: 'Hausschuhe' };

/** Accessory categories as tabs, so the long item lists stay manageable. */
const CATEGORIES: { label: string; slots: Slot[] }[] = [
  { label: 'Outfits', slots: [] },
  { label: 'Kopf', slots: ['head'] },
  { label: 'Hände', slots: ['hand', 'arm'] },
  { label: 'Körper', slots: ['neck', 'body'] },
  { label: 'Boden', slots: ['floor'] },
];

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * Name, look and accessories of your own character. Works on a copy and reports every change, so
 * the caller decides where it goes (preview, saved profile, network).
 */
export class CharacterEditor {
  readonly root = el('div', 'editor');
  private syncs: (() => void)[] = [];
  readonly nameInput: HTMLInputElement;

  constructor(
    private state: PersonState,
    private onChange: (s: PersonState) => void,
  ) {
    this.state = structuredClone(state);

    const nameRow = el('div', 'field');
    const nameLabel = el('label', 'field-label', 'Name');
    this.nameInput = el('input', 'text-input');
    Object.assign(this.nameInput, { id: `name-${Math.random().toString(36).slice(2, 7)}`, maxLength: NAME_MAX, placeholder: 'z. B. Kalle', autocomplete: 'nickname', spellcheck: false });
    this.nameInput.value = state.name;
    nameLabel.htmlFor = this.nameInput.id;
    this.nameInput.addEventListener('input', () => this.change({ name: this.nameInput.value }));
    nameRow.append(nameLabel, this.nameInput, el('span', 'field-hint', 'Steht über deinem Kopf. Leer lassen für einen Zufallsnamen.'));
    this.root.append(nameRow);

    const look = el('fieldset', 'group');
    look.append(el('legend', 'group-title', 'Aussehen'));
    look.append(
      this.seg('Körper', [['Männlich', false], ['Weiblich', true]] as const, () => this.state.look.female, (v) => this.look({ female: v })),
      this.seg('Statur', BUILDS.map((b) => [BUILD_LABEL[b], b] as const), () => this.state.look.build, (v) => this.look({ build: v })),
      this.swatches('Haut', SKIN, () => this.state.look.skin, (c) => this.look({ skin: c })),
      this.seg('Gesicht', FACES.map((v) => [FACE_LABEL[v], v] as const), () => this.state.look.face, (v) => this.look({ face: v })),
      this.seg('Frisur', HAIRSTYLES.map((h) => [HAIR_LABEL[h], h] as const), () => this.state.look.hair, (v) => this.look({ hair: v })),
      // The female body has no beard geometry.
      this.seg('Bart', BEARDS.map((v) => [BEARD_LABEL[v], v] as const), () => this.state.look.beard, (v) => this.look({ beard: v }), () => !this.state.look.female),
      this.swatches('Haarfarbe', HAIRCOL, () => this.state.look.hairCol, (c) => this.look({ hairCol: c }), () => this.state.look.hair !== 'muetze'),
      this.swatches('Mütze/Hut', HATCOL, () => this.state.look.hat, (c) => this.look({ hat: c }), () => this.state.look.hair === 'muetze' || this.tinted('hat')),
      this.swatches('Oberteil', TOPCOL, () => this.state.look.top, (c) => this.look({ top: c })),
      this.seg('Schnitt', TOPSTYLES.map((v) => [TOPSTYLE_LABEL[v], v] as const), () => this.state.look.topStyle, (v) => this.look({ topStyle: v })),
      this.swatches('Hose', PANTCOL, () => this.state.look.pants, (c) => this.look({ pants: c })),
      this.swatches('Schuhe', SHOECOL, () => this.state.look.shoes, (c) => this.look({ shoes: c })),
      this.seg('Schuhwerk', FOOTWEAR.map((v) => [FOOTWEAR_LABEL[v], v] as const), () => this.state.look.footwear, (v) => this.look({ footwear: v })),
      this.toggles(),
    );
    this.root.append(look);

    const acc = el('fieldset', 'group');
    acc.append(el('legend', 'group-title', 'Accessoires'));
    let cat = 0;
    const tabs = this.seg('Kategorie', CATEGORIES.map((c, i) => [c.label, i] as const), () => cat, (i) => {
      cat = i;
      this.sync();
    });
    acc.append(tabs);
    const outfits = el('div', 'row editor-outfits');
    for (const o of OUTFITS) {
      outfits.append(
        this.button(o.label, () => this.change({ look: { ...this.state.look, topStyle: o.topStyle, footwear: o.footwear }, items: { ...o.items } })),
      );
    }
    const outfitBox = el('div');
    outfitBox.append(outfits, el('span', 'field-hint', 'Setzt Schnitt, Schuhwerk und Accessoires. Deine Farben bleiben.'));
    acc.append(this.field('Outfit', outfitBox, () => cat === 0));
    CATEGORIES.forEach((c, i) => {
      for (const slot of c.slots) acc.append(this.slotRow(slot, () => cat === i));
    });
    // Bags, scarf, crate, dog collar and the like take this colour.
    acc.append(this.swatches('Accessoire-Farbe', ACCCOL, () => this.state.look.acc, (c) => this.look({ acc: c }), () => this.tinted('acc') || cat === 0));
    this.root.append(acc);

    const dice = el('div', 'row');
    dice.append(
      this.button('Aussehen würfeln', () => this.change({ look: makeLook(Math.random) })),
      this.button('Accessoires würfeln', () => this.change({ items: randomState(Math.random).items })),
    );
    this.root.append(dice);
    this.sync();
  }

  /** Name changed elsewhere (the play tab): take it over without reporting it back. */
  setName(name: string): void {
    this.state = { ...this.state, name };
    if (this.nameInput.value !== name) this.nameInput.value = name;
  }

  /** Placeholder shows the random name that is used when the field stays empty. */
  setFallbackName(name: string): void {
    this.nameInput.placeholder = name;
  }

  get value(): PersonState {
    return structuredClone(this.state);
  }

  private slotRow(slot: Slot, visible: () => boolean): HTMLElement {
    const opts = [['Nichts', ''] as const, ...ITEM_IDS.filter((id) => ITEMS[id].slot === slot).map((id) => [ITEMS[id].label, id] as const)];
    return this.seg(
      SLOT_LABEL[slot],
      opts,
      () => this.state.items[slot] ?? '',
      (id) => {
        const items = { ...this.state.items };
        if (id) items[slot] = id;
        else delete items[slot];
        this.change({ items });
      },
      visible,
    );
  }

  /** Is an equipped item tinted with this colour? Then its colour row shows. */
  private tinted(t: 'hat' | 'acc'): boolean {
    return Object.values(this.state.items).some((id) => id && (ITEMS[id] as ItemDef).tint === t);
  }

  private look(patch: Partial<Look>): void {
    this.change({ look: { ...this.state.look, ...patch } });
  }

  private change(patch: Partial<PersonState>): void {
    this.state = { ...this.state, ...patch };
    this.sync();
    this.onChange(this.value);
  }

  private sync(): void {
    for (const f of this.syncs) f();
  }

  private field(label: string, content: HTMLElement, visible?: () => boolean): HTMLElement {
    const row = el('div', 'field');
    const id = `lbl-${Math.random().toString(36).slice(2, 8)}`;
    const lab = el('span', 'field-label', label);
    lab.id = id;
    content.setAttribute('aria-labelledby', id);
    row.append(lab, content);
    if (visible) this.syncs.push(() => (row.hidden = !visible()));
    return row;
  }

  private seg<T>(label: string, opts: readonly (readonly [string, T])[], get: () => T, set: (v: T) => void, visible?: () => boolean): HTMLElement {
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'group');
    for (const [text, v] of opts) {
      const b = el('button', '', text);
      b.type = 'button';
      b.addEventListener('click', () => set(v));
      this.syncs.push(() => b.setAttribute('aria-pressed', String(get() === v)));
      seg.append(b);
    }
    return this.field(label, seg, visible);
  }

  private swatches(label: string, colors: readonly number[], get: () => number, set: (c: number) => void, visible?: () => boolean): HTMLElement {
    const box = el('div', 'swatches');
    box.setAttribute('role', 'group');
    colors.forEach((c, i) => {
      const b = el('button', 'swatch-btn');
      b.type = 'button';
      b.style.setProperty('--c', hex(c));
      b.setAttribute('aria-label', `${label} ${i + 1}`);
      b.addEventListener('click', () => set(c));
      this.syncs.push(() => b.setAttribute('aria-pressed', String(get() === c)));
      box.append(b);
    });
    return this.field(label, box, visible);
  }

  private toggles(): HTMLElement {
    const box = el('div', 'row');
    const flag = (text: string, key: 'glasses' | 'short', visible?: () => boolean) => {
      const b = el('button', 'btn toggle', text);
      b.type = 'button';
      b.addEventListener('click', () => this.look({ [key]: !this.state.look[key] }));
      this.syncs.push(() => {
        b.setAttribute('aria-pressed', String(this.state.look[key]));
        if (visible) b.hidden = !visible();
      });
      box.append(b);
    };
    flag('Brille', 'glasses');
    flag('Kurze Ärmel', 'short');
    return this.field('Extras', box);
  }

  private button(text: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'btn ghost', text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
}
