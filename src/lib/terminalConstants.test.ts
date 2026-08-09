import { describe, expect, it } from 'vitest';

import { TERMINAL_SCROLL_OPTIONS } from './terminalConstants';

describe('terminal scroll options', () => {
  it('uses practical defaults for normal and accelerated wheel scrolling', () => {
    expect(TERMINAL_SCROLL_OPTIONS).toEqual({
      scrollback: 10_000,
      scrollSensitivity: 4,
      fastScrollSensitivity: 5,
    });
  });
});
