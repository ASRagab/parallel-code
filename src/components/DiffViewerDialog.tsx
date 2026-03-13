import { Show, createSignal, createEffect, onCleanup } from 'solid-js';
import { Dialog } from './Dialog';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { parseUnifiedDiff } from '../lib/unified-diff-parser';
import { evictStaleAnnotations } from '../lib/review-eviction';
import { ScrollingDiffView } from './ScrollingDiffView';
import { ReviewSidebar } from './ReviewSidebar';
import { sendPrompt } from '../store/tasks';
import type { FileDiff } from '../lib/unified-diff-parser';
import type { ReviewAnnotation } from './review-types';

interface DiffViewerDialogProps {
  /** Which file to auto-scroll to (the one the user clicked). Null = closed. */
  scrollToFile: string | null;
  worktreePath: string;
  onClose: () => void;
  /** Project root for branch-based fallback when worktree doesn't exist */
  projectRoot?: string;
  /** Branch name for branch-based fallback when worktree doesn't exist */
  branchName?: string | null;
  taskId?: string;
  agentId?: string;
}

function compileReview(annotations: ReviewAnnotation[]): string {
  const lines = ['Code review feedback for your changes:\n'];
  for (const a of annotations) {
    lines.push(`## ${a.filePath} (lines ${a.startLine}-${a.endLine})`);
    lines.push('```');
    lines.push(a.selectedText);
    lines.push('```');
    lines.push(a.comment);
    lines.push('');
  }
  return lines.join('\n');
}

export function DiffViewerDialog(props: DiffViewerDialogProps) {
  const [parsedFiles, setParsedFiles] = createSignal<FileDiff[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [searchQuery, setSearchQuery] = createSignal('');
  const [reviewAnnotations, setReviewAnnotations] = createSignal<ReviewAnnotation[]>([]);
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [scrollTarget, setScrollTarget] = createSignal<ReviewAnnotation | null>(null, {
    equals: false,
  });

  // Auto-open sidebar when annotations are added
  createEffect(() => {
    if (reviewAnnotations().length > 0) setSidebarOpen(true);
  });

  let fetchGeneration = 0;
  let searchInputRef: HTMLInputElement | undefined;

  // Ctrl+F / Cmd+F handler to focus the search input
  createEffect(() => {
    if (props.scrollToFile === null) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    onCleanup(() => document.removeEventListener('keydown', handler));
  });

  createEffect(() => {
    const scrollTarget = props.scrollToFile;
    if (!scrollTarget) return;

    const worktreePath = props.worktreePath;
    const projectRoot = props.projectRoot;
    const branchName = props.branchName;
    const thisGen = ++fetchGeneration;

    setSearchQuery('');
    setLoading(true);
    setError('');
    setParsedFiles([]);

    const worktreePromise = worktreePath
      ? invoke<string>(IPC.GetAllFileDiffs, { worktreePath })
      : Promise.reject(new Error('no worktree'));

    worktreePromise
      .catch((err: unknown) => {
        if (projectRoot && branchName) {
          return invoke<string>(IPC.GetAllFileDiffsFromBranch, {
            projectRoot,
            branchName,
          });
        }
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Could not load diffs: ${msg}`);
      })
      .then((rawDiff) => {
        if (thisGen !== fetchGeneration) return;
        const newFiles = parseUnifiedDiff(rawDiff);
        setParsedFiles(newFiles);
        setReviewAnnotations((prev) => evictStaleAnnotations(prev, newFiles));
      })
      .catch((err) => {
        if (thisGen !== fetchGeneration) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (thisGen === fetchGeneration) setLoading(false);
      });
  });

  const totalAdded = () =>
    parsedFiles().reduce(
      (sum, f) =>
        sum + f.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === 'add').length, 0),
      0,
    );

  const totalRemoved = () =>
    parsedFiles().reduce(
      (sum, f) =>
        sum + f.hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === 'remove').length, 0),
      0,
    );

  function dismissAnnotation(id: string) {
    setReviewAnnotations((prev) => prev.filter((a) => a.id !== id));
  }

  const [submitError, setSubmitError] = createSignal('');

  async function submitReview() {
    const taskId = props.taskId;
    const agentId = props.agentId;
    if (!taskId || !agentId) return;
    setSubmitError('');
    const prompt = compileReview(reviewAnnotations());
    try {
      await sendPrompt(taskId, agentId, prompt);
      setReviewAnnotations([]);
      setSidebarOpen(false);
      props.onClose();
    } catch (err) {
      // Keep annotations intact so user can retry
      setSubmitError(err instanceof Error ? err.message : 'Failed to send review');
    }
  }

  const countMatches = () => {
    const q = searchQuery().toLowerCase();
    if (!q) return 0;
    let count = 0;
    for (const file of parsedFiles()) {
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          let idx = 0;
          const lower = line.content.toLowerCase();
          while ((idx = lower.indexOf(q, idx)) !== -1) {
            count++;
            idx += q.length;
          }
        }
      }
    }
    return count;
  };

  return (
    <Dialog
      open={props.scrollToFile !== null}
      onClose={props.onClose}
      width="90vw"
      panelStyle={{
        height: '85vh',
        'max-width': '1400px',
        overflow: 'hidden',
        padding: '0',
        gap: '0',
      }}
    >
      <Show when={props.scrollToFile !== null}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '10px',
            padding: '12px 20px',
            'border-bottom': `1px solid ${theme.border}`,
            'flex-shrink': '0',
          }}
        >
          <span
            style={{
              'font-size': sf(13),
              color: theme.fg,
              'font-weight': '600',
            }}
          >
            {parsedFiles().length} files changed
          </span>
          <span
            style={{
              'font-size': sf(12),
              color: theme.success,
              'font-family': "'JetBrains Mono', monospace",
            }}
          >
            +{totalAdded()}
          </span>
          <span
            style={{
              'font-size': sf(12),
              color: theme.error,
              'font-family': "'JetBrains Mono', monospace",
            }}
          >
            -{totalRemoved()}
          </span>

          <Show when={reviewAnnotations().length > 0}>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen())}
              style={{
                background: sidebarOpen() ? theme.warning : 'transparent',
                color: sidebarOpen() ? '#fff' : theme.warning,
                border: `1px solid ${theme.warning}`,
                'font-size': sf(11),
                padding: '2px 10px',
                'border-radius': '4px',
                cursor: 'pointer',
              }}
            >
              Comments ({reviewAnnotations().length})
            </button>
          </Show>

          <span style={{ flex: '1' }} />

          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: `1px solid ${theme.borderSubtle}`,
              'border-radius': '4px',
              color: theme.fg,
              'font-size': sf(12),
              'font-family': "'JetBrains Mono', monospace",
              padding: '3px 8px',
              width: '200px',
              outline: 'none',
            }}
          />
          <Show when={searchQuery().length > 0}>
            <span style={{ 'font-size': sf(11), color: theme.fgSubtle, 'white-space': 'nowrap' }}>
              {countMatches()} matches
            </span>
          </Show>

          <button
            onClick={() => props.onClose()}
            style={{
              background: 'transparent',
              border: 'none',
              color: theme.fgMuted,
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              'align-items': 'center',
              'border-radius': '4px',
            }}
            title="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: '1', overflow: 'hidden', display: 'flex' }}>
          <div style={{ flex: '1', overflow: 'hidden' }}>
            <Show when={loading()}>
              <div
                style={{
                  padding: '40px',
                  'text-align': 'center',
                  color: theme.fgMuted,
                  'font-size': sf(13),
                }}
              >
                Loading diffs...
              </div>
            </Show>

            <Show when={error()}>
              <div
                style={{
                  padding: '40px',
                  'text-align': 'center',
                  color: theme.error,
                  'font-size': sf(13),
                }}
              >
                {error()}
              </div>
            </Show>

            <Show when={!loading() && !error()}>
              <ScrollingDiffView
                files={parsedFiles()}
                scrollToPath={props.scrollToFile}
                worktreePath={props.worktreePath}
                searchQuery={searchQuery()}
                reviewAnnotations={reviewAnnotations()}
                onAnnotationAdd={(a) => setReviewAnnotations((prev) => [...prev, a])}
                onAnnotationDismiss={dismissAnnotation}
                scrollToAnnotation={scrollTarget()}
              />
            </Show>
          </div>

          <Show when={sidebarOpen() && reviewAnnotations().length > 0}>
            <div style={{ display: 'flex', 'flex-direction': 'column' }}>
              <Show when={submitError()}>
                <div
                  style={{
                    padding: '6px 12px',
                    color: theme.error,
                    'font-size': sf(11),
                    'border-bottom': `1px solid ${theme.border}`,
                    background: 'rgba(255, 95, 115, 0.08)',
                  }}
                >
                  {submitError()}
                </div>
              </Show>
              <ReviewSidebar
                annotations={reviewAnnotations()}
                canSubmit={!!props.taskId && !!props.agentId}
                onDismiss={dismissAnnotation}
                onScrollTo={setScrollTarget}
                onSubmit={submitReview}
              />
            </div>
          </Show>
        </div>
      </Show>
    </Dialog>
  );
}
