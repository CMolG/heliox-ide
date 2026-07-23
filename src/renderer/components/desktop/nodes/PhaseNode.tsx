import React, { useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { PhaseNodeData } from '@/types/desktop';
import { useDesktopStore } from '../../../store/desktop-store';
import { LucideIcon } from '../LucideIcon';

/**
 * A phase's canvas surface — a named sub-grouping inside a Frame (spec:
 * docs/superpowers/specs/2026-07-21-agentic-phase-model.md §3.2). Visually
 * subordinate to FrameNode (same dashed→solid grammar, but violet-tinted,
 * tighter radius and a smaller title chip) so the two nesting levels stay
 * legible per the task doc's own confusion-mitigation note: frame and phase
 * are two visual groupers and are easy to conflate without a clear hierarchy.
 *
 * Deliberately minimal (F2 spike: "agrupación pura, sin ejecución"). No Run
 * or Export control — a phase never executes on its own; the owning Frame's
 * Run button stays the only trigger. No exitContract/onError editor either,
 * which mirrors AgenticStep.contract's own status quo: both travel through
 * their node-data shapes and are authorable via import/programmatic
 * construction until a follow-up builds a form for them.
 */
export const PhaseNode = React.memo(function PhaseNode({ id, data }: NodeProps) {
  const phaseData = data as unknown as PhaseNodeData;
  const updatePhaseData = useDesktopStore((s) => s.updatePhaseData);
  const bringMentalToFront = useDesktopStore((s) => s.bringMentalToFront);

  const handleRename = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    updatePhaseData(id, { title: event.target.value });
  }, [id, updatePhaseData]);

  const stepCount = phaseData.childIds.length;
  const stepLabel = stepCount === 1 ? '1 step' : `${stepCount} steps`;

  return (
    <section
      className="pipeline-phase-node"
      data-testid={`pipeline-phase-${id}`}
      aria-label={`Phase ${phaseData.title}`}
      onPointerDownCapture={() => bringMentalToFront(id)}
    >
      <div className="pipeline-phase-title">
        <LucideIcon name="Layers" size={11} />
        <input
          className="pipeline-phase-title-input nodrag"
          data-testid={`pipeline-phase-title-${id}`}
          aria-label="Phase name"
          value={phaseData.title}
          onChange={handleRename}
          onPointerDown={(event) => event.stopPropagation()}
        />
        <span className="pipeline-phase-count">{stepLabel}</span>
      </div>
      {phaseData.description && (
        <p className="pipeline-phase-desc">{phaseData.description}</p>
      )}
    </section>
  );
});
