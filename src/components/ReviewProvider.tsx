import { createContext, createSignal, createEffect, createMemo, useContext } from 'solid-js';
import type { JSX } from 'solid-js';
import { sendPrompt } from '../store/tasks';
import {
  compileQualityFindingPrompt,
  dismissQualityFinding,
  selectedFindingIdsAfterSubmission,
  selectSubmittableFindings,
  type QualityFinding,
  type QualityFindingProvider,
} from '../lib/quality-findings';
import type { ReviewAnnotation, DiffInteractionMode } from './review-types';

/** Generic selection info used to create annotations or questions. */
export interface ContentSelection {
  source: string;
  startLine: number;
  endLine: number;
  selectedText: string;
}

/** Represents an active ask-about-code question displayed inline. */
export interface ActiveQuestion {
  id: string;
  source: string;
  afterLine: number;
  question: string;
  startLine: number;
  endLine: number;
  selectedText: string;
}

export interface ReviewScrollTarget {
  id?: string;
  filePath: string;
  startLine: number;
  endLine?: number;
}

export interface ReviewContextValue {
  annotations: () => ReviewAnnotation[];
  addAnnotation: (annotation: ReviewAnnotation) => void;
  dismissAnnotation: (id: string) => void;
  updateAnnotation: (id: string, comment: string) => void;
  replaceAnnotations: (fn: (prev: ReviewAnnotation[]) => ReviewAnnotation[]) => void;

  sidebarOpen: () => boolean;
  setSidebarOpen: (open: boolean) => void;

  findings: () => QualityFinding[];
  openFindings: () => QualityFinding[];
  selectedFindingIds: () => ReadonlySet<string>;
  setFindingSelected: (id: string, selected: boolean) => void;
  dismissFinding: (id: string) => void;
  replaceFindings: (fn: (prev: QualityFinding[]) => QualityFinding[]) => void;
  submitFindings: (ids?: string[]) => Promise<void>;
  findingsLoading: () => boolean;
  findingsError: () => string;

  scrollTarget: () => ReviewScrollTarget | null;
  setScrollTarget: (target: ReviewScrollTarget | null) => void;

  submitReview: () => Promise<void>;
  canSubmit: () => boolean;

  pendingSelection: () => ContentSelection | null;
  handleSelection: (selection: ContentSelection) => void;
  clearPendingSelection: () => void;

  handleSubmit: (text: string, mode: DiffInteractionMode) => string | null;

  activeQuestions: () => ActiveQuestion[];
  dismissQuestion: (id: string) => void;

  submitError: () => string;
}

interface ReviewProviderProps {
  taskId?: string;
  agentId?: string;
  findingProvider?: QualityFindingProvider;
  compilePrompt: (annotations: ReviewAnnotation[]) => string;
  onSubmitted?: () => void;
  children: JSX.Element;
}

const ReviewContext = createContext<ReviewContextValue>();

export function createReviewSubmissionGuard() {
  const [submitting, setSubmitting] = createSignal(false);

  async function run(action: () => Promise<void>): Promise<boolean> {
    if (submitting()) return false;
    setSubmitting(true);
    try {
      await action();
      return true;
    } finally {
      setSubmitting(false);
    }
  }

  return { submitting, run };
}

export function canSubmitReview(
  taskId: string | undefined,
  agentId: string | undefined,
  submitting: boolean,
): boolean {
  return Boolean(taskId && agentId && !submitting);
}

export function ReviewProvider(props: ReviewProviderProps) {
  const [annotations, setAnnotations] = createSignal<ReviewAnnotation[]>([]);
  const [findings, setFindings] = createSignal<QualityFinding[]>([]);
  const [selectedFindingIds, setSelectedFindingIds] = createSignal<ReadonlySet<string>>(new Set());
  const [findingsLoading, setFindingsLoading] = createSignal(false);
  const [findingsError, setFindingsError] = createSignal('');
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [scrollTarget, setScrollTarget] = createSignal<ReviewScrollTarget | null>(null, {
    equals: false,
  });
  const [pendingSelection, setPendingSelection] = createSignal<ContentSelection | null>(null);
  const [activeQuestions, setActiveQuestions] = createSignal<ActiveQuestion[]>([]);
  const [submitError, setSubmitError] = createSignal('');
  const submission = createReviewSubmissionGuard();
  const openFindings = createMemo(() => findings().filter((finding) => finding.state === 'open'));
  let findingLoadGeneration = 0;

  createEffect(() => {
    const provider = props.findingProvider;
    const generation = ++findingLoadGeneration;
    setFindingsError('');
    setSelectedFindingIds(new Set<string>());
    if (!provider) {
      setFindings([]);
      setFindingsLoading(false);
      return;
    }

    setFindingsLoading(true);
    void provider
      .loadFindings()
      .then((loaded) => {
        if (generation === findingLoadGeneration) setFindings(loaded);
      })
      .catch((err: unknown) => {
        if (generation !== findingLoadGeneration) return;
        setFindings([]);
        setFindingsError(err instanceof Error ? err.message : 'Failed to load quality findings');
        setSidebarOpen(true);
      })
      .finally(() => {
        if (generation === findingLoadGeneration) setFindingsLoading(false);
      });
  });

  // Auto-open sidebar when human comments or provider findings are added.
  createEffect(() => {
    if (annotations().length > 0 || openFindings().length > 0) setSidebarOpen(true);
  });

  createEffect(() => {
    const validIds = new Set(
      openFindings()
        .filter((finding) => finding.freshness === 'current')
        .map((finding) => finding.id),
    );
    setSelectedFindingIds((prev) => {
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  });

  function addAnnotation(annotation: ReviewAnnotation) {
    setAnnotations((prev) => [...prev, annotation]);
  }

  function dismissAnnotation(id: string) {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }

  function updateAnnotation(id: string, comment: string) {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, comment } : a)));
  }

  function replaceAnnotations(fn: (prev: ReviewAnnotation[]) => ReviewAnnotation[]) {
    setAnnotations(fn);
  }

  function setFindingSelected(id: string, selected: boolean) {
    setSelectedFindingIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function dismissFinding(id: string) {
    setFindings((prev) => dismissQualityFinding(prev, id));
    setFindingSelected(id, false);
  }

  function replaceFindings(fn: (prev: QualityFinding[]) => QualityFinding[]) {
    setFindings(fn);
  }

  function handleSelection(selection: ContentSelection) {
    setPendingSelection(selection);
  }

  function clearPendingSelection() {
    setPendingSelection(null);
  }

  /** Create an annotation or question from the pending selection. Returns the new item's ID, or null on no-op. */
  function handleSubmit(text: string, mode: DiffInteractionMode): string | null {
    const sel = pendingSelection();
    if (!sel) return null;

    const id = crypto.randomUUID();
    if (mode === 'review') {
      addAnnotation({
        id,
        filePath: sel.source,
        startLine: sel.startLine,
        endLine: sel.endLine,
        selectedText: sel.selectedText,
        comment: text,
      });
    } else {
      setActiveQuestions((prev) => [
        ...prev,
        {
          id,
          source: sel.source,
          afterLine: sel.endLine,
          question: text,
          startLine: sel.startLine,
          endLine: sel.endLine,
          selectedText: sel.selectedText,
        },
      ]);
    }

    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
    return id;
  }

  function dismissQuestion(id: string) {
    setActiveQuestions((prev) => prev.filter((q) => q.id !== id));
  }

  function canSubmit(): boolean {
    return canSubmitReview(props.taskId, props.agentId, submission.submitting());
  }

  async function submitReview(): Promise<void> {
    const taskId = props.taskId;
    const agentId = props.agentId;
    if (!taskId || !agentId) return;
    const prompt = props.compilePrompt(annotations());
    const onSubmitted = props.onSubmitted;

    await submission.run(async () => {
      setSubmitError('');
      try {
        await sendPrompt(taskId, agentId, prompt);
        setAnnotations([]);
        setSidebarOpen(false);
        onSubmitted?.();
      } catch (err: unknown) {
        setSubmitError(err instanceof Error ? err.message : 'Failed to send review');
        setSidebarOpen(true);
      }
    });
  }

  async function submitFindings(ids?: string[]): Promise<void> {
    const taskId = props.taskId;
    const agentId = props.agentId;
    if (!taskId || !agentId) return;

    const selected = selectSubmittableFindings(findings(), ids ?? selectedFindingIds());
    if (selected.length === 0) return;

    await submission.run(async () => {
      setSubmitError('');
      try {
        await sendPrompt(taskId, agentId, compileQualityFindingPrompt(selected));
        setSelectedFindingIds((previous) => selectedFindingIdsAfterSubmission(previous, selected));
      } catch (err: unknown) {
        setSubmitError(err instanceof Error ? err.message : 'Failed to send quality findings');
        setSidebarOpen(true);
      }
    });
  }

  const value: ReviewContextValue = {
    annotations,
    addAnnotation,
    dismissAnnotation,
    updateAnnotation,
    replaceAnnotations,
    findings,
    openFindings,
    selectedFindingIds,
    setFindingSelected,
    dismissFinding,
    replaceFindings,
    submitFindings,
    findingsLoading,
    findingsError,
    sidebarOpen,
    setSidebarOpen,
    scrollTarget,
    setScrollTarget,
    pendingSelection,
    handleSelection,
    clearPendingSelection,
    handleSubmit,
    activeQuestions,
    dismissQuestion,
    canSubmit,
    submitReview,
    submitError,
  };

  return <ReviewContext.Provider value={value}>{props.children}</ReviewContext.Provider>;
}

export function useReview(): ReviewContextValue {
  const ctx = useContext(ReviewContext);
  if (!ctx) {
    throw new Error('useReview must be used within a ReviewProvider');
  }
  return ctx;
}
