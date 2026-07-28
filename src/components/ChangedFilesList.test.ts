import { describe, expect, it } from 'vitest';
import type { ChangedFile } from '../ipc/types';
import {
  coverageFooterLabel,
  coverageFooterTitle,
  filesFooterLabel,
  filesFooterTitle,
  isCoverageEligible,
} from './ChangedFilesList';

function changedFile(overrides: Partial<ChangedFile>): ChangedFile {
  return {
    path: 'src/example.ts',
    lines_added: 1,
    lines_removed: 0,
    status: 'M',
    committed: false,
    ...overrides,
  };
}

describe('isCoverageEligible', () => {
  it('accepts changed source files', () => {
    expect(isCoverageEligible(changedFile({ path: 'src/example.ts' }))).toBe(true);
  });

  it('rejects deleted files', () => {
    expect(isCoverageEligible(changedFile({ status: 'D' }))).toBe(false);
  });

  it('rejects test files', () => {
    expect(isCoverageEligible(changedFile({ path: 'src/example.test.ts' }))).toBe(false);
  });
});

describe('coverageFooterLabel', () => {
  it('explains when no coverage artifact is loaded', () => {
    expect(coverageFooterLabel(false, null, false)).toBe('⊘');
  });

  it('explains when a report is loaded but no changed file matches it', () => {
    expect(coverageFooterLabel(true, null, false)).toBe('∅');
  });

  it('distinguishes matched zero-line files from missing coverage', () => {
    expect(coverageFooterLabel(true, null, true)).toBe('◌');
    expect(
      coverageFooterTitle(
        {
          format: 'lcov',
          generatedAt: '2026-04-23T00:00:00.000Z',
          reportPath: '/repo/coverage/lcov.info',
          totals: {
            lines: { total: 0, covered: 0, skipped: 0, pct: 100 },
            statements: { total: 0, covered: 0, skipped: 0, pct: 100 },
            functions: { total: 0, covered: 0, skipped: 0, pct: 100 },
            branches: { total: 0, covered: 0, skipped: 0, pct: 100 },
          },
          files: {},
        },
        null,
        true,
      ),
    ).toContain('no executable lines');
  });

  it('shows the radar percentage when changed files are covered', () => {
    expect(coverageFooterLabel(true, 82, true)).toBe('◔ 82%');
  });
});

describe('filesFooterLabel', () => {
  it('shows only total files when everything is committed', () => {
    expect(filesFooterLabel(7, 0)).toBe('▤ 7');
    expect(filesFooterTitle(7, 0)).toBe('7 changed files.');
  });

  it('merges total and uncommitted counts into one compact token', () => {
    expect(filesFooterLabel(7, 2)).toBe('▤ 7·2u');
    expect(filesFooterTitle(7, 2)).toBe('7 changed files, 2 uncommitted.');
  });
});
