// Tracks the open-dialog stack so only the topmost panel claims
// `aria-modal="true"`. The stack is module-scoped (the renderer is
// single-window in this app) and ordered: the last entry is the top.

import { createSignal } from 'solid-js';

const [stack, setStack] = createSignal<readonly string[]>([]);

export function pushDialog(id: string): void {
  setStack((s) => (s.includes(id) ? s : [...s, id]));
}

export function popDialog(id: string): void {
  setStack((s) => s.filter((x) => x !== id));
}

export function topDialog(): string | null {
  const s = stack();
  return s.length === 0 ? null : s[s.length - 1];
}

export function isTopmost(id: string): boolean {
  const s = stack();
  return s.length > 0 && s[s.length - 1] === id;
}

/** For tests: empty the stack. Not exported to consumers under normal use. */
export function _resetForTests(): void {
  setStack([]);
}
