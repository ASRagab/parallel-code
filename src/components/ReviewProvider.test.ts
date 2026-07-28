import { createComponent } from 'solid-js';
import { renderToString } from 'solid-js/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendPrompt } from '../store/tasks';
import type { QualityFinding } from '../lib/quality-findings';
import { ReviewProvider, useReview, type ReviewContextValue } from './ReviewProvider';

vi.mock('../store/tasks', () => ({
  sendPrompt: vi.fn(),
}));

function finding(): QualityFinding {
  return {
    id: 'finding-1',
    source: 'fixture',
    ruleId: 'no-floating-promises',
    category: 'reliability',
    severity: 'warning',
    location: { filePath: 'src/app.ts', startLine: 10 },
    explanation: 'Await this promise.',
    state: 'open',
    freshness: 'current',
  };
}

function renderReviewProvider(onSubmitted = vi.fn()): ReviewContextValue {
  let captured: ReviewContextValue | undefined;

  function CaptureContext() {
    captured = useReview();
    return '';
  }

  renderToString(() =>
    createComponent(ReviewProvider, {
      taskId: 'task-1',
      agentId: 'agent-1',
      compilePrompt: (annotations) => `Human comments: ${annotations.length}`,
      onSubmitted,
      get children() {
        return createComponent(CaptureContext, {});
      },
    }),
  );

  if (!captured) throw new Error('Review context was not rendered');
  return captured;
}

describe('ReviewProvider submission', () => {
  beforeEach(() => {
    vi.mocked(sendPrompt).mockReset();
  });

  it('sends one combined prompt, blocks a rapid duplicate, and resolves submitted findings', async () => {
    let release: (() => void) | undefined;
    vi.mocked(sendPrompt).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const onSubmitted = vi.fn();
    const review = renderReviewProvider(onSubmitted);
    review.addAnnotation({
      id: 'annotation-1',
      filePath: 'src/app.ts',
      startLine: 11,
      endLine: 11,
      selectedText: 'runAsync();',
      comment: 'Handle this promise.',
    });
    review.replaceFindings(() => [finding()]);
    review.setFindingSelected('finding-1', true);

    const first = review.submitReview();
    const duplicate = review.submitReview();

    expect(review.submitting()).toBe(true);
    await duplicate;
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(sendPrompt).toHaveBeenCalledWith(
      'task-1',
      'agent-1',
      expect.stringContaining('Human comments: 1'),
    );
    expect(vi.mocked(sendPrompt).mock.calls[0][2]).toContain(
      '[warning] [reliability] fixture/no-floating-promises',
    );

    release?.();
    await first;

    expect(review.submitting()).toBe(false);
    expect(review.annotations()).toEqual([]);
    expect(review.findings()[0].state).toBe('resolved');
    expect(review.selectedFindingIds().size).toBe(0);
    expect(onSubmitted).toHaveBeenCalledOnce();
  });

  it('keeps submission errors visible and releases the in-flight guard', async () => {
    vi.mocked(sendPrompt).mockRejectedValue(new Error('terminal unavailable'));
    const review = renderReviewProvider();
    review.addAnnotation({
      id: 'annotation-1',
      filePath: 'src/app.ts',
      startLine: 11,
      endLine: 11,
      selectedText: 'runAsync();',
      comment: 'Handle this promise.',
    });

    await review.submitReview();

    expect(review.submitting()).toBe(false);
    expect(review.submitError()).toBe('terminal unavailable');
    expect(review.sidebarOpen()).toBe(true);
    expect(review.annotations()).toHaveLength(1);
  });
});
