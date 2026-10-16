// Keyboard rows of a menu screen (desktop debugging of the PWA, and anyone
// with a keyboard): the arrows only move the focus — Left/Right along the
// row, Up/Down to the line above/below inside a wrapped grid or to the
// neighbouring row — and Enter or Space is a TAP on the focused element. A
// tap (pointer) on an element acts at once and never needs the focus. A
// `step` row (a counter) steps on Left/Right instead.
export type KeyRow =
  | { kind: 'pick'; elements: HTMLElement[]; selected: () => number; activate: (index: number) => void; scroller?: HTMLElement }
  | { kind: 'step'; element: HTMLElement; step: (delta: number) => void };
