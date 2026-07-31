import { describe, expect, it } from 'vitest';
import type { ReviewAnnotation } from '../components/review-types';
import {
  createDiffIdentity,
  createRequestGenerationGuard,
  transitionReviewAnnotations,
} from './diff-review-lifecycle';
import type { FileDiff } from './unified-diff-parser';

function annotation(): ReviewAnnotation {
  return {
    id: 'annotation-1',
    filePath: 'src/app.ts',
    startLine: 10,
    endLine: 10,
    selectedText: 'before();',
    comment: 'Keep this behavior.',
  };
}

function touchingDiff(): FileDiff[] {
  return [
    {
      path: 'src/app.ts',
      status: 'M',
      binary: false,
      hunks: [
        {
          oldStart: 10,
          oldCount: 1,
          newStart: 10,
          newCount: 1,
          lines: [
            { type: 'remove', content: 'before();', oldLine: 10, newLine: null },
            { type: 'add', content: 'after();', oldLine: null, newLine: 10 },
          ],
        },
      ],
    },
  ];
}

describe('diff review lifecycle', () => {
  it('keeps durable comments when the exact same diff is reopened', () => {
    const annotations = [annotation()];
    const identity = { reviewIdentity: 'task-a', diffIdentity: 'diff-a' };

    expect(transitionReviewAnnotations(annotations, identity, identity, touchingDiff())).toBe(
      annotations,
    );
  });

  it('evicts touched comments only on an actual diff transition', () => {
    expect(
      transitionReviewAnnotations(
        [annotation()],
        { reviewIdentity: 'task-a', diffIdentity: 'diff-a' },
        { reviewIdentity: 'task-a', diffIdentity: 'diff-b' },
        touchingDiff(),
      ),
    ).toEqual([]);
  });

  it('never carries durable comments into another worktree review', () => {
    expect(
      transitionReviewAnnotations(
        [annotation()],
        { reviewIdentity: 'worktree-a', diffIdentity: 'same-diff' },
        { reviewIdentity: 'worktree-b', diffIdentity: 'same-diff' },
        [],
      ),
    ).toEqual([]);
  });

  it('invalidates a closed viewer request before a reopened request starts', () => {
    const guard = createRequestGenerationGuard();
    const closedRequest = guard.begin();
    guard.invalidate();
    const reopenedRequest = guard.begin();

    expect(guard.isCurrent(closedRequest)).toBe(false);
    expect(guard.isCurrent(reopenedRequest)).toBe(true);
  });

  it('derives stable identities from the exact review scope and diff content', async () => {
    const first = await createDiffIdentity('task-a', 'diff content');
    const same = await createDiffIdentity('task-a', 'diff content');
    const changedContent = await createDiffIdentity('task-a', 'different content');
    const changedScope = await createDiffIdentity('task-b', 'diff content');

    expect(same).toBe(first);
    expect(changedContent).not.toBe(first);
    expect(changedScope).not.toBe(first);
  });
});
