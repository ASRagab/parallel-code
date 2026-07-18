import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');

describe('global focus-visible styles', () => {
  it('gives native controls and ARIA widgets an app-wide focus indicator', () => {
    const rule = css.match(/(?:^|\n):is\(([\s\S]*?)\):focus-visible\s*\{([\s\S]*?)\}/);

    expect(rule).not.toBeNull();
    expect(rule?.[1]).toContain('button');
    expect(rule?.[1]).toContain("[tabindex]:not([tabindex='-1'])");
    expect(rule?.[1]).toContain("[role='button']");
    expect(rule?.[2]).toMatch(/outline:\s*2px solid var\(--accent\)/);
  });

  it('does not suppress the new-task placeholder focus outline', () => {
    expect(css).not.toMatch(/\.new-task-placeholder:focus-visible\s*\{[^}]*outline:\s*none/);
  });
});
