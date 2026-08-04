import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToString } from 'solid-js/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../store/types';

const { mockGetPrChecks } = vi.hoisted(() => ({
  mockGetPrChecks: vi.fn(),
}));

vi.mock('../store/store', () => ({
  store: { editorCommand: null },
  getProject: vi.fn(() => undefined),
  showNotification: vi.fn(),
  getPrChecks: mockGetPrChecks,
}));

vi.mock('../lib/platform', () => ({ isMac: false }));
vi.mock('../lib/shell', () => ({
  revealItemInDir: vi.fn(() => Promise.resolve()),
  openInEditor: vi.fn(() => Promise.resolve()),
}));

import { TaskBranchInfoBar } from './TaskBranchInfoBar';

const task: Task = {
  id: 'task-1',
  name: 'Review metadata',
  projectId: 'project-1',
  branchName: 'task/review-metadata',
  worktreePath: '/repo/.worktrees/review-metadata',
  agentIds: [],
  shellAgentIds: [],
  notes: '',
  lastPrompt: '',
  gitIsolation: 'worktree',
  prUrl: 'https://github.com/acme/app/pull/12',
};

describe('TaskBranchInfoBar PR review metadata', () => {
  beforeEach(() => {
    mockGetPrChecks.mockReturnValue({
      overall: 'pending',
      passing: 1,
      pending: 2,
      failing: 0,
      checks: [],
      checkedAt: '2026-08-04T10:00:00.000Z',
      isDraft: false,
      reviewDecision: 'CHANGES_REQUESTED',
    });
  });

  it('shows the short PR label and composes review, CI, and the full URL in its tooltip', () => {
    const html = renderToString(() => TaskBranchInfoBar({ task, onEditProject: vi.fn() }));

    expect(html).toContain('PR #12');
    expect(html).toContain('>Changes requested<');
    expect(html).toContain(
      'title="Review: changes requested\nCI running — 2 pending, 1 passing\nhttps://github.com/acme/app/pull/12"',
    );
  });

  it.each([
    ['APPROVED', 'Approved', 'approved', 'var(--success)'],
    ['CHANGES_REQUESTED', 'Changes requested', 'changes-requested', 'var(--warning)'],
    ['REVIEW_REQUIRED', 'Review needed', 'review-needed', 'var(--accent)'],
  ])('shows the %s decision as %s with its semantic icon', (reviewDecision, label, icon, color) => {
    mockGetPrChecks.mockReturnValue({
      ...mockGetPrChecks(),
      reviewDecision,
    });

    const html = renderToString(() => TaskBranchInfoBar({ task, onEditProject: vi.fn() }));

    expect(html).toContain(`>${label}<`);
    expect(html).toContain(`task-pr-review-icon--${icon}" style="color:${color}`);
  });

  it('shows draft with its semantic icon ahead of any review decision', () => {
    mockGetPrChecks.mockReturnValue({
      ...mockGetPrChecks(),
      isDraft: true,
      reviewDecision: 'APPROVED',
    });

    const html = renderToString(() => TaskBranchInfoBar({ task, onEditProject: vi.fn() }));

    expect(html).toContain('>Draft<');
    expect(html).toContain('task-pr-review-icon--draft" style="color:var(--fg-muted)');
    expect(html).not.toContain('>Approved<');
    expect(html).not.toContain('task-pr-review-icon--approved');
  });

  it('keeps compact review and CI meaning in the PR button accessible label', () => {
    const html = renderToString(() => TaskBranchInfoBar({ task, onEditProject: vi.fn() }));

    expect(html).toContain('aria-label="PR #12, Changes requested, CI running"');
  });

  it('does not render a review placeholder when review metadata is missing', () => {
    mockGetPrChecks.mockReturnValue(undefined);

    const html = renderToString(() => TaskBranchInfoBar({ task, onEditProject: vi.fn() }));

    expect(html).not.toContain('task-pr-review-status');
  });
});

describe('TaskBranchInfoBar responsive styles', () => {
  const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');

  it('uses the task bar width as a named inline-size container', () => {
    expect(css).toMatch(
      /\.task-branch-info-bar\s*{[^}]*container-name:\s*task-branch-info[^}]*container-type:\s*inline-size/s,
    );
  });

  it.each([
    { width: 720, className: 'task-branch-source' },
    { width: 620, className: 'task-branch-path' },
    { width: 620, className: 'task-branch-existing-worktree' },
    { width: 480, className: 'task-branch-project' },
    { width: 420, className: 'task-pr-review-label' },
    { width: 340, className: 'task-branch-name' },
    { width: 340, className: 'task-pr-prefix' },
  ])('collapses .$className at $width px', ({ width, className }) => {
    expect(css).toMatch(
      new RegExp(
        `@container\\s+task-branch-info\\s+\\(max-width:\\s*${width}px\\)[\\s\\S]*?\\.${className}\\b[^{]*{[^}]*display:\\s*none`,
      ),
    );
  });

  it('shows the semantic review icon when review text collapses', () => {
    expect(css).toMatch(
      /@container\s+task-branch-info\s+\(max-width:\s*420px\)[\s\S]*?\.task-pr-review-icon\s*{[^}]*display:\s*inline-flex/,
    );
  });

  it('lets secondary identities ellipsize while keeping PR state non-shrinkable', () => {
    for (const className of ['task-branch-project', 'task-branch-source', 'task-branch-name']) {
      expect(css).toMatch(
        new RegExp(`\\.${className}\\b[^{}]*{[^}]*flex:\\s*0 1 auto[^}]*overflow:\\s*hidden`),
      );
    }
    expect(css).toMatch(/\.task-pr-link\b[^{}]*{[^}]*flex:\s*0 0 auto/);
  });
});
