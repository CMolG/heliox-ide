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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDroppable } from '@dnd-kit/core';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import type { MarketMod, MarketRole } from '@/types/market';
import type { StepNodeData } from '@/types/desktop';
import { useDesktopStore } from '../../../store/desktop-store';
import { useHarnessStore } from '../../../store/harness-store';
import { LucideIcon } from '../LucideIcon';
import { FluxorSpinner } from '../../brand/FluxorSpinner';
import { kebabToTitle } from '../attachable-helpers';
import { stepTypeMeta } from './step-type-meta';
import { StepThinkingPopover } from './StepThinkingPopover';
import { StepQuickAddPopover } from './StepQuickAddPopover';

function roleColor(role: MarketRole): string {
  return role.color?.startsWith('#') ? role.color : role.color ? `#${role.color}` : '#E87040';
}

// Non-color status glyph shown before the inline Run button — status must
// never be color-only (a11y). "running" is special-cased to the branded
// FluxorSpinner (mirrors FrameNode's header Run control); "idle" renders
// nothing at all.
const STEP_STATUS_GLYPH: Record<string, { icon: string; label: string }> = {
  compiling: { icon: 'Loader2', label: 'Compiling' },
  paused: { icon: 'Clock', label: 'Paused' },
  completed: { icon: 'CheckCircle', label: 'Completed' },
  error: { icon: 'XCircle', label: 'Error' },
};

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

export const StepNode = React.memo(function StepNode({ id, data }: NodeProps) {
  const stepData = data as unknown as StepNodeData;
  const removeModFromStep = useDesktopStore((s) => s.removeModFromStep);
  const removeRoleFromStep = useDesktopStore((s) => s.removeRoleFromStep);
  const removeMentalNode = useDesktopStore((s) => s.removeMentalNode);
  // Narrowed from a raw `s.mentalEdges` subscription (perf fix, 2026-07-05
  // canvas/inspector plan Phase 3): every node used to subscribe to the
  // entire edges array, so adding/removing/dragging ANY edge re-rendered
  // EVERY step on the canvas. Only the in/out COUNTS for this specific step
  // are ever used below (root/terminal badges + the connection-count pill),
  // so `useShallow` lets this bail unless one of those two counts for THIS
  // step's id actually changes.
  const edgeFacts = useDesktopStore(
    useShallow((s) => {
      let inCount = 0;
      let outCount = 0;
      for (const e of s.mentalEdges) {
        if (e.targetId === id) inCount++;
        if (e.sourceId === id) outCount++;
      }
      return { inCount, outCount };
    }),
  );
  const bringMentalToFront = useDesktopStore((s) => s.bringMentalToFront);
  // Both only used by the "Inspect step" context-menu action below — it
  // selects this node and forces the right-side Inspector open rather than
  // opening a modal (Phase 8: the Inspector is now the primary step-config
  // surface; StepInfoModal is reached FROM the Inspector, not from here).
  const setSelectedMentalNodeIds = useDesktopStore((s) => s.setSelectedMentalNodeIds);
  const updateSettings = useDesktopStore((s) => s.updateSettings);
  const executionStatus = useHarnessStore((s) => s.stepStatuses[id]);
  // Same defensive default as `mentalNodes` above, for harness-store fixtures
  // that predate the loop-iteration badge.
  const stepIterations = useHarnessStore((s) => s.stepIterations) ?? {};
  const runStep = useHarnessStore((s) => s.runStep);
  const runFromStep = useHarnessStore((s) => s.runFromStep);
  const isBusy = executionStatus === 'running' || executionStatus === 'compiling';

  // Hover state for cursor-following popover
  const [hoverAnchor, setHoverAnchor] = useState<{ x: number; y: number } | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement | null>(null);

  // Quick-add popover anchor — set from either the empty-state button or the
  // compact "+" once the step has atoms (see the drop-zone JSX below). `null`
  // means the popover is closed. Carries both the trigger's bottom (`y`) and
  // top (`topY`) edges so StepQuickAddPopover can anchor from either one
  // depending on which way it flips — see that component's `anchor` prop doc
  // comment for the full explanation.
  const [quickAddAnchor, setQuickAddAnchor] = useState<{ x: number; y: number; topY: number } | null>(null);

  const { isOver, setNodeRef } = useDroppable({
    id,
    data: {
      type: 'step-node',
      stepId: id,
    },
  });

  // Plain ref to the same DOM node dnd-kit's `setNodeRef` registers — used
  // only to restore focus here when the context menu closes via Escape (a
  // stable target, unlike the ephemeral context-menu button that opened it).
  // Does not alter the droppable registration itself.
  const articleRef = useRef<HTMLElement | null>(null);
  const setArticleRef = useCallback((node: HTMLElement | null) => {
    setNodeRef(node);
    articleRef.current = node;
  }, [setNodeRef]);

  // Move focus into the context menu whenever it opens (mouse right-click or
  // the keyboard opener below), mirroring native OS context-menu behavior and
  // this file's own Step-Config-panel focus-return convention above.
  useEffect(() => {
    if (contextMenu) {
      firstMenuItemRef.current?.focus();
    }
  }, [contextMenu]);

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

  // Keyboard equivalent of onContextMenu — the ContextMenu key or Shift+F10 —
  // so "Run from here" / "Delete Step" are reachable without a mouse.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const isContextMenuKey = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
    if (!isContextMenuKey) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverAnchor(null);
    setContextMenu({ x: rect.left + 16, y: rect.top + 48 });
  }, []);

  // Opens the quick-add popover anchored just below whichever button
  // triggered it (the empty-state placeholder or the compact "+"). Stops
  // propagation so the click can't also pan/select the canvas underneath —
  // same convention as every other node-local button (see stopCanvasGesture).
  const openQuickAdd = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverAnchor(null);
    setQuickAddAnchor({
      x: rect.left,
      y: rect.bottom + 6, // Non-flipped case: panel's TOP sits 6px below the trigger.
      topY: rect.top - 6, // Flipped case: panel's BOTTOM sits 6px above the trigger.
    });
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

  // Root/terminal detection + connection count — derived from the narrowed
  // `edgeFacts` subscription above (was 3 separate full-array scans of the
  // raw `mentalEdges` array).
  const isRoot     = edgeFacts.inCount === 0;
  const isTerminal = edgeFacts.outCount === 0;
  const connCount  = edgeFacts.inCount + edgeFacts.outCount;

  // Note: incoming/outgoing id lists + loop-edge lookups used to live here
  // too, computed solely to hand a `connections` prop to a StepInfoModal
  // this node portaled directly. Phase 8 moved that modal behind the
  // Inspector's "Run evidence" button instead (see
  // components/inspector/StepInspector.tsx, which computes the same shape
  // via the extracted `mental/step-connections.ts` helper) — StepNode itself
  // no longer opens that modal, so it has no remaining use for that data.

  return (
  <>
    <article
      ref={setArticleRef}
      tabIndex={-1}
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
      onKeyDown={handleKeyDown}
      onPointerDownCapture={() => bringMentalToFront(id)}
    >
      {/* Accent hairline at top edge */}
      <div className="step-node-accent-bar" aria-hidden="true" />

      {/* Connection handles — direct children of the article, NOT the
          drop-zone below (its pointer handlers would eat drag starts).
          Ids/types must match MentalGraphCanvas's buildHandles() exactly
          (top/left = target, right/bottom = source) so declarative
          `handles` and these rendered <Handle> elements agree on the same
          connection layout. */}
      <Handle id="top" type="target" position={Position.Top} className="step-node-handle" />
      <Handle id="right" type="source" position={Position.Right} className="step-node-handle" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="step-node-handle" />
      <Handle id="left" type="target" position={Position.Left} className="step-node-handle" />

      {/* Clipping layer for rounded-corner content ONLY — the shell itself is
          `overflow: visible` so the handles above (and the accent bar/status
          ring, still direct shell children below/around this wrapper) can
          protrude past the edge as full circles instead of being clipped to
          semicircles. See index.css's `.step-node-clip` comment. */}
      <div className="step-node-clip">
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
            {executionStatus === 'running' ? (
              <span
                className="step-node-status step-node-status--running"
                data-testid={`step-node-status-${id}`}
                role="status"
                aria-live="polite"
                aria-label="Running"
                title="Running"
              >
                <FluxorSpinner size={11} speed={1.4} />
              </span>
            ) : executionStatus && STEP_STATUS_GLYPH[executionStatus] ? (
              <span
                className={`step-node-status step-node-status--${executionStatus}`}
                data-testid={`step-node-status-${id}`}
                role="status"
                aria-live="polite"
                aria-label={STEP_STATUS_GLYPH[executionStatus].label}
                title={STEP_STATUS_GLYPH[executionStatus].label}
              >
                <LucideIcon name={STEP_STATUS_GLYPH[executionStatus].icon} size={11} />
              </span>
            ) : null}
            <button
              type="button"
              className="step-node-run-btn nodrag"
              data-testid={`step-node-run-${id}`}
              data-step-no-drag="true"
              title="Run this step"
              aria-label={`Run step ${stepData.title}`}
              disabled={isBusy}
              aria-disabled={isBusy}
              onPointerDown={stopCanvasGesture}
              onClick={(event) => {
                event.stopPropagation();
                runStep(id);
              }}
            >
              <LucideIcon name="Play" size={9} />
            </button>
            {stepIterations[id] && (
              <div
                className="step-node-count"
                data-testid={`step-node-iteration-${id}`}
                aria-label={`Loop iteration ${stepIterations[id].iteration} of ${stepIterations[id].total}`}
                title={`Loop iteration ${stepIterations[id].iteration} of ${stepIterations[id].total}`}
                style={{ gap: 3, color: '#FCD34D', background: 'rgba(245, 158, 11, 0.14)', borderColor: 'rgba(245, 158, 11, 0.35)' }}
              >
                <LucideIcon name="Repeat" size={9} />
                <span className="step-node-count-conn" style={{ color: 'inherit' }}>
                  {stepIterations[id].iteration}/{stepIterations[id].total}
                </span>
              </div>
            )}
            <div
              className="step-node-count"
              aria-label={`${connCount} connection${connCount === 1 ? '' : 's'}`}
              title={`${connCount} connection${connCount === 1 ? '' : 's'}`}
            >
              <span className="step-node-count-conn">{connCount}</span>
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
              <button
                type="button"
                className="step-node-add-atom nodrag"
                data-testid={`step-node-quick-add-${id}`}
                aria-label="Add atoms"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={openQuickAdd}
              >
                <LucideIcon name="Plus" size={12} />
              </button>

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
            <button
              type="button"
              className="step-node-empty step-node-empty--action nodrag"
              data-testid={`step-node-quick-add-${id}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={openQuickAdd}
            >
              <LucideIcon name="PackagePlus" size={16} />
              <span>Add atoms</span>
            </button>
          )}
        </div>
      </div>

      {hoverAnchor && (
        <StepThinkingPopover
          stepId={id}
          stepData={stepData}
          initialAnchor={hoverAnchor}
        />
      )}

      {quickAddAnchor && (
        <StepQuickAddPopover
          stepId={id}
          stepData={stepData}
          anchor={quickAddAnchor}
          onClose={() => setQuickAddAnchor(null)}
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
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.stopPropagation();
          setContextMenu(null);
          articleRef.current?.focus();
        }}
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
            ref={firstMenuItemRef}
            style={{
              width: '100%', minHeight: 44, border: 'none', borderRadius: 6,
              background: 'transparent', color: '#e4e4e7',
              fontSize: 12, textAlign: 'left', padding: '6px 8px',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            onClick={() => {
              // Phase 8: this used to open a StepInfoModal portal directly.
              // The Inspector is now the primary step-config surface, so this
              // selects the node (driving the Inspector's routing — see
              // InspectorPanel.tsx) and force-opens the Inspector column if
              // it was collapsed, instead of popping a modal.
              setSelectedMentalNodeIds([id]);
              updateSettings({ showInspector: true });
              setContextMenu(null);
            }}
          >
            <LucideIcon name="Maximize2" size={12} />
            Inspect step
          </button>
          <button
            data-testid="step-node-ctx-run-from"
            disabled={isBusy}
            aria-disabled={isBusy}
            style={{
              width: '100%', minHeight: 44, border: 'none', borderRadius: 6,
              background: 'transparent', color: isBusy ? 'rgba(228,228,231,0.4)' : '#e4e4e7',
              fontSize: 12, textAlign: 'left', padding: '6px 8px',
              cursor: isBusy ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 7,
            }}
            onMouseEnter={(e) => { if (!isBusy) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            onClick={() => { runFromStep(id); setContextMenu(null); }}
          >
            <LucideIcon name="Workflow" size={12} />
            Run from here
          </button>
          <button
            data-testid="step-node-ctx-delete"
            style={{
              width: '100%', minHeight: 44, border: 'none', borderRadius: 6,
              background: 'transparent', color: '#f87171',
              fontSize: 12, textAlign: 'left', padding: '6px 8px',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(240,37,37,0.1)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            onClick={() => { removeMentalNode(id); setContextMenu(null); }}
          >
            <LucideIcon name="Trash2" size={12} />
            Delete Step
          </button>
        </div>
      </div>,
      document.body
    )}
  </>
  );
});
