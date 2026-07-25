import type { ChangedFile, CoverageSummary } from '../ipc/types';

export type CoverageValueState =
  | 'available'
  | 'no-report'
  | 'file-not-present'
  | 'no-executable-lines';

export interface CoverageValue {
  state: CoverageValueState;
  pct: number | null;
}

export type CoverageFileChangeKind = 'changed' | 'new' | 'deleted' | 'renamed';

export interface CoverageFileComparison {
  path: string;
  basePath: string;
  kind: CoverageFileChangeKind;
  task: CoverageValue;
  base: CoverageValue;
  delta: number | null;
}

export interface ImpactedCoverageFile {
  path: string;
  taskPct: number;
  basePct: number;
  delta: number;
}

export interface CoverageComparison {
  aggregate: {
    task: CoverageValue;
    base: CoverageValue;
    delta: number | null;
  };
  files: Record<string, CoverageFileComparison>;
  impactedUnchangedFiles: ImpactedCoverageFile[];
}

export const MATERIAL_COVERAGE_DELTA = 1;

function roundPercentage(value: number): number {
  return Math.round(value * 100) / 100;
}

function aggregateValue(summary: CoverageSummary | null): CoverageValue {
  if (!summary) return { state: 'no-report', pct: null };
  if (summary.totals.lines.total === 0) {
    return { state: 'no-executable-lines', pct: null };
  }
  return { state: 'available', pct: summary.totals.lines.pct };
}

function fileValue(
  summary: CoverageSummary | null,
  filePath: string,
  forceMissing = false,
): CoverageValue {
  if (!summary) return { state: 'no-report', pct: null };
  const file = forceMissing ? undefined : summary.files[filePath];
  if (!file) return { state: 'file-not-present', pct: null };
  if (file.lines.total === 0) return { state: 'no-executable-lines', pct: null };
  return { state: 'available', pct: file.lines.pct };
}

function coverageDelta(task: CoverageValue, base: CoverageValue): number | null {
  if (task.state !== 'available' || base.state !== 'available') return null;
  return roundPercentage((task.pct ?? 0) - (base.pct ?? 0));
}

function changeKind(file: ChangedFile): CoverageFileChangeKind {
  if (file.status === 'D') return 'deleted';
  if (file.status === 'R') return 'renamed';
  if (file.status === 'A' || file.status === '?' || file.status === 'C') return 'new';
  return 'changed';
}

export function formatCoverageDelta(delta: number): string {
  const rounded = roundPercentage(delta);
  if (rounded > 0) return `+${rounded}pp`;
  return `${rounded}pp`;
}

export function buildCoverageComparison(
  taskSummary: CoverageSummary | null,
  baseSummary: CoverageSummary | null,
  changedFiles: ChangedFile[],
): CoverageComparison {
  const taskAggregate = aggregateValue(taskSummary);
  const baseAggregate = aggregateValue(baseSummary);
  const files: Record<string, CoverageFileComparison> = {};
  const changedPaths = new Set<string>();

  for (const file of changedFiles) {
    const kind = changeKind(file);
    const basePath = file.previous_path ?? file.path;
    changedPaths.add(file.path);
    changedPaths.add(basePath);

    const task = fileValue(taskSummary, file.path, kind === 'deleted');
    const base = fileValue(baseSummary, basePath, kind === 'new');
    files[file.path] = {
      path: file.path,
      basePath,
      kind,
      task,
      base,
      delta: coverageDelta(task, base),
    };
  }

  const impactedUnchangedFiles: ImpactedCoverageFile[] = [];
  if (taskSummary && baseSummary) {
    for (const [filePath, taskFile] of Object.entries(taskSummary.files)) {
      if (changedPaths.has(filePath)) continue;
      const baseFile = baseSummary.files[filePath];
      if (!baseFile || taskFile.lines.total === 0 || baseFile.lines.total === 0) continue;
      const delta = roundPercentage(taskFile.lines.pct - baseFile.lines.pct);
      if (Math.abs(delta) < MATERIAL_COVERAGE_DELTA) continue;
      impactedUnchangedFiles.push({
        path: filePath,
        taskPct: taskFile.lines.pct,
        basePct: baseFile.lines.pct,
        delta,
      });
    }
  }

  impactedUnchangedFiles.sort(
    (a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.path.localeCompare(b.path),
  );

  return {
    aggregate: {
      task: taskAggregate,
      base: baseAggregate,
      delta: coverageDelta(taskAggregate, baseAggregate),
    },
    files,
    impactedUnchangedFiles,
  };
}
