// The menu's form widgets in the HUD language (theme.css): a strip of tiles,
// a − value + counter, a row of chips, a text field. Each one registers its
// keyboard row in the `rows` list it is given (see keyRows.ts), so a screen
// built from them walks with the arrows in the order they were added. A tap
// on any element acts at once; the keyboard focus is only for the keyboard.
import { h, lazyImage, tappable } from './dom';
import type { KeyRow } from './keyRows';

export interface StripItem {
  id: string;
  label: string;
  image?: string;
  /** Shown but not pickable (a no-flag map in a flag mode). */
  disabled?: boolean;
}

/** Scrolls a strip so `tile` sits in its middle. */
export function scrollStripTo(strip: HTMLElement, tile: HTMLElement | undefined): void {
  if (tile != null) {
    strip.scrollLeft = Math.max(0, tile.offsetLeft - strip.clientWidth / 2 + tile.offsetWidth / 2);
  }
}

/** A captioned horizontal strip of tiles; one is selected. */
export function strip(rows: KeyRow[], title: string, items: StripItem[], current: string, onPick: (id: string) => void, tileClass = ''): HTMLElement {
  const el = h('div', { class: 'strip' });
  const tiles = new Map<string, HTMLElement>();
  let chosen = current;
  const select = (id: string): void => {
    chosen = id;
    onPick(id);
    for (const [tileId, tile] of tiles) tile.classList.toggle('is-selected', tileId === id);
  };
  for (const item of items) {
    const tile = h('div', { class: `tile ${tileClass} ${item.id === current ? 'is-selected' : ''} ${item.disabled ? 'is-disabled' : ''}` });
    tile.appendChild(item.image != null ? lazyImage(item.image) : h('div', { class: 'tile-art' }));
    tile.appendChild(h('div', { class: 'tile-label', text: item.label }));
    tappable(tile, () => {
      if (!item.disabled) select(item.id);
    });
    el.appendChild(tile);
    tiles.set(item.id, tile);
  }
  rows.push({
    kind: 'pick',
    elements: items.map((item) => tiles.get(item.id)!),
    scroller: el,
    selected: () => Math.max(0, items.findIndex((item) => item.id === chosen)),
    activate: (index) => {
      if (!items[index].disabled) select(items[index].id);
    },
  });
  requestAnimationFrame(() => scrollStripTo(el, tiles.get(current)));
  return h('div', { class: 'section' }, h('div', { class: 'caption', text: title }), el);
}

/** − value + in HUD icon buttons; Left/Right step it from the keyboard. */
export function counter(rows: KeyRow[], title: string, value: number, min: number, max: number, onChange: (value: number) => void, format: (value: number) => string = String): HTMLElement {
  let current = value;
  const readout = h('div', { class: 'chip chip-value', text: format(current) });
  const minus = h('div', { class: 'icon-btn', text: '−' });
  const plus = h('div', { class: 'icon-btn', text: '+' });
  const sync = (): void => {
    readout.textContent = format(current);
    minus.classList.toggle('is-off', current <= min);
    plus.classList.toggle('is-off', current >= max);
  };
  const bump = (delta: number): void => {
    const next = Math.max(min, Math.min(max, current + delta));
    if (next !== current) {
      current = next;
      onChange(current);
      sync();
    }
  };
  tappable(minus, () => bump(-1));
  tappable(plus, () => bump(1));
  sync();
  rows.push({ kind: 'step', element: readout, step: bump });
  return h('div', { class: 'opt' }, h('div', { class: 'caption', text: title }), h('div', { class: 'opt-row' }, minus, readout, plus));
}

/** A captioned row of chips; one is selected. */
export function chips<T extends string>(rows: KeyRow[], title: string, items: { id: T; label: string; cls?: string }[], current: T, onPick: (id: T) => void): HTMLElement {
  const row = h('div', { class: 'opt-row' });
  const els = new Map<T, HTMLElement>();
  let chosen: T = current;
  const select = (id: T): void => {
    chosen = id;
    onPick(id);
    for (const [chipId, el] of els) el.classList.toggle('is-selected', chipId === id);
  };
  for (const item of items) {
    const chip = h('div', { class: `chip chip-btn ${item.cls ?? ''} ${item.id === current ? 'is-selected' : ''}`, text: item.label });
    tappable(chip, () => select(item.id));
    row.appendChild(chip);
    els.set(item.id, chip);
  }
  rows.push({
    kind: 'pick',
    elements: items.map((item) => els.get(item.id)!),
    selected: () => Math.max(0, items.findIndex((item) => item.id === chosen)),
    activate: (index) => select(items[index].id),
  });
  return h('div', { class: 'opt' }, h('div', { class: 'caption', text: title }), row);
}

/** Arrow before the rectangular NEXT (24 px grid, stroked like the menu's speaker glyph). */
export const NEXT_ARROW_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';

/**
 * The rectangular NEXT the garage shows under its strips: pinned to the left
 * edge, DESKTOP widths only (theme.css `.menu-body .menu-next`; a phone has
 * the round one under the thumb). Registers a keyboard row only where it is
 * on screen, so the arrows never land on an invisible button.
 */
export function nextButton(rows: KeyRow[], parent: HTMLElement, onTap: () => void, label = 'NEXT'): HTMLElement {
  const next = h('div', { class: 'chip chip-btn chip-big is-selected menu-next' }, h('span', { class: 'menu-next-arrow', html: NEXT_ARROW_SVG }), h('span', { text: label }));
  tappable(next, onTap);
  // Appended here so the display check sees the media query (the parent is on screen).
  parent.appendChild(next);
  if (getComputedStyle(next).display !== 'none') {
    rows.push({ kind: 'pick', elements: [next], selected: () => 0, activate: onTap });
  }
  return next;
}

/** The same arrow pointing left, before the rectangular BACK. */
export const BACK_ARROW_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m11 6-6 6 6 6"/></svg>';

/**
 * The rectangular BACK and NEXT (DRIVE / PLAY) side by side under a step, the
 * grey BACK first: the step before, then the step's action. Desktop widths
 * only, like `nextButton` (theme.css `.menu-step-row`). One keyboard row with
 * both, the arrows starting on the action.
 */
export function stepButtons(rows: KeyRow[], parent: HTMLElement, onBack: () => void, onNext: () => void, label = 'NEXT'): HTMLElement {
  const back = h('div', { class: 'chip chip-btn chip-big menu-next menu-back' }, h('span', { class: 'menu-next-arrow', html: BACK_ARROW_SVG }), h('span', { text: 'BACK' }));
  tappable(back, onBack);
  const next = h('div', { class: 'chip chip-btn chip-big is-selected menu-next' }, h('span', { class: 'menu-next-arrow', html: NEXT_ARROW_SVG }), h('span', { text: label }));
  tappable(next, onNext);
  const row = h('div', { class: 'menu-step-row' }, back, next);
  parent.appendChild(row);
  if (getComputedStyle(row).display !== 'none') {
    rows.push({ kind: 'pick', elements: [back, next], selected: () => 1, activate: (index) => (index === 0 ? onBack() : onNext()) });
  }
  return row;
}

/**
 * The step button for the menu's TOP bar (the multiplayer step: CREATE / NEXT /
 * START / READY beside the title on a desktop, where the round one sits a
 * thumb's reach away). Hidden until `setStepChip` shows it; desktop widths
 * only (theme.css `.menu-top-next`). No keyboard row: the round button's row
 * already carries the same action for the arrows.
 */
export function stepChip(onTap: () => void): HTMLElement {
  const chip = h('div', { class: 'chip chip-btn menu-top-next' }, h('span', { class: 'menu-next-arrow', html: NEXT_ARROW_SVG }), h('span', { class: 'menu-top-next-label', text: 'NEXT' }));
  tappable(chip, onTap);
  return chip;
}

/** Shows the top-bar step chip with the step's label (green when the action is primary), or hides it. */
export function setStepChip(chip: HTMLElement, button: { label: string; primary: boolean } | null): void {
  chip.classList.toggle('is-on', button != null);
  if (button == null) return;
  chip.querySelector('.menu-top-next-label')!.textContent = button.label;
  chip.classList.toggle('is-selected', button.primary);
}

export interface TextFieldOptions {
  placeholder?: string;
  maxLength?: number;
  /** 'password' hides the text. */
  type?: 'text' | 'password';
  /** Widens the chip (theme.css `.chip-input-wide`). */
  wide?: boolean;
}

/**
 * A captioned text field in the chip style. From the keyboard, Enter or Space
 * on the focused field puts the caret in it; while the caret is there the
 * arrows edit the text, and Enter or Escape gives the arrows back to the menu.
 */
export function textField(rows: KeyRow[], title: string, value: string, onChange: (value: string) => void, options: TextFieldOptions = {}): HTMLElement {
  const input = h('input', {
    class: `chip chip-input ${options.wide ? 'chip-input-wide' : ''}`,
    attrs: { type: options.type ?? 'text', placeholder: options.placeholder ?? '', autocomplete: 'off', spellcheck: 'false', maxlength: String(options.maxLength ?? 32) },
  });
  input.value = value;
  input.addEventListener('input', () => onChange(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      input.blur();
    }
  });
  rows.push({ kind: 'pick', elements: [input], selected: () => 0, activate: () => input.focus() });
  return h('div', { class: 'opt' }, h('div', { class: 'caption', text: title }), input);
}
