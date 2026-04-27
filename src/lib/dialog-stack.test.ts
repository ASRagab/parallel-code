import { afterEach, describe, expect, it } from 'vitest';

import { _resetForTests, isTopmost, popDialog, pushDialog, topDialog } from './dialog-stack';

afterEach(() => {
  _resetForTests();
});

describe('dialog-stack', () => {
  it('topmost is the most-recently-pushed id', () => {
    pushDialog('a');
    expect(topDialog()).toBe('a');
    expect(isTopmost('a')).toBe(true);

    pushDialog('b');
    expect(topDialog()).toBe('b');
    expect(isTopmost('a')).toBe(false);
    expect(isTopmost('b')).toBe(true);
  });

  it('popping the topmost restores the previous as topmost', () => {
    pushDialog('a');
    pushDialog('b');
    pushDialog('c');
    expect(topDialog()).toBe('c');
    popDialog('c');
    expect(topDialog()).toBe('b');
    popDialog('b');
    expect(topDialog()).toBe('a');
  });

  it('popping a non-topmost id leaves the topmost as topmost', () => {
    pushDialog('a');
    pushDialog('b');
    pushDialog('c');
    popDialog('b'); // remove the middle
    expect(topDialog()).toBe('c');
    expect(isTopmost('a')).toBe(false);
    expect(isTopmost('b')).toBe(false);
    expect(isTopmost('c')).toBe(true);
  });

  it('pushing the same id twice does not double it', () => {
    pushDialog('a');
    pushDialog('a');
    expect(topDialog()).toBe('a');
    popDialog('a');
    expect(topDialog()).toBe(null);
  });

  it('isTopmost on an unknown id returns false', () => {
    expect(isTopmost('absent')).toBe(false);
    pushDialog('a');
    expect(isTopmost('absent')).toBe(false);
  });

  it('topDialog is null when empty', () => {
    expect(topDialog()).toBe(null);
  });
});
