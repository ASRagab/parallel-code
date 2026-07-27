import { describe, expect, it } from 'vitest';
import type { FileDiff } from './unified-diff-parser';
import {
  compileQualityFindingPrompt,
  createFixtureQualityFindingProvider,
  dismissQualityFinding,
  reconcileQualityFindings,
  reconcileQualityFindingsForDiff,
  selectedFindingIdsAfterSubmission,
  selectSubmittableFindings,
  type QualityFinding,
} from './quality-findings';

function finding(overrides: Partial<QualityFinding> = {}): QualityFinding {
  return {
    id: 'finding-1',
    fingerprint: 'fixture:no-floating-promises:src/app.ts:10',
    source: 'fixture',
    ruleId: 'no-floating-promises',
    category: 'reliability',
    severity: 'warning',
    location: { filePath: 'src/app.ts', startLine: 10, startColumn: 3 },
    explanation: 'Await this promise or explicitly handle its rejection.',
    state: 'open',
    freshness: 'current',
    ...overrides,
  };
}

function diff(overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    path: 'src/app.ts',
    status: 'M',
    binary: false,
    hunks: [
      {
        oldStart: 9,
        oldCount: 2,
        newStart: 9,
        newCount: 3,
        lines: [
          { type: 'context', content: 'before', oldLine: 9, newLine: 9 },
          { type: 'add', content: 'runAsync();', oldLine: null, newLine: 10 },
          { type: 'context', content: 'after', oldLine: 10, newLine: 11 },
        ],
      },
    ],
    ...overrides,
  };
}

describe('createFixtureQualityFindingProvider', () => {
  it('supplies independent copies of fixture findings', async () => {
    const original = finding();
    const provider = createFixtureQualityFindingProvider([original]);

    const first = await provider.loadFindings();
    first[0].location.startLine = 99;
    const second = await provider.loadFindings();

    expect(second).toEqual([original]);
  });
});

describe('reconcileQualityFindings', () => {
  it('keeps a finding current when its location is represented in the diff', () => {
    const input = [finding()];
    expect(reconcileQualityFindings(input, [diff()])).toBe(input);
  });

  it.each([
    ['file is absent', []],
    ['file is deleted', [diff({ status: 'D', hunks: [] })]],
    ['location no longer matches', [diff()]],
  ])('marks a finding stale when the %s', (_name, files) => {
    const input =
      _name === 'location no longer matches'
        ? [finding({ location: { filePath: 'src/app.ts', startLine: 50 } })]
        : [finding()];
    expect(reconcileQualityFindings(input, files as FileDiff[])[0].freshness).toBe('stale');
  });

  it('can mark a stale finding current again after a matching diff refresh', () => {
    const stale = finding({ freshness: 'stale' });
    expect(reconcileQualityFindings([stale], [diff()])[0].freshness).toBe('current');
  });

  it('keeps provider-first findings pending until the diff loads', () => {
    const result = reconcileQualityFindingsForDiff([finding()], [], false);

    expect(result[0].freshness).toBe('pending');
    expect(selectSubmittableFindings(result, ['finding-1'])).toEqual([]);
  });

  it('returns current findings to pending during commit navigation', () => {
    const current = reconcileQualityFindingsForDiff([finding()], [diff()], true);
    const navigating = reconcileQualityFindingsForDiff(current, [], false);

    expect(current[0].freshness).toBe('current');
    expect(navigating[0].freshness).toBe('pending');
  });

  it('keeps findings pending after rejected diff loading', () => {
    const loading = reconcileQualityFindingsForDiff([finding()], [], false);
    const rejected = reconcileQualityFindingsForDiff(loading, [], false);

    expect(rejected).toBe(loading);
    expect(rejected[0].freshness).toBe('pending');
  });

  it('requires the navigable start line for a ranged finding', () => {
    const ranged = finding({
      location: { filePath: 'src/app.ts', startLine: 8, endLine: 10 },
    });

    expect(reconcileQualityFindings([ranged], [diff()])[0].freshness).toBe('stale');
    expect(
      reconcileQualityFindings(
        [ranged],
        [
          diff({
            hunks: [
              {
                oldStart: 8,
                oldCount: 1,
                newStart: 8,
                newCount: 1,
                lines: [{ type: 'add', content: 'runAsync();', oldLine: null, newLine: 8 }],
              },
            ],
          }),
        ],
      )[0].freshness,
    ).toBe('current');
  });
});

describe('compileQualityFindingPrompt', () => {
  it('includes structured remediation fields for one or multiple findings', () => {
    const prompt = compileQualityFindingPrompt([
      finding(),
      finding({
        id: 'finding-2',
        fingerprint: 'fixture:complexity:src/util.ts:4',
        ruleId: 'complexity',
        category: 'maintainability',
        severity: 'note',
        location: {
          filePath: 'src/util.ts',
          startLine: 4,
          startColumn: 2,
          endLine: 8,
          endColumn: 7,
        },
      }),
    ]);

    expect(prompt).toContain('[warning] [reliability] fixture/no-floating-promises');
    expect(prompt).toContain('Location: src/app.ts:10:3');
    expect(prompt).toContain('Fingerprint: fixture:no-floating-promises:src/app.ts:10');
    expect(prompt).toContain('[note] [maintainability] fixture/complexity');
    expect(prompt).toContain('Location: src/util.ts:4:2-8:7');
  });
});

describe('finding review actions', () => {
  it('dismisses by state without dropping provider identity', () => {
    const original = finding();
    const dismissed = dismissQualityFinding([original], original.id);

    expect(dismissed[0]).toMatchObject({
      id: original.id,
      fingerprint: original.fingerprint,
      state: 'dismissed',
    });
  });

  it('submits only selected open findings with current locations', () => {
    const current = finding();
    const stale = finding({ id: 'stale', fingerprint: 'stale', freshness: 'stale' });
    const resolved = finding({ id: 'resolved', fingerprint: 'resolved', state: 'resolved' });

    expect(
      selectSubmittableFindings([current, stale, resolved], ['finding-1', 'stale', 'resolved']),
    ).toEqual([current]);
  });

  it('preserves unrelated selections after a single-card submission', () => {
    const remaining = selectedFindingIdsAfterSubmission(
      new Set(['finding-b', 'finding-c']),
      [finding()],
      false,
    );

    expect([...remaining]).toEqual(['finding-b', 'finding-c']);
  });

  it('clears selections after a bulk submission', () => {
    const remaining = selectedFindingIdsAfterSubmission(
      new Set(['finding-1', 'finding-b']),
      [finding()],
      true,
    );

    expect(remaining.size).toBe(0);
  });
});
