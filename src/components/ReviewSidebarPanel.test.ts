import { describe, expect, it } from 'vitest';
import { hasReviewSidebarState } from './ReviewSidebarPanel';

describe('hasReviewSidebarState', () => {
  it('keeps the review button and panel reachable when only submission failed', () => {
    expect(hasReviewSidebarState(0, false, '', 'terminal unavailable')).toBe(true);
  });

  it('hides an empty review state without loading or errors', () => {
    expect(hasReviewSidebarState(0, false, '', '')).toBe(false);
  });
});
