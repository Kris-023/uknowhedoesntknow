# Styling Guide

All styling lives in one file, `src/style.css`; DOM is built in TypeScript with the helper `el()` from `src/ui/dom.ts`. Top-level rule: reference colours and fonts by token (`var(--amber)`), reuse the existing component classes below, and do NOT add a new look when one exists, so every screen stays uniform.

## Theme

Dark only (`color-scheme: dark`, no light theme). Tokens in `src/style.css` `:root`:

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#080b11` | page background |
| `--panel` | `rgba(14, 19, 28, 0.92)` | panels and overlays |
| `--line` | `#1f2837` | all borders and separators |
| `--fg` | `#e9edf5` | main text |
| `--fg2` | `#c3cad8` | secondary text |
| `--muted` | `#8b95a9` | labels, inactive |
| `--stage` | `#03050c` | behind the 3D canvas |
| `--amber` | `#ffb224` | active, selected, primary action |
| `--on-amber` | `#1a1204` | text on an amber fill |
| `--cyan` | `#4fd8ff` | "Meine Sicht" (debug view) only |
| `--ui` | `1` | UI scale, set from `src/ui/scale.ts`; overlays use `zoom: var(--ui)` |

Colours that have no token yet (verified hard-coded in `src/style.css`): danger `#ff8a7a`, ok `#9bff7a`, input background `#0e131c` (`.text-input`, `.select`), primary-button hover `#ffc24f` (`.btn.big:hover`). Reuse these exact values; if you need them more than once, add a token instead of a fourth copy.

Fonts come from Google Fonts in `index.html` and are tokens: `--font-display` (Big Shoulders Display, headings, uppercase), `--font-body` (Instrument Sans), `--font-mono` (JetBrains Mono, labels and numbers).

## Style rules

- Square corners: no `border-radius`. The only exception is the round gaze reticle (`.gaze-reticle`).
- 1px borders in `var(--line)`.
- Labels and buttons: mono font, uppercase, small (`font: 500 11px/1 var(--font-mono)`, letter-spacing `.06em`).
- Amber means active or selected. Do NOT use amber for decoration.
- All UI text is German.
- Responsive: the menu collapses its two columns at `max-width: 860px`, the debug panel docks to the bottom at `max-width: 700px` (`@media` blocks in `src/style.css`). Do NOT add further breakpoints without a need.

## Building DOM

```ts
import { el } from '../ui/dom';
const btn = el('button', 'btn', 'Freischalten'); // tag, class, text
```

Do NOT hand-roll `document.createElement` chains with `className` and `textContent` in UI code; use `el()` so it stays short and uniform. Text goes in via `textContent` (`el` does this), never `innerHTML` with user input (names and list items come from other players).

## Buttons and choices

- `.btn` — outlined amber button. Variants: `.btn.big` (filled amber primary), `.btn.ghost` (neutral), `.btn.danger` (red on hover), `.btn.big.danger` / `.btn.big.leave` (red outline), `.btn.small`, `.btn.toggle` with `aria-pressed` (muted when false).
- `.seg` — segmented control, buttons inside, selected one has `aria-pressed="true"`:

```ts
const seg = el('div', 'seg');
for (const o of options) {
  const b = el('button', undefined, o.label);
  b.setAttribute('aria-pressed', String(o.value === current));
  seg.append(b);
}
```

Do NOT style a pressed state with a custom class; use `aria-pressed`, the CSS keys off it.

Known issue (neutral note, fix planned): when a `.seg` wraps onto several lines, the rows get no horizontal separators and the first button of a new row draws a double left line (`.seg button + button` border plus the container border).

## Settings forms

- `.group` + `.group-title` — a titled section of a form.
- `.field` — a row, a two-column grid: `.field-label` left, the control right, optional `.field-hint` below the control. `.field.off` dims a row that does not apply (opacity .45).
- Controls: `.text-input` (`.text-input.code` for the mono room code), `.select`, `.slider` (input plus `output`), `.swatches` (colour choices, buttons with `.swatch-btn`; `.seg button.swatch` is a segmented button with a small colour dot).

```ts
const row = el('div', 'field');
row.append(el('span', 'field-label', 'Name'), el('input', 'text-input'));
```

## Menu and tabs

- `.menu` (full-screen overlay; `.menu.pause` for the Esc menu with blurred backdrop) contains `.menu-frame` (width per `data-tab`), `.menu-head` with `.tabs`/`.tab`, and `.menu-body` / `.menu-panel`; `.menu-me` is the side column.
- `.tabs.sub` — second-level tabs, smaller and wrapping.
- Tab buttons use `aria-selected`/active styling already in `.tab`; reuse, do not restyle.

## In-game overlays

- HUD of the games uses the `.wi-*` family (`.wi-bar`, `.wi-banner`, `.wi-board`, `.wi-maker`, `.wi-done`, `.wi-scores`). Per-game screens have their own prefixes (`.sa-*`, `.gg-*`, `.zd-*`, `.ah-*`, `.slf-*`); keep a new game's prefix unique.
- `.cards-layer` holds `.card-tag` word cards positioned over the 3D heads (`.card-tag.back` shows the hidden side).
- `.nametag` — floating name over a head (`.talking`, `.picked` states).
- `.mic` — microphone level indicator, bottom left (`.mic.warn` in danger colour).
- Overlays that cover the stage set `zoom: var(--ui)` and `z-index` explicitly; `body.locked .panel` dims the debug panel while the mouse is captured.
