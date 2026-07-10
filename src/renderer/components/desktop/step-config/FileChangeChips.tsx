/**
 * FileChangeChips.tsx — File-change chips for a step run, wired to the diff
 * viewer
 *
 * Responsibility:
 * - Renders one clickable chip per file a step run touched (basename shown,
 *   full path in the tooltip); clicking a chip invokes `onOpenDiff(path)`,
 *   which the parent wires to the existing `diff-viewer` window.
 *
 * Graceful-degradation note (2026-07-10, Task T — see final report
 * "FOLLOW-UP"): the harness-engine step-run event pipeline emits NO
 * file-change events today (`FlowStarted | StepStatusChanged |
 * ModExecutionEvent | FlowCompleted | StepThinkingDelta | CheckpointCreated`
 * — no `FileChanged`), so there is no per-step "changed files" source in
 * harness-store to feed this. Per the coordinator ruling (harness-engine is
 * frozen by F0), this component is built ready and mounted behind a data
 * guard: `StepRunEvidence` passes `files={[]}` today, so it renders NOTHING
 * (the empty-list branch below returns `null`) rather than fabricating paths.
 * The moment a follow-up adds a `FileChanged` harness event + a
 * `stepChangedFiles` slice, the parent swaps in that list and the chips light
 * up with zero change here.
 *
 * Boundaries:
 * - Owns: chip presentation + click-to-open wiring.
 * - Does NOT own: where the file list comes from, or the diff-viewer window
 *   itself (parent owns the store call via `onOpenDiff`).
 */
import React from 'react';
import { LucideIcon } from '../LucideIcon';
import { theme } from '../../../logic/theme';

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};
const CHIP_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '3px 9px',
  borderRadius: 999,
  border: `1px solid ${theme.borderLight}`,
  background: theme.surfaceCard,
  color: theme.textSecondary,
  fontFamily: theme.fontMono,
  fontSize: 10.5,
  cursor: 'pointer',
  maxWidth: '100%',
};
const CHIP_LABEL_STYLE: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export interface FileChangeChipsProps {
  /** Absolute or workspace-relative paths this run touched. Empty → renders nothing. */
  files: string[];
  /** Invoked with the clicked file's path — parent opens the diff viewer. */
  onOpenDiff?: (path: string) => void;
}

export function FileChangeChips({ files, onOpenDiff }: FileChangeChipsProps) {
  // Graceful degradation: no file data (today's harness pipeline) → render
  // nothing at all, never an empty shell or a placeholder path.
  if (files.length === 0) return null;

  return (
    <div style={ROW_STYLE} role="list" aria-label="Files changed by this run" data-testid="step-transcript-file-chips">
      {files.map((path) => (
        <button
          key={path}
          type="button"
          role="listitem"
          style={CHIP_STYLE}
          title={path}
          onClick={() => onOpenDiff?.(path)}
          data-testid="step-transcript-file-chip"
          aria-label={`Open diff for ${path}`}
        >
          <LucideIcon name="FileCode2" size={11} />
          <span style={CHIP_LABEL_STYLE}>{basename(path)}</span>
        </button>
      ))}
    </div>
  );
}
