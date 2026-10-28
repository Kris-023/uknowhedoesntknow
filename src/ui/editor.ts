import { ITEM_IDS, ITEMS, SLOT_LABEL, SLOTS } from '../characters/accessories';
import { BUILDS, HAIRCOL, HAIRSTYLES, HATCOL, makeLook, PANTCOL, SHOECOL, SKIN, TOPCOL, type Build, type HairStyle, type Look } from '../characters/look';
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
  muetze: 'Mütze',
};

const BUILD_LABEL: Record<Build, string> = { duenn: 'Dünn', normal: 'Normal', kraeftig: 'Kräftig', xxl: 'XXL' };

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
      this.seg('Frisur', HAIRSTYLES.map((h) => [HAIR_LABEL[h], h] as const), () => this.state.look.hair, (v) => this.look({ hair: v })),
      this.swatches('Haarfarbe', HAIRCOL, () => this.state.look.hairCol, (c) => this.look({ hairCol: c }), () => this.state.look.hair !== 'muetze'),
      this.swatches('Mütze', HATCOL, () => this.state.look.hat, (c) => this.look({ hat: c }), () => this.state.look.hair === 'muetze'),
      this.swatches('Oberteil', TOPCOL, () => this.state.look.top, (c) => this.look({ top: c })),
      this.swatches('Hose', PANTCOL, () => this.state.look.pants, (c) => this.look({ pants: c })),
      this.swatches('Schuhe', SHOECOL, () => this.state.look.shoes, (c) => this.look({ shoes: c })),
      this.toggles(),
    );
    this.root.append(look);

    const acc = el('fieldset', 'group');
    acc.append(el('legend', 'group-title', 'Accessoires'));
    for (const slot of SLOTS) {
      const opts = [['Nichts', ''] as const, ...ITEM_IDS.filter((id) => ITEMS[id].slot === slot).map((id) => [ITEMS[id].label, id] as const)];
      acc.append(
        this.seg(SLOT_LABEL[slot], opts, () => this.state.items[slot] ?? '', (id) => {
          const items = { ...this.state.items };
          if (id) items[slot] = id;
          else delete items[slot];
          this.change({ items });
        }),
      );
    }
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

  private seg<T>(label: string, opts: readonly (readonly [string, T])[], get: () => T, set: (v: T) => void): HTMLElement {
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'group');
    for (const [text, v] of opts) {
      const b = el('button', '', text);
      b.type = 'button';
      b.addEventListener('click', () => set(v));
      this.syncs.push(() => b.setAttribute('aria-pressed', String(get() === v)));
      seg.append(b);
    }
    return this.field(label, seg);
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
    const flag = (text: string, key: 'glasses' | 'beard' | 'short', visible?: () => boolean) => {
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
    // The female body has no beard geometry.
    flag('Bart', 'beard', () => !this.state.look.female);
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
