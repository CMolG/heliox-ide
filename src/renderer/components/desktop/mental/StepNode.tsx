/**
 * StepNode.tsx — xyflow custom node for pipeline steps
 *
 * Responsibility:
 * - Renders a Step as a drop target for dnd-kit draggable Roles and Mods.
 * - Displays the Step's current Roles and Mods from node.data.
 *
 * Boundaries:
 * - Owns: StepNode presentation and local drop-target registration.
 * - Does NOT own: drag-end policy, persistence, or market inventory lookup.
 */
import React, { useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { NodeProps } from '@xyflow/react';
import type { MarketMod, MarketRole } from '@/types/market';
import type { StepNodeData } from '@/types/desktop';
import { useDesktopStore } from '../../../store/desktop-store';
import { useHarnessStore } from '../../../store/harness-store';
import { LucideIcon } from '../LucideIcon';
import { kebabToTitle } from '../attachable-helpers';

function roleColor(role: MarketRole): string {
  return role.color?.startsWith('#') ? role.color : role.color ? `#${role.color}` : '#E87040';
}

function StepChip({
  label,
  accent,
  icon,
  onRemove,
}: {
  label: string;
  accent: string;
  icon: string;
  onRemove: () => void;
}) {
  return (
    <div className="step-node-chip" style={{ ['--step-chip-accent' as string]: accent }}>
      <LucideIcon name={icon} size={12} />
      <span>{label}</span>
      <button
        type="button"
        className="step-node-chip-remove nodrag"
        aria-label={`Remove ${label}`}
        data-step-no-drag="true"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        <LucideIcon name="X" size={10} />
      </button>
    </div>
  );
}

export function StepNode({ id, data }: NodeProps) {
  const stepData = data as unknown as StepNodeData;
  const removeModFromStep = useDesktopStore((s) => s.removeModFromStep);
  const removeRoleFromStep = useDesktopStore((s) => s.removeRoleFromStep);
  const executionStatus = useHarnessStore((s) => s.stepStatuses[id]);

  const { isOver, setNodeRef } = useDroppable({
    id,
    data: {
      type: 'step-node',
      stepId: id,
    },
  });

  const stopCanvasGesture = useCallback((event: React.PointerEvent | React.MouseEvent) => {
    event.stopPropagation();
  }, []);

  const mods = stepData.mods ?? [];
  const roles = stepData.roles ?? [];
  const hasAtoms = mods.length > 0 || roles.length > 0;
  const executionClass = executionStatus ? ` is-execution-${executionStatus}` : '';

  return (
    <article
      ref={setNodeRef}
      className={`step-node-shell${isOver ? ' is-over' : ''}${executionClass}`}
      data-testid={`step-node-${id}`}
      data-step-node-id={id}
      data-execution-status={executionStatus ?? 'idle'}
      aria-label={`Step node ${stepData.title}`}
    >
      <header className="step-node-drag-handle" aria-label="Drag step">
        <div className="step-node-grip" aria-hidden="true">
          <LucideIcon name="GripVertical" size={14} />
        </div>
        <div className="step-node-title-wrap">
          <span className="step-node-kicker">Step</span>
          <strong className="step-node-title">{stepData.title}</strong>
        </div>
        <div className="step-node-count" aria-label={`${mods.length} mods and ${roles.length} roles`}>
          {mods.length + roles.length}
        </div>
      </header>

      {stepData.description && (
        <p className="step-node-description nodrag" onPointerDown={stopCanvasGesture}>
          {stepData.description}
        </p>
      )}

      <div className="step-node-drop-zone nodrag" onPointerDown={stopCanvasGesture}>
        {hasAtoms ? (
          <>
            {roles.length > 0 && (
              <section className="step-node-section" aria-label="Assigned roles">
                <span className="step-node-section-label">Roles</span>
                <div className="step-node-chip-list">
                  {roles.map((role) => (
                    <StepChip
                      key={role.name}
                      label={kebabToTitle(role.name)}
                      accent={roleColor(role)}
                      icon="User"
                      onRemove={() => removeRoleFromStep(id, role.name)}
                    />
                  ))}
                </div>
              </section>
            )}

            {mods.length > 0 && (
              <section className="step-node-section" aria-label="Assigned mods">
                <span className="step-node-section-label">Mods</span>
                <div className="step-node-chip-list">
                  {mods.map((mod: MarketMod) => (
                    <StepChip
                      key={mod.name}
                      label={kebabToTitle(mod.name)}
                      accent="#4285F4"
                      icon="Wrench"
                      onRemove={() => removeModFromStep(id, mod.name)}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <div className="step-node-empty">
            <LucideIcon name="PackagePlus" size={16} />
            <span>No atoms</span>
          </div>
        )}
      </div>
    </article>
  );
}
