import { describe, expect, it, vi } from 'vitest';
import { canSubmitReview, createReviewSubmissionGuard } from './ReviewProvider';

describe('createReviewSubmissionGuard', () => {
  it('blocks concurrent review and finding submissions until the active send settles', async () => {
    let release: (() => void) | undefined;
    const activeSend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const competingSend = vi.fn(async () => {});
    const guard = createReviewSubmissionGuard();

    const first = guard.run(activeSend);
    expect(guard.submitting()).toBe(true);
    expect(canSubmitReview('task-1', 'agent-1', guard.submitting())).toBe(false);

    await expect(guard.run(competingSend)).resolves.toBe(false);
    expect(competingSend).not.toHaveBeenCalled();

    release?.();
    await expect(first).resolves.toBe(true);
    expect(guard.submitting()).toBe(false);
    expect(canSubmitReview('task-1', 'agent-1', guard.submitting())).toBe(true);
  });

  it('releases the guard after a failed send', async () => {
    const guard = createReviewSubmissionGuard();

    await expect(
      guard.run(async () => {
        throw new Error('terminal unavailable');
      }),
    ).rejects.toThrow('terminal unavailable');

    expect(guard.submitting()).toBe(false);
  });
});
