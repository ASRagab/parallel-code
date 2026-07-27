import { describe, expect, it } from 'vitest';
import { expandCollapsedFileForNavigation } from './ScrollingDiffView';

describe('expandCollapsedFileForNavigation', () => {
  it('expands the target file while preserving other collapsed sections', () => {
    const collapsed = new Set(['src/target.ts', 'src/other.ts']);

    const expanded = expandCollapsedFileForNavigation(collapsed, 'src/target.ts');

    expect([...expanded]).toEqual(['src/other.ts']);
    expect([...collapsed]).toEqual(['src/target.ts', 'src/other.ts']);
  });

  it('keeps the same state when the navigation target is already expanded', () => {
    const collapsed = new Set(['src/other.ts']);

    expect(expandCollapsedFileForNavigation(collapsed, 'src/target.ts')).toBe(collapsed);
  });
});
