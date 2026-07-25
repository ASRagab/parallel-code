import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import {
  formatQualityFindingLocation,
  type QualityFinding,
  type QualityFindingSeverity,
} from '../lib/quality-findings';
import { CloseIcon } from './icons';

interface QualityFindingCardProps {
  finding: QualityFinding;
  canSubmit: boolean;
  onDismiss: () => void;
  onSubmit: () => void;
}

function severityColor(severity: QualityFindingSeverity): string {
  if (severity === 'error') return theme.error;
  if (severity === 'warning') return theme.warning;
  return theme.accent;
}

export function QualityFindingCard(props: QualityFindingCardProps) {
  const color = () => severityColor(props.finding.severity);

  return (
    <div
      style={{
        margin: '4px 40px 4px 80px',
        'max-width': '560px',
        'border-left': `3px solid ${color()}`,
        'border-radius': '0 4px 4px 0',
        background: `color-mix(in srgb, ${theme.bgElevated} 90%, ${color()} 10%)`,
        padding: '8px 12px',
        'font-family': "'JetBrains Mono', monospace",
      }}
    >
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '6px',
          'font-size': sf(11),
          color: color(),
          'font-weight': '600',
          'text-transform': 'uppercase',
        }}
      >
        <span>Automated</span>
        <span aria-hidden="true">·</span>
        <span>{props.finding.severity}</span>
        <span aria-hidden="true">·</span>
        <span>{props.finding.category}</span>
        <span style={{ flex: '1' }} />
        <button
          type="button"
          onClick={() => props.onDismiss()}
          title="Dismiss finding"
          aria-label="Dismiss finding"
          style={{
            display: 'flex',
            background: 'transparent',
            border: 'none',
            color: theme.fgMuted,
            cursor: 'pointer',
            padding: '2px',
            'border-radius': '3px',
          }}
        >
          <CloseIcon size={13} />
        </button>
      </div>

      <div
        style={{
          'margin-top': '3px',
          color: theme.fgSubtle,
          'font-size': sf(11),
          display: 'flex',
          gap: '6px',
          'flex-wrap': 'wrap',
        }}
      >
        <span>{props.finding.source}</span>
        <span aria-hidden="true">/</span>
        <span>{props.finding.ruleId}</span>
        <span aria-hidden="true">·</span>
        <span>{formatQualityFindingLocation(props.finding)}</span>
      </div>

      <div
        style={{
          color: theme.fg,
          'font-size': sf(13),
          'white-space': 'pre-wrap',
          'margin-top': '5px',
        }}
      >
        {props.finding.explanation}
      </div>

      <div style={{ display: 'flex', 'justify-content': 'flex-end', 'margin-top': '6px' }}>
        <button
          type="button"
          onClick={() => props.onSubmit()}
          disabled={!props.canSubmit}
          title={props.canSubmit ? 'Send finding to agent' : 'No agent available'}
          style={{
            background: 'transparent',
            border: `1px solid ${color()}`,
            color: props.canSubmit ? color() : theme.fgMuted,
            'font-size': sf(11),
            'font-weight': '600',
            padding: '3px 8px',
            'border-radius': '4px',
            cursor: props.canSubmit ? 'pointer' : 'default',
          }}
        >
          Send to agent
        </button>
      </div>
    </div>
  );
}
