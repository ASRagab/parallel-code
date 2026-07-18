import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');

function reducedMotionBlock(): string {
  const marker = '@media (prefers-reduced-motion: reduce)';
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);

  const openingBrace = css.indexOf('{', start);
  let depth = 0;
  for (let index = openingBrace; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return css.slice(start, index + 1);
  }

  throw new Error('Unclosed reduced-motion media query');
}

describe('reduced-motion styles', () => {
  it('disables nonessential task and pulse animations', () => {
    const block = reducedMotionBlock();
    const animatedSelectors = [
      '.task-appearing',
      '.task-item-appearing',
      '.task-removing',
      '.task-item-removing',
      '.status-dot-pulse',
      '.askcode-loading-pulse',
      '.keybinding-recording-pulse',
    ];

    for (const selector of animatedSelectors) {
      expect(block).toContain(selector);
    }
    expect(block).toMatch(/animation:\s*none\s*!important/);
  });
});
