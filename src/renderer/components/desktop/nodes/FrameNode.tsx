import React, { useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { FrameNodeData, StepGraphNode } from '@/types/desktop';
import type { AgenticExecutionStatus } from '@/types/harness';
import { useDesktopStore } from '../../../store/desktop-store';
import { useHarnessStore } from '../../../store/harness-store';
import { LucideIcon } from '../LucideIcon';
import { HelioxSpinner } from '../../brand/HelioxSpinner';

function isStepNode(n: { type?: string }): n is StepGraphNode {
  return n.type === 'step';
}

// `completed`/`error`/`paused` used to fall through to the same plain "Run"
// button as `idle` — states-polish.md §1: "a failed flow looks exactly like
// one that never ran." index.css already carries this exact color
// vocabulary for the same three statuses on .step-node-shell
// (index.css:2306-2329 — completed=green/34,197,94, error=red/248,113,113,
// paused=amber/250,204,21), but index.css and StepNode.tsx are P1a's this
// round, so this reuses those hues via inline style instead of a new
// .pipeline-frame-run.is-execution-* class. idle/compiling/running are
// intentionally absent (looks up as `undefined` -> no inline style at all),
// so their existing CSS-driven look — including the amber `:disabled` state
// — is pixel-identical to before.
const STATUS_RUN_ACCENTS: Partial<Record<AgenticExecutionStatus, React.CSSProperties>> = {
  completed: {
    borderColor: 'rgba(34, 197, 94, 0.85)',
    background: 'rgba(34, 197, 94, 0.14)',
    color: '#bbf7d0',
  },
  error: {
    borderColor: 'rgba(248, 113, 113, 0.85)',
    background: 'rgba(248, 113, 113, 0.14)',
    color: '#fecaca',
  },
  paused: {
    borderColor: 'rgba(250, 204, 21, 0.75)',
    background: 'rgba(250, 204, 21, 0.14)',
    color: '#fde68a',
  },
};

export function FrameNode({ id, data }: NodeProps) {
  const frameData = data as unknown as FrameNodeData;
  const mentalNodes = useDesktopStore((s) => s.mentalNodes);
  const bringMentalToFront = useDesktopStore((s) => s.bringMentalToFront);
  const compileCurrentCanvas = useHarnessStore((s) => s.compileCurrentCanvas);
  const startExecution = useHarnessStore((s) => s.startExecution);
  const executionStatus = useHarnessStore((s) => s.executionStatus);

  const isBusy = executionStatus === 'compiling' || executionStatus === 'running';

  // Run the pipeline straight from the Flow header (replaces the old harness dock).
  const handleRun = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    const flow = compileCurrentCanvas();
    if (flow) void startExecution();
  }, [compileCurrentCanvas, startExecution]);

  const stepCount = frameData.childIds.length;
  const stepLabel = stepCount === 1 ? '1 step' : `${stepCount} steps`;

  // Collect unique roles from child step nodes
  const childSteps = mentalNodes.filter(
    (n) => isStepNode(n) && (n as StepGraphNode).parentId === id,
  ) as StepGraphNode[];

  const uniqueRoleNames = new Set<string>();
  for (const step of childSteps) {
    for (const role of step.data.roles ?? []) {
      uniqueRoleNames.add(role.name);
    }
  }
  const roleCount = uniqueRoleNames.size;
  const roleLabel = roleCount === 1 ? '1 role' : `${roleCount} roles`;

  const runLabel = executionStatus === 'running'
    ? 'Running'
    : executionStatus === 'compiling'
      ? 'Compiling'
      : executionStatus === 'completed'
        ? 'Completed'
        : executionStatus === 'error'
          ? 'Failed'
          : executionStatus === 'paused'
            ? 'Paused'
            : 'Run';

  const runAriaLabel = isBusy
    ? 'Pipeline running'
    : executionStatus === 'completed'
      ? 'Pipeline completed — run again'
      : executionStatus === 'error'
        ? 'Pipeline failed — retry'
        : executionStatus === 'paused'
          ? 'Pipeline paused — resume'
          : 'Run pipeline';

  const runAccentStyle = STATUS_RUN_ACCENTS[executionStatus];

  return (
    <section
      className="pipeline-frame-node"
      data-testid={`pipeline-frame-${id}`}
      aria-label={`Pipeline frame ${frameData.title}`}
      onPointerDownCapture={() => bringMentalToFront(id)}
    >
      <div className="pipeline-frame-title">
        <span className="pipeline-frame-workflow-icon" aria-hidden="true">
          <LucideIcon name="Workflow" size={13} />
        </span>
        <span className="pipeline-frame-kicker">Flow</span>
        <strong>{frameData.title}</strong>
        <span className="pipeline-frame-count">{stepLabel}</span>
        {roleCount > 0 && (
          <span className="pipeline-frame-role-count" aria-label={`${roleLabel} assigned`}>
            <LucideIcon name="User" size={9} />
            {roleLabel}
          </span>
        )}
      </div>

      {/* Run control — contextual to this pipeline (Figma-style). Wrapped in
          a role="status"/aria-live region (states-polish.md §6 — currently
          absent) so screen readers hear "Failed"/"Completed"/"Paused"/
          "Running" as the status changes; mirrors the role="status"
          aria-live="polite" pattern ArenaButton.tsx already uses for its own
          run-status notice. */}
      <div role="status" aria-live="polite">
        <button
          type="button"
          className="pipeline-frame-run nodrag"
          data-testid={`pipeline-frame-run-${id}`}
          aria-label={runAriaLabel}
          disabled={isBusy}
          style={runAccentStyle}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={handleRun}
        >
          {executionStatus === 'running' ? (
            <HelioxSpinner size={12} speed={1.4} />
          ) : executionStatus === 'completed' ? (
            <LucideIcon name="CheckCircle" size={11} />
          ) : executionStatus === 'error' ? (
            <LucideIcon name="XCircle" size={11} />
          ) : (
            <LucideIcon name="Play" size={11} />
          )}
          <span>{runLabel}</span>
        </button>
      </div>

      {frameData.description && (
        <div className="pipeline-frame-meta">
          <p className="pipeline-frame-desc">{frameData.description}</p>
        </div>
      )}
      {frameData.missingCapabilitiesRequested && frameData.missingCapabilitiesRequested.length > 0 && (
        <div className="pipeline-frame-missing" aria-label="Missing capabilities requested">
          {frameData.missingCapabilitiesRequested.length}
        </div>
      )}
    </section>
  );
}
