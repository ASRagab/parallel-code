import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initShortcuts, registerZoomShortcuts } from './shortcuts';

type KeyboardEventStub = Pick<
  KeyboardEvent,
  | 'altKey'
  | 'ctrlKey'
  | 'key'
  | 'metaKey'
  | 'preventDefault'
  | 'shiftKey'
  | 'stopPropagation'
  | 'target'
>;

describe('registerZoomShortcuts', () => {
  let keydownHandler: ((event: KeyboardEvent) => void) | undefined;

  beforeEach(() => {
    vi.stubGlobal('document', { querySelector: () => null });
    vi.stubGlobal('window', {
      addEventListener: (type: string, handler: EventListenerOrEventListenerObject) => {
        if (type === 'keydown' && typeof handler === 'function') {
          keydownHandler = handler as (event: KeyboardEvent) => void;
        }
      },
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    keydownHandler = undefined;
    vi.unstubAllGlobals();
  });

  it('resets zoom for shifted Ctrl+0 layouts', () => {
    const resetZoom = vi.fn();
    const cleanupZoomShortcuts = registerZoomShortcuts({
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      resetZoom,
    });
    const cleanupShortcuts = initShortcuts();

    const event: KeyboardEventStub = {
      key: '0',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: true,
      target: null,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    keydownHandler?.(event as KeyboardEvent);

    expect(resetZoom).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);

    cleanupShortcuts();
    cleanupZoomShortcuts();
  });
});
