import type { FileDiff } from './unified-diff-parser';

export type QualityFindingCategory = 'reliability' | 'maintainability';
export type QualityFindingSeverity = 'error' | 'warning' | 'note';
export type QualityFindingState = 'open' | 'dismissed' | 'resolved';
export type QualityFindingFreshness = 'current' | 'stale';

export interface QualityFindingLocation {
  filePath: string;
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

export interface QualityFinding {
  id: string;
  fingerprint: string;
  source: string;
  ruleId: string;
  category: QualityFindingCategory;
  severity: QualityFindingSeverity;
  location: QualityFindingLocation;
  explanation: string;
  state: QualityFindingState;
  freshness: QualityFindingFreshness;
}

export interface QualityFindingProvider {
  loadFindings(): Promise<QualityFinding[]>;
}

function cloneFinding(finding: QualityFinding): QualityFinding {
  return {
    ...finding,
    location: { ...finding.location },
  };
}

/** In-memory provider for component tests and provider integration fixtures. */
export function createFixtureQualityFindingProvider(
  findings: QualityFinding[],
): QualityFindingProvider {
  return {
    async loadFindings() {
      return findings.map(cloneFinding);
    },
  };
}

function findingMatchesDiff(finding: QualityFinding, files: FileDiff[]): boolean {
  const file = files.find((candidate) => candidate.path === finding.location.filePath);
  if (!file || file.status === 'D' || file.binary) return false;

  const startLine = finding.location.startLine;
  const endLine = finding.location.endLine ?? startLine;
  return file.hunks.some((hunk) =>
    hunk.lines.some(
      (line) => line.newLine !== null && line.newLine >= startLine && line.newLine <= endLine,
    ),
  );
}

/** Mark provider locations stale when they no longer map to the current rendered diff. */
export function reconcileQualityFindings(
  findings: QualityFinding[],
  files: FileDiff[],
): QualityFinding[] {
  let changed = false;
  const reconciled = findings.map((finding) => {
    const freshness: QualityFindingFreshness = findingMatchesDiff(finding, files)
      ? 'current'
      : 'stale';
    if (finding.freshness === freshness) return finding;
    changed = true;
    return { ...finding, freshness };
  });
  return changed ? reconciled : findings;
}

export function dismissQualityFinding(findings: QualityFinding[], id: string): QualityFinding[] {
  return findings.map((finding) =>
    finding.id === id ? { ...finding, state: 'dismissed' } : finding,
  );
}

export function selectSubmittableFindings(
  findings: QualityFinding[],
  ids: Iterable<string>,
): QualityFinding[] {
  const requested = new Set(ids);
  return findings.filter(
    (finding) =>
      requested.has(finding.id) && finding.state === 'open' && finding.freshness === 'current',
  );
}

export function formatQualityFindingLocation(finding: QualityFinding): string {
  const location = finding.location;
  const startColumn = location.startColumn ? `:${location.startColumn}` : '';
  let end = '';
  if (location.endLine && location.endLine !== location.startLine) {
    end = `-${location.endLine}${location.endColumn ? `:${location.endColumn}` : ''}`;
  } else if (location.endColumn && location.endColumn !== location.startColumn) {
    end = `-${location.endColumn}`;
  }
  return `${location.filePath}:${location.startLine}${startColumn}${end}`;
}

export function compileQualityFindingPrompt(findings: QualityFinding[]): string {
  const lines = ['Structured code-quality findings to remediate:\n'];
  for (const finding of findings) {
    lines.push(
      `## [${finding.severity}] [${finding.category}] ${finding.source}/${finding.ruleId}`,
    );
    lines.push(`Location: ${formatQualityFindingLocation(finding)}`);
    lines.push(`Fingerprint: ${finding.fingerprint}`);
    lines.push(finding.explanation);
    lines.push('');
  }
  return lines.join('\n');
}
