import React, { useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { FrameNodeData, StepGraphNode } from '@/types/desktop';
import { useDesktopStore } from '../../../store/desktop-store';
import { useHarnessStore } from '../../../store/harness-store';
import { LucideIcon } from '../LucideIcon';
import { HelioxSpinner } from '../../brand/HelioxSpinner';

function isStepNode(n: { type?: string }): n is StepGraphNode {
  return n.type === 'step';
}

export function FrameNode({ id, data }: NodeProps) {
  const frameData = data as unknown as FrameNodeData;
  const mentalNodes = useDesktopStore((s) => s.mentalNodes);
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
      : 'Run';

  return (
    <section
      className="pipeline-frame-node"
      data-testid={`pipeline-frame-${id}`}
      aria-label={`Pipeline frame ${frameData.title}`}
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

      {/* Run control — contextual to this pipeline (Figma-style) */}
      <button
        type="button"
        className="pipeline-frame-run nodrag"
        data-testid={`pipeline-frame-run-${id}`}
        aria-label={isBusy ? 'Pipeline running' : 'Run pipeline'}
        disabled={isBusy}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={handleRun}
      >
        {executionStatus === 'running'
          ? <HelioxSpinner size={12} speed={1.4} />
          : <LucideIcon name="Play" size={11} />}
        <span>{runLabel}</span>
      </button>

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
