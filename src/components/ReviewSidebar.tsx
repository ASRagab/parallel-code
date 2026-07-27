import { For, Show, createSignal } from 'solid-js';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import {
  formatQualityFindingLocation,
  type QualityFinding,
  type QualityFindingSeverity,
} from '../lib/quality-findings';
import type { ReviewAnnotation } from './review-types';
import { CloseIcon } from './icons';

interface ReviewSidebarProps {
  annotations: ReviewAnnotation[];
  findings: QualityFinding[];
  selectedFindingIds: ReadonlySet<string>;
  canSubmit: boolean;
  onDismiss: (id: string) => void;
  onUpdate: (id: string, comment: string) => void;
  onScrollTo: (annotation: ReviewAnnotation) => void;
  onSubmit: () => void;
  onFindingSelected: (id: string, selected: boolean) => void;
  onFindingDismiss: (id: string) => void;
  onFindingScrollTo: (finding: QualityFinding) => void;
  onFindingSubmit: (ids?: string[]) => void;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function severityColor(severity: QualityFindingSeverity): string {
  if (severity === 'error') return theme.error;
  if (severity === 'warning') return theme.warning;
  return theme.accent;
}

function QualityFindingSidebarItem(props: {
  finding: QualityFinding;
  selected: boolean;
  canSubmit: boolean;
  onSelected: (selected: boolean) => void;
  onDismiss: () => void;
  onScrollTo: () => void;
  onSubmit: () => void;
}) {
  const color = () => severityColor(props.finding.severity);
  const isActionable = () => props.finding.freshness === 'current';
  const freshnessLabel = () => {
    if (props.finding.freshness === 'pending') return 'Pending';
    if (props.finding.freshness === 'stale') return 'Stale';
    return null;
  };

  return (
    <div
      onClick={() => {
        if (isActionable()) props.onScrollTo();
      }}
      style={{
        padding: '8px 10px',
        'margin-bottom': '6px',
        'border-left': `3px solid ${isActionable() ? color() : theme.fgSubtle}`,
        'border-radius': '0 4px 4px 0',
        background: 'color-mix(in srgb, var(--fg) 3%, transparent)',
        cursor: isActionable() ? 'pointer' : 'default',
        opacity: isActionable() ? '1' : '0.65',
      }}
    >
      <div style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}>
        <input
          type="checkbox"
          checked={props.selected}
          disabled={!isActionable()}
          aria-label={`Select ${props.finding.ruleId} finding`}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => props.onSelected(event.currentTarget.checked)}
        />
        <span
          style={{
            color: isActionable() ? color() : theme.fgMuted,
            'font-size': sf(10),
            'font-weight': '700',
            'text-transform': 'uppercase',
          }}
        >
          Automated · {props.finding.severity} · {props.finding.category}
        </span>
        <span style={{ flex: '1' }} />
        <Show when={freshnessLabel()}>
          {(label) => (
            <span
              style={{
                color: theme.fgMuted,
                'font-size': sf(10),
                'font-weight': '700',
                'text-transform': 'uppercase',
              }}
            >
              {label()}
            </span>
          )}
        </Show>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            props.onDismiss();
          }}
          title="Dismiss finding"
          aria-label={`Dismiss ${props.finding.ruleId} finding`}
          style={{
            display: 'flex',
            background: 'transparent',
            border: 'none',
            color: theme.fgSubtle,
            cursor: 'pointer',
            padding: '2px',
            'border-radius': '2px',
          }}
        >
          <CloseIcon size={12} />
        </button>
      </div>

      <div
        style={{
          'font-size': sf(11),
          color: theme.fgSubtle,
          'font-family': "'JetBrains Mono', monospace",
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
          'margin-top': '3px',
        }}
        title={formatQualityFindingLocation(props.finding)}
      >
        {formatQualityFindingLocation(props.finding)}
      </div>

      <div
        style={{
          'font-size': sf(11),
          color: theme.fgMuted,
          'font-family': "'JetBrains Mono', monospace",
          'margin-top': '2px',
        }}
      >
        {props.finding.source}/{props.finding.ruleId}
      </div>

      <div
        style={{
          'font-size': sf(12),
          color: theme.fg,
          'white-space': 'pre-wrap',
          'margin-top': '4px',
        }}
      >
        {truncate(props.finding.explanation, 180)}
      </div>

      <div style={{ display: 'flex', 'justify-content': 'flex-end', 'margin-top': '6px' }}>
        <button
          type="button"
          disabled={!props.canSubmit || !isActionable()}
          onClick={(event) => {
            event.stopPropagation();
            props.onSubmit();
          }}
          style={{
            background: 'transparent',
            border: `1px solid ${isActionable() ? color() : theme.border}`,
            color: props.canSubmit && isActionable() ? color() : theme.fgMuted,
            'font-size': sf(10),
            'font-weight': '600',
            padding: '2px 7px',
            'border-radius': '4px',
            cursor: props.canSubmit && isActionable() ? 'pointer' : 'default',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

function SidebarAnnotationItem(props: {
  annotation: ReviewAnnotation;
  onDismiss: () => void;
  onUpdate: (comment: string) => void;
  onScrollTo: () => void;
}) {
  const [editing, setEditing] = createSignal(false);
  const [editText, setEditText] = createSignal('');

  function startEdit(e: MouseEvent) {
    e.stopPropagation();
    setEditText(props.annotation.comment);
    setEditing(true);
  }

  function saveEdit() {
    if (!editing()) return;
    const trimmed = editText().trim();
    if (trimmed && trimmed !== props.annotation.comment) {
      props.onUpdate(trimmed);
    }
    setEditing(false);
  }

  return (
    <div
      onClick={() => props.onScrollTo()}
      style={{
        padding: '8px 10px',
        'margin-bottom': '6px',
        'border-left': `3px solid ${theme.warning}`,
        'border-radius': '0 4px 4px 0',
        background: 'color-mix(in srgb, var(--fg) 3%, transparent)',
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      {/* Dismiss button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          props.onDismiss();
        }}
        style={{
          position: 'absolute',
          top: '4px',
          right: '4px',
          background: 'transparent',
          border: 'none',
          color: theme.fgSubtle,
          cursor: 'pointer',
          padding: '2px 4px',
          'font-size': sf(12),
          'line-height': '1',
          'border-radius': '2px',
        }}
      >
        &times;
      </button>

      {/* File path + line range */}
      <div
        style={{
          'font-size': sf(11),
          color: theme.fgSubtle,
          'font-family': "'JetBrains Mono', monospace",
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
          'padding-right': '16px',
        }}
      >
        {props.annotation.filePath}:{props.annotation.startLine}-{props.annotation.endLine}
      </div>

      {/* Code snippet */}
      <div
        style={{
          'font-size': sf(11),
          color: theme.fgMuted,
          'font-family': "'JetBrains Mono', monospace",
          'max-height': '2.4em',
          overflow: 'hidden',
          'margin-top': '2px',
        }}
      >
        {truncate(props.annotation.selectedText, 120)}
      </div>

      {/* Comment text */}
      <Show
        when={!editing()}
        fallback={
          <input
            ref={(el) => requestAnimationFrame(() => el.focus())}
            type="text"
            value={editText()}
            onInput={(e) => setEditText(e.currentTarget.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                saveEdit();
              }
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={saveEdit}
            style={{
              width: '100%',
              background: theme.bgInput,
              border: `1px solid ${theme.borderSubtle}`,
              'border-radius': '4px',
              color: theme.fg,
              'font-size': sf(12),
              'font-family': "'JetBrains Mono', monospace",
              padding: '4px 8px',
              'margin-top': '4px',
              outline: 'none',
              'box-sizing': 'border-box',
            }}
          />
        }
      >
        <div
          onClick={startEdit}
          style={{
            'font-size': sf(12),
            color: theme.fg,
            'white-space': 'pre-wrap',
            'margin-top': '4px',
            cursor: 'text',
          }}
        >
          {props.annotation.comment}
        </div>
      </Show>
    </div>
  );
}

export function ReviewSidebar(props: ReviewSidebarProps) {
  return (
    <div
      style={{
        width: '300px',
        'min-width': '300px',
        'border-left': `1px solid ${theme.border}`,
        display: 'flex',
        'flex-direction': 'column',
        background: theme.bgElevated,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 14px',
          'border-bottom': `1px solid ${theme.border}`,
          'font-weight': '600',
          'font-size': sf(13),
          color: theme.fg,
        }}
      >
        Review ({props.annotations.length + props.findings.length})
      </div>

      {/* Scrollable list */}
      <div
        style={{
          flex: '1',
          'overflow-y': 'auto',
          padding: '8px',
        }}
      >
        <Show when={props.findings.length > 0}>
          <div
            style={{
              color: theme.fgMuted,
              'font-size': sf(10),
              'font-weight': '700',
              'text-transform': 'uppercase',
              'margin-bottom': '6px',
            }}
          >
            Automated findings ({props.findings.length})
          </div>
          <For each={props.findings}>
            {(finding) => (
              <QualityFindingSidebarItem
                finding={finding}
                selected={props.selectedFindingIds.has(finding.id)}
                canSubmit={props.canSubmit}
                onSelected={(selected) => props.onFindingSelected(finding.id, selected)}
                onDismiss={() => props.onFindingDismiss(finding.id)}
                onScrollTo={() => props.onFindingScrollTo(finding)}
                onSubmit={() => props.onFindingSubmit([finding.id])}
              />
            )}
          </For>
        </Show>
        <Show when={props.annotations.length > 0}>
          <div
            style={{
              color: theme.fgMuted,
              'font-size': sf(10),
              'font-weight': '700',
              'text-transform': 'uppercase',
              margin: props.findings.length > 0 ? '12px 0 6px' : '0 0 6px',
            }}
          >
            Human comments ({props.annotations.length})
          </div>
        </Show>
        <For each={props.annotations}>
          {(annotation) => (
            <SidebarAnnotationItem
              annotation={annotation}
              onDismiss={() => props.onDismiss(annotation.id)}
              onUpdate={(comment) => props.onUpdate(annotation.id, comment)}
              onScrollTo={() => props.onScrollTo(annotation)}
            />
          )}
        </For>
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '8px',
          'border-top': `1px solid ${theme.border}`,
        }}
      >
        <div style={{ display: 'grid', gap: '6px' }}>
          <Show when={props.findings.length > 0}>
            <button
              onClick={() => props.onFindingSubmit()}
              disabled={!props.canSubmit || props.selectedFindingIds.size === 0}
              style={{
                width: '100%',
                background:
                  props.canSubmit && props.selectedFindingIds.size > 0
                    ? theme.accent
                    : theme.bgHover,
                color:
                  props.canSubmit && props.selectedFindingIds.size > 0
                    ? theme.accentText
                    : theme.fgMuted,
                border: 'none',
                'font-weight': '600',
                'font-size': sf(12),
                padding: '7px 12px',
                'border-radius': '4px',
                cursor:
                  props.canSubmit && props.selectedFindingIds.size > 0 ? 'pointer' : 'default',
              }}
              title={props.canSubmit ? undefined : 'No agent available to receive review'}
            >
              Send selected findings ({props.selectedFindingIds.size})
            </button>
          </Show>
          <Show when={props.annotations.length > 0}>
            <button
              onClick={() => props.onSubmit()}
              disabled={!props.canSubmit}
              style={{
                width: '100%',
                background: props.canSubmit ? theme.accent : theme.bgHover,
                color: props.canSubmit ? theme.accentText : theme.fgMuted,
                border: 'none',
                'font-weight': '600',
                'font-size': sf(12),
                padding: '7px 12px',
                'border-radius': '4px',
                cursor: props.canSubmit ? 'pointer' : 'default',
              }}
              title={props.canSubmit ? undefined : 'No agent available to receive review'}
            >
              Send human comments ({props.annotations.length})
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}
