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
import React, { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDroppable } from '@dnd-kit/core';
import type { NodeProps } from '@xyflow/react';
import type { MarketMod, MarketRole } from '@/types/market';
import type { StepNodeData } from '@/types/desktop';
import { useDesktopStore } from '../../../store/desktop-store';
import { useHarnessStore } from '../../../store/harness-store';
import { LucideIcon } from '../LucideIcon';
import { kebabToTitle } from '../attachable-helpers';
import { stepTypeMeta } from './step-type-meta';
import { StepThinkingPopover } from './StepThinkingPopover';
import { StepInfoModal } from '../StepInfoModal';

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
  const removeMentalNode = useDesktopStore((s) => s.removeMentalNode);
  const mentalEdges = useDesktopStore((s) => s.mentalEdges);
  const executionStatus = useHarnessStore((s) => s.stepStatuses[id]);

  // Hover state for cursor-following popover
  const [hoverAnchor, setHoverAnchor] = useState<{ x: number; y: number } | null>(null);

  // Context menu and info modal state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showInfo, setShowInfo] = useState(false);

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

  const handleMouseEnter = useCallback((event: React.MouseEvent) => {
    setHoverAnchor({ x: event.clientX, y: event.clientY });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoverAnchor(null);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setHoverAnchor(null);
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const mods = stepData.mods ?? [];
  const roles = stepData.roles ?? [];
  const hasAtoms = mods.length > 0 || roles.length > 0;
  const executionClass = executionStatus ? ` is-execution-${executionStatus}` : '';

  // Fork-origin indicator — injected by MentalGraphCanvas when lastForkRunId is set.
  const isForkOrigin = stepData._isForkOrigin === true;
  const forkRunIdShort = typeof stepData._forkRunId === 'string'
    ? stepData._forkRunId.slice(0, 16)
    : null;

  // Step type visual metadata
  const meta = stepTypeMeta(stepData.stepType as string | undefined);

  // Root/terminal detection from edge graph
  const isRoot     = !mentalEdges.some((e) => e.targetId === id);
  const isTerminal = !mentalEdges.some((e) => e.sourceId === id);

  // Connection count (in + out)
  const inCount  = mentalEdges.filter((e) => e.targetId === id).length;
  const outCount = mentalEdges.filter((e) => e.sourceId === id).length;
  const connCount = inCount + outCount;

  // Connections for StepInfoModal
  const incomingIds = mentalEdges.filter((e) => e.targetId === id).map((e) => e.sourceId);
  const outgoingIds = mentalEdges.filter((e) => e.sourceId === id).map((e) => e.targetId);
  const atomCount = mods.length + roles.length;

  return (
  <>
    <article
      ref={setNodeRef}
      className={`step-node-shell${isOver ? ' is-over' : ''}${executionClass}`}
      data-testid={`step-node-${id}`}
      data-step-node-id={id}
      data-step-type={stepData.stepType ?? 'llm_call'}
      data-execution-status={executionStatus ?? 'idle'}
      aria-label={`Step node ${stepData.title}`}
      style={{ ['--step-accent' as string]: meta.accent }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
    >
      {/* Accent hairline at top edge */}
      <div className="step-node-accent-bar" aria-hidden="true" />

      <header className="step-node-drag-handle" aria-label="Drag step">
        <div className="step-node-grip" aria-hidden="true">
          <LucideIcon name="GripVertical" size={14} />
        </div>

        {/* Type icon badge */}
        <div className="step-node-type-icon" aria-hidden="true">
          <LucideIcon name={meta.icon} size={13} />
        </div>

        <div className="step-node-title-wrap">
          <span className="step-node-kicker">{meta.label}</span>
          <strong className="step-node-title">{stepData.title}</strong>
        </div>

        {/* Right-side info cluster */}
        <div className="step-node-header-end">
          {isRoot && (
            <span className="step-node-badge step-node-badge--root" title="Root step" aria-label="Root step">
              <LucideIcon name="Play" size={9} />
            </span>
          )}
          {isTerminal && (
            <span className="step-node-badge step-node-badge--terminal" title="Terminal step" aria-label="Terminal step">
              <LucideIcon name="Flag" size={9} />
            </span>
          )}
          {isForkOrigin && forkRunIdShort && (
            <span
              className="step-node-badge step-node-badge--fork"
              data-testid={`fork-indicator-${id}`}
              title={`Forked here — run ${forkRunIdShort}…`}
              aria-label={`Fork origin: run ${forkRunIdShort}`}
            >
              <LucideIcon name="GitBranch" size={9} />
            </span>
          )}
          <div
            className="step-node-count"
            aria-label={`${atomCount} atoms, ${connCount} connections`}
            title={`${atomCount} atoms · ${connCount} connections`}
          >
            {connCount > 0 ? (
              <span className="step-node-count-conn">{connCount}</span>
            ) : (
              atomCount
            )}
          </div>
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

      {hoverAnchor && (
        <StepThinkingPopover
          stepId={id}
          stepData={stepData}
          initialAnchor={hoverAnchor}
        />
      )}
    </article>

    {/* Context menu — portaled to body to escape React Flow transform */}
    {contextMenu && createPortal(
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 10002 }}
        onClick={() => setContextMenu(null)}
        onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          data-testid="step-node-ctx-menu"
          style={{
            position: 'absolute',
            left: contextMenu.x,
            top: contextMenu.y,
            minWidth: 150,
            padding: 6,
            borderRadius: 8,
            background: 'rgba(20, 20, 20, 0.96)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            data-testid="step-node-ctx-view"
            style={{
              width: '100%', border: 'none', borderRadius: 6,
              background: 'transparent', color: '#e4e4e7',
              fontSize: 12, textAlign: 'left', padding: '6px 8px',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            onClick={() => { setShowInfo(true); setContextMenu(null); }}
          >
            <LucideIcon name="Maximize2" size={12} />
            Ver Step
          </button>
          <button
            data-testid="step-node-ctx-delete"
            style={{
              width: '100%', border: 'none', borderRadius: 6,
              background: 'transparent', color: '#f87171',
              fontSize: 12, textAlign: 'left', padding: '6px 8px',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(240,37,37,0.1)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            onClick={() => { removeMentalNode(id); setContextMenu(null); }}
          >
            <LucideIcon name="Trash2" size={12} />
            Eliminar paso
          </button>
        </div>
      </div>,
      document.body
    )}

    {/* Step info modal */}
    {showInfo && createPortal(
      <StepInfoModal
        stepId={id}
        stepData={stepData}
        connections={{ incoming: incomingIds, outgoing: outgoingIds }}
        status={executionStatus}
        onClose={() => setShowInfo(false)}
      />,
      document.body
    )}
  </>
  );
}
