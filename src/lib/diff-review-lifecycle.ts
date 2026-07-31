import type { ReviewAnnotation } from '../components/review-types';
import { evictStaleAnnotations } from './review-eviction';
import type { FileDiff } from './unified-diff-parser';

export interface ReviewDiffIdentity {
  reviewIdentity: string;
  diffIdentity: string;
}

export interface RequestGenerationGuard {
  begin: () => number;
  invalidate: () => void;
  isCurrent: (generation: number) => boolean;
}

export function createRequestGenerationGuard(): RequestGenerationGuard {
  let current = 0;
  return {
    begin: () => ++current,
    invalidate: () => {
      current++;
    },
    isCurrent: (generation) => generation === current,
  };
}

export function createReviewIdentity(parts: {
  taskId?: string;
  worktreePath: string;
  projectRoot?: string;
  branchName?: string | null;
}): string {
  return JSON.stringify([
    parts.taskId ?? null,
    parts.worktreePath,
    parts.projectRoot ?? null,
    parts.branchName ?? null,
  ]);
}

export async function createDiffIdentity(reviewIdentity: string, rawDiff: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${reviewIdentity}\0${rawDiff}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function transitionReviewAnnotations(
  annotations: ReviewAnnotation[],
  previous: ReviewDiffIdentity | null,
  next: ReviewDiffIdentity,
  files: FileDiff[],
): ReviewAnnotation[] {
  if (!previous) return annotations;
  if (previous.reviewIdentity !== next.reviewIdentity) return [];
  if (previous.diffIdentity === next.diffIdentity) return annotations;
  return evictStaleAnnotations(annotations, files);
}
