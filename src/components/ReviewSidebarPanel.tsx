import { Show } from 'solid-js';
import { useReview } from './ReviewProvider';
import { ReviewSidebar } from './ReviewSidebar';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';

export function hasReviewSidebarState(
  reviewCount: number,
  findingsLoading: boolean,
  findingsError: string,
  submitError: string,
): boolean {
  return reviewCount > 0 || findingsLoading || Boolean(findingsError) || Boolean(submitError);
}

/** Toggle button that shows annotation count and opens/closes the review sidebar. */
export function ReviewCommentsButton() {
  const review = useReview();
  const reviewCount = () => review.annotations().length + review.openFindings().length;
  const hasReviewState = () =>
    hasReviewSidebarState(
      reviewCount(),
      review.findingsLoading(),
      review.findingsError(),
      review.submitError(),
    );

  return (
    <Show when={hasReviewState()}>
      <button
        onClick={() => review.setSidebarOpen(!review.sidebarOpen())}
        style={{
          background: review.sidebarOpen() ? theme.warning : 'transparent',
          color: review.sidebarOpen() ? theme.accentText : theme.warning,
          border: `1px solid ${theme.warning}`,
          'font-size': sf(12),
          padding: '2px 10px',
          'border-radius': '4px',
          cursor: 'pointer',
        }}
      >
        Review ({reviewCount()})
      </button>
    </Show>
  );
}

/** Sidebar column with human comments and provider findings. */
export function ReviewSidebarPanel() {
  const review = useReview();
  const reviewCount = () => review.annotations().length + review.openFindings().length;
  const hasReviewState = () =>
    hasReviewSidebarState(
      reviewCount(),
      review.findingsLoading(),
      review.findingsError(),
      review.submitError(),
    );

  return (
    <Show when={review.sidebarOpen() && hasReviewState()}>
      <div style={{ display: 'flex', 'flex-direction': 'column' }}>
        <Show when={review.submitError()}>
          <div
            style={{
              padding: '6px 12px',
              color: theme.error,
              'font-size': sf(12),
              'border-bottom': `1px solid ${theme.border}`,
              background: 'rgba(255, 95, 115, 0.08)',
            }}
          >
            {review.submitError()}
          </div>
        </Show>
        <Show when={review.findingsLoading()}>
          <div
            style={{
              padding: '6px 12px',
              color: theme.fgMuted,
              'font-size': sf(12),
              'border-bottom': `1px solid ${theme.border}`,
            }}
          >
            Loading quality findings...
          </div>
        </Show>
        <Show when={review.findingsError()}>
          <div
            style={{
              padding: '6px 12px',
              color: theme.warning,
              'font-size': sf(12),
              'border-bottom': `1px solid ${theme.border}`,
            }}
          >
            Quality findings unavailable: {review.findingsError()}
          </div>
        </Show>
        <ReviewSidebar
          annotations={review.annotations()}
          findings={review.openFindings()}
          selectedFindingIds={review.selectedFindingIds()}
          canSubmit={review.canSubmit()}
          onDismiss={review.dismissAnnotation}
          onUpdate={review.updateAnnotation}
          onScrollTo={review.setScrollTarget}
          onSubmit={review.submitReview}
          onFindingSelected={review.setFindingSelected}
          onFindingDismiss={review.dismissFinding}
          onFindingScrollTo={(finding) =>
            review.setScrollTarget({
              id: finding.id,
              filePath: finding.location.filePath,
              startLine: finding.location.startLine,
              endLine: finding.location.endLine,
            })
          }
          onFindingSubmit={(ids) => void review.submitFindings(ids)}
        />
      </div>
    </Show>
  );
}
